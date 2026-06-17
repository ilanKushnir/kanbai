import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AuthShell } from "@/components/auth/auth-shell";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign up" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getSessionUser()) redirect("/");
  const userCount = await db.user.count();

  if (userCount > 0) {
    return (
      <AuthShell
        title="Sign-ups are invite-only"
        subtitle="This Kanbai instance is already set up. Ask an admin to send you an invite."
        footer={
          <Link href="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Link
          href="/login"
          className="block w-full rounded-xl bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-fg hover:bg-primary-hover"
        >
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set up Kanbai"
      subtitle="Create the first account — it becomes the instance admin and owns the global control panel."
    >
      <AuthForm mode="signup" submitLabel="Create admin account" />
    </AuthShell>
  );
}
