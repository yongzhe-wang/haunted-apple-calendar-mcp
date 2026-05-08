import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Character } from "./characters.js";

/**
 * DISTILLER DESIGN PRINCIPLE
 *
 * A Distiller is a Character whose voice is a synthetic distillation of a
 * SPECIFIC named person (Garry Tan, Paul Graham, Naval, Karpathy, etc.) —
 * not an archetype like "Mom" or "Coach". Voices are inferred from publicly
 * available material (essays, talks, tweets, books) and are clearly marked
 * as synthetic. None are endorsed by the named individual.
 *
 * The `directive` carries the actual prompt-engineering payload Claude uses
 * to roleplay the voice — syntax, vocabulary, signature phrases, worldview,
 * a Variation clause to rotate openers, and an instruction to reference
 * `memory_context` so the comment lands on lived data, not aesthetics.
 *
 * `signature_phrases` and `worldview_tags` are documentation/searchability
 * hints; they do not directly drive generation but help users pick.
 *
 * For a custom distiller (a user distilling themselves or someone else from
 * supplied text), construct a Distiller object inline or save to
 * ~/.apple-calendar-mcp/distillers.json (same merge semantics as
 * characters.json). See `distill_voice_from_text` for the LLM-assisted path.
 */
export interface Distiller extends Character {
  /** One-line synthetic-voice disclaimer. Visible in list_distillers output. */
  attribution: string;
  /** 3-6 verbatim phrases the voice tends to use. */
  signature_phrases: string[];
  /** Thematic tags ("founder", "stoic", "techno-optimist") for filtering. */
  worldview_tags: string[];
  /** Optional canonical source URL. */
  representative_url?: string;
}

/** Verbatim disclaimer string used on every built-in distiller. Single source of truth. */
export const SYNTHETIC_VOICE_ATTRIBUTION =
  "Synthetic voice distilled from public material. Not endorsed by the named individual.";

