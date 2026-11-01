import type {
  CharacterInfo,
  ConversationInfo,
  ConversationSummary,
  Memory,
  ReplyEvent,
} from "../../shared/protocol";
import { readJsonLines } from "../../shared/jsonLines";

export type {
  Asset,
  CharacterInfo,
  ConversationInfo,
  ConversationSummary,
  Memory,
  Message,
} from "../../shared/protocol";

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The server answered with an error status, so the request had no effect. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Throws an ApiError with the server's own error message when it sent one. */
async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  const text = await res.text();
  let message = text || res.statusText;
  try {
    message = JSON.parse(text).error ?? message;
  } catch {
    // Not JSON; use the raw text.
  }
  throw new ApiError(message, res.status);
}

const json = <T>(res: Response) => check(res).then((ok) => ok.json() as Promise<T>);

export const getCharacter = () => fetch("/api/character").then(json<CharacterInfo>);

/** A specific conversation, or the most recently active one if `id` is missing or gone. */
export const getConversation = (id?: number | null) =>
  fetch(id ? `/api/conversation?id=${id}` : "/api/conversation").then(json<ConversationInfo>);

export const newConversation = () => fetch("/api/conversation", { method: "POST" }).then(json<ConversationInfo>);

export const listConversations = () => fetch("/api/conversations").then(json<ConversationSummary[]>);

export const deleteConversation = (id: number) =>
  fetch(`/api/conversation/${id}`, { method: "DELETE" }).then(check);

export const listMemories = () => fetch("/api/memories").then(json<Memory[]>);

export const deleteMemory = (id: number) => fetch(`/api/memories/${id}`, { method: "DELETE" }).then(check);

/** Stops the app. The server checks the header to know the request came from this page. */
export const shutdown = () =>
  fetch("/api/shutdown", { method: "POST", headers: { "X-ChatAK12": "shutdown" } }).then(check);

/** Sends a message and calls `onEvent` for each part of the streamed reply. */
export async function sendMessage(
  conversationId: number,
  content: string,
  background: string | undefined,
  onEvent: (event: ReplyEvent) => void,
) {
  const res = await check(
    await fetch(`/api/conversation/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, background }),
    }),
  );

  for await (const event of readJsonLines<ReplyEvent>(res.body!)) onEvent(event);
}
