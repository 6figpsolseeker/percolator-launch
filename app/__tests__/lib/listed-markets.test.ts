/**
 * isListedMarketRow is the ONE definition of "which markets exist" shared by
 * /markets and the landing page's Live Markets rail (the rail was empty while
 * /markets listed the live markets).
 */
import { describe, expect, it } from "vitest";
import { isListedMarketRow } from "@/lib/listed-markets";
import { HARDCODED_BLOCKED_SLABS } from "@/lib/blocklist-data";

const LIVE = { vault_balance: "6750058418", c_tot: "4043583689", last_price: 0.007576, volume_24h: 796918623344, total_open_interest: 0, total_accounts: null };

describe("isListedMarketRow", () => {
  it("lists a live market whose NUMERIC columns arrive as strings", () => {
    expect(isListedMarketRow("8WC8vALsDJhNCUVRmqZBDSg5xgFAhDrgy7zWqF512pDx", LIVE)).toBe(true);
  });

  it("drops a blocklisted slab even when it looks live", () => {
    const blocked = [...HARDCODED_BLOCKED_SLABS][0];
    expect(blocked).toBeTruthy();
    expect(isListedMarketRow(blocked, LIVE)).toBe(false);
  });

  it("drops a zombie whose empty vault arrives as the string \"0\"", () => {
    expect(isListedMarketRow("Z1", { vault_balance: "0", c_tot: "0", last_price: null, volume_24h: null, total_accounts: "0" })).toBe(false);
  });

  it("does not let a corrupt over-cap price count as activity", () => {
    expect(isListedMarketRow("Z2", { vault_balance: "0", c_tot: "0", last_price: "7900000000000", volume_24h: null, total_accounts: 0 })).toBe(false);
    expect(isListedMarketRow("Z3", { vault_balance: "0", c_tot: "0", last_price: "0.5", volume_24h: null, total_accounts: 0 })).toBe(true);
  });
});
