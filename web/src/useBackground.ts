import { useState } from "react";
import type { Asset } from "./api";
import { readSetting, writeSetting } from "./storage";

const STORAGE_KEY = "background";

/** The chosen background, remembered in this browser, or else the first one. */
export function useBackground(backgrounds: Asset[]) {
  const [name, setName] = useState(() => readSetting(STORAGE_KEY));
  const current = backgrounds.find((bg) => bg.name === name) ?? backgrounds[0];
  const pick = (next: string) => {
    setName(next);
    writeSetting(STORAGE_KEY, next);
  };
  return [current, pick] as const;
}
