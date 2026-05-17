import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config.js";
import { validateReviewOutput } from "./review-validation.js";
import { fixtureRoot, writeFixture } from "./test-helpers.js";
import type { FeatureRecord, ReviewOutput } from "./types.js";

describe("validateReviewOutput", () => {
  it("accepts evidence that points at included files, existing lines, and matching quotes", async () => {
    const root = await fixtureRoot("clawpatch-review-validation-ok-");
    await writeFixture(root, "src/index.ts", "const value = 'TODO_BUG';\n");

    await expect(
      validateReviewOutput(root, feature("src/index.ts"), defaultConfig(), output("src/index.ts")),
    ).resolves.toMatchObject({ findings: [{ title: "Bug" }] });
  });

  it("rejects evidence for files that were not included in review context", async () => {
    const root = await fixtureRoot("clawpatch-review-validation-path-");
    await writeFixture(root, "src/index.ts", "const value = 'TODO_BUG';\n");
    await writeFixture(root, "src/other.ts", "const value = 'TODO_BUG';\n");

    await expect(
      validateReviewOutput(root, feature("src/index.ts"), defaultConfig(), output("src/other.ts")),
    ).rejects.toMatchObject({ code: "malformed-output" });
  });

  it("rejects stale line ranges and quotes that do not match current file text", async () => {
    const root = await fixtureRoot("clawpatch-review-validation-content-");
    await writeFixture(root, "src/index.ts", "const value = 'real';\n");

    await expect(
      validateReviewOutput(
        root,
        feature("src/index.ts"),
        defaultConfig(),
        output("src/index.ts", { startLine: 9, endLine: 9, quote: "real" }),
      ),
    ).rejects.toMatchObject({ code: "malformed-output" });

    await expect(
      validateReviewOutput(
        root,
        feature("src/index.ts"),
        defaultConfig(),
        output("src/index.ts", { startLine: 1, endLine: 1, quote: "missing" }),
      ),
    ).rejects.toMatchObject({ code: "malformed-output" });
  });
});

function feature(path: string): FeatureRecord {
  return {
    schemaVersion: 1,
    featureId: "feat_test",
    title: "Test feature",
    summary: "Test feature.",
    kind: "library",
    source: "test",
    confidence: "high",
    entrypoints: [{ path, symbol: null, route: null, command: null }],
    ownedFiles: [{ path, reason: "test" }],
    contextFiles: [],
    tests: [],
    tags: [],
    trustBoundaries: [],
    status: "pending",
    lock: null,
    findingIds: [],
    patchAttemptIds: [],
    analysisHistory: [],
    createdAt: "2026-05-18T00:00:00.000Z",
    updatedAt: "2026-05-18T00:00:00.000Z",
  };
}

function output(
  path: string,
  evidence: { startLine?: number | null; endLine?: number | null; quote?: string | null } = {},
): ReviewOutput {
  return {
    findings: [
      {
        title: "Bug",
        category: "bug",
        severity: "medium",
        confidence: "high",
        evidence: [
          {
            path,
            startLine: evidence.startLine ?? 1,
            endLine: evidence.endLine ?? 1,
            symbol: null,
            quote: evidence.quote ?? "TODO_BUG",
          },
        ],
        reasoning: "Reason.",
        reproduction: null,
        recommendation: "Fix it.",
        whyTestsDoNotAlreadyCoverThis: "No test.",
        suggestedRegressionTest: null,
        minimumFixScope: "Small.",
      },
    ],
    inspected: { files: [path], symbols: [], notes: [] },
  };
}
