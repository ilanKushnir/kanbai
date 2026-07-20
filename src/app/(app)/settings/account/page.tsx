import type { Metadata } from "next";
import { getContext } from "@/lib/auth";
import { AccountView } from "@/components/settings/account-view";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const ctx = await getContext();
  return (
    <AccountView
      isManager={ctx.isManager}
      user={{
        name: ctx.user.name,
        email: ctx.user.email,
        avatarUrl: ctx.user.avatarUrl,
        avatarColor: ctx.user.avatarColor,
        createdAt: ctx.user.createdAt.toISOString(),
        isSystemAdmin: ctx.isSystemAdmin,
        role: ctx.role,
        workspaceName: ctx.workspace.name,
      }}
    />
  );
}
