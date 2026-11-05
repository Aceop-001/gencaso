import { basics, buildResult, calendarYear, disposalValue, money, money0, sum, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * United Arab Emirates (incl. Dubai) — no personal income tax. Individuals are only within
 * Corporate Tax (9% on taxable income above AED 375,000) when they conduct a business with
 * turnover above AED 1m; personal investment income does not count. Module v1.0.0. Calendar year.
 */

const VERSION = "AE-1.1.0";
const YEARS: Record<string, null> = { "2024": null, "2025": null, "2026": null };
const TURNOVER_THRESHOLD = 1_000_000;
const ZERO_BAND = 375_000;
const CT_RATE = 0.09;

const aed = (n: number) => money0(n, "AED", "en-AE");

export const UnitedArabEmirates: Jurisdiction = {
  code: "AE",
  name: "UAE (Dubai)",
  flag: "🇦🇪",
  currency: "AED",
  locale: "en-AE",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "AED");
    const lines: TaxLine[] = [];
    const net = b.perpNet + b.pmNet + b.nft.net + b.rewards;
    // A trading business's turnover: gross proceeds of disposals
    const turnover = sum(b.rows, disposalValue);
    const inScope = b.business && turnover > TURNOVER_THRESHOLD;
    const taxable = inScope ? Math.max(0, net - ZERO_BAND) : 0;
    const taxDue = taxable * CT_RATE;

    lines.push(
      b.business
        ? {
            label: b.nft.count ? "Crypto trading business (perps, prediction markets, NFTs, rewards)" : "Crypto trading business (perps, prediction markets, rewards)",
            category: inScope ? "Corporate Tax — natural person in business" : "Below AED 1m turnover — not in scope",
            baseLocal: money(net),
            rate: "0% to AED 375k, 9% above",
            taxLocal: money(taxDue),
            rule: "Federal Decree-Law No. 47 of 2022; Cabinet Decision No. 49 of 2023 (natural persons)",
            explanation: inScope
              ? `Turnover ${aed(turnover)} exceeds AED 1m. Net profit ${aed(net)}; the first AED 375,000 is at 0%, the rest at 9%.`
              : `Turnover ${aed(turnover)} is below the AED 1m threshold, so Corporate Tax does not apply.`,
          }
        : {
            label: b.nft.count ? "Crypto results (perps, prediction markets, NFTs, rewards)" : "Crypto results (perps, prediction markets, rewards)",
            category: "Personal investment income — not taxed",
            baseLocal: money(net),
            rate: "0%",
            taxLocal: 0,
            rule: "No personal income tax; personal investment income is outside Corporate Tax (Cabinet Decision No. 49 of 2023)",
            explanation: "Individuals investing for their own account pay no tax on gains.",
          },
    );

    return buildResult(input, {
      country: "AE",
      version: VERSION,
      rulesEffective: "UAE Corporate Tax from June 2023",
      currency: "AED",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: taxable,
      lines,
      methodology: [
        "Events converted to AED using daily rates from fawazahmed0's currency-api (the ECB publishes no AED rate; the dirham is pegged at 3.6725 per USD).",
        "Individuals: no tax. Business: turnover = gross proceeds of disposals; profit above AED 375,000 taxed at 9% once turnover exceeds AED 1m.",
      ],
      assumptions: ["UAE resident individual.", "Business profile: one trading business, calendar-year tax period, no other business income."],
      uncertainties: [
        "'Personal investment' is not defined to name crypto; trading without a licence for your own account is generally treated as personal investment.",
        "For leveraged perps, turnover could be measured differently (e.g. net results), which changes whether the AED 1m threshold is crossed.",
      ],
      missing: b.missing,
      reporting: b.business && inScope ? ["Register for Corporate Tax and file within 9 months of the tax period end"] : ["No tax reporting for personal investment"],
      references: [
        { title: "UAE Ministry of Finance: Corporate Tax", url: "https://mof.gov.ae/corporate-tax/" },
        { title: "PwC: UAE individual taxes", url: "https://taxsummaries.pwc.com/united-arab-emirates/individual/taxes-on-personal-income" },
      ],
      carry: inScope ? -net : 0,
      unsupportedYear: unsupported,
    });
  },
};
