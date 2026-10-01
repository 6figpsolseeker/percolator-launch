/** UX WP-10 (audit CN-1): connect errors are never swallowed; the playground never offers mainnet. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectErrorLine } from "@/components/wallet/ConnectButton";

describe("CN-1", () => {
  it("one plain line per failure; a cancel is quiet", () => {
    expect(connectErrorLine(new Error("User rejected the request."), "Phantom")).toBeNull();
    expect(connectErrorLine(Object.assign(new Error(""), { name: "WalletNotReadyError" }), "Solflare")).toBe("Solflare isn't installed in this browser. Install it, then connect again.");
    expect(connectErrorLine(new Error("Wallet is locked"), "Phantom")).toBe("Unlock Phantom and try again.");
    expect(connectErrorLine(new Error("boom"), "Phantom")).toBe("Couldn't connect to Phantom. Try again.");
  });
  it("the connect path reports the error (no empty catch) and the trade page has no Switch to Mainnet", () => {
    const btn = readFileSync(resolve(process.cwd(), "components/wallet/ConnectButton.tsx"), "utf8");
    expect(btn).toMatch(/catch \(e\) \{[\s\S]*setConnectError\(connectErrorLine\(e, walletName\)\)/);
    const page = readFileSync(resolve(process.cwd(), "app/trade/[slab]/page.tsx"), "utf8");
    expect(page).not.toContain("Switch to Mainnet");
  });
});
