import { basics, buildResult, calendarYear, money, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Türkiye — no crypto-specific income tax is in force for individuals. A March 2026 bill
 * (10% withholding on platform gains, 0.03% transaction tax) was submitted; reports say its
 * crypto provisions were withdrawn. Module v1.0.0. Calendar year.
 */

const VERSION = "TR-1.1.0";
const YEARS: Record<string, null> = { "2024": null, "2025": null, "2026": null };

export const Turkey: Jurisdiction = {
  code: "TR",
  name: "Türkiye",
  flag: "🇹🇷",
  currency: "TRY",
  locale: "tr-TR",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "TRY");
    const net = b.perpNet + b.pmNet + b.nft.net + b.rewards;
    const lines: TaxLine[] = [
      {
        label: b.nft.count ? "Crypto results (perps, prediction markets, NFTs, rewards)" : "Crypto results (perps, prediction markets, rewards)",
        category: "No crypto-specific tax in force",
        baseLocal: money(net),
        rate: "0%",
        taxLocal: 0,
        rule: "Income Tax Law No. 193 has no provision taxing crypto gains of individual investors",
        explanation: "Individual investors' crypto gains are not taxed under current law.",
      },
    ];
    const missing = [...b.missing];
    if (b.business) missing.push("Commercial-income taxation of professional traders is not modelled.");

    return buildResult(input, {
      country: "TR",
      version: VERSION,
      rulesEffective: "No crypto income tax enacted (as of Nov 2026)",
      currency: "TRY",
      rows: b.rows,
      taxLocal: 0,
      taxableLocal: 0,
      lines,
      methodology: ["Events converted to TRY at the ECB reference rate on each date."],
      assumptions: ["Turkish resident individual investor."],
      uncertainties: [
        "The March 2026 bill's crypto provisions (0.03% transaction tax, 10% withholding on gains via licensed platforms) were withdrawn in the General Assembly on 27 March 2026; Law No. 7577 that followed has no crypto provisions.",
        "Activity at a commercial scale can be taxed as commercial income at progressive rates.",
      ],
      missing,
      reporting: ["No crypto-specific declaration for individual investors"],
      references: [
        { title: "Mondaq: Draft law on crypto asset transaction tax (2026)", url: "https://www.mondaq.com/turkey/fintech/1754424/draft-law-on-crypto-asset-transaction-tax-and-the-taxation-of-income-derived-from-crypto-assets" },
        { title: "Resmi Gazete", url: "https://www.resmigazete.gov.tr/" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
      provisional: "No crypto tax law in force; a new bill could change this",
    });
  },
};
