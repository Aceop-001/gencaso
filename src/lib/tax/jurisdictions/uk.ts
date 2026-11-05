import { COMMON_UNCERTAINTIES, finalUsd, inYearCount, isPerp, localize, marketResults, money, nftResults, nftUncertainties, progressiveTax, sum, type Bracket } from "../common";
import type { Jurisdiction, TaxInput, TaxLine, TaxResult } from "../types";

/**
 * United Kingdom — Capital Gains Tax (TCGA 1992) and Income Tax (ITA 2007),
 * England/Wales/NI income tax bands. Module v1.0.0. Tax year 6 April – 5 April.
 */

const VERSION = "GB-1.2.0";
const TAPER_FROM = 100_000; // personal allowance falls by £1 per £2 of adjusted net income above this (ITA 2007 s.35)
const RATE_CHANGE = Date.UTC(2024, 9, 30); // CGT 10/20% → 18/24% for disposals from 30 Oct 2024

interface YearParams {
  aea: number;
  personalAllowance: number;
  basicBand: number;
  higherLimit: number; // taxable income where additional rate starts
  cgtBasic: number;
  cgtHigher: number;
  /** Rates for disposals before RATE_CHANGE (2024-25 only) */
  early?: { cgtBasic: number; cgtHigher: number };
}

const FROZEN = { aea: 3_000, personalAllowance: 12_570, basicBand: 37_700, higherLimit: 125_140, cgtBasic: 0.18, cgtHigher: 0.24 };
const YEARS: Record<string, YearParams> = {
  "2024-25": { ...FROZEN, early: { cgtBasic: 0.1, cgtHigher: 0.2 } },
  "2025-26": FROZEN,
  "2026-27": FROZEN,
};

