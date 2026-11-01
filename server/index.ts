import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type MiddlewareHandler } from "hono";
import { stream } from "hono/streaming";
import {
  MAX_MESSAGE_LENGTH,
  type CharacterInfo,
  type ConversationInfo,
  type ConversationSummary,
  type Memory,
} from "../shared/protocol.ts";
import { listBackgrounds, loadCharacter } from "./character.ts";
import { claimConversation, forgetConversation, reply, warmUp } from "./chat.ts";
import { config, LOCAL_HOST } from "./config.ts";
import {
  createConversation,
  deleteConversation,
  deleteMemory,
  getConversation,
  getMessages,
  hasMessages,
  latestConversation,
  listConversations,
  listMemories,
} from "./db.ts";
import { buildLineIndex } from "./lines.ts";
import { runInBackground } from "./memory.ts";
import { shutdown } from "./shutdown.ts";
import { pruneThumbnails, thumbnailFor } from "./thumbs.ts";

// Stop at startup if the character is missing.
const { name } = loadCharacter();
pruneThumbnails(listBackgrounds());

const app = new Hono();

// Stops DNS rebinding, where a website points its own name at this server to read it.
app.use(async (c, next) => {
  if (!LOCAL_HOST.test(c.req.header("Host") ?? "")) return c.text("Forbidden", 403);
  await next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

/** Parses a positive whole number from the URL, or returns undefined. */
const idParam = (raw: string | undefined) => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

app.get("/api/character", (c) => {
  const character = loadCharacter();
  return c.json<CharacterInfo>({
    name: character.name,
    sprites: character.sprites,
    defaultExpression: character.fallbackExpression,
    backgrounds: listBackgrounds().map(({ name, url, thumb }) => ({ name, url, thumb })),
    voices: character.voices,
  });
});

app.get("/api/conversations", (c) => c.json<ConversationSummary[]>(listConversations()));

// The conversation from ?id=, or else the latest.
app.get("/api/conversation", (c) => {
  const requested = idParam(c.req.query("id"));
  const conversation = (requested && getConversation(requested)) || latestConversation() || createConversation();
  return c.json<ConversationInfo>({ id: conversation.id, messages: getMessages(conversation.id) });
});

app.post("/api/conversation", (c) => {
  // Reuse the latest conversation if nothing has been said in it yet.
  const latest = latestConversation();
  const conversation = latest && !hasMessages(latest.id) ? latest : createConversation();
  return c.json<ConversationInfo>({ id: conversation.id, messages: [] });
});

app.delete("/api/conversation/:id", (c) => {
  const id = idParam(c.req.param("id"));
  if (!id || !deleteConversation(id)) return c.json({ error: "Conversation not found." }, 404);
  forgetConversation(id);
  return c.json({ ok: true });
});

app.post("/api/conversation/:id/messages", async (c) => {
  // JSON needs a CORS approval we never give, so other websites can't post here.
  if (!c.req.header("Content-Type")?.startsWith("application/json")) {
    return c.json({ error: "Messages must be sent as JSON." }, 415);
  }
  const id = idParam(c.req.param("id"));
  const conversation = id ? getConversation(id) : undefined;
  if (!conversation) return c.json({ error: "Conversation not found." }, 404);

  const body = await c.req.json<{ content?: unknown; background?: unknown }>().catch(() => null);
  const text = typeof body?.content === "string" ? body.content.trim() : "";
  if (!text) return c.json({ error: "Message is empty." }, 400);
  if (text.length > MAX_MESSAGE_LENGTH) {
    return c.json({ error: `Messages can be at most ${MAX_MESSAGE_LENGTH} characters.` }, 413);
  }
  const background = typeof body?.background === "string" ? body.background : undefined;
  if (!claimConversation(conversation.id)) {
    return c.json({ error: "Still replying to your last message." }, 409);
  }

  c.header("Content-Type", "application/x-ndjson");
  return stream(c, async (out) => {
    const abort = new AbortController();
    out.onAbort(() => abort.abort());
    await reply(conversation, text, background, abort.signal, (event) => out.write(JSON.stringify(event) + "\n"));
  });
});

app.get("/api/memories", (c) => c.json<Memory[]>(listMemories()));

app.delete("/api/memories/:id", (c) => {
  const id = idParam(c.req.param("id"));
  if (!id || !deleteMemory(id)) return c.json({ error: "Memory not found." }, 404);
  return c.json({ ok: true });
});

// Browsers only send this header cross-site after a CORS approval, which this server never gives.
app.post("/api/shutdown", (c) => {
  if (c.req.header("X-ChatAK12") !== "shutdown") return c.json({ error: "Missing confirmation header." }, 403);
  // Answer first, then shut down.
  setTimeout(() => void shutdown(), 100);
  return c.json({ ok: true });
});

// Thumbnail URLs carry the image's version, so they can be cached for good.
app.get("/thumbs/:file", async (c) => {
  const background = listBackgrounds().find((bg) => bg.file === c.req.param("file"));
  if (!background) return c.notFound();
  const thumbnail = await thumbnailFor(background);
  return c.body(readFileSync(thumbnail), 200, {
    "Content-Type": "image/webp",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});

/** Files can change while the app runs, so browsers revalidate and unchanged ones get a 304. */
const revalidate =
  (root: string, folder: string): MiddlewareHandler =>
  async (c, next) => {
    let file: string;
    try {
      file = path.resolve(root, `.${decodeURIComponent(c.req.path)}`);
    } catch {
      return next();
    }
    // An encoded "../" must not escape the folder.
    if (!file.startsWith(path.resolve(root, folder) + path.sep)) return next();
    const stats = statSync(file, { throwIfNoEntry: false });
    if (!stats?.isFile()) return next();

    const modified = new Date(Math.floor(stats.mtimeMs / 1000) * 1000);
    const since = Date.parse(c.req.header("If-Modified-Since") ?? "");
    c.header("Cache-Control", "no-cache");
    if (since === modified.getTime()) {
      return c.body(null, 304, { "Last-Modified": modified.toUTCString(), "Cache-Control": "no-cache" });
    }
    await next();
  };

app.use("/sprites/*", revalidate(config.paths.character, "sprites"), serveStatic({ root: config.paths.character }));
app.use(
  "/voices/*",
  revalidate(config.paths.character, "voices"),
  // The static handler doesn't know .ogg, and some browsers won't play octet-stream audio.
  serveStatic({
    root: config.paths.character,
    onFound: (file, c) => {
      if (file.toLowerCase().endsWith(".ogg")) c.header("Content-Type", "audio/ogg");
    },
  }),
);
app.use("/backgrounds/*", revalidate(".", "backgrounds"), serveStatic({ root: "." }));

// Outside `npm run dev`, the server also serves the built page.
if (existsSync(config.paths.web)) {
  app.use("/*", serveStatic({ root: config.paths.web }));
}

// Listen on this computer only, so the rest of the network can't reach chats or shutdown.
serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.port }, ({ port }) => {
  console.log(`Chatting with ${name} on http://localhost:${port} using ${config.model}`);
  // Preload the model so the first message doesn't wait for it.
  warmUp()
    .then(
      () => console.log("Model loaded and ready."),
      (err) => console.warn("Couldn't preload the model:", err instanceof Error ? err.message : err),
    )
    .then(() => runInBackground(buildLineIndex));
});
