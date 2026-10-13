import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function MyDayRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.ticket) q.set("ticket", sp.ticket);
  redirect(`/today${q.size ? `?${q}` : ""}`);
}
