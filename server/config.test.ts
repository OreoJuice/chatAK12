import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCAL_HOST } from "./config.ts";

test("only local host names pass", () => {
  for (const host of ["localhost", "localhost:3001", "127.0.0.1:5173"]) assert.ok(LOCAL_HOST.test(host), host);
  for (const host of ["", "evil.example", "localhost.evil.example", "127.0.0.1.evil.example:3001"]) {
    assert.ok(!LOCAL_HOST.test(host), host);
  }
});
