/**
 * The playground app's address must never ship to a browser that has not been
 * admitted. Statically: no client module may contain it, and no client module
 * may import the server-only access/gate libraries (which hold the default
 * address and the signing code). The ONLY emitter is the 303 Location header
 * of /api/playground/enter.
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["app", "components", "hooks", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const rel = (p: string) => path.relative(ROOT, p);
const isClient = (src: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src);

describe("no playground address in client code", () => {
  it("found the source tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(100);
    const clients = files.filter((f) => isClient(fs.readFileSync(f, "utf8")));
    expect(clients.map(rel)).toContain("components/layout/PlaygroundNavTab.tsx");
    expect(clients.map(rel)).toContain("components/playground/EnterPlaygroundButton.tsx");
  });

  it("the address literal lives in exactly one file: lib/playground-access.ts", () => {
    const holders = files.filter((f) => fs.readFileSync(f, "utf8").includes("percolator-playground")).map(rel);
    expect(holders).toEqual(["lib/playground-access.ts"]);
  });

  it("no 'use client' module imports the server-only access or gate libraries", () => {
    const offenders = files
      .filter((f) => {
        const src = fs.readFileSync(f, "utf8");
        return isClient(src) && /from\s+["']@\/lib\/playground-(access|gate)["']/.test(src);
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the address is never a NEXT_PUBLIC_ variable", () => {
    const offenders = files.filter((f) => /NEXT_PUBLIC_PLAYGROUND/.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the signing code exists exactly once", () => {
    const holders = files.filter((f) => /createHmac\([^)]*\)[\s\S]{0,40}handoff|:handoff:v1/.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(holders).toEqual(["lib/playground-access.ts"]);
  });
});
