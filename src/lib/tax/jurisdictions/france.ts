import { basics, buildResult, calendarYear, money, money0, nftUncertainties, yearParams } from "../common";
import type { Jurisdiction, TaxLine } from "../types";

/**
 * France — gains on digital assets (CGI art. 150 VH bis) taxed at the flat tax (PFU):
 * 12.8% income tax + social charges (17.2%, raised to 18.6% by the LFSS 2026).
 * Gambling winnings of occasional players are not taxed. Module v1.0.0. Calendar year.
 */

const VERSION = "FR-1.2.0";
const YEARS: Record<string, { pfu: number; note?: string }> = {
  "2024": { pfu: 0.3 },
  // LFSS 2026 raised CSG on capital income to 10.6% from 2025 income; impots.gouv states 31.4% for crypto gains declared in 2026
  "2025": { pfu: 0.314, note: "2025 gains use 31.4%: the LFSS 2026 CSG increase applies to 2025 capital income (impots.gouv.fr crypto FAQ, July 2026)." },
  "2026": { pfu: 0.314 },
};

const eur = (n: number) => money0(n, "EUR", "fr-FR");

export const France: Jurisdiction = {
  code: "FR",
  name: "France",
  flag: "🇫🇷",
  currency: "EUR",
  locale: "fr-FR",
  moduleVersion: VERSION,
  supportedYears: Object.keys(YEARS),
  taxYearOf: calendarYear,
  calculate(input) {
    const { p, unsupported } = yearParams(YEARS, input.taxYear.id);
    const b = basics(input, "EUR");
    const lines: TaxLine[] = [];
    const uncertainties: string[] = [];
    // NFTs are digital assets (CMF art. L552-2 tokens), so their gains join the art. 150 VH bis pot
    const gains = b.perpNet + b.nft.net + b.rewards;
    const taxDue = Math.max(0, gains) * p.pfu;

    lines.push({
      label: b.nft.count ? "Perpetual DEX, NFT gains & rewards" : "Perpetual DEX gains & rewards",
      category: "Plus-values sur actifs numériques",
      baseLocal: money(gains),
      rate: `${(p.pfu * 100).toFixed(1)}% flat tax`,
      taxLocal: money(taxDue),
      rule: "CGI art. 150 VH bis and 200 C (PFU); CSS art. L136-6",
      explanation: gains > 0 ? `Net gain ${eur(gains)}${b.nft.count ? ` (NFTs ${eur(b.nft.net)})` : ""} at the ${(p.pfu * 100).toFixed(1)}% flat tax (12.8% income tax + social charges).` : `Net loss of ${eur(-gains)}: offsets gains of the same year only — no carry-forward.`,
    });
    if (b.markets.length)
      lines.push({ label: "Prediction market results", category: "Jeux d'argent — not taxable", baseLocal: money(b.pmNet), rate: "0%", taxLocal: 0, rule: "Gambling winnings of non-professional players are not taxable", explanation: "Winnings are not taxed and losses are not deductible." });

    uncertainties.push(
      "Under art. 150 VH bis only conversions to euros (or goods/services) are taxable; crypto-to-crypto, including USDC-settled perp results, is deferred. This estimate assumes the year's net result was converted to euros.",
      "Perpetual contracts could instead be forward financial instruments (art. 150 ter); the flat-tax rate would be the same.",
    );
    if (b.nft.count)
      uncertainties.push(
        "NFTs are treated as digital assets under art. 150 VH bis, so an NFT sold for ETH is crypto-to-crypto and deferred until you convert to euros. If an NFT is not a token in the CMF sense (e.g. it represents a physical item), it is taxed as a movable asset instead (36.2%, with an allowance after 2 years).",
        "Art. 150 VH bis computes gains with a whole-portfolio formula (total acquisition cost × sale price ÷ portfolio value), not per item; this estimate uses each NFT's own purchase price.",
        ...nftUncertainties(b.nft),
      );
    if (p.note) uncertainties.push(p.note);
    if (b.business) uncertainties.push("Habitual traders may be taxed on BIC/BNC (progressive scale + social charges); not modelled.");
    if (b.rewards) uncertainties.push("Rewards are included at the flat tax for simplicity; they may be BNC taxed at the progressive scale.");

    return buildResult(input, {
      country: "FR",
      version: VERSION,
      rulesEffective: "PFU 30% to 2025; 31.4% from 2026 (LFSS 2026)",
      currency: "EUR",
      rows: b.rows,
      taxLocal: taxDue,
      taxableLocal: Math.max(0, gains),
      lines,
      methodology: ["Events converted to EUR at the ECB reference rate on each date.", "Perp results and rewards netted for the calendar year at the flat tax (PFU)."],
      assumptions: ["French tax resident, occasional investor.", "Flat tax chosen (not the option for the progressive scale).", "Total disposals above the €305 annual exemption."],
      uncertainties,
      missing: b.missing,
      reporting: ["Form 2086 (crypto gains) and 2042-C", "Form 3916-bis for each foreign account or wallet"],
      references: [
        { title: "Actu-Juridique: la CSG en hausse sur les revenus du capital (LFSS 2026)", url: "https://www.actu-juridique.fr/fiscalite/fiscal-finances/la-csg-en-hausse-sur-les-revenus-du-capital/" },
        { title: "Moneyvox: hausse de la CSG et plus-values crypto", url: "https://www.moneyvox.fr/impot/actualites/108257/impots-2026-une-hausse-de-la-csg-retroactive-qui-va-alourdir-la-revente-de-vos-cryptos" },
      ],
      carry: 0,
      unsupportedYear: unsupported,
    });
  },
};
