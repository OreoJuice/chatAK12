import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MAX_MESSAGE_LENGTH } from "../../shared/protocol";
import { errorText, shutdown, type Message } from "./api";
import { ChatsPanel } from "./ChatsPanel";
import { Formatted } from "./Formatted";
import { BgIcon, ChatsIcon, GfBar, LogIcon, PowerIcon, VoiceIcon } from "./icons";
import { useBackground } from "./useBackground";
import { useChat } from "./useChat";
import { useVoice } from "./useVoice";

type Panel = "log" | "bg" | "chats" | "exit";

// Keys that move a range slider; releasing one previews the new volume.
const VOLUME_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

// Memoized so a long log doesn't re-render every entry.
const LogEntry = memo(function LogEntry({ message, speaker }: { message: Message; speaker: string }) {
  return (
    <p className={`log-entry ${message.role}`}>
      <span className="log-speaker">{message.role === "user" ? "Commander" : speaker}</span>
      {message.role === "assistant" ? <Formatted text={message.content} /> : message.content}
    </p>
  );
});

export default function App() {
  // The voice hook needs the character from the chat hook, which needs to play voices.
  const playVoice = useRef<(expression: string, interrupt: boolean) => void>(() => undefined);
  // A new reply cuts off the previous clip; later changes in a reply wait their turn.
  const chat = useChat({
    onExpressionChange: (expression, firstInReply) => playVoice.current(expression, firstInReply),
  });
  const { character, conversationId, messages, streaming, expression, error } = chat;
  const voice = useVoice(character?.voices, character?.defaultExpression);
  playVoice.current = voice.play;

  const backgrounds = character?.backgrounds ?? [];
  const [background, pickBackground] = useBackground(backgrounds);
  const [draft, setDraft] = useState("");
  const [overlay, setOverlay] = useState<Panel | null>(null);
  const [exiting, setExiting] = useState<"stopping" | "stopped" | null>(null);
  const [exitError, setExitError] = useState<string | null>(null);
  const lineText = useRef<HTMLParagraphElement>(null);
  const logBody = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Keep the newest words in view if a line is longer than the box.
  useEffect(() => {
    lineText.current?.scrollTo({ top: lineText.current.scrollHeight });
  }, [streaming, messages]);

  useEffect(() => {
    if (overlay === "log") logBody.current?.scrollTo({ top: logBody.current.scrollHeight });
    if (!overlay) {
      input.current?.focus();
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOverlay(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay]);

  const sprites = character?.sprites ?? [];
  const sprite =
    sprites.find((s) => s.name === expression) ?? sprites.find((s) => s.name === character?.defaultExpression);
  const busy = streaming !== null;
  const name = character?.name ?? "";
  const stageStyle = background ? { backgroundImage: `url("${background.url}")` } : undefined;
  const lastReply = messages.findLast((m) => m.role === "assistant");

  const submit = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setDraft("");
    // If the server turned it away, put the text back in the input.
    if (!(await chat.send(content, background?.name))) setDraft((current) => current || content);
  };

  const toggle = (which: Panel) => setOverlay((open) => (open === which ? null : which));

  const exit = async () => {
    setExiting("stopping");
    setExitError(null);
    try {
      await shutdown();
    } catch (err) {
      setExiting(null);
      setExitError(errorText(err));
      return;
    }
    voice.stop();
    setOverlay(null);
    setExiting("stopped");
    // Browsers usually refuse, since no script opened this tab, so the signed-off screen says to close it.
    window.close();
  };

  if (exiting === "stopped") {
    return (
      <div className="stage" style={stageStyle}>
        <div className="overlay">
          <div className="panel narrow" role="status">
            <div className="panel-header">
              <h2>SIGNED OFF</h2>
            </div>
            <div className="panel-body">
              <p className="signed-off">
                {name || "She"} has signed off and the app has stopped. You can close this tab.
              </p>
              <p className="hint small">To start again, double-click start.cmd.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // The box shows one line at a time, like the game.
  let line: ReactNode;
  let lineClass = "line-text";
  if (error) {
    line = error;
    lineClass += " error";
  } else if (streaming !== null) {
    line = streaming ? <Formatted text={streaming} /> : <span className="typing">…</span>;
  } else if (lastReply) {
    line = <Formatted text={lastReply.content} />;
  } else {
    line = character ? `Say something to ${name} to begin.` : "Connecting…";
    lineClass += " hint";
  }

  const hudButton = (which: Panel, icon: ReactNode, label: string, ariaLabel?: string) => (
    <button
      className="icon-button"
      onClick={() => toggle(which)}
      aria-expanded={overlay === which}
      aria-label={ariaLabel}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="stage" style={stageStyle}>
      {sprite && <img className="sprite" src={sprite.url} alt={`${name}, ${sprite.name}`} />}

      <div className="hud">
        {hudButton("log", <LogIcon />, "LOG")}
        {hudButton("bg", <BgIcon />, "BG", "Backgrounds")}
        {hudButton("chats", <ChatsIcon />, "CHATS", "Conversations and memory")}
        <button
          className={voice.enabled ? "icon-button" : "icon-button off"}
          onClick={voice.toggle}
          aria-pressed={voice.enabled}
          aria-label="Voice"
        >
          <VoiceIcon on={voice.enabled} />
          <span>VOICE</span>
        </button>
        <label className={voice.enabled ? "volume" : "volume off"}>
          <span className="volume-value" aria-hidden="true">
            {voice.volume}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={voice.volume}
            onChange={(e) => voice.setVolume(Number(e.target.value))}
            onPointerUp={voice.preview}
            onKeyUp={(e) => VOLUME_KEYS.has(e.key) && voice.preview()}
            aria-label="Voice volume"
            style={{ "--fill": `${voice.volume}%` } as CSSProperties}
          />
          <span className="volume-label" aria-hidden="true">
            VOL
          </span>
        </label>
      </div>

      <button className="exit-button" onClick={() => toggle("exit")} aria-expanded={overlay === "exit"}>
        EXIT
        <PowerIcon />
      </button>

      <section className="textbox">
        <div className="textbox-frame" aria-hidden="true" />
        <div className="nameplate">{name}</div>
        <p className={lineClass} ref={lineText} aria-live="polite">
          {line}
        </p>
        <div className="gf-mark" aria-hidden="true">
          G.F.system
          <GfBar />
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={busy ? `${name} is talking…` : "Reply…"}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={conversationId === null}
            aria-label={`Message to ${name}`}
            autoFocus
          />
          <button type="submit" disabled={busy || !draft.trim()}>
            SEND
          </button>
        </form>
      </section>

      {overlay && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setOverlay(null)}>
          <div
            className={overlay === "exit" ? "panel narrow" : "panel"}
            role="dialog"
            aria-label={overlay.toUpperCase()}
          >
            <div className="panel-header">
              <h2>{overlay.toUpperCase()}</h2>
              <button className="text-button" onClick={() => setOverlay(null)}>
                CLOSE ✕
              </button>
            </div>

            {overlay === "log" && (
              <div className="panel-body" ref={logBody}>
                {messages.length === 0 ? (
                  <p className="hint">Nothing has been said yet.</p>
                ) : (
                  messages.map((message) => <LogEntry key={message.id} message={message} speaker={name} />)
                )}
              </div>
            )}

            {overlay === "bg" && (
              <div className="panel-body">
                <p className="section-label">BACKGROUND</p>
                <p className="hint small">{name || "She"} knows where you are and reacts to the scene.</p>
                {backgrounds.length === 0 ? (
                  <p className="hint">Add images to the backgrounds folder.</p>
                ) : (
                  <div className="backgrounds">
                    {backgrounds.map((bg) => (
                      <button
                        key={bg.name}
                        className={bg.name === background?.name ? "selected" : undefined}
                        onClick={() => pickBackground(bg.name)}
                        title={bg.name}
                      >
                        <img src={bg.thumb ?? bg.url} alt="" loading="lazy" decoding="async" />
                        <span>{bg.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {overlay === "chats" && (
              <ChatsPanel
                currentId={conversationId}
                busy={busy}
                messageCount={messages.length}
                onOpen={(id) => {
                  setOverlay(null);
                  void chat.open(id);
                }}
                onNew={() => {
                  setOverlay(null);
                  void chat.startOver();
                }}
                onDelete={chat.remove}
              />
            )}

            {overlay === "exit" && (
              <div className="panel-body">
                <p className="exit-question">Shut everything down?</p>
                <p className="hint small">
                  This stops the app and unloads the model to free its memory. If the launcher started Ollama, Ollama
                  closes too. Your conversations are kept.
                </p>
                {exitError && <p className="panel-error">Couldn't shut down: {exitError}</p>}
                <div className="exit-actions">
                  <button className="row-confirm" onClick={() => void exit()} disabled={exiting !== null} autoFocus>
                    {exiting === "stopping" ? "SHUTTING DOWN…" : "SHUT DOWN"}
                  </button>
                  <button className="text-button" onClick={() => setOverlay(null)} disabled={exiting !== null}>
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
