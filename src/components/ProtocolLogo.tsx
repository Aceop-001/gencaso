import type { ProtocolId } from "@/lib/engine/schema";
import { protocolById } from "@/lib/registry";

/** Small official protocol icon (falls back to the protocol's initial). Decorative next to its name. */
export function ProtocolLogo({ protocol, size = 16 }: { protocol: ProtocolId; size?: number }) {
  const p = protocolById(protocol);
  if (p?.logo)
    // eslint-disable-next-line @next/next/no-img-element -- 64px static icons; next/image optimization is disabled
    return <img src={p.logo} alt="" width={size} height={size} className="inline-block shrink-0 rounded-[4px]" />;
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-[4px] bg-line text-[9px] font-semibold uppercase text-ink-2" style={{ width: size, height: size }}>
      {(p?.name ?? protocol).slice(0, 1)}
    </span>
  );
}
