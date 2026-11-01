// Types and limits shared by the server and the web app.

export const MAX_MESSAGE_LENGTH = 4000;

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  expression: string | null;
}

export interface Asset {
  name: string;
  url: string;
  /** A small preview image, for backgrounds. */
  thumb?: string;
}

export interface CharacterInfo {
  name: string;
  sprites: Asset[];
  defaultExpression: string;
  backgrounds: Asset[];
  /** Voice clip URLs for each expression; an expression may have none. */
  voices: Record<string, string[]>;
}

export interface ConversationInfo {
  id: number;
  messages: Message[];
}

/** One row in the conversation list. Timestamps are UTC, as "YYYY-MM-DD HH:MM:SS". */
export interface ConversationSummary {
  id: number;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
  /** The start of the first thing the user said. */
  preview: string;
}

/** Something she remembers about the user across conversations. */
export interface Memory {
  id: number;
  content: string;
  createdAt: string;
}

/** A reply's newline-delimited JSON: an `expression`, then `text` and more `expression`s, then `done`. */
export type ReplyEvent =
  | { type: "expression"; value: string }
  | { type: "text"; value: string }
  | { type: "done"; id: number; content: string }
  | { type: "error"; message: string };
