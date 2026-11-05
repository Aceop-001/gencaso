import { COMMON_UNCERTAINTIES, finalUsd, inYearCount, isPerp, localize, money, nftResults, nftUncertainties, progressiveTax, sum, utcYear, type Bracket } from "../common";
import type { Jurisdiction, TaxInput, TaxLine, TaxResult } from "../types";

/**
 * United States — federal income tax only (Internal Revenue Code), single filer.
 * Module v1.0.0. Tax year = calendar year.
 */

const VERSION = "US-1.1.0";

interface YearParams {
  brackets: Bracket[];
  standardDeduction: number;
  ltcg: { zeroUpTo: number; fifteenUpTo: number };
  source: string;
}

const YEARS: Record<string, YearParams> = {
  "2024": {
    brackets: [
      { upTo: 11_600, rate: 0.1 }, { upTo: 47_150, rate: 0.12 }, { upTo: 100_525, rate: 0.22 },
      { upTo: 191_950, rate: 0.24 }, { upTo: 243_725, rate: 0.32 }, { upTo: 609_350, rate: 0.35 }, { upTo: Infinity, rate: 0.37 },
    ],
    standardDeduction: 14_600,
    ltcg: { zeroUpTo: 47_025, fifteenUpTo: 518_900 },
    source: "Rev. Proc. 2023-34",
  },
  "2025": {
    brackets: [
      { upTo: 11_925, rate: 0.1 }, { upTo: 48_475, rate: 0.12 }, { upTo: 103_350, rate: 0.22 },
      { upTo: 197_300, rate: 0.24 }, { upTo: 250_525, rate: 0.32 }, { upTo: 626_350, rate: 0.35 }, { upTo: Infinity, rate: 0.37 },
    ],
    standardDeduction: 15_750, // as amended by P.L. 119-21 (2025)
    ltcg: { zeroUpTo: 48_350, fifteenUpTo: 533_400 },
    source: "Rev. Proc. 2024-40; P.L. 119-21",
  },
  "2026": {
    brackets: [
      { upTo: 12_400, rate: 0.1 }, { upTo: 50_400, rate: 0.12 }, { upTo: 105_700, rate: 0.22 },
      { upTo: 201_775, rate: 0.24 }, { upTo: 256_225, rate: 0.32 }, { upTo: 640_600, rate: 0.35 }, { upTo: Infinity, rate: 0.37 },
    ],
    standardDeduction: 16_100,
    ltcg: { zeroUpTo: 49_450, fifteenUpTo: 545_500 },
    source: "Rev. Proc. 2025-32",
  },
};

