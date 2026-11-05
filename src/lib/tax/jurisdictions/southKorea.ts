import { basics, buildResult, calendarYear, money, money0, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * South Korea — virtual-asset income tax (Income Tax Act, other income, separate taxation)
 * was deferred to 1 Jan 2027 by the December 2024 amendment: until then individual crypto
 * gains are not taxed. From 2027: 22% (20% + 2% local) on annual net gains above ₩2.5m.
 * Module v1.0.0. Calendar year.
 */

const VERSION = "KR-1.2.0";
const YEARS: Record<string, { inForce: boolean }> = { "2025": { inForce: false }, "2026": { inForce: false }, "2027": { inForce: true } };
const DEDUCTION = 2_500_000;
const RATE = 0.22;

const won = (n: number) => money0(n, "KRW", "ko-KR");

export const SouthKorea: Jurisdiction = {
  code: "KR",
  name: "South Korea",
  flag: "🇰🇷",
  currency: "KRW",
  locale: "ko-KR",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { p, unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "KRW");
    const lines: TaxLine[] = [];
    const net = b.perpNet + b.pmNet + b.rewards;
    const taxable = p.inForce ? Math.max(0, net - DEDUCTION) : 0;
    const taxDue = taxable * RATE;

    lines.push(
      p.inForce
        ? {
            label: "Virtual asset income (perps, prediction markets, rewards)",
            category: "Other income — separate taxation",
            baseLocal: money(net),
            rate: "22% above ₩2.5m",
            taxLocal: money(taxDue),
            rule: "Income Tax Act art. 21(1)27 and art. 64-3 (in force from 1 Jan 2027)",
            explanation: net > 0 ? `Net ${won(net)} less the ₩2,500,000 basic deduction = ${won(taxable)} at 22% (20% income tax + 2% local).` : `Net loss of ${won(-net)}: no tax; losses are not carried forward.`,
          }
        : {
            label: "Virtual asset income (perps, prediction markets, rewards)",
            category: "Not yet taxable",
            baseLocal: money(net),
            rate: "0%",
            taxLocal: 0,
            rule: "Virtual-asset taxation deferred to 1 Jan 2027 (Income Tax Act amendment, Dec 2024)",
            explanation: "Individual gains on virtual assets realised before 2027 are not subject to income tax.",
          },
    );

    // Unique, collectible NFTs are not virtual assets (FSC guidelines, June 2024), so they stay outside this tax
    if (b.nft.count)
      lines.push({
        label: "NFT sales",
        category: "Not virtual assets — not taxed",
        baseLocal: money(b.nft.net),
        rate: "0%",
        taxLocal: 0,
        rule: "FSC guidelines on when NFTs qualify as virtual assets (10 June 2024); Virtual Asset User Protection Act and its Enforcement Decree",
        explanation: "Unique, collectible NFTs are not virtual assets, so they fall outside virtual-asset income. Individuals have no other tax on them.",
      });

    return buildResult(input, {
      country: "KR",
      version: VERSION,
      rulesEffective: "Virtual-asset income tax from 1 Jan 2027",
      currency: "KRW",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: taxable,
      lines,
      methodology: ["Events converted to KRW at the ECB reference rate on each date.", "From 2027: all virtual-asset results netted for the year; ₩2.5m deducted; 22% on the rest."],
      assumptions: ["Korean resident individual."],
      uncertainties: [
        "On 3 November 2026 ruling-party members of the Finance and Economy Committee recommended delaying the tax by about two years (to 2029), and a bill to do so is planned for passage by the end of November. Until the National Assembly passes it, 1 January 2027 remains law and the Finance Ministry says it will apply.",
        "It is not settled whether offshore DEX perpetuals and prediction-market shares count as 'virtual assets' under the Act.",
        ...(b.nft.count ? ["NFTs issued in large series, split into fractions, or usable as payment can be virtual assets under the FSC guideline; those would be taxed like other virtual assets from 2027."] : []),
      ],
      missing: b.missing,
      reporting: p.inForce ? ["Annual return in May of the following year"] : ["No crypto income reporting before 2027"],
      references: [
        { title: "Cointelegraph: Korea confirms 22% crypto tax from January 2027", url: "https://cointelegraph.com/news/south-korea-confirms-22-crypto-tax-will-go-ahead-in-january-2027-report" },
        { title: "Asia Economy: deferral excluded from July 2026 tax bill", url: "https://www.asiae.co.kr/en/article/2026051109524277542" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
      provisional: "Tax starts 1 Jan 2027 by law; a delay to 2029 is being pushed in the Assembly (Nov 2026)",
    });
  },
};
