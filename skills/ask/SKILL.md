---
name: ask
description: Read production data from Packrat. Use when the user asks how a pull request performed in production (a PR number such as "PR 482" or a GitHub PR URL), pastes a packrat.sh or query.packrat.sh link or a line from a Packrat email, asks a question about production (slow requests, errors, incidents, user sessions), or wants something verified in production at a later time.
argument-hint: "<PR number or URL, Packrat link, or question>"
allowed-tools: Bash(packrat:*)
---

# Packrat

Request: $ARGUMENTS

Use the `packrat` CLI for all Packrat data. Run `packrat help` to list the available commands, and
`packrat help <command>` for a command's usage before you run it for the first time.

## Authentication

If a command reports that you are not signed in, ask the user to run `! packrat login`. The sign-in is
approved in the user's browser, so you cannot complete it for them.

## Packrat links

To read a packrat.sh link or a line from a Packrat email, run:

```bash
packrat open '<the link or line, as pasted>'
```

Do not fetch packrat.sh pages directly. They require the user's API key.

## Pull requests

To show how a pull request performed, run:

```bash
packrat pr show <number or URL>
```

Summarize the verdict, the evidence, the suggested next step and any pending checks. Then stop and let
the user decide what to do next. Do not change code unless the user asks.

## Queries

Before you run your first `packrat sql` query, read https://packrat.sh/docs/investigate.md. It lists
the common mistakes that return wrong results.

Reports and verdicts reflect the data at the time they were written. Run their queries again before
you rely on them.

## Checks

If something can only be verified later, such as a job that runs tomorrow, create a check with
`packrat check add`. Do not leave a reminder for the user instead. Run the check's query once with
`packrat sql` before you create it, to confirm that it works.
