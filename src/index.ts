#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { Octokit } from "@octokit/rest";

// Configuration
const CEPH_REPO_PATH = process.env.CEPH_REPO_PATH;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CEPH_OWNER = "ceph";
const CEPH_REPO = "ceph";
const MAX_SEARCH_RESULTS = 50;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_LINES_PER_FILE = 10000;

// Initialize Octokit for GitHub API access
const octokit = GITHUB_TOKEN
  ? new Octokit({ auth: GITHUB_TOKEN })
  : new Octokit(); // Works without auth but has lower rate limits

// Utility functions
function validateRepoPath(): void {
  if (!CEPH_REPO_PATH) {
    throw new Error(
      'CEPH_REPO_PATH environment variable is required for local repository tools. ' +
      'Please set it in your MCP settings configuration.'
    );
  }
  if (!fs.existsSync(CEPH_REPO_PATH)) {
    throw new Error(`Ceph repository not found at: ${CEPH_REPO_PATH}`);
  }
  if (!fs.existsSync(path.join(CEPH_REPO_PATH, ".git"))) {
    throw new Error(`Not a git repository: ${CEPH_REPO_PATH}`);
  }
}

function getRepoPath(): string {
  if (!CEPH_REPO_PATH) {
    throw new Error(
      'CEPH_REPO_PATH environment variable is required. ' +
      'Please set it in your MCP settings configuration.'
    );
  }
  return CEPH_REPO_PATH;
}

function executeGitCommand(args: string[]): string {
  try {
    return execSync(`git ${args.join(" ")}`, {
      cwd: getRepoPath(),
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    }).trim();
  } catch (error: any) {
    throw new Error(`Git command failed: ${error.message}`);
  }
}

function searchInFile(
  filePath: string,
  pattern: string,
  isRegex: boolean = false
): Array<{ line: number; content: string; context: string[] }> {
  const results: Array<{ line: number; content: string; context: string[] }> = [];
  const fullPath = path.join(getRepoPath(), filePath);

  if (!fs.existsSync(fullPath)) {
    return results;
  }

  const stats = fs.statSync(fullPath);
  if (stats.size > MAX_FILE_SIZE) {
    return results;
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");

  if (lines.length > MAX_LINES_PER_FILE) {
    return results;
  }

  const searchPattern: RegExp | string = isRegex ? new RegExp(pattern, "i") : pattern.toLowerCase();

  lines.forEach((line: string, index: number) => {
    const matches = isRegex
      ? (searchPattern as RegExp).test(line)
      : line.toLowerCase().includes(searchPattern as string);

    if (matches) {
      const contextStart = Math.max(0, index - 2);
      const contextEnd = Math.min(lines.length, index + 3);
      const context = lines.slice(contextStart, contextEnd);

      results.push({
        line: index + 1,
        content: line.trim(),
        context: context.map((l, i) => `${contextStart + i + 1}: ${l}`),
      });
    }
  });

  return results.slice(0, 20); // Limit results per file
}

function findSymbolDefinitions(symbol: string): Array<{
  file: string;
  line: number;
  type: string;
  context: string;
}> {
  const results: Array<{
    file: string;
    line: number;
    type: string;
    context: string;
  }> = [];

  // Search for function definitions
  const patterns = [
    `\\bdef\\s+${symbol}\\b`, // Python
    `\\b${symbol}\\s*\\(`, // C/C++ function
    `\\bclass\\s+${symbol}\\b`, // Class definition
    `\\bstruct\\s+${symbol}\\b`, // Struct definition
  ];

  try {
    const repoPath = getRepoPath();
    const grepCmd = patterns
      .map((p) => `grep -rn -E "${p}" --include="*.{cc,h,py,cpp,hpp}" ${repoPath}`)
      .join(" ; ");

    const output = execSync(grepCmd, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      cwd: repoPath,
    });

    const lines = output.split("\n").slice(0, MAX_SEARCH_RESULTS);

    lines.forEach((line) => {
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (match) {
        const [, file, lineNum, content] = match;
        const relPath = path.relative(repoPath, file);
        
        let type = "unknown";
        if (content.includes("def ")) type = "function";
        else if (content.includes("class ")) type = "class";
        else if (content.includes("struct ")) type = "struct";

        results.push({
          file: relPath,
          line: parseInt(lineNum),
          type,
          context: content.trim(),
        });
      }
    });
  } catch (error: any) {
    // grep returns non-zero if no matches found
    if (!error.message.includes("Command failed")) {
      throw error;
    }
  }

  return results;
}

