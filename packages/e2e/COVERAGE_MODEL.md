# Coverage Model — Medplum App E2E

## 1. Unit of Coverage

| Dimension | Choice | Rationale |
|-----------|--------|-----------|
| **Instrumentation layer** | V8 native coverage via `@bgotink/playwright-coverage` | No build-time Babel/Istanbul transform required; works against the unmodified Vite dev-server bundle |
| **Source scope** | `packages/app/src/**` (TypeScript before transpile) | Source maps produced by Vite in dev mode map every executed JS byte back to the original `.tsx`/`.ts` line |
| **Granularity** | Line + branch (V8 block coverage → Istanbul) | Gives actionable line numbers to the gap-close script |
| **Test scope** | `packages/e2e/coverage/tests/**` | Separate from smoke tests; focus is coverage breadth, not happy-path stability |

---

## 2. Coverage Representation

```
packages/e2e/results/coverage/
  coverage-summary.json   ← Istanbul JSON summary (machine-readable, parsed by scripts)
  coverage.lcov           ← LCOV for IDE gutters and CI diff decoration
  index.html              ← Interactive HTML drilldown
```

`coverage-summary.json` schema (per-file entry):

```jsonc
{
  "packages/app/src/SomePage.tsx": {
    "lines":      { "total": 42, "covered": 30, "skipped": 0, "pct": 71.43 },
    "statements": { "total": 55, "covered": 39, "skipped": 0, "pct": 70.9  },
    "functions":  { "total": 8,  "covered": 6,  "skipped": 0, "pct": 75.0  },
    "branches":   { "total": 14, "covered": 9,  "skipped": 0, "pct": 64.29 }
  }
}
```

A file is considered a **gap** when `lines.pct < 80` (configurable via `COVERAGE_THRESHOLD` env var).

---

## 3. Test Decomposition and Synchronisation

### Fixture seam — `MockClient` as vocabulary

Every coverage test imports `{ test, expect }` from `packages/e2e/coverage/fixtures.ts`.
That fixture extends `@bgotink/playwright-coverage`'s `test` with a `mockClient` fixture:

```
@bgotink/playwright-coverage test
  └── mockClient fixture (MockClient instance)
        The MockClient carries the canonical pre-seeded resource IDs
        (HomerSimpson, DrAliceSmith, ExampleBot …) that the dev server
        is also expected to have. Tests derive route URLs and assertion
        values from the MockClient rather than hard-coding them, so both
        unit tests and e2e tests share the same "data vocabulary."
```

### Route → test mapping

AppRoutes.tsx defines every route the app serves.
`coverage/tests/app-routes.test.ts` mirrors that file: one `describe` block per
route group (auth, resource, admin, lab), one `test` per leaf route.

Because every test targets a specific route, adding a new route to AppRoutes.tsx
creates a visible gap in the HTML report that the `coverage:close-gap` command can
close in one step.

### Synchronisation contract

| App change | Coverage impact | Action |
|---|---|---|
| New page / route added | New file in `packages/app/src/` → 0 % coverage → appears in gap report | Run `npm run coverage:close-gap -- --file=<path>` |
| Existing file substantially rewritten | Line coverage drops → file re-enters gap list | Same command |
| Route removed | Coverage for deleted file disappears from summary | Script warns if generated test file still exists |

---

## 4. Closed-Loop Commands

```
# ── Step 1: run coverage and see gaps ────────────────────────────────
npm run coverage:run --workspace=packages/e2e

# ── Step 2: close a specific gap (generates test + shows before/after) ─
npm run coverage:close-gap --workspace=packages/e2e -- \
  --file=src/resource/HistoryPage.tsx

# ── Step 3: view interactive HTML report ─────────────────────────────
open packages/e2e/results/coverage/index.html
```

The `coverage:close-gap` command:
1. Reads the current coverage for the target file from `coverage-summary.json`
2. Identifies uncovered lines from `coverage.lcov`
3. Scaffolds a Playwright test in `coverage/tests/generated/<File>.generated.test.ts`
4. Re-runs the coverage suite
5. Prints a side-by-side **before / after** table

---

## 5. Thresholds and CI

| Metric | Threshold |
|--------|-----------|
| Line coverage (per file) | 80 % |
| Branch coverage (per file) | 60 % |
| Overall line coverage | 70 % |

These thresholds are enforced by `coverage-gaps.mjs` which exits with code 1 when
any gap file exists, making it suitable as a CI gate.
