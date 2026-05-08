# @medplum/e2e

A collection of end-to-end tests to run against Medplum, including a closed-loop coverage harness for `packages/app/src/`.

## Getting started

Before running any tests, install Playwright and its Chromium dependency:

```bash
npm run playwright:install
```

## Running the smoke tests

With both `@medplum/server` and `@medplum/app` running, execute:

```bash
npm run test:smoke
```

## Coverage harness

The coverage harness uses [`@bgotink/playwright-coverage`](https://github.com/bgotink/playwright-coverage) to collect V8 block coverage from the running app and map it back to the original TypeScript source in `packages/app/src/` via Vite source maps.

See [COVERAGE_MODEL.md](./COVERAGE_MODEL.md) for the full design: unit of coverage, representation format, test decomposition, and synchronisation contract.

### Prerequisites

`@medplum/app` must be running in dev mode with source maps enabled (the default):

```bash
npm run dev --workspace=packages/app
```

### Step 1 — Run coverage and view gaps

```bash
npm run coverage:run --workspace=packages/e2e
```

This runs all tests in `coverage/tests/`, writes reports to `results/coverage/`, and prints a coverage summary. To list only the files below threshold:

```bash
npm run coverage:gaps --workspace=packages/e2e
```

Exits with code `1` when gaps exist, making it suitable as a CI gate.

### Step 2 — Close a gap

```bash
npm run coverage:close-gap --workspace=packages/e2e -- --file=src/resource/HistoryPage.tsx
```

This command:
1. Captures the **before** coverage for the target file
2. Identifies uncovered lines from the last run
3. Generates a test scaffold at `coverage/tests/generated/<File>.generated.test.ts`
4. Re-runs the coverage suite
5. Prints a **before / after** table showing the improvement

Refine the generated scaffold's `TODO` assertions to exercise the uncovered code path, then commit it to `coverage/tests/` once it passes.

### Coverage report

After a run, open the interactive HTML report:

```
packages/e2e/results/coverage/index.html
```

### Fixture design

Every coverage test imports `{ test, expect }` from `coverage/fixtures.ts`. This extends `@bgotink/playwright-coverage`'s `test` with a `mockClient` fixture — a `MockClient` instance from `@medplum/mock` pre-seeded with the same canonical resources used by unit tests (`DrAliceSmith`, `HomerSimpson`, `ExampleBot`, …). Tests derive route URLs and expected values from the mock vocabulary rather than hard-coding server-specific data.

### Thresholds

| Metric | Per-file threshold |
|---|---|
| Lines | 80 % |
| Branches | 60 % |

## Writing tests manually

Use the Playwright codegen tool to record interactions against the running app:

```bash
npm run playwright:codegen
```
