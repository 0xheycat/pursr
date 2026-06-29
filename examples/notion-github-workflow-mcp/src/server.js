import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 33418);
const HOST = process.env.HOST || "0.0.0.0";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_API = "https://api.github.com";

const tools = [
  tool("github_whoami", "GitHub identity", "Return the authenticated GitHub user.", {}, { readOnlyHint: true }),
  tool("repo_health_check", "Repo health check", "Check README, license, CI, .gitignore, manifests, and obvious secret-risk files.", ownerRepoSchema(), { readOnlyHint: true }),
  tool("check_gitignore_safety", "Check .gitignore safety", "Inspect .gitignore for common local/secret/build artifact exclusions.", ownerRepoSchema(), { readOnlyHint: true }),
  tool("list_workflow_runs", "List workflow runs", "List recent GitHub Actions workflow runs.", schema({ owner: s("Owner"), repo: s("Repo"), branch: s("Branch filter"), event: s("Event filter"), status: s("Status filter"), perPage: n("Results per page", 1, 100, 10) }, ["owner", "repo"]), { readOnlyHint: true }),
  tool("list_workflow_jobs", "List workflow jobs", "List jobs and failing steps for a workflow run.", schema({ owner: s("Owner"), repo: s("Repo"), runId: n("Workflow run id", 1) }, ["owner", "repo", "runId"]), { readOnlyHint: true }),
  tool("rerun_failed_jobs", "Rerun failed workflow jobs", "Rerun failed jobs for a workflow run.", schema({ owner: s("Owner"), repo: s("Repo"), runId: n("Workflow run id", 1) }, ["owner", "repo", "runId"]), { destructiveHint: false }),
  tool("trigger_workflow_dispatch", "Trigger workflow dispatch", "Trigger workflow_dispatch for a workflow file/id and ref.", schema({ owner: s("Owner"), repo: s("Repo"), workflowId: s("Workflow id or file, e.g. ci.yml"), ref: s("Git ref"), inputs: { type: "object", additionalProperties: true } }, ["owner", "repo", "workflowId", "ref"]), { destructiveHint: false }),
  tool("pr_risk_report", "PR risk report", "Summarize changed files, diff size, risky paths, and CI status for a PR.", schema({ owner: s("Owner"), repo: s("Repo"), pullNumber: n("PR number", 1) }, ["owner", "repo", "pullNumber"]), { readOnlyHint: true }),
  tool("draft_changelog_since", "Draft changelog since ref", "Draft grouped changelog bullets from recent commits.", schema({ owner: s("Owner"), repo: s("Repo"), since: s("ISO date"), branch: s("Branch/SHA"), perPage: n("Commit count", 1, 100, 30) }, ["owner", "repo"]), { readOnlyHint: true })
];

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, name: "notion-github-workflow-mcp" });
    if (req.method !== "POST" || url.pathname !== "/mcp") return json(res, 404, { error: "Not found" });

    if (MCP_BEARER_TOKEN && bearer(req) !== MCP_BEARER_TOKEN) return rpc(res, null, null, { code: -32003, message: "Invalid MCP bearer token" }, 403);
    const token = GITHUB_TOKEN || bearer(req);
    if (!token) return rpc(res, null, null, { code: -32001, message: "Missing Bearer token or GITHUB_TOKEN" }, 401);

    const msg = await readJson(req);
    return json(res, 200, await handleMcp(msg, token));
  } catch (error) {
    return rpc(res, null, null, { code: -32603, message: error.message }, 500);
  }
}).listen(PORT, HOST, () => console.error(`notion-github-workflow-mcp listening on http://${HOST}:${PORT}/mcp`));

