/**
 * The header's hamburger menu and the bottom tab bar were both <nav aria-label="Mobile navigation">,
 * and below md both are on the page: a screen reader listed two identical landmarks.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

vi.mock("next/navigation", () => ({ usePathname: () => "/markets" }));

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

const navLabels = (rel: string) =>
  [...fs.readFileSync(path.resolve(__dirname, "../../components/layout", rel), "utf8").matchAll(/<nav[^>]*?aria-label="([^"]+)"/gs)].map((m) => m[1]);

describe("nav landmarks have distinct names", () => {
  it("the bottom tab bar is 'Bottom tab bar'", () => {
    render(<MobileBottomNav />);
    expect(screen.getByRole("navigation", { name: "Bottom tab bar" })).toBeTruthy();
  });

  it("no nav label in the header repeats the bottom tab bar's", () => {
    const header = navLabels("Header.tsx");
    const bottom = navLabels("MobileBottomNav.tsx");
    expect(header.length).toBeGreaterThan(0);
    expect(bottom).toEqual(["Bottom tab bar"]);
    expect(header.filter((l) => bottom.includes(l))).toEqual([]);
  });
});
