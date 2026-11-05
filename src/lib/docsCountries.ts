import type { CountryCode } from "./tax";

/**
 * Plain-language summary of each country module, for the /docs page.
 * Written from the rule text each module produces (category, rate and legal basis). Module
 * versions, currencies and supported years are read from the modules themselves, so they never drift.
 * When a module's rules change, update its line here too.
 */
export interface CountryDoc {
  perps: string;
  prediction: string;
  nfts: string;
  basis: string;
}

export const COUNTRY_DOCS: Record<CountryCode, CountryDoc> = {
  IN: { perps: "30% flat on each profitable trade; losses, fees and paid funding are not deductible", prediction: "30% on winnings (betting)", nfts: "30% (NFTs are VDAs)", basis: "s.115BBH, s.115BB, 4% cess; Income-tax Act 2025 from 1 Apr 2026" },
  US: { perps: "Capital gains: short-term at 10–37%, long-term at 0/15/20%", prediction: "Capital gains (gambling treatment flagged)", nfts: "Capital gains; collectibles caveat (Notice 2023-27)", basis: "IRC §1222, §1(h), §1211(b) $3,000 loss limit; federal only" },
  GB: { perps: "CGT 18% / 24% after the £3,000 annual exempt amount", prediction: "Not taxable (betting)", nfts: "CGT, same pot as perps", basis: "TCGA 1992 s.143, s.21, s.51(1)" },
  DE: { perps: "25% + Soli (§20 Termingeschäfte)", prediction: "Not taxable (gambling)", nfts: "Personal tariff if sold within 1 year; €1,000 Freigrenze", basis: "§20, §23, §32d EStG" },
  AU: { perps: "Net capital gain at marginal rates + 2% Medicare; 50% discount after 12 months", prediction: "Not assessable (recreational gambling)", nfts: "CGT assets, same discount rule", basis: "ITAA 1997 s.104-25, s.104-10, Div 115" },
  CN: { perps: "20% property-transfer income", prediction: "20% incidental income per win", nfts: "20% property-transfer income", basis: "Individual Income Tax Law art. 2–3 (no crypto-specific law)" },
  FR: { perps: "Flat tax 31.4% from 2026 (30% before)", prediction: "Not taxable (gambling)", nfts: "Same flat tax", basis: "CGI art. 150 VH bis, 200 C" },
  ID: { perps: "1% final tax on sale value (foreign platforms, from 1 Aug 2025)", prediction: "Same 1% on sale value", nfts: "Counted as crypto sales (caveat)", basis: "PMK 50/2025; turnover-based, gains don't matter" },
  JP: { perps: "Miscellaneous income 5–45% + 2.1% + 10% inhabitant tax", prediction: "Occasional income: ½ × (wins − ¥500k)", nfts: "Miscellaneous income", basis: "Income Tax Act art. 34, 35; NTA FAQs" },
  MY: { perps: "Not taxable for individuals", prediction: "Not taxable (gambling)", nfts: "Not taxable", basis: "No CGT on crypto; business traders taxed differently" },
  NG: { perps: "Personal income tax bands 0–25% (2026)", prediction: "Same as perps", nfts: "Same as perps", basis: "Nigeria Tax Act 2025" },
  PK: { perps: "Capital gains at non-salaried slabs 0–45%", prediction: "Same as perps", nfts: "Same as perps", basis: "Income Tax Ordinance 2001 s.37; no crypto-specific rate" },
  PH: { perps: "Graduated rates 0–35%", prediction: "Same as perps", nfts: "Same as perps", basis: "NIRC s.24(A) as amended by TRAIN" },
  RU: { perps: "Digital-currency base: 13% to ₽2.4m, 15% above", prediction: "Same as perps", nfts: "Main NDFL scale 13–22%", basis: "Tax Code art. 214.11, 224; Federal Law 418-FZ" },
  SG: { perps: "Not taxable (no capital gains tax)", prediction: "Not taxable (windfall)", nfts: "Not taxable", basis: "IRAS e-Tax Guide on digital tokens" },
  ZA: { perps: "CGT: 40% inclusion at marginal rates (max 18% effective)", prediction: "Same as perps", nfts: "Same as perps", basis: "Eighth Schedule paras 5 and 10" },
  KR: { perps: "0% until the tax starts on 1 Jan 2027 (22% above ₩2.5m)", prediction: "Same as perps", nfts: "Not virtual assets: not taxed", basis: "Income Tax Act amendment (Dec 2024); FSC NFT guidelines" },
  LK: { perps: "CGT 10%, 15% for individuals from 3 June 2026", prediction: "Same as perps", nfts: "Same as perps", basis: "Inland Revenue Act s.37; Amendment Act No. 11 of 2026" },
  TR: { perps: "No crypto tax in force", prediction: "Same", nfts: "Same", basis: "Income Tax Law No. 193 has no crypto provision" },
  AE: { perps: "No personal income tax", prediction: "Same", nfts: "Same", basis: "Personal investment income outside Corporate Tax" },
  UA: { perps: "18% personal income tax + 5% military levy", prediction: "Same as perps", nfts: "Same as perps", basis: "Tax Code art. 164, 167; bill 10225-d pending" },
  VN: { perps: "0.1% of each transfer's value (licensed platforms)", prediction: "Same", nfts: "Same", basis: "Circular 32/2026/TT-BTC; PIT Law 109/2025" },
};
