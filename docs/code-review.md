---
title: Code Review
description: "How clawpatch reviews features with AI providers and persists findings"
---

# Code Review

`clawpatch review` reviews feature records created by `clawpatch map`.

```bash
clawpatch review --limit 3
clawpatch review --limit 12 --jobs 4
clawpatch review --feature <featureId>
clawpatch review --provider codex --model <model>
```

Current behavior:

- selects pending features unless `--feature` is set
- claims each feature with an atomic lock file plus the feature run lock
- reviews with a bounded worker pool; default `--jobs` is `10`
- emits progress to stderr unless `--quiet` is set
- builds bounded prompt context from owned files, context files, and tests
- calls the configured provider
- requires strict JSON output
- writes findings under `.clawpatch/findings/`
- appends analysis history to the feature record
- releases the feature lock

Progress uses stderr so `--json` stdout remains machine-readable. The worker
pool is per-process, and lock files under `.clawpatch/locks/` prevent
overlapping review processes from claiming the same feature. Interrupted runs
can leave recoverable lock files; clear them with `clawpatch clean-locks` after
confirming no review process is still active. `clawpatch status` includes both
feature-record locks and lock files in `activeLocks`, and reports the lock-file
count as `lockFiles`.

There is no multi-provider panel yet.

Categories requested from the provider:

- `bug`
- `security`
- `performance`
- `concurrency`
- `api-contract`
- `data-loss`
- `test-gap`
- `docs-gap`
- `build-release`
- `maintainability`

Review does not edit files. Use `clawpatch fix --finding <id>` for the explicit
patch loop.
