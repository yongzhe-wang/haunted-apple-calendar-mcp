import {
  escapeAppleScriptString,
  isoToAppleScriptDate,
  parseRecords,
  RECORD_SEPARATOR,
  runAppleScript,
  UNIT_SEPARATOR,
} from "../applescript.js";
import type { CalendarEvent, ListEventsArgs } from "../types.js";
import { listCalendars } from "./list-calendars.js";

const RECURRENCE_FIELD_INDEX = 9;
const WEEKDAY_TO_RRULE: Record<number, string> = {
  0: "SU",
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
};

type ParsedEventRecord = CalendarEvent & {
  recurrence?: string;
};

export function buildListEventsScript(args: ListEventsArgs): string {
  const startExpr = isoToAppleScriptDate(args.start_date);
  const endExpr = isoToAppleScriptDate(args.end_date);
  const calendarFilter = args.calendar_name
    ? `if (name of cal as string) is not equal to ${escapeAppleScriptString(args.calendar_name)} then\n        -- skip\n      else`
    : `if (writable of cal) is false then\n        -- skip read-only subscription calendars unless requested explicitly\n      else`;

  return `
set rs to "${RECORD_SEPARATOR}"
set us to "${UNIT_SEPARATOR}"
set startDate to ${startExpr}
set endDate to ${endExpr}
set candidateStartDate to startDate - (180 * days)
set out to ""
tell application "Calendar"
  repeat with cal in calendars
    ${calendarFilter}
      -- Keep one-off events on the exact requested window so short MCP calls stay fast.
      set directEvents to (every event of cal whose start date is less than or equal to endDate and end date is greater than or equal to startDate)
      repeat with ev in directEvents
        set evRecurrence to ""
        try
          set evRecurrence to (recurrence of ev as string)
        on error
          set evRecurrence to ""
        end try
        set evId to (uid of ev)
        set evTitle to (summary of ev)
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
        set evAllDay to (allday event of ev)
        set allDayFlag to "false"
        if evAllDay then set allDayFlag to "true"
        set evStart to my localDateStamp(start date of ev)
        set evEnd to my localDateStamp(end date of ev)
        set calName to (name of cal as string)
        set out to out & (evId as string) & us & (evTitle as string) & us & (evStart as string) & us & (evEnd as string) & us & allDayFlag & us & (evLoc as string) & us & (evNotes as string) & us & calName & us & (evUrl as string) & us & evRecurrence & rs
      end repeat

      -- Recurring events expose the series start date, not the visible occurrence,
      -- so only recurring candidates get the wider lookback window.
      set recurringCandidates to (every event of cal whose recurrence is not equal to "" and start date is less than or equal to endDate and end date is greater than or equal to candidateStartDate)
      repeat with ev in recurringCandidates
        set evRecurrence to ""
        try
          set evRecurrence to (recurrence of ev as string)
        on error
          set evRecurrence to ""
        end try
        set evId to (uid of ev)
        set evTitle to (summary of ev)
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
        set evAllDay to (allday event of ev)
        set allDayFlag to "false"
        if evAllDay then set allDayFlag to "true"
        set evStart to my localDateStamp(start date of ev)
        set evEnd to my localDateStamp(end date of ev)
        set calName to (name of cal as string)
        set out to out & (evId as string) & us & (evTitle as string) & us & (evStart as string) & us & (evEnd as string) & us & allDayFlag & us & (evLoc as string) & us & (evNotes as string) & us & calName & us & (evUrl as string) & us & evRecurrence & rs
      end repeat
    end if
  end repeat
end tell
return out

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

export function parseEventsOutput(raw: string, args?: ListEventsArgs): CalendarEvent[] {
  const parsed = parseRecords(raw).map(parseEventRecord);
  const events = args ? expandAndFilterEvents(parsed, args) : parsed.map(stripRecurrence);
  return sortAndLimitEvents(dedupeEvents(events), args?.limit ?? events.length);
}

function parseEventRecord(fields: string[]): ParsedEventRecord {
  const [id, title, start, end, allDay, location, notes, calName, url] = fields;
  const startDate = parseLocalDateTime(start);
  const endDate = parseLocalDateTime(end);
  const event: CalendarEvent = {
    id: id ?? "",
    title: title ?? "",
    start: Number.isNaN(startDate.getTime()) ? "" : startDate.toISOString(),
    end: Number.isNaN(endDate.getTime()) ? "" : endDate.toISOString(),
    all_day: allDay === "true",
    calendar_name: calName ?? "",
  };
  if (isPresentCalendarField(location)) {
    event.location = location;
  }
  if (isPresentCalendarField(notes)) {
    event.notes = notes;
  }
  if (isPresentCalendarField(url)) {
    event.url = url;
  }
  const recurrence = fields[RECURRENCE_FIELD_INDEX];
  if (recurrence) {
    return { ...event, recurrence };
  }
  return event;
}

function expandAndFilterEvents(events: ParsedEventRecord[], args: ListEventsArgs): CalendarEvent[] {
  const rangeStart = new Date(args.start_date);
  const rangeEnd = new Date(args.end_date);
  return events.flatMap((event) => {
    if (!event.recurrence) {
      return eventOverlapsRange(event, rangeStart, rangeEnd) ? [stripRecurrence(event)] : [];
    }
    return expandWeeklyRecurrence(event, rangeStart, rangeEnd);
  });
}

function expandWeeklyRecurrence(
  event: ParsedEventRecord,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const rule = parseRRule(event.recurrence);
  if (rule.get("FREQ") !== "WEEKLY") {
    return eventOverlapsRange(event, rangeStart, rangeEnd) ? [stripRecurrence(event)] : [];
  }
  const start = new Date(event.start);
  const end = new Date(event.end);
  const durationMs = end.getTime() - start.getTime();
  const until = parseRRuleUntil(rule.get("UNTIL"));
  const interval = Number.parseInt(rule.get("INTERVAL") ?? "1", 10);
  const byDays = new Set(
    (rule.get("BYDAY") ?? WEEKDAY_TO_RRULE[start.getDay()] ?? "").split(",").filter(Boolean),
  );
  const occurrences: CalendarEvent[] = [];

  // Calendar.app gives us the series template; expand only the requested days
  // so a broad recurring calendar cannot flood the MCP response.
  for (const day of eachLocalDay(rangeStart, rangeEnd)) {
    if (!byDays.has(WEEKDAY_TO_RRULE[day.getDay()] ?? "")) {
      continue;
    }
    if (!isOnWeeklyInterval(start, day, interval)) {
      continue;
    }
    const occurrenceStart = withTimeFrom(day, start);
    if (occurrenceStart < start || (until && occurrenceStart > until)) {
      continue;
    }
    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
    const occurrence = {
      ...stripRecurrence(event),
      start: occurrenceStart.toISOString(),
      end: occurrenceEnd.toISOString(),
    };
    if (eventOverlapsRange(occurrence, rangeStart, rangeEnd)) {
      occurrences.push(occurrence);
    }
  }
  return occurrences;
}

function parseRRule(rule: string | undefined): Map<string, string> {
  const parsed = new Map<string, string>();
  for (const part of (rule ?? "").split(";")) {
    const [key, value] = part.split("=");
    if (key && value) {
      parsed.set(key, value);
    }
  }
  return parsed;
}

function parseRRuleUntil(until: string | undefined): Date | undefined {
  if (!until) {
    return undefined;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(until);
  if (!match) {
    return undefined;
  }
  const [, y, m, d, h, min, s] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s)));
}

function parseLocalDateTime(value: string | undefined): Date {
  if (!value) {
    return new Date(Number.NaN);
  }
  return new Date(value);
}

function eventOverlapsRange(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): boolean {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start <= rangeEnd.getTime() &&
    end >= rangeStart.getTime()
  );
}

function* eachLocalDay(rangeStart: Date, rangeEnd: Date): Generator<Date> {
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const finalDay = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  const totalDays = Math.floor((finalDay.getTime() - cursor.getTime()) / (24 * 60 * 60 * 1000));
  for (let i = 0; i <= totalDays; i += 1) {
    yield new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function isOnWeeklyInterval(seriesStart: Date, day: Date, interval: number): boolean {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const startWeek = startOfLocalWeek(seriesStart).getTime();
  const dayWeek = startOfLocalWeek(day).getTime();
  const weeks = Math.floor((dayWeek - startWeek) / weekMs);
  return weeks >= 0 && weeks % Math.max(interval, 1) === 0;
}

function startOfLocalWeek(date: Date): Date {
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  out.setDate(out.getDate() - out.getDay());
  return out;
}

function withTimeFrom(day: Date, timeSource: Date): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    timeSource.getHours(),
    timeSource.getMinutes(),
    timeSource.getSeconds(),
  );
}

function stripRecurrence(event: ParsedEventRecord): CalendarEvent {
  const { recurrence: _recurrence, ...calendarEvent } = event;
  return calendarEvent;
}

function isPresentCalendarField(value: string | undefined): value is string {
  return Boolean(value && value !== "missing value");
}

function sortAndLimitEvents(events: CalendarEvent[], limit: number): CalendarEvent[] {
  return events.toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, limit);
}

function dedupeEvents(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = [event.id, event.title, event.start, event.end, event.calendar_name].join("\x1f");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function listEvents(args: ListEventsArgs): Promise<CalendarEvent[]> {
  if (!args.calendar_name) {
    const calendars = (await listCalendars()).filter((calendar) => calendar.writable);
    // Calendar.app can time out on a single all-calendar recurring query, so
    // default reads fan out per writable Apple/iOS calendar and keep responsive
    // even if one account has an unusually slow local Calendar.app store.
    const settled = await Promise.allSettled(
      calendars.map((calendar) => listEvents({ ...args, calendar_name: calendar.name })),
    );
    // Surface per-calendar failures on stderr so silent empty results (e.g. a
    // single slow calendar timing out) are visible to operators. Without this
    // log, a single timeout on a large calendar blanks out search_events with
    // no user-visible signal — the bug observed on 2026-04-22.
    settled.forEach((result, i) => {
      if (result.status === "rejected") {
        const name = calendars[i]?.name ?? "<unknown>";
        const detail =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        process.stderr.write(
          `[yapping-mcp] list_events: calendar "${name}" failed: ${detail.slice(0, 500)}\n`,
        );
      }
    });
    const events = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    return sortAndLimitEvents(dedupeEvents(events), args.limit);
  }

  const script = buildListEventsScript(args);
  const raw = await runAppleScript(script);
  return parseEventsOutput(raw, args);
}
