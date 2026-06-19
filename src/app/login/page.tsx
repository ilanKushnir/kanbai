import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  // First-run: no accounts yet → send them to create the admin account.
  if ((await db.user.count()) === 0) redirect("/signup");
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Kanbai workspace."
      footer={<>Need access? Ask a workspace admin to send you an invite.</>}
    >
      <AuthForm mode="login" submitLabel="Sign in" />
    </AuthShell>
  );
}
