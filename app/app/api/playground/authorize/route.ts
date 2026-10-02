/**
 * POST /api/playground/authorize — report the visitor's playground verdict.
 *
 * The visitor proves who they are with Privy (the wallet they signed up with, or
 * an emailed code); the token is verified against Privy with the app secret
 * (lib/privy-auth) and resolved to a waitlist row by lib/playground-gate, which
 * applies the same membership and position definitions as /api/waitlist/whoami.
 *
 * This route only REPORTS. It never mints a handoff token and never returns the
 * playground's address: entry is POST /api/playground/enter, which re-verifies
 * and redirects. Keeping the two apart means a token exists only for someone
 * who is granted AND pressing "Enter" while PLAYGROUND_OPEN is true — not for
 * every granted member who merely loads the page before launch.
 *
 * Deliberately NOT a GET: a gate that can be triggered by a link is a gate that
 * can be triggered by an <img> tag on another site.
 *
 * Response bodies (and nothing else):
 *   200 { ok: true,  status: "granted", position, cutoff, open }
 *   403 { ok: false, status: "not_yet", position, cutoff }   — member, past the cutoff
 *   403 { ok: false, status: "not_member" }                  — every non-member, identical
 *   401 { ok: false, status: "unauthenticated" }             — bad / missing Privy token
 *   503 { ok: false, status: "unavailable" }                 — unset secret, lookup failure
 * The matched email or wallet is never returned, and only the Privy DID is
 * ever logged.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyPrivyAuth } from "@/lib/privy-auth";
import { getWaitlistServiceSupabase } from "@/lib/waitlist/supabase";
import { accessSecret, playgroundOpen } from "@/lib/playground-access";
import { decidePlaygroundAccess } from "@/lib/playground-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const refuse = (status: "unauthenticated" | "not_member" | "unavailable", httpStatus: number) =>
  NextResponse.json({ ok: false, status }, { status: httpStatus, headers: NO_STORE });

export async function POST(req: NextRequest) {
  if (!accessSecret()) {
    // Fail CLOSED. An unset secret is the likeliest way this ships open, so it
    // refuses everyone rather than waving anyone through.
    console.error("[playground-authorize] PLAYGROUND_ACCESS_SECRET unset or too short — refusing all");
    return refuse("unavailable", 503);
  }

  const auth = await verifyPrivyAuth(req, { fetchUserIfNoIdToken: true });
  if (!auth.ok) return auth.status === 503 ? refuse("unavailable", 503) : refuse("unauthenticated", 401);

  const verdict = await decidePlaygroundAccess(auth, getWaitlistServiceSupabase);
  switch (verdict.kind) {
    case "granted":
      return NextResponse.json(
        {
          ok: true,
          status: "granted",
          position: verdict.position,
          cutoff: verdict.cutoff,
          open: playgroundOpen(),
        },
        { headers: NO_STORE },
      );
    case "not_yet":
      // A proven member is told their OWN position — they already see it on
      // the waitlist page, so it reveals nothing new. Reached only after
      // membership is proven, so it is not an enumeration path.
      return NextResponse.json(
        { ok: false, status: "not_yet", position: verdict.position, cutoff: verdict.cutoff },
        { status: 403, headers: NO_STORE },
      );
    case "not_member":
      return refuse("not_member", 403);
    default:
      return refuse("unavailable", 503);
  }
}
