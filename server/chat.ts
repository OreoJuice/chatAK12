import type { ReplyEvent } from "../shared/protocol.ts";
import {
  describeScene,
  listBackgrounds,
  loadCharacter,
  recalledLinesPrompt,
  replyReminder,
  resolveExpression,
  systemPrompt,
} from "./character.ts";
import { config } from "./config.ts";
import { addMessage, latestConversation, type Conversation } from "./db.ts";
import { recallLines } from "./lines.ts";
import {
  buildHistory,
  estimateTokens,
  maybeSummarize,
  memoriesForPrompt,
  rememberFrom,
  runInBackground,
} from "./memory.ts";
import { complete, streamChat, type ChatMessage } from "./ollama.ts";
import { parseReply } from "./reply.ts";

const replying = new Set<number>();
// Each conversation's last background, to notice when the scene moves.
const lastScene = new Map<number, string>();

/** Reserves a conversation for one reply; false if it's taken. `reply` releases it. */
export function claimConversation(conversationId: number): boolean {
  if (replying.has(conversationId)) return false;
  replying.add(conversationId);
  return true;
}

/** Where the conversation is, if the client sent a background that exists. */
function sceneFor(conversationId: number, background: string | undefined) {
  if (!background || !listBackgrounds().some((bg) => bg.name === background)) return undefined;
  const previous = lastScene.get(conversationId);
  lastScene.set(conversationId, background);
  return {
    now: describeScene(background),
    before: previous && previous !== background ? describeScene(previous) : undefined,
  };
}

/**
 * Adds the sheet, reminder, and recalled lines to the conversation. Folded, the sheet goes in the
 * first message, which stays cached, and the reminder with the latest. Recalled lines change every
 * turn, so they always go with the latest. Mistral templates need the user to speak first, so a
 * history opening with a reply gets the sheet as its own turn.
 */
function withInstructions(sheet: string, reminder: string, history: ChatMessage[], recalled = ""): ChatMessage[] {
  const messages = history.map((message) => ({ ...message }));
  const last = messages.at(-1);
  if (!config.foldSystemPrompt) {
    if (recalled && last?.role === "user") last.content = `${recalled}\n\n${last.content}`;
    return [{ role: "system", content: `${sheet}\n\n${reminder}` }, ...messages];
  }

  if (last?.role === "user") last.content = [recalled, reminder, last.content].filter(Boolean).join("\n\n");
  const first = messages[0];
  if (first?.role === "user") first.content = `${sheet}\n\n---\n\n${first.content}`;
  else messages.unshift({ role: "user", content: sheet });
  return messages;
}

/** Loads the model and caches the character sheet, with a one-token request shaped like a real one. */
export async function warmUp(): Promise<void> {
  const character = loadCharacter();
  const sheet = systemPrompt(character, {
    summary: latestConversation()?.summary ?? "",
    memories: memoriesForPrompt(),
  });
  await complete(withInstructions(sheet, replyReminder(character), [{ role: "user", content: "..." }]), {
    maxTokens: 1,
  });
}

/**
 * Saves the message, streams the reply through `send`, and saves what was generated, even if the
 * reply fails partway. Call `claimConversation` first.
 */
export async function reply(
  conversation: Conversation,
  text: string,
  background: string | undefined,
  signal: AbortSignal,
  send: (event: ReplyEvent) => Promise<unknown>,
): Promise<void> {
  try {
    addMessage(conversation.id, "user", text, null);

    const character = loadCharacter();
    const sheet = systemPrompt(character, {
      summary: conversation.summary,
      memories: memoriesForPrompt(),
      scene: sceneFor(conversation.id, background),
    });
    const reminder = replyReminder(character);
    const recalled = recalledLinesPrompt(await recallLines(text, signal));
    const history = buildHistory(
      conversation,
      estimateTokens(sheet) + estimateTokens(reminder) + estimateTokens(recalled),
    );
    const messages = withInstructions(sheet, reminder, history, recalled);

    let expression = character.fallbackExpression;
    let content = "";
    let failed = false;
    try {
      const parts = parseReply(
        streamChat(messages, signal),
        character.expressions,
        character.fallbackExpression,
        (tag) => resolveExpression(character, tag),
      );
      for await (const part of parts) {
        if (part.type === "expression") expression = part.value;
        else content += part.value;
        await send(part);
      }
    } catch (err) {
      failed = true;
      if (!signal.aborted) {
        console.error("Reply failed:", err);
        await send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }

    content = content.trim();
    if (content) {
      const id = addMessage(conversation.id, "assistant", content, expression);
      if (!signal.aborted) await send({ type: "done", id, content });
    } else if (!failed && !signal.aborted) {
      await send({ type: "error", message: `${character.name} didn't say anything. Try sending that again.` });
    }
  } finally {
    replying.delete(conversation.id);
  }
  runInBackground(() => maybeSummarize(conversation.id));
  runInBackground(() => rememberFrom(text));
}

/** Forgets per-conversation state for a deleted conversation. */
export function forgetConversation(conversationId: number) {
  lastScene.delete(conversationId);
}
