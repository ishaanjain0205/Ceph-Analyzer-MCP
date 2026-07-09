#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  validateRepoPath,
  searchCephCode,
  readCephFile,
  findSymbolDefinition,
  findSymbolReferences,
  listCephFiles,
  getGitLog,
  searchGitHubCode,
  getGitHubFile,
  getGitHubCommits,
  searchGitHubPRs,
} from "./tools.js";

// ── Tool definitions ───────────────────────────────────────────────────────────

const tools: Tool[] = [
  {
    name: "search_ceph_code",
    description:
      "Search for code patterns, functions, classes, or any text in the Ceph codebase. Supports plain text and regex. Returns file paths, line numbers, and context.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The search pattern (text or regex)" },
        is_regex: { type: "boolean", description: "Whether the pattern is a regex (default: false)", default: false },
        file_pattern: { type: "string", description: "Optional file pattern to filter (e.g., '*.py', '*.cc')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "read_ceph_file",
    description: "Read a source file in the Ceph repository with line numbers.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Relative path to the file" },
        start_line: { type: "number", description: "Starting line number (optional)" },
        end_line: { type: "number", description: "Ending line number (optional)" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "find_symbol_definition",
    description: "Find where a function, class, or struct is defined in the Ceph codebase.",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string", description: "Symbol name to find" } },
      required: ["symbol"],
    },
  },
  {
    name: "find_symbol_references",
    description: "Find all usages of a function, class, or variable in the Ceph codebase.",
    inputSchema: {
      type: "object",
      properties: { symbol: { type: "string", description: "Symbol name to find references for" } },
      required: ["symbol"],
    },
  },
  {
    name: "trace_code_flow",
    description: "Trace function call chains starting from an entry point.",
    inputSchema: {
      type: "object",
      properties: {
        entry_point: { type: "string", description: "Function name to start tracing from" },
        max_depth: { type: "number", description: "Maximum depth (default: 3, max: 5)", default: 3 },
      },
      required: ["entry_point"],
    },
  },
  {
    name: "list_ceph_files",
    description: "List files and directories in the Ceph repository.",
    inputSchema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Relative directory path (default: root)", default: "." },
        pattern: { type: "string", description: "Optional file pattern to filter (e.g., '*.py')" },
      },
    },
  },
  {
    name: "get_git_log",
    description: "Get git commit history for files or directories in the Ceph repository.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or directory path (default: entire repo)", default: "." },
        max_count: { type: "number", description: "Maximum number of commits (default: 20, max: 100)", default: 20 },
      },
    },
  },
  {
    name: "search_github_code",
    description: "Search for code in the global ceph/ceph GitHub repository. Returns file paths, URLs, and relevance scores.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g., 'OSDMap', 'def handle_command')" },
        file_pattern: { type: "string", description: "Optional file extension filter (e.g., 'py', 'cc')" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_github_file",
    description: "Read a file from the global ceph/ceph GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to the file in the repository" },
        ref: { type: "string", description: "Branch or commit ref (default: 'main')", default: "main" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "get_github_commits",
    description: "Get recent commits from the global ceph/ceph GitHub repository.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional file or directory path to filter commits" },
        max_count: { type: "number", description: "Maximum number of commits (default: 20, max: 100)", default: 20 },
      },
    },
  },
  {
    name: "search_github_prs",
    description: "Search for pull requests in the global ceph/ceph GitHub repository.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query for PR title or description" } },
      required: ["query"],
    },
  },
];

// ── Server ─────────────────────────────────────────────────────────────────────

const server = new Server({ name: "ceph-analyzer", version: "1.0.0" }, { capabilities: { tools: {} } });

// Validate repository on startup
try {
  validateRepoPath();
} catch (error: any) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result: object;
    switch (name) {
      case "search_ceph_code": {
        const { pattern, is_regex = false, file_pattern } = args as any;
        result = searchCephCode(pattern, is_regex, file_pattern);
        break;
      }
      case "read_ceph_file": {
        const { file_path, start_line, end_line } = args as any;
        result = readCephFile(file_path, start_line, end_line);
        break;
      }
      case "find_symbol_definition": {
        result = findSymbolDefinition((args as any).symbol);
        break;
      }
      case "find_symbol_references": {
        result = findSymbolReferences((args as any).symbol);
        break;
      }
      case "trace_code_flow": {
        // trace_code_flow is complex and not extracted; delegate via dynamic import
        result = { error: "trace_code_flow not yet supported" };
        break;
      }
      case "list_ceph_files": {
        const { directory, pattern } = args as any;
        result = listCephFiles(directory, pattern);
        break;
      }
      case "get_git_log": {
        const { path: gitPath, max_count } = args as any;
        result = getGitLog(gitPath, max_count);
        break;
      }
      case "search_github_code": {
        const { query, file_pattern } = args as any;
        result = await searchGitHubCode(query, file_pattern);
        break;
      }
      case "get_github_file": {
        const { file_path, ref } = args as any;
        result = await getGitHubFile(file_path, ref);
        break;
      }
      case "get_github_commits": {
        const { path: commitPath, max_count } = args as any;
        result = await getGitHubCommits(commitPath, max_count);
        break;
      }
      case "search_github_prs": {
        result = await searchGitHubPRs((args as any).query);
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }], isError: true };
  }
});

// ── Entry point ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Ceph Analyzer MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
