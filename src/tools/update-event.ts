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
import { listCalendars } from "./list-calendars.js";

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

// Sentinel that encodes "this optional field was not set on the source event".
// The AppleScript read path emits this exact string when the property access throws
// (Calendar.app raises on `location`/`description`/`url` for events that never had
// the property assigned). Read back into TS, the sentinel is translated to
// `undefined` so mergeFields can distinguish "unset" from "set to empty string".
const UNSET_SENTINEL = "\x03UNSET\x03";

// Reads the full event state (by uid) across every calendar, plus the host calendar name.
// Emits 11 unit-separated fields so we can preserve "unset" for optional strings and
// flag recurring events / all-day events to the TS orchestrator:
//   uid | summary | start | end | all_day | location-or-UNSET | notes-or-UNSET |
//   calendar_name | url-or-UNSET | recurrence | all_day (again, for parity with parse)
export function buildReadEventScript(eventId: string): string {
  const evId = escapeAppleScriptString(eventId);
  const unsetLiteral = escapeAppleScriptString(UNSET_SENTINEL);
  return `
set us to "${UNIT_SEPARATOR}"
set rs to "${RECORD_SEPARATOR}"
set unsetSentinel to ${unsetLiteral}
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
  set evLoc to unsetSentinel
  try
    set evLoc to (location of ev) as string
  on error
    set evLoc to unsetSentinel
  end try
  set evNotes to unsetSentinel
  try
    set evNotes to (description of ev) as string
  on error
    set evNotes to unsetSentinel
  end try
  set evUrl to unsetSentinel
  try
    set evUrl to (url of ev) as string
  on error
    set evUrl to unsetSentinel
  end try
  set evRecurrence to ""
  try
    set evRecurrence to (recurrence of ev) as string
  on error
    set evRecurrence to ""
  end try
  return (uid of ev as string) & us & (summary of ev as string) & us & (evStart as string) & us & (evEnd as string) & us & allDayFlag & us & evLoc & us & evNotes & us & (name of hostCal as string) & us & evUrl & us & evRecurrence
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

// Fields the merged event must carry into the target calendar. Optional string
// fields use `undefined` to mean "don't set this on the copy" — `""` would stomp
// on a real value the source did not have. Dates are the ISO strings we pass to
// `isoToAppleScriptDate`; all string fields are plain user text (escaping happens
// inside the script builder).
type MergedEventFields = {
  title: string;
  start_date: string;
  end_date: string;
  location?: string;
  notes?: string;
  url?: string;
  all_day: boolean;
};

// Builds a create-event script in a specific target calendar using pre-merged fields.
// Mirrors buildCreateEventScript's output contract so parseEventRecord works unchanged.
// Only emits property setters for fields that are defined — this is how we preserve
// "unset" for location/notes/url so we don't overwrite them with "" on the copy.
export function buildUpdateEventCopyScript(
  targetCalendar: string,
  merged: MergedEventFields,
): string {
  const calName = escapeAppleScriptString(targetCalendar);
  const title = escapeAppleScriptString(merged.title);
  const start = isoToAppleScriptDate(merged.start_date);
  const end = isoToAppleScriptDate(merged.end_date);
  const allDay = merged.all_day ? "true" : "false";

  const props: string[] = [
    `summary:${title}`,
    `start date:${start}`,
    `end date:${end}`,
    `allday event:${allDay}`,
  ];
  if (merged.location !== undefined) {
    props.push(`location:${escapeAppleScriptString(merged.location)}`);
  }
  if (merged.notes !== undefined) {
    props.push(`description:${escapeAppleScriptString(merged.notes)}`);
  }
  if (merged.url !== undefined) {
    props.push(`url:${escapeAppleScriptString(merged.url)}`);
  }

  return `
set us to "${UNIT_SEPARATOR}"
set rs to "${RECORD_SEPARATOR}"
tell application "Calendar"
  set targetCal to first calendar whose name is ${calName}
  tell targetCal
    set newEv to make new event with properties {${props.join(", ")}}
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
// Optional strings are `undefined` when the source event did not set them; a raw
// `""` means the source explicitly stored an empty string. mergeFields keeps that
// distinction so we never create a copy that stomps on an unset field.
export type SourceEvent = CalendarEvent & {
  location?: string;
  notes?: string;
  url?: string;
  recurrence: string | null;
};

export async function updateEvent(args: UpdateEventArgs): Promise<CalendarEvent> {
  const normalized = normalizeUpdateEventDuration(args);

  if (normalized.calendar_name === undefined) {
    return runInPlaceUpdate(normalized);
  }

  // Normalize the target calendar name via listCalendars so "Entertainment " and
  // "entertainment" both resolve to the real Calendar.app calendar name. This also
  // catches read-only targets before we touch the source event.
  const calendars = await listCalendars();
  const targetMatch = calendars.find(
    (c) => c.name.trim().toLowerCase() === normalized.calendar_name!.trim().toLowerCase(),
  );
  if (!targetMatch) {
    throw new AppleCalendarError(
      `Target calendar "${normalized.calendar_name}" not found`,
      `Calendar "${normalized.calendar_name}" not found. Check the name (including trailing spaces) or run list_calendars.`,
    );
  }
  if (!targetMatch.writable) {
    throw new AppleCalendarError(
      `Target calendar "${targetMatch.name}" is read-only`,
      `Cannot move events into "${targetMatch.name}": it is a read-only calendar.`,
    );
  }

  const source = await readSourceEvent(normalized.event_id);

  // Compare against the CANONICAL calendar name (the exact name Calendar.app uses)
  // rather than the raw caller input. This avoids a destructive copy when the caller
  // passes "work " or "WORK" for an event already on "Work".
  if (targetMatch.name === source.calendar_name) {
    return runInPlaceUpdate({ ...normalized, calendar_name: undefined });
  }

  return runCopyThenDelete(normalized, source, targetMatch.name);
}

async function runInPlaceUpdate(args: UpdateEventArgs): Promise<CalendarEvent> {
  const script = buildUpdateEventScript(args);
  const raw = await runAppleScript(script);
  return parseEventOutput(raw);
}

async function runCopyThenDelete(
  args: UpdateEventArgs,
  source: SourceEvent,
  canonicalTarget: string,
): Promise<CalendarEvent> {
  // Recurring events: copy-then-delete flattens the RRULE series to a single instance,
  // which silently breaks every future occurrence. Refuse instead of corrupting data.
  if (source.recurrence && source.recurrence.trim().length > 0) {
    throw new AppleCalendarError(
      `Refusing to move recurring event ${source.id}: copy-then-delete would flatten the RRULE series to a single instance. Source preserved in "${source.calendar_name}".`,
      `Cannot move recurring events between calendars yet — this would lose the recurrence rule. Keep the series in its current calendar or edit it directly in Calendar.app. Tracked for v0.2.`,
    );
  }

  const merged = mergeFields(source, args);

  // Step 1: create the merged event in the target calendar. If this fails, the source
  // is still untouched — we throw and let the caller retry.
  let created: CalendarEvent;
  try {
    const createScript = buildUpdateEventCopyScript(canonicalTarget, merged);
    const raw = await runAppleScript(createScript);
    created = parseEventOutput(raw);
  } catch (err) {
    if (err instanceof AppleCalendarError) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new AppleCalendarError(
      `Failed to create copy in target calendar during move: ${detail}`,
      `Failed to move event to "${canonicalTarget}": could not create copy in target calendar. Original event preserved in "${source.calendar_name}".`,
    );
  }

  // Same-uid guard: if Calendar.app (or iCloud sync) assigned the copy the same uid as
  // the source, the delete step would wipe the copy too. This is the exact mechanism
  // that caused the 6-event data loss incident — abort before it can happen again.
  if (created.id === source.id) {
    throw new AppleCalendarError(
      `Calendar.app assigned the same uid to the copy as the source (${source.id}). Aborting before delete to prevent data loss. Source event preserved in "${source.calendar_name}".`,
      `Could not safely move event between calendars: the copy would overwrite the source. Event preserved in "${source.calendar_name}".`,
    );
  }

  // Step 2: verify exactly one event with the new uid lives in the target calendar.
  // count < 1 means the copy didn't actually land; count > 1 means Calendar.app
  // duplicated it. Either way, deleting the source would make things worse.
  try {
    const verifyScript = buildVerifyEventScript(created.id, canonicalTarget);
    const raw = await runAppleScript(verifyScript);
    const count = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(count) || count !== 1) {
      throw new AppleCalendarError(
        `Verify after copy returned count=${raw.trim()} for uid ${created.id} in "${canonicalTarget}". Expected exactly 1. Source preserved.`,
        `Could not confirm the event was copied cleanly (found ${raw.trim()} matches instead of 1). Source event preserved in "${source.calendar_name}".`,
      );
    }
  } catch (err) {
    if (err instanceof AppleCalendarError) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new AppleCalendarError(
      `Verify step failed after copy: ${detail}`,
      `Event was copied to "${canonicalTarget}" but could not be verified. Source event preserved in "${source.calendar_name}".`,
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
      `[apple-calendar-mcp] WARNING: copy-then-delete update created new event ${created.id} in "${canonicalTarget}", but failed to delete source event ${source.id} from "${source.calendar_name}": ${detail}. Duplicate event may exist; manual cleanup may be needed.\n`,
    );
  }

  return created;
}

