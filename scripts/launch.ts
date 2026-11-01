// Starts everything (start.cmd runs this). Only uses Node's built-ins, since it may run before
// `npm install`.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

if (existsSync(".env")) process.loadEnvFile(".env");
const { config } = await import("../server/config.ts");
const appUrl = `http://localhost:${config.port}`;

// `--no-open` skips opening the browser.
const openWhenReady = !process.argv.includes("--no-open");

const say = (message: string) => console.log(`\n> ${message}`);

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

/** Runs a command in this window. Needs the shell, since npm is a script on Windows. */
function run(commandLine: string) {
  const result = spawnSync(commandLine, { stdio: "inherit", shell: true });
  if (result.status !== 0) fail(`"${commandLine}" failed.`);
}

async function reachable(url: string, timeout = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(url: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 2; i++) {
    if (await reachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function openBrowser(url: string) {
  if (!openWhenReady) return;
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

/** The newest modification time of any file under these paths. */
function newest(paths: string[]): number {
  let latest = 0;
  for (const entry of paths) {
    if (!existsSync(entry)) continue;
    const stats = statSync(entry);
    if (stats.isDirectory()) {
      latest = Math.max(latest, newest(readdirSync(entry).map((name) => path.join(entry, name))));
    } else {
      latest = Math.max(latest, stats.mtimeMs);
    }
  }
  return latest;
}

// Already running: just show it.
if (await reachable(`${appUrl}/api/character`)) {
  say(`The app is already running. Opening ${appUrl}`);
  openBrowser(appUrl);
  process.exit(0);
}

// 1. Packages, when package-lock.json is newer than the last install.
const installed = "node_modules/.package-lock.json";
const lockChanged = () =>
  existsSync("package-lock.json") && statSync("package-lock.json").mtimeMs > statSync(installed).mtimeMs;
if (!existsSync(installed) || lockChanged()) {
  say("Installing packages...");
  run("npm install");
}

// 2. Ollama. If we start it, the EXIT button closes it again.
const version = `${config.ollamaUrl}/api/version`;
let startedOllama = false;
if (!(await reachable(version))) {
  say("Ollama isn't running. Starting it...");
  startedOllama = true;
  // Saves 600 MB of video memory at the same speed. Your own settings win.
  const env = {
    OLLAMA_FLASH_ATTENTION: "1",
    OLLAMA_KV_CACHE_TYPE: "q8_0",
    ...process.env,
  };
  const startServer = () =>
    spawn("ollama serve", { detached: true, stdio: "ignore", shell: true, env }).unref();
  const trayApp = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama app.exe");
  let up = false;
  if (process.platform === "win32" && existsSync(trayApp)) {
    spawn(trayApp, [], { detached: true, stdio: "ignore", env }).unref();
    up = await waitFor(version, 15);
    // The tray app sometimes thinks another copy is running and quits.
    if (!up) {
      say("The Ollama app didn't start its server. Starting the server directly...");
      startServer();
    }
  } else {
    startServer();
  }
  if (!up && !(await waitFor(version, 30))) {
    fail(`Couldn't reach Ollama at ${config.ollamaUrl}. Install it from https://ollama.com, or start it yourself.`);
  }
}

// 3. The models. The embedding model is optional.
async function ensureModel(model: string, description: string, size: string, required: boolean) {
  const show = await fetch(`${config.ollamaUrl}/api/show`, {
    method: "POST",
    body: JSON.stringify({ model }),
  }).catch(() => null);
  if (show?.ok) return;
  say(`The ${description} isn't downloaded yet:\n  ${model}`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Download it now? It's ${size}. [y/N] `);
  prompt.close();
  if (/^y/i.test(answer.trim())) {
    run(`ollama pull "${model}"`);
  } else if (required) {
    fail(`To download it later, run:\n  ollama pull ${model}`);
  } else {
    say(`Continuing without it. To download it later, run:\n  ollama pull ${model}`);
  }
}
await ensureModel(config.model, "model", "several GB", true);
if (config.embedModel) await ensureModel(config.embedModel, "model for recalling her lines", "about 270 MB", false);

// 4. The page, when its sources are newer than the last build.
const built = path.join(config.paths.web, "index.html");
if (existsSync("web")) {
  const sources = ["web", "shared", "vite.config.ts", "package-lock.json"];
  if (!existsSync(built) || newest(sources) > statSync(built).mtimeMs) {
    say("Building the page...");
    run("npm run build");
  }
} else if (!existsSync(built)) {
  fail(`The page is missing (${built}). Download the release again, or build it from the source.`);
}

// 5. The server, in this window. It inherits the .env settings loaded above.
say("Starting the server...");
const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/index.ts"], {
  stdio: "inherit",
  env: { ...process.env, ...(startedOllama && { CHATAK12_STOP_OLLAMA: "1" }) },
});
server.on("exit", (code) => process.exit(code ?? 0));

if (await waitFor(`${appUrl}/api/character`, 30)) {
  say(`Ready. Opening ${appUrl} (keep this window open while you chat; Ctrl+C stops it).`);
  openBrowser(appUrl);
} else {
  console.error("\nThe server didn't start; see the messages above.");
}
