import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Persistent calendar memory store. Used by the character-reminder tooling so
// each per-event commentary can reference a real prior event rather than
// inventing one. Path lives outside the repo and outside Calendar.app's
// own storage so reverts and reseeds never touch user data we don't own.
export const DEFAULT_MEMORY_DIR = join(homedir(), ".apple-calendar-mcp");
export const DEFAULT_MEMORY_PATH = join(DEFAULT_MEMORY_DIR, "memory.json");

export interface MemoryEvent {
  uid: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  duration_hours: number;
  calendar: string;
  notes?: string;
  attended?: boolean;
  observations?: string[];
}

export interface PersonRecord {
  name: string;
  role?: string;
  relationship?: string;
  email?: string;
  first_seen: string; // ISO
  last_seen: string; // ISO
  appearances: string[]; // event UIDs
  external_summary?: string;
  notes?: string;
}

export interface TopicRecord {
  name: string;
  kind?: "course" | "event_type" | "location" | "domain" | "club" | "other";
  first_seen: string;
  last_seen: string;
  appearance_count: number;
  external_summary?: string;
  notes?: string;
  related_people?: string[];
}

export interface UserNote {
  text: string;
  source_input?: string;
  ts: string; // ISO
}

export interface ExternalFact {
  entity: string;
  kind: "person" | "topic" | "location" | "domain";
  summary: string;
  sources: string[];
  confidence: number; // 0-1
  cached_at: string; // ISO
  ttl_days: number;
}

// MemoryFile schema v2. v1 files (events-only) load gracefully — missing
// top-level maps default to empty. `version` is bumped to 2 on save.
// MemoryFile schema v2. The map fields are typed as optional so legacy
// literals (and v1 loads that pre-date the maps) stay assignable without
// explicit `{}` defaults — every helper below treats `undefined` as empty.
export interface MemoryFile {
  version: 1 | 2;
  last_updated: string; // ISO
  events: MemoryEvent[];
  people?: Record<string, PersonRecord>;
  topics?: Record<string, TopicRecord>;
  user_notes?: UserNote[];
  external_facts?: Record<string, ExternalFact>;
}

export function emptyMemory(): MemoryFile {
  return {
    version: 2,
    last_updated: new Date(0).toISOString(),
    events: [],
    people: {},
    topics: {},
    user_notes: [],
    external_facts: {},
  };
}

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // chmod is best-effort: some filesystems (FAT, network mounts) ignore it,
  // and that's fine — we don't want a perm-set failure to block memory writes.
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function loadMemory(path: string = DEFAULT_MEMORY_PATH): MemoryFile {
  if (!existsSync(path)) {
    return emptyMemory();
  }
  try {
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) {
      return emptyMemory();
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !parsed ||
      !Array.isArray(parsed.events) ||
      typeof parsed.last_updated !== "string" ||
      (parsed.version !== 1 && parsed.version !== 2)
    ) {
      return emptyMemory();
    }
    return {
      version: 2,
      last_updated: parsed.last_updated,
      events: parsed.events as MemoryEvent[],
      people: isRecord(parsed.people) ? (parsed.people as Record<string, PersonRecord>) : {},
      topics: isRecord(parsed.topics) ? (parsed.topics as Record<string, TopicRecord>) : {},
      user_notes: Array.isArray(parsed.user_notes) ? (parsed.user_notes as UserNote[]) : [],
      external_facts: isRecord(parsed.external_facts)
        ? (parsed.external_facts as Record<string, ExternalFact>)
        : {},
    };
  } catch {
    // Corrupt or unreadable memory file: treat as empty rather than crash. The
    // caller will rewrite it on the next save with a fresh atomic write.
    return emptyMemory();
  }
}

export function saveMemory(memory: MemoryFile, path: string = DEFAULT_MEMORY_PATH): void {
  ensureDir(path);
  const payload = JSON.stringify({ ...memory, version: 2 }, null, 2);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* ignore */
  }
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

