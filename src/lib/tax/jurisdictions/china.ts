import { basics, buildResult, calendarYear, money, money0, nftUncertainties, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * China (mainland) — no crypto-specific tax law. Residents are taxed on worldwide income;
 * gains on virtual currency are generally treated as property-transfer income (20%,
 * SAT Guoshuihan [2008] No. 818) and winnings as incidental income (20%). Module v1.0.0. Calendar year.
 */

const VERSION = "CN-1.1.0";
const YEARS: Record<string, null> = { "2024": null, "2025": null, "2026": null };
const RATE = 0.2;

const cny = (n: number) => money0(n, "CNY", "zh-CN");

export const China: Jurisdiction = {
  code: "CN",
  name: "China",
  flag: "🇨🇳",
  currency: "CNY",
  locale: "zh-CN",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "CNY");
    const lines: TaxLine[] = [];
    const perpTax = Math.max(0, b.perpNet) * RATE;
    // NFT resales: property transfer income too; each sale with a gain is taxed on its own
    const nftTax = b.nft.gainsOnly * RATE;
    const winTax = (b.pmWins + Math.max(0, b.rewards)) * RATE;

    lines.push({
      label: "Perpetual DEX gains",
      category: "Property transfer income (财产转让所得)",
      baseLocal: money(b.perpNet),
      rate: "20%",
      taxLocal: money(perpTax),
      rule: "Individual Income Tax Law art. 2–3; SAT Guoshuihan [2008] No. 818 (virtual currency)",
      explanation: b.perpNet > 0 ? `Net gain ${cny(b.perpNet)} at 20%.` : `Net loss of ${cny(-b.perpNet)}: no tax.`,
    });
    if (b.nft.count)
      lines.push({
        label: "NFT sales",
        category: "Property transfer income (财产转让所得)",
        baseLocal: money(b.nft.gainsOnly),
        rate: "20%",
        taxLocal: money(nftTax),
        rule: "Individual Income Tax Law art. 2(8), art. 6(5): proceeds less original value and reasonable costs",
        explanation: `Gain on each profitable NFT sale at 20% (${b.nft.count} sales, net ${cny(b.nft.net)}). Losing sales are not offset.`,
      });
    if (b.markets.length || b.rewards)
      lines.push({
        label: "Prediction market wins & rewards",
        category: "Incidental income (偶然所得)",
        baseLocal: money(b.pmWins + b.rewards),
        rate: "20%",
        taxLocal: money(winTax),
        rule: "Individual Income Tax Law art. 2(9), art. 3(3)",
        explanation: "Each winning market taxed at 20% on its own; losing markets are not deductible.",
      });

    return buildResult(input, {
      country: "CN",
      version: VERSION,
      rulesEffective: "Individual Income Tax Law (2018 revision)",
      currency: "CNY",
      rows: b.rows,
      taxLocal: perpTax + nftTax + winTax,
      taxableLocal: Math.max(0, b.perpNet) + b.nft.gainsOnly + b.pmWins + b.rewards,
      lines,
      methodology: ["Events converted to CNY at the ECB reference rate on each date.", "Perp results netted for the year at 20%; prediction-market wins taxed per market at 20%."],
      assumptions: ["Mainland China tax resident (worldwide income)."],
      uncertainties: [
        "Mainland China prohibits crypto trading services; tax liability on overseas gains can exist regardless. This is not legal advice.",
        "Property-transfer income is computed per transaction in principle; netting across the year is an approximation.",
        "Since 2025, overseas-income enforcement (CRS data) has increased; foreign tax credits are not modelled.",
        ...(b.nft.count ? ["China allows NFTs only as non-tradable 'digital collectibles'; secondary sales of crypto NFTs have no specific tax guidance, so 20% property-transfer treatment per sale is assumed.", ...nftUncertainties(b.nft)] : []),
      ],
      missing: b.missing,
      reporting: ["Annual IIT reconciliation (overseas income) by 30 June of the following year"],
      references: [
        { title: "Caixin: China's tax dragnet closes in on overseas assets (2025)", url: "https://www.caixinglobal.com/2025-08-20/chinas-tax-dragnet-closes-in-on-overseas-assets-102353599.html" },
        { title: "State Taxation Administration", url: "https://www.chinatax.gov.cn/" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
      provisional: "No crypto-specific rules; general 20% treatment assumed",
    });
  },
};
