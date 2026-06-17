"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/lib/client-api";

export function AuthForm({
  mode,
  inviteToken,
  lockedEmail,
  submitLabel,
  redirectTo = "/",
}: {
  mode: "login" | "signup";
  inviteToken?: string;
  lockedEmail?: string;
  submitLabel: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState(lockedEmail ?? "");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await api("/api/auth/signup", { body: { name, email, password, inviteToken } });
      } else {
        await api("/api/auth/login", { body: { email, password } });
      }
      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      {mode === "signup" && (
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoFocus required />
        </div>
      )}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
          readOnly={!!lockedEmail}
          autoFocus={mode === "login"}
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
        />
      </div>

      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
        {busy ? "Please wait…" : submitLabel}
      </Button>
    </form>
  );
}
