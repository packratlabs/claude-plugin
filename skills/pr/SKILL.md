---
name: pr
description: How a GitHub pull request went in production, from Packrat. Use when someone pastes a pull request URL or names a pull request number ("PR 482", "#482") and asks how it went, whether it worked, what Packrat found, or to follow up on it — and to ask Packrat's analyst to verify a pull request at a later time, or to see whether that check came back.
argument-hint: "<pull request number or URL>"
allowed-tools: Bash(packrat pr:*), Bash(packrat open:*), Bash(packrat sql:*), Bash(packrat check:*)
---

# A pull request in Packrat

Packrat looks at each deploy ten minutes after it goes live and judges it against what its pull
request said it would do, using the pull request's "Follow-up" section. You read that judgment, and
you can ask Packrat to verify more at a later time.

The pull request: $ARGUMENTS

If a command says "not signed in", ask the person to type `! packrat login` and to approve the code
in their browser. Do not try to sign in for them.

## 1. Read what Packrat has

```bash
packrat pr show <number or URL> --json
```

- `deploys`, newest first. Each has `verdict` — `confirmed` (it worked), `partly`, `refuted` (it did
  not), `too_early`, `not_observable`, or `null` before the analyst's first look — and `intent`
  (what the pull request asked for), `evidence` (what the data showed), `next_step`, and `follow_up`
  (the pull request's own Follow-up section).
- `checks`: what was asked to be verified later for this pull request, with `due_at`, and `outcome`
  once the analyst has closed it.
- `report` on a deploy is the analyst's mail. `packrat open https://query.packrat.sh/reports/<report>`
  reads it, with the SQL it ran and what came back.

Tell the person, in a few lines: the verdict and its evidence, the next step, and each check with its
due time or its outcome. Then stop and let them choose; do not start work on your own.

When there is no deploy: say that the pull request has not shipped yet, or, when `repository` is
empty, that the app's GitHub repository is not connected in Packrat (the app's Analyst page). When
`analysed` is false, the analyst is off for the app, so no deploy gets a verdict and no check is
read. The app is the one connected to the pull request's repository; `--app <service>` names another.

## 2. When they ask why, or to fix it

Run the evidence again before you trust it — the verdict is from the time of the look, and the data
has moved on. Use the `packrat:query` skill for this: start from the SQL in the report, then widen.
Find the cause in the code, and say what you found before you change anything.

## 3. When something can only be verified later

A job that runs tomorrow, a cleanup that is safe after two quiet weeks, a fix that only shows once
traffic comes back: ask Packrat's analyst to verify it then. Do not leave it as a note for a person.

1. Write what must be true, and the SQL that shows it. Bound the SQL with `since` and `until`.
2. Run that SQL one time now with `packrat sql`, so you know it runs and what it returns today.
3. Say what to do with each answer.
4. Send it, with `--due` as the first time it can be true, in UTC, at most 30 days ahead:

```bash
packrat check add --pull <number> --due 2026-10-20T21:00Z <<'TEXT'
The gift card total is right on every checkout since the fix: no checkout where the charged amount
differs from the page total. If any, reopen #482 with the trace ids.

select count(*) from packrat_spans(since := now() - interval 3 day)
where name = 'checkout.charge' and attributes['cart.total'] != attributes['charge.amount']
TEXT
```

The analyst runs it in its first look after that time and mails the team what the data showed, in
the thread of the pull request's verdict mail. `packrat pr show <number>` lists the check until then.
To change a check, close it with `packrat check close <chk_id>` and send another.
