/**
 * /developers' contribute section linked GitHub Discussions (disabled on the repo: 404) and the
 * "good first issue" label (no issue has ever carried it: an empty list). Both now go to the
 * repo's open issues. The fetched good-first-issues list still shows by itself if issues get tagged.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HowToContribute } from "@/components/HowToContribute";

const ISSUES = "https://github.com/dcccrypto/percolator-launch/issues";

describe("HowToContribute links", () => {
  it("has no Discussions or empty-label link; both CTAs open the issue list", () => {
    const { container } = render(<HowToContribute contributorCount={3} goodFirstIssues={[]} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("/discussions"))).toBe(false);
    expect(hrefs.some((h) => h.includes("good%20first%20issue"))).toBe(false);
    expect(screen.getByRole("link", { name: /GitHub Issues/ }).getAttribute("href")).toBe(ISSUES);
    expect(screen.getByRole("link", { name: /open issues/ }).getAttribute("href")).toBe(ISSUES);
  });
});
