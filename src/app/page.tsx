import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { parseUserSettings } from "@/lib/user-settings";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** "/" → the landing page, decided on the server (no client-side hop, no splash flash). */
export default async function Home() {
  const user = await getSessionUser();
  if (!user) {
    // First-run: an empty instance sends you to create the admin account.
    const hasUsers = (await db.user.count()) > 0;
    redirect(hasUsers ? "/login" : "/signup");
  }
  const preferred = user.settings ? parseUserSettings(user.settings).defaultLanding : null;
  redirect(preferred ? `/${preferred}` : "/today");
}
