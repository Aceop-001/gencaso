import { COMMON_UNCERTAINTIES, finalUsd, inYearCount, isPerp, localize, marketResults, money, nftResults, nftUncertainties, sum, utcYear } from "../common";
import type { Jurisdiction, TaxInput, TaxLine, TaxResult } from "../types";

/**
 * Germany — Einkommensteuergesetz (EStG). Module v1.0.0. Tax year = calendar year.
 * Church tax (Kirchensteuer) is not included.
 */

const VERSION = "DE-1.3.0";

/** §32a EStG income tax tariff (single assessment), returns tax for taxable income x (EUR). */
type Tariff = (x: number) => number;

const tariff2025: Tariff = (xRaw) => {
  const x = Math.floor(xRaw);
  if (x <= 12_096) return 0;
  if (x <= 17_443) { const y = (x - 12_096) / 10_000; return Math.floor((932.3 * y + 1_400) * y); }
  if (x <= 68_480) { const z = (x - 17_443) / 10_000; return Math.floor((176.64 * z + 2_397) * z + 1_015.13); }
  if (x <= 277_825) return Math.floor(0.42 * x - 10_911.92);
  return Math.floor(0.45 * x - 19_246.67);
};

const tariff2026: Tariff = (xRaw) => {
  const x = Math.floor(xRaw);
  if (x <= 12_348) return 0;
  if (x <= 17_799) { const y = (x - 12_348) / 10_000; return Math.floor((914.51 * y + 1_400) * y); }
  if (x <= 69_878) { const z = (x - 17_799) / 10_000; return Math.floor((173.1 * z + 2_397) * z + 1_034.87); }
  if (x <= 277_825) return Math.floor(0.42 * x - 11_135.63);
  return Math.floor(0.45 * x - 19_470.38);
};

const tariff2024: Tariff = (xRaw) => {
  const x = Math.floor(xRaw);
  if (x <= 11_784) return 0;
  if (x <= 17_005) { const y = (x - 11_784) / 10_000; return Math.floor((954.8 * y + 1_400) * y); }
  if (x <= 66_760) { const z = (x - 17_005) / 10_000; return Math.floor((181.19 * z + 2_397) * z + 991.21); }
  if (x <= 277_825) return Math.floor(0.42 * x - 10_636.31);
  return Math.floor(0.45 * x - 18_971.06);
};

// soliFrei: income-tax amount below which no solidarity surcharge is due (§3 Abs. 3 SolZG, single)
const YEARS: Record<string, { tariff: Tariff; verified: boolean; soliFrei: number }> = {
  "2024": { tariff: tariff2024, verified: true, soliFrei: 18_130 },
  "2025": { tariff: tariff2025, verified: true, soliFrei: 19_950 },
  // Steuerfortentwicklungsgesetz (30 Dec 2024): Grundfreibetrag €12,348, Soli Freigrenze €20,350
  "2026": { tariff: tariff2026, verified: true, soliFrei: 20_350 },
};

const ABGELTUNG = 0.25; // §32d Abs. 1 EStG
const SOLI = 0.055; // SolZG — applies in full to Abgeltungsteuer
const SPARER_PAUSCHBETRAG = 1_000; // §20 Abs. 9 EStG (single)
const FREIGRENZE_22_3 = 256; // §22 Nr. 3 EStG
const FREIGRENZE_23 = 1_000; // §23 Abs. 3 S. 5 EStG, from 2024 (was €600)

