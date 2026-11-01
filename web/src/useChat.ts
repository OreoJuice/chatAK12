import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { errorText, type CharacterInfo, type ConversationInfo, type Message } from "./api";
import { readSetting, writeSetting } from "./storage";

const RETRY_MS = 2000;
// The open conversation, so reloading comes back to it.
const CONVERSATION_KEY = "conversation";

interface Options {
  /** Called when her expression changes during a reply. */
  onExpressionChange: (expression: string, firstInReply: boolean) => void;
}

/** The character, the open conversation, and sending messages with streamed replies. */
export function useChat({ onExpressionChange }: Options) {
  const [character, setCharacter] = useState<CharacterInfo | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // The reply being streamed in; null when idle.
  const [streaming, setStreaming] = useState<string | null>(null);
  const [expression, setExpression] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs, since stream callbacks would otherwise see the values from when the send started.
  const shownExpression = useRef<string | null>(null);
  const expressionListener = useRef(onExpressionChange);
  expressionListener.current = onExpressionChange;

  const showExpression = useCallback((next: string | null) => {
    shownExpression.current = next;
    setExpression(next);
  }, []);

  const show = useCallback(
    (conversation: ConversationInfo) => {
      setConversationId(conversation.id);
      writeSetting(CONVERSATION_KEY, String(conversation.id));
      setMessages(conversation.messages);
      showExpression(conversation.messages.findLast((m) => m.role === "assistant")?.expression ?? null);
    },
    [showExpression],
  );

  const loadConversation = useCallback(
    async (id?: number | null) => show(await api.getConversation(id)),
    [show],
  );

  // Keep retrying while the server is starting up or down.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const loaded = await api.getCharacter();
        if (cancelled) return;
        setCharacter(loaded);
        // Warm the cache so expression changes don't flash.
        for (const sprite of loaded.sprites) new Image().src = sprite.url;
        await loadConversation(Number(readSetting(CONVERSATION_KEY)) || null);
        if (!cancelled) setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(`Can't reach the server (${errorText(err)}). Retrying…`);
        timer = window.setTimeout(load, RETRY_MS);
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadConversation]);

  /** Sends a message and streams the reply. False if the server turned it away unsaved. */
  const send = async (content: string, background?: string): Promise<boolean> => {
    if (conversationId === null) return false;

    const pendingId = -Date.now();
    setError(null);
    setMessages((prev) => [...prev, { id: pendingId, role: "user", content, expression: null }]);
    setStreaming("");

    let reply = "";
    let replyExpression: string | null = null;
    let changedThisReply = false;
    let saved = false;
    let answered = false;
    try {
      await api.sendMessage(conversationId, content, background, (event) => {
        answered = true;
        switch (event.type) {
          case "expression": {
            replyExpression = event.value;
            const before = shownExpression.current ?? character?.defaultExpression;
            showExpression(event.value);
            if (event.value !== before) {
              expressionListener.current(event.value, !changedThisReply);
              changedThisReply = true;
            }
            break;
          }
          case "text":
            reply += event.value;
            setStreaming(reply.trimStart());
            break;
          case "done":
            saved = true;
            setMessages((prev) => [
              ...prev,
              { id: event.id, role: "assistant", content: event.content, expression: replyExpression },
            ]);
            break;
          case "error":
            setError(event.message);
            break;
        }
      });
    } catch (err) {
      setError(errorText(err));
      if (!answered) {
        // Turned away or never delivered: take the message back out of the log.
        setMessages((prev) => prev.filter((m) => m.id !== pendingId));
        // The conversation is gone: pick up the latest one.
        if (err instanceof api.ApiError && err.status === 404) {
          await loadConversation().catch(() => undefined);
          setError("That conversation no longer exists, so you're back in your latest one. Send your message again.");
        }
        return false;
      }
    } finally {
      // If the connection dropped mid-reply, keep what arrived.
      const partial = reply.trim();
      if (!saved && partial) {
        setMessages((prev) => [
          ...prev,
          { id: pendingId - 1, role: "assistant", content: partial, expression: replyExpression },
        ]);
      }
      setStreaming(null);
    }
    return true;
  };

  const guarded = (action: () => Promise<void>) => async () => {
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const startOver = guarded(async () => show(await api.newConversation()));

  const open = (id: number) => guarded(() => loadConversation(id))();

  /** Deletes a conversation; if it's the open one, moves to the latest that's left. */
  const remove = (id: number) =>
    guarded(async () => {
      await api.deleteConversation(id);
      if (id === conversationId) await loadConversation();
    })();

  return { character, conversationId, messages, streaming, expression, error, send, startOver, open, remove };
}
