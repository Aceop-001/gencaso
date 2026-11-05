import type { WalletDataset } from "./engine/schema";

/** Deterministic fingerprint of the dataset so a report can be reproduced and audited. */
export function datasetFingerprint(ds: WalletDataset): string {
  let h = 2166136261;
  for (const e of ds.events) {
    const s = `${e.id}|${e.timestamp}|${e.realizedPnlUsd}|${e.feeUsd}|${e.fundingUsd}|${e.amountUsd ?? ""}`;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
