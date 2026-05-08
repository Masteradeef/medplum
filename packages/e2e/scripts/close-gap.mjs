#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
/* eslint-env node */
/* global process, console */

/**
 * close-gap.mjs
 * ─────────────
 * Closed-loop gap closer for `@medplum/e2e` coverage harness.
 *
 * Workflow
 * ────────
 *   1. Read current coverage for the target file from coverage-summary.json
 *      → "BEFORE" snapshot
 *   2. Identify uncovered lines from coverage-detail.json
 *   3. Generate a Playwright test scaffold targeting those lines
 *   4. Write it to coverage/tests/generated/<FileName>.generated.test.ts
 *   5. Re-run the coverage suite
 *   6. Read new coverage → "AFTER" snapshot
 *   7. Print a side-by-side before / after report
 *
 * Usage
 * ─────
 *   npm run coverage:close-gap --workspace=packages/e2e -- --file=src/resource/HistoryPage.tsx
 *   npm run coverage:close-gap --workspace=packages/e2e -- --file=src/BatchPage.tsx
 *
 * The --file argument is relative to packages/app/ (e.g. src/BatchPage.tsx).
 *
 * Prerequisites
 * ─────────────
 *   npm run coverage:run must have been executed at least once so that
 *   coverage-summary.json and coverage-detail.json exist.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── Setup ────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(e2eDir, '../..');
const appSrcDir = path.join(repoRoot, 'packages', 'app', 'src');

const RESULTS_DIR = path.join(e2eDir, 'results', 'coverage');
const SUMMARY_PATH = path.join(RESULTS_DIR, 'coverage-summary.json');
const DETAIL_PATH = path.join(RESULTS_DIR, 'coverage-detail.json');
const GENERATED_DIR = path.join(e2eDir, 'coverage', 'tests', 'generated');

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function red(s) { return `${RED}${s}${RESET}`; }
function yellow(s) { return `${YELLOW}${s}${RESET}`; }
function green(s) { return `${GREEN}${s}${RESET}`; }
function cyan(s) { return `${CYAN}${s}${RESET}`; }
function bold(s) { return `${BOLD}${s}${RESET}`; }
function dim(s) { return `${DIM}${s}${RESET}`; }

function pctStr(pct) {
  return `${pct?.toFixed(1) ?? 'n/a'}%`;
}

function pctDelta(before, after) {
  if (before === null || before === undefined || after === null || after === undefined) {
    return '';
  }
  const delta = after - before;
  const sign = delta >= 0 ? '+' : '';
  const str = `${sign}${delta.toFixed(1)}%`;
  if (delta > 0) {
    return green(str);
  }
  if (delta < 0) {
    return red(str);
  }
  return dim(str);
}

// ── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const fileArgIndex = args.indexOf('--file');
if (fileArgIndex === -1 || !args[fileArgIndex + 1]) {
  console.error(
    red('✖ Missing --file argument.\n\n') +
    'Usage:\n' +
    `  ${yellow('node packages/e2e/scripts/close-gap.mjs --file=src/BatchPage.tsx')}\n\n` +
    `The path is relative to packages/app/ (e.g. ${cyan('src/resource/HistoryPage.tsx')}).`
  );
  process.exit(1);
}

const relativeFile = args[fileArgIndex + 1].replace(/^=/, ''); // support --file=... syntax

// Normalise: strip 'src/' prefix for the summary key lookup
const fileKey = relativeFile.startsWith('src/') ? relativeFile : `src/${relativeFile}`;
// Full key as it appears in the Istanbul summary (repo-relative)
const summaryKey = `packages/app/${fileKey}`;

// ── Pre-flight checks ─────────────────────────────────────────────────────────

if (!existsSync(SUMMARY_PATH)) {
  console.error(
    red('✖ Coverage summary not found. Run the coverage suite first:\n') +
    `  ${bold('npm run coverage:run --workspace=packages/e2e')}`
  );
  process.exit(2);
}

if (!existsSync(DETAIL_PATH)) {
  console.error(
    red('✖ Coverage detail not found. Run the coverage suite first:\n') +
    `  ${bold('npm run coverage:run --workspace=packages/e2e')}`
  );
  process.exit(2);
}

// ── Read BEFORE coverage ──────────────────────────────────────────────────────

const summaryBefore = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
const detailBefore = JSON.parse(readFileSync(DETAIL_PATH, 'utf8'));

function findEntry(summary, key) {
  // Istanbul keys are typically absolute or repo-relative; try several variants
  for (const [k, v] of Object.entries(summary)) {
    if (k.endsWith(key) || k.endsWith(key.replace(/\//g, path.sep))) {
      return { key: k, data: v };
    }
  }
  return null;
}

const beforeEntry = findEntry(summaryBefore, summaryKey);
const detailEntry = findEntry(detailBefore, summaryKey);

if (!beforeEntry) {
  console.warn(
    yellow(`⚠ File "${summaryKey}" not found in the coverage summary.\n`) +
    `  It may have zero coverage (never executed) or the path is incorrect.\n` +
    `  Available keys containing "app/src":\n` +
    Object.keys(summaryBefore)
      .filter(k => k.includes('packages/app/src'))
      .slice(0, 10)
      .map(k => `    ${dim(k)}`)
      .join('\n')
  );
}

const before = beforeEntry?.data ?? null;

console.log();
console.log(bold(`Closing gap: ${cyan(relativeFile)}`));
console.log('─'.repeat(72));
console.log(bold('BEFORE'));
if (before) {
  console.log(`  Lines:    ${pctStr(before.lines?.pct)}  (${before.lines?.covered}/${before.lines?.total} covered)`);
  console.log(`  Branches: ${pctStr(before.branches?.pct)}  (${before.branches?.covered}/${before.branches?.total} covered)`);
  console.log(`  Functions:${pctStr(before.functions?.pct)}  (${before.functions?.covered}/${before.functions?.total} covered)`);
} else {
  console.log(`  ${red('0% — file was never executed during previous coverage run')}`);
}
console.log();

// ── Identify uncovered lines ──────────────────────────────────────────────────

const uncoveredLines = [];

if (detailEntry?.data?.s) {
  // Istanbul "s" = statement map.  Find statements with 0 executions.
  const statementCounts = detailEntry.data.s;
  const statementMap = detailEntry.data.statementMap ?? {};
  for (const [id, count] of Object.entries(statementCounts)) {
    if (count === 0 && statementMap[id]) {
      uncoveredLines.push(statementMap[id].start.line);
    }
  }
}

const uniqueUncoveredLines = [...new Set(uncoveredLines)].sort((a, b) => a - b);
if (uniqueUncoveredLines.length > 0) {
  console.log(`  Uncovered lines: ${uniqueUncoveredLines.slice(0, 20).join(', ')}${uniqueUncoveredLines.length > 20 ? ' …' : ''}`);
  console.log();
}

// ── Read source file for context ─────────────────────────────────────────────

const absoluteSourcePath = path.join(appSrcDir, fileKey.replace(/^src\//, ''));
let sourceLines = [];
if (existsSync(absoluteSourcePath)) {
  sourceLines = readFileSync(absoluteSourcePath, 'utf8').split('\n');
}

// Derive the component name and probable route from the file path
const fileName = path.basename(relativeFile, path.extname(relativeFile));
const componentName = fileName; // e.g. "HistoryPage"

// Heuristic: map common page names to likely routes
function inferRoute(name) {
  const routeMap = {
    SignInPage: '/signin',
    RegisterPage: '/register',
    ResetPasswordPage: '/resetpassword',
    ChangePasswordPage: '/changepassword',
    SecurityPage: '/security',
    MfaPage: '/mfa',
    BatchPage: '/batch',
    BulkAppPage: '/bulk/Patient',
    SmartSearchPage: '/smart',
    HomePage: '/Patient',
    CreateResourcePage: '/Patient/new',
    HistoryPage: '/Practitioner/123/history',
    TimelinePage: '/Patient/123/timeline',
    DetailsPage: '/Practitioner/123/details',
    EditPage: '/Practitioner/123/edit',
    JsonPage: '/Practitioner/123/json',
    DeletePage: '/Practitioner/123/delete',
    AuditEventPage: '/Practitioner/123/event',
    AppsPage: '/Patient/123/apps',
    ExportPage: '/Patient/123/export',
    SubscriptionsPage: '/Patient/123/subscriptions',
    BotEditor: '/Bot/123/editor',
    BuilderPage: '/Questionnaire/123/builder',
    PreviewPage: '/Questionnaire/123/preview',
    ProfilesPage: '/Practitioner/123/profiles',
    ChecklistPage: '/PlanDefinition/123/checklist',
    ReferenceRangesPage: '/ObservationDefinition/123/ranges',
    ResourceVersionPage: '/Practitioner/123/history/1',
    QuestionnaireResponsePage: '/Questionnaire/123/responses',
    BotsPage: '/admin/bots',
    ClientsPage: '/admin/clients',
    UsersPage: '/admin/users',
    SecretsPage: '/admin/secrets',
    SitesPage: '/admin/sites',
    InvitePage: '/admin/invite',
    ProjectDetailsPage: '/admin/details',
    AssaysPage: '/lab/assays',
    PanelsPage: '/lab/panels',
  };
  return routeMap[name] ?? `/${name.replace(/Page$/, '')}`;
}

const inferredRoute = inferRoute(componentName);

// ── Generate test scaffold ────────────────────────────────────────────────────

/**
 * Build a meaningful test scaffold.
 *
 * For each cluster of uncovered lines we emit a `test()` that:
 *   1. Signs in
 *   2. Navigates to the component's route
 *   3. Has TODO assertions that map to the uncovered area
 * @param componentName - The React component name (e.g. 'HistoryPage').
 * @param route - The app route to navigate to (e.g. '/Practitioner/123/history').
 * @param uncoveredLines - Sorted array of uncovered line numbers.
 * @param sourceLines - Array of source file lines for context snippets.
 * @returns The generated test file content as a string.
 */
