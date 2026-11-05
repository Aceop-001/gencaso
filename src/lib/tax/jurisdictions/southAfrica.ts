import { bands, basics, buildResult, fiscalYear, money, money0, nftUncertainties, progressiveTax, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * South Africa — SARS: crypto gains are capital (CGT: annual exclusion, 40% inclusion in
 * taxable income) or revenue for traders (taxed in full). Module v1.0.0.
 * Tax year 1 March – end of February, named by the year it ends ("2027" = Mar 2026 – Feb 2027).
 */

const VERSION = "ZA-1.1.0";
const INCLUSION = 0.4;

// SARS tables: 2024–2026 unchanged; 2027 per Budget 2026. Annual exclusion R40k → R50k (2027).
const T2024 = bands([[237_100, 0.18], [370_500, 0.26], [512_800, 0.31], [673_000, 0.36], [857_900, 0.39], [1_817_000, 0.41], [Infinity, 0.45]]);
const T2027 = bands([[245_100, 0.18], [383_100, 0.26], [530_200, 0.31], [695_800, 0.36], [887_000, 0.39], [1_878_600, 0.41], [Infinity, 0.45]]);
const YEARS: Record<string, { table: typeof T2024; rebate: number; exclusion: number }> = {
  "2025": { table: T2024, rebate: 17_235, exclusion: 40_000 },
  "2026": { table: T2024, rebate: 17_235, exclusion: 40_000 },
  "2027": { table: T2027, rebate: 17_820, exclusion: 50_000 },
};

const rand = (n: number) => money0(n, "ZAR", "en-ZA");

export const SouthAfrica: Jurisdiction = {
  code: "ZA",
  name: "South Africa",
  flag: "🇿🇦",
  currency: "ZAR",
  locale: "en-ZA",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: (ms) => fiscalYear(ms, 2, 1, (y) => String(y + 1)),
  calculate(input) {
    const { p, unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "ZAR");
    const lines: TaxLine[] = [];
    const uncertainties: string[] = [];
    const tax = (x: number) => Math.max(0, progressiveTax(x, p.table) - p.rebate);

    // Foreign gambling is not excluded by para 45 (only SA-authorised gambling is), so prediction
    // markets are treated like the rest of the trading.
    const net = b.perpNet + b.pmNet + b.nft.net; // NFTs are crypto assets for SARS
    let added: number;
    let carry: number;
    if (b.business) {
      added = net + b.rewards;
      carry = -added;
    } else {
      const afterExclusion = net > 0 ? Math.max(0, net - p.exclusion) : Math.min(0, net + p.exclusion);
      added = Math.max(0, afterExclusion) * INCLUSION + b.rewards;
      carry = -afterExclusion;
    }
    const taxDue = tax(b.other + Math.max(0, added)) - tax(b.other);

    lines.push(
      b.business
        ? {
            label: b.nft.count ? "Crypto trading profits (perps, prediction markets, NFTs)" : "Crypto trading profits (perps + prediction markets)",
            category: "Revenue — gross income",
            baseLocal: money(net),
            rate: "18–45%",
            taxLocal: money(taxDue),
            rule: "Income Tax Act s.1 'gross income'; SARS crypto assets guidance",
            explanation: net > 0 ? `Full net profit of ${rand(net)} added to taxable income.` : `Assessed loss of ${rand(-net)} carried forward.`,
          }
        : {
            label: b.nft.count ? "Crypto disposals (perps, prediction markets, NFTs)" : "Crypto disposals (perps + prediction markets)",
            category: "Capital gain — 40% inclusion",
            baseLocal: money(net),
            rate: "40% included at 18–45% (max 18% effective)",
            taxLocal: money(taxDue),
            rule: "Eighth Schedule paras 5 (annual exclusion) and 10 (inclusion rate)",
            explanation:
              net > 0
                ? `Net gain ${rand(net)} less ${rand(p.exclusion)} annual exclusion; 40% (${rand(Math.max(0, net - p.exclusion) * INCLUSION)}) added to taxable income.`
                : `Net capital loss ${rand(-net)}; after the annual exclusion, ${rand(Math.max(0, -net - p.exclusion))} is carried forward as an assessed capital loss.`,
          },
    );
    uncertainties.push(...nftUncertainties(b.nft));
    if (b.markets.length)
      uncertainties.push("Prediction-market winnings are treated as capital gains: the para 45 gambling exclusion covers only gambling authorised under South African law. Confirm with SARS or an adviser.");
    if (!b.business) uncertainties.push("SARS may treat frequent, short-term trading as revenue (taxed in full). Switch the trader type to 'Business' to see that treatment.");
    if (input.taxYear.id === "2027") uncertainties.push("The R50,000 annual exclusion for 2027 comes from Budget 2026 coverage, not the SARS rates table.");

    return buildResult(input, {
      country: "ZA",
      version: VERSION,
      rulesEffective: "SARS tax tables to 2027 (Budget 2026)",
      currency: "ZAR",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: added,
      lines,
      methodology: [
        "Events converted to ZAR at the ECB reference rate on each date.",
        "Perps and prediction markets netted for the tax year (1 March – end of February).",
        "Tax is the difference between tax on your other income with and without the crypto amounts, after the primary rebate.",
      ],
      assumptions: [
        `South African resident under 65. Other taxable income entered: ${rand(b.other)}.`,
        "Primary rebate only; no assessed losses brought forward; annual exclusion not used elsewhere.",
      ],
      uncertainties,
      missing: b.missing,
      reporting: ["ITR12 annual return (crypto gains declared as capital or income)", "Keep records of every disposal for SARS"],
      references: [
        { title: "SARS: Crypto assets & tax", url: "https://www.sars.gov.za/individuals/crypto-assets-tax/" },
        { title: "SARS: Rates of tax for individuals", url: "https://www.sars.gov.za/tax-rates/income-tax/rates-of-tax-for-individuals/" },
      ],
      carry,
      unsupportedYear: unsupported,
    });
  },
};
