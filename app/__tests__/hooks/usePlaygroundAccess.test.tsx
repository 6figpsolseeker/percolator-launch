/**
 * usePlaygroundAccess relays the server's verdict and never improves on it:
 * errors are errors (not grants, not refusals), `open` is strictly boolean
 * true, and the nav tab + gate page share one request.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  privyAvailable: true,
  ready: true,
  authenticated: true,
  user: { id: "did:privy:me" } as { id: string } | null,
  getAccessToken: vi.fn(async () => "privy-access" as string | null),
  identityToken: "privy-id" as string | null,
}));

vi.mock("@/hooks/usePrivySafe", () => ({ usePrivyAvailable: () => h.privyAvailable }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: h.ready, authenticated: h.authenticated, user: h.user, getAccessToken: h.getAccessToken }),
  useIdentityToken: () => ({ identityToken: h.identityToken }),
}));

import { usePlaygroundAccess, __resetPlaygroundAccessCache } from "@/hooks/usePlaygroundAccess";

const fetchMock = vi.fn();
function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  __resetPlaygroundAccessCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  h.privyAvailable = true;
  h.ready = true;
  h.authenticated = true;
  h.user = { id: "did:privy:me" };
  h.identityToken = "privy-id";
  h.getAccessToken.mockReset();
  h.getAccessToken.mockResolvedValue("privy-access");
});
afterEach(() => vi.unstubAllGlobals());

async function settle() {
  const r = renderHook(() => usePlaygroundAccess());
  await waitFor(() => expect(["idle", "checking"]).not.toContain(r.result.current.state.status));
  return r;
}

describe("verdict mapping", () => {
  it("granted carries position, cutoff and open", async () => {
    respond(200, { ok: true, status: "granted", position: 12, cutoff: 1000, open: true });
    const r = await settle();
    expect(r.result.current.state).toEqual({ status: "granted", position: 12, cutoff: 1000, open: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/playground/authorize");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer privy-access", "x-privy-id-token": "privy-id" });
  });

  it.each([["true"], [1], [null], [undefined]])("open must be boolean true — %j keeps the door shut", async (open) => {
    respond(200, { ok: true, status: "granted", position: 12, cutoff: 1000, open });
    const r = await settle();
    expect(r.result.current.state).toMatchObject({ status: "granted", open: false });
  });

  it("not_yet → queued; not_member → not-member", async () => {
    respond(403, { ok: false, status: "not_yet", position: 1412, cutoff: 1000 });
    let r = await settle();
    expect(r.result.current.state).toEqual({ status: "queued", position: 1412, cutoff: 1000 });
    r.unmount();
    __resetPlaygroundAccessCache();
    respond(403, { ok: false, status: "not_member" });
    r = await settle();
    expect(r.result.current.state).toEqual({ status: "not-member" });
  });

  it.each([
    [503, { ok: false, status: "unavailable" }],
    [401, { ok: false, status: "unauthenticated" }],
    [200, { ok: true, status: "granted" }], // no position: malformed, not a grant
    [200, { ok: "yes", status: "granted", position: 1 }],
    [500, "not json"],
  ])("HTTP %i %j is an error, never a grant", async (status, body) => {
    respond(status, body);
    const r = await settle();
    expect(r.result.current.state.status).toBe("error");
  });

  it("a network failure is an error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    const r = await settle();
    expect(r.result.current.state).toEqual({ status: "error", reason: "network" });
  });

  it("signed out is idle and never calls the server", async () => {
    h.authenticated = false;
    const r = renderHook(() => usePlaygroundAccess());
    expect(r.result.current.state).toEqual({ status: "idle" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sharing", () => {
  it("the nav tab and the gate page share one request", async () => {
    respond(200, { ok: true, status: "granted", position: 12, cutoff: 1000, open: false });
    const a = renderHook(() => usePlaygroundAccess());
    const b = renderHook(() => usePlaygroundAccess());
    await waitFor(() => expect(a.result.current.state.status).toBe("granted"));
    await waitFor(() => expect(b.result.current.state.status).toBe("granted"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("errors are not cached: the next caller asks again (no recheck needed)", async () => {
    respond(503, { ok: false, status: "unavailable" });
    const a = await settle();
    expect(a.result.current.state.status).toBe("error");
    a.unmount();
    respond(200, { ok: true, status: "granted", position: 3, cutoff: 1000, open: false });
    const b = await settle();
    expect(b.result.current.state.status).toBe("granted");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a settled verdict IS shared with the next caller within the window", async () => {
    respond(200, { ok: true, status: "granted", position: 3, cutoff: 1000, open: false });
    const a = await settle();
    a.unmount();
    const b = await settle();
    expect(b.result.current.state.status).toBe("granted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("'try again' really asks again", async () => {
    respond(503, { ok: false, status: "unavailable" });
    const r = await settle();
    expect(r.result.current.state.status).toBe("error");
    respond(200, { ok: true, status: "granted", position: 3, cutoff: 1000, open: false });
    act(() => r.result.current.recheck());
    await waitFor(() => expect(r.result.current.state.status).toBe("granted"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a different user never sees another user's cached verdict", async () => {
    respond(200, { ok: true, status: "granted", position: 3, cutoff: 1000, open: true });
    const a = await settle();
    a.unmount();
    h.user = { id: "did:privy:someone-else" };
    respond(403, { ok: false, status: "not_member" });
    const b = await settle();
    expect(b.result.current.state).toEqual({ status: "not-member" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
