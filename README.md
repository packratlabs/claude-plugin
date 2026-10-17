# Packrat for Claude Code

How a pull request went in production, a check that runs later, a Packrat link read in place, and SQL
over every trace and log line your app sent to [Packrat](https://packrat.sh), all through the
[packrat CLI](https://github.com/packratlabs/packrat-cli).

## Install

```
/plugin marketplace add packratlabs/claude-plugin
/plugin install packrat@packrat
! packrat login
```

`packrat login` opens your browser, where you approve the code. It makes a key for
you on this machine, kept in the macOS Keychain (elsewhere in `~/.config/packrat/credentials.json`);
Claude runs `packrat` and never sees it. In CI, set `PACKRAT_API_KEY` instead.

The plugin runs the [packrat CLI](https://github.com/packratlabs/packrat-cli). If `packrat` is on your
`PATH`, it uses that one; otherwise it downloads the pinned release once and checks it against the
release's checksums.

## What it adds

| | |
| --- | --- |
| `packrat:pr` | Packrat through the CLI: how a pull request went (`/packrat:pr 482`), a pasted Packrat link, a question about production, or a check for the analyst to run later. Claude reads `packrat help` for the commands. |
| `packrat:follow-up` | Writes the "Follow-up" section of each pull request: what proves the change worked, how to check it, and when. Packrat judges the deploy against it. A hook refuses `gh pr create` with a description that has none. |

You do not have to type the commands: mention a pull request, paste a Packrat link, or ask why
something is slow, and Claude uses the skill.
