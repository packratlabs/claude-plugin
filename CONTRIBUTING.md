# Contributing

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

## Check a change

```sh
claude plugin validate --strict .
claude plugin test .
```

The pane writes every error it meets, newest last, to `~/.config/packrat/pane.log`.
