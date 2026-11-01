import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { addLineVectors, lineVectors } from "./db.ts";
import { embed } from "./ollama.ts";

const RECALLED_LINES = 5;
// With nomic-embed-text, related lines score 0.65 to 0.85 and small talk stays under 0.63.
const MIN_SIMILARITY = 0.65;
const BATCH_SIZE = 64;
const RECALL_TIMEOUT_MS = 2000;

// nomic-embed-text expects these prefixes.
const prefixes = /nomic/i.test(config.embedModel)
  ? { line: "search_document: ", query: "search_query: " }
  : { line: "", query: "" };

interface Line {
  text: string;
  vector: Float32Array;
}

let index: Line[] = [];

/** The optional lines.json, a list of the character's lines. */
function readLines(): string[] {
  try {
    return JSON.parse(readFileSync(path.join(config.paths.character, "lines.json"), "utf8"));
  } catch (err) {
    const { code, message } = err as NodeJS.ErrnoException;
    if (code !== "ENOENT") console.warn("Ignoring lines.json:", message);
    return [];
  }
}

/** Scales a vector to length 1, so comparing two is a dot product. */
function normalize(values: number[]): Float32Array {
  const vector = Float32Array.from(values);
  const length = Math.hypot(...vector) || 1;
  for (let i = 0; i < vector.length; i++) vector[i] /= length;
  return vector;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Makes the character's lines searchable, embedding only those not stored yet. */
export async function buildLineIndex(): Promise<void> {
  if (!config.embedModel) return;
  const lines = readLines();
  if (lines.length === 0) return;

  const stored = lineVectors(config.embedModel);
  const missing = lines.filter((line) => !stored.has(line));
  if (missing.length > 0) {
    console.log(`Indexing ${missing.length} of the character's lines with ${config.embedModel}...`);
    try {
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = missing.slice(i, i + BATCH_SIZE);
        const vectors = (await embed(batch.map((line) => prefixes.line + line))).map(normalize);
        const embedded = batch.map((text, j) => ({ text, vector: vectors[j] }));
        addLineVectors(config.embedModel, embedded);
        for (const { text, vector } of embedded) stored.set(text, vector);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `Couldn't index the character's lines, so replies won't draw on them: ${reason}\n` +
          `If the model is missing, run: ollama pull ${config.embedModel}`,
      );
      return;
    }
  }
  index = lines.map((text) => ({ text, vector: stored.get(text)! }));
  console.log(`${index.length} of the character's lines ready to recall.`);
}

/** The lines closest to a message, best first; empty if none match well. */
export async function recallLines(message: string, signal: AbortSignal): Promise<string[]> {
  if (index.length === 0) return [];
  let query: Float32Array;
  try {
    const timeLimit = AbortSignal.any([signal, AbortSignal.timeout(RECALL_TIMEOUT_MS)]);
    const [values] = await embed([prefixes.query + message], timeLimit);
    query = normalize(values);
  } catch (err) {
    if (!signal.aborted) console.warn("Couldn't recall lines:", err instanceof Error ? err.message : err);
    return [];
  }
  return index
    .map((line) => ({ text: line.text, score: dot(query, line.vector) }))
    .filter((line) => line.score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, RECALLED_LINES)
    .map((line) => line.text);
}
