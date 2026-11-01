import path from "node:path";

function num(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isFinite(value) && value >= min) return value;
  console.warn(`Ignoring ${name}=${raw}: not a number of at least ${min}. Using ${fallback}.`);
  return fallback;
}

const character = process.env.CHARACTER ?? "ak12";

export const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

export const config = {
  port: num("SERVER_PORT", 3001),
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  // A Mistral Nemo roleplay finetune; Q5_K_M fits a 12 GB graphics card.
  model: process.env.OLLAMA_MODEL ?? "hf.co/bartowski/TheDrummer_Rocinante-X-12B-v1-GGUF:Q5_K_M",
  // Reloading the model takes ~30s.
  keepAlive: process.env.OLLAMA_KEEP_ALIVE ?? "30m",
  temperature: num("TEMPERATURE", 1, 0),
  // Send the character sheet in the first message, for models trained without system prompts.
  foldSystemPrompt: process.env.FOLD_SYSTEM_PROMPT !== "0",
  numCtx: num("NUM_CTX", 8192),
  // Longest reply, and the room kept free for it in the context window.
  replyTokens: num("REPLY_TOKENS", 1024),
  // Past this many estimated tokens, older messages are folded into the summary.
  historyTokenLimit: num("HISTORY_TOKEN_LIMIT", 3000),
  // Messages never summarized.
  keepRecentMessages: num("KEEP_RECENT_MESSAGES", 10),
  // Finds the character's game lines for each message. Empty turns this off.
  embedModel: process.env.EMBED_MODEL ?? "nomic-embed-text",
  character,
  // Relative to the project root, where the npm scripts run.
  paths: {
    data: "data",
    character: path.join("characters", character),
    backgrounds: "backgrounds",
    web: "dist",
  },
};
