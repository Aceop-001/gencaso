import { describe, expect, it } from "vitest";
import type { FinancialEvent, FxTable, WalletDataset } from "../engine/schema";
import { buildMockEvents } from "../providers/mock";
import { calculateTax, JURISDICTIONS, jurisdiction, taxYearsWithActivity, DEFAULT_PROFILE, type CountryCode } from "./index";

const FLAT: Record<string, number> = {
  INR: 85, GBP: 0.8, EUR: 0.9, AUD: 1.5, JPY: 150, KRW: 1_400, CNY: 7.2, IDR: 16_000, MYR: 4.5, PHP: 58,
  ZAR: 18, TRY: 40, PKR: 280, LKR: 300, VND: 25_000, NGN: 1_500, SGD: 1.3, AED: 3.6725, RUB: 80, UAH: 41,
};
function flatFx(fromIso = "2024-01-01", toIso = "2028-06-01"): FxTable {
  const rates: FxTable["rates"] = {};
  for (let t = Date.parse(fromIso); t < Date.parse(toIso); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    for (const [c, v] of Object.entries(FLAT)) (rates[c] ??= {})[d] = v;
  }
  return { source: "test", rates, missing: [] };
}

let n = 0;
const close = (pnl: number, ts = Date.UTC(2025, 7, 1), extra: Partial<FinancialEvent> = {}): FinancialEvent => ({
  id: `t${++n}`, protocol: "mock", chain: "t", account: "t", timestamp: ts, category: "perp", type: "PERP_CLOSE", asset: "BTC",
  quantity: 1, realizedPnlUsd: pnl, feeUsd: 0, fundingUsd: 0, fiat: { currency: "USD", source: "t" }, source: "t", verification: "mock", confidence: 1, ...extra,
});

const dataset = (events: FinancialEvent[]): WalletDataset => ({
  address: "t", isDemo: true, fetchedAt: 0, events, providers: [], dataWarnings: [], openPositions: [], fx: flatFx(),
});

const run = (code: CountryCode, events: FinancialEvent[], profile = DEFAULT_PROFILE) => {
  const ds = dataset(events);
  const j = jurisdiction(code);
  return calculateTax(ds, code, j.taxYearOf(events[0].timestamp), profile);
};

describe("United States", () => {
  it("taxes short-term gains at ordinary rates after the standard deduction (2025)", () => {
    const r = run("US", [close(50_000)]);
    // (50,000 − 15,750) = 34,250 → 10% × 11,925 + 12% × 22,325
    expect(r.taxLocal).toBeCloseTo(3_871.5, 2);
    expect(r.taxUsd).toBeCloseTo(3_871.5, 2);
  });
  it("limits net capital loss deduction to $3,000 and carries the rest", () => {
    const r = run("US", [close(-10_000)]);
    expect(r.taxLocal).toBe(0);
    expect(r.carryForwardLossLocal).toBe(7_000);
  });
});

describe("United Kingdom", () => {
  it("applies the £3,000 AEA and 18% within the basic band (2025-26)", () => {
    const r = run("GB", [close(50_000)]); // £40,000
    expect(r.taxLocal).toBeCloseTo(37_000 * 0.18, 2);
    expect(r.taxUsd).toBeCloseTo((37_000 * 0.18) / 0.8, 2);
  });
  it("does not tax prediction-market winnings as betting", () => {
    const r = run("GB", [close(5_000, Date.UTC(2025, 7, 1), { category: "prediction", type: "PM_REDEEM", market: { id: "m", name: "M" } })]);
    expect(r.taxLocal).toBe(0);
  });
});

describe("India", () => {
  it("taxes each profitable trade at 30% + 4% cess without loss set-off (s.115BBH)", () => {
    const r = run("IN", [close(10_000), close(-4_000)]);
    expect(r.taxLocal).toBeCloseTo(850_000 * 0.3 * 1.04, 2);
  });
  it("business treatment nets losses and uses slab rates", () => {
    const r = run("IN", [close(10_000), close(-4_000)], { traderType: "business", otherIncomeLocal: 0 });
    // ₹510,000 ≤ ₹12,00,000 → s.87A rebate makes slab tax nil
    expect(r.taxLocal).toBe(0);
  });
});

