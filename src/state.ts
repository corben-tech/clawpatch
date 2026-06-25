import { open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ClawpatchError } from "./errors.js";
import { ensureDir, nowIso, pathExists, readJson, writeJson } from "./fs.js";
import {
  FeatureRecord,
  FindingRecord,
  PatchAttempt,
  ProjectRecord,
  RunRecord,
  featureRecordSchema,
  findingRecordSchema,
  patchAttemptSchema,
  projectRecordSchema,
  runRecordSchema,
  stateRecordIdSchema,
} from "./types.js";

export type StatePaths = {
  stateDir: string;
  config: string;
  project: string;
  features: string;
  findings: string;
  runs: string;
  patches: string;
  reports: string;
  locks: string;
};

export function statePaths(stateDir: string): StatePaths {
  return {
    stateDir,
    config: join(stateDir, "config.json"),
    project: join(stateDir, "project.json"),
    features: join(stateDir, "features"),
    findings: join(stateDir, "findings"),
    runs: join(stateDir, "runs"),
    patches: join(stateDir, "patches"),
    reports: join(stateDir, "reports"),
    locks: join(stateDir, "locks"),
  };
}

export async function ensureStateDirs(paths: StatePaths): Promise<void> {
  await Promise.all([
    ensureDir(paths.stateDir),
    ensureDir(paths.features),
    ensureDir(paths.findings),
    ensureDir(paths.runs),
    ensureDir(paths.patches),
    ensureDir(paths.reports),
    ensureDir(paths.locks),
  ]);
}

export async function readProject(paths: StatePaths): Promise<ProjectRecord | null> {
  if (!(await pathExists(paths.project))) {
    return null;
  }
  return readJson(paths.project, projectRecordSchema);
}

export async function writeProject(paths: StatePaths, project: ProjectRecord): Promise<void> {
  await writeJson(paths.project, project);
}

export async function readFeatures(paths: StatePaths): Promise<FeatureRecord[]> {
  return readRecords(paths.features, featureRecordSchema);
}

export async function readFeature(paths: StatePaths, id: string): Promise<FeatureRecord | null> {
  const featureId = validateStateRecordId("feature", id);
  const path = featurePath(paths, id);
  if (!(await pathExists(path))) {
    return null;
  }
  const feature = await readJson(path, featureRecordSchema);
  assertRecordIdMatches("feature", featureId, feature.featureId);
  return feature;
}

export async function writeFeature(paths: StatePaths, feature: FeatureRecord): Promise<void> {
  await writeJson(featurePath(paths, feature.featureId), feature);
}

export async function claimFeature(
  paths: StatePaths,
  featureId: string,
  lock: NonNullable<FeatureRecord["lock"]>,
  options: { allowNonPending?: boolean } = {},
): Promise<FeatureRecord> {
  await ensureDir(paths.locks);
  const lockPath = featureLockPath(paths, featureId);
  let handle;
  try {
    handle = await open(lockPath, "wx");
    await handle.writeFile(`${JSON.stringify(lock, null, 2)}\n`, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error, "EEXIST")) {
      throw new ClawpatchError(`feature locked: ${featureId}`, 7, "lock-conflict");
    }
    if (handle !== undefined) {
      await handle.close();
      handle = undefined;
      await releaseFeatureLock(paths, featureId);
    }
    throw error;
  } finally {
    await handle?.close();
  }

  try {
    const feature = await readFeature(paths, featureId);
    if (feature === null) {
      throw new ClawpatchError(`feature not found: ${featureId}`, 2, "feature-not-found");
    }
    if (feature.lock !== null) {
      throw new ClawpatchError(`feature locked: ${featureId}`, 7, "lock-conflict");
    }
    if (options.allowNonPending !== true && !["pending", "error"].includes(feature.status)) {
      throw new ClawpatchError(`feature not reviewable: ${featureId}`, 7, "lock-conflict");
    }
    const claimed: FeatureRecord = {
      ...feature,
      status: "claimed",
      lock,
      updatedAt: nowIso(),
    };
    await writeFeature(paths, claimed);
    return claimed;
  } catch (error: unknown) {
    await releaseFeatureLock(paths, featureId);
    throw error;
  }
}

