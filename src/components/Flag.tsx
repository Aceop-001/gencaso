import type { CountryCode } from "@/lib/tax";

/** Inline SVG flags — emoji flags do not render on Windows. Simplified, 3:2 viewBox. */
function UnionJack({ w = 30, h = 20 }: { w?: number; h?: number }) {
  return (
    <g>
      <rect width={w} height={h} fill="#012169" />
      <path d={`M0 0L${w} ${h}M${w} 0L0 ${h}`} stroke="#fff" strokeWidth={h * 0.2} />
      <path d={`M0 0L${w} ${h}M${w} 0L0 ${h}`} stroke="#C8102E" strokeWidth={h * 0.08} />
      <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} stroke="#fff" strokeWidth={h * 0.32} />
      <path d={`M${w / 2} 0V${h}M0 ${h / 2}H${w}`} stroke="#C8102E" strokeWidth={h * 0.18} />
    </g>
  );
}

/** n-pointed star (inner radius ratio 0.38), first point straight up rotated by `rot` degrees. */
function Star({ cx, cy, r, fill, n = 5, rot = 0 }: { cx: number; cy: number; r: number; fill: string; n?: number; rot?: number }) {
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const a = ((-90 + rot + (i * 180) / n) * Math.PI) / 180;
    const rr = i % 2 ? r * 0.38 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
  });
  return <polygon points={pts.join(" ")} fill={fill} />;
}

