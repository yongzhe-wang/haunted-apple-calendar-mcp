# ADR 0003: Calendar.app `uid` is the event identifier

## Status: accepted (2026-04, locked)

## Context

Multiple ways to identify an event: title, start-time, calendar+title, internal ICS uid, AppleScript object reference, etc.

## Decision

Always use Calendar.app's `uid` (Apple's UUID-shaped event id). Stable across moves between calendars, restarts, iCloud sync round-trips.

## Consequences

- ✅ Survives event mutation (rename, reschedule, calendar move)
- ✅ Cross-account safe (when same name appears in multiple calendar accounts)
- ❌ uid changes when an event is deleted-and-recreated (which our `update_event` does for cross-account moves) — caller must re-fetch the new uid
