/**
 * The Playground tab: a plain link to the gate page (/playground) for everyone the
 * server has not admitted, and "Enter Playground" only for a granted member while
 * launch is open. In EVERY non-admitted state the playground app's address and the
 * door (/api/playground/enter) are absent from the DOM.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  privyAvailable: true,
  access: { status: "idle" } as Record<string, unknown>,
  getAccessToken: vi.fn(async () => "privy-access" as string | null),
  identityToken: "privy-id" as string | null,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, onClick, className }: { children: React.ReactNode; href: string; onClick?: () => void; className?: string }) => (
    <a href={href} onClick={onClick} className={className}>{children}</a>
  ),
}));
vi.mock("@/hooks/usePrivySafe", () => ({ usePrivyAvailable: () => h.privyAvailable }));
vi.mock("@/hooks/usePlaygroundAccess", () => ({
  usePlaygroundAccess: () => ({ state: h.access, recheck: vi.fn() }),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ getAccessToken: h.getAccessToken }),
  useIdentityToken: () => ({ identityToken: h.identityToken }),
}));

import { PlaygroundNavTab } from "@/components/layout/PlaygroundNavTab";

beforeEach(() => {
  h.privyAvailable = true;
  h.access = { status: "idle" };
  h.getAccessToken.mockReset();
  h.getAccessToken.mockResolvedValue("privy-access");
  h.identityToken = "privy-id";
});

const LOCKED_STATES: [string, Record<string, unknown>][] = [
  ["idle (signed out)", { status: "idle" }],
  ["checking", { status: "checking" }],
  ["queued", { status: "queued", position: 1412, cutoff: 1000 }],
  ["not-member", { status: "not-member" }],
  ["error", { status: "error", reason: "network" }],
  ["granted, launch closed", { status: "granted", position: 12, cutoff: 1000, open: false }],
];

const DOOR = /percolator-playground|\/enter|\/api\/playground/i;

describe("open tab (no lock) — 2026-10-02 product change", () => {
  it("everyone not admitted sees a plain 'Playground' link to the gate page", () => {
    render(<PlaygroundNavTab />);
    const link = screen.getByRole("link", { name: /^playground$/i });
    expect(link).toHaveAttribute("href", "/playground");
    expect(link.getAttribute("aria-disabled")).toBeNull();
  });

  it("no padlock or 'locked' label", () => {
    const { container } = render(<PlaygroundNavTab />);
    expect(container.innerHTML).not.toMatch(/locked|padlock/i);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("without Privy it is the same plain link (and never calls a Privy hook)", () => {
    h.privyAvailable = false;
    render(<PlaygroundNavTab />);
    expect(screen.getByRole("link", { name: /^playground$/i })).toHaveAttribute("href", "/playground");
  });

  for (const [label, state] of LOCKED_STATES) {
    it(`${label}: the only route is the gate page — never the app address or the door`, () => {
      h.access = state;
      const { container } = render(<PlaygroundNavTab />);
      expect(screen.getByRole("link", { name: /^playground$/i })).toHaveAttribute("href", "/playground");
      expect(container.innerHTML).not.toMatch(DOOR);
    });
  }
});

describe("granted and launch open", () => {
  beforeEach(() => {
    h.access = { status: "granted", position: 12, cutoff: 1000, open: true };
  });

  it("becomes 'Enter Playground': a POST form to this site's door, holding no playground address", () => {
    const { container } = render(<PlaygroundNavTab />);
    const btn = screen.getByRole("button", { name: /enter playground/i });
    expect(btn).toHaveAttribute("type", "submit");
    expect(btn).not.toHaveAttribute("aria-disabled");
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/api/playground/enter");
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).not.toMatch(/percolator-playground/i);
    // The Privy token is not sitting in the DOM at rest.
    expect(container.innerHTML).not.toContain("privy-access");
  });

  it("on click: fetches a fresh Privy token, submits the form, then wipes the fields", async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
      // Capture what would be sent at the moment of submission.
      const fd = new FormData(this);
      submitted.push(Object.fromEntries(fd.entries()) as Record<string, string>);
    });
    const submitted: Record<string, string>[] = [];
    const { container } = render(<PlaygroundNavTab />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enter playground/i }));
    });
    expect(h.getAccessToken).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submitted).toEqual([{ access_token: "privy-access", id_token: "privy-id" }]);
    // .value is a property, not an attribute — innerHTML would not show it.
    const values = Array.from(container.querySelectorAll<HTMLInputElement>("input[type=hidden]")).map((i) => i.value);
    expect(values).toEqual(["", ""]);
    submit.mockRestore();
  });

  it("no token in JS (Privy HttpOnly cookies) → still submits; the server reads the privy-token cookie", async () => {
    h.getAccessToken.mockResolvedValue(null);
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    render(<PlaygroundNavTab />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enter playground/i }));
    });
    expect(submit).toHaveBeenCalledTimes(1);
    submit.mockRestore();
  });
});