describe("Germany", () => {
  it("applies Sparer-Pauschbetrag, 25% Abgeltungsteuer and Soli (2025)", () => {
    const r = run("DE", [close(10_000)], { ...DEFAULT_PROFILE, otherIncomeLocal: 80_000 }); // €9,000
    expect(r.taxLocal).toBeCloseTo(8_000 * 0.25 * 1.055, 2);
  });
  it("uses the personal rate instead when it is lower (Günstigerprüfung, §32d Abs. 6)", () => {
    // €8,000 taxable with no other income is below the €12,096 basic allowance → no tax
    expect(run("DE", [close(10_000)]).taxLocal).toBe(0);
  });
  it("phases Soli in at 11.9% of the tax above the Freigrenze (2025)", () => {
    // €1,000 reward on €74,000: tariff €20,168 → €20,588; Soli min(5.5%, 11.9% × (tax − €19,950)): €25.94 → €75.92
    const reward = close(0, Date.UTC(2025, 5, 1), { type: "REWARD", category: "account", amountUsd: 1_000 / 0.9 });
    const r = run("DE", [reward], { ...DEFAULT_PROFILE, otherIncomeLocal: 74_000 });
    expect(r.taxLocal).toBeCloseTo(420 + (20_588 - 19_950) * 0.119 - (20_168 - 19_950) * 0.119, 1);
  });
});

describe("Australia", () => {
  it("adds net capital gain to income with LITO and Medicare levy (2025-26)", () => {
    const r = run("AU", [close(40_000)]); // A$60,000
    expect(r.taxLocal).toBeCloseTo(4_288 + 4_500 - 100 + 1_200, 2);
  });
});

describe("country switching", () => {
  it("produces independent results per country from the same dataset", () => {
    const ds = dataset(buildMockEvents().events);
    const results = JURISDICTIONS.map((j) => {
      const year = taxYearsWithActivity(j, ds)[0];
      return calculateTax(ds, j.code, year, DEFAULT_PROFILE);
    });
    expect(new Set(results.map((r) => r.country)).size).toBe(JURISDICTIONS.length);
    expect(new Set(results.map((r) => r.taxUsd)).size).toBeGreaterThan(1);
    // Memoized: same object returned without recomputation
    const j = JURISDICTIONS[0];
    const y = taxYearsWithActivity(j, ds)[0];
    expect(calculateTax(ds, j.code, y, DEFAULT_PROFILE)).toBe(calculateTax(ds, j.code, y, DEFAULT_PROFILE));
  }, 15_000); // every jurisdiction over the full mock dataset: slow on a busy machine

  it("uses each jurisdiction's own tax-year calendar", () => {
    const ts = Date.UTC(2026, 1, 15);
    expect(jurisdiction("IN").taxYearOf(ts).id).toBe("FY2025-26");
    expect(jurisdiction("US").taxYearOf(ts).id).toBe("2026");
    expect(jurisdiction("GB").taxYearOf(ts).id).toBe("2025-26");
    expect(jurisdiction("AU").taxYearOf(ts).id).toBe("2025-26");
    expect(jurisdiction("GB").taxYearOf(Date.UTC(2026, 3, 5)).id).toBe("2025-26");
    expect(jurisdiction("GB").taxYearOf(Date.UTC(2026, 3, 6)).id).toBe("2026-27");
    expect(jurisdiction("ZA").taxYearOf(ts).id).toBe("2026");
    expect(jurisdiction("ZA").taxYearOf(Date.UTC(2026, 2, 1)).id).toBe("2027");
    expect(jurisdiction("PK").taxYearOf(ts).id).toBe("TY2026");
    expect(jurisdiction("PK").taxYearOf(Date.UTC(2026, 6, 1)).id).toBe("TY2027");
    expect(jurisdiction("LK").taxYearOf(ts).id).toBe("2025/26");
    expect(jurisdiction("JP").taxYearOf(ts).id).toBe("2026");
  });
});

const sale = (ts: number) => close(0, ts, { quantity: 2, price: 50_000 }); // $100,000 notional, no gain

describe("Japan", () => {
  it("uses the income-tiered basic deduction, with surtax and inhabitant tax (2025)", () => {
    const r = run("JP", [close(10_000)]); // ¥1.5m total income → ¥880k deduction → ¥620k
    // inhabitant tax uses its own ¥430k deduction: (¥1.5m − ¥430k) × 10%
    expect(r.taxLocal).toBeCloseTo(620_000 * 0.05 * 1.021 + 1_070_000 * 0.1, 2);
  });
  it("applies the FY2026 reform's ¥1.04m basic deduction up to ¥4.89m of income (2026)", () => {
    const r = run("JP", [close(10_000, Date.UTC(2026, 4, 1))]); // ¥1.5m − ¥1.04m = ¥460k
    expect(r.taxLocal).toBeCloseTo(460_000 * 0.05 * 1.021 + 1_070_000 * 0.1, 2);
  });
  it("prices crypto at the marginal rate on top of other income (2026)", () => {
    // ¥5m other income → ¥670k deduction either way; ¥1.5m crypto stays in the 20% band
    const r = run("JP", [close(10_000, Date.UTC(2026, 4, 1))], { traderType: "individual", otherIncomeLocal: 5_000_000 });
    expect(r.taxLocal).toBeCloseTo(1_500_000 * 0.2 * 1.021 + 1_500_000 * 0.1, 2);
  });
});

