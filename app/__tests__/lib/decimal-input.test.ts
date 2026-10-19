/**
 * N27: every amount / size / leverage field stripped a decimal comma, so on a comma-locale phone
 * (inputMode="decimal" shows a "," key) "0,5" became "05" = 5, "2,5"x became 25x and "1,5" USDC
 * became 15; Earn refused the comma keystroke, so "10,5" ended as "105". One shared sanitiser now
 * reads a decimal comma as a point, keeping the launch dial's thousands rule for pasted values.
 */
import { describe, expect, it } from "vitest";
import { sanitizeDecimalInput } from "@/lib/decimal-input";
import { nextLeverageInputState } from "@/lib/leverage-control";

/** What a field holds after the user types `keys` one at a time. */
const typed = (keys: string) => [...keys].reduce((v, k) => sanitizeDecimalInput(v + k), "");

describe("sanitizeDecimalInput", () => {
  it("a decimal comma typed key by key is a decimal point", () => {
    expect(typed("0,5")).toBe("0.5");
    expect(typed("1,5")).toBe("1.5");
    expect(typed("10,5")).toBe("10.5");
    expect(typed("1,000")).toBe("1.000"); // typed on a comma keyboard: one point zero zero zero
    expect(typed("1,5,")).toBe("1.5"); // a second separator is dropped, as a second point was
  });

  it("pasted values keep the thousands rule", () => {
    expect(sanitizeDecimalInput("1,000")).toBe("1000");
    expect(sanitizeDecimalInput("12,345,678")).toBe("12345678");
    expect(sanitizeDecimalInput("1,000.50")).toBe("1000.50");
    expect(sanitizeDecimalInput("0,25")).toBe("0.25");
  });

  it("a pasted value that is not a grouped number is a decimal comma, never 1000x larger", () => {
    expect(sanitizeDecimalInput("0,500")).toBe("0.500"); // was "0500" = 500
    expect(sanitizeDecimalInput("12345,678")).toBe("12345.678");
    expect(sanitizeDecimalInput("2,500")).toBe("2500"); // a grouped number: still thousands
  });

  it("CONTROL (unchanged): digits, one point, everything else stripped", () => {
    expect(sanitizeDecimalInput("1.5")).toBe("1.5");
    expect(sanitizeDecimalInput("1.2.3")).toBe("1.23");
    expect(sanitizeDecimalInput("$12a")).toBe("12");
    expect(sanitizeDecimalInput("")).toBe("");
  });
});

describe("the leverage field reads 2,5 as 2.5x, not 25x", () => {
  it("typed key by key", () => {
    let text = "";
    let leverage: number | null = null;
    for (const ch of "2,5") ({ text, leverage } = nextLeverageInputState(text + ch, 20));
    expect(text).toBe("2.5");
    expect(leverage).toBe(2.5);
  });
});