export function mergeEvents(memory: MemoryFile, newEvents: MemoryEvent[]): MemoryFile {
  const byUid = new Map<string, MemoryEvent>();
  for (const e of memory.events) {
    byUid.set(e.uid, e);
  }
  // Later writes win on UID collision. We preserve `observations` by merging
  // the union of arrays — observations are typically annotations the caller
  // does not want clobbered by a fresh seed.
  for (const incoming of newEvents) {
    const prev = byUid.get(incoming.uid);
    if (!prev) {
      byUid.set(incoming.uid, incoming);
      continue;
    }
    const observations =
      prev.observations || incoming.observations
        ? Array.from(new Set([...(prev.observations ?? []), ...(incoming.observations ?? [])]))
        : undefined;
    const merged: MemoryEvent = { ...prev, ...incoming };
    if (observations && observations.length > 0) {
      merged.observations = observations;
    }
    byUid.set(incoming.uid, merged);
  }
  return {
    ...memory,
    version: 2,
    last_updated: new Date().toISOString(),
    events: Array.from(byUid.values()),
  };
}

function keyName(s: string): string {
  return s.trim().toLowerCase();
}

export function mergePeople(memory: MemoryFile, people: PersonRecord[]): MemoryFile {
  const out: Record<string, PersonRecord> = { ...memory.people };
  for (const p of people) {
    if (!p.name || !p.name.trim()) {
      continue;
    }
    const key = keyName(p.name);
    const prev = out[key];
    if (!prev) {
      out[key] = {
        ...p,
        appearances: Array.from(new Set(p.appearances ?? [])),
      };
      continue;
    }
    const appearances = Array.from(
      new Set([...(prev.appearances ?? []), ...(p.appearances ?? [])]),
    );
    const first_seen =
      Date.parse(prev.first_seen) <= Date.parse(p.first_seen) ? prev.first_seen : p.first_seen;
    const last_seen =
      Date.parse(prev.last_seen) >= Date.parse(p.last_seen) ? prev.last_seen : p.last_seen;
    out[key] = {
      ...prev,
      ...p,
      first_seen,
      last_seen,
      appearances,
    };
  }
  return { ...memory, people: out, version: 2, last_updated: new Date().toISOString() };
}

export function mergeTopics(memory: MemoryFile, topics: TopicRecord[]): MemoryFile {
  const out: Record<string, TopicRecord> = { ...memory.topics };
  for (const t of topics) {
    if (!t.name || !t.name.trim()) {
      continue;
    }
    const key = keyName(t.name);
    const prev = out[key];
    if (!prev) {
      out[key] = { ...t, appearance_count: t.appearance_count ?? 1 };
      continue;
    }
    const first_seen =
      Date.parse(prev.first_seen) <= Date.parse(t.first_seen) ? prev.first_seen : t.first_seen;
    const last_seen =
      Date.parse(prev.last_seen) >= Date.parse(t.last_seen) ? prev.last_seen : t.last_seen;
    out[key] = {
      ...prev,
      ...t,
      first_seen,
      last_seen,
      appearance_count: (prev.appearance_count ?? 0) + (t.appearance_count ?? 1),
      related_people: Array.from(
        new Set([...(prev.related_people ?? []), ...(t.related_people ?? [])]),
      ),
    };
  }
  return { ...memory, topics: out, version: 2, last_updated: new Date().toISOString() };
}

export function mergeUserNotes(memory: MemoryFile, notes: UserNote[]): MemoryFile {
  const filtered = notes.filter((n) => n.text && n.text.trim().length > 0);
  return {
    ...memory,
    user_notes: [...(memory.user_notes ?? []), ...filtered],
    version: 2,
    last_updated: new Date().toISOString(),
  };
}

