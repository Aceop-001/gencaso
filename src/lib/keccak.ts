/**
 * Keccak-256 (the original Keccak padding used by Ethereum, not NIST SHA3-256) and EIP-55 checksum
 * addresses. Some indexers (e.g. GMX's) match addresses only in their checksummed form.
 * Small and dependency-free; checked against the standard test vectors in keccak.test.ts.
 */

const MASK = (BigInt(1) << BigInt(64)) - BigInt(1);
const RC = [
  "0000000000000001", "0000000000008082", "800000000000808a", "8000000080008000", "000000000000808b", "0000000080000001",
  "8000000080008081", "8000000000008009", "000000000000008a", "0000000000000088", "0000000080008009", "000000008000000a",
  "000000008000808b", "800000000000008b", "8000000000008089", "8000000000008003", "8000000000008002", "8000000000000080",
  "000000000000800a", "800000008000000a", "8000000080008081", "8000000000008080", "0000000080000001", "8000000080008008",
].map((h) => BigInt(`0x${h}`));
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

const rotl = (x: bigint, n: number) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK);

function keccakF(s: bigint[]) {
  for (let round = 0; round < 24; round++) {
    // θ
    const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
    }
    // ρ and π
    const b: bigint[] = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    // χ
    for (let x = 0; x < 5; x++) for (let y = 0; y < 25; y += 5) s[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK & b[((x + 2) % 5) + y]);
    // ι
    s[0] ^= RC[round];
  }
}

/** Keccak-256 of bytes, as lowercase hex (no 0x). */
export function keccak256(data: Uint8Array): string {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s: bigint[] = new Array(25).fill(BigInt(0));
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = BigInt(0);
      for (let k = 7; k >= 0; k--) lane = (lane << BigInt(8)) | BigInt(padded[off + i * 8 + k]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  let hex = "";
  for (let i = 0; i < 4; i++) for (let k = 0; k < 8; k++) hex += Number((s[i] >> BigInt(8 * k)) & BigInt(255)).toString(16).padStart(2, "0");
  return hex;
}

/** EIP-55 mixed-case checksum form of an EVM address. */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(lower)) throw new Error("Not an EVM address");
  const hash = keccak256(new TextEncoder().encode(lower));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}
