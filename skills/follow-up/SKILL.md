---
name: follow-up
description: Write the "Follow-up" section of a pull request — what proves the change worked in production, how to check it, and when the answer is expected. Use whenever you create or edit a pull request's description (gh pr create, gh pr edit), so Packrat can verify the deploy against it.
---

# The Follow-up section of a pull request

Packrat reads each pull request's `## Follow-up` section when its deploy goes live, and judges the
deploy against it: worked, worked in part, or did not work. A pull request without one is judged on
its title alone. So every pull request you open gets one, after the summary.

Write it from what the change does, not from what the tests show — the tests passed already. Each
bullet says:

- **What proves it worked**, as something production records: a span, a span attribute, a log line,
  an error that stops, a count that changes. Name the span, the attribute or the log line exactly.
- **How to check it**, in terms of that data, so the check can be run without asking you.
- **When the answer is expected**: at the deploy, within an hour, after tomorrow's 03:00 run, when
  traffic is back on Monday.

Include what must *not* change as well — error rates, request counts, latency of the page next to it —
when the change could plausibly break it.

If nothing in production would show the result, say so, and add what would: an OpenTelemetry span
attribute that records the result (how many rows a job wrote, which branch a request took). A change
whose result is invisible cannot be verified.

```markdown
## Follow-up

- **The cart page is faster.** p95 of `GET /cart` falls from about 840 ms to under 300 ms. Expected within an hour of the deploy.
- **Totals stay right.** `checkout.charge` spans: `charge.amount` equals `cart.total` on every checkout, gift cards included. Expected within a day.
- **Nothing else slows down.** p95 of `POST /checkout` stays where it was the day before.
```

When something can only be checked later than the first look — a job that runs next week — ask
Packrat to verify it then, with the `packrat:pr` skill (`packrat pr <number> watch`), once the pull request has a number.