export const UnitedKingdom: Jurisdiction = {
  code: "GB",
  name: "United Kingdom",
  flag: "🇬🇧",
  currency: "GBP",
  locale: "en-GB",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf(ms) {
    const d = new Date(ms);
    const afterStart = d.getUTCMonth() > 3 || (d.getUTCMonth() === 3 && d.getUTCDate() >= 6);
    const y = afterStart ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    const id = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    return { id, label: `${id} (6 Apr ${y} – 5 Apr ${y + 1})`, start: Date.UTC(y, 3, 6), end: Date.UTC(y + 1, 3, 6) };
  },
  calculate(input: TaxInput): TaxResult {
    const params = YEARS[input.taxYear.id];
    const p = params ?? YEARS["2025-26"];
    const { rows, missing } = localize(input, "GBP");
    const other = Math.max(0, input.profile.otherIncomeLocal);
    const lines: TaxLine[] = [];
    const uncertainties = [...COMMON_UNCERTAINTIES];
    const business = input.profile.traderType === "business";

    const allowance = (income: number) => Math.max(0, p.personalAllowance - Math.max(0, income - TAPER_FROM) / 2);
    const incomeTax = (x: number) => {
      const pa = allowance(x);
      const bands: Bracket[] = [
        { upTo: pa, rate: 0 },
        { upTo: pa + p.basicBand, rate: 0.2 },
        { upTo: Math.max(pa + p.basicBand, p.higherLimit), rate: 0.4 },
        { upTo: Infinity, rate: 0.45 },
      ];
      return progressiveTax(x, bands);
    };

    const perpNet = sum(rows.filter(isPerp), (r) => r.realized + r.funding - r.fee);
    const nft = nftResults(rows); // NFTs are cryptoassets: CGT on disposal (CRYPTO22000), pooled with other gains
    const rewards = sum(rows, (r) => r.reward);
    let carry = 0;
    let cgt = 0;
    let gainsAfterAea = 0;
    let incomeExtra = rewards;

    if (!business) {
      const net = perpNet + nft.net;
      if (net > 0) {
        gainsAfterAea = Math.max(0, net - p.aea);
        const taxableIncome = Math.max(0, other + rewards - allowance(other + rewards));
        const basicLeft = Math.max(0, p.basicBand - taxableIncome);
        if (p.early) {
          // 2024-25: gains before 30 Oct 2024 at 10/20%, after at 18/24%. Losses and the AEA go first against
          // the later (higher-rate) gains (TCGA 1992 s.4B: the most beneficial order); the unused basic band
          // then goes to the earlier gains.
          const gainOf = (r: (typeof rows)[number]) => (isPerp(r) ? r.realized + r.funding - r.fee : r.realized);
          const cg = rows.filter((r) => isPerp(r) || r.e.category === "nft");
          let before = sum(cg.filter((r) => r.e.timestamp < RATE_CHANGE), gainOf);
          let after = sum(cg.filter((r) => r.e.timestamp >= RATE_CHANGE), gainOf);
          if (before < 0) { after += before; before = 0; }
          if (after < 0) { before += after; after = 0; }
          let aea = p.aea;
          const offA = Math.min(aea, after); after -= offA; aea -= offA;
          before -= Math.min(aea, before);
          const bandB = Math.min(before, basicLeft);
          const bandA = Math.min(after, basicLeft - bandB);
          cgt = bandB * p.early.cgtBasic + (before - bandB) * p.early.cgtHigher + bandA * p.cgtBasic + (after - bandA) * p.cgtHigher;
        } else {
          const atBasic = Math.min(gainsAfterAea, basicLeft);
          cgt = atBasic * p.cgtBasic + (gainsAfterAea - atBasic) * p.cgtHigher;
        }
      } else carry = -net;
      lines.push({
        label: nft.count ? "Perpetual DEX and NFT gains" : "Perpetual DEX gains",
        category: "Chargeable gains (CGT)",
        baseLocal: money(net),
        rate: p.early ? "10/20% before 30 Oct 2024, 18/24% after" : `${p.cgtBasic * 100}% / ${p.cgtHigher * 100}%`,
        taxLocal: money(cgt),
        rule: nft.count ? "TCGA 1992 s.143 (perps), s.21 (NFTs as cryptoassets); s.1K annual exempt amount" : "TCGA 1992 s.143 (futures / contracts for differences); s.1K annual exempt amount",
        explanation:
          net > 0
            ? `Net gain £${money(net).toLocaleString("en-GB")}${nft.count ? ` (perps £${money(perpNet).toLocaleString("en-GB")}, NFTs £${money(nft.net).toLocaleString("en-GB")})` : ""} less £${p.aea.toLocaleString()} annual exempt amount = £${money(gainsAfterAea).toLocaleString("en-GB")}; taxed at ${p.cgtBasic * 100}% within your unused basic-rate band, ${p.cgtHigher * 100}% above.`
            : `Net loss of £${money(-net).toLocaleString("en-GB")} — allowable loss to carry forward (must be claimed within 4 years).`,
      });
      if (p.early) uncertainties.push("2024-25 splits gains at 30 October 2024. The unused basic-rate band is applied to the earlier gains first (the larger saving); check how HMRC's calculation allocates it for your return.");
      uncertainties.push("HMRC's Cryptoassets Manual does not specifically address DEX perpetuals; CFD-style CGT treatment (s.143) is assumed. Funding is netted into the gain/loss.");
      if (nft.count) uncertainties.push("Each NFT is a distinct asset, so no section 104 pooling applies; same-day and 30-day matching rules are not modelled.", ...nftUncertainties(nft));
    } else {
      incomeExtra += perpNet + nft.net;
      if (perpNet + nft.net < 0) carry = -(perpNet + nft.net);
      uncertainties.push("Trading treatment (income tax on profits) requires 'badges of trade' — HMRC considers this rare for individuals. Class 4 NICs are not modelled.");
    }

    const incomeTaxExtra = incomeTax(other + Math.max(0, incomeExtra)) - incomeTax(other);
    if (business) {
      lines.push({ label: nft.count ? "Perpetual DEX and NFT trading profits" : "Perpetual DEX trading profits", category: "Trading income (income tax)", baseLocal: money(perpNet + nft.net), rate: "20/40/45%", taxLocal: money(rewards ? incomeTaxExtra * Math.max(0, perpNet + nft.net) / Math.max(1, Math.max(0, perpNet + nft.net) + rewards) : incomeTaxExtra), rule: "ITTOIA 2005 Part 2", explanation: "Net profit (realized + funding − fees) taxed as trading income." });
    }
    if (rewards) {
      lines.push({ label: "Rewards & incentives", category: business ? "Trading income" : "Miscellaneous income", baseLocal: money(rewards), rate: "20/40/45%", taxLocal: money(business ? incomeTaxExtra * rewards / Math.max(1, Math.max(0, perpNet + nft.net) + rewards) : incomeTaxExtra), rule: business ? "ITTOIA 2005 Part 2" : "ITTOIA 2005 s.687", explanation: "Value in GBP on the date received." });
    }

    const markets = marketResults(rows);
    if (markets.length) {
      const pmNet = sum(markets, (m) => m.net);
      lines.push({ label: "Prediction market results", category: "Betting winnings — not taxable", baseLocal: money(pmNet), rate: "0%", taxLocal: 0, rule: "Gambling winnings are outside the scope of UK income tax and CGT (TCGA 1992 s.51(1))", explanation: "Winnings are not taxed and losses are not deductible." });
      uncertainties.push("HMRC could view Polymarket shares as cryptoasset contracts subject to CGT rather than bets. If so, net prediction-market gains would be added to chargeable gains.");
    }

    if (!params) missing.push(`No parameters for ${input.taxYear.id}; 2025-26 values applied.`);
    const taxLocal = money(cgt + incomeTaxExtra);

    return {
      country: "GB",
      moduleVersion: VERSION,
      rulesEffective: "Autumn Budget 2024 CGT rates (from 30 Oct 2024); frozen allowances to 2027-28",
      taxYear: input.taxYear,
      currency: "GBP",
      ...finalUsd(input, "GBP", taxLocal),
      taxLocal,
      taxableLocal: money(gainsAfterAea + Math.max(0, incomeExtra)),
      netTradingLocal: money(sum(rows, (r) => r.realized + r.funding - r.fee + r.reward)),
      lines,
      methodology: [
        "Events converted to GBP at the ECB reference rate on each date.",
        "Perp disposals netted for the tax year; the annual exempt amount is deducted from net gains.",
        "CGT rate depends on unused basic-rate band after your other income.",
        "Prediction-market winnings treated as betting — not taxable.",
      ],
      assumptions: [
        "UK resident, domicile-neutral (post-April 2025 regime), England/Wales/NI income tax bands.",
        `Other taxable income entered: £${other.toLocaleString("en-GB")}.`,
        "Annual exempt amount not used elsewhere; no losses brought forward.",
        "Personal allowance reduced by £1 for every £2 of income above £100,000 (gone at £125,140).",
      ],
      uncertainties,
      missing,
      reporting: ["Self Assessment SA100 + SA108 (capital gains summary)", "Report if disposals exceed £50,000 or gains exceed the AEA", "Keep records per HMRC CRYPTO22000"],
      references: [
        { title: "HMRC Cryptoassets Manual", url: "https://www.gov.uk/hmrc-internal-manuals/cryptoassets-manual" },
        { title: "Capital Gains Tax rates and allowances", url: "https://www.gov.uk/capital-gains-tax/rates" },
        { title: "Income Tax rates and bands", url: "https://www.gov.uk/income-tax-rates" },
      ],
      carryForwardLossLocal: money(carry),
      eventsInYear: inYearCount(input),
      unsupportedYear: params ? undefined : input.taxYear.id,
    };
  },
};
