// Builds release/chatAK12 and its zip: the source with the page prebuilt, never data/ or .env.

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const releaseDir = path.join("release", "chatAK12");
const zipFile = path.join("release", "chatAK12.zip");

function run(commandLine: string, cwd = root) {
  const result = spawnSync(commandLine, { stdio: "inherit", shell: true, cwd });
  if (result.status !== 0) throw new Error(`"${commandLine}" failed.`);
}

console.log("> Building the page...");
run("npm run build");

console.log(`> Assembling ${releaseDir}...`);
rmSync("release", { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

const copy = (from: string) => cpSync(from, path.join(releaseDir, from), { recursive: true });

copy("start.cmd");
copy(".env.example");
copy("LICENSE");
copy("dist");
copy("web");
copy("vite.config.ts");
copy("shared");
copy("server");
copy("characters");
copy("backgrounds");
copy(path.join("scripts", "launch.ts"));
copy("package-lock.json");
copy(path.join("docs", "screenshot.jpg"));
cpSync("README.md", path.join(releaseDir, "DOCUMENTATION.md"));

// Leave out the packaging script.
const source = JSON.parse(readFileSync("package.json", "utf8"));
delete source.scripts.package;
writeFileSync(path.join(releaseDir, "package.json"), JSON.stringify(source, null, 2) + "\n");

writeFileSync(
  path.join(releaseDir, "README.md"),
  `# chatAK12

A visual-novel style chat with AK-12 from *Girls' Frontline*. It runs on your own computer through a
local language model. The interface recreates the game's story screen, her expression and
voice change with her mood, and she remembers you across conversations.

![chatAK12: AK-12 replying in the game-style dialogue box](docs/screenshot.jpg)

## Requirements

- Windows 10 or 11 (Mac and Linux can run \`npm run launch\`, untested)
- [Node.js](https://nodejs.org) 24 or newer and [Ollama](https://ollama.com)
- A graphics card with about 12 GB of video memory (tested with an RTX 4070 SUPER). Cards with
  less memory work, but slower. If so, try using a smaller model
- About 10 GB of free disk space
- Internet for the first run only, to download packages and models

## Starting it

1. Install Node.js and Ollama.
2. Double-click \`start.cmd\`. The first time, it installs a few packages and offers to download the
   models (Rocinante-X 12B, about 8.7 GB, and a 270 MB one that lets her recall her lines from the
   game). Then it opens the chat in your browser.

Keep the command prompt window open while you chat. The EXIT button at the top right of the page shuts everything down.

## Settings

Copy \`.env.example\` to \`.env\` to change the model or other settings. Your conversations and what she
remembers about you are kept in the \`data\` folder, which is created on first use.

## How it works

[DOCUMENTATION.md](DOCUMENTATION.md) covers the features, architecture, engineering notes, all the
settings, and how to work on the code. The page comes prebuilt, and \`start.cmd\` rebuilds it after you
change anything in \`web\`.

## Credits

AK-12's lines were extracted with
[GFL-Character-Dialogue-Extract](https://github.com/OreoJuice/GFL-Character-Dialogue-Extract), which pulls
its data from [gf-data-us](https://github.com/gf-data-tools/gf-data-us).

## License

The source code is under the [MIT License](LICENSE). *Girls' Frontline* characters, artwork, and voice
lines belong to MICA Team and Sunborn Network and are not covered by it. This is a non-commercial fan
project, not affiliated with or endorsed by them.
`,
);

writeFileSync(
  path.join(releaseDir, ".gitignore"),
  ["node_modules/", "data/", ".env", ".env.*", "!.env.example", "*.log", "Thumbs.db", "desktop.ini", ".DS_Store", ""]
    .join("\n"),
);

console.log(`> Zipping ${zipFile}...`);
// Windows' own tar writes zips; the one Git for Windows puts on the PATH can't.
const tar =
  process.platform === "win32" ? `"${path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")}"` : "tar";
run(`${tar} -a -cf chatAK12.zip chatAK12`, path.join(root, "release"));

const size = (file: string) => `${(statSync(file).size / 1024 / 1024).toFixed(1)} MB`;
console.log(`\nDone: ${releaseDir} and ${zipFile} (${size(zipFile)}).`);