export function mergeExternalFacts(memory: MemoryFile, facts: ExternalFact[]): MemoryFile {
  const out: Record<string, ExternalFact> = { ...memory.external_facts };
  for (const f of facts) {
    if (!f.entity || !f.entity.trim()) {
      continue;
    }
    const key = keyName(f.entity);
    const prev = out[key];
    if (!prev) {
      out[key] = f;
      continue;
    }
    const newer = Date.parse(f.cached_at) > Date.parse(prev.cached_at);
    const moreConfident = f.confidence > prev.confidence;
    if (newer || moreConfident) {
      out[key] = f;
    }
  }
  return { ...memory, external_facts: out, version: 2, last_updated: new Date().toISOString() };
}

export function isFactStale(fact: ExternalFact, now: Date = new Date()): boolean {
  const cached = Date.parse(fact.cached_at);
  if (!Number.isFinite(cached)) {
    return true;
  }
  const ttlMs = (fact.ttl_days ?? 7) * 24 * 60 * 60 * 1000;
  return cached + ttlMs < now.getTime();
}

function fold(s: string): string {
  return s.toLowerCase();
}

export function queryByPerson(memory: MemoryFile, personName: string): MemoryEvent[] {
  const needle = fold(personName);
  if (!needle) {
    return [];
  }
  return memory.events.filter(
    (e) => fold(e.title).includes(needle) || (e.notes ? fold(e.notes).includes(needle) : false),
  );
}

export function queryByTopic(memory: MemoryFile, keyword: string): MemoryEvent[] {
  const needle = fold(keyword);
  if (!needle) {
    return [];
  }
  return memory.events.filter((e) => fold(e.title).includes(needle));
}

export function queryByDateRange(memory: MemoryFile, start: string, end: string): MemoryEvent[] {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    return [];
  }
  return memory.events.filter((evt) => {
    const t = Date.parse(evt.start);
    return Number.isFinite(t) && t >= s && t <= e;
  });
}

export function queryByCalendar(memory: MemoryFile, calendarName: string): MemoryEvent[] {
  const needle = fold(calendarName);
  return memory.events.filter((e) => fold(e.calendar) === needle);
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "for",
  "and",
  "or",
  "with",
  "at",
  "on",
  "by",
  "is",
  "it",
  "this",
  "that",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface CurrentEventLike {
  title: string;
  calendar?: string;
  start?: string;
  notes?: string;
}

export function recentSimilarEvents(
  memory: MemoryFile,
  current: CurrentEventLike,
  limit = 5,
): MemoryEvent[] {
  const needleTokens = new Set(tokenize(current.title));
  if (needleTokens.size === 0) {
    return [];
  }
  type Scored = { evt: MemoryEvent; score: number; ts: number };
  const scored: Scored[] = [];
  const currentMs = current.start ? Date.parse(current.start) : Number.NaN;
  for (const evt of memory.events) {
    // Don't return the current event itself if memory happens to contain it.
    if (
      Number.isFinite(currentMs) &&
      Date.parse(evt.start) === currentMs &&
      evt.title === current.title
    ) {
      continue;
    }
    const evtTokens = new Set(tokenize(evt.title));
    if (evtTokens.size === 0) {
      continue;
    }
    let overlap = 0;
    for (const t of evtTokens) {
      if (needleTokens.has(t)) {
        overlap += 1;
      }
    }
    if (overlap === 0) {
      continue;
    }
    let score = overlap / Math.max(needleTokens.size, evtTokens.size);
    if (current.calendar && fold(current.calendar) === fold(evt.calendar)) {
      score += 0.25;
    }
    scored.push({ evt, score, ts: Date.parse(evt.start) || 0 });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.ts - a.ts;
  });
  return scored.slice(0, Math.max(limit, 0)).map((s) => s.evt);
}

interface RelevantContext {
  memory_context_items: MemoryEvent[];
  people_context: PersonRecord[];
  topic_context: TopicRecord[];
  external_facts: ExternalFact[];
  user_notes_relevant: UserNote[];
}

interface RelevantContextOptions {
  top_n_memory?: number;
  top_n_people?: number;
  top_n_topics?: number;
  top_n_user_notes?: number;
  include_user_notes?: boolean;
}

