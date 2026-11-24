# Packrat for Claude Code

[Packrat](https://packrat.sh) checks every pull request Claude opens in production and tells you which
aren't working. When one falls short, it opens an issue for Claude to follow up on.

1. **Claude opens a pull request with checks.** Before Claude runs `gh pr create`, it declares the pull
   request's checks: what the change should do in production, such as a page getting faster or a job
   writing its rows, and when to look. If a check needs telemetry your app doesn't send yet, Claude
   adds it in the same pull request.
2. **Packrat verifies it in production.** When the deploy that ships the pull request goes live, Packrat
   runs each check against your production data. The result is the pull request's verification:
   **Worked**, **Worked in part**, **Did not work** or **Not verified**. You see it in the `/packrat` pane
   beside the chat, on the pull request's page on Packrat.sh, and in a Github comment Packrat posts on the pull
   request.
3. **Claude follows up.** When a pull request doesn't work, Packrat opens an issue. Run `/packrat:ask` with
   the issue's ID, and Claude reads the exceptions, traces, logs and session replays behind it to find the
   cause and open a fix.

Type `/packrat` to open the PR Verifications pane beside the chat. It lists the repository's recently
deployed pull requests with their verification status:

```
Packrat PR Verifications · shop/production
◐ 1 worked in part  ◷ 1 pending  ✓ 3 worked

◐ #482 Make the cart page faster
  ✓ The cart is faster
  ✗ The checkout total is correct
  [ Ask ] [ View PR ]  worked in part · 14m ago
✓ #481 Retry failed webhook deliveries
◷ #480 Export orders as CSV
✓ #479 Bump rack to 3.2
✓ #478 Show shipping estimates in the cart
```

The plugin also lets Claude query your production data, so it can answer "why is checkout slow?" from
what your app actually did.

## Get started

The plugin reads your app's data from Packrat, so you need a Packrat account and an app that sends data
to it. Set both up from your app's repository:

```sh
curl -fsSL https://packrat.sh/setup | sh
```

The command installs the Packrat CLI and runs `packrat setup`, which signs you in, connects the
repository to Packrat through GitHub, installs this plugin, and has Claude Code add Packrat to your app
in a pull request. When that pull request deploys, Packrat has data and the plugin has something to read.

With the plugin already installed, you can ask Claude Code to set up Packrat in the repository instead.
The `packrat:setup` skill runs `packrat setup` and does each step it names.

To install the plugin on its own, find **packrat** in `/plugin` › **Discover**, or add Packrat's
marketplace:

```
/plugin marketplace add packratlabs/claude-plugin
/plugin install packrat@packrat
```

Then sign in, if `packrat setup` has not already signed you in:

```
! packrat login
```

## What you can ask

Claude uses the plugin when your request is about production. You don't need to run commands yourself.

| You ask                                        | What Claude does                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| "How did PR 482 do?" or `/packrat:ask PR 482`  | Shows whether the pull request worked, with each check's result and its evidence. |
| A pasted Packrat link                          | Reads the page and summarizes it.                                                 |
| "Why is checkout slow?"                        | Queries your exceptions, traces and logs with `packrat sql`.                      |
| "Look into SHOP-41." or `/packrat:ask SHOP-41` | Reads the issue and the data behind it, finds the cause and proposes a fix.       |
| "SHOP-12 is fixed by the last deploy."         | Resolves the issue with `packrat issues resolve`, with your reason.               |

## Pull request checks

The plugin changes one thing about how Claude works: before `gh pr create`, Claude drafts the checks for
the branch. Each check says what the change should do in production, the telemetry SQL that shows it, and when to
look. The `packrat:checks` skill tells Claude how to write them.

- **Before `gh pr create`**, the plugin asks Packrat to validate the draft. If there is no draft, or
  Packrat refuses it, the plugin stops the command and tells Claude what to fix. A change production
  cannot show, such as one to tests or docs, is declared with a reason instead of checks.
- **After `gh pr create`**, the plugin declares the checks under the new pull request's number. They wait
  for the deploy that ships it, then run against production until each one passes, fails or runs out of
  time.

The plugin never stops a pull request in a repository Packrat doesn't verify, or when it cannot reach
Packrat.

A pull request **Worked** when every check passed, **Worked in part** when one failed and another passed,
and **Did not work** when one failed and none passed. It is **Not verified** when no check could tell. A
failed check opens an issue on Packrat.

## The loop

A loop is a Claude Code session that works the pull requests that failed in production, so you don't have
to. It takes one failed pull request at a time from Packrat's queue, finds out why its check failed, and
ends it. Start one in a terminal tab of its own, in a worktree, so it never touches the checkout you work
in:

```sh
claude --worktree packloop
```

Then type `/packrat:loop`. To work specific pull requests and stop, name them: `/packrat:loop 482 490`.

The loop ends each pull request one of five ways:

| Ending | What happens |
| --- | --- |
| Fix | Claude opens a pull request on a `packrat/<number>` branch, with its own checks. You review and merge it. |
| Fixed already | A later commit or pull request fixed it. Nothing else changes. |
| Excuse the check | The change did what it was for and the check's target was wrong. Packrat excuses the check, with Claude's reason, and works the verdict out again. |
| Replace the check | The check measured the wrong thing. Packrat excuses it and runs the check Claude wrote in its place. |
| Needs a person | Claude hands it back with what it found. |

Claude never merges a pull request, and never runs migrations, a server or a deploy. When the queue is
empty, the loop waits for the next pull request to fail. `packrat queue list` shows what waits.

Everything the loop does is in a log on your computer, at `.git/packrat/loop.log` in the repository. Run
`packrat queue log` to read it:

```
2026-11-23 14:02  took   #324  Read R2 through httplib in query sessions
2026-11-23 14:05  ended  #324  excuse the check · excused chk_34hpg1xi10ko · now worked
                         The 4 s target assumed 32 query threads, and production ran at 8.
```

The loop needs version 0.1.33 or later of the Packrat CLI. Run `packrat update` to get it.

## The PR Verifications pane

Type `/packrat` to open a pane that lists the repository's recently deployed pull requests and how each
did in production. The mark before each pull request is its verification: `✓` Worked, `◐` Worked in part,
`✗` Did not work, `◷` pending and `–` Not verified. Select one to list its checks. **Ask** puts a
`/packrat:ask` prompt in the input for you to send, and **View PR** opens the pull request on Packrat.

Press `2`, or type `/packrat issues`, for the app's open issues: its errors and the problems Packrat found
on its own (marked `AI`), most severe first.

A row that changed since you last opened it is bold and marked **new**, and each tab counts its new rows,
as in `PR Verifications (3)`. A pull request changes when it deploys, when a check gets a result and when
its verdict lands; an issue when it opens, changes status or gets an update. Opening a row marks it seen,
on every machine you use, and so does opening its page on Packrat. A row you have open when it changes is seen
already. Inside an open pull request, each check whose result is new, whether it was new when you opened the
row or arrived while it was open, keeps its own **new** mark until you close the row. Run `packrat pr seen --all` or
`packrat issues seen --all` to mark a whole tab seen.

The pane needs the [GitHub CLI](https://cli.github.com) (`gh`), signed in to the repository, and a Claude
Code version that loads plugin modules. It is built on Claude Code's plugin module API, which is in early
access and can change between releases.

## What the plugin runs and sends

- **The CLI.** The plugin runs the open-source [Packrat CLI](https://github.com/packratlabs/packrat-cli).
  If `packrat` is on your `PATH`, it uses that. Otherwise it downloads the CLI from GitHub on first use
  and verifies it against the release checksums.
- **Your key.** `packrat login` stores an API key in the macOS Keychain, or in
  `~/.config/packrat/credentials.json` on other platforms. Claude runs `packrat` commands with the key but
  does not read the key itself. In CI, set `PACKRAT_API_KEY` instead.
- **What reaches Packrat.** The plugin talks to Packrat only through the CLI: the queries Claude runs, the
  checks it drafts and the pages it reads.
- **Hooks.** On each Bash command, the plugin looks for `gh pr create` and lets every other command
  through untouched. At the start of a session, it asks GitHub at most once a day whether a newer version
  is out.

## Updates

A plugin installed from the directory updates itself. One installed from Packrat's marketplace updates
only with auto-update on: run `/plugin`, open **Marketplaces**, choose `packrat` and select **Enable
auto-update**. Until then, the plugin says at the start of a session when a newer version is out, and you
update it with `claude plugin update packrat@packrat`, then `/reload-plugins`.

## Skills

| Skill            | What it does                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `packrat:ask`    | Answers questions about production: pull requests, Packrat links, SQL queries and checks. |
| `packrat:checks` | Drafts the checks Packrat runs after a pull request deploys.                              |
| `packrat:setup`  | Sets up Packrat for the repository you're in, from sign-in to the setup pull request.     |

To work on the plugin itself, see [CONTRIBUTING.md](CONTRIBUTING.md).