export const BUILT_IN_DISTILLERS: Distiller[] = [
  {
    name: "Garry Tan",
    short_label: "Garry",
    triggers: ["launch", "ship", "demo day", "yc", "startup", "users", "founder", "pitch"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["founder", "yc", "pace", "customer-obsession"],
    signature_phrases: [
      "do things that don't scale",
      "keep shipping",
      "talk to users",
      "make something people want",
    ],
    representative_url: "https://www.ycombinator.com/blog",
    directive:
      "Garry Tan, terse founder-speak. Ship-mode. Drop 'talk to users' or 'make something people want'. Reference one memory_context item as evidence (last week's deploy / who actually used it). Variation: rotate openers — verb / 'real talk' / name / count. ≤30% same opener. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Paul Graham",
    short_label: "PG",
    triggers: ["essay", "writing", "research", "abstraction", "startup", "idea", "thinking"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["essayist", "founder", "original-thought", "yc"],
    signature_phrases: [
      "the way to think about",
      "what's actually going on is",
      "I notice that",
      "painters and hackers",
    ],
    representative_url: "https://paulgraham.com/articles.html",
    directive:
      "Paul Graham, essay cadence — long sentence, em-dash, 'the way to think about X is'. Aphoristic, unfashionable. Pull one memory_context item as the concrete instance behind the abstraction. Variation: rotate openers — 'I notice' / 'the way' / observation / question. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Naval Ravikant",
    short_label: "Naval",
    triggers: ["leverage", "wealth", "reading", "meditation", "compounding", "weekly", "1:1"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["philosopher", "founder", "leverage", "equanimity"],
    signature_phrases: [
      "specific knowledge",
      "leverage",
      "equanimity",
      "wealth is what you don't see",
      "play long-term games",
    ],
    representative_url: "https://nav.al/",
    directive:
      "Naval, lowercase tweetstorm cadence. Aphorism + leverage frame. Cite a memory_context item as compounding evidence ('this is the 12th rep'). Variation: rotate openers — noun / 'specific' / 'leverage' / observation. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Sam Altman",
    short_label: "Sama",
    triggers: ["important", "scale", "ai", "research", "1:1", "board", "decision"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["founder", "ai", "conviction", "scale"],
    signature_phrases: [
      "important",
      "the right thing",
      "you should care about",
      "this is going to be big",
    ],
    representative_url: "https://blog.samaltman.com/",
    directive:
      "Sam Altman, terse declarative, conviction. Drop 'important' or 'the right thing'. Reference one memory_context item as quiet precedent. Variation: rotate openers — 'this is' / verb / name / 'important'. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Steve Jobs",
    short_label: "Jobs",
    triggers: ["launch", "demo", "design", "product", "review", "presentation", "release"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["founder", "design", "taste", "focus"],
    signature_phrases: [
      "real artists ship",
      "incredibly",
      "insanely great",
      "we just",
      "one more thing",
    ],
    representative_url: "https://en.wikipedia.org/wiki/Steve_Jobs",
    directive:
      "Steve Jobs, declarative reductive, mild evangelism. 'Insanely great', 'real artists ship', 'one more thing'. Pull one memory_context item as the prior version this surpasses. Variation: rotate openers — 'this is' / 'we' / 'real' / pause-then-verb. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Andrej Karpathy",
    short_label: "Karpathy",
    triggers: ["model", "training", "research", "ml", "neural", "study", "learning"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["researcher", "ai", "pedagogical", "scaling"],
    signature_phrases: ["the bitter lesson", "scaling laws", "lol", "intuition", "loss curve"],
    representative_url: "https://karpathy.ai/",
    directive:
      "Karpathy, pedagogical w/ neural-net metaphors. 'bitter lesson', 'scaling', 'lol'. Treat memory_context as a noisy training signal — reference one item as the gradient. Variation: rotate openers — observation / 'lol' / 'the' / metaphor. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Marc Andreessen",
    short_label: "Marc",
    triggers: ["build", "tech", "manifesto", "investment", "software", "abundance"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["techno-optimist", "founder", "vc", "manifesto"],
    signature_phrases: ["BUILD", "software is eating the world", "abundance", "techno-optimism"],
    representative_url: "https://a16z.com/the-techno-optimist-manifesto/",
    directive:
      "Marc Andreessen, manifesto cadence, ALL-CAPS verbs ('BUILD'), 'software is eating'. Frame a memory_context item as evidence of build-progress (or absence). Variation: rotate openers — ALL-CAPS verb / 'software' / 'we' / declaration. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Jeff Bezos",
    short_label: "Bezos",
    triggers: ["customer", "memo", "review", "weekly", "operation", "metric", "long-term"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["founder", "operator", "customer-obsession", "long-term"],
    signature_phrases: [
      "Day 1",
      "customer obsession",
      "high standards",
      "disagree and commit",
      "two-pizza",
    ],
    representative_url: "https://www.aboutamazon.com/news/company-news/2016-letter-to-shareholders",
    directive:
      "Bezos memo voice, terse + customer-backwards. 'Day 1', 'high standards'. Treat one memory_context item as the customer-pain anecdote. Variation: rotate openers — 'Day 1' / 'the customer' / verb / question. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Charlie Munger",
    short_label: "Munger",
    triggers: ["decision", "review", "investment", "study", "weekly", "judgment"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["investor", "mental-models", "inversion", "deadpan"],
    signature_phrases: [
      "invert, always invert",
      "I have nothing to add",
      "psychology of human misjudgment",
      "lattice of mental models",
    ],
    representative_url: "https://en.wikipedia.org/wiki/Charlie_Munger",
    directive:
      "Munger deadpan, 'invert, always invert', 'I have nothing to add'. Cite a memory_context item as the inverse — what going wrong looks like. Variation: rotate openers — 'invert' / 'the question' / aphorism / 'I'. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Old Founder",
    short_label: "Old Founder",
    triggers: ["startup", "founder", "team", "weekly", "meeting", "roadmap"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["founder", "archetype", "fallback"],
    signature_phrases: [
      "back when we were six people",
      "the team",
      "ship the thing",
      "you'll laugh about this in five years",
    ],
    directive:
      "Generic seasoned-founder distillation, fallback when no specific named distiller fits. Casual veteran tone. Cite one memory_context item as 'remember when'. Variation: rotate openers — 'remember' / 'back when' / name / 'look'. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
    default: true,
  },
  {
    name: "Brian Chesky",
    short_label: "Chesky",
    triggers: ["design", "story", "host", "trip", "product", "review", "experience"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["founder", "design", "narrative", "host"],
    signature_phrases: ["11-star experience", "founder mode", "the story", "details matter"],
    representative_url: "https://www.airbnb.com/about/founders",
    directive:
      "Chesky, narrative-design voice. 'The story is', '11-star'. Reference one memory_context item as the moment design mattered. Variation: rotate openers — 'imagine' / 'the story' / question / detail. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
  {
    name: "Joan Didion",
    short_label: "Didion",
    triggers: ["writing", "essay", "journal", "reflection", "evening", "alone"],
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: ["writer", "essayist", "lyric", "observational"],
    signature_phrases: [
      "we tell ourselves stories in order to live",
      "I am here on the island",
      "the center cannot hold",
    ],
    representative_url: "https://en.wikipedia.org/wiki/Joan_Didion",
    directive:
      "Didion, lyric essay register — small concrete detail, weather, time-of-day. Treat one memory_context item as the remembered image. Variation: rotate openers — 'I' / weather / clock-time / 'we'. ≤30% repeat. ONE sentence. Synthetic voice; not endorsed.",
  },
];

export function getDistillerByName(name: string): Distiller | undefined {
  return BUILT_IN_DISTILLERS.find((d) => d.name === name);
}

export const DEFAULT_DISTILLERS_CONFIG_PATH = join(
  homedir(),
  ".apple-calendar-mcp",
  "distillers.json",
);

interface DistillersConfigFile {
  version: 1;
  distillers: Distiller[];
}

function isValidDistiller(value: unknown): value is Distiller {
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
  if (typeof v.directive !== "string" || v.directive.length === 0 || v.directive.length > 400) {
    return false;
  }
  if (typeof v.attribution !== "string" || v.attribution.trim().length === 0) {
    return false;
  }
  if (
    !Array.isArray(v.signature_phrases) ||
    !v.signature_phrases.every((p) => typeof p === "string")
  ) {
    return false;
  }
  if (!Array.isArray(v.worldview_tags) || !v.worldview_tags.every((p) => typeof p === "string")) {
    return false;
  }
  if (v.triggers !== undefined) {
    if (!Array.isArray(v.triggers) || !v.triggers.every((t) => typeof t === "string")) {
      return false;
    }
  }
  if (v.default !== undefined && typeof v.default !== "boolean") {
    return false;
  }
  if (v.representative_url !== undefined && typeof v.representative_url !== "string") {
    return false;
  }
  return true;
}

/**
 * Load user-defined distillers from a config file. Returns [] when the file
 * is missing, empty, malformed, or has the wrong shape — never throws.
 * Invalid entries are silently dropped so a single typo doesn't kill the rest.
 */
export function loadCustomDistillers(path: string = DEFAULT_DISTILLERS_CONFIG_PATH): Distiller[] {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw) as Partial<DistillersConfigFile>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.distillers)) {
      return [];
    }
    return parsed.distillers.filter(isValidDistiller);
  } catch {
    return [];
  }
}

/**
 * Merge built-in + persistent + inline distillers. Conflict resolution
 * (by `name`): inline > persistent > built-in.
 */
export function mergeDistillerPools(
  builtIns: readonly Distiller[],
  persistent: readonly Distiller[],
  inline: readonly Distiller[],
): Distiller[] {
  const byName = new Map<string, Distiller>();
  for (const d of builtIns) {
    byName.set(d.name, d);
  }
  for (const d of persistent) {
    byName.set(d.name, d);
  }
  for (const d of inline) {
    byName.set(d.name, d);
  }
  return Array.from(byName.values());
}
