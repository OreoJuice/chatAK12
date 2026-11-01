import type { ReactNode } from "react";

// **bold** first so its asterisks aren't read as two italics.
const EMPHASIS = /\*\*(.+?)\*\*|\*(.+?)\*/g;

/** Renders the model's light Markdown: **bold** and *italic* (used for actions). */
export function Formatted({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(EMPHASIS)) {
    parts.push(text.slice(last, match.index));
    parts.push(match[1] ? <strong key={match.index}>{match[1]}</strong> : <em key={match.index}>{match[2]}</em>);
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
