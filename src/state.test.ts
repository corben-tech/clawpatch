import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { pathExists } from "./fs.js";
import {
  ensureStateDirs,
  readFeature,
  readFinding,
  statePaths,
  writeFeature,
  writeFinding,
  writePatchAttempt,
  writeRun,
} from "./state.js";
import { fixtureRoot, writeFixture } from "./test-helpers.js";
import {
  featureRecordSchema,
  findingRecordSchema,
  patchAttemptSchema,
  runRecordSchema,
} from "./types.js";
import type { FeatureRecord, FindingRecord, PatchAttempt, RunRecord } from "./types.js";

const createdAt = "2026-01-01T00:00:00.000Z";
const unsafeIds = ["../x", "a/b", "a\\b", "/tmp/x", ".", "..", "bad\0id"];

function feature(overrides: Partial<FeatureRecord> = {}): FeatureRecord {
  return {
    schemaVersion: 1,
    featureId: "feat_valid",
    title: "Valid feature",
    summary: "Valid feature",
    kind: "library",
    source: "test",
    confidence: "high",
    entrypoints: [],
    ownedFiles: [],
    contextFiles: [],
    tests: [],
    tags: [],
    trustBoundaries: [],
    status: "pending",
    lock: null,
    findingIds: [],
    patchAttemptIds: [],
    analysisHistory: [],
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    schemaVersion: 1,
    findingId: "fnd_valid",
    featureId: "feat_valid",
    title: "Valid finding",
    category: "api-contract",
    severity: "medium",
    confidence: "high",
    triage: "contract-mismatch",
    evidence: [],
    reasoning: "reasoning",
    reproduction: null,
    recommendation: "recommendation",
    whyTestsDoNotAlreadyCoverThis: "",
    suggestedRegressionTest: null,
    minimumFixScope: "",
    status: "open",
    history: [],
    signature: "sig_valid",
    linkedPatchAttemptIds: [],
    createdByRunId: "run_valid",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function patchAttempt(overrides: Partial<PatchAttempt> = {}): PatchAttempt {
  return {
    schemaVersion: 1,
    patchAttemptId: "pat_valid",
    findingIds: ["fnd_valid"],
    featureIds: ["feat_valid"],
    status: "planned",
    plan: "plan",
    filesChanged: [],
    commandsRun: [],
    testResults: [],
    provider: null,
    git: {
      baseSha: null,
      commitSha: null,
      branchName: null,
      prUrl: null,
    },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schemaVersion: 1,
    runId: "run_valid",
    command: "test",
    args: [],
    rootPath: "/tmp/project",
    headSha: null,
    startedAt: createdAt,
    finishedAt: null,
    status: "running",
    claimedFeatureIds: [],
    findingIds: [],
    patchAttemptIds: [],
    errors: [],
    ...overrides,
  };
}

describe("state record ID validation", () => {
  it("rejects unsafe persisted IDs in state schemas", () => {
    for (const id of unsafeIds) {
      expect(featureRecordSchema.safeParse(feature({ featureId: id })).success).toBe(false);
      expect(findingRecordSchema.safeParse(finding({ findingId: id })).success).toBe(false);
      expect(patchAttemptSchema.safeParse(patchAttempt({ patchAttemptId: id })).success).toBe(
        false,
      );
      expect(runRecordSchema.safeParse(run({ runId: id })).success).toBe(false);
    }
  });

  it("blocks unsafe IDs before constructing state paths", async () => {
    const root = await fixtureRoot("clawpatch-state-id-");
    const paths = statePaths(join(root, ".clawpatch"));
    await ensureStateDirs(paths);

    await expect(writeFeature(paths, feature({ featureId: "../../escape" }))).rejects.toMatchObject(
      {
        code: "invalid-state-id",
      },
    );
    await expect(readFeature(paths, "a/b")).rejects.toMatchObject({
      code: "invalid-state-id",
    });
    await expect(writeFinding(paths, finding({ findingId: "a\\b" }))).rejects.toMatchObject({
      code: "invalid-state-id",
    });
    await expect(readFinding(paths, "..")).rejects.toMatchObject({
      code: "invalid-state-id",
    });
    await expect(
      writePatchAttempt(paths, patchAttempt({ patchAttemptId: "bad\0id" })),
    ).rejects.toMatchObject({
      code: "invalid-state-id",
    });
    await expect(writeRun(paths, run({ runId: "/tmp/run" }))).rejects.toMatchObject({
      code: "invalid-state-id",
    });
    expect(await pathExists(join(root, "escape.json"))).toBe(false);
  });

  it("rejects state files whose record ID differs from the requested filename", async () => {
    const root = await fixtureRoot("clawpatch-state-id-mismatch-");
    const paths = statePaths(join(root, ".clawpatch"));
    await writeFixture(
      root,
      ".clawpatch/features/feat_expected.json",
      `${JSON.stringify(feature({ featureId: "feat_actual" }), null, 2)}\n`,
    );

    await expect(readFeature(paths, "feat_expected")).rejects.toMatchObject({
      code: "state-id-mismatch",
    });
  });
});