const CAPITAL_LOSS_LIMIT = 3_000; // IRC §1211(b)
const NIIT_RATE = 0.038; // IRC §1411
const NIIT_THRESHOLD = 200_000;
const YEAR_MS = 365 * 86_400_000;
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(money(n)).toLocaleString("en-US")}`;

export const UnitedStates: Jurisdiction = {
  code: "US",
  name: "United States",
  flag: "🇺🇸",
  currency: "USD",
  locale: "en-US",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf(ms) {
    const y = new Date(ms).getUTCFullYear();
    return utcYear(String(y), `Tax year ${y} (1 Jan – 31 Dec ${y})`, y, 0, 1);
  },
  calculate(input: TaxInput): TaxResult {
    const params = YEARS[input.taxYear.id];
    const p = params ?? YEARS["2026"];
    const { rows, missing } = localize(input, "USD");
    const other = Math.max(0, input.profile.otherIncomeLocal);
    const lines: TaxLine[] = [];

    // Capital treatment: each closing event is a disposition; fees reduce proceeds; funding assumed part of the contract's gain/loss.
    const isLong = (r: (typeof rows)[number]) => r.e.openedAt !== undefined && r.e.timestamp - r.e.openedAt > YEAR_MS;
    const tradeRows = rows.filter((r) => r.e.type !== "REWARD");
    const longTerm = sum(tradeRows.filter(isLong), (r) => r.realized - r.fee);
    const shortTerm = sum(tradeRows.filter((r) => !isLong(r)), (r) => r.realized + r.funding - r.fee);
    const perpNet = sum(tradeRows.filter(isPerp), (r) => r.realized + r.funding - r.fee);
    const pmNet = sum(tradeRows.filter((r) => r.e.category === "prediction"), (r) => r.realized - r.fee);
    // NFT sales are dispositions of property (Notice 2014-21) and are already in the totals above
    const nft = nftResults(rows);
    const rewards = sum(rows, (r) => r.reward);

    // Netting (§1222): net ST and LT, then cross-net.
    let st = shortTerm;
    let lt = longTerm;
    if (st < 0 && lt > 0) { const x = Math.min(-st, lt); st += x; lt -= x; }
    if (lt < 0 && st > 0) { const x = Math.min(-lt, st); lt += x; st -= x; }
    const netCapital = st + lt;
    let lossDeduction = 0;
    let carry = 0;
    if (netCapital < 0) {
      lossDeduction = Math.min(CAPITAL_LOSS_LIMIT, -netCapital);
      carry = -netCapital - lossDeduction;
    }

    const ordinaryWith = Math.max(0, other + rewards + Math.max(0, st) - lossDeduction - p.standardDeduction);
    const ordinaryWithout = Math.max(0, other - p.standardDeduction);
    const ordTax = (x: number) => progressiveTax(x, p.brackets);
    const stAndRewardsTax = ordTax(ordinaryWith) - ordTax(ordinaryWithout);

    // Long-term gains stacked on top of ordinary taxable income.
    const ltGain = Math.max(0, lt);
    const ltAt = (start: number, amount: number) => {
      const zero = Math.max(0, Math.min(amount, p.ltcg.zeroUpTo - start));
      const fifteen = Math.max(0, Math.min(amount - zero, p.ltcg.fifteenUpTo - Math.max(start, p.ltcg.zeroUpTo)));
      return fifteen * 0.15 + (amount - zero - fifteen) * 0.2;
    };
    const ltTax = ltAt(ordinaryWith, ltGain);

    const nii = Math.max(0, Math.max(0, st) + ltGain);
    const magi = other + rewards + netCapital + (netCapital < 0 ? -netCapital - lossDeduction : 0);
    const niit = NIIT_RATE * Math.max(0, Math.min(nii, magi - NIIT_THRESHOLD));

    lines.push({
      label: nft.count ? "Short-term capital gains (perps, prediction markets, NFTs)" : "Short-term capital gains (perps + prediction markets)",
      category: "Short-term capital gain/loss",
      baseLocal: money(shortTerm),
      rate: "Ordinary rates 10–37%",
      taxLocal: money(st > 0 ? stAndRewardsTax * (st / (st + rewards || 1)) : 0),
      rule: "IRC §1222(1)/(2); §1(j) rate schedule",
      explanation: `Perps net ${usd(perpNet)} (realized + funding − fees); prediction markets net ${usd(pmNet)}${nft.count ? `; NFTs held ≤ 1 year net ${usd(nft.short)}` : ""}. Positions held ≤ 1 year are short-term and taxed as ordinary income.`,
    });
    if (longTerm) {
      lines.push({ label: "Long-term capital gains", category: "Long-term capital gain/loss", baseLocal: money(longTerm), rate: "0/15/20%", taxLocal: money(ltTax), rule: "IRC §1(h)", explanation: nft.longCount ? `Closing events whose opening fill is more than one year earlier, including ${nft.longCount} NFT sale(s) net ${usd(nft.long)}.` : "Closing events whose opening fill is more than one year earlier." });
    }
    if (rewards) {
      lines.push({ label: "Rewards & incentives", category: "Ordinary income", baseLocal: money(rewards), rate: "Ordinary rates", taxLocal: money(stAndRewardsTax * (rewards / ((st > 0 ? st : 0) + rewards))), rule: "IRC §61 — gross income", explanation: "Valued at fair market value when received (Rev. Rul. 2023-14 analogue)." });
    }
    if (lossDeduction) {
      lines.push({ label: "Capital loss deduction", category: "Deduction", baseLocal: money(-lossDeduction), taxLocal: 0, rule: "IRC §1211(b)", explanation: `Net capital loss of $${money(-netCapital).toLocaleString()}; $3,000 deductible against ordinary income, $${money(carry).toLocaleString()} carried forward (§1212(b)).` });
    }
    if (niit) {
      lines.push({ label: "Net Investment Income Tax", category: "NIIT", baseLocal: money(nii), rate: "3.8%", taxLocal: money(niit), rule: "IRC §1411", explanation: "Applies to the lesser of net investment income and MAGI above $200,000 (single)." });
    }

    const taxLocal = money(stAndRewardsTax + ltTax + niit);
    const uncertainties = [
      ...COMMON_UNCERTAINTIES,
      "DEX perpetuals are not regulated futures contracts, so §1256 60/40 treatment is assumed NOT to apply.",
      "Treatment of perpetual funding payments is not addressed by IRS guidance; they are netted into short-term capital gain/loss here (they may instead be ordinary income/expense).",
      "Prediction-market contracts are treated as capital assets. They may instead be gambling income (Schedule 1, losses limited to winnings as an itemized deduction) — this can materially change the result.",
      "Wash-sale rules (§1091) are assumed not to apply to these contracts.",
      "State and local income taxes are not included.",
    ];
    if (nft.count) uncertainties.push("Long-term gains on NFTs that are collectibles (e.g. an NFT of artwork or a gem; IRS Notice 2023-27 look-through) are taxed at up to 28%, not 0/15/20%. This estimate uses the 0/15/20% rates.", ...nftUncertainties(nft));
    if (input.profile.traderType === "business") {
      uncertainties.push("Trader tax status (TTS) allows deducting expenses on Schedule C, but gains remain capital unless a §475(f) mark-to-market election was made — not modelled.");
    }
    if (!params) missing.push(`No parameters for tax year ${input.taxYear.id}; 2026 brackets applied.`);

    return {
      country: "US",
      moduleVersion: VERSION,
      rulesEffective: p.source,
      taxYear: input.taxYear,
      currency: "USD",
      ...finalUsd(input, "USD", taxLocal),
      taxLocal,
      taxableLocal: money(Math.max(0, Math.max(0, st) + rewards - lossDeduction) + ltGain),
      netTradingLocal: money(sum(rows, (r) => r.realized + r.funding - r.fee + r.reward)),
      lines,
      methodology: [
        "Every closing fill / settlement is a disposition; fees reduce proceeds.",
        "Holding period from the opening of the closed lot; ≤ 1 year is short-term.",
        "Short- and long-term results are netted per §1222, then $3,000 of net loss offsets ordinary income.",
        `Tax is the increase in federal tax over your entered other income ($${other.toLocaleString()}) after the $${p.standardDeduction.toLocaleString()} standard deduction.`,
      ],
      assumptions: [
        "US citizen or resident, filing single, taking the standard deduction.",
        `Other taxable income entered: $${other.toLocaleString()}.`,
        "No prior-year capital loss carryforward.",
      ],
      uncertainties,
      missing,
      reporting: ["Form 8949 and Schedule D (capital gains/losses)", "Form 1040 digital asset question", "Form 8960 if NIIT applies", "Schedule 1 for rewards"],
      references: [
        { title: "IRS — Digital assets", url: "https://www.irs.gov/filing/digital-assets" },
        { title: "IRS Notice 2014-21 / Rev. Rul. 2019-24", url: "https://www.irs.gov/businesses/small-businesses-self-employed/frequently-asked-questions-on-virtual-currency-transactions" },
        { title: "Topic 409 — Capital gains and losses", url: "https://www.irs.gov/taxtopics/tc409" },
        { title: "IRS Notice 2023-27 — NFTs as collectibles", url: "https://www.irs.gov/pub/irs-drop/n-23-27.pdf" },
      ],
      carryForwardLossLocal: money(carry),
      eventsInYear: inYearCount(input),
      unsupportedYear: params ? undefined : input.taxYear.id,
    };
  },
};
