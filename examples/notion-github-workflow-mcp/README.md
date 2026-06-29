# Notion GitHub Workflow MCP

A Notion-first GitHub workflow MCP gateway. It complements the existing GitHub MCP connection with higher-level tools for daily coding from Notion.

## Why this exists

The standard GitHub MCP tools expose low-level GitHub actions. This gateway adds opinionated, agent-friendly workflows:

- repo health checks
- `.gitignore` safety checks
- GitHub Actions run/job summaries
- rerun failed CI jobs
- workflow dispatch
- PR risk reports
- changelog drafts from commits

## Auth model

Two modes are supported:

1. **Hosted token mode**
   - Set `GITHUB_TOKEN` on the server.
   - Optionally set `MCP_BEARER_TOKEN` so Notion must authenticate to the MCP server.

2. **Notion popup token mode**
   - Do not set `GITHUB_TOKEN`.
   - Connect this MCP server in Notion with **Bearer Token** auth.
   - Paste a fine-grained GitHub PAT in the Notion auth popup.
   - The server uses the incoming Bearer token as the GitHub token.

Use a fine-grained PAT scoped only to the repositories and actions you need.

## Run

```bash
cd examples/notion-github-workflow-mcp
cp .env.example .env
node src/server.js
```

Default endpoint:

```text
http://127.0.0.1:33418/mcp
```

For Notion cloud usage, host it on an HTTPS endpoint reachable by Notion.

## Tools

### Read-only / safe

- `github_whoami`
- `repo_health_check`
- `check_gitignore_safety`
- `list_workflow_runs`
- `list_workflow_jobs`
- `pr_risk_report`
- `draft_changelog_since`

### Write / approval recommended

- `rerun_failed_jobs`
- `trigger_workflow_dispatch`

## Notion connection

Add a custom MCP server in Notion:

- URL: `https://your-domain.example/mcp`
- Auth: `Bearer Token`
- Token: either your `MCP_BEARER_TOKEN`, or a GitHub fine-grained PAT if using Notion popup token mode.

Do not remove your existing working GitHub MCP connection. This is an additional workflow layer.
