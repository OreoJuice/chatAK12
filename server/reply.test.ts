import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReply } from "./reply.ts";

async function parse(tokens: string[], resolve: (tag: string) => string | undefined = () => undefined) {
  async function* stream() {
    yield* tokens;
  }
  const parts = [];
  for await (const part of parseReply(stream(), ["default", "serious"], "default", resolve)) parts.push(part);
  return parts;
}

const text = (value: string) => ({ type: "text", value });
const expression = (value: string) => ({ type: "expression", value });

test("reads a tag split across tokens", async () => {
  assert.deepEqual(await parse(["[", "ser", "ious]", " Move."]), [expression("serious"), text("Move.")]);
});

test("removes known tags mid-reply and keeps other brackets", async () => {
  assert.deepEqual(await parse(["[default] Hi [serious] [sic] now."]), [
    expression("default"),
    text("Hi "),
    expression("serious"),
    text("[sic]"),
    text(" now."),
  ]);
});

test("resolves an unknown opening tag and never shows it", async () => {
  assert.deepEqual(await parse(["[grim look] Hm."], () => "serious"), [expression("serious"), text("Hm.")]);
  assert.deepEqual(await parse(["[smug] Hm."]), [expression("default"), text("Hm.")]);
});

test("starts with the fallback when there's no tag", async () => {
  assert.deepEqual(await parse(["Hello."]), [expression("default"), text("Hello.")]);
  assert.deepEqual(await parse([]), [expression("default")]);
});

test("skips a thinking block split across tokens", async () => {
  assert.deepEqual(await parse(["<th", "ink>plan</think>", "[serious] Go."]), [expression("serious"), text("Go.")]);
});

test("treats an unclosed tag as text", async () => {
  assert.deepEqual(await parse(["[default] a [b"]), [expression("default"), text("a "), text("[b")]);
});
