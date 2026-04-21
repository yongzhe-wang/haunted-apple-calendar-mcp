# Changelog

All notable changes to `apple-calendar-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `update_event`: when changing `calendar_name`, use copy-then-delete semantics to avoid the destructive `move` bug where combined rename+move operations silently destroyed the event. Event `id` changes on calendar move (new uid is returned in the response).
- `list_events` now expands weekly recurring Calendar.app series in TypeScript so Apple/iOS Calendar day views include visible course events instead of only non-recurring or partially matched source-account events.
- `list_events` now keeps one-off event queries on the requested window and reserves the wider historical scan for recurring series only, which fixes short-range MCP calls that could hang on large writable calendars.
- `create_event` now normalizes short meeting requests to a minimum one-hour duration by default.
- `update_event` now normalizes short meeting updates to a minimum one-hour duration when both start and end are provided.
- AppleScript date writes now use explicit local date components instead of epoch seconds, fixing timezone drift where local evening meetings could be created several hours late in Calendar.app.
- `create_event` and `update_event` now serialize returned timestamps using the same local-date path as `list_events`, so MCP responses match the wall-clock times actually written to Calendar.app.

### Added

- Competitive landscape section in README comparing apple-calendar-mcp to supermemoryai/apple-mcp, Omar-V2/mcp-ical, joshrutkowski/applescript-mcp, steipete/macos-automator-mcp, and PsychQuant/che-ical-mcp.

## [0.1.0] — 2026-04-21

Initial public release.

### Added

- MCP server bootstrap over stdio (`@modelcontextprotocol/sdk`).
- `list_calendars` — enumerate Calendar.app calendars with a `writable` flag.
- `list_events` — fetch events in any date range, optional calendar filter, default limit 100, cap 500.
- `search_events` — case-insensitive substring match across title, location, and notes. Defaults to a 30-day-back / 90-day-forward window.
- `create_event` — create events on any writable calendar with title, dates, location, notes, url, and all-day flag.
- `update_event` — update any subset of fields on an event by `uid`, including moving the event between calendars.
- `delete_event` — delete an event by `uid`.
- `escapeAppleScriptString` hardening against AppleScript injection, with unit-tested adversarial payloads.
- `isoToAppleScriptDate` for locale-independent date handling (epoch-seconds arithmetic rather than `date "..."` literals).
- Record-separator / unit-separator parsing for deterministic output across Unicode, commas, newlines, and quotes.
- Friendly error messages when macOS Calendar Automation permission is denied.
- MIT license, `os: ["darwin"]` gate, Node `>=22.14.0` engines.

[Unreleased]: https://github.com/yongzhe-wang/apple-calendar-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yongzhe-wang/apple-calendar-mcp/releases/tag/v0.1.0
