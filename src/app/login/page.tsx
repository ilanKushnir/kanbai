import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
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
