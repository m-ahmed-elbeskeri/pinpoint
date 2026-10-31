# Architecture

Pinpoint is an Electron app. A React window shows your page in a `<webview>` beside a chat, and the main process runs coding-agent CLIs against your project.

```
 window (React)  ── window.pinpoint ──  preload.cjs  ── IPC ──  main process
       │                                                            ├─ agents/    run Claude Code, Codex, other CLIs
   <webview>  ── webview-preload.cjs                                ├─ project/   chats, runs, routes, dev server
   your page     picker, markers, recording                         └─ git/, page/
```

## Layout

```
electron/                 Main process (CommonJS, no build step)
  main.cjs                Window and startup
  entry.cjs               What package.json starts
  settings.cjs            Settings file
  preload.cjs             The bridge the window uses (window.pinpoint)
  webview-preload.cjs     Runs inside your page: picking, markers, recording
  ci.cjs                  Headless `--ci` commands
  ipc/                    One file per area; each registers its IPC channels
  agents/                 One adapter per agent, and the list of supported CLIs
  prompt/                 Turns a request into the prompt an agent gets
  git/                    Status, branches, compare, worktrees, GitHub
  project/                Chat store, runs and revert, routes, components, dev server
    detect/               Monorepo tools and non-JS stacks: how to run a project
  page/                   Sweep, review links, other browsers, source maps, CSS rules

src/                      Window (React and TypeScript, built by Vite)
  App.tsx                 Calls the hooks, lays out the views
  app/                    The app's state and behaviour
    context.ts            What the hooks and views share
    use*.ts               One hook per area: tabs, chats, runs, annotations, ...
    views/                The big pieces of the window
    panels.tsx            Panels that load when first opened
  components/             Reusable UI, by area: agent, chat, git, page, shell, tools, ui
  lib/                    Logic with no UI; some of it runs inside the page
  styles/                 CSS by feature; index.css sets the order
  types/                  Shared types; api.ts describes window.pinpoint

tests/                    Own runner: `node tests/run.cjs [--only a,b]`
scripts/                  Dev server launcher, icon generation
docs/                     This file, the roadmap, media, a CI example
```

## How the window's code fits together

`App` creates one `app` object and calls every hook in `src/app` on each render. Each hook keeps its own state and writes what others need onto `app`. So any hook or view can read `app.chat` or call `app.flash()` and always gets the latest value, without passing props through or mirroring state in refs.

Order matters only for values read while rendering: a hook can read `app.x` during render only if an earlier hook set it. Inside effects and handlers, any order works.

Members are typed in `app/context.ts`, one interface per hook. When a hook starts sharing something new, add it to its interface.

## Adding things

- **An IPC channel:** handler in `electron/ipc/<area>.cjs`, bridge in `electron/preload.cjs`, type in `src/types/api.ts`.
- **An agent:** a new entry in `electron/agents/harnesses.cjs` is usually enough. Claude Code and Codex have their own adapters because they support steering and approvals.
- **A project type:** `electron/project/detect/services.cjs` for a language or framework, `monorepo.cjs` for a workspace tool. Add a case to the detection checks in `tests/unit.test.cjs`.
- **Styles:** in the feature's file in `src/styles`. `overrides.css` holds older rules whose order still matters; rules there can move to their feature's file once checked. Colours come from the tokens in `tokens.css`, so light theme keeps working.

## Tests

`tests/run.cjs` builds nothing by itself unless `dist` is missing, so run `npm run build` first. End-to-end suites start the real app with a stand-in agent. Don't edit `electron/` or rebuild `dist` during a run: the running app reads them live.
