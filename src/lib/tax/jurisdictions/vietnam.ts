import { basics, buildResult, calendarYear, disposalValue, money, money0, sum, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * Vietnam — Circular 32/2026/TT-BTC (effective 27 March 2026): individuals pay 0.1% personal
 * income tax on the gross transfer price of each crypto-asset transfer, regardless of gain or loss.
 * Before that, no crypto tax framework applied. Module v1.0.0. Calendar year.
 */

const VERSION = "VN-1.2.0";
const YEARS: Record<string, null> = { "2025": null, "2026": null };
const FROM = Date.UTC(2026, 2, 27);
const RATE = 0.001;

const vnd = (n: number) => money0(n, "VND", "vi-VN");

export const Vietnam: Jurisdiction = {
  code: "VN",
  name: "Vietnam",
  flag: "🇻🇳",
  currency: "VND",
  locale: "vi-VN",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "VND");
    const value = sum(b.rows.filter((r) => r.e.timestamp >= FROM), disposalValue);
    const taxDue = value * RATE;
    const lines: TaxLine[] = [
      {
        label: "Crypto transfers from 27 Mar 2026",
        category: "Personal income tax on transfer value",
        baseLocal: money(value),
        rate: "0.1% per transfer",
        taxLocal: money(taxDue),
        rule: "Circular 32/2026/TT-BTC; Resolution 05/2025/NQ-CP (pilot crypto market); PIT Law No. 109/2025/QH15 (0.1% on digital-asset transfers, from 1 July 2026)",
        explanation: value ? `Gross value of closing trades, prediction-market sales/redemptions${b.nft.count ? " and NFT sales" : ""} (${vnd(value)}) at 0.1%.` : "No transfers after 27 March 2026 in this year.",
      },
    ];

    return buildResult(input, {
      country: "VN",
      version: VERSION,
      rulesEffective: "Circular 32/2026/TT-BTC from 27 Mar 2026",
      currency: "VND",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: value,
      lines,
      methodology: [
        "Events converted to VND using daily rates from fawazahmed0's currency-api (the ECB publishes no VND rate).",
        "Tax base = gross value of each disposal (perp closes at notional value; prediction-market sells and redemptions at proceeds); no deduction for cost or losses.",
      ],
      assumptions: ["Individual investor (resident or non-resident)."],
      uncertainties: [
        "The 0.1% applies to transfers through licensed Vietnamese crypto asset service providers. How trades on foreign or decentralised platforms are taxed is not addressed; this estimate applies the same rate.",
        "Transfers before 27 March 2026 had no specific crypto tax framework and are not taxed here.",
        ...(b.nft.count ? ["NFT sales are counted as crypto-asset transfers; whether NFTs are crypto assets under Resolution 05/2025 is not settled."] : []),
      ],
      missing: b.missing,
      reporting: ["Withheld by licensed providers; self-declaration rules for other platforms per Circular 41/2026/TT-BTC"],
      references: [
        { title: "Baker McKenzie: Vietnam pilot tax framework for crypto (May 2026)", url: "https://www.bakermckenzie.com/en/insight/publications/2026/05/vietnam-launches-pilot-tax-framework-for-crypto-asset-transactions" },
        { title: "Viet Nam News: 0.1% tax on transfer of crypto assets", url: "https://vietnamnews.vn/economy/1778511/0-1-tax-on-transfer-of-crypto-assets-mof-s-circular.html" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
      provisional: "0.1% rule covers licensed Vietnamese platforms; offshore trading not addressed",
    });
  },
};
