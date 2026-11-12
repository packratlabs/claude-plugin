import { expect, test } from 'claude-code/testing'

import { type Check, type Pr, checkGlyph, checkName, checkWhen, counts, progress, deployed, isLive, isSettled, wrap, rereadAfter, summary, toPr, verdict, verificationUrl } from '../hooks/logic'

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

test('a pending pull request is live for its first hour after the deploy', async () => {
  const answer = { app: 'colorbook/production', pull: 564, state: 'pending', deploys: [{ deployed_at: '2026-11-06T11:30:00Z', verdict: null }], checks: [] }
  const pr: Pr = toPr(merged, answer)
  expect(isLive(pr, now)).toBe(true)
  expect(isLive(pr, now + 31 * 60 * 1000)).toBe(false)
  expect(isLive({ ...pr, state: 'confirmed' }, now)).toBe(false)
})

test('the summary adds the verdicts up', async () => {
  const at = (state: string | null, deployed: string) => toPr(merged, { app: 'colorbook/production', pull: 1, state, deploys: [{ deployed_at: deployed, verdict: null }], checks: [] })
  const parts = summary([at('pending', '2026-11-06T11:50:00Z'), at('refuted', '2026-11-01T00:00:00Z'), at('confirmed', '2026-11-01T00:00:00Z'), at('confirmed', '2026-11-02T00:00:00Z')])
  expect(parts.map(p => p.text)).toEqual(["✗ 1 didn't work", '◷ 1 pending', '✓ 2 worked'])
})

test('the pane lists only pull requests a deploy has shipped', async () => {
  const shipped = toPr(merged, { app: 'colorbook/production', pull: 564, state: 'pending', deploys: [{ deployed_at: '2026-11-06T11:30:00Z', verdict: null }], checks: [] })
  const waiting = toPr({ ...merged, number: 565 }, { app: 'colorbook/production', pull: 565, state: null, deploys: [], checks: [] })
  const unknown = toPr({ ...merged, number: 566 }, null)
  expect(deployed([shipped, waiting, unknown]).map(pr => pr.number)).toEqual([564])
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

test('an open rule check is pending, waits for review as pending, and has no time to wait for', async () => {
  const rule = check({ kind: 'appears', seen: 40, min_seen: 200, due_at: '2026-11-09T12:00:00Z' })
  expect(progress(rule)).toBe('pending')
  expect(checkWhen(rule, now)).toBe('pending')
  expect(progress(check({ kind: 'guard', seen: null }))).toBe('pending')

  const failed = check({ kind: 'guard', seen: 5, min_seen: 1, result: 'failed', review: 'failed' })
  expect(progress(failed)).toBe('to review')
  expect(checkGlyph(failed).tone).toBe(checkGlyph(check({})).tone)
})
