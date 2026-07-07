# Ceph Analyzer MCP Server

A comprehensive Model Context Protocol (MCP) server for analyzing the Ceph distributed storage system's codebase. This server provides dual-mode access: local repository analysis for fast, detailed code exploration, and GitHub API integration for accessing the global `ceph/ceph` repository.

## Features

### Dual-Mode Operation

**Local Repository Analysis** (Fast, Offline)
- Deep code search with regex support
- Symbol definition and reference tracking
- Code flow tracing
- Git history analysis
- File system exploration

**GitHub API Integration** (Always Up-to-Date)
- Search code in global ceph/ceph repository
- Read files directly from GitHub
- Access latest commit history
- Search and analyze pull requests

### Available Tools

#### Local Repository Tools

1. **search_ceph_code** - Search for code patterns in local repository
   - Supports both plain text and regex patterns
   - Returns file paths, line numbers, and context
   - Configurable file pattern filtering (e.g., `*.py`, `*.cc`)

2. **read_ceph_file** - Read file contents with line numbers
   - Optionally specify line ranges for large files
   - Enforces reasonable file size limits (1MB max)

3. **find_symbol_definition** - Find where symbols are defined
   - Searches for functions, classes, and structs
   - Returns file paths, line numbers, and context
   - Supports Python, C, and C++ code

4. **find_symbol_references** - Find all references to a symbol
   - Locates all uses of a function, class, or variable
   - Returns file paths, line numbers, and context

5. **trace_code_flow** - Trace execution flow through the code
   - Analyzes function calls starting from an entry point
   - Returns a call tree with configurable depth (max 5 levels)
   - Helps understand how features flow through the codebase

6. **list_ceph_files** - List files in a directory
   - Explore the codebase structure
   - Optional pattern filtering
   - Returns file/directory information

7. **get_git_log** - Get git commit history from local repository
   - View commit history for files or directories
   - Returns commit hashes, authors, dates, and messages
   - Configurable result count (max 100)

#### GitHub API Tools

8. **search_github_code** - Search code in global ceph/ceph repository
   - Returns file paths, URLs, and relevance scores
   - Supports file extension filtering

9. **get_github_file** - Read files from GitHub
   - Access any file from the ceph/ceph repository
   - Specify branch or commit ref
   - Returns content with line numbers

10. **get_github_commits** - Get commit history from GitHub
    - Access latest commits from global repository
    - Filter by file or directory path
    - Returns commit details with URLs

11. **search_github_prs** - Search pull requests
    - Find PRs by title or description
    - Returns PR details, status, and URLs
    - Sorted by most recently updated

## Installation

### Prerequisites

- Node.js 16 or higher
- TypeScript 5 or higher
- Git installed and available in PATH
- (Optional) Local Ceph repository clone for local analysis features
- (Optional) GitHub personal access token for higher API rate limits

### Platform Compatibility

**✅ Fully Supported (Windows, macOS, Linux):**
- All GitHub API tools (search_github_code, get_github_file, get_github_commits, search_github_prs)
- File reading (read_ceph_file)
- Directory listing (list_ceph_files)
- Git history (get_git_log)

**⚠️ Unix/Linux/macOS Only:**
- Local code search (search_ceph_code) - requires `grep`
- Symbol finding (find_symbol_definition, find_symbol_references) - requires `grep`
- Code flow tracing (trace_code_flow) - depends on symbol finding