export function getRelevantContextForEvent(
  memory: MemoryFile,
  event: CurrentEventLike,
  options: RelevantContextOptions = {},
): RelevantContext {
  const {
    top_n_memory = 3,
    top_n_people = 5,
    top_n_topics = 3,
    top_n_user_notes = 5,
    include_user_notes = true,
  } = options;

  const memory_context_items = recentSimilarEvents(memory, event, top_n_memory);

  const haystack = `${event.title} ${event.notes ?? ""}`.toLowerCase();
  const calendarLc = (event.calendar ?? "").toLowerCase();

  // People: substring of name in title/notes; or appearance in same calendar
  type ScoredPerson = { rec: PersonRecord; score: number };
  const personScores: ScoredPerson[] = [];
  for (const p of Object.values(memory.people ?? {})) {
    let score = 0;
    if (haystack.includes(p.name.toLowerCase())) {
      score += 3;
    }
    // Calendar overlap signal: if any of the person's appearances matches an
    // event in same calendar, count as soft signal.
    const appearancesInSameCal = p.appearances.filter((uid) => {
      const evt = memory.events.find((e) => e.uid === uid);
      return evt && evt.calendar.toLowerCase() === calendarLc;
    });
    if (appearancesInSameCal.length > 0) {
      score += Math.min(appearancesInSameCal.length, 3) * 0.5;
    }
    if (score > 0) {
      personScores.push({ rec: p, score });
    }
  }
  personScores.sort((a, b) => b.score - a.score);
  const people_context = personScores.slice(0, top_n_people).map((s) => s.rec);

  // Topics: substring of topic name in title/calendar
  type ScoredTopic = { rec: TopicRecord; score: number };
  const topicScores: ScoredTopic[] = [];
  for (const t of Object.values(memory.topics ?? {})) {
    let score = 0;
    const nameLc = t.name.toLowerCase();
    if (haystack.includes(nameLc)) {
      score += 3;
    }
    if (calendarLc && calendarLc.includes(nameLc)) {
      score += 2;
    }
    if (score > 0) {
      topicScores.push({ rec: t, score });
    }
  }
  topicScores.sort((a, b) => b.score - a.score);
  const topic_context = topicScores.slice(0, top_n_topics).map((s) => s.rec);

  // External facts: facts about people/topics surfaced above (non-stale)
  const factKeys = new Set<string>();
  for (const p of people_context) {
    factKeys.add(keyName(p.name));
  }
  for (const t of topic_context) {
    factKeys.add(keyName(t.name));
  }
  const external_facts: ExternalFact[] = [];
  const factsMap = memory.external_facts ?? {};
  for (const key of factKeys) {
    const fact = factsMap[key];
    if (fact && !isFactStale(fact)) {
      external_facts.push(fact);
    }
  }

  // User notes: substring or token overlap with title
  let user_notes_relevant: UserNote[] = [];
  if (include_user_notes) {
    const titleTokens = new Set(tokenize(event.title));
    type ScoredNote = { rec: UserNote; score: number };
    const noteScores: ScoredNote[] = [];
    for (const n of memory.user_notes ?? []) {
      const noteLc = n.text.toLowerCase();
      let score = 0;
      if (event.title && noteLc.includes(event.title.toLowerCase())) {
        score += 3;
      }
      const noteTokens = new Set(tokenize(n.text));
      let overlap = 0;
      for (const t of noteTokens) {
        if (titleTokens.has(t)) {
          overlap += 1;
        }
      }
      score += overlap;
      if (score > 0) {
        noteScores.push({ rec: n, score });
      }
    }
    noteScores.sort((a, b) => b.score - a.score);
    user_notes_relevant = noteScores.slice(0, top_n_user_notes).map((s) => s.rec);
  }

  return {
    memory_context_items,
    people_context,
    topic_context,
    external_facts,
    user_notes_relevant,
  };
}
