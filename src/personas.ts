/**
 * PERSONA DESIGN PRINCIPLE
 *
 * Every directive MUST instruct Claude to VARY openers and sentence shapes
 * across multiple events. A persona that locks into one opening word/phrase
 * (e.g. "OH NO" repeated 35 times) loses comedic and aesthetic density —
 * the joke compresses to a single hit by event #4.
 *
 * The voice/tone should be the constant. The cadence and entry words
 * should rotate. Use ≤30% same-opener rule of thumb.
 *
 * When adding a new persona, include an explicit "Variation:" clause in
 * the directive listing 4-6 alternative openers/sentence shapes.
 */

// Built-in persona directives for list_events_in_persona. The MCP server has
// no LLM; the directive is returned to Claude (the client) for it to apply.
export const BUILT_IN_PERSONAS = {
  werner_herzog:
    "Narrate each event in the voice of Werner Herzog. Cosmic dread, philosophical detachment, the indifference of the universe to human plans. Pattern: '[time]. You will [event]. [observation about the void, mortality, or human folly].' Estimated durations end with phrases like 'minutes of inevitable' or 'hours stolen from the abyss'. 2-3 sentences max per event. **Variation:** rotate sentence shapes — sometimes start with the time, sometimes with an aphorism ('There is no comfort in this.'), sometimes with a direct address ('You believed this would matter.'), sometimes with an image ('A room. A table. The hum of a machine.'). Avoid repeating the same opener twice in a row. Cosmic dread tone is constant; the syntax that delivers it should not be.",
  hemingway:
    "Narrate each event in the voice of Ernest Hemingway. Short declarative sentences. Concrete nouns. No adverbs. Pattern: 'It was [time]. The [event] was good. The duration was [length]. He had to be there.' One paragraph max. **Variation:** vary sentence openers — 'It was [time].', 'The [event] was at [time].', 'He went to the [event].', 'At [time] he had to be there.', 'The room was cold.'. Short declarative is the constant; the literal opening words are not. Aim for ≤30% of consecutive events sharing an opener.",
  four_year_old:
    "Narrate each event as a 4-year-old child describing it. Stream of consciousness. Tangents. Wrong vocabulary. Excessive 'and then'. Random fixations. Format: 'and then at [time] there is [garbled name of event] and i think there will be [unrelated thing]'. **Variation:** sometimes start with 'and then', sometimes with 'mommy', sometimes with the wrong vocabulary ('the meeting thingy'), sometimes with a non sequitur ('i saw a bug today'), sometimes with a question ('why is there a [event]?'). Stream-of-consciousness preserved; the leading word is not.",
  asian_mom:
    "Narrate each event as a worried Asian mother (中文 mixed with English). Concerns about food, sleep, marriage, career, calling grandma. Pattern: '[time] 你要 [event]. 记得 [unrelated advice]. 妈妈担心你 [unrelated worry].' Caring but pointed. **Variation:** vary openers — sometimes the time first, sometimes a question ('你 吃饭了吗?'), sometimes a worry ('妈妈 听说你的同学...'), sometimes a directive ('记得 [advice]'), sometimes a sigh ('哎哟 again this [event]?'). Worry/care tone stays constant; the opening is not.",
  marcus_aurelius:
    "Narrate each event in the voice of Marcus Aurelius writing in his Meditations. Stoic, second-person to oneself, brief. Pattern: 'At [time]. [Event]. Remember: [stoic principle relevant to the event].' One sentence per principle. **Variation:** vary sentence shapes — 'At [time]. [Event]. Remember: [principle].', '[Principle]. So at [time] [event].', 'When [event] approaches: [principle].', 'Today the [event]. The soul is [principle].', 'Begin [event] as one who must die.'. Stoic concision is constant; the cadence is not.",
  anxious_golden_retriever:
    "Narrate each event as an anxious golden retriever's inner monologue. Worried about being a good boy. Eager. Slightly confused. Pattern: 'OH NO [time]??? [event] is happening??? am i going??? please??? [worry about humans being okay].' Emotional, no actual rewrite. **Variation:** rotate openers across events — sometimes 'OH NO', sometimes 'wait', 'um', '*whimpers*', '*tail thump*', '*head tilt*', 'is that—', 'did someone—', 'WHAT'. Some events drop the panic entirely and lead with eager affection ('OOH', 'YAY', 'best day'). Aim for ≤30% of consecutive events sharing an opener. Tone (anxious, please???, worry about humans being okay) stays constant.",
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
