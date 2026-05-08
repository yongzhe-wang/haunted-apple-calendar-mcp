import { SYNTHETIC_VOICE_ATTRIBUTION } from "../distillers.js";
import type { DistillVoiceFromTextArgs, DistillVoiceFromTextResult } from "../types.js";

/**
 * The MCP server has no LLM. This tool is a thin orchestrator: it returns
 * the user-supplied corpus alongside placeholder Distiller scaffolding and
 * a meta-instruction telling the calling LLM to fill in `directive` and
 * `signature_phrases` based on its own analysis of the corpus.
 *
 * The synthetic-voice attribution is fixed so every distillation — built-in,
 * persistent, or LLM-generated — carries the same disclaimer.
 */
const PLACEHOLDER_DIRECTIVE =
  "PLACEHOLDER — analyze corpus_text and write a ≤400-char directive: voice signature, syntax, vocabulary, sentence shapes, signature phrases, worldview. Include a Variation clause (rotate openers; ≤30% same) and an instruction to reference one memory_context item. End with: Synthetic voice; not endorsed.";

const GENERATION_INSTRUCTIONS =
  "Read corpus_text. (1) Replace draft_distiller.directive with a ≤400-char prompt that captures the voice — its syntax, pet vocabulary, sentence shapes, worldview, and how it would comment on a single calendar event. The directive MUST include a 'Variation:' clause (rotate openers, ≤30% the same), MUST instruct the speaker to reference at least one item from memory_context, and MUST end with 'Synthetic voice; not endorsed.' (2) Replace signature_phrases with 3-6 verbatim phrases or short word-patterns the voice tends to use. (3) Keep attribution exactly as supplied — it is the synthetic-voice disclaimer. (4) If the user confirms, persist the result by writing to ~/.apple-calendar-mcp/distillers.json (mode 0600, dir 0700) under {version:1, distillers:[...]}.";

export function buildDistillVoiceResult(
  args: DistillVoiceFromTextArgs,
): DistillVoiceFromTextResult {
  const draft: DistillVoiceFromTextResult["draft_distiller"] = {
    name: args.name,
    short_label: args.short_label,
    attribution: SYNTHETIC_VOICE_ATTRIBUTION,
    worldview_tags: [...args.worldview_tags],
    triggers: [...args.triggers],
    directive: PLACEHOLDER_DIRECTIVE,
    signature_phrases: [],
  };
  if (args.representative_url !== undefined) {
    draft.representative_url = args.representative_url;
  }
  return {
    draft_distiller: draft,
    corpus_text: args.corpus_text,
    generation_instructions: GENERATION_INSTRUCTIONS,
  };
}

export async function distillVoiceFromText(
  args: DistillVoiceFromTextArgs,
): Promise<DistillVoiceFromTextResult> {
  return buildDistillVoiceResult(args);
}
