import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveMemory, type ExternalFact, type MemoryFile } from "../src/memory.js";
import { ResearchEntitiesInput, researchEntities } from "../src/tools/research-entities.js";

let workdir = "";
let memoryPath = "";

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "yu-research-"));
  memoryPath = join(workdir, "memory.json");
});

afterEach(() => {
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
  }
});

describe("ResearchEntitiesInput schema", () => {
  it("requires a non-empty entities array", () => {
    expect(() => ResearchEntitiesInput.parse({ entities: [] })).toThrow();
  });

  it("rejects more than 20 entities", () => {
    const entities = Array.from({ length: 21 }, (_, i) => ({
      name: `n${i}`,
      kind: "person" as const,
    }));
    expect(() => ResearchEntitiesInput.parse({ entities })).toThrow();
  });

  it("rejects unknown kinds", () => {
    expect(() =>
      ResearchEntitiesInput.parse({
        entities: [{ name: "x", kind: "monster" }],
      }),
    ).toThrow();
  });

  it("force_refresh defaults to false", () => {
    const out = ResearchEntitiesInput.parse({
      entities: [{ name: "x", kind: "person" }],
    });
    expect(out.force_refresh).toBe(false);
  });
});

describe("researchEntities", () => {
  it("returns needs_research entries for unknown entities", async () => {
    const out = await researchEntities(
      { entities: [{ name: "Lingjie Liu", kind: "person" }], force_refresh: false },
      memoryPath,
    );
    expect(out.cached_facts).toEqual({});
    expect(out.needs_research.length).toBe(1);
    expect(out.needs_research[0]?.name).toBe("Lingjie Liu");
    expect(out.needs_research[0]?.suggested_queries.length).toBeGreaterThan(0);
    expect(out.research_instructions).toContain("WebSearch");
  });

  it("returns cached_facts for known non-stale entities", async () => {
    const fact: ExternalFact = {
      entity: "Lingjie Liu",
      kind: "person",
      summary: "Penn CIS prof, computer graphics.",
      sources: ["https://example.com"],
      confidence: 0.9,
      cached_at: new Date().toISOString(),
      ttl_days: 7,
    };
    const memory: MemoryFile = {
      version: 2,
      last_updated: new Date().toISOString(),
      events: [],
      external_facts: { "lingjie liu": fact },
    };
    saveMemory(memory, memoryPath);
    const out = await researchEntities(
      { entities: [{ name: "Lingjie Liu", kind: "person" }], force_refresh: false },
      memoryPath,
    );
    expect(out.cached_facts["lingjie liu"]).toBeDefined();
    expect(out.needs_research).toEqual([]);
  });

  it("force_refresh bypasses the cache", async () => {
    const fact: ExternalFact = {
      entity: "Lingjie Liu",
      kind: "person",
      summary: "summary",
      sources: [],
      confidence: 0.9,
      cached_at: new Date().toISOString(),
      ttl_days: 7,
    };
    const memory: MemoryFile = {
      version: 2,
      last_updated: new Date().toISOString(),
      events: [],
      external_facts: { "lingjie liu": fact },
    };
    saveMemory(memory, memoryPath);
    const out = await researchEntities(
      { entities: [{ name: "Lingjie Liu", kind: "person" }], force_refresh: true },
      memoryPath,
    );
    expect(out.needs_research.length).toBe(1);
  });

  it("treats stale facts as needing refresh", async () => {
    const stale: ExternalFact = {
      entity: "x",
      kind: "topic",
      summary: "summary",
      sources: [],
      confidence: 0.9,
      cached_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      ttl_days: 7,
    };
    const memory: MemoryFile = {
      version: 2,
      last_updated: new Date().toISOString(),
      events: [],
      external_facts: { x: stale },
    };
    saveMemory(memory, memoryPath);
    const out = await researchEntities(
      { entities: [{ name: "x", kind: "topic" }], force_refresh: false },
      memoryPath,
    );
    expect(out.needs_research.length).toBe(1);
  });
});
