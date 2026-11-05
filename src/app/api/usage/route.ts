import { NextResponse } from "next/server";
import { getUsage } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** API consumption since server start, per data provider. */
export function GET() {
  return NextResponse.json({ since: "server start", providers: getUsage() });
}
