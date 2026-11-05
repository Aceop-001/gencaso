import { COMMON_UNCERTAINTIES, finalUsd, inYearCount, isPerp, localize, marketResults, money, nftResults, nftUncertainties, progressiveTax, sum, utcYear, type Bracket } from "../common";
import type { Jurisdiction, TaxInput, TaxLine, TaxResult } from "../types";

/**
 * Australia — Income Tax Assessment Act 1997 (ITAA 1997), resident individual.
 * Module v1.0.0. Income year 1 July – 30 June.
 */

const VERSION = "AU-1.3.0";

const STAGE3: Bracket[] = [
  { upTo: 18_200, rate: 0 },
  { upTo: 45_000, rate: 0.16 },
  { upTo: 135_000, rate: 0.3 },
  { upTo: 190_000, rate: 0.37 },
  { upTo: Infinity, rate: 0.45 },
];

// medicareLow: single low-income threshold below which no Medicare levy is due; above it the levy
// phases in at 10c per dollar until it reaches the full 2% (2024-25: $27,222–$34,027; 2025-26: $28,011–$35,013)
const YEARS: Record<string, { brackets: Bracket[]; verified: boolean; medicareLow: number; medicareAssumed?: boolean }> = {
  "2024-25": { brackets: STAGE3, verified: true, medicareLow: 27_222 },
  "2025-26": { brackets: STAGE3, verified: true, medicareLow: 28_011 },
  // 16% rate legislated to fall to 15% from 1 July 2026.
  "2026-27": { brackets: STAGE3.map((b) => (b.rate === 0.16 ? { ...b, rate: 0.15 } : b)), verified: true, medicareLow: 28_011, medicareAssumed: true }, // 15% legislated (Act No. 28 of 2025)
};

const MEDICARE = 0.02;
const YEAR_MS = 365 * 86_400_000;

/** Low Income Tax Offset (s.61-115 ITAA 1997) */
function lito(taxable: number) {
  if (taxable <= 37_500) return 700;
  if (taxable <= 45_000) return 700 - (taxable - 37_500) * 0.05;
  if (taxable <= 66_667) return Math.max(0, 325 - (taxable - 45_000) * 0.015);
  return 0;
}

