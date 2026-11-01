import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import { errorText, type ConversationSummary, type Memory } from "./api";

// The server stores UTC as "YYYY-MM-DD HH:MM:SS".
const formatTime = (utc: string) =>
  new Date(`${utc.replace(" ", "T")}Z`).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

interface Props {
  currentId: number | null;
  busy: boolean;
  /** Refreshes the list when the open conversation gains messages. */
  messageCount: number;
  onOpen: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => Promise<void>;
}

/** Past conversations to reopen or delete, and what she remembers about the Commander. */
export function ChatsPanel({ currentId, busy, messageCount, onOpen, onNew, onDelete }: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The conversation awaiting DELETE or CANCEL. Embedded browsers often block window.confirm.
  const [confirming, setConfirming] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [loadedConversations, loadedMemories] = await Promise.all([api.listConversations(), api.listMemories()]);
      setConversations(loadedConversations);
      setMemories(loadedMemories);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, currentId, messageCount]);

  const removeConversation = async (id: number) => {
    setConfirming(null);
    await onDelete(id);
    await refresh();
  };

  const removeMemory = async (memory: Memory) => {
    try {
      await api.deleteMemory(memory.id);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="panel-body">
      {error && <p className="panel-error">{error}</p>}

      <p className="section-label">CONVERSATIONS</p>
      {conversations === null ? (
        <p className="hint">Loading…</p>
      ) : (
        <ul className="rows">
          {conversations.map((conversation) => {
            const current = conversation.id === currentId;
            const preview = conversation.preview || "(nothing said yet)";
            if (confirming === conversation.id) {
              return (
                <li key={conversation.id} className="row confirming">
                  <span className="row-main static">
                    <span className="row-title">Delete this conversation? This can't be undone.</span>
                    <span className="row-meta">{preview}</span>
                  </span>
                  <span className="row-actions">
                    <button
                      className="row-confirm"
                      onClick={() => void removeConversation(conversation.id)}
                      disabled={busy}
                      autoFocus
                    >
                      DELETE
                    </button>
                    <button className="text-button" onClick={() => setConfirming(null)}>
                      CANCEL
                    </button>
                  </span>
                </li>
              );
            }
            return (
              <li key={conversation.id} className={current ? "row current" : "row"}>
                <button
                  className="row-main"
                  onClick={() => onOpen(conversation.id)}
                  disabled={busy || current}
                  aria-current={current || undefined}
                >
                  <span className="row-title">{preview}</span>
                  <span className="row-meta">
                    {formatTime(conversation.updatedAt)} · {conversation.messageCount} lines
                    {current && " · open"}
                  </span>
                </button>
                <button
                  className="row-delete"
                  onClick={() => setConfirming(conversation.id)}
                  disabled={busy}
                  aria-label="Delete conversation"
                  title="Delete"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button className="wide-button" onClick={onNew} disabled={busy}>
        NEW CONVERSATION
      </button>

      <p className="section-label memory-label">MEMORY</p>
      <p className="hint small">What she remembers about you across conversations. Delete anything that's wrong.</p>
      {memories === null ? null : memories.length === 0 ? (
        <p className="hint">Nothing yet. Tell her about yourself.</p>
      ) : (
        <ul className="rows">
          {memories.map((memory) => (
            <li key={memory.id} className="row">
              <span className="row-main static">
                <span className="row-title">{memory.content}</span>
                <span className="row-meta">{formatTime(memory.createdAt)}</span>
              </span>
              <button
                className="row-delete"
                onClick={() => void removeMemory(memory)}
                aria-label="Forget this"
                title="Forget"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
