# Packrat for Claude Code

The Packrat plugin for Claude Code gives Claude access to your app's production data in
[Packrat](https://packrat.sh). Claude can use it to:

- Report how a pull request performed after it was deployed, including the analyst's verdict.
- Read Packrat links, such as a report linked from a Packrat email.
- Query your traces and logs with SQL to investigate production issues.
- Schedule a check that the analyst runs at a later time, with the result sent by email.
- Declare the checks Packrat runs to verify each pull request after it deploys.
- Show how the repository's pull requests did in production, in a pane beside the chat.

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

### Keep it up to date

Claude Code updates a plugin from a marketplace outside Anthropic only when auto-update is on. Run
`/plugin`, open **Marketplaces**, choose `packrat` and select **Enable auto-update**. The `packrat-rails`
generator turns it on for a repository in `.claude/settings.json`.

While auto-update is off, the plugin says at the start of a session when a newer version is out. It
asks GitHub at most once a day. Update it with:

```
claude plugin update packrat@packrat
```

Then run `/reload-plugins` in Claude Code.

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

### Pull request checks

Before Claude opens a pull request with `gh pr create`, the plugin requires a checks draft for the
branch, in `.git/packrat/checks/<branch>.json`. Each check states what shows the change worked in
production, the data that shows it, and how long after the deploy the result is expected. The
`packrat:checks` skill tells Claude how to write one.

- **Before `gh pr create`**, the plugin validates the draft with `packrat pr checks set --dry-run`. If
  there's no draft, or Packrat refuses it, the plugin blocks the command and tells Claude what to fix.
- **After `gh pr create`**, the plugin reads the new pull request's URL and declares the draft with
  `packrat pr checks set`. The checks wait until a deploy ships the pull request, then the analyst runs
  them.

A repository Packrat doesn't verify, or a Packrat the CLI can't reach, never blocks a pull request.
Declaring checks needs `packrat` 0.1.4 or later.

### PR Verifications pane

Type `/packrat` to open a pane that lists the repository's recently deployed pull requests and how
each did in production:

```
Packrat PR Verifications · colorbook/production
◷ 4 pending  ✓ 7 worked

◷ #570 Send J.Crew and J.Crew Factory visits through CJ
  deployed 48m ago
  ? J.Crew visits go to CJ                                6 Nov
  ◷ The CJ sync runs without errors                       in 14h 04m
  [ Ask ] [ View PR ]
✓ #566 Store black colorways from Quince bag lists
✗ #564 Read Loft inventory through Scrapfly in one session per run
```

The mark before each pull request is its verdict: `✓` worked, `✗` did not work, `◐` worked in part,
`◷` pending and `–` not verified. Select a pull request to list its checks, each marked `✓` passed,
`✗` failed, `⊘` excused (it failed, and the analyst says why the deploy still worked), `?` inconclusive,
`◷` due, or `•` closed without a result. **Ask** puts a
`/packrat:ask` prompt in the input for you to send, and **View PR** opens the pull request's page on
Packrat. A merged pull request joins the list once Packrat records the deploy that shipped it,
within seconds of the new version's first request to Packrat, so the pane shows it at its next read. A pull request deployed in the last hour opens by itself. The pane asks nothing until you type
`/packrat`, and nothing while it is closed or behind another tab; it reads again when you bring it back. While it
is on screen it checks every minute, but reads a pull request every minute only in the first hour after its
deploy. After that a pending pull request is read every 5 minutes, since its verdict changes only when the analyst
looks, about once an hour, and one with a verdict and no check still open every 15 minutes. **Refresh** reads
everything at once.

Click **Issues**, press `2` while the pane has focus, or type `/packrat issues`, for the **Issues** tab: the app's unresolved issues, error issues
and AI-detected ones (marked `AI`), in the order of its Issues page on Packrat:

```
1:  PR Verifications   2: [ Issues ]                         shop/production
──────────────────────────────────────────────────────────────────────────
▲ 1 critical  ▲ 2 high  · 3 unrated

▲ AI Gift card carts fail to pay                      new · 41 ev · 9 users
▲ ActiveRecord::RangeError: PG::NumericValueOutOf…   regressed · 6 ev · 2 users
  SHOP-12
  Orders over $21M fail to save.
  OrdersController#create
  regressed · reaches people · 2 users · high
  [ Ask ] [ View issue ]
· NoMethodError: undefined method 'total' for nil     3 ev · 1 user
```

The mark is the severity the analyst's daily summary gave: red `▲` critical, yellow `▲` high, `·` unrated
and `▽` low. Select an issue for its one-line summary; **Ask**
puts a `/packrat:ask` prompt in the input and **View issue** opens it on Packrat. The pane reads only the
tab you are looking at; click **PR Verifications** or press `1` to go back. The tab you are on is drawn in
reverse.

The pane shows only its latest error. Every error it meets is also kept, newest last, in
`~/.config/packrat/pane.log`.

The pane needs:

- The [GitHub CLI](https://cli.github.com) (`gh`), signed in to the repository, to list merged pull
  requests.
- `packrat` 0.1.2 or later, and 0.1.5 or later for the Issues tab. Run `packrat update` if the pane says the
  CLI is too old.
- A Claude Code version that loads plugin modules. The pane is built on Claude Code's plugin module
  API, which is in early access and can change between releases.

## Skills

| Skill | Description |
| --- | --- |
| `packrat:ask` | The entry point to Packrat. Answers questions about production through the CLI: pull requests, Packrat links, SQL queries and checks. |
| `packrat:checks` | Drafts the checks Packrat runs after a pull request deploys. |

## Develop the pane

`script/preview` draws the pane in your terminal from production answers recorded once, so you see a
change to `hooks/` in about a second, without restarting Claude Code or running a server.

```sh
script/preview --fetch            # record what packrat and gh answer for ../packrat
script/preview --width 72         # draw PR Verifications
script/preview --tab issues       # draw Issues
script/preview --press pr-227     # press a button by its key first, such as a pull request's row
```

Run `--fetch` again for newer data. The recordings in `preview/recorded/` hold production data and are
not committed. The drawing is close to Claude Code's but not identical, so check the pane in Claude
Code before you ship a change.
