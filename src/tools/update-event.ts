import {
  escapeAppleScriptString,
  isoToAppleScriptDate,
  RECORD_SEPARATOR,
  runAppleScript,
  UNIT_SEPARATOR,
} from "../applescript.js";
import { AppleCalendarError } from "../errors.js";
import type { CalendarEvent, UpdateEventArgs } from "../types.js";
import { buildDeleteEventScript } from "./delete-event.js";

export function normalizeUpdateEventDuration(args: UpdateEventArgs): UpdateEventArgs {
  if (!args.start_date || !args.end_date) {
    return args;
  }
  const startMs = Date.parse(args.start_date);
  const endMs = Date.parse(args.end_date);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return args;
  }
  if (endMs - startMs >= 60 * 60 * 1000) {
    return args;
  }
  // Only normalize when both bounds are present; partial updates should preserve the existing event span.
  return {
    ...args,
    end_date: new Date(startMs + 60 * 60 * 1000).toISOString(),
  };
}

// In-place update script for the same-calendar path. The previous `move ev to targetCal`
// branch was destructive: Calendar.app's AppleScript bridge does not reliably keep the
// `ev` reference valid after a move, so a combined rename+move could orphan the event.
// The calendar-change path now goes through `updateEvent`'s copy-then-delete logic.
export function buildUpdateEventScript(args: UpdateEventArgs): string {
  const evId = escapeAppleScriptString(args.event_id);
  const setters: string[] = [];
  if (args.title !== undefined) {
    setters.push(`set summary of ev to ${escapeAppleScriptString(args.title)}`);
  }
  if (args.start_date !== undefined) {
    setters.push(`set start date of ev to ${isoToAppleScriptDate(args.start_date)}`);
  }
  if (args.end_date !== undefined) {
    setters.push(`set end date of ev to ${isoToAppleScriptDate(args.end_date)}`);
  }
  if (args.location !== undefined) {
    setters.push(`set location of ev to ${escapeAppleScriptString(args.location)}`);
  }
  if (args.notes !== undefined) {
    setters.push(`set description of ev to ${escapeAppleScriptString(args.notes)}`);
  }
  if (args.url !== undefined) {
    setters.push(`set url of ev to ${escapeAppleScriptString(args.url)}`);
  }
  if (args.all_day !== undefined) {
    setters.push(`set allday event of ev to ${args.all_day ? "true" : "false"}`);
  }

  return `
set us to "${UNIT_SEPARATOR}"
set rs to "${RECORD_SEPARATOR}"
set foundEv to missing value
set hostCal to missing value
tell application "Calendar"
  repeat with cal in calendars
    try
      set candidate to (first event of cal whose uid is ${evId})
      set foundEv to candidate
      set hostCal to cal
      exit repeat
    on error
      -- not in this calendar, continue
    end try
  end repeat
  if foundEv is missing value then
    error "Event not found: ${args.event_id.replace(/"/g, '\\"')}"
  end if
  set ev to foundEv
  ${setters.join("\n  ")}
end tell
tell application "Calendar"
  repeat with cal in calendars
    try
      set ev to (first event of cal whose uid is ${evId})
      set hostCal to cal
      exit repeat
    end try
  end repeat
  set evStart to my localDateStamp(start date of ev)
  set evEnd to my localDateStamp(end date of ev)
  set evAllDay to (allday event of ev)
  set allDayFlag to "false"
  if evAllDay then set allDayFlag to "true"
  try
    set evLoc to (location of ev)
  on error
    set evLoc to ""
  end try
  try
    set evNotes to (description of ev)
  on error
    set evNotes to ""
  end try
  try
    set evUrl to (url of ev)
  on error
    set evUrl to ""
  end try
  return (uid of ev as string) & us & (summary of ev as string) & us & (evStart as string) & us & (evEnd as string) & us & allDayFlag & us & (evLoc as string) & us & (evNotes as string) & us & (name of hostCal as string) & us & (evUrl as string)
end tell

on localDateStamp(d)
  return (year of d as string) & "-" & my pad2(month of d as integer) & "-" & my pad2(day of d as integer) & "T" & my pad2(hours of d as integer) & ":" & my pad2(minutes of d as integer) & ":" & my pad2(seconds of d as integer)
end localDateStamp

on pad2(n)
  if n is less than 10 then
    return "0" & (n as string)
  end if
  return n as string
end pad2
`;
}

