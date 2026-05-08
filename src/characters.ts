import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * RELATIONAL CHARACTER DESIGN PRINCIPLE
 *
 * Each character is someone who would *actually* leave you a note — a relational
 * figure (Mom, Friend, Coach, Therapist, Past-you, Future-you, etc.), not a
 * literary persona. Their commentary's job is not aesthetic; it's referential —
 * surface a relevant past event from `memory_context` and tie it to the current
 * event in ONE sentence. Voice is the wrapper; the punch is the remembered
 * detail. Without a memory hit, the reminder is hollow.
 *
 * Every directive instructs Claude to (a) reference at least one item from the
 * supplied memory_context when generating the sentence, and (b) vary openers
 * across events so the joke does not collapse to a single beat.
 */

export interface Character {
  /** Human-readable label, used in attribution. Must be unique. */
  name: string;
  /** ≤16 chars, embedded into the calendar title (`{title} — {short_label}: …`). */
  short_label: string;
  /** ≤300 chars: tone, syntax, what to reference. Must mention memory. */
  directive: string;
  /** Lowercase substring keywords that fit this character to event titles/notes. */
  triggers?: string[];
  /** When true, this character is a fallback if no other character has trigger overlap. */
  default?: boolean;
}

export const BUILT_IN_CHARACTERS: Character[] = [
  {
    name: "Mom",
    short_label: "Mom",
    triggers: [
      "lunch",
      "dinner",
      "breakfast",
      "exam",
      "test",
      "final",
      "holiday",
      "license",
      "doctor",
      "flight",
      "home",
      "family",
    ],
    directive:
      "Worried Asian mother. Mix 中文 + English naturally. Reference one item from memory_context (a past skipped commitment, missed sleep, food). Vary openers — time / question / 担心 / 记得 / 你上次. ONE sentence. Make it land on memory, not advice.",
  },
  {
    name: "Friend",
    short_label: "Friend",
    triggers: ["lunch", "coffee", "drinks", "hang", "party", "weekly", "with"],
    directive:
      "Lowercase casual, bro/dude/first-name. Reference a memory_context item (last time we did this, who showed up, mild snark about frequency). Vary openers — 'bro' / 'wait' / 'lol' / name-first. ONE sentence. The shared history IS the punch.",
  },
  {
    name: "Coach",
    short_label: "Coach",
    triggers: ["workout", "gym", "run", "practice", "training", "deadline", "review", "session"],
    directive:
      "Discipline-focused, terse. Reference attendance streaks, prior skips, or performance patterns from memory_context. Vary openers — count / verb / name. ONE sentence. No motivation; surface the data.",
  },
  {
    name: "Therapist",
    short_label: "Therapist",
    triggers: ["recurring", "weekly", "late", "conflict", "argue", "1:1", "1on1"],
    directive:
      "Gentle questioning, no diagnoses. Reference frequency from memory_context ('this is the 4th this month', 'noticed a pattern'). Vary openers — observation / question / 'I notice'. ONE sentence. Name the pattern, do not solve it.",
  },
  {
    name: "Past-you",
    short_label: "Past-you",
    triggers: ["recurring", "review", "plan", "goal", "weekly", "monthly"],
    directive:
      "Last-year version of self, second-person, dry. Reference a specific past commitment from memory_context that current-self contradicted. Vary openers — date / quote / 'remember when'. ONE sentence. Catch the inconsistency.",
  },
  {
    name: "Future-you",
    short_label: "Future-you",
    triggers: ["meeting", "research", "abstraction", "office hours", "long"],
    directive:
      "60-year-old self, philosophical, regret-tinged. Reference how memory_context items aged ('still doing this 2 years later'). Vary openers — age / question / aphorism. ONE sentence. 30-year frame.",
  },
  {
    name: "Werner",
    short_label: "Werner",
    triggers: ["research", "abstraction", "void", "philosophy", "writing"],
    directive:
      "Werner Herzog cosmic detachment. Reference a memory_context item as evidence of indifferent recurrence. Vary openers — image / aphorism / direct address. ONE sentence. The void notes you have done this before.",
  },
  {
    name: "Aurelius",
    short_label: "Aurelius",
    triggers: ["exam", "test", "trial", "duty", "interview"],
    directive:
      "Stoic second-person to oneself. Reference a prior trial in memory_context as precedent. Vary openers — 'At [time]' / 'Remember' / 'When the [event]' / 'You have done'. ONE sentence. Brevity-of-life undercurrent.",
  },
  {
    name: "Barkeep",
    short_label: "Barkeep",
    triggers: ["bar", "drinks", "weekly", "evening", "happy hour", "friday"],
    directive:
      "Knowing deadpan bartender. Reference 'same time as' or 'the [name] crowd' using memory_context. Vary openers — weather / glass / 'yeah, the'. ONE sentence. Recognition is the joke.",
  },
  {
    name: "Old friend",
    short_label: "Old friend",
    triggers: ["home", "hometown", "reunion", "school", "college"],
    directive:
      "Best-friend-from-childhood, earnest sentimental. Reference a memory_context item that connects to who you used to be. Vary openers — name / 'remember' / shared-place. ONE sentence. Nostalgia, not condescension.",
  },
  {
    name: "夫子",
    short_label: "夫子",
    triggers: ["family", "dinner", "holiday", "ceremony", "wedding"],
    directive:
      "Confucian classical Chinese register, propriety-focused. Reference a memory_context item to invoke 礼 or 孝. Vary openers — 子曰 / 古人云 / 礼者. ONE sentence. Wisdom anchored to actual past event.",
  },
  {
    name: "Dog",
    short_label: "Dog",
    triggers: ["dinner", "evening", "late", "night", "after"],
    directive:
      "Anxious dog, present-tense. Reference a memory_context item via 'last time' / 'you came back'. Vary openers — *whimper* / wait / 'is it' / 'are we'. ONE sentence. Concrete dog concerns (food, walk, return).",
  },
];

