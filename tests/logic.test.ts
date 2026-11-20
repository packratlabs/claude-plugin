import { expect, test } from 'claude-code/testing'

import { type Check, type Pr, checkGlyph, checkUrl, issueLinkParts, linkedIssueUrl, linkedPullUrl, checkName, checkWhen, counts, createdPull, waitingLine, progress, deployed, isSettled, wrap, rereadAfter, summary, toPr, verdict, verificationUrl } from '../hooks/logic'

const check = (over: Partial<Check>): Check => ({
  id: 'chk_1', title: 'A check', what: 'what', due_at: '2026-11-06T12:00:00Z', closed_at: null,
  result: null, source: 'follow_up', runs: [], ...over,
})
const merged = { number: 564, title: 'Fewer slow reads', url: 'https://github.com/a/b/pull/564', mergedAt: '2026-11-04T17:00:48Z' }
const now = Date.parse('2026-11-06T12:00:00Z')

test('a confirmed or fixed pull request worked, a refuted one did not', async () => {
  expect(verdict('confirmed')).toBe('worked')
  expect(verdict('fixed')).toBe('worked')
  expect(verdict('refuted')).toBe('didnt')
  expect(verdict('not_observable')).toBe('none')
  expect(verdict(null)).toBe('none')
})

test('counts each check by its result, and an open one with none as pending', async () => {
  const c = counts([
    check({ result: 'failed' }), check({ result: 'passed' }), check({ result: 'passed' }),
    check({ result: '' }), check({ result: 'inconclusive' }),
    check({ result: null, closed_at: '2026-11-05T00:00:00Z' }),
  ])
  expect(c).toEqual({ failed: 1, excused: 0, pending: 1, passed: 2, inconclusive: 1 })
})

test('a failed check with the reason the deploy still worked is excused, not failed', async () => {
  const excused = check({ result: 'failed', accepted: 'Slow reads halved, and the run finished under 5 h.', closed_at: '2026-11-05T13:00:00Z' })
  expect(checkGlyph(excused)).toEqual({ glyph: '⊘', tone: 'subtle' })
  expect(checkGlyph(check({ result: 'failed', accepted: '' }))).toEqual({ glyph: '✗', tone: 'error' })
  expect(counts([excused, check({ result: 'failed' })])).toEqual({ failed: 1, excused: 1, pending: 0, passed: 0, inconclusive: 0 })
})

test('a check closed with no result is shown as closed on the day it closed, not as due', async () => {
  const closed = check({ result: '', closed_at: '2026-11-04T13:35:52Z', due_at: '2026-11-03T00:00:00Z' })
  expect(checkGlyph(closed)).toEqual({ glyph: '•', tone: 'subtle' })
  expect(checkGlyph(check({ result: '' }))).toEqual({ glyph: '◷', tone: 'suggestion' })
  expect(checkWhen(closed, now)).toBe('4 Nov')
  expect(checkWhen(check({ result: 'passed', closed_at: '2026-11-05T00:00:00Z', runs: [{ at: '2026-11-04T09:00:00Z', result: 'passed', evidence: 'e' }] }), now)).toBe('4 Nov')
  expect(checkWhen(check({ due_at: '2026-11-06T11:00:00Z' }), now)).toBe('next look')
})

test('an open check counts down to when it runs, not to when it is due', async () => {
  const at = Date.parse('2026-11-06T12:00:00Z')
  expect(checkWhen(check({ due_at: '2026-11-07T11:13:00Z', runs_at: '2026-11-07T12:08:00Z' }), at)).toBe('7 Nov')
  expect(checkWhen(check({ due_at: '2026-11-06T13:13:00Z', runs_at: '2026-11-06T14:08:00Z' }), at)).toBe('in 2h 08m')
  expect(checkWhen(check({ due_at: '2026-11-06T13:13:00Z' }), at)).toBe('in 1h 13m')
  expect(checkWhen(check({ due_at: '2026-11-11T19:13:00Z', runs_at: '2026-11-11T20:08:00Z' }), at)).toBe('11 Nov')
})

test('a check further off is shown to a coarser unit', async () => {
  const at = Date.parse('2026-11-06T12:00:00Z')
  expect(checkWhen(check({ due_at: '2026-11-06T12:41:30Z' }), at)).toBe('in 42m')
  expect(checkWhen(check({ due_at: '2026-11-06T17:59:00Z' }), at)).toBe('in 5h 59m')
  expect(checkWhen(check({ due_at: '2026-11-07T07:54:00Z' }), at)).toBe('in 20h')
})

test('a check with no title is named by its first sentence, less the pull request and commit', async () => {
  expect(checkName(check({ title: '', what: 'PR #559 (1f443d6a): the 3 Nov 01:00 UTC category scrape read all 5 Quince bag lists (satchels). More.' })))
    .toBe('The 3 Nov 01:00 UTC category scrape read all 5 Quince bag lists (satchels)')
  expect(checkName(check({ title: null, what: '' }))).toBe('chk_1')
})

