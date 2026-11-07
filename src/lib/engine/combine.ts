import { shortAddr } from "../format";
import type { FxTable, WalletDataset } from "./schema";

/** Most wallets in one combined report (each is one analysis, and analyses are rate-limited). */
export const MAX_WALLETS = 5;

/** Every wallet in a dataset: the combined list, or the single address. */
export const walletsOf = (ds: WalletDataset) => ds.wallets ?? [ds.address];

/** "0x15ba…7b29" for one wallet, "3 wallets" for a combined report. */
export const walletLabel = (ds: WalletDataset) => (ds.isDemo ? "demo wallet" : walletsOf(ds).length > 1 ? `${walletsOf(ds).length} wallets` : shortAddr(ds.address));

function mergeFx(tables: FxTable[]): FxTable {
  const rates: FxTable["rates"] = {};
  for (const t of tables)
    for (const [cur, days] of Object.entries(t.rates)) rates[cur] = { ...(rates[cur] ?? {}), ...days };
  return { source: tables[0]?.source ?? "", rates, missing: [...new Set(tables.flatMap((t) => t.missing))] };
}

/**
 * One report from several wallets. Tax modules only read events, so a combined dataset is taxed
 * exactly like a single wallet: every trade of every wallet counts once.
 *
 * - Events are merged and de-duplicated by id (ids are stable per trade).
 * - Deposits, withdrawals and transfers never count as profit, so moving funds between your own
 *   wallets doesn't create income.
 * - Source reports and data warnings are labelled with their wallet.
 */
export function combineDatasets(datasets: WalletDataset[]): WalletDataset {
  if (!datasets.length) throw new Error("No wallets to combine");
  if (datasets.length === 1) return datasets[0];
  const many = datasets.length > 1;
  const label = (ds: WalletDataset) => shortAddr(ds.address);
  // Ids are unique within a wallet, not across wallets: two of your own wallets trading against each
  // other share a trade id, and both sides are real. So de-duplicate per wallet + id.
  const seen = new Set<string>();
  const events = datasets.flatMap((d) => d.events).filter((e) => {
    const k = `${e.account.toLowerCase()}|${e.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const warnings = datasets.flatMap((d) => d.dataWarnings.map((w) => `${label(d)}: ${w}`));
  const evmWallets = datasets.filter((d) => d.address.startsWith("0x")).length;
  if (evmWallets > 1 && events.some((e) => e.category === "nft"))
    warnings.push("NFT cost basis is matched within each wallet: an NFT bought in one of your wallets and sold from another shows as \"no purchase\". Add that cost manually.");
  return {
    address: datasets[0].address,
    wallets: datasets.map((d) => d.address),
    isDemo: datasets.every((d) => d.isDemo),
    fetchedAt: Math.min(...datasets.map((d) => d.fetchedAt)),
    events: events.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)),
    providers: datasets.flatMap((d) => d.providers.map((p) => (many ? { ...p, wallet: d.address } : p))),
    dataWarnings: warnings,
    openPositions: datasets.flatMap((d) => d.openPositions),
    fx: mergeFx(datasets.map((d) => d.fx)),
  };
}

/**
 * Parse what a user typed into the wallet box: one or more addresses separated by commas, spaces or
 * new lines. Returns the raw parts, de-duplicated (case-insensitive), in the order typed.
 */
export function splitWallets(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean)) {
    const k = part.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(part);
  }
  return out;
}
