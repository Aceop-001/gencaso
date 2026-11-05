import { bands, basics, buildResult, money, money0, nftUncertainties, progressiveTax, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Singapore — no capital gains tax: an individual investor's gains on digital payment tokens
 * are not taxed; gains of someone trading as a business (badges of trade) are income at resident
 * rates. Gambling winnings are not taxable. Module v1.0.0.
 * Income year = calendar year, assessed in the following Year of Assessment (2025 → YA2026).
 */

const VERSION = "SG-1.1.0";
// Resident rates from YA2024 (income year 2023), PwC
const RATES = bands([
  [20_000, 0], [30_000, 0.02], [40_000, 0.035], [80_000, 0.07], [120_000, 0.115], [160_000, 0.15], [200_000, 0.18],
  [240_000, 0.19], [280_000, 0.195], [320_000, 0.2], [500_000, 0.22], [1_000_000, 0.23], [Infinity, 0.24],
]);
const YEARS: Record<string, null> = { "2024": null, "2025": null, "2026": null };

const sgd = (n: number) => money0(n, "SGD", "en-SG");

export const Singapore: Jurisdiction = {
  code: "SG",
  name: "Singapore",
  flag: "🇸🇬",
  currency: "SGD",
  locale: "en-SG",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf(ms) {
    const y = new Date(ms).getUTCFullYear();
    return { id: String(y), label: `${y} income (YA${y + 1})`, start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) };
  },
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "SGD");
    const lines: TaxLine[] = [];
    const uncertainties: string[] = [];
    const income = b.business ? b.perpNet + b.nft.net + b.rewards : 0;
    const taxDue = progressiveTax(b.other + Math.max(0, income), RATES) - progressiveTax(b.other, RATES);

    lines.push(
      b.business
        ? {
            label: b.nft.count ? "Perpetual DEX, NFT trading profits & rewards" : "Perpetual DEX trading profits & rewards",
            category: "Trade income",
            baseLocal: money(income),
            rate: "0–24%",
            taxLocal: money(taxDue),
            rule: "Income Tax Act 1947 s.10(1)(a); IRAS e-Tax Guide: Income Tax Treatment of Digital Tokens",
            explanation: income > 0 ? `Net profit ${sgd(income)} added to your chargeable income.` : `Trade loss of ${sgd(-income)}: can offset other income (not modelled).`,
          }
        : {
            label: b.nft.count ? "Perpetual DEX and NFT results" : "Perpetual DEX results",
            category: "Capital gains — not taxable",
            baseLocal: money(b.perpNet + b.nft.net),
            rate: "0%",
            taxLocal: 0,
            rule: "Singapore does not tax capital gains (IRAS e-Tax Guide on digital tokens)",
            explanation: "Gains from investment are capital in nature; losses are likewise not deductible.",
          },
    );
    if (b.markets.length)
      lines.push({ label: "Prediction market results", category: "Gambling winnings — not taxable", baseLocal: money(b.pmNet), rate: "0%", taxLocal: 0, rule: "Windfall/gambling gains are not income under the Income Tax Act", explanation: "Winnings are not taxed and losses are not deductible." });
    uncertainties.push(...nftUncertainties(b.nft));
    if (!b.business) {
      uncertainties.push("IRAS applies 'badges of trade': frequent, short-term or leveraged trading may be taxed as trade income. Switch the trader type to 'Business' to see that treatment.");
      if (b.rewards) uncertainties.push("Rewards are not taxed in this estimate; IRAS may treat tokens received for services or staking as income.");
    }
    uncertainties.push("One-off personal income tax rebates announced in Budgets are not applied.");

    return buildResult(input, {
      country: "SG",
      version: VERSION,
      rulesEffective: "Resident rates from YA2024",
      currency: "SGD",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: Math.max(0, income),
      lines,
      methodology: ["Events converted to SGD at the ECB reference rate on each date.", "Individual investors: no tax on capital gains or gambling winnings.", "Traders: net profit added to chargeable income at resident rates."],
      assumptions: [`Singapore tax resident. Other chargeable income entered (after reliefs): ${sgd(b.other)}.`],
      uncertainties,
      missing: b.missing,
      reporting: b.business ? ["Form B/B1 by 18 April (e-filing) of the Year of Assessment"] : ["No reporting for capital gains; keep records in case IRAS reviews the activity"],
      references: [
        { title: "IRAS e-Tax Guide: Income Tax Treatment of Digital Tokens", url: "https://www.iras.gov.sg/irashome/uploadedFiles/IRASHome/e-Tax_Guides/etaxguide_CIT_Income%20Tax%20Treatment%20of%20Digital%20Tokens_091020.pdf" },
        { title: "PwC: Singapore individual taxes", url: "https://taxsummaries.pwc.com/singapore/individual/taxes-on-personal-income" },
      ],
      carry: b.business ? -income : 0,
      unsupportedYear: unsupported,
    });
  },
};
