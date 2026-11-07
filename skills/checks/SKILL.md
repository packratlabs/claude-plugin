---
name: checks
description: Draft the checks Packrat runs in production after a pull request deploys. Use before you open a pull request (gh pr create), or when the plugin's hook asks for a checks draft.
---

# Pull request checks

After a pull request deploys, Packrat's analyst runs its checks against production data and reports
whether the change worked. You draft the checks once, before you open the pull request. The plugin's
hook validates the draft before `gh pr create` runs, and declares it under the pull request's number
once `gh pr create` prints it. The checks are not part of the pull request's description.

## Where the draft goes

Write the draft to `$(git rev-parse --path-format=absolute --git-common-dir)/packrat/checks/<branch>.json`,
where `<branch>` is `git branch --show-current`. The file is inside `.git`, so it is never committed.
Create the directory if it does not exist. When the hook stops `gh pr create`, it names the exact path.

## What a draft holds

A JSON list, one object for each result that would show the change worked:

```json
[
  { "title": "The cart page is faster",
    "what": "p95 latency of GET /cart drops from about 840 ms to under 300 ms, from packrat_spans where name = 'GET /cart'.",
    "after": "1h" },
  { "title": "Totals are correct",
    "what": "On checkout.charge spans, charge.amount equals cart.total for every checkout, including gift cards.",
    "after": "1d" },
  { "title": "No other endpoint slows down",
    "what": "p95 latency of POST /checkout stays at the previous day's level.",
    "after": "1d" }
]
```

- **`title`** names what the check verifies, in at most 80 characters. Write it as the result, such as
  "The cart page is faster", not the task.
- **`what`** is what must be true in production and the data that shows it: a span, a span attribute,
  a log line, an error that stops, or a value that changes. Use exact names, so the check can run
  without further input.
- **`after`** is how long after the deploy the result can first be seen: `10m`, `1h`, `1d`, up to `30d`.
  Use the time the data needs, such as the next run of a daily job or a weekday's traffic.

A pull request holds at most 10 checks. If the change could affect related behavior, add a check for
what must stay the same, such as an error rate or the latency of a related endpoint.

If production cannot show the change at all, such as a change to docs or tests only, write
`{"none": "why production cannot show this change"}` instead.

## Draft once, before the pull request

Draft the checks when the change is ready to open, from the whole diff, not after each edit. If no data
production records would show a result, add the instrumentation first, such as an OpenTelemetry span
attribute that records the outcome (the number of rows a job wrote, or the code path a request took), and
commit it on the same branch. The instrumentation then ships with the change, and the checks have data
from the first look.

Check a draft yourself with `packrat pr checks set --dry-run --file <draft>`.

## Changing the checks

Until a deploy ships the pull request, edit the draft and run `packrat pr checks set <number> --file <draft>`.
Sending again replaces the list. After the deploy, add a check with `packrat check add --pull <number>`.
