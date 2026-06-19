import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { parseUserSettings } from "@/lib/user-settings";
import { db } from "@/lib/db";
import { HomeRedirect } from "@/components/home-redirect";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) {
    // First-run: an empty instance sends you to create the admin account.
    const hasUsers = (await db.user.count()) > 0;
    redirect(hasUsers ? "/login" : "/signup");
  }
  // Honor a chosen landing page; fall back to device-based when unset.
  const preferred = user.settings ? parseUserSettings(user.settings).defaultLanding : null;
  return <HomeRedirect preferred={preferred} />;
}