describe("South Africa", () => {
  it("applies the R40k exclusion and 40% inclusion on top of other income, after the rebate (2026)", () => {
    const r = run("ZA", [close(10_000)], { traderType: "individual", otherIncomeLocal: 300_000 }); // R180k gain → R56k included
    // tax(356,000) − tax(300,000) = 0.26 × 56,000
    expect(r.taxLocal).toBeCloseTo(0.26 * 56_000, 2);
  });
  it("carries forward an assessed capital loss after the exclusion", () => {
    const r = run("ZA", [close(-5_000)]); // −R90k → R50k carried
    expect(r.taxLocal).toBe(0);
    expect(r.carryForwardLossLocal).toBe(50_000);
  });
});

describe("South Korea", () => {
  it("does not tax virtual-asset gains before 2027", () => {
    expect(run("KR", [close(10_000, Date.UTC(2026, 4, 1))]).taxLocal).toBe(0);
  });
  it("taxes net gains above ₩2.5m at 22% from 2027", () => {
    const r = run("KR", [close(10_000, Date.UTC(2027, 2, 1))]); // ₩14m
    expect(r.taxLocal).toBeCloseTo(11_500_000 * 0.22, 2);
    expect(r.provisional).toBeTruthy();
  });
});

describe("Malaysia", () => {
  it("does not tax individual investors' crypto gains", () => {
    const r = run("MY", [close(10_000)]);
    expect(r.taxLocal).toBe(0);
    expect(r.unsupportedYear).toBeUndefined(); // supported years with no extra parameters
  });
  it("taxes business traders at resident rates", () => {
    const r = run("MY", [close(10_000)], { traderType: "business", otherIncomeLocal: 0 }); // RM45,000
    expect(r.taxLocal).toBeCloseTo(150 + 450 + 600, 2);
  });
});

describe("France", () => {
  it("applies the 31.4% flat tax in 2026", () => {
    expect(run("FR", [close(10_000, Date.UTC(2026, 2, 1))]).taxLocal).toBeCloseTo(9_000 * 0.314, 2);
  });
  it("applies 31.4% to 2025 gains too (LFSS 2026 CSG increase on 2025 capital income)", () => {
    expect(run("FR", [close(10_000)]).taxLocal).toBeCloseTo(9_000 * 0.314, 2);
  });
});

describe("Nigeria", () => {
  it("uses 10% CGT in 2025 and income bands from 2026", () => {
    expect(run("NG", [close(10_000, Date.UTC(2025, 5, 1))]).taxLocal).toBeCloseTo(1_500_000, 2);
    // ₦15m: 15% × 2.2m + 18% × 9m + 21% × 3m
    expect(run("NG", [close(10_000, Date.UTC(2026, 5, 1))]).taxLocal).toBeCloseTo(330_000 + 1_620_000 + 630_000, 2);
  });
});

describe("Sri Lanka", () => {
  it("taxes gains at 10% before and 15% from 3 June 2026", () => {
    expect(run("LK", [close(1_000, Date.UTC(2026, 4, 1))]).taxLocal).toBeCloseTo(300_000 * 0.1, 2);
    expect(run("LK", [close(1_000, Date.UTC(2026, 6, 1))]).taxLocal).toBeCloseTo(300_000 * 0.15, 2);
  });
});

describe("Singapore", () => {
  it("does not tax investors; taxes traders at resident rates", () => {
    expect(run("SG", [close(10_000)]).taxLocal).toBe(0);
    // S$65,000: 2% × 10k + 3.5% × 10k + 7% × 25k
    expect(run("SG", [close(50_000)], { traderType: "business", otherIncomeLocal: 0 }).taxLocal).toBeCloseTo(200 + 350 + 1_750, 2);
  });
});

describe("UAE", () => {
  it("does not tax personal investment", () => {
    expect(run("AE", [close(100_000)]).taxLocal).toBe(0);
  });
  it("taxes a trading business above AED 1m turnover at 9% over AED 375k", () => {
    // $1m notional (AED 3.6725m turnover) closing for a $200k (AED 734,500) profit
    const r = run("AE", [close(200_000, Date.UTC(2025, 7, 1), { quantity: 10, price: 100_000 })], { traderType: "business", otherIncomeLocal: 0 });
    expect(r.taxLocal).toBeCloseTo((734_500 - 375_000) * 0.09, 2);
  });
});

