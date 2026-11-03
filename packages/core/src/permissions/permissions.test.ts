import { describe, expect, it } from "vitest";
import { decide } from "./index.js";

const none = { allow: [], deny: [] };

describe("decide", () => {
  it("allows reads in every mode", () => {
    for (const mode of ["ask", "auto-edit", "plan", "yolo"] as const) {
      expect(decide(mode, none, { tool: "read", risk: "read", argSummary: "" }).kind).toBe("allow");
    }
  });

  it("denies writes in plan mode", () => {
    expect(decide("plan", none, { tool: "write", risk: "write", argSummary: "" }).kind).toBe("deny");
  });

  it("deny rules beat yolo", () => {
    const rules = { allow: [], deny: ["shell(rm *)"] };
    expect(decide("yolo", rules, { tool: "shell", risk: "exec", argSummary: "rm -rf /" }).kind).toBe("deny");
  });
});