// Reads the full event state (by uid) across every calendar, plus the host calendar name.
// The output shape matches the in-place update script's final record so the same parser works.
export function buildReadEventScript(eventId: string): string {
  const evId = escapeAppleScriptString(eventId);
  return `
set us to "${UNIT_SEPARATOR}"
set rs to "${RECORD_SEPARATOR}"
set foundEv to missing value
set hostCal to missing value
tell application "Calendar"
  repeat with cal in calendars
    try
      set candidate to (first event of cal whose uid is ${evId})
      set foundEv to candidate
      set hostCal to cal
      exit repeat
    on error
      -- not in this calendar, continue
    end try
  end repeat
  if foundEv is missing value then
    error "Event not found: ${eventId.replace(/"/g, '\\"')}"
  end if
  set ev to foundEv
  set evStart to my localDateStamp(start date of ev)
  set evEnd to my localDateStamp(end date of ev)
  set evAllDay to (allday event of ev)
  set allDayFlag to "false"
  if evAllDay then set allDayFlag to "true"
  try
    set evLoc to (location of ev)
  on error
    set evLoc to ""
  end try
  try
    set evNotes to (description of ev)
  on error
    set evNotes to ""
  end try
  try
    set evUrl to (url of ev)
  on error
    set evUrl to ""
  end try
  return (uid of ev as string) & us & (summary of ev as string) & us & (evStart as string) & us & (evEnd as string) & us & allDayFlag & us & (evLoc as string) & us & (evNotes as string) & us & (name of hostCal as string) & us & (evUrl as string)
end tell

on localDateStamp(d)
  return (year of d as string) & "-" & my pad2(month of d as integer) & "-" & my pad2(day of d as integer) & "T" & my pad2(hours of d as integer) & ":" & my pad2(minutes of d as integer) & ":" & my pad2(seconds of d as integer)
end localDateStamp

on pad2(n)
  if n is less than 10 then
    return "0" & (n as string)
  end if
  return n as string
end pad2
`;
}

// Fields the merged event must carry into the target calendar. Dates are the ISO strings
// we pass to `isoToAppleScriptDate`; all string fields are plain user text (escaping
// happens inside the script builder).
type MergedEventFields = {
  title: string;
  start_date: string;
  end_date: string;
  location: string;
  notes: string;
  url: string;
  all_day: boolean;
};

// Builds a create-event script in a specific target calendar using pre-merged fields.
// Mirrors buildCreateEventScript's output contract so parseEventRecord works unchanged.
export function buildUpdateEventCopyScript(
  targetCalendar: string,
  merged: MergedEventFields,
): string {
  const calName = escapeAppleScriptString(targetCalendar);
  const title = escapeAppleScriptString(merged.title);
  const start = isoToAppleScriptDate(merged.start_date);
  const end = isoToAppleScriptDate(merged.end_date);
  const location = escapeAppleScriptString(merged.location);
  const notes = escapeAppleScriptString(merged.notes);
  const url = escapeAppleScriptString(merged.url);
  const allDay = merged.all_day ? "true" : "false";

  return `
set us to "${UNIT_SEPARATOR}"
set rs to "${RECORD_SEPARATOR}"
tell application "Calendar"
  set targetCal to first calendar whose name is ${calName}
  tell targetCal
    set newEv to make new event with properties {summary:${title}, start date:${start}, end date:${end}, location:${location}, description:${notes}, url:${url}, allday event:${allDay}}
  end tell
  set evId to (uid of newEv)
  set evStart to my localDateStamp(start date of newEv)
  set evEnd to my localDateStamp(end date of newEv)
  set evAllDay to (allday event of newEv)
  set allDayFlag to "false"
  if evAllDay then set allDayFlag to "true"
  try
    set evLoc to (location of newEv)
  on error
    set evLoc to ""
  end try
  try
    set evNotes to (description of newEv)
  on error
    set evNotes to ""
  end try
  try
    set evUrl to (url of newEv)
  on error
    set evUrl to ""
  end try
  return (evId as string) & us & (summary of newEv as string) & us & (evStart as string) & us & (evEnd as string) & us & allDayFlag & us & (evLoc as string) & us & (evNotes as string) & us & (name of targetCal as string) & us & (evUrl as string)
end tell

on localDateStamp(d)
  return (year of d as string) & "-" & my pad2(month of d as integer) & "-" & my pad2(day of d as integer) & "T" & my pad2(hours of d as integer) & ":" & my pad2(minutes of d as integer) & ":" & my pad2(seconds of d as integer)
end localDateStamp

on pad2(n)
  if n is less than 10 then
    return "0" & (n as string)
  end if
  return n as string
end pad2
`;
}

// Counts events with the given uid in the target calendar. Used to confirm the new
// event actually landed before we delete the source.
export function buildVerifyEventScript(eventId: string, targetCalendar: string): string {
  const evId = escapeAppleScriptString(eventId);
  const calName = escapeAppleScriptString(targetCalendar);
  return `
tell application "Calendar"
  set targetCal to first calendar whose name is ${calName}
  set matches to (count of (every event of targetCal whose uid is ${evId}))
  return matches as string
end tell
`;
}

// Parsed shape of a source event lookup — the buildReadEventScript output.
type SourceEvent = CalendarEvent & {
  location: string;
  notes: string;
  url: string;
};

