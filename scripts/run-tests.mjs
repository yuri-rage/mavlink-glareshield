// Discovers and runs every tests/*.test.ts file in parallel using local tsx.
// Usage: node scripts/run-tests.mjs [filter...]

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');
const tsxBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

// Known slower suites scheduled first so they don't extend the tail of the pool.
const SLOW_FIRST = [
  'ftp_ardupilot.test.ts',
  'logs.test.ts',
  'homeCache.test.ts',
  'paramCatalog.test.ts',
  'transport.test.ts',
  'voiceEngine.test.ts',
];

const slowRank = new Map(SLOW_FIRST.map((name, i) => [name, i]));

const allFiles = readdirSync(testsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
  .map((entry) => entry.name)
  .sort((a, b) => {
    const ra = slowRank.get(a);
    const rb = slowRank.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.localeCompare(b);
  });

const filters = process.argv.slice(2).map((arg) => arg.toLowerCase());
const files = filters.length
  ? allFiles.filter((name) => {
      const rel = `tests/${name}`.toLowerCase();
      const base = name.toLowerCase();
      return filters.some((f) => rel.includes(f) || base.includes(f));
    })
  : allFiles;

if (files.length === 0) {
  console.error(`No test files matched filter(s): ${process.argv.slice(2).join(', ')}`);
  process.exit(1);
}

const detectedCpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const requestedJobs = Number(process.env.TEST_JOBS);
const jobs = Math.max(1, Math.min(files.length, Number.isFinite(requestedJobs) && requestedJobs > 0 ? Math.floor(requestedJobs) : detectedCpus || 4));

function runOne(name) {
  return new Promise((resolve) => {
    const relPath = `tests/${name}`;
    const started = performance.now();
    const child = spawn(tsxBin, [relPath], {
      cwd: root,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      const elapsedSec = ((performance.now() - started) / 1000).toFixed(2);
      resolve({
        name,
        relPath,
        code: 1,
        elapsedSec,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: `${Buffer.concat(stderrChunks).toString('utf8')}\n${err.stack || err.message}`.trim(),
      });
    });

    child.on('close', (code, signal) => {
      const elapsedSec = ((performance.now() - started) / 1000).toFixed(2);
      const exitCode = code ?? (signal ? 1 : 0);
      resolve({
        name,
        relPath,
        code: exitCode,
        signal,
        elapsedSec,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

const suiteStart = performance.now();
let nextIndex = 0;
const results = new Array(files.length);

async function worker() {
  while (true) {
    const idx = nextIndex++;
    if (idx >= files.length) return;
    const res = await runOne(files[idx]);
    results[idx] = res;
    if (res.code === 0) {
      console.log(`PASS  ${res.relPath}  (${res.elapsedSec}s)`);
    } else {
      const reason = res.signal ? `signal ${res.signal}` : `exit ${res.code}`;
      console.log(`FAIL  ${res.relPath}  (${res.elapsedSec}s)  (${reason})`);
    }
  }
}

await Promise.all(Array.from({ length: jobs }, () => worker()));

const totalSec = ((performance.now() - suiteStart) / 1000).toFixed(2);
const failed = results.filter((r) => r.code !== 0);
const passed = results.length - failed.length;

if (failed.length > 0) {
  console.error('\n--- Failed test output ---');
  for (const res of failed) {
    console.error(`\n=== ${res.relPath} (exit ${res.code}) ===`);
    if (res.stdout.trim()) {
      console.error('stdout:');
      console.error(res.stdout.trimEnd());
    }
    if (res.stderr.trim()) {
      console.error('stderr:');
      console.error(res.stderr.trimEnd());
    }
  }
}

console.log(`\n${passed}/${results.length} test files passed in ${totalSec}s (${jobs} workers)`);
process.exit(failed.length > 0 ? 1 : 0);
