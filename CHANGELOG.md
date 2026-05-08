# Changelog

All notable changes to `yapping-apple-calendar-mcp` (formerly `apple-calendar-mcp`, `heckle-mcp`, `haunted-apple-calendar-mcp`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-05-08

### Added

- Distiller #17: Aristotle (virtue-ethical / teleological voice — golden mean, eudaimonia, phronesis).

## [0.6.0] - 2026-05-08

### Renamed

- `haunted-apple-calendar-mcp` → `yapping-apple-calendar-mcp` (binary `yapping`; legacy `haunted` bin alias preserved)
- Brand: HAUNTED → YAPPING
- Tagline: "a calendar haunted by people who know you" → "your calendar, but yapping"

### Note

- Data directory `~/.apple-calendar-mcp/` is preserved across all renames (heckle / haunted / yapping); user memory and custom characters survive.

## [0.5.2] - 2026-05-08

### Fixed

- Voice mismatch: LeBron James was previously assigned to CS 580 TA weekly meeting and Final Exam Proctoring events with CS-domain commentary (e.g. "projective geometry, calibration"). Reassigned: CS 580 TA -> Turing (formal CS framing), Final Exam Proctoring -> Mom (logistical/caring). Live calendar updated.

### Changed

- LeBron James `triggers` tightened: removed `practice`, `training`, `team`, `long`, `performance`, `demo`, `pitch` (false-positive on academic / technical events). Now triggers only on work_meeting / 1:1 / manager / longevity / marathon / performance_review / career.
- LeBron James `directive` adds explicit Anti-pattern clause forbidding technical CS / ML / music / academic specifics.

## [0.5.1] - 2026-05-08

### Added

- Distiller #16: Ian (Hearts2Hearts) — K-pop idol voice. ENFP / 3-year-trainee discipline / dopamine register. Triggers on performance / rehearsal / showcase / demo / stage events.

## [0.5.0] - 2026-05-08

### Added — 9-stage YAPPING pipeline

- Memory schema bumped to **v2**. Top-level adds `people`, `topics`, `user_notes`, `external_facts` alongside the existing `events` array. v1 files load unchanged; missing maps default to empty.
- 5 new MCP tools, one per pipeline stage that needed server-side help:
  - `extract_entities_from_input` (Stage 1) — returns the extraction schema + instructions Claude follows to parse a screenshot/message into structured events / people / topics / user statements / intent.
  - `research_entities` (Stage 2) — returns cached non-stale `external_facts` plus a research directive listing entities Claude still has to look up via WebSearch/WebFetch at its layer.
  - `cache_research_facts` (Stage 2 follow-up) — persists Claude's web-research findings into `~/.apple-calendar-mcp/memory.json`'s `external_facts` map (7-day TTL by default).
  - `update_memory_from_input` (Stage 3) — bulk-merges extraction results into events / people / topics / user_notes maps in a single atomic save.
  - `query_full_context_for_event` (Stage 6) — returns the full context bundle (memory_context_items + people_context + topic_context + external_facts + user_notes_relevant) for one event so Claude can compose substantive voice commentary.
- New helpers in `src/memory.ts`: `mergePeople`, `mergeTopics`, `mergeUserNotes`, `mergeExternalFacts`, `getRelevantContextForEvent`, `isFactStale`.
- `enrich_with_character_reminders` now attaches the full v2 context bundle (people / topics / facts / user notes) per event, not just the 3-similar-events memory_context. Returns `REWRITE_INSTRUCTIONS_V2` as `rewrite_template`.
- `REWRITE_INSTRUCTIONS_V2` (exported) — anti-fabrication template that names every context category and tells the LLM to surface domain-specific advice from `external_facts`.

### Changed

- Tool count: 17 -> 22.
- `MemoryFile.version` literal type widened to `1 | 2`. Saves always emit `2`.
- `enrich_with_character_reminders` output schema: each event now carries `people_context`, `topic_context`, `external_facts`, `user_notes_relevant` arrays.

### Note

- Data directory `~/.apple-calendar-mcp/` keeps existing structure. New top-level fields are additive.

### Case studies

- **heyday**: real-world stress test of Stages 2-3. The user's calendar had a single 7-hour `heyday` event. Memory had 0 prior matches. Without web research, voice (夫子) fell back to a placeholder ("初见于此"). With Stage 2 web research, the system surfaced Penn's Hey Day tradition (since 1916, junior→senior moving-up day with red shirts / straw hats / canes / 3-question presidential exam). The same voice (夫子) then composed a grounded sentence: "三年学问, 一日礼成. 红衫戴冠, 君子志学之毕也. 1916 至今同此礼." — every claim traceable to the external fact, none invented.

## [0.4.0] - 2026-05-08

### Renamed

- `yapping-mcp` → `yapping-apple-calendar-mcp` for discoverability. The "haunted" brand stays in the name; "apple-calendar-mcp" is restored verbatim so users searching GitHub / npm / Google for "apple calendar mcp" find this repo. Binary `haunted` still works; `yapping-apple-calendar-mcp` added as an alias bin.
- GitHub repo: `yongzhe-wang/yapping-mcp` → `yongzhe-wang/yapping-apple-calendar-mcp`.
- README rewritten for SEO: keyword-rich H1, FAQ section, expanded Tools section, alt text on every image, outbound links to canonical MCP / Apple / Claude docs.
- Logo widened from 600×300 → 1200×400 so it renders at full readable size in GitHub's README pane and on social-card previews.

### Note

- Data directory `~/.apple-calendar-mcp/` is preserved across this rename. Existing users keep memory, custom characters, and custom distillers untouched.
- MCP server `name` reported over the protocol is now `yapping-apple-calendar-mcp` (was `yapping-mcp`). Existing config blocks that key the server as `"haunted"` continue to work.

## [0.3.1] - 2026-05-08

### Added

- 3 new built-in distillers: Alan Turing (CS history), LeBron James (athlete leadership), Hilary Hahn (violinist discipline). Pool: 12 -> 15.

## [0.3.0] - 2026-05-07

### Added

- Distillers — synthetic voices of specific named people (Garry Tan, Paul Graham, Naval Ravikant, Sam Altman, Steve Jobs, Andrej Karpathy, Marc Andreessen, Jeff Bezos, Charlie Munger, Brian Chesky, Joan Didion, plus an "Old Founder" archetype fallback). Built-in pool of 12; user can add more at `~/.apple-calendar-mcp/distillers.json` or inline.
- New tool: `list_distillers` — enumerate available distillers, filter by `worldview_filter` or `name_filter`. Output carries the synthetic-voice disclaimer at every layer.
- New tool: `distill_voice_from_text` — orchestrator that lets the calling LLM analyse a user-supplied corpus and fill in a draft Distiller (`directive`, `signature_phrases`).
- `enrich_with_character_reminders` now accepts `distiller_pool[]` and `custom_distillers[]`; distillers merge with characters into one assignment pool. Output events carry `distiller_attribution` + `distiller_signature_phrases` when the assigned voice is a distiller.

### Note

- Each distiller carries an `attribution` field marking the voice as synthetic / not endorsed by the named individual. Same disclaimer surfaced in `list_distillers` envelope `notice` and embedded in every directive.

## [0.2.1] - 2026-05-07

### Renamed

- `heckle-mcp` → `yapping-mcp` (binary `haunted`).
- Tagline updated: "your calendar, but yapping."

### Note

- Data directory `~/.apple-calendar-mcp/` is preserved across renames; user memory and custom characters survive.

## [0.2.0] - 2026-05-07

### Renamed

- Package: `apple-calendar-mcp` → `heckle-mcp` (binary `heckle`).
- Server identity (`McpServer` name) and stderr log prefix updated to `heckle-mcp`.
- Internal data directory **kept** at `~/.apple-calendar-mcp/` (memory.json + characters.json) so existing user state survives the rename. Will migrate in a future release with a one-shot copy-on-first-run.

### Added

- 5 new MCP tools: `seed_calendar_memory`, `query_calendar_memory`, `enrich_with_character_reminders`, `apply_character_reminders`, `revert_character_reminders`.
- Custom character config layer: `~/.apple-calendar-mcp/characters.json` plus inline `custom_characters` argument.
- 4 voice/persona/mortality tools previously shipped in 0.1.x: `list_events_in_persona`, `list_events_in_mixed_personas`, `time_per_calendar`, `mortality_overlay`.
- OpenCloud-style governance docs: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/ISSUE_TEMPLATE/{bug,feature}.yml`, `.github/PULL_REQUEST_TEMPLATE.md`.
- New `docs/` folder: architecture, permissions, full tool reference, examples, troubleshooting, three ADRs (stdio, AppleScript-only, uid-as-id), logo SVG.

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

## [0.1.3] - 2026-04-22

### Fixed

- `update_event`: forward-time in-place moves no longer fail with Calendar.app `-10025 "The start date must be before the end date."` when the new start is after the current end. The in-place AppleScript now parks `end date` at `(newStart + 1h)` before touching `start date`, then sets the real end — keeping `start <= end` legal through every setter regardless of move direction. Observed 2026-04-22 moving an Apr 21 19:00-20:00 event to Apr 22 19:00-20:00.
- `search_events` (and any other fan-out caller of `list_events`) no longer silently returns `[]` when one or more per-calendar queries time out. The `osascript` deadline is raised from 30 s to 120 s to accommodate Calendar.app's slow AppleScript bridge on writable calendars with 60+ events, and `list_events` now logs every `Promise.allSettled` rejection to `stderr` instead of swallowing it. Observed 2026-04-22 searching for `极佳` against an existing Apr 28 event — the substring matcher was correct, but the underlying fan-out had already been silently aborted.

## [0.1.2] - 2026-04-21

### Fixed

- `update_event`: same-uid delete race — when Calendar.app or iCloud sync assigned the copy the same uid as the source, the subsequent delete would wipe the copy too. Now aborts with a clear error before the destructive step. This is the exact mechanism that caused the 6-event data loss on 2026-04-21.
- `update_event`: case- and whitespace-insensitive calendar-name resolution via `list_calendars`. "Entertainment " vs "Entertainment" no longer triggers a destructive copy-then-delete.
- `update_event`: verify step now requires `count === 1` (previously only guarded `count < 1`). A duplicate copy no longer silently deletes the source.
- `update_event`: rejects read-only target calendars before touching the source event.
- `update_event`: all-day events no longer drift by local UTC offset during calendar moves — the TS `toISOString()` round-trip is skipped for `all_day: true`.
- `update_event`: `mergeFields` distinguishes "unset" from empty string for optional fields via a sentinel, so the copy never stomps a user's existing location/notes/url with "".
- `update_event`: rejects inverted bounds (`end_date <= start_date`) after field merging.

### Added

- `update_event`: explicit rejection with a clear error when asked to move a recurring event across calendars — previously this silently flattened the RRULE series to a single instance. Full recurring-event move support tracked for v0.2.
- Orchestrator-level tests covering verify-fail, create-fail, delete-fail, same-uid, recurring, read-only-target, and nonexistent-target branches.
- Adversarial escape tests for `location`, `notes`, and `url` in the copy script builder.

### Changed

- `update_event`: when `calendar_name` changes, the returned `id` is now a new uid (the copy's uid). Callers caching ids must refresh after a cross-calendar move.

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

[Unreleased]: https://github.com/yongzhe-wang/apple-calendar-mcp/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/yongzhe-wang/apple-calendar-mcp/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/yongzhe-wang/apple-calendar-mcp/compare/v0.1.0...v0.1.2
[0.1.0]: https://github.com/yongzhe-wang/apple-calendar-mcp/releases/tag/v0.1.0
