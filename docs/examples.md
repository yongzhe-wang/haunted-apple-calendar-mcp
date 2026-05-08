# Examples

Eight things to ask Claude once HAUNTED is wired up. Each prompt shows the tool calls Claude is likely to make and what you'll see come back.

## 1. "What's on my calendar this week?"

The hello-world prompt.

- **Tool calls:** `list_events` with `start_date` = Monday 00:00, `end_date` = Sunday 23:59.
- **Result:** Claude reads the events and gives you a prose summary, usually grouped by day. No mutation.

## 2. "How much of my year so far is on calendar?"

Year-to-date budget check.

- **Tool calls:** `time_per_calendar` with `start_date` = Jan 1, `end_date` = today, `skip_allday` = true.
- **Result:** A per-calendar breakdown in minutes/hours, plus a grand total. Claude usually converts to a percent of waking hours unprompted.

## 3. "Apply the anxious golden retriever persona to last week."

For when you want your calendar narrated by your dog.

- **Tool calls:** `list_events_in_persona` with `persona: "dog"`, last week's window. The server returns the events plus the persona directive; Claude does the actual rewriting in chat.
- **Result:** Each event read back to you in a small, anxious, treat-motivated voice. Nothing is written to Calendar.app.

## 4. "What's my calendar look like in 35 different writers' voices?"

The party trick.

- **Tool calls:** `list_events_in_mixed_personas` with the default voice pool (~36 voices), `assignment_strategy: "thematic"`, and probably `include_mortality: true` because the contrast is funnier with the lifespan numbers.
- **Result:** A long list where every event is annotated by a different voice — the DMV appointment narrated by Kafka, the recurring 1:1 narrated by a noir detective, the dentist narrated by Sylvia Plath.

## 5. "Build memory of the past 3 years and add character commentary to next week."

The full character-memory pipeline.

- **Tool calls:**
  1. `seed_calendar_memory` with `start_date` = 3 years ago, `end_date` = today.
  2. `enrich_with_character_reminders` with next week's window and the default character pool.
  3. (After Claude composes the new titles) `apply_character_reminders` with `dry_run: true` first to preview, then for real.
- **Result:** Every event next week gets a one-line addition from someone who knows you — Mom on the dentist appointment, your bartender on the wine tasting, Past-You on the recurring 1:1 you've been having for two years. Each line references a specific past event.

## 6. "Add my therapist as a custom character. Use them on my recurring 1:1s."

Bring-your-own-character.

- **Tool calls:**
  1. Claude reads your existing `~/.apple-calendar-mcp/characters.json` (or you write a new one).
  2. `enrich_with_character_reminders` with `custom_characters: [{ name: "Therapist", triggers: ["1:1", "therapy"], directive: "...", short_label: "Therapist" }]`.
  3. `apply_character_reminders`.
- **Result:** The next time your weekly 1:1 with your manager comes up, the title carries a small note in your therapist's voice. (Whether this is good for you is between you and them.)

## 7. "Show me what % of my 80-year life this Tuesday meeting will cost over the next year."

Recurring-meeting reality check.

- **Tool calls:** `mortality_overlay` with the recurring meeting's window expanded across the next year, `expected_lifespan_years: 80`, `birth_date` set if you've shared it.
- **Result:** A row per occurrence, each with a `life_fraction_pct`, and a cumulative number at the bottom. The 30-minute weekly meeting that looked harmless turns out to be 0.04% of your remaining waking life. Or it's nothing. Depends what you want to hear.

## 8. "Revert all character reminders."

Undo the whole experiment.

- **Tool calls:** `revert_character_reminders` (no arguments — defaults scan a wide window).
- **Result:** Every event whose notes carry the `---ORIGINAL_TITLE_BACKUP_v1---` sentinel is restored. Title, notes, location all back to what they were before `apply_character_reminders` touched them. Idempotent; safe to run anytime.
