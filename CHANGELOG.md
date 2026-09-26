# Changelog

All notable changes to Pinpoint are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-09-26

### Added

- **Git workflow.** A branch chip above the composer shows the current branch and uncommitted changes, and can initialize a repository. Optional **new branch for each chat** (`pinpoint/...`) and **commit after each run**, which commits only the files the agent changed with a message written from your request. **Open PR** pushes the branch and opens a pull request through the GitHub CLI, with a description drafted from the chat. Runs that weren't auto-committed get a **Commit** button.
- **Before and after.** Runs that change the open page capture a screenshot before and after (once hot reload settles). Compare them with a slider, side by side, or a **Changes** view that highlights the pixels that moved. **Check all sizes** captures the page at phone, tablet and desktop widths.

### Fixed

- The run cost lost its dollar sign in the chat.

## [0.1.0] - 2026-09-26

The first public release.

### Visual editing

- Embedded browser for your local dev server, any URL or a static `.html` file, with responsive viewport presets.
- **Select** mode: click any element to pin a numbered note. Pinpoint sends the selector, DOM path, computed styles, trimmed HTML, a close-up screenshot and the source file and line.
- Source lookup for React (16 to 19), Vue 2 and 3, Svelte, Astro and Angular, with dev-server source maps for exact lines on React 19.
- **Draw** mode: pen, highlighter, arrow, box, circle and text markup on the live page, plus the elements under your strokes.
- **Sketch** mode: a whiteboard for wireframing something new.
- Reference images by paste, drag and drop, or attach.

### Agents

- Claude Code and Codex as live sessions, with model, thinking level and access pickers.
- Steering while the agent works: queue a message for after the current step, or interrupt and redirect now.
- Token-by-token streaming of replies and thinking.
- Runtime diagnostics: console errors, failed network requests and dev-server errors can be sent along, with one-click **Ask to fix**.

### Safety and review

- Every run is snapshotted. See exactly which files changed, however the agent edited them.
- Inline per-file diffs in the chat, a full diff viewer, and per-file or whole-run revert that survives restarts, with conflict checks for files edited later.

### Project context

- `DESIGN.md` design rules, drafted from the live page or written by the agent, sent at the start of each chat.
- Project memory: short rules sent with every request. The agent suggests new ones when you state a preference.
- Route discovery for Next.js, Astro, Nuxt, SvelteKit, Remix, React Router and plain HTML, with a page picker.
- Chat history saved per project.

### App

- Integrated title bar on Windows and macOS, resizable sidebar on either side, dev-server terminal and agent logs.
- Installers for Windows (NSIS), macOS (DMG, Intel and Apple Silicon) and Linux (AppImage).

[Unreleased]: https://github.com/m-ahmed-elbeskeri/pinpoint/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/m-ahmed-elbeskeri/pinpoint/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/m-ahmed-elbeskeri/pinpoint/releases/tag/v0.1.0
