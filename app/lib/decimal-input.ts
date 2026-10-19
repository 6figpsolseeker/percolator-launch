/**
 * What an amount / size / leverage field accepts while typing: digits and at most one decimal point.
 *
 * A decimal comma is a decimal point (`inputMode="decimal"` gives comma-locale phones a "," key):
 * stripping it turned "0,5" into "05" = 5 and "2,5"x into 25x. Typing is one key at a time, so a
 * comma becomes a dot as it is typed and the field shows it. A pasted value's commas are thousands
 * separators only when it has a dot too ("1,000.50") or is a whole grouped number ("1,000",
 * "12,345,678"). Not "0,500" (no group starts with 0: that is 0.5, not 500) or "12345,678".
 */
export function sanitizeDecimalInput(value: string): string {
  let v = value;
  if (v.includes(",")) {
    v = v.includes(".") || /^[1-9]\d{0,2}(,\d{3})+$/.test(v) ? v.replace(/,/g, "") : v.replace(",", ".");
  }
  const cleaned = v.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
}
