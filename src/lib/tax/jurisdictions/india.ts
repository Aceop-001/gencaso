import {
  COMMON_UNCERTAINTIES, finalUsd, inYearCount, isPerp, localize, marketResults, money, nftResults, nftUncertainties, progressiveTax, sum, utcYear,
  type Bracket,
} from "../common";
import type { Jurisdiction, TaxInput, TaxLine, TaxResult } from "../types";

/**
 * India — Income-tax Act, 1961 (new tax regime, s.115BAC default).
 * Module v1.0.0. Financial years run 1 April – 31 March.
 */

const VERSION = "IN-1.4.0";

interface YearParams {
  slabs: Bracket[];
  rebateLimit: number; // s.87A total-income limit (not available against special-rate income)
  verified: boolean;
}

const NEW_REGIME_2025: Bracket[] = [
  { upTo: 400_000, rate: 0 },
  { upTo: 800_000, rate: 0.05 },
  { upTo: 1_200_000, rate: 0.1 },
  { upTo: 1_600_000, rate: 0.15 },
  { upTo: 2_000_000, rate: 0.2 },
  { upTo: 2_400_000, rate: 0.25 },
  { upTo: Infinity, rate: 0.3 },
];

const YEARS: Record<string, YearParams> = {
  "FY2024-25": {
    slabs: [
      { upTo: 300_000, rate: 0 },
      { upTo: 700_000, rate: 0.05 },
      { upTo: 1_000_000, rate: 0.1 },
      { upTo: 1_200_000, rate: 0.15 },
      { upTo: 1_500_000, rate: 0.2 },
      { upTo: Infinity, rate: 0.3 },
    ],
    rebateLimit: 700_000,
    verified: true,
  },
  "FY2025-26": { slabs: NEW_REGIME_2025, rebateLimit: 1_200_000, verified: true },
  // Assumed unchanged from FY2025-26 — verify against Finance Act 2026.
  "FY2026-27": { slabs: NEW_REGIME_2025, rebateLimit: 1_200_000, verified: true }, // Budget 2026 kept slabs and the ₹12 lakh rebate
};

const VDA_RATE = 0.3; // s.115BBH
const BETTING_RATE = 0.3; // s.115BB
const CESS = 0.04;

function surchargeRate(totalIncome: number) {
  if (totalIncome > 20_000_000) return 0.25; // new regime cap
  if (totalIncome > 10_000_000) return 0.15;
  if (totalIncome > 5_000_000) return 0.1;
  return 0;
}

function slabSchedule(p: YearParams) {
  return (income: number) => {
    const t = progressiveTax(income, p.slabs);
    // s.87A rebate, with marginal relief just above the limit: tax can't exceed the income over the limit
    return income <= p.rebateLimit ? 0 : Math.min(t, income - p.rebateLimit);
  };
}

