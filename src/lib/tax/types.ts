import type { FinancialEvent, FxTable } from "../engine/schema";

export type CountryCode =
  | "IN" | "US" | "GB" | "DE" | "AU"
  | "JP" | "KR" | "CN" | "FR" | "ID" | "MY" | "PH" | "PK" | "LK" | "TR" | "VN" | "ZA" | "NG" | "SG" | "AE" | "RU" | "UA";

export interface TaxProfile {
  /** How the user trades. Several jurisdictions tax business/trader activity differently. */
  traderType: "individual" | "business";
  /** Other taxable income in the same tax year, in LOCAL currency (default 0). */
  otherIncomeLocal: number;
}

export const DEFAULT_PROFILE: TaxProfile = { traderType: "individual", otherIncomeLocal: 0 };

export interface TaxYear {
  id: string; // e.g. "FY2025-26"
  label: string;
  start: number; // ms, inclusive
  end: number; // ms, exclusive
}

export interface TaxInput {
  events: readonly FinancialEvent[];
  fx: FxTable;
  taxYear: TaxYear;
  profile: TaxProfile;
}

export interface TaxLine {
  label: string;
  /** Classification / head of income */
  category: string;
  baseLocal: number;
  rate?: string;
  taxLocal: number;
  rule: string;
  explanation: string;
}

export interface Reference {
  title: string;
  url: string;
}

export interface TaxResult {
  country: CountryCode;
  moduleVersion: string;
  rulesEffective: string;
  taxYear: TaxYear;
  currency: string;
  /** Local currency per USD used to express the final tax in USD */
  usdRate: { rate: number; date: string } | null;
  taxLocal: number;
  taxUsd: number | null;
  taxableLocal: number;
  netTradingLocal: number;
  lines: TaxLine[];
  methodology: string[];
  assumptions: string[];
  uncertainties: string[];
  missing: string[];
  reporting: string[];
  references: Reference[];
  carryForwardLossLocal: number;
  /** Events in this tax year that were included */
  eventsInYear: number;
  /** Set when the module has no parameters for the requested year */
  unsupportedYear?: string;
  /** Set when the country's crypto tax rules are unsettled (pending law, conflicting guidance) */
  provisional?: string;
}

export interface Jurisdiction {
  code: CountryCode;
  name: string;
  flag: string;
  currency: string;
  locale: string;
  moduleVersion: string;
  /** Tax years with verified parameters in this module */
  supportedYears: string[];
  taxYearOf(ms: number): TaxYear;
  calculate(input: TaxInput): TaxResult;
}
