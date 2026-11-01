import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Background } from "./character.ts";
import { config } from "./config.ts";

// 16:9 previews for the background picker.
const WIDTH = 320;
const HEIGHT = 180;

const dir = path.join(config.paths.data, "thumbs");
const inProgress = new Map<string, Promise<string>>();

/** A background's thumbnail, made on first use. The name carries the image's modification time. */
export function thumbnailFor(background: Background): Promise<string> {
  const target = path.join(dir, `${background.file}.${background.modified}.webp`);
  if (existsSync(target)) return Promise.resolve(target);

  // Concurrent requests share one render.
  let pending = inProgress.get(target);
  if (!pending) {
    pending = render(background, target).finally(() => inProgress.delete(target));
    inProgress.set(target, pending);
  }
  return pending;
}

/** Deletes thumbnails of removed or replaced backgrounds. */
export function pruneThumbnails(backgrounds: Background[]) {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return;
  }
  const current = new Set(backgrounds.map((bg) => `${bg.file}.${bg.modified}.webp`));
  for (const file of files) {
    if (!current.has(file)) rmSync(path.join(dir, file), { force: true });
  }
}

async function render(background: Background, target: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await sharp(path.join(config.paths.backgrounds, background.file))
    .resize(WIDTH, HEIGHT, { fit: "cover" })
    .webp({ quality: 72 })
    .toFile(temporary);
  renameSync(temporary, target);
  return target;
}
