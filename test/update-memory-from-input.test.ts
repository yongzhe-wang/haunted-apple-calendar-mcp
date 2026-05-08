import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMemory } from "../src/memory.js";
import {
  UpdateMemoryFromInputInput,
  updateMemoryFromInput,
} from "../src/tools/update-memory-from-input.js";

let workdir = "";
let memoryPath = "";

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "yu-update-mem-"));
  memoryPath = join(workdir, "memory.json");
});

afterEach(() => {
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
  }
});

describe("UpdateMemoryFromInputInput schema", () => {
  it("requires source_label", () => {
    expect(() => UpdateMemoryFromInputInput.parse({})).toThrow();
  });

  it("accepts source_label only (all arrays optional)", () => {
    const out = UpdateMemoryFromInputInput.parse({ source_label: "Gmail screenshot" });
    expect(out.source_label).toBe("Gmail screenshot");
  });

  it("rejects > 30 events", () => {
    const events = Array.from({ length: 31 }, (_, i) => ({
      uid: `u${i}`,
      title: "t",
      start: "2026-04-01T00:00:00Z",
      end: "2026-04-01T01:00:00Z",
      duration_hours: 1,
      calendar: "C",
    }));
    expect(() => UpdateMemoryFromInputInput.parse({ events, source_label: "x" })).toThrow();
  });
});

describe("updateMemoryFromInput", () => {
  it("merges events, people, topics, and user_statements; reports memory_size", async () => {
    const out = await updateMemoryFromInput(
      {
        source_label: "test-input",
        events: [
          {
            uid: "u1",
            title: "CIS 4600 Lecture",
            start: "2026-05-12T10:00:00Z",
            end: "2026-05-12T11:30:00Z",
            duration_hours: 1.5,
            calendar: "School",
          },
        ],
        people: [
          {
            name: "Lingjie Liu",
            role: "CIS prof",
            first_seen: "2026-05-12T00:00:00Z",
            appearances: ["u1"],
          },
        ],
        topics: [
          {
            name: "CIS 4600",
            kind: "course",
            first_seen: "2026-05-12T00:00:00Z",
            appearance_count: 1,
          },
        ],
        user_statements: ["I prefer morning classes."],
      },
      memoryPath,
    );
    expect(out.memory_size.events).toBe(1);
    expect(out.memory_size.people).toBe(1);
    expect(out.memory_size.topics).toBe(1);
    expect(out.memory_size.user_notes).toBe(1);
    expect(out.new_entities.people).toContain("lingjie liu");
    expect(out.new_entities.topics).toContain("cis 4600");
    const m = loadMemory(memoryPath);
    expect(m.user_notes?.[0]?.source_input).toBe("test-input");
  });

  it("does not duplicate existing people on second call", async () => {
    const args = {
      source_label: "x",
      people: [
        {
          name: "Mom",
          first_seen: "2026-04-01T00:00:00Z",
          appearances: [],
        },
      ],
    };
    await updateMemoryFromInput(args, memoryPath);
    const out2 = await updateMemoryFromInput(args, memoryPath);
    expect(out2.memory_size.people).toBe(1);
    expect(out2.new_entities.people).toEqual([]);
  });

  it("missing optional arrays leave that slice untouched", async () => {
    await updateMemoryFromInput(
      {
        source_label: "first",
        events: [
          {
            uid: "u1",
            title: "x",
            start: "2026-04-01T00:00:00Z",
            end: "2026-04-01T01:00:00Z",
            duration_hours: 1,
            calendar: "C",
          },
        ],
      },
      memoryPath,
    );
    const out2 = await updateMemoryFromInput(
      {
        source_label: "second",
        people: [{ name: "Leo", first_seen: "2026-04-02T00:00:00Z", appearances: [] }],
      },
      memoryPath,
    );
    expect(out2.memory_size.events).toBe(1);
    expect(out2.memory_size.people).toBe(1);
  });
});
