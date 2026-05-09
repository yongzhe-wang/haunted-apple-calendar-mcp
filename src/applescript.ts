/**
 * APPLESCRIPT NUMERIC PARSING PITFALL
 *
 * AppleScript can return numeric values in scientific notation
 * when magnitudes exceed certain thresholds:
 *
 *   (current date) - (date "1970-01-01")  →  "1.7769348E+9"
 *
 * `parseInt` on this string returns `1` (it truncates at the `E`).
 * That collapsed thousands of event epoch deltas to the Unix epoch
 * in earlier ad-hoc dump scripts.
 *
 * Defenses:
 *   1. Prefer ISO round-trip: ((theDate as «class isot» as string))
 *      then `Date.parse(iso)` on the JS side.
 *   2. If you must return a number from AppleScript, cast
 *      `as integer` so it comes back in normal form.
 *   3. NEVER `parseInt()` an unbounded AppleScript numeric.
 *      Use `parseFloat()` + `Math.round()` if forced.
 *
 * The MCP tools in this repo use the ISO round-trip path (defense
 * #1) and are safe. This comment exists so future contributors and
 * one-off /tmp scripts don't re-introduce the bug.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppleCalendarError } from "./errors.js";

const execFileAsync = promisify(execFile);

// Record separator (0x1E) and Unit separator (0x1F) are ASCII control chars
// that virtually never appear in calendar data. We use them so fields and
// rows can contain commas, newlines, quotes — anything except these bytes —
// without breaking our parser.
export const RECORD_SEPARATOR = "\x1e";
export const UNIT_SEPARATOR = "\x1f";

// Bumped from 30s to 120s on 2026-04-22 after search_events silently returned []
// for accounts with large writable calendars. A single per-calendar list_events query
// walks every property (uid, summary, start, end, allday, location, notes, url,
// recurrence, plus 12 date-component reads per event for localDateStamp) through the
// Calendar.app AppleScript bridge. On calendars with 100+ events that lookup routinely
// takes 60-90s. The old 30s deadline killed every such call; Promise.allSettled in
// listEvents then swallowed the rejections and returned []. 120s gives Calendar.app
// enough headroom on real user data without letting a pathological loop hang the
// MCP forever. Users with truly pathological calendars may still hit this; the
// fan-out logging in list_events now makes the failure visible instead of silent.
const OSASCRIPT_TIMEOUT_MS = 120_000;
const OSASCRIPT_MAX_BUFFER = 16 * 1024 * 1024;

export async function runAppleScript(script: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout: OSASCRIPT_TIMEOUT_MS,
      maxBuffer: OSASCRIPT_MAX_BUFFER,
    });
    return stdout.replace(/\n$/, "");
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    const stderr = (e.stderr ?? "").toString().trim();
    const stdout = (e.stdout ?? "").toString().trim();
    const detail = stderr || stdout || e.message;
    throw new AppleCalendarError(`osascript failed: ${detail}`, buildFriendlyMessage(detail));
  }
}

function buildFriendlyMessage(detail: string): string {
  if (/not authorized/i.test(detail) || /-1743/.test(detail) || /-1744/.test(detail)) {
    return [
      "macOS denied Calendar access.",
      "Open System Settings → Privacy & Security → Automation,",
      "find your terminal/IDE, and enable Calendar.",
    ].join(" ");
  }
  if (/Calendar got an error/i.test(detail)) {
    return `Calendar.app error: ${detail}`;
  }
  return `AppleScript error: ${detail}`;
}

export function escapeAppleScriptString(s: string): string {
  // Order matters: backslash first (otherwise the \n / \r replacements below
  // would themselves get double-escaped), then double-quote, then newlines.
  // A literal newline inside an AppleScript "..." literal terminates the
  // string and produces a syntax error from osascript, so the \n / \r
  // replacements are required for inputs that may contain line breaks
  // (calendar names, notes, etc.).
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// Calendar.app writes dates in the local macOS calendar timezone, so we build
// explicit local date components instead of passing epoch seconds. That keeps
// "8:00 PM local" pinned to 8:00 PM in Calendar.app rather than drifting by
// the UTC offset when the MCP writes through AppleScript.
export function isoToAppleScriptDate(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) {
    throw new AppleCalendarError(
      `Invalid ISO date: ${iso}`,
      `Invalid date "${iso}". Expected ISO 8601 (e.g. 2026-04-21T14:30:00Z).`,
    );
  }
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const timeSeconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
  const body = `set d to current date
set year of d to ${year}
set month of d to ${month}
set day of d to ${day}
set time of d to ${timeSeconds}
return d`;
  return `(run script ${escapeAppleScriptString(body)})`;
}

export function parseRecords(raw: string): string[][] {
  if (!raw) {
    return [];
  }
  return raw
    .split(RECORD_SEPARATOR)
    .filter((r) => r.length > 0)
    .map((r) => r.split(UNIT_SEPARATOR));
}
