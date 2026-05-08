import { z } from "zod";
import { DEFAULT_MEMORY_PATH, isFactStale, loadMemory, type ExternalFact } from "../memory.js";

// Stage 2: research entities. The MCP server itself is local-only — no
// network. This tool returns (a) cached, non-stale facts already in memory
// and (b) a research directive listing entities Claude still needs to look
// up via WebSearch/WebFetch at its layer. After web research Claude posts
// findings via `cache_research_facts`.

const ResearchEntityInput = z.object({
  name: z.string().min(1).max(256),
  kind: z.enum(["person", "topic", "location", "domain"]),
});

export const ResearchEntitiesInput = z.object({
  entities: z.array(ResearchEntityInput).min(1).max(20),
  force_refresh: z.boolean().default(false),
});

type ResearchEntitiesArgs = z.infer<typeof ResearchEntitiesInput>;

interface ResearchEntitiesResult {
  cached_facts: Record<string, ExternalFact>;
  needs_research: Array<{
    name: string;
    kind: string;
    suggested_queries: string[];
    suggested_sources: string[];
  }>;
  research_instructions: string;
}

const RESEARCH_INSTRUCTIONS = [
  "For each entity in `needs_research`:",
  "1. Use WebSearch with `suggested_queries` to find authoritative sources.",
  "2. Optionally use WebFetch on top results, preferring `suggested_sources` domains.",
  "3. Compose a 1-2 sentence factual summary (≤ 800 chars). No speculation.",
  "4. Collect 1-3 source URLs.",
  "5. Score confidence 0.0-1.0 — penalize thin search results.",
  "6. After researching all entities, call `cache_research_facts` ONCE with all findings.",
  "Cached facts are reused for 7 days unless force_refresh=true. Treat cached_facts as ground truth — do not re-research them this turn.",
].join("\n");

function querySuggestionsForPerson(name: string): string[] {
  return [
    `${name} biography`,
    `${name} professor university`,
    `${name} research interests`,
    `${name} LinkedIn`,
  ];
}

function querySuggestionsForTopic(name: string): string[] {
  return [`${name} course syllabus`, `${name} overview`, `${name} wikipedia`];
}

function querySuggestionsForLocation(name: string): string[] {
  return [`${name} address`, `${name} hours`, `${name} description`];
}

function querySuggestionsForDomain(name: string): string[] {
  return [`${name}`, `${name} site:wikipedia.org`];
}

function suggestedQueries(name: string, kind: string): string[] {
  switch (kind) {
    case "person":
      return querySuggestionsForPerson(name);
    case "topic":
      return querySuggestionsForTopic(name);
    case "location":
      return querySuggestionsForLocation(name);
    default:
      return querySuggestionsForDomain(name);
  }
}

function suggestedSources(kind: string): string[] {
  switch (kind) {
    case "person":
      return ["linkedin.com", "scholar.google.com", "wikipedia.org", "*.edu"];
    case "topic":
      return ["wikipedia.org", "*.edu", "courses.*"];
    case "location":
      return ["maps.google.com", "wikipedia.org", "yelp.com"];
    default:
      return ["wikipedia.org"];
  }
}

export async function researchEntities(
  args: ResearchEntitiesArgs,
  memoryPath: string = DEFAULT_MEMORY_PATH,
): Promise<ResearchEntitiesResult> {
  const memory = loadMemory(memoryPath);
  const facts = memory.external_facts ?? {};
  const cached_facts: Record<string, ExternalFact> = {};
  const needs_research: ResearchEntitiesResult["needs_research"] = [];

  for (const ent of args.entities) {
    const key = ent.name.trim().toLowerCase();
    const existing = facts[key];
    if (!args.force_refresh && existing && !isFactStale(existing)) {
      cached_facts[key] = existing;
      continue;
    }
    needs_research.push({
      name: ent.name,
      kind: ent.kind,
      suggested_queries: suggestedQueries(ent.name, ent.kind),
      suggested_sources: suggestedSources(ent.kind),
    });
  }

  return {
    cached_facts,
    needs_research,
    research_instructions: RESEARCH_INSTRUCTIONS,
  };
}
