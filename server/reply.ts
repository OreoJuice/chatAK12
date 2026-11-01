import type { ReplyEvent } from "../shared/protocol.ts";

type ReplyPart = Extract<ReplyEvent, { type: "expression" | "text" }>;

// An unclosed `[` becomes plain text after this many characters. Opening tags may describe the face.
const MAX_TAG_LENGTH = 32;
const MAX_OPENING_TAG_LENGTH = 80;

/**
 * Turns the model's tokens into text and expression changes, always starting with an expression.
 * Known tags are removed anywhere; an unknown opening tag goes through `resolve`. A leading
 * `<think>` block is skipped.
 */
export async function* parseReply(
  tokens: AsyncIterable<string>,
  expressions: string[],
  fallback: string,
  resolve: (tag: string) => string | undefined,
): AsyncGenerator<ReplyPart> {
  let buffer = "";
  let thinkingChecked = false;
  let expressed = false;
  // Drop whitespace at the start of the reply and right after a tag.
  let skipSpace = true;

  function* text(value: string): Generator<ReplyPart> {
    if (skipSpace) value = value.trimStart();
    if (!value) return;
    skipSpace = false;
    if (!expressed) {
      expressed = true;
      yield { type: "expression", value: fallback };
    }
    yield { type: "text", value };
  }

  // Emits what can be decided now, leaving a possibly unfinished tag in `buffer`.
  function* drain(final: boolean): Generator<ReplyPart> {
    if (!thinkingChecked) {
      const head = buffer.trimStart();
      if (head.startsWith("<think>")) {
        const end = head.indexOf("</think>");
        if (end < 0 && !final) return;
        buffer = end < 0 ? "" : head.slice(end + "</think>".length);
      } else if (!final && "<think>".startsWith(head)) {
        return;
      }
      thinkingChecked = true;
    }

    for (;;) {
      const open = buffer.indexOf("[");
      if (open < 0) {
        yield* text(buffer);
        buffer = "";
        return;
      }
      yield* text(buffer.slice(0, open));
      buffer = buffer.slice(open);

      // Nothing has been said yet, so this tag opens the reply.
      const opening = !expressed;
      const close = buffer.indexOf("]");
      if (close < 0) {
        if (!final && buffer.length < (opening ? MAX_OPENING_TAG_LENGTH : MAX_TAG_LENGTH)) return;
        yield* text(buffer);
        buffer = "";
        return;
      }

      const tag = buffer.slice(0, close + 1);
      buffer = buffer.slice(close + 1);
      const name = tag.slice(1, -1).trim().toLowerCase();
      const expression = expressions.includes(name) ? name : opening ? (resolve(name) ?? fallback) : undefined;
      if (expression) {
        expressed = true;
        skipSpace = true;
        yield { type: "expression", value: expression };
      } else {
        yield* text(tag);
      }
    }
  }

  for await (const token of tokens) {
    buffer += token;
    yield* drain(false);
  }
  yield* drain(true);
  if (!expressed) yield { type: "expression", value: fallback };
}
