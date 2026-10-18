"use client";

import * as sync from "./sync-store";
import { clientId } from "./today-sync";
import { subtaskId, type SubtaskItem } from "@/lib/subtask-list";
import type { TaskItem } from "@/lib/today-model";
import type { SubtaskEdit } from "@/components/today/subtasks";

/**
 * One subtask edit, queued like every other Today edit: a simple task's list
 * is patched whole (it lives on the task); a ticket's goes row by row.
 */
export function enqueueSubtaskEdit(item: TaskItem, e: SubtaskEdit) {
  if (item.kind === "note") {
    const list = item.note.subtasks ?? [];
    const next: SubtaskItem[] =
      e.type === "add"
        ? [...list, { id: subtaskId(), title: e.title, completed: false }]
        : e.type === "delete"
          ? list.filter((s) => s.id !== e.id)
          : list.map((s) => (s.id !== e.id ? s : e.type === "toggle" ? { ...s, completed: e.completed } : { ...s, title: e.title }));
    sync.enqueue({ kind: "note.patch", id: item.id, body: { subtasks: next }, optimistic: { subtasks: next } });
    return;
  }
  const ticketId = item.id;
  if (e.type === "add") sync.enqueue({ kind: "ticket.subtask.create", ticketId, subtask: { id: clientId(), title: e.title, completed: false } });
  else if (e.type === "delete") sync.enqueue({ kind: "ticket.subtask.delete", ticketId, id: e.id });
  else sync.enqueue({ kind: "ticket.subtask.patch", ticketId, id: e.id, body: e.type === "toggle" ? { completed: e.completed } : { title: e.title } });
}

export const itemSubtasks = (item: TaskItem): SubtaskItem[] => (item.kind === "note" ? item.note.subtasks : item.ticket.subtasks) ?? [];
