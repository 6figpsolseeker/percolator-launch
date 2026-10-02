import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ get: vi.fn(), verifyAccess: vi.fn(), verifyId: vi.fn() }));
vi.mock("@privy-io/node", () => ({
  PrivyClient: class {
    utils() { return { auth: () => ({ verifyAccessToken: m.verifyAccess, verifyIdentityToken: m.verifyId }) }; }
    users() { return { _get: m.get }; }
  },
}));

const req = () => new Request("https://percolator.trade/api/playground/authorize", { method: "POST", headers: { authorization: "Bearer tok" } });

describe("verifyPrivyAuth — no identity token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app"); vi.stubEnv("PRIVY_APP_SECRET", "sec");
    m.verifyAccess.mockResolvedValue({ user_id: "did:privy:me" });
    m.get.mockReset().mockResolvedValue({ linked_accounts: [{ type: "email", address: "Khubairnasir26@gmail.com" }] });
  });
  it("gate routes opt in: emails come from Privy's server API", async () => {
    const { verifyPrivyAuth } = await import("@/lib/privy-auth");
    const r = await verifyPrivyAuth(req(), { fetchUserIfNoIdToken: true });
    expect(r).toMatchObject({ ok: true, userId: "did:privy:me", emails: ["khubairnasir26@gmail.com"] });
    expect(m.get).toHaveBeenCalledWith("did:privy:me");
  });
  it("CONTROL: other routes do not call the rate-limited API (DID only)", async () => {
    const { verifyPrivyAuth } = await import("@/lib/privy-auth");
    const r = await verifyPrivyAuth(req());
    expect(r).toMatchObject({ ok: true, emails: [] });
    expect(m.get).not.toHaveBeenCalled();
  });
  it("an API failure still returns the DID (no throw)", async () => {
    m.get.mockRejectedValue(new Error("429"));
    const { verifyPrivyAuth } = await import("@/lib/privy-auth");
    expect(await verifyPrivyAuth(req(), { fetchUserIfNoIdToken: true })).toMatchObject({ ok: true, emails: [] });
  });
});
