export type AddressKind = "evm" | "solana" | "demo";

export interface AddressCheck {
  ok: boolean;
  kind?: AddressKind;
  normalized?: string;
  error?: string;
}

export const DEMO_ADDRESS = "demo";

const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Heuristics that catch people pasting secrets instead of addresses.
const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/;

export function validateAddress(input: string): AddressCheck {
  const v = input.trim();
  if (!v) return { ok: false, error: "Enter a public wallet address." };
  if (v.toLowerCase() === DEMO_ADDRESS) return { ok: true, kind: "demo", normalized: DEMO_ADDRESS };
  if (PRIVATE_KEY.test(v)) {
    return {
      ok: false,
      error: "That looks like a private key. Never share it — GENCASO only needs your public address.",
    };
  }
  if (v.split(/\s+/).length >= 12) {
    return { ok: false, error: "That looks like a seed phrase. Never share it — enter your public address instead." };
  }
  if (EVM.test(v)) return { ok: true, kind: "evm", normalized: v.toLowerCase() };
  if (v.startsWith("0x")) return { ok: false, error: "EVM addresses are 0x followed by 40 hex characters." };
  if (SOLANA.test(v)) return { ok: true, kind: "solana", normalized: v };
  return { ok: false, error: "Not a recognised EVM (0x…) or Solana address." };
}
