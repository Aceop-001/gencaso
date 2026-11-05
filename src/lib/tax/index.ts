import type { WalletDataset } from "../engine/schema";
import { Australia } from "./jurisdictions/australia";
import { China } from "./jurisdictions/china";
import { France } from "./jurisdictions/france";
import { Germany } from "./jurisdictions/germany";
import { India } from "./jurisdictions/india";
import { Indonesia } from "./jurisdictions/indonesia";
import { Japan } from "./jurisdictions/japan";
import { Malaysia } from "./jurisdictions/malaysia";
import { Nigeria } from "./jurisdictions/nigeria";
import { Pakistan } from "./jurisdictions/pakistan";
import { Philippines } from "./jurisdictions/philippines";
import { Russia } from "./jurisdictions/russia";
import { Singapore } from "./jurisdictions/singapore";
import { SouthAfrica } from "./jurisdictions/southAfrica";
import { SouthKorea } from "./jurisdictions/southKorea";
import { SriLanka } from "./jurisdictions/sriLanka";
import { Turkey } from "./jurisdictions/turkey";
import { UnitedArabEmirates } from "./jurisdictions/uae";
import { Ukraine } from "./jurisdictions/ukraine";
import { UnitedKingdom } from "./jurisdictions/uk";
import { UnitedStates } from "./jurisdictions/usa";
import { Vietnam } from "./jurisdictions/vietnam";
import type { CountryCode, Jurisdiction, TaxProfile, TaxResult, TaxYear } from "./types";

/** Registry of independent jurisdiction modules. Add a country by adding a module here. */
export const JURISDICTIONS: Jurisdiction[] = [
  India, UnitedStates, UnitedKingdom, Germany, Australia,
  // Alphabetical after the original five
  China, France, Indonesia, Japan, Malaysia, Nigeria, Pakistan, Philippines, Russia, Singapore, SouthAfrica, SouthKorea, SriLanka, Turkey, UnitedArabEmirates, Ukraine, Vietnam,
];

export const jurisdiction = (code: CountryCode) => {
  const j = JURISDICTIONS.find((x) => x.code === code);
  if (!j) throw new Error(`Unknown jurisdiction ${code}`);
  return j;
};

/** Tax years (in this jurisdiction's calendar) that contain trading activity, newest first. */
export function taxYearsWithActivity(j: Jurisdiction, dataset: WalletDataset): TaxYear[] {
  const years = new Map<string, TaxYear>();
  for (const e of dataset.events) {
    if (e.category === "account" && e.type !== "REWARD") continue;
    const y = j.taxYearOf(e.timestamp);
    years.set(y.id, y);
  }
  return [...years.values()].sort((a, b) => b.start - a.start);
}

/** Memoized calculation: (dataset, country, year, profile) -> result. Never refetches data. */
const memo = new WeakMap<WalletDataset, Map<string, TaxResult>>();

export function calculateTax(dataset: WalletDataset, code: CountryCode, year: TaxYear, profile: TaxProfile): TaxResult {
  const key = `${code}|${year.id}|${profile.traderType}|${profile.otherIncomeLocal}`;
  let m = memo.get(dataset);
  if (!m) memo.set(dataset, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const res = jurisdiction(code).calculate({ events: dataset.events, fx: dataset.fx, taxYear: year, profile });
  m.set(key, res);
  return res;
}

export * from "./types";
