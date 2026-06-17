import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { HomeRedirect } from "@/components/home-redirect";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await getSessionUser())) redirect("/login");
  return <HomeRedirect />;
}
