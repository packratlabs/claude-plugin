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

## Resolving and archiving

When the user asks you to resolve, archive or reopen an issue, or to archive a pull request's
verification, run one of:

```bash
packrat issues resolve <ID> --reason "<why>"
packrat issues archive <ID> --reason "<why>"
packrat issues reopen <ID>
packrat pr archive <number or URL> --reason "<why>"
```

Give a reason whenever the conversation says why, in one plain sentence: for example, the check
measured the wrong thing, or the error is expected. The analyst reads the reason, so a good one keeps
it from raising the same issue again. Do not resolve or archive anything the user did not ask you to.

When you fix a Packrat issue, write `Fixes <ID>` (for example `Fixes SHOP-41`) in the pull request's
description, one line for each issue. Packrat resolves the issue when the deploy that ships the pull
request goes live, and reopens it if the error comes back. Do not resolve it yourself as well.

## Queries

Before you run your first `packrat sql` query, read https://packrat.sh/docs/investigate.md. It lists
the common mistakes that return wrong results.

Reports and verdicts reflect the data at the time they were written. Run their queries again before
you rely on them.

## Checks

A check belongs to a pull request. If something a deployed pull request does can only be verified later,
such as a job it changed that runs tomorrow, add a check to it with `packrat check add --pull <number>`.
Do not leave a reminder for the user instead. Run the check's query once with `packrat sql` before you
add it, to confirm that it works. Do not add a check without `--pull`.

## When Packrat gets in your way

If a `packrat` command fails in a way its message does not explain, answers something you can show is wrong,
or Packrat has no command for something the task needs, report it to the Packrat team with `packrat feedback`
instead of asking the user to write to them. Run `packrat help feedback` first. Put what you ran, the error or
answer, what you expected and any fix you would suggest on stdin, and leave out keys, passwords and tokens.
Send one report a task, and only when Packrat got in your way: not to report progress or when the task went
well. Then tell the user what you sent, and carry on with the task or tell them what is blocked.
