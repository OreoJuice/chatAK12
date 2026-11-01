import { spawnSync } from "node:child_process";
import { unloadModel } from "./ollama.ts";

// Set by the launcher when it started Ollama; an Ollama that was already running is left alone.
const stopOllamaOnExit = process.env.CHATAK12_STOP_OLLAMA === "1";

let shuttingDown = false;

function stopOllama() {
  const result =
    process.platform === "win32"
      ? spawnSync("taskkill", ["/F", "/IM", "ollama app.exe", "/IM", "ollama.exe"], { stdio: "ignore" })
      : spawnSync("pkill", ["-x", "ollama"], { stdio: "ignore" });
  console.log(result.status === 0 ? "Closed Ollama." : "Couldn't close Ollama.");
}

/** Frees the model, closes Ollama if the launcher started it, and stops the server. */
export async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Shutting down...");

  try {
    await unloadModel();
    console.log("Unloaded the model.");
  } catch (err) {
    console.warn("Couldn't unload the model:", err instanceof Error ? err.message : err);
  }
  if (stopOllamaOnExit) stopOllama();

  // Under `npm run dev`, stop the watcher too; `concurrently` then stops Vite.
  if (process.env.WATCH_REPORT_DEPENDENCIES) {
    try {
      process.kill(process.ppid);
    } catch {
      // Already gone.
    }
  }
  // shortcut: Node crashes on Windows if it exits right after the unload, remove once the cause is known.
  await new Promise((resolve) => setTimeout(resolve, 500));
  process.exit(0);
}