export function getCharacterByName(name: string): Character | undefined {
  return BUILT_IN_CHARACTERS.find((c) => c.name === name);
}

// User-customizable characters live in a sibling file to memory.json so all
// MCP-server-owned state stays under a single ~/.apple-calendar-mcp directory
// (mode 0700, file mode 0600). The file is *optional*: missing → empty list.
export const DEFAULT_CHARACTERS_CONFIG_PATH = join(
  homedir(),
  ".apple-calendar-mcp",
  "characters.json",
);

interface CharactersConfigFile {
  version: 1;
  characters: Character[];
}

/**
 * Validate a single Character record loaded from JSON. We intentionally do this
 * by hand (not zod) so this module stays free of `types.ts` import cycles —
 * `types.ts` consumes `BUILT_IN_CHARACTER_NAMES` from here.
 */
function isValidCharacter(value: unknown): value is Character {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || v.name.trim().length === 0) {
    return false;
  }
  if (
    typeof v.short_label !== "string" ||
    v.short_label.length === 0 ||
    v.short_label.length > 16
  ) {
    return false;
  }
  if (typeof v.directive !== "string" || v.directive.length === 0 || v.directive.length > 300) {
    return false;
  }
  if (v.triggers !== undefined) {
    if (!Array.isArray(v.triggers)) {
      return false;
    }
    if (!v.triggers.every((t) => typeof t === "string")) {
      return false;
    }
  }
  if (v.default !== undefined && typeof v.default !== "boolean") {
    return false;
  }
  return true;
}

/**
 * Load user-defined characters from a config file. Returns [] when the file is
 * missing, empty, malformed, or has the wrong shape — never throws. Invalid
 * entries are silently dropped so a single typo doesn't kill the rest.
 */
export function loadCustomCharacters(path: string = DEFAULT_CHARACTERS_CONFIG_PATH): Character[] {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw) as Partial<CharactersConfigFile>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.characters)) {
      return [];
    }
    return parsed.characters.filter(isValidCharacter);
  } catch {
    return [];
  }
}

/**
 * Merge built-in + persistent + inline characters. Conflict resolution (by
 * `name`): inline > persistent > built-in. Returns a fresh array suitable
 * for `assignCharacters`.
 */
export function mergeCharacterPools(
  builtIns: readonly Character[],
  persistent: readonly Character[],
  inline: readonly Character[],
): Character[] {
  const byName = new Map<string, Character>();
  for (const c of builtIns) {
    byName.set(c.name, c);
  }
  for (const c of persistent) {
    byName.set(c.name, c);
  }
  for (const c of inline) {
    byName.set(c.name, c);
  }
  return Array.from(byName.values());
}
