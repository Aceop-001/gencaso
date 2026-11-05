import { bands, basics, buildResult, calendarYear, money, money0, nftUncertainties, progressiveTax, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Japan — crypto gains are miscellaneous income (雑所得) taxed together with other income
 * at progressive national rates, plus 2.1% reconstruction surtax and 10% inhabitant tax.
 * Module v1.0.0. Calendar year.
 */

const VERSION = "JP-1.4.0";
const NATIONAL = bands([[1_950_000, 0.05], [3_300_000, 0.1], [6_950_000, 0.2], [9_000_000, 0.23], [18_000_000, 0.33], [40_000_000, 0.4], [Infinity, 0.45]]);
const SURTAX = 0.021;
const INHABITANT = 0.1;
const OCCASIONAL_DEDUCTION = 500_000;
// Inhabitant-tax basic deduction (地方税法): ¥430k, tapering above ¥24m of total income (unchanged by the 2025/2026 reforms)
const INHABITANT_BASIC: [number, number][] = [[24_000_000, 430_000], [24_500_000, 290_000], [25_000_000, 150_000], [Infinity, 0]];

// Basic deduction (基礎控除) by total income (合計所得金額): [income up to, deduction].
// 2025: 2025 reform, tiered ¥950k–¥580k. 2026: FY2026 reform (base ¥620k plus a special
// addition up to ¥4.89m / ¥6.55m). Above ¥23.5m it tapers to zero at ¥25m. Brackets unchanged since 2015.
const TAPER: [number, number][] = [[24_000_000, 480_000], [24_500_000, 320_000], [25_000_000, 160_000], [Infinity, 0]];
const YEARS: Record<string, { basic: [number, number][] }> = {
  "2024": { basic: TAPER },
  "2025": { basic: [[1_320_000, 950_000], [3_360_000, 880_000], [4_890_000, 680_000], [6_550_000, 630_000], [23_500_000, 580_000], ...TAPER] },
  "2026": { basic: [[4_890_000, 1_040_000], [6_550_000, 670_000], [23_500_000, 620_000], ...TAPER] },
};

const yen = (n: number) => money0(n, "JPY", "ja-JP");

export const Japan: Jurisdiction = {
  code: "JP",
  name: "Japan",
  flag: "🇯🇵",
  currency: "JPY",
  locale: "ja-JP",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { p, unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "JPY");
    const lines: TaxLine[] = [];
    const uncertainties: string[] = [];

    // Miscellaneous income: perps, NFT resales (continuous, for profit) and rewards. A net loss cannot
    // offset other income or be carried forward.
    const misc = b.perpNet + b.nft.net + b.rewards;
    // Prediction markets as occasional income: winning markets only, less ¥500k, half taxable.
    const occasional = Math.max(0, b.pmWins - OCCASIONAL_DEDUCTION) / 2;

    // The basic deduction depends on total income, so crypto income can also shrink it
    const basicFor = (total: number) => p.basic.find(([upTo]) => total <= upTo)![1];
    const totalWith = b.other + Math.max(0, misc) + occasional;
    const basic = basicFor(totalWith);
    const base = Math.max(0, b.other - basicFor(b.other));
    const withCrypto = Math.max(0, totalWith - basic);
    const added = withCrypto - base;
    const national = (progressiveTax(withCrypto, NATIONAL) - progressiveTax(base, NATIONAL)) * (1 + SURTAX);
    // Inhabitant tax: 10% on its own base, which uses the smaller ¥430k basic deduction
    const resBasic = (total: number) => INHABITANT_BASIC.find(([upTo]) => total <= upTo)![1];
    const inhabitant = (Math.max(0, totalWith - resBasic(totalWith)) - Math.max(0, b.other - resBasic(b.other))) * INHABITANT;
    const share = (x: number) => (added > 0 ? x / (Math.max(0, misc) + occasional) : 0);

    lines.push({
      label: b.nft.count ? "Perpetual DEX, NFT results & rewards" : "Perpetual DEX results & rewards",
      category: "Miscellaneous income (雑所得)",
      baseLocal: money(misc),
      rate: "5–45% + 2.1% surtax + 10% inhabitant",
      taxLocal: money((national + inhabitant) * share(Math.max(0, misc))),
      rule: b.nft.count ? "Income Tax Act art. 35; NTA FAQ on crypto assets; NTA FAQ on NFTs (NFTに関する税務上の取扱い, 2023)" : "Income Tax Act art. 35; NTA FAQ on crypto assets (暗号資産に関する税務上の取扱い)",
      explanation:
        misc > 0
          ? `Net ${yen(misc)}${b.nft.count ? ` (NFTs ${yen(b.nft.net)})` : ""} added to your other income and taxed at your marginal national rate (plus 2.1% surtax) and 10% inhabitant tax.`
          : `Net loss of ${yen(-misc)}: cannot offset other income and cannot be carried forward.`,
    });
    if (b.markets.length) {
      lines.push({
        label: "Prediction market winnings",
        category: "Occasional income (一時所得)",
        baseLocal: money(b.pmNet),
        rate: "½ of (wins − ¥500k) at marginal rates",
        taxLocal: money((national + inhabitant) * share(occasional)),
        rule: "Income Tax Act art. 34 (occasional income), art. 22(2)(ii) half inclusion",
        explanation: `Winning markets total ${yen(b.pmWins)}; less the ¥500,000 special deduction, half (${yen(occasional)}) is taxable. Losing markets are not deductible.`,
      });
      uncertainties.push("Prediction-market results could instead be treated as miscellaneous income (taxed in full with crypto gains). Occasional-income treatment is assumed.");
    }
    uncertainties.push(
      "Japan's Diet passed the Financial Instruments and Exchange Act amendments in July 2026 that make crypto a financial product; separate taxation at about 20% with a 3-year loss carry-forward is expected from 1 January 2028, only for specified crypto assets traded through registered Japanese businesses. Offshore DEX trading, NFTs and DeFi are not expected to qualify. Until then (and for these assets), the progressive rates here apply.",
      "Inhabitant tax (10%, with its own ¥430,000 basic deduction) is billed the following June; the flat per-capita levy (about ¥5,000) is not included.",
    );
    if (b.nft.count) uncertainties.push("The NTA treats an occasional NFT sale as transfer income (譲渡所得), with a ¥500,000 special deduction and half taxed after 5 years; repeated sales for profit are miscellaneous income, as assumed here. Occasional sellers may owe less.", ...nftUncertainties(b.nft));
    if (b.business) uncertainties.push("Large-scale crypto trading is still miscellaneous income in most cases; business-income treatment is not modelled.");

    return buildResult(input, {
      country: "JP",
      version: VERSION,
      rulesEffective: "Brackets since 2015; income-tiered basic deduction per the 2025 and FY2026 reforms",
      currency: "JPY",
      rows: b.rows,
      taxLocal: national + inhabitant,
      taxableLocal: added,
      lines,
      methodology: [
        "Events converted to JPY at the ECB reference rate on each date.",
        "Perp results (realized + funding − fees) and rewards netted for the calendar year as miscellaneous income.",
        "Tax is the difference between tax on your other income with and without the crypto income.",
      ],
      assumptions: [
        `Japanese resident. Other income entered (after employment-income deduction): ${yen(b.other)}.`,
        `Basic deduction ${yen(basic)} for total income of ${yen(totalWith)} (it is tiered by income); other deductions not modelled.`,
      ],
      uncertainties,
      missing: b.missing,
      reporting: ["Final return (確定申告) by 15 March of the following year", "Report if miscellaneous income exceeds ¥200,000 for salaried taxpayers"],
      references: [
        { title: "NTA: Tax treatment of crypto assets (FAQ)", url: "https://www.nta.go.jp/publication/pamph/shotoku/kakuteishinkokukankei/kasoutuka/index.htm" },
        { title: "NTA: Income tax rates (No.2260)", url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm" },
        { title: "NTA: Basic deduction (No.1199)", url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm" },
        { title: "PwC: Japan individual taxes", url: "https://taxsummaries.pwc.com/japan/individual/taxes-on-personal-income" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
    });
  },
};
