import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeWaitlistSupabase } from "../helpers/fakeWaitlistSupabase";

const state = vi.hoisted(() => ({ client: null as unknown, fail: false }));
vi.mock("@/lib/waitlist/supabase", () => ({ getWaitlistServiceSupabase: () => state.client }));

const rows = [
  { id: "a", email: "khubairnasir26@gmail.com", referral_code: "K" },
  { id: "b", email: "half@x.io", referral_code: null },
];
let ipN = 0;
const req = (email: unknown, ip = `10.0.0.${++ipN}`) =>
  new NextRequest("https://percolator.trade/api/playground/precheck", {
    method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify({ email }),
  });

describe("POST /api/playground/precheck — only send a code to a waitlist email", () => {
  beforeEach(() => { state.client = fakeWaitlistSupabase(rows).client; vi.resetModules(); });
  it("a member (any casing) is on the list", async () => {
    const { POST } = await import("@/app/api/playground/precheck/route");
    expect(await (await POST(req("KhubairNasir26@gmail.com "))).json()).toEqual({ onList: true });
  });
  it("CONTROL: an unknown email, a row without a referral code, or junk is not", async () => {
    const { POST } = await import("@/app/api/playground/precheck/route");
    expect(await (await POST(req("nobody@x.io"))).json()).toEqual({ onList: false });
    expect(await (await POST(req("half@x.io"))).json()).toEqual({ onList: false });
    expect(await (await POST(req(42))).json()).toEqual({ onList: false });
  });
  it("rate-limited callers get the same answer as non-members (no enumeration signal)", async () => {
    const { POST } = await import("@/app/api/playground/precheck/route");
    for (let i = 0; i < 8; i++) await POST(req("khubairnasir26@gmail.com", "9.9.9.9"));
    expect(await (await POST(req("khubairnasir26@gmail.com", "9.9.9.9"))).json()).toEqual({ onList: false });
  });
  it("a DB failure fails open for the code only (access is still decided by the gate)", async () => {
    state.client = fakeWaitlistSupabase(rows, { failColumn: "email" }).client;
    const { POST } = await import("@/app/api/playground/precheck/route");
    expect(await (await POST(req("nobody@x.io"))).json()).toMatchObject({ onList: true, unverified: true });
  });
});
