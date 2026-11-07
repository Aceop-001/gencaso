import { NextResponse } from "next/server";
import { fetchFxTable } from "@/lib/fx/fx";
import { meteredHttp } from "@/lib/server/http";
import { allow } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

/**
 * Exchange rates for a CeFi (uploaded CSV) report. The browser sends only the dates of its rows,
 * never the trades themselves, and gets back the same FX table a wallet analysis uses.
 */
export async function POST(req: Request) {
  const client = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  let body: { times?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const times = Array.isArray(body.times) ? body.times.filter((t): t is number => typeof t === "number" && Number.isFinite(t)) : [];
  if (!times.length) return NextResponse.json({ error: "times must be a non-empty array of timestamps (ms)" }, { status: 400 });
  if (times.length > 50_000) return NextResponse.json({ error: "Too many rows (max 50,000)" }, { status: 413 });
  const min = Math.min(...times);
  const max = Math.max(...times);
  if (min < Date.UTC(2009, 0, 1) || max > Date.now() + 86_400_000) return NextResponse.json({ error: "Dates out of range" }, { status: 400 });
  const gate = allow(client);
  if (!gate.ok) return NextResponse.json({ error: `Too many requests — try again in ${gate.retryAfterS}s.` }, { status: 429, headers: { "Retry-After": String(gate.retryAfterS) } });
  try {
    return NextResponse.json(await fetchFxTable(meteredHttp, min, max, times));
  } catch (e) {
    return NextResponse.json({ error: `Exchange rates unavailable (${(e as Error).message})` }, { status: 502 });
  }
}
