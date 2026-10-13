import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function NotesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.focus) q.set("focus", sp.focus);
  if (sp.compose) q.set("compose", sp.compose);
  redirect(`/today${q.size ? `?${q}` : ""}`);
}