function findSymbolReferences(symbol: string): Array<{
  file: string;
  line: number;
  context: string;
}> {
  const results: Array<{
    file: string;
    line: number;
    context: string;
  }> = [];

  const repoPath = getRepoPath();
  try {
    const output = execSync(
      `grep -rn "\\b${symbol}\\b" --include="*.{cc,h,py,cpp,hpp}" ${repoPath}`,
      {
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        cwd: repoPath,
      }
    );

    const lines = output.split("\n").slice(0, MAX_SEARCH_RESULTS);

    lines.forEach((line) => {
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (match) {
        const [, file, lineNum, content] = match;
        const relPath = path.relative(repoPath, file);

        results.push({
          file: relPath,
          line: parseInt(lineNum),
          context: content.trim(),
        });
      }
    });
  } catch (error: any) {
    if (!error.message.includes("Command failed")) {
      throw error;
    }
  }

  return results;
}

function readCodeFile(
  filePath: string,
  startLine?: number,
  endLine?: number
): { content: string; totalLines: number } {
  const fullPath = path.join(getRepoPath(), filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(fullPath);
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${filePath} (${stats.size} bytes)`);
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");

  if (lines.length > MAX_LINES_PER_FILE) {
    throw new Error(`File has too many lines: ${filePath} (${lines.length} lines)`);
  }

  if (startLine !== undefined && endLine !== undefined) {
    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, endLine);
    const selectedLines = lines.slice(start, end);
    return {
      content: selectedLines.map((l, i) => `${start + i + 1}: ${l}`).join("\n"),
      totalLines: lines.length,
    };
  }

  return {
    content: lines.map((l, i) => `${i + 1}: ${l}`).join("\n"),
    totalLines: lines.length,
  };
}

function traceCodeFlow(entryPoint: string, maxDepth: number = 3): any {
  const visited = new Set<string>();
  const flow: any = {
    entry: entryPoint,
    calls: [],
  };

  function analyzeFunction(funcName: string, depth: number): any {
    if (depth > maxDepth || visited.has(funcName)) {
      return null;
    }

    visited.add(funcName);

    const definitions = findSymbolDefinitions(funcName);
    if (definitions.length === 0) {
      return null;
    }

    const def = definitions[0];
    const node: any = {
      name: funcName,
      file: def.file,
      line: def.line,
      type: def.type,
      calls: [],
    };

    // Read the function body to find calls
    try {
      const fileContent = readCodeFile(def.file, def.line, def.line + 50);
      const callPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
      const calls = new Set<string>();

      let match;
      while ((match = callPattern.exec(fileContent.content)) !== null) {
        const calledFunc = match[1];
        if (calledFunc !== funcName && !visited.has(calledFunc)) {
          calls.add(calledFunc);
        }
      }

      // Recursively analyze called functions
      Array.from(calls)
        .slice(0, 5)
        .forEach((calledFunc) => {
          const childNode = analyzeFunction(calledFunc, depth + 1);
          if (childNode) {
            node.calls.push(childNode);
          }
        });
    } catch (error) {
      // Continue even if we can't read the file
    }

    return node;
  }

  const rootNode = analyzeFunction(entryPoint, 0);
  if (rootNode) {
    flow.calls.push(rootNode);
  }

  return flow;
}
// GitHub API helper functions
async function searchGitHubCode(query: string, filePattern?: string): Promise<any[]> {
  try {
    let searchQuery = `${query} repo:${CEPH_OWNER}/${CEPH_REPO}`;
    if (filePattern) {
      // Convert glob pattern to GitHub search syntax
      const extension = filePattern.replace('*.', '');
      searchQuery += ` extension:${extension}`;
    }

    const response = await octokit.search.code({
      q: searchQuery,
      per_page: Math.min(MAX_SEARCH_RESULTS, 100),
    });

    return response.data.items.map((item: any) => ({
      file: item.path,
      repository: item.repository.full_name,
      url: item.html_url,
      score: item.score,
    }));
  } catch (error: any) {
    throw new Error(`GitHub API error: ${error.message}`);
  }
}

async function getGitHubFileContent(filePath: string, ref: string = "main"): Promise<string> {
  try {
    const response = await octokit.repos.getContent({
      owner: CEPH_OWNER,
      repo: CEPH_REPO,
      path: filePath,
      ref,
    });

    if ("content" in response.data && response.data.content) {
      return Buffer.from(response.data.content, "base64").toString("utf-8");
    }
    throw new Error("File content not available");
  } catch (error: any) {
    throw new Error(`GitHub API error: ${error.message}`);
  }
}

async function getGitHubCommits(path: string = "", maxCount: number = 20): Promise<any[]> {
  try {
    const response = await octokit.repos.listCommits({
      owner: CEPH_OWNER,
      repo: CEPH_REPO,
      path: path || undefined,
      per_page: Math.min(maxCount, 100),
    });

    return response.data.map((commit: any) => ({
      hash: commit.sha,
      author: commit.commit.author.name,
      email: commit.commit.author.email,
      date: commit.commit.author.date,
      message: commit.commit.message,
      url: commit.html_url,
    }));
  } catch (error: any) {
    throw new Error(`GitHub API error: ${error.message}`);
  }
}

async function searchGitHubPullRequests(query: string, state: string = "all"): Promise<any[]> {
  try {
    const searchQuery = `${query} repo:${CEPH_OWNER}/${CEPH_REPO} is:pr`;
    
    const response = await octokit.search.issuesAndPullRequests({
      q: searchQuery,
      per_page: Math.min(MAX_SEARCH_RESULTS, 100),
      sort: "updated",
      order: "desc",
    });

    return response.data.items.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      author: pr.user.login,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      url: pr.html_url,
      body: pr.body?.substring(0, 500), // Limit body length
    }));
  } catch (error: any) {
    throw new Error(`GitHub API error: ${error.message}`);
  }
}


// Define tools
const tools: Tool[] = [
  {
    name: "search_ceph_code",
    description:
      "Search for code patterns, functions, classes, or any text in the Ceph distributed storage system codebase. Use this when the user asks about Ceph code, wants to find where something is implemented, or needs to locate specific code patterns. Supports both plain text and regex patterns. Returns file paths, line numbers, and surrounding code context.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The search pattern (text or regex)",
        },
        is_regex: {
          type: "boolean",
          description: "Whether the pattern is a regex (default: false)",
          default: false,
        },
        file_pattern: {
          type: "string",
          description: "Optional file pattern to filter (e.g., '*.py', '*.cc')",
        },
      },
      required: ["pattern"],
    },
  },
  {
    name: "read_ceph_file",
    description:
      "Read and display the contents of any source code file in the Ceph repository. Use this when the user wants to see the implementation of a specific file, examine code details, or read configuration files. Returns file contents with line numbers for easy reference.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Relative path to the file in the Ceph repository",
        },
        start_line: {
          type: "number",
          description: "Starting line number (optional)",
        },
        end_line: {
          type: "number",
          description: "Ending line number (optional)",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "find_symbol_definition",
    description:
      "Find where a function, class, method, or struct is defined in the Ceph codebase. Use this when the user asks 'where is X defined', 'show me the definition of X', or wants to understand how a specific component is implemented. Searches across Python, C, and C++ code. Returns exact file locations, line numbers, and code context.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "The symbol name to find (e.g., function or class name)",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "find_symbol_references",
    description:
      "Find all places where a function, class, or variable is used/called in the Ceph codebase. Use this when the user asks 'where is X used', 'what calls X', or wants to understand the impact of changing a component. Returns all usage locations with file paths, line numbers, and code context.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: {
          type: "string",
          description: "The symbol name to find references for",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "trace_code_flow",
    description:
      "Trace execution flow and function call chains in the Ceph codebase. Use this when the user asks 'how does X work', 'trace the execution of X', or wants to understand how a feature flows through the code. Analyzes function calls recursively and returns a call tree showing the execution path with file locations.",
    inputSchema: {
      type: "object",
      properties: {
        entry_point: {
          type: "string",
          description: "The function or method name to start tracing from",
        },
        max_depth: {
          type: "number",
          description: "Maximum depth to trace (default: 3, max: 5)",
          default: 3,
        },
      },
      required: ["entry_point"],
    },
  },
  {
    name: "list_ceph_files",
    description:
      "List and explore files and directories in the Ceph repository structure. Use this when the user wants to browse the codebase, see what files exist in a directory, or understand the project organization. Returns file names, types (file/directory), and sizes.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Relative directory path (default: root)",
          default: ".",
        },
        pattern: {
          type: "string",
          description: "Optional file pattern to filter (e.g., '*.py')",
        },
      },
    },
  },
  {
    name: "get_git_log",
    description:
      "Get git commit history and recent changes for files or directories in the Ceph repository. Use this when the user asks about recent changes, commit history, who modified something, or wants to see the development timeline. Returns commit hashes, authors, dates, and commit messages.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File or directory path (default: entire repo)",
          default: ".",
        },
        max_count: {
          type: "number",
          description: "Maximum number of commits to return (default: 20, max: 100)",
          default: 20,
        },
      },
    },
  },
  {
    name: "search_github_code",
    description:
      "Search for code, functions, or text patterns in the official global ceph/ceph GitHub repository (always up-to-date with latest changes). Use this when the user asks about Ceph code, wants to find implementations in the main repository, or needs to search the latest codebase. Returns file paths, GitHub URLs, and relevance scores.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'OSDMap', 'def handle_command')",
        },
        file_pattern: {
          type: "string",
          description: "Optional file extension filter (e.g., 'py', 'cc')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_github_file",
    description:
      "Read and display any file from the official global ceph/ceph GitHub repository. Use this when the user wants to see the latest version of a file, read source code from the main repository, or examine configuration files. Returns file contents with line numbers from the official Ceph repository.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file in the repository",
        },
        ref: {
          type: "string",
          description: "Branch or commit ref (default: 'main')",
          default: "main",
        },
      },
      required: ["file_path"],
    },
  },
  {
    name: "get_github_commits",
    description:
      "Get the latest commits and recent development activity from the official global ceph/ceph GitHub repository. Use this when the user asks 'what are the latest changes', 'recent commits', 'what's new in Ceph', or wants to see current development activity. Returns commit history with authors, dates, messages, and GitHub URLs.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional file or directory path to filter commits",
        },
        max_count: {
          type: "number",
          description: "Maximum number of commits (default: 20, max: 100)",
          default: 20,
        },
      },
    },
  },
  {
    name: "search_github_prs",
    description:
      "Search for and find pull requests in the official global ceph/ceph GitHub repository. Use this when the user asks about PRs, wants to find a specific feature implementation, asks 'what PR implements X', or needs to see proposed changes. Searches PR titles and descriptions. Returns PR numbers, titles, status, authors, and GitHub URLs.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for PR title or description",
        },
      },
      required: ["query"],
    },
  },
];

// Create server
const server = new Server(
  {
    name: "ceph-analyzer",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Validate repository on startup
try {
  validateRepoPath();
  console.error(`Ceph repository found at: ${CEPH_REPO_PATH}`);
} catch (error: any) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

// Handle tool list requests
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_ceph_code": {
        const { pattern, is_regex = false, file_pattern } = args as {
          pattern: string;
          is_regex?: boolean;
          file_pattern?: string;
        };

        const repoPath = getRepoPath();
        let grepCmd = `grep -rn ${is_regex ? "-E" : "-F"} "${pattern}"`;
        
        if (file_pattern) {
          grepCmd += ` --include="${file_pattern}"`;
        } else {
          grepCmd += ` --include="*.{cc,h,py,cpp,hpp,c}"`;
        }
        
        grepCmd += ` ${repoPath}`;

        try {
          const output = execSync(grepCmd, {
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
          });

          const lines = output.split("\n").slice(0, MAX_SEARCH_RESULTS);
          const results = lines
            .filter((line) => line.trim())
            .map((line) => {
              const match = line.match(/^(.+?):(\d+):(.+)$/);
              if (match) {
                const [, file, lineNum, content] = match;
                return {
                  file: path.relative(repoPath, file),
                  line: parseInt(lineNum),
                  content: content.trim(),
                };
              }
              return null;
            })
            .filter((r) => r !== null);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    pattern,
                    is_regex,
                    total_results: results.length,
                    results,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error: any) {
          if (error.message.includes("Command failed")) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ pattern, results: [] }, null, 2),
                },
              ],
            };
          }
          throw error;
        }
      }

      case "read_ceph_file": {
        const { file_path, start_line, end_line } = args as {
          file_path: string;
          start_line?: number;
          end_line?: number;
        };

        const result = readCodeFile(file_path, start_line, end_line);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  file: file_path,
                  total_lines: result.totalLines,
                  content: result.content,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "find_symbol_definition": {
        const { symbol } = args as { symbol: string };
        const results = findSymbolDefinitions(symbol);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  symbol,
                  total_results: results.length,
                  definitions: results,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "find_symbol_references": {
        const { symbol } = args as { symbol: string };
        const results = findSymbolReferences(symbol);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  symbol,
                  total_results: results.length,
                  references: results,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "trace_code_flow": {
        const { entry_point, max_depth = 3 } = args as {
          entry_point: string;
          max_depth?: number;
        };

        const depth = Math.min(max_depth, 5);
        const flow = traceCodeFlow(entry_point, depth);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  entry_point,
                  max_depth: depth,
                  flow,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "list_ceph_files": {
        const { directory = ".", pattern } = args as {
          directory?: string;
          pattern?: string;
        };

        const dirPath = path.join(getRepoPath(), directory);
        
        if (!fs.existsSync(dirPath)) {
          throw new Error(`Directory not found: ${directory}`);
        }

        let files = fs.readdirSync(dirPath);
        
        if (pattern) {
          const regex = new RegExp(pattern.replace(/\*/g, ".*"));
          files = files.filter((f) => regex.test(f));
        }

        const fileInfo = files.slice(0, 200).map((file) => {
          const fullPath = path.join(dirPath, file);
          const stats = fs.statSync(fullPath);
          return {
            name: file,
            type: stats.isDirectory() ? "directory" : "file",
            size: stats.isFile() ? stats.size : undefined,
          };
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  directory,
                  total_items: fileInfo.length,
                  items: fileInfo,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_git_log": {
        const { path: gitPath = ".", max_count = 20 } = args as {
          path?: string;
          max_count?: number;
        };

        const count = Math.min(max_count, 100);
        const formatString = "--pretty=format:%H|%an|%ae|%ad|%s";
        const output = execSync(
          `git log --max-count=${count} "${formatString}" --date=iso -- "${gitPath}"`,
          {
            cwd: CEPH_REPO_PATH,
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
          }
        ).trim();

        const commits = output.split("\n").map((line) => {
          const [hash, author, email, date, message] = line.split("|");
          return { hash, author, email, date, message };
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  path: gitPath,
                  total_commits: commits.length,
                  commits,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "search_github_code": {
        const { query, file_pattern } = args as {
          query: string;
          file_pattern?: string;
        };

        const results = await searchGitHubCode(query, file_pattern);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query,
                  file_pattern,
                  total_results: results.length,
                  results,
                  note: "Results from global ceph/ceph repository on GitHub",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_github_file": {
        const { file_path, ref = "main" } = args as {
          file_path: string;
          ref?: string;
        };

        const content = await getGitHubFileContent(file_path, ref);
        const lines = content.split("\n");
        const numberedContent = lines.map((l, i) => `${i + 1}: ${l}`).join("\n");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  file: file_path,
                  ref,
                  total_lines: lines.length,
                  content: numberedContent,
                  repository: `${CEPH_OWNER}/${CEPH_REPO}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_github_commits": {
        const { path: commitPath = "", max_count = 20 } = args as {
          path?: string;
          max_count?: number;
        };

        const commits = await getGitHubCommits(commitPath, max_count);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  path: commitPath || "entire repository",
                  total_commits: commits.length,
                  commits,
                  repository: `${CEPH_OWNER}/${CEPH_REPO}`,
                  note: "Commits from global ceph/ceph repository on GitHub",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "search_github_prs": {
        const { query } = args as { query: string };

        const prs = await searchGitHubPullRequests(query);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  query,
                  total_results: prs.length,
                  pull_requests: prs,
                  repository: `${CEPH_OWNER}/${CEPH_REPO}`,
                  note: "Pull requests from global ceph/ceph repository on GitHub",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Ceph Analyzer MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// Made with Bob
