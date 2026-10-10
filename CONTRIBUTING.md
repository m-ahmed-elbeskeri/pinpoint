# Contributing to Pinpoint

Thanks for helping make Pinpoint better. Bug reports, ideas, docs fixes and code are all welcome.

## Getting set up

You need Node.js 22+ and at least one agent CLI installed and signed in: [Claude Code](https://docs.claude.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex).

```bash
git clone https://github.com/m-ahmed-elbeskeri/pinpoint.git
cd pinpoint
npm install
npm run dev
```

`npm run dev` starts Vite for the UI and launches Electron against it. UI changes hot-reload. Changes under `electron/` need a restart (Ctrl+C, then `npm run dev` again).

To try it against a real site, open any local project in Pinpoint, start its dev server from the terminal panel, and point the URL bar at it.

## Project layout

| Path | What lives there |
|---|---|
| `electron/main.cjs` | Window, IPC, settings, captures, dev server, run lifecycle |
| `electron/agent-claude.cjs` | Claude Code as a live, steerable session (`stream-json` in and out) |
| `electron/agent-codex.cjs` | Codex over `codex app-server` (JSON-RPC), with an `exec` fallback |
| `electron/prompt.cjs` | Turns annotations, drawings and context into the agent prompt |
| `electron/snapshot.cjs`, `runs.cjs` | Change detection, per-run before/after copies, diff and revert |
| `electron/routes.cjs`, `sourcemap.cjs` | Route discovery and source-map lookup |
| `electron/webview-preload.cjs` | In-page picker: hover box, numbered markers, hit-testing |
| `src/` | React UI |

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm run build
```

- Keep pull requests focused: one change per PR is easier to review.
- Match the style of the code around you. Comments explain *why*, not *what*.
- UI changes: include a screenshot or short recording.
- If you change behavior users will notice, add a line to `CHANGELOG.md` under **Unreleased**.

## Releases

Maintainers cut releases by bumping `version` in `package.json`, moving the **Unreleased** notes in `CHANGELOG.md` under the new version, and pushing a matching tag:

```bash
npm version 0.2.0 --no-git-tag-version
git commit -am "Release v0.2.0"
git tag v0.2.0
git push && git push --tags
```

The **Release** workflow builds the Windows, macOS and Linux installers and publishes them to GitHub Releases with the changelog notes.

## Code of conduct

Be kind and assume good intent. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
