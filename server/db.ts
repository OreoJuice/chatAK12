import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConversationSummary, Memory, Message } from "../shared/protocol.ts";
import { config } from "./config.ts";

export interface Conversation {
  id: number;
  summary: string;
  // The last message folded into `summary`.
  summarized_through: number;
}

mkdirSync(config.paths.data, { recursive: true });
const db = new DatabaseSync(path.join(config.paths.data, "chat.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    summary TEXT NOT NULL DEFAULT '',
    summarized_through INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    expression TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id);

  -- Facts about the user, kept across conversations.
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Embeddings of the character's game lines, computed once per model.
  CREATE TABLE IF NOT EXISTS line_vectors (
    model TEXT NOT NULL,
    text TEXT NOT NULL,
    vector BLOB NOT NULL,
    PRIMARY KEY (model, text)
  );
`);

const conversationColumns = "id, summary, summarized_through";
const messageColumns = "id, role, content, expression";
// A conversation's last activity: its newest message, or when it was started if it has none.
const lastActivity =
  "COALESCE((SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.created_at)";

const statements = {
  latestConversation: db.prepare(
    `SELECT ${conversationColumns} FROM conversations c ORDER BY ${lastActivity} DESC, c.id DESC LIMIT 1`,
  ),
  getConversation: db.prepare(`SELECT ${conversationColumns} FROM conversations WHERE id = ?`),
  createConversation: db.prepare(`INSERT INTO conversations DEFAULT VALUES RETURNING ${conversationColumns}`),
  deleteConversation: db.prepare("DELETE FROM conversations WHERE id = ?"),
  listConversations: db.prepare(`
    SELECT
      c.id,
      c.created_at AS startedAt,
      ${lastActivity} AS updatedAt,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount,
      COALESCE(
        (SELECT substr(content, 1, 120) FROM messages m
         WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.id LIMIT 1),
        ''
      ) AS preview
    FROM conversations c
    ORDER BY updatedAt DESC, c.id DESC
  `),
  setSummary: db.prepare("UPDATE conversations SET summary = ?, summarized_through = ? WHERE id = ?"),
  messagesAfter: db.prepare(
    `SELECT ${messageColumns} FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id`,
  ),
  hasMessages: db.prepare("SELECT 1 FROM messages WHERE conversation_id = ? LIMIT 1"),
  addMessage: db.prepare(
    "INSERT INTO messages (conversation_id, role, content, expression) VALUES (?, ?, ?, ?) RETURNING id",
  ),
  listMemories: db.prepare("SELECT id, content, created_at AS createdAt FROM memories ORDER BY id"),
  addMemory: db.prepare("INSERT INTO memories (content) VALUES (?)"),
  deleteMemory: db.prepare("DELETE FROM memories WHERE id = ?"),
  lineVectors: db.prepare("SELECT text, vector FROM line_vectors WHERE model = ?"),
  addLineVector: db.prepare("INSERT OR REPLACE INTO line_vectors (model, text, vector) VALUES (?, ?, ?)"),
};

export const latestConversation = () =>
  statements.latestConversation.get() as Conversation | undefined;

export const getConversation = (id: number) =>
  statements.getConversation.get(id) as Conversation | undefined;

export const createConversation = () => statements.createConversation.get() as unknown as Conversation;

/** Deletes a conversation and its messages. Returns whether it existed. */
export const deleteConversation = (id: number) => statements.deleteConversation.run(id).changes > 0;

export const listConversations = () => statements.listConversations.all() as unknown as ConversationSummary[];

export const setSummary = (id: number, summary: string, summarizedThrough: number) =>
  statements.setSummary.run(summary, summarizedThrough, id);

export const getMessages = (conversationId: number, afterId = 0) =>
  statements.messagesAfter.all(conversationId, afterId) as unknown as Message[];

export const hasMessages = (conversationId: number) => statements.hasMessages.get(conversationId) !== undefined;

export const addMessage = (
  conversationId: number,
  role: Message["role"],
  content: string,
  expression: string | null,
) => (statements.addMessage.get(conversationId, role, content, expression) as { id: number }).id;

export const listMemories = () => statements.listMemories.all() as unknown as Memory[];

export const addMemory = (content: string) => statements.addMemory.run(content);

/** Returns whether the memory existed. */
export const deleteMemory = (id: number) => statements.deleteMemory.run(id).changes > 0;

/** The stored embeddings for a model, by line. */
export function lineVectors(model: string): Map<string, Float32Array> {
  const rows = statements.lineVectors.all(model) as { text: string; vector: Uint8Array }[];
  // Copied, since a Float32Array needs a 4-byte-aligned buffer.
  return new Map(rows.map(({ text, vector }) => [text, new Float32Array(new Uint8Array(vector).buffer)]));
}

export function addLineVectors(model: string, lines: { text: string; vector: Float32Array }[]) {
  db.exec("BEGIN");
  try {
    for (const { text, vector } of lines) {
      statements.addLineVector.run(model, text, new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
