---
name: pr
description: Packrat, the production telemetry and deploy verdicts for this app, through the packrat CLI. Use when someone names a pull request ("PR 482", "#482", a GitHub PR URL) and asks how it went in production; pastes a packrat.sh or query.packrat.sh link, or a line from a Packrat mail; asks what production did ("why is this slow", "what failed last night", errors, incidents, browser sessions); or wants something verified in production at a later time.
argument-hint: "<pull request number or URL, a Packrat link, or a question>"
allowed-tools: Bash(packrat:*)
---

# Packrat

The request: $ARGUMENTS

Use the `packrat` CLI for all of it. Its help is the reference: run `packrat help` first, and
`packrat help <command>` before you use a command for the first time.

- **Not signed in:** ask the person to type `! packrat login`. Do not sign in for them.
- **A pasted Packrat link or mail line:** `packrat open '<the link or line, as pasted>'`. Do not fetch
  packrat.sh pages yourself; they need the person's key.
- **A pull request:** `packrat pr show <number or URL>`. Tell the person the verdict, its evidence, the
  next step, and each check. Then stop and let them choose. Do not start to change code.
- **Before your first `packrat sql`:** read https://packrat.sh/docs/investigate.md and follow it.
  A report or a verdict is from the time it was written, so run its SQL again before you trust it.
- **Something to verify later:** ask Packrat's analyst with `packrat check add`; do not leave a note
  for a person. Run its SQL one time with `packrat sql` before you send it.
