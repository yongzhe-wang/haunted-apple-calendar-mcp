import {
  escapeAppleScriptString,
  isoToAppleScriptDate,
  parseRecords,
  RECORD_SEPARATOR,
  runAppleScript,
  UNIT_SEPARATOR,
} from "../applescript.js";
import {
  DEFAULT_EXCLUDED_CALENDARS,
  type TimePerCalendarArgs,
  type TimePerCalendarBucket,
  type TimePerCalendarResult,
} from "../types.js";

// Single AppleScript spawn — Calendar.app fan-out per calendar compounds slow
// account latency (the same bug that hit search_events on 2026-04-22). We let
// AppleScript do the duration sum so we never materialize per-event records
// across the osascript boundary for buckets the caller doesn't read.
export function buildTimePerCalendarScript(args: TimePerCalendarArgs): string {
  const startExpr = isoToAppleScriptDate(args.start_date);
  const endExpr = isoToAppleScriptDate(args.end_date);
  const excludedNames = args.exclude_calendars ?? [...DEFAULT_EXCLUDED_CALENDARS];
  const excludedListExpr = excludedNames.map(escapeAppleScriptString).join(", ");
  const excludedDecl =
    excludedNames.length > 0 ? `set excluded to {${excludedListExpr}}` : "set excluded to {}";

  return `
set rs to "${RECORD_SEPARATOR}"
set us to "${UNIT_SEPARATOR}"
set startDate to ${startExpr}
set endDate to ${endExpr}
${excludedDecl}
set out to ""
tell application "Calendar"
  repeat with cal in calendars
    set calName to (name of cal as string)
    set isExcluded to false
    repeat with ex in excluded
      if (ex as string) is equal to calName then set isExcluded to true
    end repeat
    if isExcluded is false then
      set timedSeconds to 0
      set timedCount to 0
      set alldayCount to 0
      set evs to (every event of cal whose start date is less than endDate and end date is greater than startDate)
      repeat with ev in evs
        set evAllDay to (allday event of ev)
        if evAllDay then
          set alldayCount to alldayCount + 1
        else
          set evStart to (start date of ev)
          set evEnd to (end date of ev)
          if evStart < startDate then set evStart to startDate
          if evEnd > endDate then set evEnd to endDate
          set delta to (evEnd - evStart)
          if delta > 0 then
            set timedSeconds to timedSeconds + delta
            set timedCount to timedCount + 1
          end if
        end if
      end repeat
      set out to out & calName & us & (timedSeconds as string) & us & (timedCount as string) & us & (alldayCount as string) & rs
    end if
  end repeat
end tell
return out
`;
}

type RawBucket = {
  name: string;
  timed_seconds: number;
  timed_event_count: number;
  allday_event_count: number;
};

export function parseTimePerCalendarOutput(raw: string): RawBucket[] {
  return parseRecords(raw).map((fields) => {
    const [name, timed, timedCount, alldayCount] = fields;
    return {
      name: name ?? "",
      timed_seconds: safeNumber(timed),
      timed_event_count: safeInt(timedCount),
      allday_event_count: safeInt(alldayCount),
    };
  });
}

function safeNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeInt(value: string | undefined): number {
  return Math.trunc(safeNumber(value));
}

export function computeBuckets(
  raw: RawBucket[],
  windowSeconds: number,
  skipAllday: boolean,
): { calendars: TimePerCalendarBucket[]; totals: TimePerCalendarResult["totals"] } {
  const filtered = skipAllday
    ? raw.filter((b) => b.timed_event_count > 0 || b.timed_seconds > 0)
    : raw.filter((b) => b.timed_event_count > 0 || b.allday_event_count > 0);

  const calendars: TimePerCalendarBucket[] = filtered
    .map((b) => ({
      name: b.name,
      timed_seconds: b.timed_seconds,
      timed_event_count: b.timed_event_count,
      allday_event_count: skipAllday ? 0 : b.allday_event_count,
      pct_of_window: windowSeconds > 0 ? b.timed_seconds / windowSeconds : 0,
    }))
    .toSorted((a, b) => b.timed_seconds - a.timed_seconds);

  const totalsTimed = calendars.reduce((sum, b) => sum + b.timed_seconds, 0);
  const totalsTimedCount = calendars.reduce((sum, b) => sum + b.timed_event_count, 0);
  const totalsAllday = calendars.reduce((sum, b) => sum + b.allday_event_count, 0);

  return {
    calendars,
    totals: {
      timed_seconds: totalsTimed,
      timed_event_count: totalsTimedCount,
      allday_event_count: totalsAllday,
      pct_of_window: windowSeconds > 0 ? totalsTimed / windowSeconds : 0,
    },
  };
}

export async function timePerCalendar(args: TimePerCalendarArgs): Promise<TimePerCalendarResult> {
  const script = buildTimePerCalendarScript(args);
  const raw = await runAppleScript(script);
  const buckets = parseTimePerCalendarOutput(raw);
  const windowSeconds = Math.max(
    0,
    Math.floor((Date.parse(args.end_date) - Date.parse(args.start_date)) / 1000),
  );
  const { calendars, totals } = computeBuckets(buckets, windowSeconds, args.skip_allday);
  return {
    as_of: new Date().toISOString(),
    window: {
      start: args.start_date,
      end: args.end_date,
      total_seconds: windowSeconds,
    },
    calendars,
    totals,
    excluded: args.exclude_calendars ?? [...DEFAULT_EXCLUDED_CALENDARS],
  };
}
