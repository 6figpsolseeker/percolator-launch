"use client";

import type { FC } from "react";
import { StatusLine } from "@/components/ui/StatusLine";
import { useFixPricing } from "@/hooks/useFixPricing";
import { FIX_PRICING_COPY, fixPricingWhat } from "@/lib/fix-pricing";
import { resolveUserMessage } from "@/lib/limits/user-message";

/** Creator-only, self-hiding: renders nothing unless this wallet owns the LP and the on-chain matcher skew is above 0. */
export const FixPricingAction: FC<{ slabAddress: string }> = ({ slabAddress }) => {
  const { eligible, done, sending, error, fix, ctx } = useFixPricing(slabAddress);
  if (done) {
    return <StatusLine message={{ kind: "fix-pricing-done", variant: "info", title: FIX_PRICING_COPY.done, body: FIX_PRICING_COPY.doneBody }} />;
  }
  if (!eligible) return null;
  const failed = error ? resolveUserMessage(error, { surface: "any" }) : null;
  if (failed && !failed.quiet) {
    return (
      <StatusLine
        message={{ ...failed, action: { id: "improve-pricing", label: FIX_PRICING_COPY.button } }}
        onAction={() => void fix()}
      />
    );
  }
  return (
    <StatusLine
      message={{
        kind: "fix-pricing",
        variant: "info",
        title: FIX_PRICING_COPY.title,
        body: sending ? "Waiting for your approval…" : `${fixPricingWhat(ctx)} ${FIX_PRICING_COPY.signature}`,
        action: sending ? undefined : { id: "improve-pricing", label: FIX_PRICING_COPY.button },
      }}
      onAction={() => void fix()}
    />
  );
};
