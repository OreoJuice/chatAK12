import assert from "node:assert/strict";
import { test } from "node:test";
import { readJsonLines } from "../shared/jsonLines.ts";

const stream = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

async function read(chunks: Uint8Array[]) {
  const values = [];
  for await (const value of readJsonLines(stream(chunks))) values.push(value);
  return values;
}

test("joins lines and characters split across chunks", async () => {
  const bytes = new TextEncoder().encode("{\"a\":\"é\"}\n\n{\"b\":2}\n");
  const middle = bytes.indexOf(0xc3) + 1; // Inside the two bytes of "é".
  assert.deepEqual(await read([bytes.slice(0, middle), bytes.slice(middle)]), [{ a: "é" }, { b: 2 }]);
});

test("closes the stream when the reader stops early", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) => controller.enqueue(new TextEncoder().encode("{}\n")),
    cancel: () => {
      cancelled = true;
    },
  });
  for await (const _ of readJsonLines(body)) break;
  assert.ok(cancelled);
});
