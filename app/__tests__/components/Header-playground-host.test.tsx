/**
 * The Playground tab appears only on hosts that carry the waitlist gate. The
 * mainnet app builds from the same branch and must render exactly as before.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ gateHost: true, seenHost: "" as string }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="connect-button" /> }));
vi.mock("gsap", () => ({ default: { fromTo: vi.fn(), to: vi.fn(), set: vi.fn() } }));
vi.mock("@/hooks/usePrefersReducedMotion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/lib/config", () => ({ getConfig: () => ({ network: "mainnet" }), setNetwork: vi.fn() }));
vi.mock("@/lib/playground-hosts", () => ({
  isPlaygroundGateHost: (host: string) => {
    h.seenHost = host;
    return h.gateHost;
  },
}));

import { Header } from "@/components/layout/Header";

beforeEach(() => {
  h.gateHost = true;
  h.seenHost = "";
});

describe("Header — Playground tab host gating", () => {
  it("gate host: the Playground tab is rendered (desktop + mobile menu)", () => {
    render(<Header />);
    expect(screen.getAllByRole("link", { name: /^playground$/i }).length).toBeGreaterThanOrEqual(1);
    expect(h.seenHost).toBe(window.location.host.split(":")[0]);
  });

  it("any other host (e.g. mainnet.percolatorlaunch.com): no tab at all", () => {
    h.gateHost = false;
    const { container } = render(<Header />);
    expect(screen.queryByRole("link", { name: /^playground$/i })).toBeNull();
    expect(container.innerHTML).not.toMatch(/playground/i);
  });
});
