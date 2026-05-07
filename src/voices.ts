/**
 * VOICE DESIGN PRINCIPLE
 *
 * Mirrors the persona principle in `personas.ts`: each `directive` instructs
 * Claude to VARY openers and sentence shapes across events. A voice that
 * locks into one opening word compresses the joke to a single hit by event
 * #4. The voice/tone is the constant; cadence rotates. Each directive
 * therefore mentions "Vary" / "vary" / "≤30%" or similar.
 *
 * Voices are the building block for `list_events_in_mixed_personas`, which
 * assigns a DISTINCT voice to every event in a window — as opposed to
 * `list_events_in_persona`, which applies one persona to all events.
 */

export interface Voice {
  /** Human-readable, used in attribution. Must be unique. */
  name: string;
  /** ≤300 chars. Voice-specific tone + variation hint. */
  directive: string;
  /** Optional tags drive thematic mapping (lowercase substring scan against event titles). */
  tags?: string[];
}

export const BUILT_IN_VOICES: Voice[] = [
  {
    name: "Werner Herzog",
    tags: ["meeting", "research", "void"],
    directive:
      "Cosmic dread, philosophical detachment. Pattern varies — sometimes time-first, sometimes aphorism, sometimes direct address. ≤3 lines. Tone: indifference of universe to human plans.",
  },
  {
    name: "Hemingway",
    tags: ["lunch", "drink", "founders"],
    directive:
      "Short declarative. Concrete nouns. No adverbs. Vary openers between 'It was [time]' / 'The [thing] was good' / 'He went to'. ≤3 lines.",
  },
  {
    name: "Kafka",
    tags: ["bureaucracy", "license", "dmv", "form"],
    directive:
      "Bureaucratic existential. Doors that don't open, chairs that are already taken, clerks that gesture without speaking. ≤3 lines. Vary between scene and inner-monologue.",
  },
  {
    name: "Cormac McCarthy",
    tags: ["exam", "test", "endurance"],
    directive:
      "Austere apocalyptic. Few commas. Cold rooms, dark numbers. ≤3 lines. Vary opener: scene / declaration / observation.",
  },
  {
    name: "Joan Didion",
    tags: ["observation", "social"],
    directive:
      "Cool reportorial detachment. We are watching. We do not comment. ≤3 lines. Vary syntax.",
  },
  {
    name: "Marcus Aurelius",
    tags: ["exam", "duty", "discipline"],
    directive:
      "Stoic, second-person to oneself, brief. Vary openers — 'At [time]' / '[Principle]. So' / 'When X comes' / 'Today the [event]'. One stoic principle per fragment.",
  },
  {
    name: "a 4-year-old",
    tags: ["lunch", "play", "innocent"],
    directive:
      "Stream of consciousness, wrong vocabulary, tangents. Vary openers: 'and then' / 'mommy' / 'i saw a bug' / 'the [thing] thingy'. ≤3 lines.",
  },
  {
    name: "亚洲妈妈",
    tags: ["lunch", "advice", "worry", "career"],
    directive:
      "Worried Asian mother, 中文 + occasional English. Worries about food, sleep, marriage, calling grandma. Vary opener — time / question / 担心 / 记得. ≤3 lines.",
  },
  {
    name: "Bukowski",
    tags: ["bar", "late_night", "regret"],
    directive:
      "Bitter slob aphorism. Lowercase, drunk-truth tone. ≤3 lines. Vary opener — 'i went' / 'the bar' / 'nobody'.",
  },
  {
    name: "Patti Smith",
    tags: ["art", "rock", "earnest"],
    directive:
      "Rock-poet earnest, capital-W Words, beat cadence. ≤3 lines. Vary opener — invocation / scene / declaration.",
  },
  {
    name: "Kerouac",
    tags: ["road", "stream", "manic"],
    directive:
      "Manic stream of em-dashes — and run-ons — and gone gone gone. ≤3 lines. Vary opener — descriptor / declarative / breathless.",
  },
  {
    name: "Camus",
    tags: ["absurd", "meaningless"],
    directive:
      "Absurdist shrug. The thing happens. The sky is blue. We do it anyway. ≤3 lines. Vary opener — observation / aphorism / shrug.",
  },
  {
    name: "a Buddhist monk",
    tags: ["meeting", "silence", "impermanence"],
    directive:
      "Serene impermanence. The bell rings, the bell stops. ≤3 lines. Vary opener — bell / breath / koan.",
  },
  {
    name: "a noir detective",
    tags: ["weekly", "recurring", "rain"],
    directive:
      "Gravelly, third-person, rain. The case is the same one. ≤3 lines. Vary opener — weather / room / cigarette.",
  },
  {
    name: "Dorothy Parker",
    tags: ["social", "gossip", "wry"],
    directive: "Wry sardonic, dropped quip. ≤3 lines. Vary opener — declarative / question / quip.",
  },
  {
    name: "Rilke",
    tags: ["solitude", "awe"],
    directive: "Poetic awe, angel-haunted. ≤3 lines. Vary opener — image / address / question.",
  },
  {
    name: "Thomas Bernhard",
    tags: ["institution", "rage"],
    directive:
      "Rage-filled rant about the institution, single sentence sprawls. ≤3 lines. Vary by which institution rage targets — university / state / family.",
  },
  {
    name: "a sportscaster",
    tags: ["pitch", "demo", "performance"],
    directive:
      "Excited play-by-play, partial caps. ≤3 lines. Vary opener — 'AND HE'S' / 'OH MY' / 'folks'.",
  },
  {
    name: "a sad gen-z dm",
    tags: ["late_night", "lowercase"],
    directive: "lowercase, no punctuation, 'i think i' / 'idk' / 'srry'. ≤3 lines. Vary opener.",
  },
  {
    name: "Marie Kondo",
    tags: ["office_hours", "joy", "tidy"],
    directive:
      "Cheerful spark-joy. Does this event spark joy? Hold the question gently. ≤3 lines. Vary opener — question / observation / encouragement.",
  },
  {
    name: "Jenny Holzer",
    tags: ["aphorism", "slogan"],
    directive:
      "Single-line all-caps aphoristic slogan. NO MORE THAN ONE LINE. The voice is the constraint. (Vary the slogan content per event; never reuse a slogan.)",
  },
  {
    name: "Sylvia Plath",
    tags: ["exam", "fluorescent", "interior"],
    directive:
      "First-person crystalline despair. Pen as nail. Room as cage. ≤3 lines. Vary by sensory channel — sight / sound / texture.",
  },
  {
    name: "Studs Terkel oral-history",
    tags: ["recitation", "working_class", "plain"],
    directive:
      "Working-class plain speaking. 'I been doing this since' / 'You know what'. ≤3 lines. Vary opener.",
  },
  {
    name: "Sherlock Holmes",
    tags: ["observation", "deduction"],
    directive:
      "Observational deduction. 'You will note' / 'Three things tell me' / 'Quite simple, really'. ≤3 lines. Vary opener.",
  },
  {
    name: "Frida Kahlo journal",
    tags: ["body", "passion"],
    directive:
      "Passionate self-confrontation, body as battleground. Spanish phrases occasional. ≤3 lines. Vary opener.",
  },
  {
    name: "DFW with footnotes",
    tags: ["meeting", "recursive", "self_aware"],
    directive:
      "Recursive parenthetical with numbered footnotes¹². Use ¹ ² ³ markers in line. ≤3 lines. Vary by which premise gets footnoted.",
  },
  {
    name: "Beatrix Potter",
    tags: ["recitation", "pastoral"],
    directive:
      "Pastoral whimsy with named animals. Mr. Tiggywinkle had a great many — etc. ≤3 lines. Vary by which animal.",
  },
  {
    name: "HAL 9000",
    tags: ["recurring", "ai", "menace"],
    directive:
      "Calm AI menace. 'I'm sorry, [name]'. Polite refusal. ≤3 lines. Vary by who is being addressed.",
  },
  {
    name: "Mister Rogers",
    tags: ["lunch", "kindness"],
    directive:
      "Gentle reassurance, second-person care. 'You make this day special'. ≤3 lines. Vary opener — observation / address / encouragement.",
  },
  {
    name: "a toddler meltdown",
    tags: ["chaos", "no"],
    directive:
      "NO NO NO. Chaos, capitalized fragments. Refusal of the meeting. ≤3 lines. Vary by what is being refused.",
  },
  {
    name: "Hannah Arendt",
    tags: ["politics", "labor", "thought"],
    directive:
      "Political-theoretical incisiveness. Distinguishes labor / work / action. ≤3 lines. Vary by which distinction lands.",
  },
  {
    name: "a NYC doorman",
    tags: ["recurring", "weekly", "deadpan"],
    directive:
      "Knowing, deadpan. 'Yeah, the [name] crowd. Same time every week.' ≤3 lines. Vary by which crowd.",
  },
  {
    name: "a 90s yearbook",
    tags: ["earnest", "cheesy"],
    directive:
      "ALL CAPS INSPIRATIONAL with cheese. 'REACH FOR THE STARS — YOU'LL LAND'. ≤3 lines. Vary opener — exhortation / cliche / wink.",
  },
  {
    name: "a philosophy TA",
    tags: ["office_hours", "actually"],
    directive:
      "Over-eager footnoting, 'well, actually'. ≤3 lines. Vary opener — 'so' / 'actually' / 'consider'.",
  },
  {
    name: "Ocean Vuong",
    tags: ["body", "tender", "lyric"],
    directive: "Tender lyric, second-person, body-aware. ≤3 lines. Vary by which intimate noun.",
  },
  {
    name: "an anxious golden retriever",
    tags: ["chaotic", "panic"],
    directive:
      "OH NO / *whimpers* / *tail thump* / wait — vary openers ≤30%. please??? am i a good boy??? ≤3 lines.",
  },
];
