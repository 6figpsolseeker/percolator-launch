/**
 * The playground gate page.
 *
 * The page renders a verdict the SERVER produced; it never decides anything.
 * So the cases worth pinning are the refusals and the one thing that must never
 * happen: a path into the playground that does not come from a granted verdict.
 *
 * `usePlaygroundAccess` is mocked here because it is the seam between "what the
 * server said" and "what the page shows" — mocking it lets each verdict be
 * rendered exactly as the server would hand it over, which is the thing under
 * test. The hook's own refusal logic is covered separately by the route tests.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  access: { status: "idle" } as Record<string, unknown>,
  privyAvailable: true,
  ready: true,
  authenticated: false,
  login: vi.fn(),
  logout: vi.fn(),
  sendCode: vi.fn(),
  loginWithCode: vi.fn(),
  recheck: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: h.ready, authenticated: h.authenticated, login: h.login, logout: h.logout }),
  useLoginWithEmail: () => ({ sendCode: h.sendCode, loginWithCode: h.loginWithCode }),
}));
vi.mock("@/hooks/usePrivySafe", () => ({ usePrivyAvailable: () => h.privyAvailable }));
vi.mock("@/hooks/usePlaygroundAccess", () => ({
  usePlaygroundAccess: () => ({ state: h.access, recheck: h.recheck }),
}));

import PlaygroundGatePage from "@/app/playground/page";

beforeEach(() => {
  vi.clearAllMocks();
  h.privyAvailable = true;
  h.ready = true;
  h.authenticated = false;
  h.access = { status: "idle" };
});

/** Every anchor the page renders, for the "no way through" assertions. */
const hrefs = (c: HTMLElement) => Array.from(c.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("signed out — the two ways in", () => {
  it("offers both paths, because people joined the waitlist both ways", () => {
    render(<PlaygroundGatePage />);
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with email/i })).toBeInTheDocument();
  });

  it("offers no route into the playground", () => {
    // The ONLY links are back to the waitlist. Nothing here is a door.
    const { container } = render(<PlaygroundGatePage />);
    for (const href of hrefs(container)) {
      expect(href).not.toMatch(/playground-|percolator-playground|\/enter/i);
    }
  });
});

describe("verdicts the server can return", () => {
  it("granted: shows the position and does NOT offer a way in yet", () => {
    h.authenticated = true;
    h.access = { status: "granted", position: 412 };
    const { container } = render(<PlaygroundGatePage />);

    expect(screen.getByText(/on the list/i)).toBeInTheDocument();
    // The position is counted up, so assert on the container text once settled
    // rather than on an exact intermediate frame.
    expect(container.textContent).toMatch(/#\d/);
    // Entry is not wired. A granted verdict must not render a link out, or the
    // gate would be handing over access the server never minted a token for.
    for (const href of hrefs(container)) {
      expect(href).not.toMatch(/playground-|percolator-playground|\/enter/i);
    }
  });

  it("queued: explains the position without pretending it is a refusal", () => {
    h.authenticated = true;
    h.access = { status: "queued", position: 1412, cutoff: 1000 };
    render(<PlaygroundGatePage />);
    expect(screen.getByText(/in the queue/i)).toBeInTheDocument();
    // Points at the thing that actually moves them up.
    expect(screen.getByRole("link", { name: /referral link/i })).toHaveAttribute("href", "/waitlist");
  });

  it("not-member: sends them to sign up, and offers to switch identity", () => {
    h.authenticated = true;
    h.access = { status: "not-member" };
    render(<PlaygroundGatePage />);
    expect(screen.getByText(/don't see you on the list/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /join the waitlist/i })).toHaveAttribute("href", "/waitlist");
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("error: retryable, and never rendered as access", () => {
    // The important half: an error must not look like a grant. A gate that
    // degraded open on a network blip would be no gate at all.
    h.authenticated = true;
    h.access = { status: "error", reason: "network" };
    const { container } = render(<PlaygroundGatePage />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/you'?re on the list/i);
    expect(container.textContent).not.toMatch(/opening group/i);
  });

  it("checking: says so, and shows no verdict", () => {
    h.authenticated = true;
    h.access = { status: "checking" };
    const { container } = render(<PlaygroundGatePage />);
    expect(screen.getByText(/checking the list/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/you'?re on the list/i);
    expect(container.textContent).not.toMatch(/in the queue/i);
  });
});

describe("degraded sign-in", () => {
  it("says so plainly rather than rendering a dead form", () => {
    h.privyAvailable = false;
    render(<PlaygroundGatePage />);
    expect(screen.getByText(/sign-in is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect wallet/i })).toBeNull();
  });
});

describe("the page never leaks an identifier it was not given", () => {
  it("renders no email address anywhere in a verdict", () => {
    // The server deliberately never returns the matched email or wallet, so
    // there is nothing to render. Pin it, because a future "signed in as …"
    // convenience would quietly put a waitlist email on screen.
    h.authenticated = true;
    h.access = { status: "granted", position: 7 };
    const { container } = render(<PlaygroundGatePage />);
    // An EMAIL shape, not a bare "@" -- the page inlines its keyframes, so the
    // text legitimately contains "@keyframes". The naive check flagged that,
    // which is the test being wrong rather than the page leaking.
    expect(container.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
