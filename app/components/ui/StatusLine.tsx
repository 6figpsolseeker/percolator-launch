"use client";

/**
 * UX WP-1 / §4.1: the ONE notice component. Each region (ticket, Earn rail, market header,
 * close modal) renders at most one. Variants: info (accent rule), wait (muted rule + pulsing
 * dot), paused (warning rule), error (short rule; only for user-fixable problems).
 * Protocol detail (code, program, logs) lives in the collapsed "Details", never in the body.
 */
import { useState, type FC } from "react";
import type { StatusVariant, UserMessage, UserMessageAction } from "@/lib/limits/user-message";

export interface StatusLineProps {
  message: Pick<UserMessage, "kind" | "variant" | "title" | "body"> & Partial<Pick<UserMessage, "why" | "action" | "details">>;
  onAction?: (action: UserMessageAction) => void;
  /** The pre-WP-3 testid this notice replaces, kept one release for the E2E harness. */
  legacyTestId?: string;
  /** WP-3: a landed tx; "View transaction" lives in Details, never in the body. */
  txUrl?: string;
  className?: string;
}

const RULE: Record<StatusVariant, string> = {
  info: "var(--accent)",
  wait: "var(--text-muted)",
  paused: "var(--warning)",
  error: "var(--short)",
};

export const StatusLine: FC<StatusLineProps> = ({ message, onAction, legacyTestId, txUrl, className = "" }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const d = message.details;
  const hasDetails = !!d && (d.code !== null || !!d.programId || d.logs.length > 0 || !!d.raw);
  const expandable = !!message.why || hasDetails || !!txUrl;
  const detailText = d
    ? [
        d.code !== null ? `code: ${d.code}${d.name ? ` (${d.name})` : ""}` : null,
        d.programId ? `program: ${d.programId}` : null,
        d.raw ? `message: ${d.raw}` : null,
        ...d.logs.slice(-12),
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return (
    <div
      data-testid="status-line"
      data-variant={message.variant}
      data-kind={message.kind}
      data-legacy-testid={legacyTestId}
      role={message.variant === "error" ? "alert" : "status"}
      aria-live={message.variant === "error" ? "assertive" : "polite"}
      className={`relative bg-[var(--bg-elevated)] py-[10px] pl-[14px] pr-3 ${className}`}
    >
      <span aria-hidden="true" className="absolute left-0 top-0 h-full w-[2px]" style={{ background: RULE[message.variant] }} />
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          {message.variant === "wait" && (
            <span aria-hidden="true" data-testid="status-line-pulse" className="inline-block h-[6px] w-[6px] animate-pulse rounded-full bg-[var(--text-muted)]" />
          )}
          {message.title}
        </p>
        {expandable && (
          <button
            type="button"
            data-testid="status-line-why"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 text-[11px] text-[var(--text-secondary)] underline-offset-2 hover:underline"
          >
            {message.why || hasDetails ? "Why?" : "Details"} {open ? "▴" : "▾"}
          </button>
        )}
      </div>
      <p data-testid="status-line-body" className="mt-0.5 text-[13px] leading-snug text-[var(--text)]">
        {message.body}
        {message.action && onAction && (
          <>
            {" "}
            <button
              type="button"
              data-testid="status-line-action"
              data-action={message.action.id}
              onClick={() => onAction(message.action!)}
              className="font-medium text-[var(--accent-text)] underline-offset-2 hover:underline"
            >
              {message.action.label}
            </button>
          </>
        )}
      </p>
      {open && (
        <div data-testid="status-line-details" className="mt-2 space-y-1.5">
          {message.why && <p className="text-[12px] text-[var(--text-secondary)]">{message.why}</p>}
          {txUrl && (
            <a
              data-testid="status-line-tx"
              href={txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-[11px] text-[var(--accent-text)] underline-offset-2 hover:underline"
            >
              View transaction
            </a>
          )}
          {hasDetails && (
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">Details</p>
                <button
                  type="button"
                  data-testid="status-line-copy"
                  onClick={() => {
                    void navigator.clipboard?.writeText(detailText).then(() => setCopied(true), () => undefined);
                  }}
                  className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text)]"
                >
                  {copied ? "Copied" : "Copy details"}
                </button>
              </div>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-[var(--text-secondary)]">{detailText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