export async function updateEvent(args: UpdateEventArgs): Promise<CalendarEvent> {
  const normalized = normalizeUpdateEventDuration(args);

  if (normalized.calendar_name === undefined) {
    return runInPlaceUpdate(normalized);
  }

  // The in-place path is still the best when the caller specified the same calendar
  // the event is already on — we need to look up the source first to know.
  const source = await readSourceEvent(normalized.event_id);
  if (source.calendar_name === normalized.calendar_name) {
    return runInPlaceUpdate(normalized);
  }

  return runCopyThenDelete(normalized, source);
}

async function runInPlaceUpdate(args: UpdateEventArgs): Promise<CalendarEvent> {
  const script = buildUpdateEventScript(args);
  const raw = await runAppleScript(script);
  return parseEventOutput(raw);
}

async function runCopyThenDelete(
  args: UpdateEventArgs,
  source: SourceEvent,
): Promise<CalendarEvent> {
  const merged = mergeFields(source, args);
  const targetCalendar = args.calendar_name ?? source.calendar_name;

  // Step 1: create the merged event in the target calendar. If this fails, the source
  // is still untouched — we throw and let the caller retry.
  let created: CalendarEvent;
  try {
    const createScript = buildUpdateEventCopyScript(targetCalendar, merged);
    const raw = await runAppleScript(createScript);
    created = parseEventOutput(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new AppleCalendarError(
      `Failed to create copy in target calendar during move: ${detail}`,
      `Failed to move event to "${targetCalendar}": could not create copy in target calendar. Original event preserved.`,
    );
  }

  // Step 2: verify the new event exists in the target calendar. Calendar.app is slow
  // enough that we trust `make new event` returning a uid, but we still confirm before
  // taking a destructive action on the source.
  try {
    const verifyScript = buildVerifyEventScript(created.id, targetCalendar);
    const raw = await runAppleScript(verifyScript);
    const count = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(count) || count < 1) {
      throw new AppleCalendarError(
        `Verify step found ${raw.trim()} events with uid ${created.id} in ${targetCalendar}`,
        `Event was copied to "${targetCalendar}" but could not be verified. Original event preserved.`,
      );
    }
  } catch (err) {
    if (err instanceof AppleCalendarError) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new AppleCalendarError(
      `Verify step failed after copy: ${detail}`,
      `Event was copied to "${targetCalendar}" but could not be verified. Original event preserved.`,
    );
  }

  // Step 3: delete the source by its old uid. If this fails we have a duplicate, which
  // is recoverable by hand. A lost event is not. So we log and keep the new event.
  try {
    const deleteScript = buildDeleteEventScript({ event_id: source.id });
    await runAppleScript(deleteScript);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[apple-calendar-mcp] WARNING: copy-then-delete update created new event ${created.id} in "${targetCalendar}", but failed to delete source event ${source.id} from "${source.calendar_name}": ${detail}. Duplicate event may exist; manual cleanup may be needed.\n`,
    );
  }

  return created;
}

async function readSourceEvent(eventId: string): Promise<SourceEvent> {
  const script = buildReadEventScript(eventId);
  const raw = await runAppleScript(script);
  const [id, title, start, end, allDay, location, notes, calName, url] = raw.split(UNIT_SEPARATOR);
  const startDate = parseLocalDateTime(start);
  const endDate = parseLocalDateTime(end);
  return {
    id: id ?? "",
    title: title ?? "",
    start: Number.isNaN(startDate.getTime()) ? "" : startDate.toISOString(),
    end: Number.isNaN(endDate.getTime()) ? "" : endDate.toISOString(),
    all_day: allDay === "true",
    calendar_name: calName ?? "",
    location: location ?? "",
    notes: notes ?? "",
    url: url ?? "",
  };
}

function mergeFields(source: SourceEvent, args: UpdateEventArgs): MergedEventFields {
  return {
    title: args.title ?? source.title,
    start_date: args.start_date ?? source.start,
    end_date: args.end_date ?? source.end,
    location: args.location ?? source.location,
    notes: args.notes ?? source.notes,
    url: args.url ?? source.url,
    all_day: args.all_day ?? source.all_day,
  };
}

function parseEventOutput(raw: string): CalendarEvent {
  const [id, title, start, end, allDay, location, notes, calName, url] = raw.split(UNIT_SEPARATOR);
  const startDate = parseLocalDateTime(start);
  const endDate = parseLocalDateTime(end);
  const event: CalendarEvent = {
    id: id ?? "",
    title: title ?? "",
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    all_day: allDay === "true",
    calendar_name: calName ?? "",
  };
  if (location) {
    event.location = location;
  }
  if (notes) {
    event.notes = notes;
  }
  if (url) {
    event.url = url;
  }
  return event;
}

function parseLocalDateTime(value: string | undefined): Date {
  if (!value) {
    return new Date(Number.NaN);
  }
  return new Date(value);
}
