import type { FinancialEvent, FxTable, WalletDataset } from "../engine/schema";
import { dedupe } from "../engine/summary";
import type { CsvIssue } from "./csv";

export interface CefiUpload {
  fileName: string;
  events: FinancialEvent[];
  issues: CsvIssue[];
  rows: number;
  exchanges: string[];
}

/** A CeFi report in the same shape a wallet analysis produces, so taxes, charts and exports just work. */
export function buildCefiDataset(uploads: CefiUpload[], fx: FxTable, now = Date.now()): WalletDataset {
  const { events } = dedupe(uploads.flatMap((u) => u.events));
  const exchanges = [...new Set(uploads.flatMap((u) => u.exchanges))];
  const skipped = uploads.reduce((n, u) => n + u.issues.length, 0);
  const warnings = [
    "CeFi report: amounts are taken from your file as entered (USD; USDT and USDC count as USD) and are not checked against the exchange.",
    "Holding periods aren't in the file, so all gains are treated as short-term. In countries with a long-term discount, your tax may be lower.",
  ];
  if (skipped)
    warnings.unshift(
      `${skipped} row(s) were skipped because they couldn't be read: ` +
        uploads
          .flatMap((u) => u.issues.slice(0, 3).map((i) => `${u.fileName} line ${i.line}: ${i.message}`))
          .slice(0, 5)
          .join(" · ") +
        (skipped > 5 ? " · …" : ""),
    );
  return {
    address: "cefi",
    cefi: { files: uploads.map((u) => u.fileName), exchanges },
    isDemo: false,
    fetchedAt: now,
    events,
    providers: [
      {
        provider: "Exchange CSV",
        protocol: "cefi",
        status: events.length ? "ok" : "empty",
        eventCount: events.length,
        requests: 0,
        fromCache: false,
        message: `${uploads.length} file(s): ${uploads.map((u) => `${u.fileName} (${u.rows} rows)`).join(", ")}${exchanges.length ? ` · ${exchanges.join(", ")}` : ""}`,
        limitations: [],
      },
    ],
    dataWarnings: warnings,
    openPositions: [],
    fx,
  };
}