export async function releaseFeatureLock(paths: StatePaths, featureId: string): Promise<void> {
  await unlink(featureLockPath(paths, featureId)).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  });
}

export async function clearFeatureLockFiles(paths: StatePaths): Promise<number> {
  const lockIds = await readFeatureLockIds(paths);
  for (const id of lockIds) {
    await releaseFeatureLock(paths, id);
  }
  return lockIds.length;
}

export async function readFeatureLockIds(paths: StatePaths): Promise<string[]> {
  if (!(await pathExists(paths.locks))) {
    return [];
  }
  const names = await readdir(paths.locks);
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((id) => stateRecordIdSchema.safeParse(id).success)
    .toSorted();
}

export async function readFindings(paths: StatePaths): Promise<FindingRecord[]> {
  return readRecords(paths.findings, findingRecordSchema);
}

export async function readFinding(paths: StatePaths, id: string): Promise<FindingRecord | null> {
  const findingId = validateStateRecordId("finding", id);
  const path = findingPath(paths, id);
  if (!(await pathExists(path))) {
    return null;
  }
  const finding = await readJson(path, findingRecordSchema);
  assertRecordIdMatches("finding", findingId, finding.findingId);
  return finding;
}

export async function writeFinding(paths: StatePaths, finding: FindingRecord): Promise<void> {
  await writeJson(findingPath(paths, finding.findingId), finding);
}

export async function writeRun(paths: StatePaths, run: RunRecord): Promise<void> {
  await writeJson(runPath(paths, run.runId), run);
}

export async function readRuns(paths: StatePaths): Promise<RunRecord[]> {
  return readRecords(paths.runs, runRecordSchema);
}

export async function writePatchAttempt(paths: StatePaths, patch: PatchAttempt): Promise<void> {
  await writeJson(patchPath(paths, patch.patchAttemptId), patch);
}

export async function readPatchAttempts(paths: StatePaths): Promise<PatchAttempt[]> {
  return readRecords(paths.patches, patchAttemptSchema);
}

async function readRecords<T>(dir: string, schema: z.ZodType<T>): Promise<T[]> {
  if (!(await pathExists(dir))) {
    return [];
  }
  const names = await readdir(dir);
  const records: T[] = [];
  for (const name of names.toSorted()) {
    if (!name.endsWith(".json")) {
      continue;
    }
    records.push(await readJson(join(dir, name), schema));
  }
  return records;
}

function featurePath(paths: StatePaths, featureId: string): string {
  return stateRecordPath(paths.features, "feature", featureId);
}

function featureLockPath(paths: StatePaths, featureId: string): string {
  return stateRecordPath(paths.locks, "feature lock", featureId);
}

function findingPath(paths: StatePaths, findingId: string): string {
  return stateRecordPath(paths.findings, "finding", findingId);
}

function runPath(paths: StatePaths, runId: string): string {
  return stateRecordPath(paths.runs, "run", runId);
}

function patchPath(paths: StatePaths, patchAttemptId: string): string {
  return stateRecordPath(paths.patches, "patch attempt", patchAttemptId);
}

function stateRecordPath(dir: string, kind: string, id: string): string {
  return join(dir, `${validateStateRecordId(kind, id)}.json`);
}

function validateStateRecordId(kind: string, id: string): string {
  const parsed = stateRecordIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new ClawpatchError(`invalid ${kind} id: ${id}`, 2, "invalid-state-id");
  }
  return parsed.data;
}

function assertRecordIdMatches(kind: string, requested: string, actual: string): void {
  if (actual !== requested) {
    throw new ClawpatchError(
      `${kind} record id mismatch: requested ${requested}, found ${actual}`,
      2,
      "state-id-mismatch",
    );
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
