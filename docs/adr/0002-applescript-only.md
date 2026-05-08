# ADR 0002: osascript is the only spawned subprocess

## Status: accepted (2026-04, locked)

## Context

Apple Calendar has no public read/write API. Options:

- AppleScript (osascript)
- EventKit (Swift framework — no Node binding)
- ~/Library/Calendars filesystem reads (undocumented, unstable)

## Decision

osascript only. Read AND write paths.

## Consequences

- ✅ No native binary builds, no Swift toolchain
- ✅ Calendar.app handles auth, sharing, iCloud sync — we don't reinvent
- ❌ AppleScript is locale-sensitive in date literals; we use epoch-seconds construction (`isoToAppleScriptDate`)
- ❌ Some Calendar.app operations (e.g., creating a calendar inside a specific account) are not exposed via AppleScript on recent macOS — these become user-action steps, not automated
