import { useId, type CSSProperties } from "react";

/**
 * GENCASO mark: a translucent jellyfish.
 *  - glassy bell with a cyan rim (the app's palette: electric blue → cyan → violet)
 *  - five tentacles of different lengths read as a P&L chart of many trades
 *  - the longest ends in one glowing point: every trade, one calculated figure
 * Geometry is on a 64×64 grid; public/brand/*.svg and src/app/icon.svg use the same paths.
 */

export const BELL = "M9 30C9 15.5 19.5 6 32 6S55 15.5 55 30Q49.25 34 43.5 31Q37.75 34 32 31Q26.25 34 20.5 31Q14.75 34 9 30Z";
export const BELL_INNER = "M15.5 28C15.5 18.5 23 11.5 32 11.5S48.5 18.5 48.5 28Q40 30.5 32 29Q24 30.5 15.5 28Z";
export const RIM = "M55 30Q49.25 34 43.5 31Q37.75 34 32 31Q26.25 34 20.5 31Q14.75 34 9 30";
export const HIGHLIGHT = "M16.5 22C17.5 16 22 11.8 27.5 10.6";
export const TENTACLES = [
  "M17 33C19.5 36.5 14.5 39.5 17 42S19 45.5 16.5 47",
  "M24.5 33C27.5 38 21.5 42.5 24.5 46S27 51 24 53.5",
  "M32 33C35 38.5 29 44 32 48S35 54 32 57.5",
  "M39.5 33C42.5 37.5 36.5 41.5 39.5 45S42 49.5 39 51.5",
  "M47 33C49.5 36 44.5 38.5 47 41S49 44 46.5 45",
];
export const RESULT_DOT = { cx: 32, cy: 60.2, r: 1.9 };

export function Logo({
  size = 28,
  glow = false,
  animated = false,
  pulseSeconds,
  strokeWidth,
  className,
}: {
  size?: number;
  glow?: boolean;
  animated?: boolean;
  /** Bell pulse period when animated (default 4.2s; faster while swimming) */
  pulseSeconds?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const g = (name: string) => `${name}-${id}`;
  // Thicker strokes when tiny so the tentacles don't vanish at header/favicon size
  const sw = strokeWidth ?? (size < 40 ? 2.6 : 2);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      className={className}
      overflow="visible"
      style={pulseSeconds ? ({ "--jelly-period": `${pulseSeconds}s` } as CSSProperties) : undefined}
    >
      <defs>
        <linearGradient id={g("fill")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8b6cff" stopOpacity=".6" />
          <stop offset="1" stopColor="#3d7bff" stopOpacity=".32" />
        </linearGradient>
        <linearGradient id={g("edge")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9ec3ff" />
          <stop offset=".55" stopColor="#38e1ff" />
          <stop offset="1" stopColor="#8b6cff" />
        </linearGradient>
        <linearGradient id={g("tent")} gradientUnits="userSpaceOnUse" x1="0" y1="32" x2="0" y2="60">
          <stop offset="0" stopColor="#38e1ff" />
          <stop offset="1" stopColor="#3d7bff" stopOpacity=".25" />
        </linearGradient>
        <radialGradient id={g("glow")} cx=".5" cy=".42" r=".5">
          <stop offset="0" stopColor="#3d7bff" stopOpacity=".55" />
          <stop offset="1" stopColor="#3d7bff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {glow && <circle cx="32" cy="27" r="34" fill={`url(#${g("glow")})`} />}

      <g className={animated ? "jelly-sway" : undefined} fill="none" stroke={`url(#${g("tent")})`} strokeWidth={sw} strokeLinecap="round">
        {TENTACLES.map((d) => (
          <path key={d} d={d} />
        ))}
        <circle {...RESULT_DOT} fill="#38e1ff" stroke="none" style={{ filter: "drop-shadow(0 0 2px #38e1ff)" }} />
      </g>

      <g className={animated ? "jelly-pulse" : undefined}>
        <path d={BELL} fill={`url(#${g("fill")})`} stroke={`url(#${g("edge")})`} strokeWidth={sw * 0.8} strokeLinejoin="round" />
        <path d={BELL_INNER} fill="#b9a6ff" fillOpacity=".16" />
        <path d={RIM} fill="none" stroke="#38e1ff" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        <path d={HIGHLIGHT} fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth={sw * 0.75} strokeLinecap="round" />
        <circle cx="19.6" cy="25" r="1.3" fill="#fff" fillOpacity=".7" />
      </g>
    </svg>
  );
}
