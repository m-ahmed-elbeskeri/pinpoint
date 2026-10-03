# Changelog

All notable changes to Pinpoint are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.2] - 2026-10-03

### Added

- **A real terminal.** The drawer has a Terminal tab that runs a shell in your project folder: type commands, see colours, resize it. The arrow next to **+** lists the shells installed on your computer (PowerShell, Command Prompt, Git Bash and WSL on Windows; zsh, bash, fish and others on macOS and Linux) and remembers the one you pick. Several terminals can be open at once, and they keep running while the drawer is closed.

- **Send now on a waiting message.** A message you send while the agent works waits behind its current step. It now carries a **Send now** button that interrupts the step so the agent reads it at once (or, for a run that can't take messages, stops the run and sends it).

### Changed

- **Test conditions menu redesigned.** Each option is a labelled row saying what it does, with switches for on/off settings and segmented controls for choices, a line showing what is changed from normal, and one Reset button.
- **The logo is gone from the top bar**, leaving more room for the project and mode buttons.
- **Before and after screenshots show the place you annotated.** When you send, the page is scrolled so the elements you picked are in view before the "before" screenshot is taken, wherever you had scrolled to since. The "after" screenshot is taken at the same place, even if you scrolled away while the agent worked.

- **Reading back in a chat.** Scrolling up, even a little, stops the chat from following new output. A **Latest** button appears at the bottom and turns into **New messages** when something has arrived; pressing it takes you back to the end.
- **Record** sits with Browse, Select, Draw and Sketch in the top bar instead of among the icons on the right.

## [0.4.1] - 2026-10-03

### Added

- **Several chats at once.** Starting a new chat or opening another one no longer waits for the agent to finish, and no longer stops it. A chat that is still working keeps working out of sight; it is listed above the conversation with a spinner, turns green when it is done, and opens exactly as it is when you click it. Each chat keeps its own agent session, and each result lists only the files that chat changed.

### Faster

- **Typing, dragging and streaming** no longer re-render the whole conversation. With a long chat open, a keystroke in the composer takes under a millisecond instead of about six, and dragging the panel divider runs about three times as many frames.
- **Picking an element** opens its note on the click; the element's screenshot is attached a moment later instead of being waited for.
- **Browsing your app** is no longer interrupted by Pinpoint's own checks. The accessibility audit and the background screenshots for the unintended-change check now wait until a page has been open a few seconds, load one page at a time, and no longer pause the app while they look through the project's files.
- **The page overlay** (hover box, markers, layout guides) only redraws when something moved, and the floating toolbars no longer blur the page behind them.
- **The conversation** follows new output only while you are at the bottom; scrolling up to read stays where you put it.

### Fixed

- **Component workspace** finds components in Vite projects that use a `base` path or keep the file outside the dev server's folder. On other dev servers (Next.js, webpack, Nuxt) it now says which one it found and what to do instead.

### Changed

- **License.** Now the GNU Affero General Public License v3.0 or later (0.4.0 was GPL v3). The same terms as before, and they also apply when a modified Pinpoint is offered to people as a service over a network.

## [0.4.0] - 2026-10-03

### Changed

- **License.** Pinpoint is now licensed under the GNU General Public License v3.0 or later (it was MIT up to 0.3.0). It stays free to use, change and share; versions and derivatives that are distributed have to be released under the same terms.

### Fixed

- Screenshots of pages that set no background colour came out transparent (dark text on nothing). They are now on white, as the page looks.

### Added

- **Instant edits.** A style tweak, a copy fix, a class change or a reorder is written straight into the source in milliseconds, with no agent, when the place to write it is unambiguous: the element's JSX (Tailwind classes, text, class list, order) or the plain-CSS rule that sets the property. It shows in the chat as a normal change with a diff and Undo. When it can't be done exactly, the note says why and the agent does it.
- **Drag on the page.** With an element selected, drag its right or bottom edge to resize it, or drag its body to move it among its siblings. Both show at once and go to the agent or to an instant edit.
- **Component workspace.** Any exported React component in the project, rendered alone in the page with controls for its props (read from its types) and a grid of every variant. Needs a Vite dev server; no Storybook.
- **"View as" profiles.** A tab can be shown as a saved profile: its own cookies and storage (log in once, it stays logged in), plus a language, time zone, feature flags and request headers. Two tabs can show two users side by side.
- **Background runs.** Send a request to run in a separate copy of the project (a git worktree) while you keep working and send more. When it finishes you see its summary, diff and a screenshot, then apply or discard it. Applying merges; a run that touched the same lines you did is refused, never half-applied.
- **Other browsers.** See the open page as WebKit (Safari's engine) and Firefox render it, next to Chromium, with a pixel diff. The engines are downloaded once, on request (about 300 MB), through Playwright.
- **CI mode.** `electron . --ci capture | compare | build-size` runs the visual change check, accessibility check and build-size check headless. `docs/ci/pinpoint-visual-check.yml` is a ready-made GitHub Actions workflow that comments the result on each pull request.
- **Auto-update.** Windows and Linux builds download new releases in the background and install on restart. macOS builds, not being signed, show that a newer version is out and link to it.
- **Test suite.** `npm test` runs the unit checks and drives the real app end to end, with a stand-in agent so no tokens are spent.
- **Browser tabs.** Open several pages at once, each with its own history. Annotations made on different tabs go out as one request, and each tab shows when it has some. Links that open a new window open a tab. Tabs are restored with the project. <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>T</kbd> opens one; middle-click closes.
- **Browser-style layout.** Back, forward, reload and the address bar sit under the tabs with the page tools (sizes, freeze, test conditions); the top bar keeps the project, the modes and app-level buttons. Design rules and memory are icons in the top bar.
- **Model and thinking level in one control.** One button in the composer shows the model and a level meter (and more detail when the sidebar is wide). Its menu lists the models and has a slider you click or drag to set the thinking level.
- **Live style tweaks.** A picked element's note now has a **Tweak styles** panel (padding, margin, gap, radius, type size, weight, line height, opacity, text and fill color). Changes show instantly in the page; arrow keys nudge. On send, the agent writes the final values into your source.
- **States and transient UI.** Force `:hover`, `:focus`, `:active` or `disabled` on a picked element; its styles and close-up are re-captured in that state. Emulate dark / light color scheme and reduced motion from the URL bar. **Freeze** (<kbd>F</kbd>, or <kbd>F8</kbd> while typing) holds open menus, tooltips and popovers so they can be picked, pausing the page's timers and animations too. Dark and light also switch sites that theme with a class or attribute.
- **Responsive mode.** Device presets, exact width and height, drag handles on the page's edges, rotate, touch emulation, and zoom-to-fit, with the page's own CSS breakpoints as one-click sizes. Requests sent in responsive mode are scoped to that width.
- **Design-system awareness.** Pinpoint detects Tailwind, component libraries (shadcn/ui, MUI, Chakra, …), the styling approach and CSS-variable tokens, and tells the agent to use them. Picked elements show which tokens their values come from, their component's props, and how often the component is used, with a **This one / All uses** switch.
- **No visible change.** A run that edits files without changing how the page looks is flagged on its card, and the result check is told so it can find out why. A page that didn't hot-reload is reloaded automatically.
- **Unintended changes.** Each run screenshots the open page and up to 8 other routes before and after. The run card lists every page that changed and names what changed on it, each with a before/after compare. Pinned pages report the same. Content that moves by itself (animations, carousels, clocks) is ignored, and baselines are taken while the app is idle so runs don't wait for them.
- **Accessibility.** axe-core runs on the open page (WCAG A/AA); violations appear as a chip next to page problems, with **Ask to fix**.
- **Mockup overlay.** Lay a reference image over the live page with an opacity slider, drag it into place, and open a pixel diff of mockup vs page.
- **Where a style comes from.** A picked element lists the CSS rules that style it, most specific first, with the file and line of each and which rule currently decides padding, color and the rest. The agent gets the same list.
- **Layout overlay.** While selecting, the hovered element shows its margin and padding, and flex and grid containers outline their children. Hold <kbd>Alt</kbd> to measure the distance from the selected element.
- **Text, class and prop editing.** Edit an element's copy and class list in place (with autocomplete from the page's CSS; new Tailwind utilities are generated on the spot with the project's own Tailwind 3 or 4), and change a React or Vue 3 component's props live. The agent writes the result into source.
- **Component tools.** **Isolate** shows the picked element alone on the page, centered and still live; **Story** opens its Storybook story (starting Storybook if needed) or sets up a request to write one.
- **Test conditions.** One click for long text, pseudo-localized text, right-to-left and empty lists; simulated slow network, loading (requests hang), error (requests fail) and offline states; and animation speed with pause and step.
- **All sizes side by side.** Phone, tablet and desktop views of the page, live and scroll-synced.
- **Interaction recording.** Record clicks and typing as steps the agent can read, copy them as a Playwright test, and have the result check replay them with real mouse and keyboard input.
- **Load cost per run.** The run card shows what a change did to the open page's JS and CSS size, requests, DOM size, layout shift and largest paint. **Build size** runs the project's build and reports the gzipped JS and CSS it emits, compared with the last measurement.
- **Pinned pages.** Pin a page as a baseline that should not change, check all pins on demand, compare, and accept intended changes.
- **Hand-off.** Save a request (notes, picks, screenshots) as one file for someone else to open and run, copy it as Markdown, or create a GitHub issue from it (screenshots travel in a secret gist linked from the issue).
- **Check the result** (off by default, Settings): after a run, the agent gets the after screenshot and any new errors and fixes what's off.
- **Variants** (off by default, Settings or the layers button in the composer): try a request 2 to 8 ways (click a number or type one), one after another from the same starting point, then pick one from the screenshots.

## [0.3.0] - 2026-09-29

### Added

- **Dev server detection.** Opening a project works out how to start it: the package manager (from `packageManager` or the lockfile), the right script (`dev`, `start`, … ranked by what they run), apps in `frontend/`, `client/`, `apps/*` and similar subfolders, and non-Node stacks (Django, Laravel, Rails, Jekyll, Hugo, static sites). It installs dependencies first when `node_modules` is missing. **Start dev server** on the welcome screen runs it in one click, the terminal offers the other candidates, and if something already answers on the expected port you get an **Open** button for it.
- Screenshots are now attached to Claude Code runs as images, not just file paths, so Claude always sees what you pointed at and drew.
- Elements under a drawing now include their DOM path, size and key styles, so requests like "tone this down" don't need a separate select.

### Changed

- With no project open, Pinpoint starts on the welcome screen instead of trying `localhost:3000`.
- Switching projects stops the previous project's dev server and returns to the welcome screen.

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

[Unreleased]: https://github.com/m-ahmed-elbeskeri/pinpoint/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/m-ahmed-elbeskeri/pinpoint/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/m-ahmed-elbeskeri/pinpoint/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/m-ahmed-elbeskeri/pinpoint/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/m-ahmed-elbeskeri/pinpoint/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/m-ahmed-elbeskeri/pinpoint/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/m-ahmed-elbeskeri/pinpoint/releases/tag/v0.1.0