**Windows Users:**
- All GitHub API features work perfectly on Windows
- For local repository tools, install [Git for Windows](https://git-scm.com/download/win) (includes Git Bash with `grep`) or [WSL](https://docs.microsoft.com/en-us/windows/wsl/install)
- Alternatively, use only the GitHub API tools which provide full access to the global ceph/ceph repository

### Setup

1. **Clone or navigate to the MCP server directory:**
   ```bash
   cd /path/to/your/mcp/servers/ceph-analyzer
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the server:**
   ```bash
   npm run build
   ```

4. **Configure the MCP server** in your MCP settings file:

   **macOS/Linux:** `~/.bob/settings/mcp_settings.json`
   
   **Windows:** `%USERPROFILE%\.bob\settings\mcp_settings.json`

   **macOS/Linux Configuration:**
   ```json
   {
     "mcpServers": {
       "ceph-analyzer": {
         "command": "node",
         "args": ["/absolute/path/to/ceph-analyzer/build/index.js"],
         "env": {
           "CEPH_REPO_PATH": "/path/to/your/ceph/repository",
           "GITHUB_TOKEN": "your-github-token-here"
         },
         "disabled": false,
         "alwaysAllow": [],
         "disabledTools": []
       }
     }
   }
   ```

   **Windows Configuration:**
   ```json
   {
     "mcpServers": {
       "ceph-analyzer": {
         "command": "node",
         "args": ["C:\\Users\\YourUsername\\path\\to\\ceph-analyzer\\build\\index.js"],
         "env": {
           "CEPH_REPO_PATH": "C:\\Users\\YourUsername\\path\\to\\ceph",
           "GITHUB_TOKEN": "your-github-token-here"
         },
         "disabled": false,
         "alwaysAllow": [],
         "disabledTools": []
       }
     }
   }
   ```
   
   **Important:**
   - Replace paths with your actual paths
   - **Windows:** Use double backslashes (`\\`) in paths or forward slashes (`/`)
   - **macOS/Linux:** Use forward slashes (`/`) in paths
   - `GITHUB_TOKEN` is optional but recommended for higher API rate limits
   - Node.js must be installed and available in your system PATH

5. **Restart Bob** to load the MCP server

### Environment Variables

- `CEPH_REPO_PATH` - Path to your local Ceph repository (required for local tools)
  - Example: `/home/user/projects/ceph` or `~/dev/ceph`
- `GITHUB_TOKEN` - (Optional) GitHub personal access token for higher API rate limits
  - Without token: 60 requests/hour
  - With token: 5000 requests/hour

### Getting a GitHub Token (Optional)

For higher API rate limits, create a GitHub personal access token:

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Ceph Analyzer MCP")
4. Select scopes: `public_repo` (for public repository access)
5. Click "Generate token"
6. Copy the token and add it to your MCP settings

**Note:** The server works without a token but has lower rate limits (60 requests/hour vs 5000 requests/hour with authentication).

## Usage

### Using with Bob

Once configured, you can use natural language commands:

- "What are the latest commits to the Ceph repository?"
- "Search for OSDMap in the codebase"
- "Find the pull request that implements audit database"
- "Show me the definition of handle_command"
- "Trace the code flow for handle_osd_map"

### Direct Tool Usage Examples

#### Search for code patterns
```typescript
use_mcp_tool("ceph-analyzer", "search_ceph_code", {
  "pattern": "OSDMap",
  "file_pattern": "*.cc"
})
```

#### Get latest commits from GitHub
```typescript
use_mcp_tool("ceph-analyzer", "get_github_commits", {
  "max_count": 20
})
```

#### Search pull requests
```typescript
use_mcp_tool("ceph-analyzer", "search_github_prs", {
  "query": "audit database"
})
```

#### Read a file from GitHub
```typescript
use_mcp_tool("ceph-analyzer", "get_github_file", {
  "file_path": "README.md",
  "ref": "main"
})
```

#### Find symbol definitions
```typescript
use_mcp_tool("ceph-analyzer", "find_symbol_definition", {
  "symbol": "handle_osd_map"
})
```

#### Trace code flow
```typescript
use_mcp_tool("ceph-analyzer", "trace_code_flow", {
  "entry_point": "handle_command",
  "max_depth": 3
})
```

## Testing

Run the test suite to verify all tools work correctly:

```bash
node test-server.js
```

The test suite validates:
- Local repository tools (file listing, code search, git log)
- GitHub API tools (code search, commits, PRs, file reading)
- Response format and data validation

## Limits and Safety

The server enforces reasonable limits to ensure performance and safety:

- **Max search results**: 50 per query
- **Max file size**: 1MB
- **Max lines per file**: 10,000
- **Max trace depth**: 5 levels
- **Max git log entries**: 100
- **GitHub API rate limits**: 60/hour (unauthenticated) or 5000/hour (authenticated)

## Development

### Project Structure

```
ceph-analyzer/
├── src/
│   └── index.ts          # Main server implementation
├── build/                # Compiled JavaScript output
├── package.json          # Project dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── test-server.js        # Test suite
└── README.md            # This file
```

### Building

```bash
npm run build
```

### Watching for changes during development

```bash
npm run watch
```

### Adding New Tools

1. Add the tool definition to the `tools` array
2. Implement the tool handler in the `CallToolRequestSchema` handler
3. Add validation logic
4. Update this README with usage examples
5. Add tests to `test-server.js`

## Troubleshooting

### "Ceph repository not found" error
- Verify `CEPH_REPO_PATH` points to a valid git repository
- Ensure the path exists and contains a `.git` directory

### GitHub API rate limit errors
- Add a `GITHUB_TOKEN` to your MCP settings
- Wait for the rate limit to reset (shown in error message)

### "Command failed" errors
- Ensure git is installed and available in PATH
- Check that grep is available on your system
- Verify file permissions in the Ceph repository

### Server not appearing in Bob
- Check that the server is properly configured in `~/.bob/settings/mcp_settings.json`
- Verify the build output exists at the specified path
- Restart Bob after configuration changes
- Check Bob's logs for error messages

## Contributing

When contributing to this MCP server:

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Ensure all tests pass before submitting

## License

ISC

## Credits

Created for analyzing the Ceph distributed storage system codebase. Integrates with both local repositories and the GitHub API for comprehensive code analysis capabilities.