import { useCallback, useRef, useState } from "react";
import { readSetting, writeSetting } from "./storage";

const ENABLED_KEY = "voice";
const VOLUME_KEY = "voiceVolume";
const DEFAULT_VOLUME = 80;

function readVolume(): number {
  const stored = readSetting(VOLUME_KEY);
  const volume = Number(stored);
  return stored !== null && Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : DEFAULT_VOLUME;
}

/**
 * Plays her voice clips, never the same one twice in a row. With `interrupt` off, a playing clip
 * finishes first. Turning voice on or letting go of the volume slider plays `greeting`.
 */
export function useVoice(voices: Record<string, string[]> | undefined, greeting: string | undefined) {
  const [enabled, setEnabled] = useState(() => readSetting(ENABLED_KEY) !== "off");
  // 0 to 100. The ref lets a clip started later pick up the latest value.
  const [volume, setVolumeState] = useState(readVolume);
  const volumeRef = useRef(volume);
  const playing = useRef<HTMLAudioElement | null>(null);
  const lastClip = useRef<Record<string, string>>({});

  const start = useCallback(
    (expression: string, interrupt: boolean) => {
      const clips = voices?.[expression];
      if (!clips?.length) return;
      const current = playing.current;
      if (current && !current.paused && !current.ended) {
        if (!interrupt) return;
        current.pause();
      }

      const choices = clips.length > 1 ? clips.filter((clip) => clip !== lastClip.current[expression]) : clips;
      const clip = choices[Math.floor(Math.random() * choices.length)];
      lastClip.current[expression] = clip;

      const audio = new Audio(clip);
      audio.volume = volumeRef.current / 100;
      playing.current = audio;
      audio.play().catch((err: unknown) => {
        // Usually the browser refusing sound before the page has been clicked.
        console.warn(`Couldn't play ${clip}:`, err);
      });
    },
    [voices],
  );

  const play = useCallback(
    (expression: string, interrupt: boolean) => {
      if (enabled) start(expression, interrupt);
    },
    [enabled, start],
  );

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    writeSetting(ENABLED_KEY, next ? "on" : "off");
    if (next && greeting) start(greeting, true);
    else playing.current?.pause();
  };

  /** Changes the volume, including for a clip that's already playing. */
  const setVolume = (next: number) => {
    volumeRef.current = next;
    setVolumeState(next);
    writeSetting(VOLUME_KEY, String(next));
    if (playing.current) playing.current.volume = next / 100;
  };

  const preview = () => {
    if (enabled && greeting && volumeRef.current > 0) start(greeting, true);
  };

  const stop = () => playing.current?.pause();

  return { enabled, toggle, play, volume, setVolume, preview, stop };
}
