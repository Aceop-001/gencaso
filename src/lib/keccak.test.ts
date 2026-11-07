import { describe, expect, it } from "vitest";
import { keccak256, toChecksumAddress } from "./keccak";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("keccak-256 (Ethereum)", () => {
  it("matches the standard test vectors", () => {
    expect(keccak256(utf8(""))).toBe("c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(keccak256(utf8("abc"))).toBe("4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
    expect(keccak256(utf8("The quick brown fox jumps over the lazy dog"))).toBe("4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15");
  });
  it("handles inputs longer than one block (136 bytes)", () => {
    expect(keccak256(utf8("a".repeat(200)))).toHaveLength(64);
    expect(keccak256(utf8("a".repeat(136)))).not.toBe(keccak256(utf8("a".repeat(135))));
  });
});

describe("EIP-55 checksum addresses", () => {
  it("matches the EIP-55 reference examples", () => {
    for (const a of ["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed", "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359", "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB", "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb"])
      expect(toChecksumAddress(a.toLowerCase())).toBe(a);
  });
  it("matches a real GMX account as GMX stores it", () => {
    expect(toChecksumAddress("0xab3067c58811ade7aa17b58808db3b4c2e86f603")).toBe("0xAb3067C58811aDE7aA17B58808Db3b4c2E86f603");
  });
});
