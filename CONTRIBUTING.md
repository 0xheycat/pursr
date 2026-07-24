# Contributing to pursr

Thanks for wanting to make **pursr** better! pursr is a CLI + MCP server for visual QA and browser automation for AI agents. Contributions of every size are welcome.

## Ways to contribute

- 🐛 **Fix a bug** — check [open issues](https://github.com/0xheycat/pursr/issues), especially [`good first issue`](https://github.com/0xheycat/pursr/labels/good%20first%20issue).
- ✨ **Add a feature** — new commands, better diffing, smarter selector heuristics.
- 📸 **Improve visual QA** — pixel-diff accuracy, accessibility (axe-core) checks.
- 📝 **Docs & examples** — real-world recipes make pursr click for new users.

## Getting started

```bash
git clone https://github.com/0xheycat/pursr
cd pursr
npm install
npm test
```

## Pull request flow

1. Fork and create a branch: `git checkout -b feat/short-name`.
2. Keep the change focused and add/adjust tests where it makes sense.
3. Run `npm test` (and `npm run lint` if present) locally.
4. Open a PR using the template and link the issue it closes.

## Style

- Small, reviewable PRs beat big ones.
- Prefer clear names and short functions.
- Update the README when behavior changes.

## Code of Conduct

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md). Questions? Open a [Discussion](https://github.com/0xheycat/pursr/discussions).
