import { z } from "zod";
import {
  DEFAULT_MEMORY_PATH,
  loadMemory,
  mergeExternalFacts,
  saveMemory,
  type ExternalFact,
} from "../memory.js";

// Stage 2 follow-up: persist Claude's web-research findings into
// memory.json's external_facts map. 7-day TTL by default. Validation here
// is the only gate — Claude could pass anything, so we cap lengths and
// confidence range and reject empties.

const FactSchema = z.object({
  entity: z.string().min(1).max(256),
  kind: z.enum(["person", "topic", "location", "domain"]),
  summary: z.string().min(1).max(800),
  sources: z.array(z.string().max(2048)).min(0).max(10),
  confidence: z.number().min(0).max(1),
  cached_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "cached_at must be ISO 8601",
  }),
  ttl_days: z.number().min(0).max(365).default(7),
});

export const CacheResearchFactsInput = z.object({
  facts: z.array(FactSchema).min(1).max(30),
});

type CacheResearchFactsArgs = z.infer<typeof CacheResearchFactsInput>;

interface CacheResearchFactsResult {
  saved: number;
  skipped: number;
  reason_skipped?: string[];
}

export async function cacheResearchFacts(
  args: CacheResearchFactsArgs,
  memoryPath: string = DEFAULT_MEMORY_PATH,
): Promise<CacheResearchFactsResult> {
  const reasons: string[] = [];
  const valid: ExternalFact[] = [];
  for (const f of args.facts) {
    if (!f.summary.trim()) {
      reasons.push(`empty summary for ${f.entity}`);
      continue;
    }
    valid.push(f);
  }
  const memory = loadMemory(memoryPath);
  const merged = mergeExternalFacts(memory, valid);
  saveMemory(merged, memoryPath);
  const result: CacheResearchFactsResult = {
    saved: valid.length,
    skipped: args.facts.length - valid.length,
  };
  if (reasons.length > 0) {
    result.reason_skipped = reasons;
  }
  return result;
}