const FLAGS: Record<CountryCode, React.ReactNode> = {
  IN: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.67" fill="#FF9933" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.7" />
      <circle cx="15" cy="10" r="0.6" fill="#000080" />
    </>
  ),
  US: (
    <>
      <rect width="30" height="20" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#B22234" />
      ))}
      <rect width="12" height={(20 * 7) / 13} fill="#3C3B6E" />
      {[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => <circle key={`${r}${c}`} cx={1.6 + c * 2.9} cy={1.8 + r * 3.4} r="0.55" fill="#fff" />))}
    </>
  ),
  GB: <UnionJack />,
  DE: (
    <>
      <rect width="30" height="6.67" fill="#000" />
      <rect y="6.67" width="30" height="6.67" fill="#DD0000" />
      <rect y="13.33" width="30" height="6.67" fill="#FFCE00" />
    </>
  ),
  AU: (
    <>
      <rect width="30" height="20" fill="#012169" />
      <svg width="15" height="10" viewBox="0 0 30 20"><UnionJack /></svg>
      <circle cx="7.5" cy="15" r="1.6" fill="#fff" />
      {[[22.5, 4.5], [19, 9.5], [26, 8.5], [22.5, 16.5], [24.5, 11.8]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="0.9" fill="#fff" />)}
    </>
  ),
  CN: (
    <>
      <rect width="30" height="20" fill="#EE1C25" />
      <Star cx={5} cy={5} r={3} fill="#FFFF00" />
      {[[10, 2, 23], [12, 4, 45], [12, 7, 70], [10, 9, 20]].map(([x, y, rot]) => <Star key={`${x}${y}`} cx={x} cy={y} r={1} fill="#FFFF00" rot={rot} />)}
    </>
  ),
  FR: (
    <>
      <rect width="10" height="20" fill="#002395" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#ED2939" />
    </>
  ),
  ID: (
    <>
      <rect width="30" height="10" fill="#CE1126" />
      <rect y="10" width="30" height="10" fill="#fff" />
    </>
  ),
  JP: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <circle cx="15" cy="10" r="6" fill="#BC002D" />
    </>
  ),
  KR: (
    <>
      <rect width="30" height="20" fill="#fff" />
      <g transform="rotate(33.7 15 10)">
        <path d="M10 10a5 5 0 0 1 10 0a2.5 2.5 0 0 1-5 0a2.5 2.5 0 0 0-5 0z" fill="#CD2E3A" />
        <path d="M10 10a2.5 2.5 0 0 0 5 0a2.5 2.5 0 0 1 5 0a5 5 0 0 1-10 0z" fill="#0047A0" />
      </g>
      {[[6, 4.5, 33.7], [24, 15.5, 33.7], [24, 4.5, -33.7], [6, 15.5, -33.7]].map(([x, y, a]) => (
        <g key={`${x}${y}`} transform={`rotate(${a} ${x} ${y})`} fill="#000">
          <rect x={x - 2.5} y={y - 1.8} width="5" height="0.8" />
          <rect x={x - 2.5} y={y - 0.4} width="5" height="0.8" />
          <rect x={x - 2.5} y={y + 1} width="5" height="0.8" />
        </g>
      ))}
    </>
  ),
  LK: (
    <>
      <rect width="30" height="20" fill="#FFBE29" />
      <rect x="1.5" y="1.5" width="4" height="17" fill="#00534E" />
      <rect x="5.5" y="1.5" width="4" height="17" fill="#EB7400" />
      <rect x="10.5" y="1.5" width="18" height="17" fill="#8D153A" />
      <path d="M15 14.5v-6l2-2h3l1.5-2 1 .8-.5 1.7 1.5 1.5v6h-1.2v-3h-4.8v3z" fill="#FFBE29" />
    </>
  ),
  MY: (
    <>
      {Array.from({ length: 14 }, (_, i) => <rect key={i} y={(i * 20) / 14} width="30" height={20 / 14} fill={i % 2 ? "#fff" : "#CC0001"} />)}
      <rect width="15" height={(20 * 8) / 14} fill="#010066" />
      <circle cx="6" cy="5.7" r="3.6" fill="#FFCC00" />
      <circle cx="7.1" cy="5.7" r="3" fill="#010066" />
      <Star cx={10.6} cy={5.7} r={2.4} n={14} fill="#FFCC00" />
    </>
  ),
  NG: (
    <>
      <rect width="10" height="20" fill="#008751" />
      <rect x="10" width="10" height="20" fill="#fff" />
      <rect x="20" width="10" height="20" fill="#008751" />
    </>
  ),
  PH: (
    <>
      <rect width="30" height="10" fill="#0038A8" />
      <rect y="10" width="30" height="10" fill="#CE1126" />
      <polygon points="0,0 17.3,10 0,20" fill="#fff" />
      <circle cx="6" cy="10" r="2" fill="#FCD116" />
      {[[2, 2.6], [2, 17.4], [14.4, 10]].map(([x, y]) => <Star key={`${x}${y}`} cx={x} cy={y} r={1} fill="#FCD116" />)}
    </>
  ),
  PK: (
    <>
      <rect width="30" height="20" fill="#01411C" />
      <rect width="7.5" height="20" fill="#fff" />
      <circle cx="19" cy="10.5" r="5.6" fill="#fff" />
      <circle cx="20.6" cy="9.2" r="4.9" fill="#01411C" />
      <Star cx={22.2} cy={7.4} r={1.7} fill="#fff" rot={40} />
    </>
  ),
  TR: (
    <>
      <rect width="30" height="20" fill="#E30A17" />
      <circle cx="11" cy="10" r="5" fill="#fff" />
      <circle cx="12.25" cy="10" r="4" fill="#E30A17" />
      <Star cx={16.9} cy={10} r={2.2} fill="#fff" rot={-90} />
    </>
  ),
  VN: (
    <>
      <rect width="30" height="20" fill="#DA251D" />
      <Star cx={15} cy={10.4} r={6} fill="#FFFF00" />
    </>
  ),
  RU: (
    <>
      <rect width="30" height="6.67" fill="#fff" />
      <rect y="6.67" width="30" height="6.67" fill="#0039A6" />
      <rect y="13.33" width="30" height="6.67" fill="#D52B1E" />
    </>
  ),
  UA: (
    <>
      <rect width="30" height="10" fill="#0057B7" />
      <rect y="10" width="30" height="10" fill="#FFD700" />
    </>
  ),
  SG: (
    <>
      <rect width="30" height="10" fill="#EF3340" />
      <rect y="10" width="30" height="10" fill="#fff" />
      <circle cx="6.2" cy="5" r="3.4" fill="#fff" />
      <circle cx="7.6" cy="5" r="3.2" fill="#EF3340" />
      {[[10, 2.6], [8.2, 3.9], [11.8, 3.9], [8.9, 6.1], [11.1, 6.1]].map(([x, y]) => <Star key={`${x}${y}`} cx={x} cy={y} r={0.75} fill="#fff" />)}
    </>
  ),
  AE: (
    <>
      <rect width="30" height="6.67" fill="#00732F" />
      <rect y="6.67" width="30" height="6.67" fill="#fff" />
      <rect y="13.33" width="30" height="6.67" fill="#000" />
      <rect width="7.5" height="20" fill="#FF0000" />
    </>
  ),
  ZA: (
    <>
      <rect width="30" height="10" fill="#E03C31" />
      <rect y="10" width="30" height="10" fill="#001489" />
      <path d="M0 0L12 10L0 20M12 10H30" stroke="#fff" strokeWidth="6.6" fill="none" />
      <path d="M0 0L12 10L0 20M12 10H30" stroke="#007749" strokeWidth="4" fill="none" />
      <polygon points="0,2.6 8.9,10 0,17.4" fill="#FFB81C" />
      <polygon points="0,4.2 7,10 0,15.8" fill="#000" />
    </>
  ),
};

export function Flag({ code, size = 22 }: { code: CountryCode; size?: number }) {
  return (
    <svg width={size} height={(size * 2) / 3} viewBox="0 0 30 20" aria-hidden className="shrink-0 overflow-hidden rounded-[3px] ring-1 ring-white/15">
      {FLAGS[code]}
    </svg>
  );
}
