import type { Message } from "../shared/protocol.ts";
import { loadCharacter } from "./character.ts";
import { config } from "./config.ts";
import { addMemory, getConversation, getMessages, listMemories, setSummary, type Conversation } from "./db.ts";
import { complete, type ChatMessage } from "./ollama.ts";

// Background jobs run one at a time, so they don't compete with each other for the model.
let queue: Promise<void> = Promise.resolve();

export function runInBackground(job: () => Promise<void>) {
  queue = queue.then(job).catch((err) => console.error("Background job failed:", err));
}

// Rough, but close enough for English and needs no tokenizer.
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

function toChatMessage(message: Message): ChatMessage {
  if (message.role === "user") return { role: "user", content: message.content };
  // Keep the tag in history so the model sees its own format and sticks to it.
  const tag = message.expression ? `[${message.expression}] ` : "";
  return { role: "assistant", content: tag + message.content };
}

/** Unsummarized messages, oldest first. The oldest are dropped if they'd overflow the context window. */
export function buildHistory(conversation: Conversation, systemTokens: number): ChatMessage[] {
  const messages = getMessages(conversation.id, conversation.summarized_through).map(toChatMessage);
  let budget = config.numCtx - config.replyTokens - systemTokens;
  let start = messages.length;
  while (start > 0) {
    budget -= estimateTokens(messages[start - 1].content);
    if (budget < 0 && start < messages.length) break;
    start--;
  }
  return messages.slice(start);
}

/** Folds older messages into the running summary once unsummarized history gets too long. */
export async function maybeSummarize(conversationId: number): Promise<void> {
  const conversation = getConversation(conversationId);
  if (!conversation) return;

  const messages = getMessages(conversationId, conversation.summarized_through);
  const tokens = messages.reduce((total, message) => total + estimateTokens(message.content), 0);
  if (tokens <= config.historyTokenLimit || messages.length <= config.keepRecentMessages) return;

  // At most half a context window at a time; the rest is folded after the next reply.
  const toFold: Message[] = [];
  let foldTokens = 0;
  for (const message of messages.slice(0, messages.length - config.keepRecentMessages)) {
    foldTokens += estimateTokens(message.content);
    if (toFold.length > 0 && foldTokens > config.numCtx / 2) break;
    toFold.push(message);
  }

  const { name } = loadCharacter();
  const transcript = toFold
    .map((message) => `${message.role === "user" ? "User" : name}: ${message.content}`)
    .join("\n\n");
  const summary = await complete([
    {
      role: "system",
      content: [
        `You keep a running summary of a roleplay conversation between the user and ${name}.`,
        "Merge the existing summary and the new messages into one updated summary.",
        "Keep names, facts the user shared about themselves, promises, ongoing plans, how the relationship has developed, and the current mood.",
        "Write compact third-person prose in the past tense, under 300 words. Output only the summary.",
      ].join(" "),
    },
    {
      role: "user",
      content: `Existing summary:\n${conversation.summary || "(none yet)"}\n\nNew messages:\n${transcript}`,
    },
  ]);
  if (summary) setSummary(conversationId, summary, toFold.at(-1)!.id);
}

const MAX_MEMORIES_IN_PROMPT = 40;
// The earliest facts, often the name, stay in alongside the newest.
const OLDEST_MEMORIES_KEPT = 10;
const MAX_NEW_FACTS = 5;

export function memoriesForPrompt(): string[] {
  const all = listMemories().map((memory) => memory.content);
  if (all.length <= MAX_MEMORIES_IN_PROMPT) return all;
  return [...all.slice(0, OLDEST_MEMORIES_KEPT), ...all.slice(OLDEST_MEMORIES_KEPT - MAX_MEMORIES_IN_PROMPT)];
}

const factsSchema = {
  type: "object",
  properties: { facts: { type: "array", items: { type: "string" } } },
  required: ["facts"],
};

// Facts about the user use first-person words: "my cat", "call me Alex".
const ABOUT_ME = /\b(i|i'm|im|i've|i'd|i'll|me|my|mine|myself|we|we're|our|ours)\b/i;

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Saves lasting facts about the user from their latest message. */
export async function rememberFrom(userText: string): Promise<void> {
  // Skip the model for messages too short for a fact, or not about the user ("Enemy contact!").
  if (userText.trim().split(/\s+/).length < 3 || !ABOUT_ME.test(userText)) return;

  const { name } = loadCharacter();
  const known = listMemories().map((memory) => memory.content);
  const knownList = memoriesForPrompt().map((fact) => `- ${fact}`).join("\n") || "(nothing yet)";
  const raw = await complete(
    [
      {
        role: "system",
        content: [
          `You pick out lasting facts about the user of a chat with ${name}, so ${name} can remember them in future conversations.`,
          "The user is called \"the Commander\".",
          "Only include things the Commander says about their real self that will still be true next week: their name, job, relationships, pets, lasting likes and dislikes, and plans.",
          "Never include the current situation or scene (combat, alerts, where they are, what they're doing or feeling right now), events in the roleplay, gifts, games, or anything about " +
            `${name}. Also skip greetings, questions, small talk, and anything already known.`,
          "Good: \"The Commander has a cat named Mochi.\" Bad: \"The Commander is in combat.\" (a passing situation).",
          "Write each fact as one short sentence starting with \"The Commander\".",
          "Answer as JSON: {\"facts\": [...]}, with an empty list if there is nothing new.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Already known:\n${knownList}\n\nThe Commander's latest message:\n${userText}`,
      },
    ],
    { format: factsSchema, temperature: 0.2 },
  );

  let facts: unknown;
  try {
    facts = (JSON.parse(raw) as { facts?: unknown }).facts;
  } catch {
    return;
  }
  if (!Array.isArray(facts)) return;

  const seen = new Set(known.map(normalize));
  for (const fact of facts.slice(0, MAX_NEW_FACTS)) {
    if (typeof fact !== "string") continue;
    const text = fact.replace(/\s+/g, " ").trim().slice(0, 200);
    if (text.length < 8 || seen.has(normalize(text))) continue;
    seen.add(normalize(text));
    addMemory(text);
  }
}