function buildTestScaffold(componentName, route, uncoveredLines, sourceLines) {
  // Group uncovered lines into clusters (lines within 5 of each other)
  const clusters = [];
  let current = [];
  for (const line of uncoveredLines) {
    if (current.length === 0 || line - current[current.length - 1] <= 5) {
      current.push(line);
    } else {
      clusters.push(current);
      current = [line];
    }
  }
  if (current.length > 0) {
    clusters.push(current);
  }

  // Generate a test for each cluster (max 5 tests to keep the file manageable)
  const tests = clusters.slice(0, 5).map((cluster, i) => {
    const lineContext = cluster
      .slice(0, 3)
      .map(l => {
        const src = sourceLines[l - 1]?.trim() ?? '';
        return src ? `    // line ${l}: ${src.substring(0, 60)}` : `    // line ${l}`;
      })
      .join('\n');

    return `  test('covers lines ${cluster[0]}–${cluster[cluster.length - 1]} of ${componentName} (gap ${i + 1})', async ({ page, mockClient }) => {
    await signIn(page);
    await page.goto('${route}');

    // ── Uncovered code context ───────────────────────────────────────
${lineContext}
    // ────────────────────────────────────────────────────────────────

    // TODO: Replace the assertions below with interactions that exercise
    //       the uncovered branch/statement above.
    await expect(page).not.toHaveURL(/\\/signin/);

    // Example assertions:
    // await page.getByRole('button', { name: '...' }).click();
    // await expect(page.getByText('...')).toBeVisible();

    // MockClient vocabulary check – use mockClient to derive expected values:
    // const profile = mockClient.getProfile();
    // expect(profile?.resourceType).toBe('Practitioner');
  });`;
  });

  return `// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// AUTO-GENERATED by packages/e2e/scripts/close-gap.mjs
// Target: packages/app/${fileKey}
// Route:  ${route}
// Generated: ${new Date().toISOString()}
//
// Instructions
// ────────────
// 1. Review the TODO assertions below.
// 2. Replace each TODO with interactions that exercise the uncovered code path.
// 3. Run: npm run coverage:run --workspace=packages/e2e
// 4. Verify coverage increased.

import { expect, signIn, test } from '../../fixtures';

test.describe('${componentName} – gap coverage (auto-generated)', () => {
${tests.join('\n\n')}
});
`;
}

