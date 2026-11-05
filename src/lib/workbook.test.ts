import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { buildMockEvents } from "./providers/mock";
import type { FxTable, WalletDataset } from "./engine/schema";
import { calculateTax, DEFAULT_PROFILE, jurisdiction, taxYearsWithActivity } from "./tax";
import { buildWorkbookSheets, workbookFileName } from "./workbook";

function flatFx(): FxTable {
  const rates: FxTable["rates"] = {};
  for (let t = Date.parse("2023-01-01"); t < Date.parse("2028-01-01"); t += 86_400_000) (rates.JPY ??= {})[new Date(t).toISOString().slice(0, 10)] = 150;
  return { source: "test", rates, missing: [] };
}

const ds: WalletDataset = { address: "demo", isDemo: true, fetchedAt: 0, events: buildMockEvents().events, providers: [], dataWarnings: ["example warning"], openPositions: [], fx: flatFx() };
const j = jurisdiction("JP");
const year = taxYearsWithActivity(j, ds)[0];
const result = calculateTax(ds, "JP", year, DEFAULT_PROFILE);
const sheets = buildWorkbookSheets(ds, result, DEFAULT_PROFILE, j, new Date(0));

describe("accountant workbook", () => {
  it("has the four tabs", () => {
    expect(sheets.map((s) => s.sheet)).toEqual(["Summary", "Tax calculation", "Transactions", "By asset or market"]);
  });

  it("lists every event in the tax year as numbers in USD and local currency, with a totals row", () => {
    const tx = sheets[2].data;
    const inYear = ds.events.filter((e) => e.timestamp >= year.start && e.timestamp < year.end);
    expect(tx.length).toBe(inYear.length + 2); // header + rows + totals
    const head = tx[0].map((c) => c?.value);
    const realized = head.indexOf("Realized P&L (USD)");
    const realizedJpy = head.indexOf("Realized P&L (JPY)");
    const first = tx.slice(1).find((r) => typeof r[realized]?.value === "number" && r[realized]!.value !== 0)!;
    expect((first[realizedJpy]!.value as number) / (first[realized]!.value as number)).toBeCloseTo(150, 6);
    expect(tx[tx.length - 1][realized]).toMatchObject({ type: "Formula" });
  });

  it("puts the final tax on the summary and the tax lines on the calculation tab", () => {
    const summary = sheets[0].data;
    const tax = summary.find((r) => r[0]?.value === "Estimated final tax (JPY)")!;
    expect(tax[1]!.value).toBe(result.taxLocal);
    expect(sheets[1].data.length).toBeGreaterThan(result.lines.length + 1);
  });

  it("never links demo data", () => {
    const head = sheets[2].data[0].map((c) => c?.value);
    const txCol = head.indexOf("Transaction");
    expect(sheets[2].data.slice(1).every((r) => !r[txCol])).toBe(true);
  });

  it("writes a valid .xlsx file", async () => {
    const buf = await writeXlsxFile(sheets as unknown as Parameters<typeof writeXlsxFile>[0] & unknown[]).toBuffer();
    expect(buf.subarray(0, 2).toString()).toBe("PK"); // xlsx is a zip archive
    expect(buf.length).toBeGreaterThan(5_000);
    expect(workbookFileName(ds, result, j)).toBe(`GENCASO_Japan_${year.id}_demo.xlsx`);
  });
});
