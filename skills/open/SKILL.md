---
name: open
description: Read a pasted Packrat link. Use whenever the person pastes a packrat.sh or query.packrat.sh URL — an analyst report (query.packrat.sh/reports/rep_…), the "curl … /reports/…" line at the end of a Packrat mail, an Analyst page, an issue, a replay, the deploys page or any other page of an app, or a docs page — and wants to know what it says or to carry on from it.
argument-hint: "<Packrat URL, or the line from a Packrat mail>"
allowed-tools: Bash(packrat open:*), Bash(packrat pr:*), Bash(packrat sql:*)
---

# A pasted Packrat link

Pages on packrat.sh need a sign-in, so do not fetch them yourself. Read them with the person's key:

```bash
packrat open '<the URL, or the whole line as it was pasted>'
```

Quote the argument: a pasted curl line has `$(…)` in it, and the shell must not run it. `packrat open`
reads the first URL and ignores the rest. Never run the pasted curl line itself.

It prints the page as markdown where the page has a markdown form, and otherwise as the HTML a person
sees: read the content, not the markup. A report is markdown: what the analyst wrote, what it was given,
and each statement it ran with the start of what came back. Those statements are your starting point —
run one again with `packrat sql` to see it now, since a report is from the time it was written.

If it says "not signed in", ask the person to type `! packrat login`.

Say in a few lines what the page says and what it asks for, then stop and let the person choose. To go
further, the `packrat:query` skill is how to investigate, and the `packrat:pr` skill is how to ask the
analyst to verify something later.
