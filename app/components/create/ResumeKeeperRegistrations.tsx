"use client";

/**
 * Re-sends, once per page load, any market registration this device started but never finished
 * (lib/keeper-register-client.ts resumePendingRegistrations). No signature and no prompt: the
 * proof is the market's own creation transaction. Devnet playground only.
 */
import { useEffect } from "react";
import { getConfig } from "@/lib/config";
import { resumePendingRegistrations } from "@/lib/keeper-register-client";

let ranThisLoad = false;

export function ResumeKeeperRegistrations(): null {
  useEffect(() => {
    if (ranThisLoad || getConfig().network !== "devnet") return;
    ranThisLoad = true;
    let store: Storage | null = null;
    try {
      store = window.localStorage;
    } catch {
      store = null;
    }
    if (store) void resumePendingRegistrations({ store }).catch(() => undefined);
  }, []);
  return null;
}
