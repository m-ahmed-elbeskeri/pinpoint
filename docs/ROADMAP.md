# UI roadmap

Ideas gathered while bringing Pinpoint's shell closer to t3code and Codex. Checked items are built.

## Done

- [x] Chats sidebar: chats grouped by date, search, running/done state, delete
- [x] Projects in the sidebar, each expanding to its own chats (t3code-style tree)
- [x] Command palette (Ctrl/⌘+K) with chats, modes, views, agents, projects
- [x] Agent picker as a dropdown in the composer; any CLI harness (Gemini, Qwen, Cursor, OpenCode, Amp, Droid, Copilot, Goose, Aider, custom)
- [x] Collapsible "Worked · N steps" groups for tool steps
- [x] Side chats as tabs in the chat panel (several at once, read-only, own session)
- [x] Selection bubble in the chat: start a side chat, or quote into a reply
- [x] Running section in the sidebar: working chats, background runs, side chats, dev server, terminals
- [x] Annotate mode: click an element, or drag to draw a mark
- [x] Compact annotations; images open on click
- [x] Quieter colour: yellow only for the logo, pins and the annotate outline
- [x] Inline approval cards (Allow once / Always / Deny) for Claude Code and Codex, with "needs you" in the sidebar
- [x] Live plan checklist from the agent's to-do list, pinned while it works
- [x] Red/green diffs inside edit steps
- [x] @-mention files and / commands in the composer; /plan and /edit with a Plan only pill
- [x] Light theme and follow-the-system (Settings, palette, /theme)
- [x] Desktop notifications when a run finishes or needs your OK while the window is in the background

## Chat and transcript

- [ ] "Thought for 12s" and per-step timers
- [ ] Context / token meter by the composer; cost per message, per thread, daily total
- [ ] Message hover actions: copy, edit and resend, fork from here, retry
- [ ] Rewind to any message (restore files to that point)
- [ ] Subagent / parallel-task lanes
- [ ] Live strip of files the agent is reading
- [ ] Rate-limit and quota warnings before the limit
- [ ] MCP / hooks status per server
- [ ] Quick-reply chips after a result: Continue, Try again, Make it smaller

## Composer

- [ ] Queued-messages tray (edit or remove before they send)
- [ ] Image chips inside the composer
- [ ] Prompt history (↑, Ctrl+R) and saved snippets
- [ ] Paste long text as a collapsed chip; drag files in from the OS
- [ ] Voice dictation

## Threads and workspace

- [ ] Branch / worktree per thread, shown on the thread
- [ ] Thread states: needs approval, error, unread; pin, rename, archive
- [ ] Diff side panel next to the chat (not only a modal)
- [ ] Accept or reject per hunk; "Explain this change"; inline review comments that feed the next message
- [ ] Change summary at the top of a turn with jump links
- [ ] Compare two runs or branches side by side
- [ ] File tree with recently-changed badges; quick code viewer
- [ ] Split panes, saved layouts, zen mode; one window per project; tray status
- [ ] Terminal tabs with a running indicator
- [ ] Timeline scrubber of page screenshots across a thread's runs
- [ ] Annotation pins kept on the page across reloads, per thread

## Sharing

- [ ] Export or share a thread (Markdown, HTML)
- [ ] Thread → PR with written description and screenshots
- [ ] Shared project memory and rules
- [ ] Hand a thread to a teammate

## Feel

- [ ] Dock badge on done / needs input; optional sounds
- [ ] Shortcuts sheet (`?`); density, font size and accent settings
- [ ] Shimmer on "Thinking…"; small enter animations; animated check on completion
- [ ] Empty states that rotate tips
- [ ] Palette: recent section, search inside chat contents
- [ ] Resume card for interrupted runs
- [ ] Status bar: branch, dev server, agent, model, tokens, errors
- [ ] Onboarding that detects installed CLIs and helps sign in