test('the summary adds the verdicts up', async () => {
  const at = (state: string | null, deployed: string) => toPr(merged, { app: 'colorbook/production', pull: 1, state, deploys: [{ deployed_at: deployed, verdict: null }], checks: [] })
  const parts = summary([at('pending', '2026-11-06T11:50:00Z'), at('refuted', '2026-11-01T00:00:00Z'), at('confirmed', '2026-11-01T00:00:00Z'),
    at('confirmed', '2026-11-02T00:00:00Z'), at('not_observable', '2026-11-02T00:00:00Z'), at('archived', '2026-11-02T00:00:00Z')])
  expect(parts.map(p => p.text)).toEqual(["✗ 1 didn't work", '◷ 1 pending', '✓ 2 worked', '– 1 not verified'])
})

test('the pane lists only pull requests a deploy has shipped', async () => {
  const shipped = toPr(merged, { app: 'colorbook/production', pull: 564, state: 'pending', deploys: [{ deployed_at: '2026-11-06T11:30:00Z', verdict: null }], checks: [] })
  const waiting = toPr({ ...merged, number: 565 }, { app: 'colorbook/production', pull: 565, state: null, deploys: [], checks: [] })
  const unknown = toPr({ ...merged, number: 566 }, null)
  expect(deployed([shipped, waiting, unknown]).map(pr => pr.number)).toEqual([564])
})

test('a check links to its own page on the site, or nowhere without an org', async () => {
  const check = { id: 'chk_1' } as Check
  const pr = toPr(merged, { app: 'colorbook/production', org: 'org_j9m7lj1jp5fg', pull: 564, state: 'pending', deploys: [], checks: [check] })
  expect(checkUrl(pr, check, 'http://localhost:3100/')).toBe('http://localhost:3100/orgs/org_j9m7lj1jp5fg/apps/colorbook/production/checks/chk_1')
  expect(checkUrl({ ...pr, org: null }, check, 'https://packrat.sh')).toBeNull()
})

test('View PR opens the verification page on the site, or GitHub without an org', async () => {
  const pr = toPr(merged, { app: 'colorbook/production', org: 'org_j9m7lj1jp5fg', pull: 564, state: 'pending', deploys: [], checks: [] })
  expect(verificationUrl(pr, 'http://localhost:3100/')).toBe('http://localhost:3100/orgs/org_j9m7lj1jp5fg/apps/colorbook/production/pulls/564')
  const older = toPr(merged, { app: 'colorbook/production', pull: 564, state: 'pending', deploys: [], checks: [] })
  expect(verificationUrl(older, 'https://packrat.sh')).toBe('https://github.com/a/b/pull/564')
})

test('an answer is settled once it has a verdict and no check open, or a day after a merge no deploy shipped', async () => {
  const deploys = [{ deployed_at: '2026-11-05T00:00:00Z', verdict: 'confirmed' }]
  const answer = (state: string | null, checks: Check[] = [], shipped = deploys) => ({ app: 'colorbook/production', pull: 564, state, deploys: shipped, checks })
  expect(isSettled(merged, answer('confirmed', [check({ result: 'passed', closed_at: '2026-11-05T13:00:00Z' })]), now)).toBe(true)
  expect(isSettled(merged, answer('refuted'), now)).toBe(true)
  expect(isSettled(merged, answer('pending'), now)).toBe(false)
  expect(isSettled(merged, answer('partly', [check({})]), now)).toBe(false)
  expect(isSettled(merged, answer(null, [], []), now)).toBe(true)
  expect(isSettled({ ...merged, mergedAt: '2026-11-06T11:00:00Z' }, answer(null, [], []), now)).toBe(false)
  expect(isSettled(merged, null, now)).toBe(false)
})

test('a pending pull request is read every minute in its first hour, then every five minutes', () => {
  const merged = { number: 1, title: 't', url: 'u', mergedAt: '2026-11-07T10:00:00Z' }
  const deployedAt = Date.parse('2026-11-07T10:05:00Z')
  const answer = { app: 'a/production', pull: 1, state: 'pending', deploys: [{ deployed_at: '2026-11-07T10:05:00Z', verdict: null }], checks: [] }
  expect(rereadAfter(merged, answer, deployedAt + 30 * 60 * 1000)).toBe(0)
  expect(rereadAfter(merged, answer, deployedAt + 2 * 60 * 60 * 1000)).toBe(5 * 60 * 1000)
  expect(rereadAfter(merged, { ...answer, state: 'confirmed' }, deployedAt + 2 * 60 * 60 * 1000)).toBe(15 * 60 * 1000)
  expect(rereadAfter(merged, null, deployedAt)).toBe(0)
})

test('wraps text at spaces so each line can carry the rail', async () => {
  expect(wrap('Checkout times out when the card network is slow', 20)).toEqual(['Checkout times out', 'when the card', 'network is slow'])
  expect(wrap('', 20)).toEqual([])
  expect(wrap('abcdefghij', 4)).toEqual(['abcd'])
})