export async function readSourceEvent(eventId: string): Promise<SourceEvent> {
  const script = buildReadEventScript(eventId);
  const raw = await runAppleScript(script);
  const [id, title, start, end, allDay, location, notes, calName, url, recurrence] =
    raw.split(UNIT_SEPARATOR);
  const isAllDay = allDay === "true";
  const source: SourceEvent = {
    id: id ?? "",
    title: title ?? "",
    // For all-day events, skip the toISOString() round-trip: parseLocalDateTime
    // treats the AppleScript-emitted local stamp as local time, and a subsequent
    // `new Date(iso).toISOString()` re-anchors to UTC. The copy script then feeds
    // that ISO back into isoToAppleScriptDate which reads UTC components, shifting
    // the date by local UTC offset. Preserve the raw local stamp VERBATIM for
    // all-day events so the copy lands on the same calendar day.
    start: isAllDay ? (start ?? "") : parseLocalDateTimeToIso(start),
    end: isAllDay ? (end ?? "") : parseLocalDateTimeToIso(end),
    all_day: isAllDay,
    calendar_name: calName ?? "",
    location: location === UNSET_SENTINEL ? undefined : (location ?? ""),
    notes: notes === UNSET_SENTINEL ? undefined : (notes ?? ""),
    url: url === UNSET_SENTINEL ? undefined : (url ?? ""),
    recurrence: recurrence && recurrence.length > 0 ? recurrence : null,
  };
  return source;
}

