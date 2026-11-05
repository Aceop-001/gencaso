import { NextResponse } from "next/server";
import { analyzeWallet, UserError } from "@/lib/server/analyze";
import { allow } from "@/lib/server/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const client = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  let body: { address?: unknown; refresh?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.address !== "string" || body.address.length > 100) {
    return NextResponse.json({ error: "address must be a string" }, { status: 400 });
  }
  const gate = allow(client);
  if (!gate.ok) {
    return NextResponse.json({ error: `Too many analyses — try again in ${gate.retryAfterS}s.` }, { status: 429, headers: { "Retry-After": String(gate.retryAfterS) } });
  }
  try {
    const dataset = await analyzeWallet(body.address, { refresh: body.refresh === true });
    console.info(`[audit] analyse address=${dataset.address} events=${dataset.events.length} providers=${dataset.providers.map((p) => `${p.provider}:${p.status}:${p.requests}`).join(",")}`);
    return NextResponse.json(dataset);
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("[analyse] failed", e);
    return NextResponse.json({ error: "Analysis failed unexpectedly." }, { status: 500 });
  }
}
