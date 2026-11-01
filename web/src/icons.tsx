// Icons in the style of the game's top-left buttons: thin white strokes.

export const LogIcon = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2.2" aria-hidden="true">
    <path d="M3 5h2M3 12h2M3 19h2M8 5h13M8 12h13M8 19h13" />
  </svg>
);

export const BgIcon = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="4" width="18" height="14" />
    <path d="M3 15l5-5 4 4 3-3 6 6" />
    <circle cx="16" cy="8.5" r="1.4" />
  </svg>
);

export const ChatsIcon = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true">
    <rect x="6" y="3" width="15" height="13" />
    <path d="M3 7v14h14" />
  </svg>
);

export const VoiceIcon = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" strokeWidth="2" aria-hidden="true">
    <path d="M3 9h4l5-4v14l-5-4H3z" />
    {on ? <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="M16 9l5 6M21 9l-5 6" />}
  </svg>
);

export const PowerIcon = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2.4" aria-hidden="true">
    <path d="M12 3v8M6.5 6.5a7.5 7.5 0 1 0 11 0" />
  </svg>
);

// The bar under G.F.system, measured from the game: twelve yellow slanted pieces, one white piece of
// the same size, then one long white piece with a square right end. Each short piece is 3 units
// wide, repeating every 7, and leans 3.5 units across the bar's height of 7.
const BAR_SLANT = 3.5;
const slash = (x: number, width: number) =>
  `${x + BAR_SLANT},0 ${x + BAR_SLANT + width},0 ${x + width},7 ${x},7`;

export const GfBar = () => (
  <svg viewBox={`0 0 ${114 + BAR_SLANT} 7`} aria-hidden="true">
    {Array.from({ length: 12 }, (_, i) => (
      <polygon key={i} points={slash(i * 7, 3)} fill="#fdb300" />
    ))}
    <polygon points={slash(84, 3)} fill="#fff" />
    {/* The long piece leans on its left edge only; its right end is square. */}
    <polygon points={`${91 + BAR_SLANT},0 ${114 + BAR_SLANT},0 ${114 + BAR_SLANT},7 91,7`} fill="#fff" />
  </svg>
);
