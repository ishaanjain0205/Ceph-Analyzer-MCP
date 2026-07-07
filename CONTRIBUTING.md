# Contributing to Ceph Analyzer MCP Server

Thank you for your interest in contributing to the Ceph Analyzer MCP Server!

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd ceph-analyzer
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   export CEPH_REPO_PATH=/path/to/your/ceph/repository
   export GITHUB_TOKEN=your-github-token  # Optional, for higher API rate limits
   ```

4. **Build the project:**
   ```bash
   npm run build
   ```

5. **Run tests:**
   ```bash
   node test-server.js
   ```

## Project Structure

```
ceph-analyzer/
├── src/
│   └── index.ts          # Main server implementation
├── build/                # Compiled output (not in git)
├── node_modules/         # Dependencies (not in git)
├── package.json          # Project configuration
├── tsconfig.json         # TypeScript configuration
├── test-server.js        # Test suite
├── .gitignore           # Git ignore rules
├── README.md            # User documentation
└── CONTRIBUTING.md      # This file
```

## Making Changes

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** in the `src/` directory

3. **Build and test:**
   ```bash
   npm run build
   node test-server.js
   ```

4. **Commit your changes:**
   ```bash
   git add src/
   git commit -m "Description of your changes"
   ```

5. **Push and create a pull request:**
   ```bash
   git push origin feature/your-feature-name
   ```

## Adding New Tools

To add a new tool to the MCP server:

1. **Define the tool** in the `tools` array with its schema
2. **Implement the handler** in the `CallToolRequestSchema` handler
3. **Add validation** and error handling
4. **Update README.md** with usage examples
5. **Add tests** to `test-server.js`

Example tool definition:
```typescript
{
  name: "your_tool_name",
  description: "What your tool does",
  inputSchema: {
    type: "object",
    properties: {
      param1: {
        type: "string",
        description: "Description of param1"
      }
    },
    required: ["param1"]
  }
}
```

## Code Style

- Use TypeScript strict mode
- Follow existing code formatting
- Add comments for complex logic
- Use meaningful variable names
- Handle errors gracefully

## Testing

Before submitting a pull request:

1. Ensure all existing tests pass
2. Add tests for new functionality
3. Test with both local repository and GitHub API features
4. Verify error handling works correctly

## Environment Variables

The server uses these environment variables:

- `CEPH_REPO_PATH` - Required for local repository tools
- `GITHUB_TOKEN` - Optional, for GitHub API rate limits

Never commit actual tokens or sensitive paths to the repository.

## Documentation

When adding features:

1. Update README.md with usage examples
2. Add inline code comments
3. Update this CONTRIBUTING.md if needed
4. Document any new environment variables

## Questions?

If you have questions or need help, please open an issue on the repository.

## License

By contributing, you agree that your contributions will be licensed under the ISC License.