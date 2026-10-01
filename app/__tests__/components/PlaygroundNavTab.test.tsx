/**
 * The Playground tab is a closed door, and must stay one.
 *
 * It ships before devnet v2 opens, so the only behaviour worth pinning is the
 * ABSENCE of behaviour. The failure this guards against is somebody later
 * "tidying" the button into a <Link href="/playground">, which would quietly
 * put a door in the nav before there is a lock behind it.
 *
 * Asserting on the rendered markup rather than on a flag is deliberate: a flag
 * can be true while the markup still navigates.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PlaygroundNavTab } from "@/components/layout/PlaygroundNavTab";

describe("Playground nav tab", () => {
  it("renders, so the assertions below are not vacuous", () => {
    render(<PlaygroundNavTab />);
    expect(screen.getByRole("button", { name: /playground/i })).toBeInTheDocument();
  });

  it("is a button with NO href — there is nothing to navigate to", () => {
    // The core guarantee. No href means no click-through, no middle-click, no
    // "copy link address", and nothing for a crawler to follow.
    const { container } = render(<PlaygroundNavTab />);
    const btn = screen.getByRole("button", { name: /playground/i });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).not.toHaveAttribute("href");
    expect(container.querySelector("a")).toBeNull();
  });

  it("announces itself as unavailable without becoming unreachable", () => {
    // `aria-disabled` rather than `disabled`: a disabled button is dropped from
    // the tab order and says nothing to a screen reader, which is a worse
    // experience than a door you can reach and be told is shut.
    const btn = render(<PlaygroundNavTab />).container.querySelector("button")!;
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  it("clicking does nothing but acknowledge the click", async () => {
    const user = userEvent.setup();
    render(<PlaygroundNavTab />);
    const btn = screen.getByRole("button", { name: /playground/i });

    await user.click(btn);

    // It says when it opens, and still goes nowhere.
    expect(await screen.findByText(/opens with devnet v2/i)).toBeInTheDocument();
    expect(btn).not.toHaveAttribute("href");
  });

  it("does not leak a playground URL anywhere in its markup", () => {
    // Belt and braces: no href, and no stray string a curious visitor could
    // read out of the DOM and try directly.
    const { container } = render(<PlaygroundNavTab />);
    expect(container.innerHTML).not.toMatch(/\/playground/i);
    expect(container.innerHTML).not.toMatch(/percolator-playground/i);
  });
});
