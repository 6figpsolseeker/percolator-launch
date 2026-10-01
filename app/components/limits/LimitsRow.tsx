"use client";

/**
 * Shared row + notice primitives for the limits panels, in the order ticket's
 * own idiom (10px uppercase micro-label left, mono value right, --border
 * rules, sharp corners). No new visual language.
 */
import { type FC, type ReactNode } from "react";
import { InfoIcon } from "@/components/ui/Tooltip";

export const LimitsRow: FC<{
  label: ReactNode;
  value: ReactNode;
  tooltip?: string;
  valueClass?: string;
  testId?: string;
  data?: Record<string, string>;
}> = ({ label, value, tooltip, valueClass, testId, data }) => (
  <div className="flex items-center justify-between text-[10px]" data-testid={testId} {...prefixData(data)}>
    <span className="flex items-center gap-1 text-[var(--text-secondary)] uppercase tracking-[0.08em]">
      {label}
      {tooltip && <InfoIcon tooltip={tooltip} />}
    </span>
    <span className={`font-mono tabular-nums ${valueClass ?? "text-[var(--text)]"}`}>{value}</span>
  </div>
);

export const LimitsNotice: FC<{
  tone: "warning" | "error" | "info" | "good";
  title?: string;
  children: ReactNode;
  testId: string;
  data?: Record<string, string>;
}> = ({ tone, title, children, testId, data }) => {
  const color =
    tone === "error" ? "var(--short)" : tone === "warning" ? "var(--warning)" : tone === "good" ? "var(--long)" : "var(--accent)";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-testid={testId}
      {...prefixData(data)}
      className="mb-3 border px-3 py-2"
      style={{ borderColor: `color-mix(in srgb, ${color} 30%, transparent)`, background: `color-mix(in srgb, ${color} 5%, transparent)` }}
    >
      {title && (
        <p className="text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color }}>
          {title}
        </p>
      )}
      <p className={`${title ? "mt-1 " : ""}text-[9px] leading-relaxed text-[var(--text-secondary)]`}>{children}</p>
    </div>
  );
};

/** `{ side: "long" }` -> `{ "data-side": "long" }`. */
export function prefixData(d?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (d) for (const [k, v] of Object.entries(d)) out[`data-${k}`] = v;
  return out;
}

/** Signed bps → "+12 bps" / "−3 bps". */
export function fmtBps(b: bigint | number): string {
  const n = typeof b === "bigint" ? Number(b) : b;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} bps`;
}

/** 500 → "±5.00%". */
export function fmtBandPct(bps: number): string {
  return `±${(bps / 100).toFixed(2)}%`;
}
