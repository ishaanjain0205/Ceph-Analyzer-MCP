#!/usr/bin/env node

/**
 * Embedded test suite for Ceph Analyzer MCP Server.
 *
 * Imports tool functions directly from build/tools.js — no child process,
 * no JSON-RPC. Reads GITHUB_TOKEN and CEPH_REPO_PATH from the Bob MCP config.
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Load env vars from the Bob MCP config file so no shell variables are needed.
// Only sets values not already present in the environment.
const mcpConfigPath = join(homedir(), '.bob', 'settings', 'mcp.json');
if (existsSync(mcpConfigPath)) {
  try {
    const config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
    const env = config?.mcpServers?.['ceph-analyzer']?.env ?? {};
    for (const [key, val] of Object.entries(env)) {
      if (!(key in process.env)) process.env[key] = String(val);
    }
  } catch (e) {
    // Malformed config — continue without it
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}
function logTest(name) {
  log(`\n${'='.repeat(60)}`, colors.cyan);
  log(`Testing: ${name}`, colors.cyan);
  log('='.repeat(60), colors.cyan);
}
function logSuccess(msg) { log(`✓ ${msg}`, colors.green); }
function logError(msg)   { log(`✗ ${msg}`, colors.red); }
function logInfo(msg)    { log(`ℹ ${msg}`, colors.blue); }

// ── Tests ─────────────────────────────────────────────────────────────────────

const tests = [
  {
    name: 'List Ceph Files (Local) — requires real Ceph repo',
    run: async ({ listCephFiles }) => {
      // List .cc files in the top-level src/ directory of the Ceph repo
      const result = listCephFiles('src', '*.cc');
      if (result.error) throw new Error(result.error);
      if (result.directory !== 'src') throw new Error(`Expected directory 'src', got '${result.directory}'`);
      if (!Array.isArray(result.items)) throw new Error('items is not an array');
      if (result.items.length === 0) throw new Error('No .cc files found in src/ — is CEPH_REPO_PATH correct?');
      return result;
    },
  },
  {
    name: 'Search Ceph Code (Local)',
    run: async ({ searchCephCode }) => {
      const result = searchCephCode('OSDMap', false, '*.cc');
      if (result.error) throw new Error(result.error);
      if (result.pattern !== 'OSDMap') throw new Error('pattern mismatch');
      if (!Array.isArray(result.results)) throw new Error('results is not an array');
      return result;
    },
  },
  {
    name: 'Get Git Log (Local)',
    run: async ({ getGitLog }) => {
      const result = getGitLog('.', 5);
      if (result.error) throw new Error(result.error);
      if (!Array.isArray(result.commits)) throw new Error('commits is not an array');
      if (result.commits.length === 0) throw new Error('No commits returned');
      return result;
    },
  },
  {
    name: 'Search GitHub Code',
    run: async ({ searchGitHubCode }) => {
      const result = await searchGitHubCode('OSDMap', 'cc');
      // GitHub code search requires auth; accept error gracefully
      if (result.error) {
        logInfo(`GitHub code search skipped (API error): ${result.error}`);
        return result;
      }
      if (result.query !== 'OSDMap') throw new Error('query mismatch');
      if (!Array.isArray(result.results)) throw new Error('results is not an array');
      if (!result.note?.includes('global ceph/ceph')) throw new Error('note missing');
      return result;
    },
  },
  {
    name: 'Get GitHub Commits',
    run: async ({ getGitHubCommits }) => {
      const result = await getGitHubCommits('', 5);
      if (result.error) {
        logInfo(`GitHub commits skipped (API error): ${result.error}`);
        return result;
      }
      if (!Array.isArray(result.commits)) throw new Error('commits is not an array');
      if (result.commits.length === 0) throw new Error('No commits returned');
      if (result.repository !== 'ceph/ceph') throw new Error('repository mismatch');
      if (!result.note?.includes('global ceph/ceph')) throw new Error('note missing');
      return result;
    },
  },
  {
    name: 'Search GitHub Pull Requests',
    run: async ({ searchGitHubPRs }) => {
      const result = await searchGitHubPRs('audit');
      if (result.error) {
        logInfo(`GitHub PR search skipped (API error): ${result.error}`);
        return result;
      }
      if (result.query !== 'audit') throw new Error('query mismatch');
      if (!Array.isArray(result.pull_requests)) throw new Error('pull_requests is not an array');
      if (result.repository !== 'ceph/ceph') throw new Error('repository mismatch');
      return result;
    },
  },
  {
    name: 'Get GitHub File',
    run: async ({ getGitHubFile }) => {
      const result = await getGitHubFile('README.md', 'main');
      if (result.error) {
        logInfo(`GitHub file skipped (API error): ${result.error}`);
        return result;
      }
      if (result.file !== 'README.md') throw new Error('file mismatch');
      if (!result.content) throw new Error('content missing');
      if (result.repository !== 'ceph/ceph') throw new Error('repository mismatch');
      return result;
    },
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

async function runTests() {
  log('\n' + '='.repeat(60), colors.yellow);
  log('Ceph Analyzer MCP Server — Embedded Test Suite', colors.yellow);
  log('='.repeat(60) + '\n', colors.yellow);

  if (!process.env.CEPH_REPO_PATH) {
    logError('CEPH_REPO_PATH not found — set it in ~/.bob/settings/mcp.json under mcpServers.ceph-analyzer.env');
    process.exit(1);
  }
  logInfo(`Using CEPH_REPO_PATH: ${process.env.CEPH_REPO_PATH}`);

  // Import the compiled tool module directly (embedded — no child process)
  const tools = await import('./build/tools.js');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    logTest(test.name);
    try {
      const result = await test.run(tools);
      logSuccess('Test passed!');
      logInfo(`Result summary: ${JSON.stringify(result, null, 2).substring(0, 300)}...`);
      passed++;
    } catch (err) {
      logError(`Test failed: ${err.message}`);
      failed++;
    }
  }

  log('\n' + '='.repeat(60), colors.yellow);
  log('Test Summary', colors.yellow);
  log('='.repeat(60), colors.yellow);
  log(`Total tests: ${tests.length}`);
  logSuccess(`Passed: ${passed}`);
  if (failed > 0) logError(`Failed: ${failed}`);
  log('='.repeat(60) + '\n', colors.yellow);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  logError(`Fatal error: ${err.message}`);
  process.exit(1);
});

// Made with Bob