export const Australia: Jurisdiction = {
  code: "AU",
  name: "Australia",
  flag: "🇦🇺",
  currency: "AUD",
  locale: "en-AU",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf(ms) {
    const d = new Date(ms);
    const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    const id = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    return utcYear(id, `${id} income year (1 Jul ${y} – 30 Jun ${y + 1})`, y, 6, 1);
  },
  calculate(input: TaxInput): TaxResult {
    const params = YEARS[input.taxYear.id];
    const p = params ?? YEARS["2025-26"];
    const { rows, missing } = localize(input, "AUD");
    const other = Math.max(0, input.profile.otherIncomeLocal);
    const business = input.profile.traderType === "business";
    const lines: TaxLine[] = [];
    const uncertainties = [...COMMON_UNCERTAINTIES];

    const medicare = (x: number) => (x <= p.medicareLow ? 0 : Math.min(x * MEDICARE, (x - p.medicareLow) * 0.1));
    const schedule = (x: number) => Math.max(0, progressiveTax(x, p.brackets) - lito(x)) + medicare(x);
    const perpRows = rows.filter(isPerp);
    const perpNet = sum(perpRows, (r) => r.realized + r.funding - r.fee);
    const rewards = sum(rows, (r) => r.reward);
    // NFTs are CGT assets (ATO: NFTs and crypto assets), discounted after 12 months like any other
    const nft = nftResults(rows);
    let carry = 0;
    let addToIncome = rewards;

    if (!business) {
      // Capital account: CGT event C2 on closing; 50% discount for lots held > 12 months (s.115-25).
      const longRows = perpRows.filter((r) => r.e.openedAt !== undefined && r.e.timestamp - r.e.openedAt > YEAR_MS);
      const discountable = Math.max(0, sum(longRows, (r) => r.realized - r.fee) + nft.long);
      const gross = perpNet + nft.net;
      let netCapitalGain = 0;
      if (gross > 0) {
        // Losses applied to non-discountable gains first (s.102-5 method statement), then discount.
        const nonDisc = gross - Math.min(discountable, gross);
        const disc = Math.min(discountable, gross);
        netCapitalGain = nonDisc + disc * 0.5;
      } else carry = -gross;
      addToIncome += netCapitalGain;
      lines.push({
        label: nft.count ? "Perpetual DEX and NFT results" : "Perpetual DEX results",
        category: "Net capital gain",
        baseLocal: money(netCapitalGain),
        rate: "Marginal rates + 2% Medicare",
        taxLocal: 0,
        rule: nft.count ? "ITAA 1997 s.102-5, s.104-25 (C2, perps), s.104-10 (A1, NFT sales), Div 115 discount" : "ITAA 1997 s.102-5, s.104-25 (CGT event C2), Div 115 discount",
        explanation:
          gross > 0
            ? `Net capital result A$${money(gross).toLocaleString("en-AU")} (realized + funding − fees${nft.count ? `; NFTs A$${money(nft.net).toLocaleString("en-AU")}` : ""})${discountable ? `, 50% discount applied to A$${money(discountable).toLocaleString("en-AU")} held over 12 months` : ""}. Added to assessable income.`
            : `Net capital loss A$${money(-gross).toLocaleString("en-AU")} — can only offset future capital gains; carried forward.`,
      });
      if (nft.count) uncertainties.push("An NFT bought mainly for personal use or enjoyment for under A$10,000 can be a personal use asset whose gain is disregarded (s.118-10); this estimate taxes every NFT sale.", ...nftUncertainties(nft));
      uncertainties.push("The ATO may treat frequent perp/CFD trading as on revenue account (ordinary income/losses) even for individuals. Switch the profile to 'Business / trader' to compare.");
    } else {
      addToIncome += perpNet + nft.net;
      lines.push({ label: nft.count ? "Perpetual DEX and NFT trading" : "Perpetual DEX trading", category: "Ordinary income (revenue account)", baseLocal: money(perpNet + nft.net), rate: "Marginal rates + 2% Medicare", taxLocal: 0, rule: "ITAA 1997 s.6-5 / s.8-1", explanation: "Net trading profit or loss on revenue account; losses reduce other income subject to non-commercial loss rules (Div 35)." });
      uncertainties.push("Non-commercial loss rules (Div 35) may defer business losses — not modelled.");
    }

    if (rewards) {
      lines.push({ label: "Rewards & incentives", category: "Ordinary income", baseLocal: money(rewards), rate: "Marginal rates", taxLocal: 0, rule: "ITAA 1997 s.6-5", explanation: "Market value in AUD when received." });
    }

    // A revenue-account loss would reduce tax on other income; that saving is reported as a loss, not a negative tax.
    if (business && addToIncome < 0) carry = -addToIncome;
    const tax = schedule(other + Math.max(0, addToIncome)) - schedule(other);
    const taxLocal = money(Math.max(0, tax));
    const positive = lines.filter((l) => l.baseLocal > 0);
    const base = sum(positive, (l) => l.baseLocal);
    for (const l of positive) l.taxLocal = money(base ? (taxLocal * l.baseLocal) / base : 0);

    const markets = marketResults(rows);
    if (markets.length) {
      lines.push({ label: "Prediction market results", category: "Gambling — not assessable", baseLocal: money(sum(markets, (m) => m.net)), rate: "0%", taxLocal: 0, rule: "Gambling winnings of recreational punters are not ordinary income (ATO guidance; Evans v FCT)", explanation: "Not taxed; losses not deductible." });
      uncertainties.push("The ATO could treat prediction-market shares as crypto assets / derivatives subject to CGT rather than gambling.");
    }
    if (p.medicareAssumed) uncertainties.push(`The ${input.taxYear.id} Medicare levy low-income threshold is not yet confirmed; the 2025-26 threshold is used.`);
    if (!params) missing.push(`No parameters for ${input.taxYear.id}; 2025-26 rates applied.`);
    else if (!params.verified) uncertainties.push(`${input.taxYear.id} uses the legislated 15% second bracket — verify before filing.`);

    return {
      country: "AU",
      moduleVersion: VERSION,
      rulesEffective: "Stage 3 tax cuts from 1 July 2024",
      taxYear: input.taxYear,
      currency: "AUD",
      ...finalUsd(input, "AUD", taxLocal),
      taxLocal,
      taxableLocal: money(Math.max(0, addToIncome)),
      netTradingLocal: money(sum(rows, (r) => r.realized + r.funding - r.fee + r.reward)),
      lines,
      methodology: [
        "Events converted to AUD at the ECB reference rate on each date.",
        business ? "Perp results taxed on revenue account as ordinary income." : "Perp results netted to a net capital gain; losses carried forward.",
        "Tax = increase in resident tax (incl. LITO and 2% Medicare levy) over your other income.",
      ],
      assumptions: [
        "Australian resident individual for the full income year.",
        `Other taxable income entered: A$${other.toLocaleString("en-AU")}.`,
        "No prior-year capital losses; Medicare levy surcharge not applicable.",
        `Medicare levy for a single person: nil up to A$${p.medicareLow.toLocaleString("en-AU")}, then 10c per dollar until it reaches 2%.`,
      ],
      uncertainties,
      missing,
      reporting: ["Individual tax return — Capital gains (item 18) or business schedule", "Keep records of each crypto transaction (ATO)"],
      references: [
        { title: "ATO — Crypto asset investments", url: "https://www.ato.gov.au/individuals-and-families/investments-and-assets/crypto-asset-investments" },
        { title: "ATO — Individual income tax rates", url: "https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents" },
        { title: "ATO — Gambling winnings", url: "https://www.ato.gov.au" },
      ],
      carryForwardLossLocal: money(carry),
      eventsInYear: inYearCount(input),
      unsupportedYear: params ? undefined : input.taxYear.id,
    };
  },
};