const scaffoldContent = buildTestScaffold(componentName, inferredRoute, uniqueUncoveredLines, sourceLines);

// Write generated test
mkdirSync(GENERATED_DIR, { recursive: true });
const outPath = path.join(GENERATED_DIR, `${componentName}.generated.test.ts`);
writeFileSync(outPath, scaffoldContent, 'utf8');

const relativeOut = path.relative(repoRoot, outPath);
console.log(bold('Generated test scaffold:'));
console.log(`  ${cyan(relativeOut)}`);
console.log();

// Print preview of the generated file
const previewLines = scaffoldContent.split('\n').slice(0, 30);
console.log(dim('─── preview ────────────────────────────────────────────────────────────'));
previewLines.forEach(l => console.log(dim('  │ ') + l));
if (scaffoldContent.split('\n').length > 30) {
  console.log(dim(`  │ … (${scaffoldContent.split('\n').length - 30} more lines)`));
}
console.log(dim('────────────────────────────────────────────────────────────────────────'));
console.log();

// ── Re-run coverage suite ─────────────────────────────────────────────────────

console.log(bold('Running coverage suite…'));
console.log(dim(`  npx playwright test --config=playwright.coverage.config.ts`));
console.log();

let runSuccess = true;
try {
  execSync('npx playwright test --config=playwright.coverage.config.ts', {
    cwd: e2eDir,
    stdio: 'inherit',
    env: { ...process.env },
  });
} catch {
  runSuccess = false;
  // Playwright exits with non-zero even on test failures; we continue to diff coverage
}