async function handleMcp(msg, token) {
  const id = msg?.id ?? null;
  if (msg?.method === "initialize") return ok(id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "notion-github-workflow-mcp", version: "0.1.0" } });
  if (msg?.method === "notifications/initialized") return ok(id, {});
  if (msg?.method === "tools/list") return ok(id, { tools });
  if (msg?.method === "tools/call") return ok(id, { content: [{ type: "text", text: JSON.stringify(await callTool(msg.params?.name, msg.params?.arguments || {}, token), null, 2) }] });
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
  const names = Array.isArray(root) ? root.map(x => x.name) : [];
  const checks = [
    check("README", names.some(x => /^readme\./i.test(x))),
    check("LICENSE", names.some(x => /^licen[sc]e/i.test(x))),
    check(".gitignore", Boolean(gitignore?.content || names.includes(".gitignore"))),
    check("package manifest", names.some(x => ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "deno.json"].includes(x))),
    check("CI workflows", Array.isArray(workflows) && workflows.some(x => /\.ya?ml$/i.test(x.name))),
    check("no committed .env", !names.some(x => /^\.env($|\.)/i.test(x) && !/example|sample|template/i.test(x)))
  ];
  const safety = gitignore?.content ? analyzeGitignore(decode64(gitignore.content)) : null;
  const failed = checks.filter(x => !x.pass).length + (safety?.missing?.length ? 1 : 0);
  return { repo: repoInfo.full_name, defaultBranch: repoInfo.default_branch, visibility: repoInfo.private ? "private" : "public", status: failed === 0 ? "pass" : failed <= 2 ? "warn" : "fail", checks, gitignoreSafety: safety, recommendations: recommendations(checks, safety) };
}

async function gitignoreSafety(token, { owner, repo }) {
  const file = await gh(token, `/repos/${owner}/${repo}/contents/.gitignore`);
  return { repo: `${owner}/${repo}`, ...analyzeGitignore(decode64(file.content)) };
}

function analyzeGitignore(text) {
  const rules = [["env files", [".env", ".env.*", "*.env"]], ["node dependencies", ["node_modules/"]], ["build output", ["dist/", "build/", ".next/", "out/"]], ["logs", ["*.log", "logs/"]], ["local databases", ["*.db", "*.sqlite", "db/"]], ["archives/bundles", ["*.bundle", "*.zip", "*.tar", "*.gz"]], ["uploads/artifacts", ["upload/", "uploads/", "artifacts/"]]];
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean).filter(x => !x.startsWith("#"));
  const present = [], missing = [];
  for (const [label, patterns] of rules) (patterns.some(p => lines.includes(p)) ? present : missing).push({ label, patterns });
  return { status: missing.length === 0 ? "pass" : missing.length <= 2 ? "warn" : "fail", present, missing };
}

async function listWorkflowRuns(token, args) {
  const q = params({ branch: args.branch, event: args.event, status: args.status, per_page: args.perPage || 10 });
  const data = await gh(token, `/repos/${args.owner}/${args.repo}/actions/runs?${q}`);
  return { totalCount: data.total_count, runs: data.workflow_runs.map(runSummary) };
}