test('an open rule check says nothing beside its glyph, waits for review as pending, and has no time to wait for', async () => {
  const rule = check({ kind: 'appears', seen: 40, min_seen: 200, due_at: '2026-11-09T12:00:00Z' })
  expect(progress(rule)).toBe('')
  expect(checkWhen(rule, now)).toBe('')
  expect(progress(check({ kind: 'guard', seen: null }))).toBe('')

  const failed = check({ kind: 'guard', seen: 5, min_seen: 1, result: 'failed', review: 'failed' })
  expect(progress(failed)).toBe('to review')
  expect(checkGlyph(failed).tone).toBe(checkGlyph(check({})).tone)
})

test('a pull request gh pr create just opened is read from what it printed, and nothing else is', async () => {
  const url = 'https://github.com/acme/shop/pull/12'
  expect(createdPull('gh pr create --title "Add a filter" --body "x"', `${url}\n`)).toEqual({ repo: 'acme/shop', number: 12, url })
  expect(createdPull('git push -u origin f && gh pr create --fill', `remote: ok\n${url}\n`)?.number).toBe(12)
  expect(createdPull('gh pr create --fill', `Closes https://github.com/acme/shop/pull/3\n${url}\n`)?.number).toBe(12)
  expect(createdPull('gh pr create --web', `${url}\n`)).toBe(null)
  expect(createdPull('gh pr view 12', `${url}\n`)).toBe(null)
  expect(createdPull('git commit -m "run gh pr create later"', `${url}\n`)).toBe(null)
  expect(createdPull('gh pr create --fill', 'a pull request for branch "f" already exists\n')).toBe(null)
})

test('a pull request that has not deployed says so, with the checks it declared', async () => {
  const pr: Pr = { ...merged, app: null, org: null, state: null, deployedAt: null, checks: [], declared: 0, settled: false, issues: [], unread: false }
  expect(waitingLine(pr)).toBe('waiting for deploy')
  expect(waitingLine({ ...pr, declared: 2 })).toBe('waiting for deploy · 2 checks')
  expect(waitingLine({ ...pr, checks: [check({})] })).toBe('waiting for deploy · 1 check')
  expect(waitingLine({ ...pr, checks: [check({}), check({ id: 'chk_2' })] })).toBe('waiting for deploy · 2 checks')
})

test('a pull request that did not work and whose issue is fixed is counted as fixed, not as needing you', async () => {
  const at = (state: string, settled: boolean) => toPr(merged, {
    app: 'colorbook/production', pull: 1, state, deploys: [{ deployed_at: '2026-11-01T00:00:00Z', verdict: null }], checks: [], settled,
    issues: settled ? [{ id: 'COLORBOOK-271', link: 'opened', status: 'resolved', fixed_by: 596 }] : [],
  })
  expect(summary([at('partly', true), at('partly', false), at('confirmed', false)]).map(p => p.text)).toEqual(['◐ 1 partly', '✓ 1 worked', '◐ 1 fixed'])
})

test('an issue link reads one way: opened and fixed by on the one that broke it, fixes from on the fix', async () => {
  expect(issueLinkParts({ id: 'COLORBOOK-271', link: 'opened', status: 'resolved', fixed_by: 596 }))
    .toEqual([{ text: 'opened ' }, { issue: 'COLORBOOK-271' }, { text: ' · fixed by ' }, { pull: 596 }])
  expect(issueLinkParts({ id: 'COLORBOOK-271', link: 'opened', status: 'unresolved' })).toEqual([{ text: 'opened ' }, { issue: 'COLORBOOK-271' }])
  expect(issueLinkParts({ id: 'COLORBOOK-12', link: 'found', status: 'archived' })).toEqual([{ text: 'found ' }, { issue: 'COLORBOOK-12' }, { text: ' · archived' }])
  expect(issueLinkParts({ id: 'COLORBOOK-271', link: 'fixes', status: 'resolved', from: 593 }))
    .toEqual([{ text: 'fixes ' }, { issue: 'COLORBOOK-271' }, { text: ' from ' }, { pull: 593 }])
})

test('an issue and another pull request open on the site, in the app the pull request was read from', async () => {
  const pr = toPr(merged, { app: 'colorbook/production', org: 'org_abc', pull: 564, state: 'partly', deploys: [], checks: [] })
  expect(linkedIssueUrl(pr, 'COLORBOOK-271', 'https://packrat.sh')).toBe('https://packrat.sh/orgs/org_abc/apps/colorbook/production/issues/COLORBOOK-271')
  expect(linkedPullUrl(pr, 596, 'https://packrat.sh')).toBe('https://packrat.sh/orgs/org_abc/apps/colorbook/production/pulls/596')
  expect(linkedIssueUrl({ ...pr, org: null }, 'COLORBOOK-271', 'https://packrat.sh')).toBeNull()
})