// ── Read AFTER coverage ───────────────────────────────────────────────────────

if (!existsSync(SUMMARY_PATH)) {
  console.error(red('✖ Coverage summary not regenerated. Check playwright output above.'));
  process.exit(3);
}

const summaryAfter = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
const afterEntry = findEntry(summaryAfter, summaryKey);
const after = afterEntry?.data ?? null;

// ── Final report ──────────────────────────────────────────────────────────────

console.log();
console.log(bold('═'.repeat(72)));
console.log(bold('  FINAL REPORT'));
console.log(bold('═'.repeat(72)));
console.log();
console.log(bold(`  File: ${cyan(relativeFile)}`));
console.log();

const metrics = ['lines', 'branches', 'functions', 'statements'];
const colW = [14, 12, 12, 12];

// Header
const header = ['Metric', 'BEFORE', 'AFTER', 'DELTA'].map((h, i) => h.padEnd(colW[i])).join('  ');
console.log(bold('  ' + header));
console.log('  ' + '─'.repeat(colW.reduce((a, b) => a + b + 2, 0)));

for (const m of metrics) {
  const bPct = before?.[m]?.pct ?? null;
  const aPct = after?.[m]?.pct ?? null;
  const row = [
    m.charAt(0).toUpperCase() + m.slice(1),
    bPct !== null && bPct !== undefined ? pctStr(bPct) : red('not measured'),
    aPct !== null && aPct !== undefined ? pctStr(aPct) : red('not measured'),
    pctDelta(bPct, aPct),
  ].map((v, i) => v.padEnd(colW[i]));
  console.log('  ' + row.join('  '));
}

console.log();

if (after) {
  const lineImproved = (after.lines?.pct ?? 0) > (before?.lines?.pct ?? 0);
  if (lineImproved) {
    console.log(green('  ✔ Coverage improved.'));
  } else {
    console.log(yellow('  ⚠ Coverage did not improve.  Refine the generated test scaffold.'));
    console.log(`    Edit: ${cyan(relativeOut)}`);
    console.log(`    Then re-run: ${bold('npm run coverage:run --workspace=packages/e2e')}`);
  }
} else {
  console.log(yellow('  ⚠ Could not find updated coverage data for this file.'));
}

console.log();
console.log(`  Interactive HTML report: ${cyan(path.join(RESULTS_DIR, 'index.html'))}`);
console.log();

process.exit(runSuccess ? 0 : 0); // don't propagate test failures – coverage diff is the outcome
