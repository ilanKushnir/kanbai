"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";

export function AcceptInviteButton({ token, label }: { token: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/invites/accept", { body: { token } });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't accept invite");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button variant="primary" size="lg" className="w-full" onClick={accept} disabled={busy}>
        {busy ? "Joining…" : label}
      </Button>
    </div>
  );
}
