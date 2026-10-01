/**
 * At tablet widths (768-1023px) the desktop header did not fit: measured on /earn, "Create a Market"
 * wrapped to three lines and the nav ran into Portfolio, and at 820-900px a tap on Portfolio opened
 * Community. The hamburger and its menu were md:hidden, so nothing else reached Portfolio there.
 * The desktop nav and the hamburger now switch at lg, together. Layout is not computed in jsdom, so
 * this binds the source; the widths above were measured in Chrome.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const src = fs.readFileSync(path.resolve(__dirname, "../../components/layout/Header.tsx"), "utf8");

describe("header switches desktop/mobile at lg", () => {
  it("desktop nav and Portfolio show from lg", () => {
    expect(src).toMatch(/<nav className="hidden items-center gap-0\.5 lg:flex" aria-label="Main navigation">/);
    expect(src).toMatch(/className=\{`hidden lg:flex \$\{navLinkCls\(pathname\.startsWith\("\/portfolio"\)\)\}`\}/);
  });

  it("the hamburger and its menu hide from lg, not md", () => {
    expect(src).toMatch(/focus-visible:ring-offset-\[var\(--bg\)\] lg:hidden"\s+aria-label=\{mobileOpen \? "Close menu" : "Open menu"\}/);
    expect(src).toMatch(/className="overflow-hidden border-t border-\[var\(--border\)\] bg-\[var\(--bg\)\] lg:hidden"/);
    expect(src).not.toMatch(/md:hidden|hidden md:flex|gap-0\.5 md:flex/);
  });
});
