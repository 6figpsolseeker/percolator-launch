/**
 * Launch switch, playground origin, entry URL, and which hosts carry the gate.
 */
import { describe, expect, it } from "vitest";
import {
  ENTER_PATH,
  HANDOFF_PARAM,
  playgroundAppUrl,
  playgroundEntryUrl,
  playgroundOpen,
} from "@/lib/playground-access";
import { isPlaygroundGateHost } from "@/lib/playground-hosts";

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe("playgroundOpen — only the exact string 'true' opens", () => {
  it("opens on 'true'", () => expect(playgroundOpen(env({ PLAYGROUND_OPEN: "true" }))).toBe(true));
  it.each(["", "1", "TRUE", "True", " true", "true ", "yes", "on", "false"])("stays shut on %j", (v) => {
    expect(playgroundOpen(env({ PLAYGROUND_OPEN: v }))).toBe(false);
  });
  it("stays shut when unset", () => expect(playgroundOpen(env({}))).toBe(false));
});

describe("playgroundAppUrl", () => {
  it("defaults to the percolator-playground deployment", () => {
    expect(playgroundAppUrl(env({}))).toBe("https://percolator-playground.vercel.app");
    expect(playgroundAppUrl(env({ PLAYGROUND_APP_URL: "  " }))).toBe("https://percolator-playground.vercel.app");
  });
  it("accepts an https origin, trailing slash or not", () => {
    expect(playgroundAppUrl(env({ PLAYGROUND_APP_URL: "https://pg.example.com" }))).toBe("https://pg.example.com");
    expect(playgroundAppUrl(env({ PLAYGROUND_APP_URL: "https://pg.example.com/" }))).toBe("https://pg.example.com");
  });
  it("tolerates http only for localhost", () => {
    expect(playgroundAppUrl(env({ PLAYGROUND_APP_URL: "http://localhost:3001" }))).toBe("http://localhost:3001");
    expect(playgroundAppUrl(env({ PLAYGROUND_APP_URL: "http://pg.example.com" }))).toBeNull();
  });
  it.each([
    "not a url",
    "javascript:alert(1)",
    "ftp://pg.example.com",
    "https://pg.example.com/some/path",
    "https://pg.example.com/?x=1",
    "https://pg.example.com/#frag",
    "https://user:pw@pg.example.com",
  ])("refuses %j rather than 'fixing' it", (v) => {
    expect(playgroundAppUrl(env({ PLAYGROUND_APP_URL: v }))).toBeNull();
  });
});

describe("playgroundEntryUrl", () => {
  it("is <origin>/enter?t=<token>, with the token URL-encoded", () => {
    expect(ENTER_PATH).toBe("/enter");
    expect(HANDOFF_PARAM).toBe("t");
    const u = new URL(playgroundEntryUrl("https://pg.example.com", "abc.d-_e"));
    expect(u.origin + u.pathname).toBe("https://pg.example.com/enter");
    expect(u.searchParams.get("t")).toBe("abc.d-_e");
  });
});

describe("isPlaygroundGateHost — allow-list, mainnet excluded", () => {
  it.each([
    "percolator.trade",
    "PERCOLATOR.TRADE",
    "localhost",
    "localhost:3000",
    "127.0.0.1:3000",
    "percolator-launch.vercel.app",
    "percolator-launch-abc123-khubair-nasirs-projects.vercel.app",
  ])("allows %s", (h) => expect(isPlaygroundGateHost(h)).toBe(true));

  it.each([
    "mainnet.percolatorlaunch.com",
    "percolatorlaunch.com",
    "percolator-mainnet.vercel.app",
    "percolator-mainnet-abc123-khubair-nasirs-projects.vercel.app",
    "percolator-playground.vercel.app",
    "percolator.trade.evil.example",
    "evilpercolator.trade",
    "",
    null,
    undefined,
  ])("refuses %s", (h) => expect(isPlaygroundGateHost(h as string)).toBe(false));
});
