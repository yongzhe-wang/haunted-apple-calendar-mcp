import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMemory } from "../src/memory.js";
import { CacheResearchFactsInput, cacheResearchFacts } from "../src/tools/cache-research-facts.js";

let workdir = "";
let memoryPath = "";

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "yu-cache-"));
  memoryPath = join(workdir, "memory.json");
});

afterEach(() => {
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
  }
});

const validFact = {
  entity: "Lingjie Liu",
  kind: "person" as const,
  summary: "Penn CIS prof, computer graphics.",
  sources: ["https://www.cis.upenn.edu/example"],
  confidence: 0.9,
  cached_at: "2026-05-08T00:00:00Z",
  ttl_days: 7,
};

describe("CacheResearchFactsInput schema", () => {
  it("rejects empty facts array", () => {
    expect(() => CacheResearchFactsInput.parse({ facts: [] })).toThrow();
  });

  it("rejects > 30 facts", () => {
    const facts = Array.from({ length: 31 }, () => ({ ...validFact }));
    expect(() => CacheResearchFactsInput.parse({ facts })).toThrow();
  });

  it("rejects confidence > 1", () => {
    expect(() =>
      CacheResearchFactsInput.parse({ facts: [{ ...validFact, confidence: 1.5 }] }),
    ).toThrow();
  });

  it("rejects summary > 800 chars", () => {
    expect(() =>
      CacheResearchFactsInput.parse({
        facts: [{ ...validFact, summary: "x".repeat(801) }],
      }),
    ).toThrow();
  });

  it("ttl_days defaults to 7", () => {
    const { ttl_days, ...rest } = validFact;
    void ttl_days;
    const out = CacheResearchFactsInput.parse({ facts: [rest] });
    expect(out.facts[0]?.ttl_days).toBe(7);
  });
});

describe("cacheResearchFacts", () => {
  it("persists facts into memory.external_facts (keyed lowercased)", async () => {
    const out = await cacheResearchFacts({ facts: [validFact] }, memoryPath);
    expect(out.saved).toBe(1);
    const memory = loadMemory(memoryPath);
    expect(memory.external_facts?.["lingjie liu"]?.summary).toContain("CIS");
  });

  it("preserves prior external_facts on subsequent saves", async () => {
    await cacheResearchFacts({ facts: [validFact] }, memoryPath);
    const second = {
      ...validFact,
      entity: "Penn",
      kind: "domain" as const,
      cached_at: "2026-05-09T00:00:00Z",
    };
    await cacheResearchFacts({ facts: [second] }, memoryPath);
    const memory = loadMemory(memoryPath);
    expect(memory.external_facts?.["lingjie liu"]).toBeDefined();
    expect(memory.external_facts?.penn).toBeDefined();
  });
});