async function listWorkflowJobs(token, { owner, repo, runId }) {
  const data = await gh(token, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  return { totalCount: data.total_count, jobs: data.jobs.map(jobSummary), failingJobs: data.jobs.filter(j => ["failure", "cancelled", "timed_out", "action_required"].includes(j.conclusion)).map(jobSummary) };
}

async function prRiskReport(token, { owner, repo, pullNumber }) {
  const pr = await gh(token, `/repos/${owner}/${repo}/pulls/${pullNumber}`);
  const [files, status] = await Promise.all([gh(token, `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`), safeGh(token, `/repos/${owner}/${repo}/commits/${pr.head.sha}/status`)]);
  const risky = files.filter(f => isRisky(f.filename));
  const changes = sum(files, "changes");
  return { pr: { number: pr.number, title: pr.title, url: pr.html_url, state: pr.state, draft: pr.draft, head: pr.head.ref, base: pr.base.ref }, size: changes > 800 ? "large" : changes > 250 ? "medium" : "small", totals: { files: files.length, additions: sum(files, "additions"), deletions: sum(files, "deletions"), changes }, riskyFiles: risky.map(f => ({ filename: f.filename, status: f.status, changes: f.changes, reason: riskReason(f.filename) })), ci: status ? { state: status.state, statuses: status.statuses?.map(s => ({ context: s.context, state: s.state, description: s.description, url: s.target_url })) } : null, reviewFocus: [risky.length ? "Review risky files first." : "No obvious risky paths detected.", files.length > 30 ? "Large file count: review by subsystem." : "File count is manageable.", changes > 500 ? "Large diff: consider splitting or extra tests." : "Diff size is moderate."] };
}

async function draftChangelog(token, args) {
  const q = params({ sha: args.branch, since: /^\d{4}-\d{2}-\d{2}/.test(args.since || "") ? args.since : undefined, per_page: args.perPage || 30 });
  const commits = await gh(token, `/repos/${args.owner}/${args.repo}/commits?${q}`);
  const groups = { features: [], fixes: [], docs: [], chores: [], other: [] };
  for (const c of commits) {
    const message = c.commit.message.split("\n")[0];
    const bucket = /^feat/i.test(message) ? "features" : /^fix/i.test(message) ? "fixes" : /^docs/i.test(message) ? "docs" : /^(chore|ci|test|refactor|build)/i.test(message) ? "chores" : "other";
    groups[bucket].push({ message, sha: c.sha.slice(0, 7), url: c.html_url, author: c.commit.author?.name });
  }
  return { repo: `${args.owner}/${args.repo}`, since: args.since || null, branch: args.branch || null, groups, markdown: Object.entries(groups).filter(([, xs]) => xs.length).map(([k, xs]) => `## ${k}\n${xs.map(x => `- ${x.message} (${x.sha})`).join("\n")}`).join("\n\n") };
}

function tool(name, title, description, inputSchema, annotations = {}) { return { name, title, description, inputSchema: inputSchema.type ? inputSchema : schema(inputSchema), annotations }; }
function ownerRepoSchema() { return schema({ owner: s("Repository owner"), repo: s("Repository name") }, ["owner", "repo"]); }
function schema(properties, required = []) { return { type: "object", properties, required, additionalProperties: false }; }
function s(description) { return { type: "string", description }; }
function n(description, minimum, maximum, defaultValue) { return Object.fromEntries(Object.entries({ type: "number", description, minimum, maximum, default: defaultValue }).filter(([, v]) => v !== undefined)); }
function ok(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpc(res, id, result, error, status = 200) { return json(res, status, error ? { jsonrpc: "2.0", id, error } : ok(id, result)); }
function json(res, status, data) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); }
function bearer(req) { const h = req.headers.authorization || ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : ""; }
function readJson(req) { return new Promise((resolve, reject) => { let body = ""; req.on("data", c => body += c); req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } }); req.on("error", reject); }); }
function params(obj) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v)); return q.toString(); }
function decode64(s) { return Buffer.from(String(s).replace(/\n/g, ""), "base64").toString("utf8"); }
function check(name, pass) { return { name, pass: Boolean(pass) }; }
function recommendations(checks, safety) { return [...checks.filter(x => !x.pass).map(x => `Add or fix ${x.name}.`), ...(safety?.missing || []).map(x => `Add .gitignore coverage for ${x.label}: ${x.patterns.join(", ")}.`)]; }
function runSummary(r) { return { id: r.id, name: r.name, workflowName: r.display_title, event: r.event, status: r.status, conclusion: r.conclusion, branch: r.head_branch, sha: r.head_sha, createdAt: r.created_at, updatedAt: r.updated_at, url: r.html_url }; }
function jobSummary(j) { return { id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, startedAt: j.started_at, completedAt: j.completed_at, url: j.html_url, steps: j.steps?.map(s => ({ name: s.name, status: s.status, conclusion: s.conclusion, number: s.number })) }; }
function sum(xs, key) { return xs.reduce((n, x) => n + (x[key] || 0), 0); }
function isRisky(p) { return /(^|\/)(\.github\/workflows|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Dockerfile|docker-compose|\.env|migrations?|schema|auth|security|secrets?|deploy|infra|terraform|k8s|helm)/i.test(p); }
function riskReason(p) { if (/\.github\/workflows/i.test(p)) return "CI/CD workflow changed"; if (/lock|package/i.test(p)) return "Dependency or lockfile changed"; if (/auth|security|secret/i.test(p)) return "Auth/security-sensitive path"; if (/migrations?|schema/i.test(p)) return "Database/schema path"; if (/deploy|infra|terraform|k8s|helm|Dockerfile/i.test(p)) return "Deployment/infra path"; return "Sensitive path pattern"; }
async function safeGh(token, path) { try { return await gh(token, path); } catch { return null; } }
async function gh(token, path, opts = {}) { const method = opts.method || "GET"; const expected = opts.expected || [200]; const res = await fetch(`${GITHUB_API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }); if (!expected.includes(res.status)) throw new Error(`GitHub ${method} ${path} failed: ${res.status} ${await res.text()}`); if (res.status === 204 || res.headers.get("content-length") === "0") return { ok: true, status: res.status }; return res.json(); }
