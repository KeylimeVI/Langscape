import { describe, expect, it } from "vitest";
import {
  groupTraceLines,
  parseWords,
  traceLinesForWord,
  traceStagesForWord,
} from "../../src/soundchange/panel";

const lines = [
  "Tracing apa, eke, pataka",
  "Applied Lenition to apa: apa -> aba",
  "Applied Lenition to eke: eke -> ege",
  "Applied Vowel-Shift to apa: aba -> ebe",
];

describe("sound-change test bench helpers", () => {
  it("parses one word per line", () => {
    expect(parseWords("apa\n\n eke \npataka")).toEqual(["apa", "eke", "pataka"]);
  });

  it("filters Lexurgy's combined trace by word", () => {
    expect(traceLinesForWord(lines, "apa")).toEqual([
      "Tracing apa",
      "Applied Lenition to apa: apa -> aba",
      "Applied Vowel-Shift to apa: aba -> ebe",
    ]);
    expect(traceLinesForWord(lines, "eke")).toEqual([
      "Tracing eke",
      "Applied Lenition to eke: eke -> ege",
    ]);
  });

  it("falls back to the whole trace when Lexurgy did not tag words", () => {
    const untagged = ["Applied Rule: a -> b"];
    expect(traceLinesForWord(untagged, "a")).toEqual(["Applied Rule: a -> b"]);
  });

  it("turns trace lines into vertical iteration stages", () => {
    const stages = traceStagesForWord(
      [
        "Tracing apa, eke",
        "Applied Lenition to apa: apa -> aba",
        "Applied Assign Stress to apa: aba -> 'aba",
        "Applied Lenition to eke: eke -> ege",
      ],
      "apa"
    );
    expect(stages).toEqual({
      input: "apa",
      stages: [
        { rule: "Lenition", form: "aba" },
        { rule: "Assign Stress", form: "'aba" },
      ],
    });
    expect(traceStagesForWord(lines, "pataka")).toBeNull();
  });

  it("groups a combined trace into per-word traces", () => {
    const groups = groupTraceLines(lines);
    expect([...groups.keys()]).toEqual(["apa", "eke", "pataka"]);
    expect(groups.get("eke")?.[0]).toBe("Tracing eke");
  });
});