export function mergeFields(source: SourceEvent, args: UpdateEventArgs): MergedEventFields {
  const title = args.title ?? source.title;
  const start_date = args.start_date ?? source.start;
  const end_date = args.end_date ?? source.end;
  const all_day = args.all_day ?? source.all_day;

  // Bounds sanity: reject inverted or zero-length spans. For timed events we additionally
  // lift a short span to the 1-hour minimum to mirror normalizeUpdateEventDuration. All-day
  // events skip the 1-hour floor since their "duration" is a day count, not minutes.
  if (!all_day) {
    const startMs = Date.parse(start_date);
    const endMs = Date.parse(end_date);
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      if (endMs <= startMs) {
        throw new AppleCalendarError(
          `Merged end_date (${end_date}) is not after start_date (${start_date}).`,
          `Cannot update event: end time must be after start time.`,
        );
      }
    }
  }

  return {
    title,
    start_date,
    end_date,
    // Optional strings: only forward them to the copy script when defined. An
    // explicit empty string from args still counts as "set to empty" on purpose.
    location: args.location !== undefined ? args.location : source.location,
    notes: args.notes !== undefined ? args.notes : source.notes,
    url: args.url !== undefined ? args.url : source.url,
    all_day,
  };
}

function parseLocalDateTimeToIso(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toISOString();
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
