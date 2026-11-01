import { readJsonLines } from "../shared/jsonLines.ts";
import { config } from "./config.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Some model builds reject the `think` flag; the first time that happens we stop sending it.
let sendThinkFlag = true;

interface ChatChunk {
  error?: string;
  message?: { content?: string };
}

interface RequestOptions {
  /** A JSON schema the reply must follow (Ollama's structured outputs). */
  format?: object;
  temperature?: number;
  /** Stop after this many tokens. */
  maxTokens?: number;
}

function request(endpoint: string, body: object, signal?: AbortSignal): Promise<Response> {
  return fetch(`${config.ollamaUrl}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).catch((err) => {
    if (signal?.aborted) throw err;
    throw new Error(`Can't reach Ollama at ${config.ollamaUrl}. Is it running?`, { cause: err });
  });
}

function ollamaError(status: number, text: string): Error {
  let message = text;
  try {
    message = JSON.parse(text).error ?? text;
  } catch {
    // Not JSON; use the raw text.
  }
  return new Error(`Ollama error (${status}): ${message}`);
}

async function post(
  messages: ChatMessage[],
  stream: boolean,
  signal?: AbortSignal,
  options: RequestOptions = {},
): Promise<Response> {
  const { format, temperature = config.temperature, maxTokens = config.replyTokens } = options;
  const body = {
    model: config.model,
    messages,
    stream,
    keep_alive: config.keepAlive,
    ...(sendThinkFlag && { think: false }),
    ...(format && { format }),
    options: { temperature, num_ctx: config.numCtx, num_predict: maxTokens },
  };

  const res = await request("chat", body, signal);
  if (res.ok) return res;

  const text = await res.text();
  if (res.status === 400 && sendThinkFlag && /think/i.test(text)) {
    sendThinkFlag = false;
    return post(messages, stream, signal, options);
  }
  throw ollamaError(res.status, text);
}

/** Streams the reply's text as it's generated. */
export async function* streamChat(messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  const res = await post(messages, true, signal);
  for await (const data of readJsonLines<ChatChunk>(res.body!)) {
    if (data.error) throw new Error(`Ollama error: ${data.error}`);
    if (data.message?.content) yield data.message.content;
  }
}

/** Embeds each text with the embedding model, as vectors of the same length. */
export async function embed(input: string[], signal?: AbortSignal): Promise<number[][]> {
  const res = await request("embed", { model: config.embedModel, input, keep_alive: config.keepAlive }, signal);
  if (!res.ok) throw ollamaError(res.status, await res.text());
  const data = (await res.json()) as { embeddings?: number[][] };
  if (data.embeddings?.length !== input.length) throw new Error("Ollama returned the wrong number of embeddings.");
  return data.embeddings;
}

/** Frees the models' memory now instead of when `keep_alive` runs out. */
export async function unloadModel(): Promise<void> {
  const models = [config.model, config.embedModel].filter(Boolean);
  await Promise.all(
    models.map((model) => request("generate", { model, keep_alive: 0 }, AbortSignal.timeout(5000))),
  );
}

/** Returns the whole reply at once, with any stray thinking block removed. */
export async function complete(messages: ChatMessage[], options?: RequestOptions): Promise<string> {
  const res = await post(messages, false, undefined, options);
  const data = (await res.json()) as { message?: { content?: string } };
  const content: string = data.message?.content ?? "";
  return content.replace(/^\s*<think>[\s\S]*?<\/think>/, "").trim();
}
