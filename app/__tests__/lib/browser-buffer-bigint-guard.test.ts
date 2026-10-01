import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readU64LE } from "@/lib/u64le";

// The client bundle's Buffer polyfill has no BigInt read/write methods. A call to
// readBigUInt64LE on any client path threw before the first trade's tx was built
// ("x.Buffer.from(...).readBigUInt64LE is not a function"), so nothing could trade.
describe("browser Buffer BigInt guard", () => {
  it("no client code calls Buffer BigInt read/write methods (server api routes excepted)", () => {
    const out = execSync(
      `git grep -nE "\\.(read|write)Big(U)?Int64(LE|BE)\\(" -- hooks lib components app ':!app/api/**' ':!**/__tests__/**' || true`,
      { cwd: process.cwd(), encoding: "utf8" },
    ).trim();
    expect(out).toBe("");
  });
  it("readU64LE reads little-endian u64 from a plain Uint8Array (no Buffer methods)", () => {
    const b = new Uint8Array(80);
    new DataView(b.buffer).setBigUint64(64, 123_456_789_012_345n, true);
    expect(readU64LE(b, 64)).toBe(123_456_789_012_345n);
    const sub = b.subarray(8); // non-zero byteOffset
    expect(readU64LE(sub, 56)).toBe(123_456_789_012_345n);
  });
});
