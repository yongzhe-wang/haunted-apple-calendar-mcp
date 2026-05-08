import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAppleScript } from "../applescript.js";
import { DEFAULT_MEMORY_DIR } from "../memory.js";
import type { ApplyCharacterRemindersArgs, ApplyCharacterRemindersResult } from "../types.js";
import { readSourceEvent, type SourceEvent } from "./update-event.js";
import { buildUpdateEventScript } from "./update-event.js";

export const BACKUP_BLOCK_OPEN = "---ORIGINAL_TITLE_BACKUP_v1---";
export const BACKUP_BLOCK_CLOSE = "---END_ORIGINAL_TITLE_BACKUP_v1---";

interface BackupPayload {
  title: string;
  notes?: string;
  location?: string;
  applied_at: string;
}

export function buildBackupBlock(payload: BackupPayload): string {
  const json = JSON.stringify(payload);
  return `\n\n${BACKUP_BLOCK_OPEN}\n${json}\n${BACKUP_BLOCK_CLOSE}\n`;
}

export function notesWithBackup(originalNotes: string | undefined, payload: BackupPayload): string {
  // If the source already has a backup block, don't double-wrap — the second
  // run would otherwise nest backups and lose the true original on revert.
  if (originalNotes && originalNotes.includes(BACKUP_BLOCK_OPEN)) {
    return originalNotes;
  }
  const base = originalNotes ?? "";
  return `${base}${buildBackupBlock(payload)}`;
}

export function extractBackup(notes: string | undefined): BackupPayload | undefined {
  if (!notes) {
    return undefined;
  }
  const open = notes.indexOf(BACKUP_BLOCK_OPEN);
  const close = notes.indexOf(BACKUP_BLOCK_CLOSE);
  if (open === -1 || close === -1 || close <= open) {
    return undefined;
  }
  const inner = notes.slice(open + BACKUP_BLOCK_OPEN.length, close).trim();
  try {
    const parsed = JSON.parse(inner) as BackupPayload;
    if (typeof parsed.title !== "string") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function notesWithoutBackup(notes: string | undefined): string | undefined {
  if (!notes) {
    return undefined;
  }
  const open = notes.indexOf(BACKUP_BLOCK_OPEN);
  if (open === -1) {
    return notes;
  }
  const close = notes.indexOf(BACKUP_BLOCK_CLOSE);
  if (close === -1) {
    return notes.slice(0, open).trimEnd();
  }
  const before = notes.slice(0, open);
  const after = notes.slice(close + BACKUP_BLOCK_CLOSE.length);
  const stitched = `${before}${after}`.trim();
  return stitched.length > 0 ? stitched : undefined;
}

interface AppliedItemSnapshot {
  uid: string;
  calendar: string;
  original: BackupPayload;
  new_title: string;
}

export async function applyCharacterReminders(
  args: ApplyCharacterRemindersArgs,
  backupDir: string = DEFAULT_MEMORY_DIR,
): Promise<ApplyCharacterRemindersResult> {
  const applied: ApplyCharacterRemindersResult["applied"] = [];
  const snapshots: AppliedItemSnapshot[] = [];
  const appliedAt = new Date().toISOString();

  for (const item of args.events_with_reminders) {
    try {
      // Pull the live source so we capture original title/notes/location even
      // if Claude composed `new_title` against a stale read.
      let source: SourceEvent;
      try {
        source = await readSourceEvent(item.uid);
      } catch (err) {
        applied.push({
          uid: item.uid,
          calendar: item.calendar,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const backupPayload: BackupPayload = {
        title: source.title,
        applied_at: appliedAt,
      };
      if (source.notes !== undefined) {
        backupPayload.notes = source.notes;
      }
      if (source.location !== undefined) {
        backupPayload.location = source.location;
      }

      // Caller-supplied notes win, but we still append the backup block so
      // revert can find it. If they didn't pass new_notes, we keep the source
      // notes verbatim and append the backup block to those.
      const baseNotes = item.new_notes !== undefined ? item.new_notes : source.notes;
      const newNotes = notesWithBackup(baseNotes, backupPayload);

      if (args.dry_run) {
        applied.push({
          uid: item.uid,
          calendar: item.calendar,
          ok: true,
          new_title: item.new_title,
          backup_pointer: appliedAt,
        });
        snapshots.push({
          uid: item.uid,
          calendar: item.calendar,
          original: backupPayload,
          new_title: item.new_title,
        });
        continue;
      }

      const script = buildUpdateEventScript({
        event_id: item.uid,
        title: item.new_title,
        notes: newNotes,
      });
      await runAppleScript(script);

      applied.push({
        uid: item.uid,
        calendar: item.calendar,
        ok: true,
        new_title: item.new_title,
        backup_pointer: appliedAt,
      });
      snapshots.push({
        uid: item.uid,
        calendar: item.calendar,
        original: backupPayload,
        new_title: item.new_title,
      });
    } catch (err) {
      applied.push({
        uid: item.uid,
        calendar: item.calendar,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let backupPath: string | undefined;
  if (!args.dry_run && snapshots.length > 0) {
    const ts = Math.floor(Date.now() / 1000);
    backupPath = join(backupDir, `last_apply_backup_${ts}.json`);
    try {
      writeFileSync(backupPath, JSON.stringify({ applied_at: appliedAt, snapshots }, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
    } catch (err) {
      process.stderr.write(
        `[haunted-mcp] apply_character_reminders: failed to write backup snapshot at ${backupPath}: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
      backupPath = undefined;
    }
  }

  const result: ApplyCharacterRemindersResult = {
    applied,
    dry_run: args.dry_run,
  };
  if (backupPath) {
    result.backup_path = backupPath;
  }
  return result;
}
