# Packrat for Claude Code

The Packrat plugin for Claude Code gives Claude access to your app's production data in
[Packrat](https://packrat.sh). Claude can use it to:

- Report how a pull request performed after it was deployed, including the analyst's verdict.
- Read Packrat links, such as a report linked from a Packrat email.
- Query your traces and logs with SQL to investigate production issues.
- Schedule a check that the analyst runs at a later time, with the result sent by email.
- Add a Follow-up section to each pull request, which Packrat uses to verify the deploy.

## Prerequisites

- [Claude Code](https://claude.com/claude-code)
- A Packrat account with at least one app sending data

## Install the plugin

Add the marketplace and install the plugin from within Claude Code:

```
/plugin marketplace add packratlabs/claude-plugin
/plugin install packrat@packrat
```

The plugin runs the [Packrat CLI](https://github.com/packratlabs/packrat-cli). If `packrat` is already
on your `PATH`, the plugin uses that installation. Otherwise, it downloads the CLI on first use and
verifies it against the release checksums.

## Authenticate

Sign in from Claude Code:

```
! packrat login
```

The command opens your browser to approve the sign-in. It stores an API key on your machine: in the
macOS Keychain, or in `~/.config/packrat/credentials.json` on other platforms. Claude runs `packrat`
commands with this key but does not have access to the key itself.

In CI, set the `PACKRAT_API_KEY` environment variable instead.

## Usage

Claude uses the plugin when your request involves production. You don't need to run commands
directly. For example:

| Request | What Claude does |
| --- | --- |
| "How did PR 482 do?" or `/packrat:ask PR 482` | Shows the analyst's verdict for each deploy of the pull request, with the evidence and any pending checks. |
| A pasted Packrat link | Reads the page with your API key and summarizes it. |
| "Why is checkout slow?" | Queries your traces and logs with `packrat sql`. |
| "Check that the cleanup job ran on Monday." | Schedules a check with `packrat check add`. The analyst emails the result. |

### Follow-up sections

When Claude creates a pull request with `gh pr create`, the plugin requires a `## Follow-up` section
in the description. The section states what shows the change worked in production, how to check it,
and when the result is expected. If the section is missing, the plugin blocks the command and asks
Claude to add one.

## Skills

| Skill | Description |
| --- | --- |
| `packrat:ask` | The entry point to Packrat. Answers questions about production through the CLI: pull requests, Packrat links, SQL queries and checks. |
| `packrat:follow-up` | Writes the Follow-up section of a pull request. |
