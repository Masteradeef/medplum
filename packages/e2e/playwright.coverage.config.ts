// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { defineCoverageReporterConfig } from '@bgotink/playwright-coverage';
import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repository root – used as `sourceRoot` so that istanbul paths look like
 * "packages/app/src/App.tsx" and resolve correctly from any working directory.
 */
const repoRoot = path.resolve(__dirname, '../..');

/**
 * Vite's dev-server maps source files using paths relative to the project root
 * (packages/app/).  The v8 coverage URLs coming from the browser will therefore
 * be absolute URLs such as:
 *
 *   http://localhost:3000/src/App.tsx        → packages/app/src/App.tsx
 *   http://localhost:3000/\@fs/…/core/src/…   → (skip – external package)
 *
 * The rewritePath hook normalises them so the reporter can find sources on disk.
 * @param root0 - The path object provided by the coverage reporter.
 * @param root0.absolutePath - The absolute path of the file as computed from the source map.
 * @param root0.relativePath - The relative path of the file as computed from the source map.
 * @returns The rewritten absolute path suitable for reading from disk.
 */
function rewritePath({ absolutePath }: { absolutePath: string; relativePath: string }): string {
  // Strip vite's @fs virtual prefix that appears for out-of-root files
  const fsStripped = absolutePath.replace(/.*\/@fs/, '');

  // If vite is serving a file directly from the app root (e.g. /src/App.tsx),
  // prepend the app package directory so the path resolves on disk.
  if (fsStripped.startsWith('/src/')) {
    return path.join(repoRoot, 'packages', 'app', fsStripped);
  }

  return fsStripped || absolutePath;
}

export default defineConfig({
  testDir: './coverage/tests',
  timeout: 45000,
  expect: { timeout: 8000 },

  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  reporter: [
    ['list'],
    [
      '@bgotink/playwright-coverage',
      defineCoverageReporterConfig({
        sourceRoot: repoRoot,
        /**
         * Only report coverage for app source files, not test helpers, node_modules
         * or generated artefacts.  Uses the `exclude` list only – `@bgotink/playwright-coverage`
         * v0.3.x does not expose an `include` option; instead we exclude everything
         * outside packages/app/src using the exclude glob.
         */
        exclude: [
          'packages/app/src/**/*.test.tsx',
          'packages/app/src/**/*.test.ts',
          'packages/app/src/test-utils/**',
          'packages/app/src/test.setup.ts',
          'packages/app/src/**/*.module.css',
        ],
        rewritePath,
        resultDir: path.join(__dirname, 'results/coverage'),
        reports: [
          // Interactive HTML drill-down
          ['html'],
          // Machine-readable summary consumed by coverage-gaps.mjs
          ['json-summary', { file: 'coverage-summary.json' }],
          // Full JSON (line-level detail) consumed by close-gap.mjs
          ['json', { file: 'coverage-detail.json' }],
          // LCOV for IDE integration
          ['lcovonly', { file: 'coverage.lcov' }],
          // Print totals to stdout after the run
          ['text-summary'],
        ],
        // Watermarks that determine red/yellow/green in the HTML report
        watermarks: {
          lines: [70, 80],
          functions: [60, 75],
          branches: [50, 65],
          statements: [70, 80],
        },
      }),
    ],
  ],

  projects: [
    {
      name: 'Chrome',
      use: { browserName: 'chromium' },
    },
  ],

  // Do not retry coverage runs – flaky retries would inflate coverage numbers
  retries: 0,
  workers: 1,
});
