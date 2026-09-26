# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's private vulnerability reporting instead: go to the repository's **Security** tab and choose **Report a vulnerability**.

You'll get a reply within a few days. Once a fix is ready we'll publish a release and credit you, unless you'd rather stay anonymous.

## How Pinpoint handles your code and data

- Pinpoint runs entirely on your machine. It has no server and sends no telemetry.
- Requests go to the coding agent you choose (Claude Code or Codex), which runs locally with your own account and its own permission settings.
- The **Access** setting in the composer controls what the agent may do: **Plan only** (no changes), **Edit files** (project folder only) or **Full access**.
- Screenshots, run records and chat history are stored in `.pinpoint/` inside your project. That folder ignores itself in git.
- The embedded browser runs pages in a sandboxed, context-isolated `<webview>`. Pinpoint's own page tooling runs in an isolated world the page can't reach.

## Supported versions

Security fixes go into the latest release.
