"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { SettingsTabs } from "./settings-tabs";
import { BackupSection } from "./backup-section";
import { api } from "@/lib/client-api";
import { APP_VERSION, POWERED_BY } from "@/lib/version";
import { DICTATION_LANGUAGES } from "@/lib/user-settings";
import { cn } from "@/lib/utils";

const LANDING_OPTIONS = [
  { value: "my-day", label: "My Day" },
  { value: "notes", label: "Notes" },
  { value: "boards", label: "Boards" },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const selectCls =
  "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

type Props = {
  isManager: boolean;
  isOwner: boolean;
  defaultLanding: string;
  weekStartsOn: number;
  handedness: string;
  dictationLanguage: string;
  workspaceId: string;
  workspace: { name: string; defaultAgentId: string | null; snapshotLimit: number } | null;
  agents: { id: string; name: string }[];
};

export function SettingsView({ isManager, isOwner, defaultLanding, weekStartsOn, handedness, dictationLanguage, workspaceId, workspace, agents }: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const [landing, setLanding] = React.useState(defaultLanding);
  const [weekStart, setWeekStart] = React.useState(String(weekStartsOn));
  const [hand, setHand] = React.useState(handedness);
  const [dictLang, setDictLang] = React.useState(dictationLanguage);

  async function savePref(body: Record<string, unknown>) {
    try {
      await api("/api/account", { method: "PATCH", body });
      toast({ title: "Preference saved", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  function saveLanding(value: string) {
    setLanding(value);
    void savePref({ defaultLanding: value });
  }

  function saveWeekStart(value: string) {
    setWeekStart(value);
    void savePref({ weekStartsOn: Number(value) });
  }

  function saveHand(value: string) {
    setHand(value);
    void savePref({ handedness: value });
  }

  function saveDictationLanguage(value: string) {
    setDictLang(value);
    void savePref({ dictationLanguage: value });
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Settings</h1>
      <p className="mb-5 text-sm text-fg-muted">Preferences for you and your workspace.</p>
      <SettingsTabs isManager={isManager} />

      {/* Appearance */}
      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Appearance</h2>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-card">
          <div className="text-sm">
            <div className="font-medium">Theme</div>
            <div className="text-fg-muted">Switch between light and dark.</div>
          </div>
          <ThemeToggle />
        </div>
      </section>

      {/* Preferences */}
      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Preferences</h2>
        <div className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-card">
          <div>
            <Label htmlFor="landing">Start page</Label>
            <select id="landing" className={selectCls} value={landing} onChange={(e) => saveLanding(e.target.value)}>
              {LANDING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-fg-subtle">Where Kanbai opens when you sign in.</p>
          </div>
          <div>
            <Label htmlFor="weekstart">Week starts on</Label>
            <select id="weekstart" className={selectCls} value={weekStart} onChange={(e) => saveWeekStart(e.target.value)}>
              {WEEKDAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-fg-subtle">
              Sets how Notes splits “This week” into days and when next-week tasks roll into Today.
            </p>
          </div>
          <div>
            <Label htmlFor="handedness">Handedness</Label>
            <select id="handedness" className={selectCls} value={hand} onChange={(e) => saveHand(e.target.value)}>
              <option value="right">Right-handed</option>
              <option value="left">Left-handed</option>
            </select>
            <p className="mt-1.5 text-xs text-fg-subtle">
              Puts the mobile drag handles on the hand you hold your phone with.
            </p>
          </div>
          <div>
            <Label htmlFor="dictation-language">Dictation language</Label>
            <select
              id="dictation-language"
              className={selectCls}
              value={dictLang}
              onChange={(e) => saveDictationLanguage(e.target.value)}
            >
              {DICTATION_LANGUAGES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-fg-subtle">
              Uses server-side Whisper when configured; Hebrew prefers an Ivrit/whisper-ivrit capable model. iPhone Safari cannot reliably run Whisper models or background sync on-device.
            </p>
          </div>
        </div>
      </section>

      {/* Backup & offline checklist */}
      <BackupSection />

      {/* Workspace (managers) */}
      {isManager && workspace && (
        <WorkspaceSettings
          isOwner={isOwner}
          workspaceId={workspaceId}
          initial={workspace}
          agents={agents}
        />
      )}

      <footer className="mt-8 border-t border-border pt-4 text-center text-xs text-fg-subtle">
        Kanbai v{APP_VERSION} · powered by {POWERED_BY}
      </footer>
    </div>
  );
}

function WorkspaceSettings({
  isOwner,
  workspaceId,
  initial,
  agents,
}: {
  isOwner: boolean;
  workspaceId: string;
  initial: { name: string; defaultAgentId: string | null; snapshotLimit: number };
  agents: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = React.useState(initial.name);
  const [defaultAgentId, setDefaultAgentId] = React.useState(initial.defaultAgentId ?? "");
  const [snapshotLimit, setSnapshotLimit] = React.useState(String(initial.snapshotLimit));
  const [saving, setSaving] = React.useState(false);

  const dirty =
    name !== initial.name ||
    defaultAgentId !== (initial.defaultAgentId ?? "") ||
    snapshotLimit !== String(initial.snapshotLimit);

  async function save() {
    const limit = Math.max(1, Math.min(200, parseInt(snapshotLimit, 10) || initial.snapshotLimit));
    setSaving(true);
    try {
      await api(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        body: {
          ...(isOwner ? { name: name.trim() } : {}),
          defaultAgentId: defaultAgentId || null,
          snapshotLimit: limit,
        },
      });
      toast({ title: "Workspace settings saved", variant: "success" });
      router.refresh();
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : undefined, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Workspace</h2>
      <div className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-card">
        <div>
          <Label htmlFor="ws-name">Workspace name</Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isOwner}
            maxLength={80}
          />
          {!isOwner && <p className="mt-1.5 text-xs text-fg-subtle">Only the owner can rename the workspace.</p>}
        </div>
        <div>
          <Label htmlFor="ws-agent">Default agent for note ingestion</Label>
          <select
            id="ws-agent"
            className={selectCls}
            value={defaultAgentId}
            onChange={(e) => setDefaultAgentId(e.target.value)}
          >
            <option value="">Oldest active agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-fg-subtle">Which agent picks up notes you mark for ingestion.</p>
        </div>
        <div>
          <Label htmlFor="ws-snap">Snapshots to keep</Label>
          <Input
            id="ws-snap"
            type="number"
            min={1}
            max={200}
            value={snapshotLimit}
            onChange={(e) => setSnapshotLimit(e.target.value)}
            className="max-w-[8rem]"
          />
          <p className="mt-1.5 text-xs text-fg-subtle">Older board snapshots beyond this are pruned automatically.</p>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" onClick={save} disabled={!dirty || saving} className={cn(!dirty && "opacity-60")}>
            {saving ? "Saving…" : "Save workspace"}
          </Button>
        </div>
      </div>
    </section>
  );
}