export const Germany: Jurisdiction = {
  code: "DE",
  name: "Germany",
  flag: "🇩🇪",
  currency: "EUR",
  locale: "de-DE",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf(ms) {
    const y = new Date(ms).getUTCFullYear();
    return utcYear(String(y), `Veranlagungsjahr ${y} (1 Jan – 31 Dec ${y})`, y, 0, 1);
  },
  calculate(input: TaxInput): TaxResult {
    const params = YEARS[input.taxYear.id];
    const p = params ?? YEARS["2025"];
    const { rows, missing } = localize(input, "EUR");
    const other = Math.max(0, input.profile.otherIncomeLocal);
    const lines: TaxLine[] = [];
    const uncertainties = [...COMMON_UNCERTAINTIES];

    // Perps as Termingeschäfte → Einkünfte aus Kapitalvermögen, directly related costs deductible (§20 Abs. 4 S. 5).
    const perpNet = sum(rows.filter(isPerp), (r) => r.realized + r.funding - r.fee);
    const taxableCapital = Math.max(0, perpNet - SPARER_PAUSCHBETRAG);
    let kapESt = taxableCapital * ABGELTUNG;
    let soli = kapESt * SOLI;
    // Soli on personal-tariff tax: nil up to the Freigrenze, then at most 11.9% of the excess (§4 SolZG)
    const soliOn = (est: number) => (est <= p.soliFrei ? 0 : Math.min(est * SOLI, (est - p.soliFrei) * 0.119));
    const withSoli = (income: number) => p.tariff(income) + soliOn(p.tariff(income));
    const carry = perpNet < 0 ? -perpNet : 0;
    const capitalLine: TaxLine = {
      label: "Perpetual DEX results (Termingeschäfte)",
      category: "Einkünfte aus Kapitalvermögen",
      baseLocal: money(perpNet),
      rate: "25% + 5.5% Soli",
      taxLocal: money(kapESt + soli),
      rule: "§20 Abs. 2 S. 1 Nr. 3 EStG; §32d Abs. 1 EStG; §20 Abs. 9 EStG",
      explanation:
        perpNet > 0
          ? `Net result €${money(perpNet).toLocaleString("de-DE")} (realized + funding − fees) less €1,000 Sparer-Pauschbetrag = €${money(taxableCapital).toLocaleString("de-DE")} at 25% flat tax, plus 5.5% solidarity surcharge (€${money(soli).toLocaleString("de-DE")}).`
          : `Net loss €${money(-perpNet).toLocaleString("de-DE")} — carried forward in the capital-income loss pot.`,
    };
    lines.push(capitalLine);
    uncertainties.push(
      "Classification of crypto-settled DEX perpetuals is disputed: they may instead be private sales under §23 EStG (1-year holding period, €1,000 Freigrenze, personal tax rate). The BMF crypto letter does not explicitly cover perpetuals.",
      "The former €20,000 annual loss-offset cap for Termingeschäfte (§20 Abs. 6 S. 5 EStG) was repealed by the JStG 2024; this module does not apply it.",
    );
    if (input.profile.traderType === "business") {
      uncertainties.push("Commercial trading (gewerblicher Handel) would move results to §15 EStG business income with trade tax — rarely accepted for private traders; not modelled.");
    }

    // Rewards: §22 Nr. 3 sonstige Einkünfte at the personal tariff, €256 Freigrenze (not an allowance).
    const rewards = sum(rows, (r) => r.reward);
    let rewardTax = 0;
    if (rewards) {
      const taxableRewards = rewards > FREIGRENZE_22_3 ? rewards : 0;
      rewardTax = withSoli(other + taxableRewards) - withSoli(other);
      lines.push({
        label: "Rewards & incentives",
        category: "Sonstige Einkünfte",
        baseLocal: money(taxableRewards),
        rate: "Personal tariff (§32a)",
        taxLocal: money(rewardTax),
        rule: "§22 Nr. 3 EStG",
        explanation: rewards > FREIGRENZE_22_3 ? "Exceeds the €256 Freigrenze, so the full amount is taxable at your personal rate." : "Below the €256 Freigrenze — tax-free.",
      });
    }

    // NFTs: private sales (§23 Abs. 1 S. 1 Nr. 2 EStG). Tax-free after one year; within a year the
    // year's total gain is taxed at the personal rate unless it stays under the €1,000 Freigrenze.
    const nft = nftResults(rows);
    let nftTax = 0;
    let nftTaxable = 0;
    if (nft.count) {
      nftTaxable = nft.short >= FREIGRENZE_23 ? nft.short : 0;
      const before = other + (rewards > FREIGRENZE_22_3 ? rewards : 0);
      nftTax = withSoli(before + nftTaxable) - withSoli(before);
      const eur = (n: number) => `€${money(n).toLocaleString("de-DE")}`;
      lines.push({
        label: "NFT sales (private sales)",
        category: "Private Veräußerungsgeschäfte",
        baseLocal: money(nftTaxable),
        rate: "Personal tariff (§32a)",
        taxLocal: money(nftTax),
        rule: "§23 Abs. 1 S. 1 Nr. 2 EStG (andere Wirtschaftsgüter); §23 Abs. 3 S. 5 (€1,000 Freigrenze)",
        explanation:
          (nft.short < 0
            ? `NFTs sold within a year: net loss ${eur(-nft.short)}, which can only offset other private-sale gains (carried back or forward).`
            : nft.short >= FREIGRENZE_23
              ? `NFTs sold within a year of purchase: net gain ${eur(nft.short)} reaches the €1,000 Freigrenze, so all of it is taxed at your personal rate.`
              : `NFTs sold within a year: net gain ${eur(nft.short)} is under the €1,000 Freigrenze, so it is tax-free.`) +
          (nft.longCount ? ` ${nft.longCount} NFT(s) held over a year (${eur(nft.long)}) are tax-free.` : ""),
      });
      uncertainties.push("The BMF crypto letter of 6 March 2025 expressly leaves NFTs out, so the general §23 rules for other assets are applied. An NFT that represents something else (e.g. a security or a physical good) could be taxed differently. The €1,000 Freigrenze is shared with any other private sales (e.g. coins) in the same year.", ...nftUncertainties(nft));
    }

    const markets = marketResults(rows);
    if (markets.length) {
      lines.push({ label: "Prediction market results", category: "Glücksspiel / Wetten — not taxable", baseLocal: money(sum(markets, (m) => m.net)), rate: "0%", taxLocal: 0, rule: "Gambling winnings are not one of the seven income types of §2 Abs. 1 EStG", explanation: "Private betting winnings are not taxed and losses are not deductible." });
      uncertainties.push("Prediction-market shares could be treated as financial instruments (§20) or crypto private sales (§23) rather than bets — this would make gains taxable.");
    }

    if (!params) missing.push(`No tariff for ${input.taxYear.id}; 2025 tariff applied.`);
    else if (!params.verified) uncertainties.push(`${input.taxYear.id} §32a tariff values should be verified against the final law.`);

    // Günstigerprüfung (§32d Abs. 6): capital income at your personal rate instead, if that is lower
    if (taxableCapital > 0) {
      const base = other + (rewards > FREIGRENZE_22_3 ? rewards : 0) + nftTaxable;
      const personal = withSoli(base + taxableCapital) - withSoli(base);
      if (personal < kapESt + soli) {
        kapESt = personal;
        soli = 0;
        capitalLine.taxLocal = money(personal);
        capitalLine.rate = "Personal tariff (Günstigerprüfung)";
        capitalLine.explanation += ` Your personal rate gives less tax (€${money(personal).toLocaleString("de-DE")} incl. Soli), so it applies instead (§32d Abs. 6 EStG, on request in your return).`;
      }
    }
    const taxLocal = money(kapESt + soli + rewardTax + nftTax);
    return {
      country: "DE",
      moduleVersion: VERSION,
      rulesEffective: "EStG as amended by JStG 2024; §32a tariff per year",
      taxYear: input.taxYear,
      currency: "EUR",
      ...finalUsd(input, "EUR", taxLocal),
      taxLocal,
      taxableLocal: money(taxableCapital + (rewards > FREIGRENZE_22_3 ? rewards : 0) + nftTaxable),
      netTradingLocal: money(sum(rows, (r) => r.realized + r.funding - r.fee + r.reward)),
      lines,
      methodology: [
        "Events converted to EUR at the ECB reference rate on each date.",
        "Perp results netted for the year, including funding and directly related fees.",
        "Sparer-Pauschbetrag (€1,000) deducted, then 25% Abgeltungsteuer and 5.5% Soli applied.",
        "Rewards taxed at the personal §32a tariff on top of your other income.",
      ],
      assumptions: [
        "Unlimited tax liability in Germany (resident), single assessment, no church tax.",
        "Sparer-Pauschbetrag not used by other capital income (e.g. bank interest).",
        `Other taxable income entered: €${other.toLocaleString("de-DE")}.`,
      ],
      uncertainties,
      missing,
      reporting: ["Anlage KAP (foreign capital income without withholding — lines for Termingeschäfte)", "Anlage SO for §22 Nr. 3 rewards"],
      references: [
        { title: "BMF-Schreiben zu Kryptowerten (06.03.2025)", url: "https://www.bundesfinanzministerium.de" },
        { title: "§20 EStG", url: "https://www.gesetze-im-internet.de/estg/__20.html" },
        { title: "§32a EStG", url: "https://www.gesetze-im-internet.de/estg/__32a.html" },
      ],
      carryForwardLossLocal: money(carry),
      eventsInYear: inYearCount(input),
      unsupportedYear: params ? undefined : input.taxYear.id,
    };
  },
};
