/**
 * POST /api/playground/precheck { email } -> { onList: boolean }
 *
 * Asked before the gate page sends a Privy email code, so a code is only sent to an address that
 * is on the waitlist (product decision 2026-10-02). It reads the waitlist database directly (the
 * same table and membership rule as whoami / the gate: a row with a referral code).
 *
 * Trade-off, accepted: this answers "is this email on the list?". Mitigations: strict per-IP
 * rate limit (a rate-limited caller gets the same `onList: false` as a non-member), no position,
 * id or any other field returned, and logs never carry the email. Entry is still decided only
 * by the authenticated gate (/api/playground/authorize, /enter) — this is a UX filter, not access.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getWaitlistServiceSupabase } from "@/lib/waitlist/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 8;
const hits = new Map<string, { n: number; reset: number }>();

function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset <= now) {
    hits.set(ip, { n: 1, reset: now + WINDOW_MS });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    return false;
  }
  h.n += 1;
  return h.n > MAX_PER_WINDOW;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const answer = (onList: boolean) =>
  NextResponse.json({ onList }, { headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const ip = (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || "unknown";
  if (limited(ip)) return answer(false);
  let email = "";
  try {
    const body = (await req.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return answer(false);
  }
  if (!EMAIL_RE.test(email)) return answer(false);
  try {
    const escaped = email.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data, error } = await getWaitlistServiceSupabase()
      .from("waitlist")
      .select("referral_code")
      .ilike("email", escaped)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[playground/precheck] lookup failed");
      // Fail OPEN for the UX filter only: a DB blip must not stop a member from getting a code.
      // Access itself is still decided by the authenticated gate.
      return NextResponse.json({ onList: true, unverified: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return answer(Boolean((data as { referral_code?: string | null } | null)?.referral_code));
  } catch {
    return NextResponse.json({ onList: true, unverified: true }, { headers: { "Cache-Control": "no-store" } });
  }
}