describe("Russia", () => {
  it("taxes digital-currency profit at 13% to ₽2.4m and 15% above (2025)", () => {
    const r = run("RU", [close(50_000)]); // ₽4m
    expect(r.taxLocal).toBeCloseTo(2_400_000 * 0.13 + 1_600_000 * 0.15, 2);
  });
});

describe("Ukraine", () => {
  it("applies 18% PIT plus 5% military levy and is flagged provisional", () => {
    const r = run("UA", [close(10_000)]); // ₴410,000
    expect(r.taxLocal).toBeCloseTo(410_000 * 0.23, 2);
    expect(r.provisional).toBeTruthy();
  });
});

describe("turnover taxes", () => {
  it("Indonesia: 0.2% of sale value before Aug 2025, 1% after — regardless of gain", () => {
    expect(run("ID", [sale(Date.UTC(2025, 5, 1))]).taxLocal).toBeCloseTo(1_600_000_000 * 0.002, 2);
    expect(run("ID", [sale(Date.UTC(2025, 8, 1))]).taxLocal).toBeCloseTo(1_600_000_000 * 0.01, 2);
  });
  it("Vietnam: 0.1% of transfer value from 27 March 2026 only", () => {
    expect(run("VN", [sale(Date.UTC(2026, 0, 10))]).taxLocal).toBe(0);
    expect(run("VN", [sale(Date.UTC(2026, 4, 1))]).taxLocal).toBeCloseTo(2_500_000_000 * 0.001, 2);
  });
});

describe("NFT sales", () => {
  const YEAR = 365 * 86_400_000;
  const nftSale = (pnlUsd: number, ts: number, heldMs = 30 * 86_400_000, extra: Partial<FinancialEvent> = {}) =>
    close(pnlUsd, ts, { protocol: "opensea", category: "nft", type: "NFT_SELL", asset: "pudgypenguins", openedAt: ts - heldMs, exitValueUsd: 20_000, ...extra });

  it("India: each profitable NFT sale at 30% + 4% cess, losing sales ignored", () => {
    const r = run("IN", [nftSale(10_000, Date.UTC(2025, 7, 1)), nftSale(-4_000, Date.UTC(2025, 7, 2))]);
    expect(r.taxLocal).toBeCloseTo(10_000 * 85 * 0.3 * 1.04, 2);
  });
  it("UK: NFT gains join the CGT pot with perps", () => {
    const r = run("GB", [nftSale(12_500, Date.UTC(2025, 7, 1))]); // £10,000
    expect(r.taxLocal).toBeCloseTo((10_000 - 3_000) * 0.18, 2);
  });
  it("Germany: held over a year is tax-free; short-term gains under €1,000 are tax-free", () => {
    const p = { ...DEFAULT_PROFILE, otherIncomeLocal: 60_000 };
    expect(run("DE", [nftSale(100_000, Date.UTC(2025, 7, 1), 2 * YEAR)], p).taxLocal).toBe(0);
    expect(run("DE", [nftSale(1_000, Date.UTC(2025, 7, 1))], p).taxLocal).toBe(0); // €900
    expect(run("DE", [nftSale(2_000, Date.UTC(2025, 7, 1))], p).taxLocal).toBeGreaterThan(0); // €1,800, all taxed
  });
  it("Australia: 50% CGT discount for NFTs held over 12 months", () => {
    const r = run("AU", [nftSale(10_000, Date.UTC(2025, 7, 1), 2 * YEAR)]);
    expect(r.taxableLocal).toBeCloseTo(10_000 * 1.5 * 0.5, 2);
  });
  it("Russia: NFT gains go to the main NDFL base, not the digital-currency base", () => {
    const r = run("RU", [nftSale(12_500, Date.UTC(2025, 7, 1))]); // ₽1,000,000
    expect(r.taxLocal).toBeCloseTo(130_000, 2);
    expect(r.lines.find((l) => l.label === "NFT sales")?.category).toMatch(/Main NDFL base/);
  });
  it("South Korea: collectible NFTs are outside virtual-asset tax even from 2027", () => {
    expect(run("KR", [nftSale(50_000, Date.UTC(2027, 3, 1))]).taxLocal).toBe(0);
  });
  it("sales without a purchase price are flagged, not taxed", () => {
    const r = run("GB", [nftSale(0, Date.UTC(2025, 7, 1), 0, { openedAt: undefined, verification: "missing" })]);
    expect(r.taxLocal).toBe(0);
    expect(r.uncertainties.join(" ")).toMatch(/no known purchase price/);
  });
});

