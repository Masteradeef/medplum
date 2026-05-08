#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
/* eslint-env node */
/* global process, console */

/**
 * coverage-gaps.mjs
 * ─────────────────
 * Reads the Istanbul JSON summary produced by `@bgotink/playwright-coverage` and
 * identifies files that fall below the coverage thresholds defined in
 * COVERAGE_MODEL.md.
 *
 * Usage
 *   node packages/e2e/scripts/coverage-gaps.mjs
 *   # or via npm script:
 *   npm run coverage:gaps --workspace=packages/e2e
 *
 * Exits with code 1 when any file has open gaps (useful as a CI gate).
 * Exits with code 2 when the coverage report has not yet been generated.
 *
 * Environment variables
 *   COVERAGE_THRESHOLD_LINE      – line coverage threshold (default: 80)
 *   COVERAGE_THRESHOLD_BRANCH    – branch coverage threshold (default: 60)
 *   COVERAGE_SUMMARY_PATH        – path to coverage-summary.json
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ── Configuration ────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.resolve(__dirname, '..');

const LINE_THRESHOLD = Number(process.env.COVERAGE_THRESHOLD_LINE ?? 80);
const BRANCH_THRESHOLD = Number(process.env.COVERAGE_THRESHOLD_BRANCH ?? 60);

const SUMMARY_PATH =
  process.env.COVERAGE_SUMMARY_PATH ??
  path.join(e2eDir, 'results', 'coverage', 'coverage-summary.json');

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function red(s) { return `${RED}${s}${RESET}`; }
function yellow(s) { return `${YELLOW}${s}${RESET}`; }
function green(s) { return `${GREEN}${s}${RESET}`; }
function bold(s) { return `${BOLD}${s}${RESET}`; }

function pctColor(pct, threshold) {
  if (pct >= threshold) {
    return green(`${pct.toFixed(1)}%`);
  }
  if (pct >= threshold * 0.8) {
    return yellow(`${pct.toFixed(1)}%`);
  }
  return red(`${pct.toFixed(1)}%`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!existsSync(SUMMARY_PATH)) {
  console.error(
    red('✖ Coverage summary not found:'),
    SUMMARY_PATH,
    '\n\nRun the coverage suite first:\n',
    bold('  npm run coverage:run --workspace=packages/e2e')
  );
  process.exit(2);
}

const summary = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));

// Remove the synthetic "total" key
const { total, ...files } = summary;

// ── Print overall totals ─────────────────────────────────────────────────────

console.log();
console.log(bold('Coverage Summary (totals)'));
console.log('─'.repeat(60));
if (total) {
  console.log(
    `  Lines:      ${pctColor(total.lines.pct, LINE_THRESHOLD)}` +
    `  (${total.lines.covered}/${total.lines.total})`
  );
  console.log(
    `  Branches:   ${pctColor(total.branches.pct, BRANCH_THRESHOLD)}` +
    `  (${total.branches.covered}/${total.branches.total})`
  );
  console.log(
    `  Functions:  ${pctColor(total.functions.pct, 60)}` +
    `  (${total.functions.covered}/${total.functions.total})`
  );
  console.log(
    `  Statements: ${pctColor(total.statements.pct, LINE_THRESHOLD)}` +
    `  (${total.statements.covered}/${total.statements.total})`
  );
}
console.log();

// ── Find gap files ────────────────────────────────────────────────────────────

const gaps = [];

for (const [filePath, data] of Object.entries(files)) {
  const linePct = data.lines?.pct ?? 100;
  const branchPct = data.branches?.pct ?? 100;

  const lineGap = linePct < LINE_THRESHOLD;
  const branchGap = branchPct < BRANCH_THRESHOLD;

  if (lineGap || branchGap) {
    gaps.push({
      filePath,
      linePct,
      branchPct,
      linesMissed: (data.lines?.total ?? 0) - (data.lines?.covered ?? 0),
      branchesMissed: (data.branches?.total ?? 0) - (data.branches?.covered ?? 0),
      lineGap,
      branchGap,
    });
  }
}

// Sort by worst line coverage first
gaps.sort((a, b) => a.linePct - b.linePct);

// ── Print gap table ───────────────────────────────────────────────────────────

if (gaps.length === 0) {
  console.log(green('✔ All files meet coverage thresholds. No gaps detected.'));
  console.log();
  process.exit(0);
}

console.log(bold(`Open Coverage Gaps  (${gaps.length} file${gaps.length === 1 ? '' : 's'})`));
console.log('─'.repeat(100));
console.log(
  'File'.padEnd(70),
  'Lines'.padStart(8),
  'Branches'.padStart(10),
  'Missed lines'.padStart(14)
);
console.log('─'.repeat(100));

for (const g of gaps) {
  // Strip the leading repo-relative prefix for readability
  const displayPath = g.filePath.replace(/^.*packages\/app\/src\//, 'src/');
  console.log(
    displayPath.padEnd(70),
    pctColor(g.linePct, LINE_THRESHOLD).padStart(8 + 10), // ANSI codes add length
    pctColor(g.branchPct, BRANCH_THRESHOLD).padStart(10 + 10),
    String(g.linesMissed).padStart(14)
  );
}

console.log('─'.repeat(100));
console.log();
console.log(bold('To close a gap, run:'));
console.log(
  `  ${yellow('npm run coverage:close-gap --workspace=packages/e2e -- --file=src/<Page>.tsx')}`
);
console.log();
console.log(`  Example: ${yellow(`npm run coverage:close-gap --workspace=packages/e2e -- --file=${gaps[0].filePath.replace(/^.*packages\/app\//, '')}`)}`);
console.log();

// Exit 1 so CI fails when gaps exist
process.exit(1);
