import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";
import { Octokit } from "@octokit/rest";

// Configuration — read once at module load so both server and test share the same env
export const CEPH_REPO_PATH = process.env.CEPH_REPO_PATH;
const CEPH_OWNER = "ceph";
const CEPH_REPO = "ceph";
const MAX_SEARCH_RESULTS = 50;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const MAX_LINES_PER_FILE = 10000;

// Read token lazily so test-server.js can clear a placeholder before the first API call
function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  return token ? new Octokit({ auth: token }) : new Octokit();
}

// ── Repo helpers ───────────────────────────────────────────────────────────────

export function validateRepoPath(): void {
  if (!CEPH_REPO_PATH) {
    console.error(
      "Warning: CEPH_REPO_PATH is not set — local repository tools will be unavailable."
    );
    return;
  }
  if (!fs.existsSync(CEPH_REPO_PATH)) {
    console.error(`Warning: Ceph repository not found at: ${CEPH_REPO_PATH} — local tools will be unavailable.`);
    return;
  }
  if (!fs.existsSync(path.join(CEPH_REPO_PATH, ".git"))) {
    console.error(
      `Warning: ${CEPH_REPO_PATH} has no .git folder — git-dependent tools (get_git_log) will not work, but file tools will continue.`
    );
  }
}

export function getRepoPath(): string {
  if (!CEPH_REPO_PATH) {
    throw new Error(
      "CEPH_REPO_PATH environment variable is required. " +
        "Please set it in your MCP settings configuration."
    );
  }
  return CEPH_REPO_PATH;
}

// ── Local tool implementations ─────────────────────────────────────────────────

// Walk a directory recursively yielding file paths that match an extension list.
function* walkFiles(dir: string, extSet: Set<string>): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full, extSet);
    } else if (extSet.size === 0 || extSet.has(path.extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

export function searchCephCode(
  pattern: string,
  isRegex: boolean = false,
  filePattern?: string
): object {
  const repoPath = getRepoPath();

  // Determine which extensions to search
  const extSet = new Set<string>();
  if (filePattern) {
    // e.g. "*.cc" → ".cc", "*.{cc,h}" → split on comma
    const raw = filePattern.replace(/^\*\./, "");
    raw.replace(/[{}]/g, "").split(",").forEach((e) => extSet.add("." + e.trim()));
  } else {
    [".cc", ".h", ".py", ".cpp", ".hpp", ".c"].forEach((e) => extSet.add(e));
  }

  const searchRe = isRegex ? new RegExp(pattern, "i") : null;
  const searchLower = isRegex ? "" : pattern.toLowerCase();
  const results: object[] = [];

  for (const filePath of walkFiles(repoPath, extSet)) {
    if (results.length >= MAX_SEARCH_RESULTS) break;
    let content: string;
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_FILE_SIZE) continue;
      content = fs.readFileSync(filePath, "utf-8");
    } catch { continue; }
    const lines = content.split("\n");
    if (lines.length > MAX_LINES_PER_FILE) continue;
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= MAX_SEARCH_RESULTS) break;
      const line = lines[i];
      const matches = isRegex ? searchRe!.test(line) : line.toLowerCase().includes(searchLower);
      if (matches) {
        results.push({ file: path.relative(repoPath, filePath), line: i + 1, content: line.trim() });
      }
    }
  }

  return { pattern, is_regex: isRegex, total_results: results.length, results };
}

