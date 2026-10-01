/**
 * Mint a playground handoff token for a verified waitlist member.
 *
 * The ONLY way into devnet v2. The visitor proves who they are with Privy —
 * either the wallet they signed up with or an emailed code — and this route
 * decides, server-side, whether that identity is on the waitlist and inside the
 * opening cohort. Nothing the browser sends is trusted beyond the Privy token,
 * which is verified against Privy with the app secret (see lib/privy-auth).
 *
 * Deliberately NOT a GET: a gate that can be triggered by a link is a gate that
 * can be triggered by an <img> tag on another site.
 *
 * ON NOT LEAKING THE WAITLIST. The waitlist is invite-only, so "is this address
 * on it?" is a question worth money to a scraper, and this route is the only
 * public thing that knows. Three rules follow, and the tests pin all three:
 *   - every refusal returns the SAME body, so the endpoint cannot be used to
 *     enumerate members (the one exception is a member's own position, which
 *     they are already shown on the waitlist page);
 *   - no email or pubkey is ever logged, only the Privy DID;
 *   - the handoff token is SIGNED, NOT ENCRYPTED — anyone can base64-decode it
 *     — so it carries a waitlist row id and a position, never an identifier.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyPrivyAuth } from "@/lib/privy-auth";
import { getWaitlistServiceSupabase } from "@/lib/waitlist/supabase";
import {
  accessSecret,
  cohortCutoff,
  isWithinCohort,
  mintHandoff,
} from "@/lib/playground-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WaitlistRow = { id: string; pubkey: string | null; email: string | null };
const SELECT = "id, pubkey, email";

/**
 * Position for a waitlist row, by whichever identifier it has.
 *
 * Mirrors `/api/waitlist/whoami`'s helper exactly, including preferring pubkey
 * over email, so the number used to admit someone is the number they were
 * already shown. A second ordering here would mean a member reading "#812" is
 * refused by a gate that computed something else.
 */
async function positionOf(
  supabase: NonNullable<ReturnType<typeof getWaitlistServiceSupabase>>,
  row: WaitlistRow,
): Promise<number | null> {
  try {
    if (row.pubkey) {
      const { data } = await supabase.rpc("waitlist_position", { p_pubkey: row.pubkey });
      if (typeof data === "number") return data;
    }
    if (row.email) {
      const { data } = await supabase.rpc("waitlist_position_by_email", { p_email: row.email });
      if (typeof data === "number") return data;
    }
  } catch (err) {
    console.warn("[playground-authorize] position lookup failed", err);
  }
  return null;
}

/**
 * Resolve a verified Privy identity to a waitlist row.
 *
 * Same order as whoami — DID, then wallets, then emails — because someone who
 * signed up wallet-only and now signs in by email must still resolve. Note both
 * identifier lookups iterate the FULL arrays: Privy exposes every linked wallet
 * and every verified email, and a member who signed up with their second
 * address would otherwise be told they are not a member.
 */
async function resolveRow(
  supabase: NonNullable<ReturnType<typeof getWaitlistServiceSupabase>>,
  did: string,
  wallets: string[],
  emails: string[],
): Promise<WaitlistRow | null> {
  const byDid = await supabase.from("waitlist").select(SELECT).eq("privy_did", did).maybeSingle();
  if (byDid.data) return byDid.data as WaitlistRow;

  for (const pubkey of wallets) {
    const hit = await supabase.from("waitlist").select(SELECT).eq("pubkey", pubkey).maybeSingle();
    if (hit.data) return hit.data as WaitlistRow;
  }
  for (const email of emails) {
    const hit = await supabase.from("waitlist").select(SELECT).eq("email", email).maybeSingle();
    if (hit.data) return hit.data as WaitlistRow;
  }
  return null;
}

/**
 * One refusal shape for every rejection.
 *
 * Not on the waitlist, a bad token and a failed lookup all return the same
 * body. Distinguishing them turns this endpoint into a membership oracle.
 */
type Refusal = "unauthenticated" | "not_member" | "not_yet";

const refuse = (status: Refusal, httpStatus: number) =>
  NextResponse.json({ ok: false, status }, { status: httpStatus });

export async function POST(req: NextRequest) {
  const secret = accessSecret();
  if (!secret) {
    // Fail CLOSED. An unset secret is the likeliest way this ships open, so it
    // must refuse everyone rather than wave everyone through.
    console.error("[playground-authorize] PLAYGROUND_ACCESS_SECRET unset — refusing all");
    return refuse("unauthenticated", 503);
  }

  const auth = await verifyPrivyAuth(req);
  if (!auth.ok) return refuse("unauthenticated", 401);

  const supabase = getWaitlistServiceSupabase();
  if (!supabase) {
    console.error("[playground-authorize] waitlist supabase unavailable");
    return refuse("unauthenticated", 503);
  }

  let row: WaitlistRow | null = null;
  try {
    row = await resolveRow(supabase, auth.userId, auth.solanaWallets ?? [], auth.emails ?? []);
  } catch (err) {
    // Log the DID only — never the email or the pubkey. Logs are the quietest
    // place a waitlist leaks from.
    console.warn(`[playground-authorize] lookup failed for ${auth.userId}`, err);
    return refuse("not_member", 403);
  }

  if (!row) return refuse("not_member", 403);

  const position = await positionOf(supabase, row);
  const cutoff = cohortCutoff();
  if (!isWithinCohort(position, cutoff)) {
    // A real member who is simply not in this cohort DOES get told, with their
    // own position — they already see it on the waitlist page, so it reveals
    // nothing new, and "you are #1,412, opening soon" is the whole difference
    // between a closed door and an explained one. Reached only AFTER membership
    // is proven, so it is not an enumeration path.
    return NextResponse.json(
      { ok: false, status: "not_yet" satisfies Refusal, position, cutoff },
      { status: 403 },
    );
  }

  const token = mintHandoff(row.id, position as number, secret);
  return NextResponse.json({ ok: true, token, position, cutoff });
}
