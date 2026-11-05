import { bands, basics, buildResult, calendarYear, money, money0, progressiveTax, yearParams, type Bracket } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Russia — digital currency is property for tax purposes (Federal Law No. 418-FZ of 29 Nov 2024).
 * From 2025 profit on digital-currency transactions forms its own tax base: 13% up to ₽2.4m,
 * 15% above; losses offset only digital-currency profits of the same year. Module v1.0.0. Calendar year.
 */

const VERSION = "RU-1.1.0";
// Main tax base from 2025 (Federal Law No. 176-FZ of 12 July 2024)
const MAIN_2025 = bands([[2_400_000, 0.13], [5_000_000, 0.15], [20_000_000, 0.18], [50_000_000, 0.2], [Infinity, 0.22]]);
const YEARS: Record<string, { threshold: number; mainScale: Bracket[] }> = {
  "2024": { threshold: 5_000_000, mainScale: bands([[5_000_000, 0.13], [Infinity, 0.15]]) }, // general NDFL scale before the 2025 reform
  "2025": { threshold: 2_400_000, mainScale: MAIN_2025 },
  "2026": { threshold: 2_400_000, mainScale: MAIN_2025 },
};

const rub = (n: number) => money0(n, "RUB", "ru-RU");

export const Russia: Jurisdiction = {
  code: "RU",
  name: "Russia",
  flag: "🇷🇺",
  currency: "RUB",
  locale: "ru-RU",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { p, unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "RUB");
    const rates = bands([[p.threshold, 0.13], [Infinity, 0.15]]);
    const profit = b.perpNet + b.pmNet + b.rewards;
    const taxDue = progressiveTax(Math.max(0, profit), rates);
    // NFTs are not digital currency (Law 259-FZ), so their gains go to the main NDFL base as property
    // sales (art. 220: proceeds less cost), taxed at the main scale on top of other income.
    const main = p.mainScale;
    const nftTax = b.nft.count ? progressiveTax(b.other + Math.max(0, b.nft.net), main) - progressiveTax(b.other, main) : 0;
    const lines: TaxLine[] = [
      {
        label: "Digital currency transactions (perps, prediction markets, rewards)",
        category: "Separate NDFL tax base — digital currency",
        baseLocal: money(profit),
        rate: `13% to ${rub(p.threshold)}, 15% above`,
        taxLocal: money(taxDue),
        rule: "Tax Code art. 214.11 and art. 224 as amended by Federal Law No. 418-FZ (29 Nov 2024)",
        explanation: profit > 0 ? `Net profit ${rub(profit)} taxed at 13% up to ${rub(p.threshold)} and 15% above.` : `Net loss of ${rub(-profit)}: offsets only digital-currency profit of the same year.`,
      },
    ];
    if (b.nft.count)
      lines.push({
        label: "NFT sales",
        category: "Main NDFL base — sale of property",
        baseLocal: money(b.nft.net),
        rate: input.taxYear.id === "2024" ? "13% / 15%" : "13–22% (main scale)",
        taxLocal: money(nftTax),
        rule: "Tax Code art. 208(1)(5), art. 220(2)(2) (cost deduction), art. 224(1) main scale",
        explanation: b.nft.net > 0 ? `Net gain ${rub(b.nft.net)} added to your other income (${rub(b.other)}) at the main progressive scale.` : `Net loss of ${rub(-b.nft.net)}: no tax.`,
      });

    return buildResult(input, {
      country: "RU",
      version: VERSION,
      rulesEffective: "Federal Law No. 418-FZ, from 1 Jan 2025",
      currency: "RUB",
      rows: b.rows,
      taxLocal: taxDue + nftTax,
      taxableLocal: Math.max(0, profit) + Math.max(0, b.nft.net),
      lines,
      methodology: [
        "Events converted to RUB using daily rates from fawazahmed0's currency-api (the ECB has published no RUB rate since 2022).",
        "All crypto results netted for the year into the digital-currency tax base.",
      ],
      assumptions: ["Russian tax resident (non-residents: 30%, not modelled)."],
      uncertainties: [
        "Whether perpetual contracts on a foreign DEX are 'transactions with digital currency' or derivatives is not settled; the digital-currency base is assumed.",
        "Prediction-market results are included in the same base; they could instead be treated as winnings from (unlicensed foreign) gambling.",
        "In 2024, before the digital-currency base existed, crypto income was taxed in the general base at 13% up to ₽5m and 15% above (the scale in force 2021–2024).",
        ...(b.nft.count ? ["NFTs have no specific tax status in Russia; they are treated as property, not digital currency. The 3-year holding exemption (art. 217 p.17.1) is not applied."] : []),
      ],
      missing: b.missing,
      reporting: ["3-NDFL return by 30 April; payment by 15 July of the following year"],
      references: [
        { title: "Interfax: crypto recognised as property for tax purposes (Nov 2024)", url: "https://interfax.com/newsroom/top-stories/108172/" },
        { title: "Alfa-Bank: how to pay tax on crypto sales in Russia", url: "https://kurs.alfabank.ru/articles/kak-platit-nalogi-s-prodazhi-kriptovalyuty-v-rf/" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
    });
  },
};