export function readCephFile(
  filePath: string,
  startLine?: number,
  endLine?: number
): object {
  const fullPath = path.join(getRepoPath(), filePath);
  if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${filePath}`);
  const stats = fs.statSync(fullPath);
  if (stats.size > MAX_FILE_SIZE) throw new Error(`File too large: ${filePath}`);
  const content = fs.readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");
  if (lines.length > MAX_LINES_PER_FILE) throw new Error(`File has too many lines: ${filePath}`);
  if (startLine !== undefined && endLine !== undefined) {
    const start = Math.max(0, startLine - 1);
    const end = Math.min(lines.length, endLine);
    return {
      file: filePath,
      total_lines: lines.length,
      content: lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n"),
    };
  }
  return {
    file: filePath,
    total_lines: lines.length,
    content: lines.map((l, i) => `${i + 1}: ${l}`).join("\n"),
  };
}

export function findSymbolDefinition(symbol: string): object {
  const results: any[] = [];
  const patterns = [
    `\\bdef\\s+${symbol}\\b`,
    `\\b${symbol}\\s*\\(`,
    `\\bclass\\s+${symbol}\\b`,
    `\\bstruct\\s+${symbol}\\b`,
  ];
  try {
    const repoPath = getRepoPath();
    const grepCmd = patterns
      .map((p) => `grep -rn -E "${p}" --include="*.{cc,h,py,cpp,hpp}" ${repoPath}`)
      .join(" ; ");
    const output = execSync(grepCmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, cwd: repoPath });
    output.split("\n").slice(0, MAX_SEARCH_RESULTS).forEach((line) => {
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (match) {
        const [, file, lineNum, content] = match;
        let type = "unknown";
        if (content.includes("def ")) type = "function";
        else if (content.includes("class ")) type = "class";
        else if (content.includes("struct ")) type = "struct";
        results.push({ file: path.relative(getRepoPath(), file), line: parseInt(lineNum), type, context: content.trim() });
      }
    });
  } catch (error: any) {
    if (!error.message.includes("Command failed")) throw error;
  }
  return { symbol, total_results: results.length, definitions: results };
}

export function findSymbolReferences(symbol: string): object {
  const results: any[] = [];
  const repoPath = getRepoPath();
  try {
    const output = execSync(
      `grep -rn "\\b${symbol}\\b" --include="*.{cc,h,py,cpp,hpp}" ${repoPath}`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, cwd: repoPath }
    );
    output.split("\n").slice(0, MAX_SEARCH_RESULTS).forEach((line) => {
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (match) {
        const [, file, lineNum, content] = match;
        results.push({ file: path.relative(repoPath, file), line: parseInt(lineNum), context: content.trim() });
      }
    });
  } catch (error: any) {
    if (!error.message.includes("Command failed")) throw error;
  }
  return { symbol, total_results: results.length, references: results };
}

export function listCephFiles(directory: string = ".", pattern?: string): object {
  const dirPath = path.join(getRepoPath(), directory);
  if (!fs.existsSync(dirPath)) throw new Error(`Directory not found: ${directory}`);
  let files = fs.readdirSync(dirPath);
  if (pattern) {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    files = files.filter((f) => regex.test(f));
  }
  const items = files.slice(0, 200).map((file) => {
    const fullPath = path.join(dirPath, file);
    const stats = fs.statSync(fullPath);
    return { name: file, type: stats.isDirectory() ? "directory" : "file", size: stats.isFile() ? stats.size : undefined };
  });
  return { directory, total_items: items.length, items };
}

export function getGitLog(gitPath: string = ".", maxCount: number = 20): object {
  const repoPath = getRepoPath();
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    return { error: "get_git_log requires a git clone — the configured CEPH_REPO_PATH has no .git folder." };
  }
  const count = Math.min(maxCount, 100);
  // Custom separator unlikely to appear in commit messages
  const SEP = "|||";
  const fmt = `--pretty=format:%H${SEP}%an${SEP}%ae${SEP}%ad${SEP}%s`;
  // Build the full command as a string and pass shell:true so the system shell
  // resolves 'git' from PATH (required on Windows where spawnSync array form
  // does not inherit the user's PATH correctly).
  const cmd = `git log --max-count=${count} "${fmt}" --date=iso -- "${gitPath}"`;
  const result = spawnSync(cmd, { cwd: getRepoPath(), encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, shell: true } as any);
  if (result.error) throw new Error(`git not found on PATH: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git log failed: ${(result.stderr as string).trim()}`);
  const output = (result.stdout as string).trim();
  const commits = output.split("\n").filter(Boolean).map((line) => {
    const [hash, author, email, date, ...rest] = line.split(SEP);
    return { hash, author, email, date, message: rest.join(SEP) };
  });
  return { path: gitPath, total_commits: commits.length, commits };
}

// ── GitHub tool implementations ────────────────────────────────────────────────

export async function searchGitHubCode(query: string, filePattern?: string): Promise<object> {
  try {
    let searchQuery = `${query} repo:${CEPH_OWNER}/${CEPH_REPO}`;
    if (filePattern) searchQuery += ` extension:${filePattern.replace("*.", "")}`;
    const response = await getOctokit().search.code({ q: searchQuery, per_page: Math.min(MAX_SEARCH_RESULTS, 100) });
    const results = response.data.items.map((item: any) => ({
      file: item.path, repository: item.repository.full_name, url: item.html_url, score: item.score,
    }));
    return { query, file_pattern: filePattern, total_results: results.length, results, note: "Results from global ceph/ceph repository on GitHub" };
  } catch (error: any) {
    // Return structured error so callers can detect and handle gracefully
    return { error: `GitHub API error: ${error.message}` };
  }
}

export async function getGitHubFile(filePath: string, ref: string = "main"): Promise<object> {
  try {
    const response = await getOctokit().repos.getContent({ owner: CEPH_OWNER, repo: CEPH_REPO, path: filePath, ref });
    if (!("content" in response.data) || !response.data.content) throw new Error("File content not available");
    const content = Buffer.from(response.data.content, "base64").toString("utf-8");
    const lines = content.split("\n");
    return {
      file: filePath, ref, total_lines: lines.length,
      content: lines.map((l, i) => `${i + 1}: ${l}`).join("\n"),
      repository: `${CEPH_OWNER}/${CEPH_REPO}`,
    };
  } catch (error: any) {
    return { error: `GitHub API error: ${error.message}` };
  }
}

export async function getGitHubCommits(commitPath: string = "", maxCount: number = 20): Promise<object> {
  try {
    const response = await getOctokit().repos.listCommits({
      owner: CEPH_OWNER, repo: CEPH_REPO, path: commitPath || undefined, per_page: Math.min(maxCount, 100),
    });
    const commits = response.data.map((commit: any) => ({
      hash: commit.sha, author: commit.commit.author.name, email: commit.commit.author.email,
      date: commit.commit.author.date, message: commit.commit.message, url: commit.html_url,
    }));
    return { path: commitPath || "entire repository", total_commits: commits.length, commits, repository: `${CEPH_OWNER}/${CEPH_REPO}`, note: "Commits from global ceph/ceph repository on GitHub" };
  } catch (error: any) {
    return { error: `GitHub API error: ${error.message}` };
  }
}

export async function searchGitHubPRs(query: string): Promise<object> {
  try {
    const response = await getOctokit().search.issuesAndPullRequests({
      q: `${query} repo:${CEPH_OWNER}/${CEPH_REPO} is:pr`,
      per_page: Math.min(MAX_SEARCH_RESULTS, 100), sort: "updated", order: "desc",
    });
    const prs = response.data.items.map((pr: any) => ({
      number: pr.number, title: pr.title, state: pr.state, author: pr.user.login,
      created_at: pr.created_at, updated_at: pr.updated_at, url: pr.html_url, body: pr.body?.substring(0, 500),
    }));
    return { query, total_results: prs.length, pull_requests: prs, repository: `${CEPH_OWNER}/${CEPH_REPO}`, note: "Pull requests from global ceph/ceph repository on GitHub" };
  } catch (error: any) {
    return { error: `GitHub API error: ${error.message}` };
  }
}
