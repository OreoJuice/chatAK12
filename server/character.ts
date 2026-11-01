import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Asset } from "../shared/protocol.ts";
import { config } from "./config.ts";

interface Character {
  name: string;
  persona: string;
  sprites: Asset[];
  /** Sprite names, lowercased; the model picks from these. */
  expressions: string[];
  /** Used when the model doesn't pick an expression. */
  fallbackExpression: string;
  /** What each expression's sprite looks like, from the optional expressions.json. */
  notes: Record<string, string>;
  /** Voice clip URLs for each expression, from the optional voices.json. */
  voices: Record<string, string[]>;
}

export interface Background extends Asset {
  file: string;
  /** The file's modification time, used to version its thumbnail. */
  modified: number;
}

const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

// Folders are re-read per request, so each problem is only reported once.
const warned = new Set<string>();

function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/** Image files in a folder. Names must be unique, so the first of any duplicates wins. */
function listImageFiles(dir: string): { name: string; file: string }[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => IMAGE.test(file)).sort();
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const images: { name: string; file: string }[] = [];
  for (const file of files) {
    const name = path.parse(file).name;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      warnOnce(`Ignoring ${path.join(dir, file)}: another image in that folder is already named "${name}".`);
      continue;
    }
    seen.add(key);
    images.push({ name, file });
  }
  return images;
}

/** Reads an optional JSON file; a missing or broken one counts as empty. */
function readJson(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return {};
  }
  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (err) {
    warnOnce(`Ignoring ${file}, it isn't valid JSON: ${(err as Error).message}`);
    return {};
  }
}

const voicesDir = () => path.join(config.paths.character, "voices");

/** Existing voice clips per expression, from file -> line objects. */
function readVoices(): Record<string, string[]> {
  let available: Set<string>;
  try {
    available = new Set(readdirSync(voicesDir()));
  } catch {
    return {};
  }
  const voices: Record<string, string[]> = {};
  for (const [expression, entry] of Object.entries(readJson(path.join(config.paths.character, "voices.json")))) {
    if (expression.startsWith("_")) continue;
    const urls = Object.keys(entry ?? {})
      .filter((file) => available.has(file))
      .map((file) => `/voices/${encodeURIComponent(file)}`);
    if (urls.length > 0) voices[expression.toLowerCase()] = urls;
  }
  return voices;
}

// Read on each call, so edits apply without a restart.
export function loadCharacter(): Character {
  const personaPath = path.join(config.paths.character, "persona.md");
  let persona: string;
  try {
    persona = readFileSync(personaPath, "utf8").trim();
  } catch {
    throw new Error(`Character "${config.character}" has no ${personaPath}.`);
  }

  const sprites = listImageFiles(path.join(config.paths.character, "sprites")).map(({ name, file }) => ({
    name: name.toLowerCase(),
    url: `/sprites/${encodeURIComponent(file)}`,
  }));
  const expressions = sprites.map((sprite) => sprite.name);
  const notes = Object.fromEntries(
    Object.entries(readJson(path.join(config.paths.character, "expressions.json"))).map(([name, note]) => [
      name.toLowerCase(),
      String(note),
    ]),
  );

  return {
    name: persona.match(/^#\s+(.+)$/m)?.[1].trim() ?? config.character,
    persona,
    sprites,
    expressions,
    fallbackExpression:
      ["default", "neutral"].find((name) => expressions.includes(name)) ?? expressions[0] ?? "default",
    notes,
    voices: readVoices(),
  };
}

export function listBackgrounds(): Background[] {
  return listImageFiles(config.paths.backgrounds).map(({ name, file }) => {
    const modified = Math.round(statSync(path.join(config.paths.backgrounds, file)).mtimeMs);
    const encoded = encodeURIComponent(file);
    return {
      name,
      file,
      modified,
      url: `/backgrounds/${encoded}`,
      // Versioned by modification time, so a thumbnail can be cached forever and still update.
      thumb: `/thumbs/${encoded}?v=${modified}`,
    };
  });
}

/** What a background shows, from backgrounds/scenes.json, or a readable version of its name. */
export function describeScene(background: string): string {
  const scenes = readJson(path.join(config.paths.backgrounds, "scenes.json"));
  const described = scenes[background];
  if (typeof described === "string" && described.trim()) return described.trim();
  return background
    .replace(/^BG[-_ ]?/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
}

interface PromptContext {
  summary: string;
  memories: string[];
  /** Where they are now, and where they were last time if that changed. */
  scene?: { now: string; before?: string };
}

// What changes most goes last, so Ollama can reuse its cached prefix.
export function systemPrompt(character: Character, { summary, memories, scene }: PromptContext): string {
  const parts = [character.persona];
  if (character.expressions.length > 0) {
    parts.push(
      [
        "## Reply format",
        "Your face is shown on screen. Begin every reply with a tag for your facial expression, one of:",
        ...character.expressions.map((name) =>
          character.notes[name] ? `- [${name}]: ${character.notes[name]}` : `- [${name}]`,
        ),
        "If your expression changes partway through a reply, put the new tag right before the sentence where it changes.",
        "Only use these tags, and never mention them.",
        "After the tag, reply in one to three sentences.",
      ].join("\n"),
    );
  } else {
    parts.push("Reply in one to three sentences.");
  }
  if (memories.length > 0) {
    parts.push(
      [
        "## What you remember about the Commander",
        "From earlier conversations. Bring these up naturally when they're relevant; don't recite them.",
        ...memories.map((memory) => `- ${memory}`),
      ].join("\n"),
    );
  }
  if (summary) {
    parts.push(`## Earlier in this conversation\n${summary}`);
  }
  if (scene) {
    const lines = [`## Where you are\nYou and the Commander are at ${scene.now}.`];
    if (scene.before) lines.push(`You were just at ${scene.before}, and have only now arrived here.`);
    lines.push("Let the setting color your replies when it fits, without describing it every time.");
    parts.push(lines.join(" "));
  }
  return parts.join("\n\n");
}

/** The rules models drift from, placed near the end, which roleplay finetunes weigh most. */
export function replyReminder(character: Character): string {
  const tags = character.expressions.map((name) => `[${name}]`).join(" ");
  return [
    "## Remember",
    tags ? `- Start with exactly one of these tags and no other: ${tags}` : "",
    `- Then reply in one to three sentences, speaking as ${character.name}.`,
    "- Any action goes in brief *asterisks* about yourself in the third person; never narrate what \"you\" (the Commander) do.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The character's game lines related to the latest message. */
export function recalledLinesPrompt(lines: string[]): string {
  if (lines.length === 0) return "";
  return [
    "## Things you've said before",
    "Lines of yours from the past that relate to this. Draw on them for your voice and what you know, but answer in new words: don't repeat them, and leave out any that don't fit.",
    ...lines.map((line) => `- "${line}"`),
  ].join("\n");
}

const stem = (word: string) => word.toLowerCase().slice(0, 4);
const words = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? [];

/** The expression a made-up tag meant: an exact name, or else the most shared words. */
export function resolveExpression(character: Character, tag: string): string | undefined {
  const tagWords = words(tag);
  const exact = character.expressions.find((name) => tagWords.includes(name));
  if (exact) return exact;
  let best: string | undefined;
  let bestScore = 0;
  for (const name of character.expressions) {
    const known = new Set(words(`${name} ${character.notes[name] ?? ""}`).filter((w) => w.length > 3).map(stem));
    const score = tagWords.filter((w) => w.length > 3 && known.has(stem(w))).length;
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}
