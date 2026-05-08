# Troubleshooting

## "Permission denied" / `osascript` errors -1743 / -1744

TCC hasn't granted Calendar Automation to your terminal/IDE. Open **System Settings → Privacy & Security → Automation**, find the app that spawned `npx heckle-mcp`, and toggle **Calendar** on. Full walkthrough in [docs/permissions.md](permissions.md).

If the app isn't in the Automation list at all, fully quit it (`Cmd-Q`) and relaunch — the prompt only fires on a fresh process.

## `osascript` timeouts on big calendars

`OSASCRIPT_TIMEOUT_MS` is 30 seconds by default (and 120 seconds for `list_events`'s per-calendar fan-out). If you have hundreds of calendars or thousands of events in a single calendar, you may hit the ceiling.

Workarounds:

- Narrow the date window. `list_events` with a 7-day window is roughly 10× faster than a 90-day window.
- Filter by `calendars: ["Work"]` instead of letting it scan all writable calendars.
- For `seed_calendar_memory`, run it in chunks (`start_date` = 3 years ago first, then extend to 5).

If you genuinely need a higher timeout, edit `OSASCRIPT_TIMEOUT_MS` in `src/applescript.ts` and rebuild — but understand it's a DoS surface, hence the conservative default.

## All-day events show wrong dates

All-day events in Apple Calendar are stored with a `00:00` local-midnight start in the local timezone. If you `toISOString()` them and parse back, you can drift by a UTC offset.

HECKLE handles this: `update_event` and `create_event` skip the ISO round-trip when `all_day: true`, and `list_events` serializes all-day events back as local-date strings. If you're still seeing drift, file a bug with the calendar name (we want to know if there's an account where this regresses).

## iCloud sync delays

Calendar.app surfaces events from iCloud asynchronously. A `create_event` or `update_event` that succeeds locally may not appear on your iPhone for 30–60 seconds. HECKLE has no visibility into iCloud's queue — Calendar.app owns sync.

If an event appears in HECKLE's `list_events` but is missing from iPhone, give it a minute and re-pull on the phone. If it's missing from `list_events` too, double-check `calendar_name` — the event probably went to a default calendar you weren't expecting.

## Memory file in the wrong location

`~/.apple-calendar-mcp/memory.json` is the canonical path, even after the rename to HECKLE in v0.2.0. We deliberately did **not** move the data directory so existing v0.1.x users keep their memory. A future release may add a one-shot copy-on-first-run to `~/.heckle/`.

If you want to start fresh, delete the file and re-run `seed_calendar_memory`.

## "I broke my calendar, how do I revert?"

If you ran `apply_character_reminders` and want it all back: ask Claude to call `revert_character_reminders`. No arguments needed — it scans a wide window and restores anything carrying the backup sentinel.

If you ran `delete_event` on something you wanted: HECKLE doesn't undelete. Recover from your most recent `~/.apple-calendar-mcp/last_apply_backup_*.json` if it's there, or restore from a Time Machine backup of `~/Library/Calendars/`.

For accidental cross-account moves via `update_event`: the new uid is in the response — search for the title in the destination calendar and you'll find it.

## Encoding issues with Unicode calendar names

HECKLE handles UTF-8 calendar names (`娱乐`, `仕事`, `🌴 Travel`) correctly because everything goes through `escapeAppleScriptString` and `osascript` is UTF-8 throughout. If a calendar name comes back mojibake'd, the bug is in the AppleScript parse path — file an issue with the calendar's exact name and the bytes of the response.

`exclude_calendars` on `time_per_calendar` is **case- and whitespace-sensitive** by design (so a typo doesn't silently exclude nothing). Other write-path matches are case-insensitive.

## "Claude doesn't see HECKLE in the tool list"

Check your MCP config:

```bash
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json
# or
cat ~/.claude.json
```

The `command` should be `npx` and `args` should start with `-y heckle-mcp`. If you previously had `apple-calendar-mcp` configured, replace the package name.

Then quit Claude fully and relaunch. The MCP client only re-reads the config on startup.

## `console.log` is corrupting MCP frames

If you've patched HECKLE locally and added a `console.log`, you'll see Claude reporting MCP errors like `Unexpected token in JSON at position 0`. Replace the `console.log` with `process.stderr.write(\`[heckle-mcp] …\\n\`)`. This is the most common contributor footgun.