export const India: Jurisdiction = {
  code: "IN",
  name: "India",
  flag: "🇮🇳",
  currency: "INR",
  locale: "en-IN",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf(ms) {
    const d = new Date(ms);
    const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    const id = `FY${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    return utcYear(id, `FY ${y}-${String((y + 1) % 100).padStart(2, "0")} (1 Apr ${y} – 31 Mar ${y + 1})`, y, 3, 1);
  },
  calculate(input: TaxInput): TaxResult {
    const params = YEARS[input.taxYear.id];
    const p = params ?? YEARS["FY2025-26"];
    const { rows, missing } = localize(input, "INR");
    const business = input.profile.traderType === "business";
    const other = Math.max(0, input.profile.otherIncomeLocal);
    const lines: TaxLine[] = [];
    const assumptions: string[] = [
      "Resident individual for Indian tax purposes; global income taxable in India.",
      "New tax regime (s.115BAC) — the default from FY2023-24.",
      `Other taxable income entered: ₹${other.toLocaleString("en-IN")} (treated as normal slab income).`,
    ];
    const uncertainties = [...COMMON_UNCERTAINTIES];
    let carry = 0;

    const perpRows = rows.filter(isPerp);
    const perpNet = sum(perpRows, (r) => r.realized + r.funding - r.fee);
    let slabExtra = 0; // income taxed at slab rates
    let specialTax = 0; // tax at special rates before surcharge/cess

    if (!business) {
      // s.115BBH: each transfer taxed separately; no set-off of losses, no deductions except cost of acquisition.
      const gains = sum(perpRows, (r) => Math.max(0, r.realized));
      const fundingIn = sum(perpRows, (r) => Math.max(0, r.funding));
      const base = gains + fundingIn;
      const tax = base * VDA_RATE;
      specialTax += tax;
      lines.push({
        label: "Perpetual DEX gains (VDA)",
        category: "Income from transfer of Virtual Digital Assets",
        baseLocal: money(base),
        rate: "30%",
        taxLocal: money(tax),
        rule: "s.115BBH Income-tax Act",
        explanation:
          `Sum of every profitable closing fill (₹${money(gains).toLocaleString("en-IN")}) plus funding received (₹${money(fundingIn).toLocaleString("en-IN")}). ` +
          "Losses on other trades, trading fees and funding paid are NOT deductible and cannot be set off (s.115BBH(2)).",
      });
      const lossesIgnored = sum(perpRows, (r) => Math.max(0, -r.realized));
      if (lossesIgnored > 0) {
        assumptions.push(`₹${money(lossesIgnored).toLocaleString("en-IN")} of perp losses ignored — VDA losses cannot be set off or carried forward.`);
      }
      uncertainties.push(
        "Whether a perpetual futures position on a DEX is a 'transfer of VDA' (s.2(47A)) or a non-VDA derivative taxed as business income is not settled. Switch the profile to 'Business / trader' to see the business-income treatment.",
        "Treating funding receipts as VDA income is an interpretation; they could also be 'income from other sources' at slab rates.",
      );
    } else {
      // Non-speculative business income (derivative trading), net of fees and funding.
      if (perpNet >= 0) slabExtra += perpNet;
      else carry += -perpNet;
      lines.push({
        label: "Perpetual DEX trading (business income)",
        category: "Profits and gains of business — non-speculative",
        baseLocal: money(Math.max(0, perpNet)),
        rate: "Slab rates",
        taxLocal: 0, // filled below once slab tax is known
        rule: "s.28 / s.43(5) Income-tax Act (assumed non-VDA derivative)",
        explanation: `Net of realized P&L, funding and fees: ₹${money(perpNet).toLocaleString("en-IN")}. Losses may be carried forward for 8 years (s.72).`,
      });
      assumptions.push("Perp trading treated as a non-speculative business in derivatives, NOT as VDA transfers (s.115BBH would otherwise apply).");
      uncertainties.push("A tax audit (s.44AB) may be required depending on turnover; books of account (s.44AA) are likely required.");
    }

    // NFTs are VDA (s.2(47A), CBDT Notification 75/2022): s.115BBH applies whatever the trader type,
    // each sale taxed on its own gain, losses ignored.
    const nft = nftResults(rows);
    if (nft.count) {
      const tax = nft.gainsOnly * VDA_RATE;
      specialTax += tax;
      lines.push({
        label: "NFT sales (VDA)",
        category: "Income from transfer of Virtual Digital Assets",
        baseLocal: money(nft.gainsOnly),
        rate: "30%",
        taxLocal: money(tax),
        rule: "s.115BBH Income-tax Act; NFTs notified as VDA (CBDT Notification 75/2022)",
        explanation: `Gain on each profitable NFT sale summed (${nft.count} sales, net ₹${money(nft.net).toLocaleString("en-IN")}). Losing sales cannot be set off against gains (s.115BBH(2)).`,
      });
      uncertainties.push("NFTs whose transfer also transfers a tangible asset (e.g. a property or physical item) are excluded from VDA by Notification 75/2022; this estimate treats all NFTs as VDA.", ...nftUncertainties(nft));
    }

    // Prediction markets: s.115BB winnings from betting/gambling — gross winnings, no deductions or set-off.
    const markets = marketResults(rows);
    const winnings = sum(markets, (m) => Math.max(0, m.net));
    const pmLosses = sum(markets, (m) => Math.max(0, -m.net));
    if (markets.length) {
      const tax = winnings * BETTING_RATE;
      specialTax += tax;
      lines.push({
        label: "Prediction market winnings",
        category: "Winnings from betting / gambling",
        baseLocal: money(winnings),
        rate: "30%",
        taxLocal: money(tax),
        rule: "s.115BB Income-tax Act",
        explanation: `Net profit of each winning market summed (${markets.filter((m) => m.net > 0).length} markets). Losing markets (₹${money(pmLosses).toLocaleString("en-IN")}) cannot be deducted. Basic exemption and s.87A rebate do not apply.`,
      });
      uncertainties.push("Prediction-market contracts could alternatively be treated as 'online games' (s.115BBJ, also 30% on net winnings) or as VDA. All produce 30% but differ in how winnings are netted.");
    }

    const rewards = sum(rows, (r) => r.reward);
    if (rewards) {
      slabExtra += rewards;
      lines.push({
        label: "Referral rewards & trading incentives",
        category: business ? "Business income" : "Income from other sources",
        baseLocal: money(rewards),
        rate: "Slab rates",
        taxLocal: 0,
        rule: business ? "s.28" : "s.56(1)",
        explanation: "Rewards received in USDC, valued at the ECB rate on the day received.",
      });
    }

    const schedule = slabSchedule(p);
    const slabTax = schedule(other + slabExtra) - schedule(other);
    // Allocate slab tax proportionally across slab lines for display
    const slabLines = lines.filter((l) => l.rate === "Slab rates");
    const slabBase = sum(slabLines, (l) => l.baseLocal);
    for (const l of slabLines) l.taxLocal = money(slabBase ? (slabTax * l.baseLocal) / slabBase : 0);

    const totalIncome = other + slabExtra + sum(lines.filter((l) => l.rate !== "Slab rates"), (l) => l.baseLocal);
    const sRate = surchargeRate(totalIncome);
    const preCess = (specialTax + slabTax) * (1 + sRate);
    const cess = preCess * CESS;
    const taxLocal = money(preCess + cess);
    if (sRate) {
      lines.push({ label: "Surcharge", category: "Surcharge", baseLocal: money(specialTax + slabTax), rate: `${sRate * 100}%`, taxLocal: money((specialTax + slabTax) * sRate), rule: "Finance Act — surcharge on total income above ₹50 lakh", explanation: "Marginal relief on surcharge (only for income just above ₹50 lakh, ₹1 crore or ₹2 crore) is not modelled." });
    }
    lines.push({ label: "Health & Education Cess", category: "Cess", baseLocal: money(preCess), rate: "4%", taxLocal: money(cess), rule: "Finance Act — Health and Education Cess", explanation: "4% of income tax plus surcharge." });

    if (input.taxYear.start >= Date.UTC(2026, 3, 1))
      uncertainties.push("From 1 April 2026 the Income-tax Act, 2025 replaces the 1961 Act (\"tax year\" replaces previous/assessment year). The 30% VDA rule, the 30% betting rule and these slabs carry over, but under new section numbers (e.g. the VDA definition, which includes NFTs, moves to s.2(111)); the references here use the 1961 Act's numbering.");
    if (!params) missing.push(`No verified parameters for ${input.taxYear.id}; FY2025-26 rates applied.`);
    else if (!params.verified) uncertainties.push(`${input.taxYear.id} slab rates assumed unchanged from FY2025-26 — verify against the latest Finance Act.`);
    if (rows.length && !business) uncertainties.push("1% TDS (s.194S) may have applied on Indian exchanges; DEX trades generally have no TDS deducted. TDS credits are not modelled.");

    const taxable = sum(lines.filter((l) => l.category !== "Cess" && l.category !== "Surcharge"), (l) => l.baseLocal);
    return {
      country: "IN",
      moduleVersion: VERSION,
      rulesEffective: input.taxYear.start >= Date.UTC(2026, 3, 1) ? "Income-tax Act, 2025 (from 1 Apr 2026; VDA and slab rules carried over from the 1961 Act)" : "Finance Act 2022 (s.115BBH from 1 Apr 2022); Finance Act 2025 slabs",
      taxYear: input.taxYear,
      currency: "INR",
      ...finalUsd(input, "INR", taxLocal),
      taxLocal,
      taxableLocal: money(taxable),
      netTradingLocal: money(sum(rows, (r) => r.realized + r.funding - r.fee + r.reward)),
      lines,
      methodology: [
        "Each event is converted to INR at the ECB USD/INR reference rate on its date (most recent prior business day).",
        business
          ? "Perp P&L is netted for the year (realized + funding − fees) and taxed as business income at slab rates."
          : "Every profitable closing trade is taxed separately at 30%; losses are ignored per s.115BBH.",
        "Prediction-market results are grouped by market; positive markets are taxed at 30% under s.115BB.",
        "Slab tax is computed incrementally on top of the other income you entered; 4% cess is added at the end.",
      ],
      assumptions,
      uncertainties,
      missing,
      reporting: [
        "ITR-2 (individual, capital gains / other income) or ITR-3 (business income).",
        "Schedule VDA for virtual digital asset transfers.",
        "Schedule FA if holding foreign assets — DEX positions may need disclosure.",
      ],
      references: [
        { title: "Income-tax Act s.115BBH (VDA)", url: "https://incometaxindia.gov.in/Pages/acts/income-tax-act.aspx" },
        { title: "Income Tax Department — VDA FAQs", url: "https://incometaxindia.gov.in" },
        { title: "Section 115BB — winnings from betting", url: "https://incometaxindia.gov.in/Pages/acts/income-tax-act.aspx" },
        { title: "Taxscan: VDAs under the Income-tax Act, 2025", url: "https://www.taxscan.in/top-stories/vdas-under-income-tax-act-2025-complete-guide-to-taxation-and-compliance-download-pdf-1449367" },
      ],
      carryForwardLossLocal: money(carry),
      eventsInYear: inYearCount(input),
      unsupportedYear: params ? undefined : input.taxYear.id,
    };
  },
};
