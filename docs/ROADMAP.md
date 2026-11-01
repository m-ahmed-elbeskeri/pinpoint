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
- [x] ~~Running section in the sidebar~~ removed: working chats show in the list, side chats on their tabs, background runs by the composer
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

- [x] "Thought for 12s" and per-step timers
- [x] Context meter by the composer; cost per run, per chat and per day
- [x] Message hover actions: copy, edit and resend, retry, fork from here
- [x] Rewind to any message (undo the runs after it)
- [x] Subagent lanes (steps nested under the Task that started them)
- [x] ~~Live strip of files the agent is reading~~ removed: it added noise and couldn't be clicked
- [x] Rate-limit and quota warnings before the limit
- [x] MCP server status (in the agent menu)
- [x] ~~Quick-reply chips after a result~~ removed: they added noise under every result

## Composer

- [x] Queued-messages tray (edit or remove before they send)
- [x] Image chips inside the composer
- [x] Prompt history (↑, Ctrl+R) and saved snippets
- [x] Paste long text as a collapsed chip; drag files in from the OS
- [ ] Voice dictation (blocked: Electron's speech recognition needs a Google API key)

## Threads and workspace

- [x] Branch per thread, with its pull request state shown on the thread
- [x] Thread states: needs you, failed, done-while-away; pin, rename, archive
- [x] Diff docked beside the chat
- [x] Keep or revert per hunk; "Explain this change"; inline review comments that feed the next message
- [x] Change summary at the top of a turn with jump links
- [x] Compare runs (timeline) and branches (git panel)
- [x] File tree with recently-changed badges; quick code viewer
- [x] Split panes (a tool beside the page), saved layouts, zen mode; one window per project; tray status
- [x] Terminal tabs in the drawer header
- [x] Timeline scrubber of page screenshots across a thread's runs
- [x] Annotation pins kept on the page across reloads, per thread

## Sharing

- [x] Export a thread as Markdown
- [x] Thread → PR with written description and screenshots
- [x] Shared project memory and rules (PINPOINT.md, committed)
- [x] Hand a thread to a teammate (a file they open; the agent gets the conversation as text)

## Feel

- [x] Taskbar / dock badge on done or needs input; optional sounds
- [x] Shortcuts sheet (`?`); text size and density settings (accent colour dropped: the palette stays neutral)
- [x] Shimmer on "Thinking…" and "Working"; gentle enter and menu animations
- [x] ~~Empty states that rotate tips~~ dropped: empty states stay clean
- [x] Palette: recent section, search inside chat contents
- [x] Resume on interrupted runs
- [x] Status bar: branch, dev server, errors, agent, model, cost (off by default)
- [x] Onboarding that detects installed CLIs and shows how to install and sign in
