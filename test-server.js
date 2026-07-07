#!/usr/bin/env node

/**
 * Test script for Ceph Analyzer MCP Server
 * 
 * This script tests all the tools provided by the MCP server to ensure
 * they work correctly with both local repository and GitHub API access.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for output
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

function logTest(testName) {
  log(`\n${'='.repeat(60)}`, colors.cyan);
  log(`Testing: ${testName}`, colors.cyan);
  log('='.repeat(60), colors.cyan);
}

function logSuccess(message) {
  log(`✓ ${message}`, colors.green);
}

function logError(message) {
  log(`✗ ${message}`, colors.red);
}

function logInfo(message) {
  log(`ℹ ${message}`, colors.blue);
}

// Test configuration
const tests = [
  {
    name: 'List Ceph Files (Local)',
    tool: 'list_ceph_files',
    args: { directory: 'src', pattern: '*.cc' },
    validate: (result) => {
      return result.directory === 'src' && 
             result.items && 
             Array.isArray(result.items);
    }
  },
  {
    name: 'Search Ceph Code (Local)',
    tool: 'search_ceph_code',
    args: { pattern: 'OSDMap', file_pattern: '*.cc' },
    validate: (result) => {
      return result.pattern === 'OSDMap' && 
             result.results && 
             Array.isArray(result.results);
    }
  },
  {
    name: 'Get Git Log (Local)',
    tool: 'get_git_log',
    args: { max_count: 5 },
    validate: (result) => {
      return result.commits && 
             Array.isArray(result.commits) && 
             result.commits.length > 0;
    }
  },
  {
    name: 'Search GitHub Code',
    tool: 'search_github_code',
    args: { query: 'OSDMap', file_pattern: 'cc' },
    validate: (result) => {
      return result.query === 'OSDMap' && 
             result.results && 
             Array.isArray(result.results) &&
             result.note && 
             result.note.includes('global ceph/ceph');
    }
  },
  {
    name: 'Get GitHub Commits',
    tool: 'get_github_commits',
    args: { max_count: 5 },
    validate: (result) => {
      return result.commits && 
             Array.isArray(result.commits) && 
             result.commits.length > 0 &&
             result.repository === 'ceph/ceph' &&
             result.note && 
             result.note.includes('global ceph/ceph');
    }
  },
  {
    name: 'Search GitHub Pull Requests',
    tool: 'search_github_prs',
    args: { query: 'audit' },
    validate: (result) => {
      return result.query === 'audit' && 
             result.pull_requests && 
             Array.isArray(result.pull_requests) &&
             result.repository === 'ceph/ceph';
    }
  },
  {
    name: 'Get GitHub File',
    tool: 'get_github_file',
    args: { file_path: 'README.md', ref: 'main' },
    validate: (result) => {
      return result.file === 'README.md' && 
             result.content && 
             result.repository === 'ceph/ceph';
    }
  },
];

async function sendRequest(serverProcess, tool, args) {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: tool,
        arguments: args
      }
    };

    let responseData = '';
    let errorData = '';

    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 30000); // 30 second timeout

    const dataHandler = (data) => {
      responseData += data.toString();
      
      // Try to parse complete JSON responses
      const lines = responseData.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              clearTimeout(timeout);
              serverProcess.stdout.removeListener('data', dataHandler);
              serverProcess.stderr.removeListener('data', errorHandler);
              resolve(response);
              return;
            }
          } catch (e) {
            // Not a complete JSON yet, continue accumulating
          }
        }
      }
    };

    const errorHandler = (data) => {
      errorData += data.toString();
    };

    serverProcess.stdout.on('data', dataHandler);
    serverProcess.stderr.on('data', errorHandler);

    // Send the request
    serverProcess.stdin.write(JSON.stringify(request) + '\n');
  });
}

async function runTests() {
  log('\n' + '='.repeat(60), colors.yellow);
  log('Ceph Analyzer MCP Server Test Suite', colors.yellow);
  log('='.repeat(60) + '\n', colors.yellow);

  // Start the MCP server
  logInfo('Starting MCP server...');
  const serverPath = join(__dirname, 'build', 'index.js');
  
  // Check if CEPH_REPO_PATH is set
  if (!process.env.CEPH_REPO_PATH) {
    logError('CEPH_REPO_PATH environment variable is not set!');
    logInfo('Please set it before running tests:');
    logInfo('  export CEPH_REPO_PATH=/path/to/your/ceph/repository');
    logInfo('  node test-server.js');
    process.exit(1);
  }
  
  const serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      CEPH_REPO_PATH: process.env.CEPH_REPO_PATH
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  let passedTests = 0;
  let failedTests = 0;

  // Run each test
  for (const test of tests) {
    logTest(test.name);
    
    try {
      logInfo(`Calling tool: ${test.tool}`);
      logInfo(`Arguments: ${JSON.stringify(test.args, null, 2)}`);
      
      const response = await sendRequest(serverProcess, test.tool, test.args);
      
      if (response.error) {
        logError(`Server returned error: ${response.error.message}`);
        failedTests++;
        continue;
      }

      if (!response.result || !response.result.content) {
        logError('Invalid response format');
        failedTests++;
        continue;
      }

      // Parse the result
      const resultText = response.result.content[0].text;
      const result = JSON.parse(resultText);
      
      // Validate the result
      if (test.validate(result)) {
        logSuccess('Test passed!');
        logInfo(`Result summary: ${JSON.stringify(result, null, 2).substring(0, 200)}...`);
        passedTests++;
      } else {
        logError('Validation failed');
        logInfo(`Result: ${JSON.stringify(result, null, 2)}`);
        failedTests++;
      }
    } catch (error) {
      logError(`Test failed with error: ${error.message}`);
      failedTests++;
    }
  }

  // Cleanup
  serverProcess.kill();

  // Summary
  log('\n' + '='.repeat(60), colors.yellow);
  log('Test Summary', colors.yellow);
  log('='.repeat(60), colors.yellow);
  log(`Total tests: ${tests.length}`);
  logSuccess(`Passed: ${passedTests}`);
  if (failedTests > 0) {
    logError(`Failed: ${failedTests}`);
  }
  log('='.repeat(60) + '\n', colors.yellow);

  process.exit(failedTests > 0 ? 1 : 0);
}

// Run the tests
runTests().catch(error => {
  logError(`Fatal error: ${error.message}`);
  process.exit(1);
});

// Made with Bob
