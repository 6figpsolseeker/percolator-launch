/**
 * The Playground tab: a locked door for everyone the server has not admitted,
 * and "Enter Playground" only for a granted member while launch is open.
 *
 * The guarantee from #2725 is kept and widened: while locked there is no href
 * on the tab, no anchor in the closed markup, and — in EVERY non-admitted
 * state, popover open or shut — no playground address and no route to the
 * door anywhere in the DOM.
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

describe("locked", () => {
  it("renders, so the assertions below are not vacuous", () => {
    render(<PlaygroundNavTab />);
    expect(screen.getByRole("button", { name: /playground/i })).toBeInTheDocument();
  });

  it("is a button with NO href, and the closed markup holds no anchor at all", () => {
    const { container } = render(<PlaygroundNavTab />);
    const btn = screen.getByRole("button", { name: /playground/i });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).not.toHaveAttribute("href");
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).not.toMatch(/\/playground/i);
  });

  it("aria-disabled, not disabled — reachable and announced as unavailable", () => {
    render(<PlaygroundNavTab />);
    const btn = screen.getByRole("button", { name: /playground/i });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.getAttribute("title")).toMatch(/locked/i);
  });

  it("click opens a calm popover with the cohort and the two next steps", async () => {
    const user = userEvent.setup();
    render(<PlaygroundNavTab />);
    const btn = screen.getByRole("button", { name: /playground/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");

    await user.click(btn);

    expect(btn).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: /playground access/i });
    expect(btn.getAttribute("aria-controls")).toBe(dialog.id);
    expect(dialog).toHaveTextContent("Devnet v2 opens to the first 1,000 on the waitlist.");
    expect(screen.getByRole("link", { name: /check my spot/i })).toHaveAttribute("href", "/playground");
    expect(screen.getByRole("link", { name: /join the waitlist/i })).toHaveAttribute("href", "/waitlist");
    // The tab itself still goes nowhere.
    expect(btn).not.toHaveAttribute("href");
  });

  it("Escape and an outside click dismiss it", async () => {
    const user = userEvent.setup();
    render(<PlaygroundNavTab />);
    const btn = screen.getByRole("button", { name: /playground/i });
    await user.click(btn);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(btn);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("queued: shows their own number and the cohort the server reported", async () => {
    h.access = { status: "queued", position: 1412, cutoff: 1500 };
    const user = userEvent.setup();
    render(<PlaygroundNavTab />);
    await user.click(screen.getByRole("button", { name: /playground/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/first 1,500/);
    expect(screen.getByRole("dialog")).toHaveTextContent(/#1,412/);
  });

  it("granted but launch closed: \"You're in. Opens at launch.\" — and no link at all", async () => {
    h.access = { status: "granted", position: 12, cutoff: 1000, open: false };
    const user = userEvent.setup();
    const { container } = render(<PlaygroundNavTab />);
    const btn = screen.getByRole("button", { name: /playground/i });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    await user.click(btn);
    expect(screen.getByRole("dialog")).toHaveTextContent("You're in. Opens at launch.");
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(screen.queryByText(/enter playground/i)).toBeNull();
  });

  it("without Privy it is simply locked (and never calls a Privy hook)", async () => {
    h.privyAvailable = false;
    h.access = { status: "granted", position: 1, cutoff: 1000, open: true }; // must be ignored
    render(<PlaygroundNavTab />);
    expect(screen.getByRole("button", { name: /playground/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText(/enter playground/i)).toBeNull();
  });

  it.each(LOCKED_STATES)("%s: no door anywhere in the DOM, popover shut or open", async (_l, state) => {
    h.access = state;
    const user = userEvent.setup();
    const { container } = render(<PlaygroundNavTab />);
    expect(container.innerHTML).not.toMatch(DOOR);
    expect(container.querySelector("form")).toBeNull();
    await user.click(screen.getByRole("button", { name: /playground/i }));
    expect(container.innerHTML).not.toMatch(DOOR);
    expect(container.querySelector("form")).toBeNull();
  });
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

  it("no Privy token → does not submit, offers to sign in again", async () => {
    h.getAccessToken.mockResolvedValue(null);
    const submit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    render(<PlaygroundNavTab />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /enter playground/i }));
    });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
    submit.mockRestore();
  });
});
