import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { parseUserSettings } from "@/lib/user-settings";
import { HomeRedirect } from "@/components/home-redirect";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Honor a chosen landing page; fall back to device-based when unset.
  const preferred = user.settings ? parseUserSettings(user.settings).defaultLanding : null;
  return <HomeRedirect preferred={preferred} />;
}