describe("Australia Medicare levy", () => {
  it("phases in at 10c per dollar above the 2025-26 threshold of A$28,011", () => {
    // A$30,000 of NFT-free business income: levy = 10% × (30,000 − 28,011), below 2% × 30,000
    const r = run("AU", [close(20_000, Date.UTC(2025, 9, 1))], { traderType: "business", otherIncomeLocal: 0 });
    const tax = (30_000 - 18_200) * 0.16 - 700 + (30_000 - 28_011) * 0.1;
    expect(r.taxLocal).toBeCloseTo(tax, 2);
  });
});

describe("current tax years", () => {
  it("Pakistan TY2027 (Jul 2026 – Jun 2027) has its own parameters", () => {
    expect(run("PK", [close(10_000, Date.UTC(2026, 10, 1))]).unsupportedYear).toBeUndefined();
  });
  it("Germany 2026 tariff is verified and uses the €20,350 Soli threshold", () => {
    const r = run("DE", [close(0, Date.UTC(2026, 5, 1), { type: "REWARD", category: "account", amountUsd: 10_000 })], { ...DEFAULT_PROFILE, otherIncomeLocal: 100_000 });
    expect(r.uncertainties.join(" ")).not.toMatch(/should be verified/);
    expect(r.unsupportedYear).toBeUndefined();
  });
});

describe("Sri Lanka small-gains exemption", () => {
  it("exempts gains when each is ≤ Rs 50,000 and the total ≤ Rs 600,000", () => {
    const small = [100, 120, 150].map((u, i) => close(u, Date.UTC(2026, 6, 1 + i))); // Rs 30k, 36k, 45k
    expect(run("LK", small).taxLocal).toBe(0);
    expect(run("LK", [...small, close(200, Date.UTC(2026, 6, 9))]).taxLocal).toBeGreaterThan(0); // one gain of Rs 60k
  });
  it("applies 15% on 3 June 2026, the day the Act was certified", () => {
    expect(run("LK", [close(1_000, Date.UTC(2026, 5, 3))]).taxLocal).toBeCloseTo(300_000 * 0.15, 2);
  });
});

describe("UK refinements", () => {
  it("2024-25: gains before 30 Oct 2024 at 10/20%, after at 18/24%", () => {
    // £10,000 before (Aug 2024) and £10,000 after (Dec 2024); AEA £3,000 against the later gain
    const r = run("GB", [close(12_500, Date.UTC(2024, 7, 1)), close(12_500, Date.UTC(2024, 11, 1))]);
    expect(r.taxLocal).toBeCloseTo(10_000 * 0.1 + 7_000 * 0.18, 2);
  });
  it("tapers the personal allowance above £100,000", () => {
    // £1,000 reward on £110,000 other income: PA falls by £500 more → £1,500 taxed at 40%
    const reward = close(0, Date.UTC(2025, 7, 1), { type: "REWARD", category: "account", amountUsd: 1_250 });
    const r = run("GB", [reward], { ...DEFAULT_PROFILE, otherIncomeLocal: 110_000 });
    expect(r.taxLocal).toBeCloseTo(1_500 * 0.4, 2);
  });
});

describe("India 87A marginal relief", () => {
  it("caps tax at the income above ₹12 lakh just over the limit (FY2025-26)", () => {
    // ₹10,000 reward on ₹12,00,000 other income: slab tax ₹61,500 but relief caps it at ₹10,000 (+4% cess)
    const reward = close(0, Date.UTC(2025, 7, 1), { type: "REWARD", category: "account", amountUsd: 10_000 / 85 });
    const r = run("IN", [reward], { ...DEFAULT_PROFILE, otherIncomeLocal: 1_200_000 });
    expect(r.taxLocal).toBeCloseTo(10_000 * 1.04, 1);
  });
});

describe("Nigeria 2025 rewards", () => {
  it("taxes rewards at the 2025 PITA bands after the consolidated relief allowance", () => {
    // ₦1.5m rewards: relief ₦200k + 20% (₦300k) → ₦1m taxable: 7% × 300k + 11% × 300k + 15% × 400k
    const reward = close(0, Date.UTC(2025, 7, 1), { type: "REWARD", category: "account", amountUsd: 1_000 });
    expect(run("NG", [reward]).taxLocal).toBeCloseTo(21_000 + 33_000 + 60_000, 2);
  });
});
