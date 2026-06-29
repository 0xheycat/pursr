import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 33418);
const HOST = process.env.HOST || "0.0.0.0";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_API = "https://api.github.com";

const tools = [
  {
    name: "github_whoami",
    title: "GitHub identity",
    description: "Return the authenticated GitHub user for this MCP connection.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: "repo_health_check",
    title: "Repo health check",
    description: "Check basic repository hygiene: README, LICENSE, package manifests, CI workflows, .gitignore, and secret-risk files.",
    inputSchema: ownerRepoSchema(),
    annotations: { readOnlyHint: true }
  },
  {
    name: "check_gitignore_safety",
    title: "Check .gitignore safety",
    description: "Inspect .gitignore for common secret, build, database, and local artifact exclusions.",
    inputSchema: ownerRepoSchema(),
    annotations: { readOnlyHint: true }
  },
  {
    name: "list_workflow_runs",
    title: "List workflow runs",
    description: "List recent GitHub Actions workflow runs for a repository.",
    inputSchema: {
      type: "object",
      properties: {
        owner: stringProp("Repository owner"),
        repo: stringProp("Repository name"),
        branch: stringProp("Branch filter"),
        event: stringProp("Event filter, e.g. push or pull_request"),
        status: stringProp("Status filter, e.g. completed, in_progress, queued"),
        perPage: numberProp("Results per page", 1, 100, 10)
      },
      required: ["owner", "repo"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "list_workflow_jobs",
    title: "List workflow jobs",
    description: "List jobs for a GitHub Actions workflow run, including failing jobs and step summaries.",
    inputSchema: {
      type: "object",
      properties: {
        owner: stringProp("Repository owner"),
        repo: stringProp("Repository name"),
        runId: numberProp("Workflow run id", 1)
      },
      required: ["owner", "repo", "runId"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "rerun_failed_jobs",
    title: "Rerun failed workflow jobs",
    description: "Rerun failed jobs for a GitHub Actions workflow run.",
    inputSchema: {
      type: "object",
      properties: {
        owner: stringProp("Repository owner"),
        repo: stringProp("Repository name"),
        runId: numberProp("Workflow run id", 1)
      },
      required: ["owner", "repo", "runId"],
      additionalProperties: false
    },
    annotations: { destructiveHint: false }
  },
  {
    name: "trigger_workflow_dispatch",
    title: "Trigger workflow dispatch",
    description: "Trigger a workflow_dispatch event for a workflow file/id and ref.",
    inputSchema: {
      type: "object",
      properties: {
        owner: stringProp("Repository owner"),
        repo: stringProp("Repository name"),
        workflowId: stringProp("Workflow file name or workflow id, e.g. ci.yml"),
        ref: stringProp("Git ref, e.g. main"),
        inputs: { type: "object", description: "Workflow inputs", additionalProperties: true }
      },
      required: ["owner", "repo", "workflowId", "ref"],
      additionalProperties: false
    },
    annotations: { destructiveHint: false }
  },
  {
    name: "pr_risk_report",
    title: "PR risk report",
    description: "Summarize changed files, size, risky paths, CI status, and review focus areas for a pull request.",
    inputSchema: {
      type: "object",
      properties: {
        owner: stringProp("Repository owner"),
        repo: stringProp("Repository name"),
        pullNumber: numberProp("Pull request number", 1)
      },
      required: ["owner", "repo", "pullNumber"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: "draft_changelog_since",
    title: "Draft changelog since ref",
    description: "Draft grouped changelog bullets from commits after a ref/sha/branch.",
    inputSchema: {
      type: "object",
      properties: {
        owner: stringProp("Repository owner"),
        repo: stringProp("Repository name"),
        since: stringProp("ISO date or ref note for the changelog window"),
        branch: stringProp("Branch or SHA to inspect"),
        perPage: numberProp("Commit count", 1, 100, 30)
      },
      required: ["owner", "repo"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  }
];

function ownerRepoSchema() {
  return {
    type: "object",
    properties: { owner: stringProp("Repository owner"), repo: stringProp("Repository name") },
    required: ["owner", "repo"],
    additionalProperties: false
  };
}
function stringProp(description) { return { type: "string", description }; }
function numberProp(description, minimum, maximum, defaultValue) {
  const schema = { type: "number", description };
  if (minimum !== undefined) schema.minimum = minimum;
  if (maximum !== undefined) schema.maximum = maximum;
  if (defaultValue !== undefined) schema.default = defaultValue;
  return schema;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true, name: "notion-github-workflow-mcp" });
    if (req.method !== "POST" || url.pathname !== "/mcp") return sendJson(res, 404, { error: "Not found" });

    const token = resolveToken(req);
    if (!token) return sendJson(res, 401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing Bearer token or GITHUB_TOKEN" } });
    if (MCP_BEARER_TOKEN && bearer(req) !== MCP_BEARER_TOKEN) {
      return sendJson(res, 403, { jsonrpc: "2.0", id: null, error: { code: -32003, message: "Invalid MCP bearer token" } });
    }

    const body = await readJson(req);
    const result = await handleMcp(body, token);
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, 500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: error.message } });
  }
});

server.listen(PORT, HOST, () => {
  console.error(`notion-github-workflow-mcp listening on http://${HOST}:${PORT}/mcp`);
});

async function handleMcp(msg, token) {
  const id = msg?.id ?? null;
  if (msg?.method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "notion-github-workflow-mcp", version: "0.1.0" } } };
  }
  if (msg?.method === "notifications/initialized") return { jsonrpc: "2.0", id, result: {} };
  if (msg?.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };
  if (msg?.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    const data = await callTool(name, args, token);
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] } };
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported method: ${msg?.method}` } };
}

async function callTool(name, args, token) {
  switch (name) {
    case "github_whoami": return gh(token, "/user");
    case "repo_health_check": return repoHealth(token, args);
    case "check_gitignore_safety": return gitignoreSafety(token, args);
    case "list_workflow_runs": return listWorkflowRuns(token, args);
    case "list_workflow_jobs": return listWorkflowJobs(token, args);
    case "rerun_failed_jobs": return gh(token, `/repos/${args.owner}/${args.repo}/actions/runs/${args.runId}/rerun-failed-jobs`, { method: "POST", expected: [201, 202, 204] });
    case "trigger_workflow_dispatch": return gh(token, `/repos/${args.owner}/${args.repo}/actions/workflows/${encodeURIComponent(args.workflowId)}/dispatches`, { method: "POST", body: { ref: args.ref, inputs: args.inputs || {} }, expected: [201, 202, 204] });
    case "pr_risk_report": return prRiskReport(token, args);
    case "draft_changelog_since": return draftChangelog(token, args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

async function repoHealth(token, { owner, repo }) {
  const [repoInfo, root, workflows, gitignore] = await Promise.all([
    gh(token, `/repos/${owner}/${repo}`),
    safeGh(token, `/repos/${owner}/${repo}/contents`),
    safeGh(token, `/repos/${owner}/${repo}/contents/.github/workflows`),
    safeGh(token, `/repos/${owner}/${repo}/contents/.gitignore`)
  ]);
  const rootNames = Array.isArray(root) ? root.map(x => x.name) : [];
  const checks = [
    check("README", rootNames.some(n => /^readme\./i.test(n))),
    check("LICENSE", rootNames.some(n => /^licen[sc]e/i.test(n))),
    check(".gitignore", Boolean(gitignore?.content || rootNames.includes(".gitignore"))),
    check("package manifest", rootNames.some(n => ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "deno.json"].includes(n))),
    check("CI workflows", Array.isArray(workflows) && workflows.some(w => /\.ya?ml$/i.test(w.name))),
    check("no committed .env", !rootNames.some(n => /^\.env($|\.)/i.test(n) && !/example|sample|template/i.test(n)))
  ];
  const safety = gitignore?.content ? analyzeGitignore(decodeBase64(gitignore.content)) : null;
  const failed = checks.filter(c => !c.pass).length + (safety?.missing?.length ? 1 : 0);
  return {
    repo: repoInfo.full_name,
    defaultBranch: repoInfo.default_branch,
    visibility: repoInfo.private ? "private" : "public",
    status: failed === 0 ? "pass" : failed <= 2 ? "warn" : "fail",
    checks,
    gitignoreSafety: safety,
    recommendations: recommendations(checks, safety)
  };
}

async function gitignoreSafety(token, { owner, repo }) {
  const file = await gh(token, `/repos/${owner}/${repo}/contents/.gitignore`);
  return { repo: `${owner}/${repo}`, ...analyzeGitignore(decodeBase64(file.content)) };
}

function analyzeGitignore(text) {
  const rules = [
    ["env files", [".env", ".env.*", "*.env"]],
    ["node dependencies", ["node_modules/"]],
    ["build output", ["dist/", "build/", ".next/", "out/"]],
    ["logs", ["*.log", "logs/"]],
    ["local databases", ["*.db", "*.sqlite", "db/"]],
    ["archives/bundles", ["*.bundle", "*.zip", "*.tar", "*.gz"]],
    ["uploads/artifacts", ["upload/", "uploads/", "artifacts/"]]
  ];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).filter(l => !l.startsWith("#"));
  const present = [];
  const missing = [];
  for (const [label, patterns] of rules) {
    const ok = patterns.some(p => lines.includes(p));
    (ok ? present : missing).push({ label, patterns });
  }
  return { status: missing.length === 0 ? "pass" : missing.length <= 2 ? "warn" : "fail", present, missing };
}

async function listWorkflowRuns(token, args) {
  const q = new URLSearchParams();
  if (args.branch) q.set("branch", args.branch);
  if (args.event) q.set("event", args.event);
  if (args.status) q.set("status", args.status);
  q.set("per_page", String(args.perPage || 10));
  const data = await gh(token, `/repos/${args.owner}/${args.repo}/actions/runs?${q}`);
  return { totalCount: data.total_count, runs: data.workflow_runs.map(runSummary) };
}

async function listWorkflowJobs(token, { owner, repo, runId }) {
  const data = await gh(token, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  return { totalCount: data.total_count, jobs: data.jobs.map(jobSummary), failingJobs: data.jobs.filter(j => ["failure", "cancelled", "timed_out", "action_required"].includes(j.conclusion)).map(jobSummary) };
}

async function prRiskReport(token, { owner, repo, pullNumber }) {
  const [pr, files, status] = await Promise.all([
    gh(token, `/repos/${owner}/${repo}/pulls/${pullNumber}`),
    gh(token, `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`),
    safeGh(token, `/repos/${owner}/${repo}/commits/${(await gh(token, `/repos/${owner}/${repo}/pulls/${pullNumber}`)).head.sha}/status`)
  ]);
  const risky = files.filter(f => isRiskyPath(f.filename));
  const totalChanges = files.reduce((n, f) => n + f.changes, 0);
  return {
    pr: { number: pr.number, title: pr.title, url: pr.html_url, state: pr.state, draft: pr.draft, head: pr.head.ref, base: pr.base.ref },
    size: totalChanges > 800 ? "large" : totalChanges > 250 ? "medium" : "small",
    totals: { files: files.length, additions: sum(files, "additions"), deletions: sum(files, "deletions"), changes: totalChanges },
    riskyFiles: risky.map(f => ({ filename: f.filename, status: f.status, changes: f.changes, reason: riskReason(f.filename) })),
    ci: status ? { state: status.state, statuses: status.statuses?.map(s => ({ context: s.context, state: s.state, description: s.description, url: s.target_url })) } : null,
    reviewFocus: buildReviewFocus(files, risky)
  };
}

async function draftChangelog(token, args) {
  const q = new URLSearchParams();
  if (args.branch) q.set("sha", args.branch);
  if (args.since && /^\d{4}-\d{2}-\d{2}/.test(args.since)) q.set("since", args.since);
  q.set("per_page", String(args.perPage || 30));
  const commits = await gh(token, `/repos/${args.owner}/${args.repo}/commits?${q}`);
  const groups = { features: [], fixes: [], docs: [], chores: [], other: [] };
  for (const c of commits) {
    const msg = c.commit.message.split("\n")[0];
    const bucket = /^feat/i.test(msg) ? "features" : /^fix/i.test(msg) ? "fixes" : /^docs/i.test(msg) ? "docs" : /^(chore|ci|test|refactor|build)/i.test(msg) ? "chores" : "other";
    groups[bucket].push({ message: msg, sha: c.sha.slice(0, 7), url: c.html_url, author: c.commit.author?.name });
  }
  return { repo: `${args.owner}/${args.repo}`, since: args.since || null, branch: args.branch || null, groups, markdown: renderChangelog(groups) };
}

function runSummary(r) { return { id: r.id, name: r.name, workflowName: r.display_title, event: r.event, status: r.status, conclusion: r.conclusion, branch: r.head_branch, sha: r.head_sha, createdAt: r.created_at, updatedAt: r.updated_at, url: r.html_url }; }
function jobSummary(j) { return { id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, startedAt: j.started_at, completedAt: j.completed_at, url: j.html_url, steps: j.steps?.map(s => ({ name: s.name, status: s.status, conclusion: s.conclusion, number: s.number })) }; }
function check(name, pass) { return { name, pass: Boolean(pass) }; }
function recommendations(checks, safety) { return [...checks.filter(c => !c.pass).map(c => `Add or fix ${c.name}.`), ...(safety?.missing || []).map(m => `Add .gitignore coverage for ${m.label}: ${m.patterns.join(", ")}.`)]; }
function sum(items, key) { return items.reduce((n, x) => n + (x[key] || 0), 0); }
function isRiskyPath(p) { return /(^|\/)(\.github\/workflows|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Dockerfile|docker-compose|\.env|migrations?|schema|auth|security|secrets?|deploy|infra|terraform|k8s|helm)/i.test(p); }
function riskReason(p) { if (/\.github\/workflows/i.test(p)) return "CI/CD workflow changed"; if (/lock|package/i.test(p)) return "Dependency or lockfile changed"; if (/auth|security|secret/i.test(p)) return "Auth/security-sensitive path"; if (/migrations?|schema/i.test(p)) return "Database/schema path"; if (/deploy|infra|terraform|k8s|helm|Dockerfile/i.test(p)) return "Deployment/infra path"; return "Sensitive path pattern"; }
function buildReviewFocus(files, risky) { return [risky.length ? "Review risky files first." : "No obvious risky paths detected.", files.length > 30 ? "Large file count: review by subsystem." : "File count is manageable.", sum(files, "changes") > 500 ? "Large diff: consider splitting or extra tests." : "Diff size is moderate."]; }
function renderChangelog(groups) { return Object.entries(groups).filter(([, items]) => items.length).map(([name, items]) => `## ${name}\n` + items.map(i => `- ${i.message} (${i.sha})`).join("\n")).join("\n\n"); }

async function gh(token, path, opts = {}) {
  const method = opts.method || "GET";
  const expected = opts.expected || [200];
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!expected.includes(res.status)) {
    const text = await res.text();
    throw new Error(`GitHub ${method} ${path} failed: ${res.status} ${text}`);
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") return { ok: true, status: res.status };
  return res.json();
}
async function safeGh(token, path) { try { return await gh(token, path); } catch { return null; } }
function bearer(req) { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : ""; }
function resolveToken(req) { return GITHUB_TOKEN || bearer(req); }
function decodeBase64(s) { return Buffer.from(String(s).replace(/\n/g, ""), "base64").toString("utf8"); }
function readJson(req) { return new Promise((resolve, reject) => { let body = ""; req.on("data", c => body += c); req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } }); req.on("error", reject); }); }
function sendJson(res, status, data) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); }
