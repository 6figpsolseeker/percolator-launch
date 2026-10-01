/**
 * Dev-only visual preview for UX work packages (screenshots at 375 / 1440 px). 404 unless the
 * dev server runs with NEXT_PUBLIC_DEV_PREVIEW=1, so it never ships as a reachable page.
 */
import { notFound } from "next/navigation";
import { StatusLinePreview } from "./preview";

export default function Page() {
  if (process.env.NEXT_PUBLIC_DEV_PREVIEW !== "1") notFound();
  return <StatusLinePreview />;
}
