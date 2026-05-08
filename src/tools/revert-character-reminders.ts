import { runAppleScript } from "../applescript.js";
import type {
  CalendarEvent,
  RevertCharacterRemindersArgs,
  RevertCharacterRemindersResult,
} from "../types.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import {
  BACKUP_BLOCK_OPEN,
  extractBackup,
  notesWithoutBackup,
} from "./apply-character-reminders.js";
import { listCalendars } from "./list-calendars.js";
import { listEvents } from "./list-events.js";
import { buildUpdateEventScript, readSourceEvent } from "./update-event.js";

const REVERT_FAN_OUT_CONCURRENCY = 4;

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function defaultRevertWindow(now: Date = new Date()): { start: string; end: string } {
  return {
    start: new Date(now.getTime() - FIVE_YEARS_MS).toISOString(),
    end: new Date(now.getTime() + ONE_YEAR_MS).toISOString(),
  };
}

interface RevertScanItem {
  uid: string;
  calendar: string;
  notes?: string;
}

// Pure: filter events down to only those carrying our backup sentinel. Tested
// without spawning osascript.
export function filterEventsWithBackup(events: readonly CalendarEvent[]): RevertScanItem[] {
  return events
    .filter((e) => e.notes && e.notes.includes(BACKUP_BLOCK_OPEN))
    .map((e) => {
      const out: RevertScanItem = { uid: e.id, calendar: e.calendar_name };
      if (e.notes !== undefined) {
        out.notes = e.notes;
      }
      return out;
    });
}

export async function revertCharacterReminders(
  args: RevertCharacterRemindersArgs,
): Promise<RevertCharacterRemindersResult> {
  const window = {
    start: args.start_date ?? defaultRevertWindow().start,
    end: args.end_date ?? defaultRevertWindow().end,
  };
  const allCalendars = await listCalendars();
  const writable = allCalendars.filter((c) => c.writable);
  const targets =
    args.calendars && args.calendars.length > 0 ? args.calendars : writable.map((c) => c.name);

  const scanned = await mapWithConcurrency(targets, REVERT_FAN_OUT_CONCURRENCY, async (name) => {
    try {
      return await listEvents({
        start_date: window.start,
        end_date: window.end,
        calendar_name: name,
        limit: 500,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[yapping-mcp] revert_character_reminders: "${name}" scan failed: ${detail.slice(0, 500)}\n`,
      );
      return [];
    }
  });

  const candidates = filterEventsWithBackup(scanned.flat());
  const reverted: RevertCharacterRemindersResult["reverted"] = [];

  for (const cand of candidates) {
    try {
      const backup = extractBackup(cand.notes);
      if (!backup) {
        reverted.push({
          uid: cand.uid,
          calendar: cand.calendar,
          ok: false,
          error: "Backup block present but unparseable",
        });
        continue;
      }
      // Re-read the source so the title we see actually matches the live event;
      // a parallel edit could have moved on since the scan completed.
      const live = await readSourceEvent(cand.uid);
      const restoredNotes = notesWithoutBackup(live.notes);
      const updateArgs: Parameters<typeof buildUpdateEventScript>[0] = {
        event_id: cand.uid,
        title: backup.title,
        notes: restoredNotes ?? "",
      };
      if (backup.location !== undefined) {
        updateArgs.location = backup.location;
      }
      const script = buildUpdateEventScript(updateArgs);
      await runAppleScript(script);
      reverted.push({
        uid: cand.uid,
        calendar: cand.calendar,
        ok: true,
        restored_title: backup.title,
      });
    } catch (err) {
      reverted.push({
        uid: cand.uid,
        calendar: cand.calendar,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    reverted,
    total_with_backup: candidates.length,
  };
}
