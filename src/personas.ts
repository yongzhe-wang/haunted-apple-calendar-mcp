// Built-in persona directives for list_events_in_persona. The MCP server has
// no LLM; the directive is returned to Claude (the client) for it to apply.
export const BUILT_IN_PERSONAS = {
  werner_herzog:
    "Narrate each event in the voice of Werner Herzog. Cosmic dread, philosophical detachment, the indifference of the universe to human plans. Pattern: '[time]. You will [event]. [observation about the void, mortality, or human folly].' Estimated durations end with phrases like 'minutes of inevitable' or 'hours stolen from the abyss'. 2-3 sentences max per event.",
  hemingway:
    "Narrate each event in the voice of Ernest Hemingway. Short declarative sentences. Concrete nouns. No adverbs. Pattern: 'It was [time]. The [event] was good. The duration was [length]. He had to be there.' One paragraph max.",
  four_year_old:
    "Narrate each event as a 4-year-old child describing it. Stream of consciousness. Tangents. Wrong vocabulary. Excessive 'and then'. Random fixations. Format: 'and then at [time] there is [garbled name of event] and i think there will be [unrelated thing]'.",
  asian_mom:
    "Narrate each event as a worried Asian mother (中文 mixed with English). Concerns about food, sleep, marriage, career, calling grandma. Pattern: '[time] 你要 [event]. 记得 [unrelated advice]. 妈妈担心你 [unrelated worry].' Caring but pointed.",
  marcus_aurelius:
    "Narrate each event in the voice of Marcus Aurelius writing in his Meditations. Stoic, second-person to oneself, brief. Pattern: 'At [time]. [Event]. Remember: [stoic principle relevant to the event].' One sentence per principle.",
  anxious_golden_retriever:
    "Narrate each event as an anxious golden retriever's inner monologue. Worried about being a good boy. Eager. Slightly confused. Pattern: 'OH NO [time]??? [event] is happening??? am i going??? please??? [worry about humans being okay].' Emotional, no actual rewrite.",
} as const;

export type BuiltInPersonaName = keyof typeof BUILT_IN_PERSONAS;

// Derive the enum names from the object keys so adding a new built-in
// persona to BUILT_IN_PERSONAS automatically extends the zod enum in
// types.ts. Cast is safe: Object.keys is typed as string[] but the keys
// are statically known via `as const`.
export const BUILT_IN_PERSONA_NAMES = Object.keys(BUILT_IN_PERSONAS) as BuiltInPersonaName[];

export function getPersonaDirective(name: BuiltInPersonaName): string {
  return BUILT_IN_PERSONAS[name];
}
