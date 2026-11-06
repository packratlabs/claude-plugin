import { expect, test } from 'claude-code/testing'

import { type Check, type Pr, counts, isLive, orgOf, summary, toPr, verdict, verificationUrl } from '../hooks/logic'

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
  expect(c).toEqual({ failed: 1, pending: 1, passed: 2, inconclusive: 1 })
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
  expect(parts.map(p => p.text)).toEqual(["1 didn't work", '1 pending', '2 worked'])
})

test('View PR opens the verification page on the site, or GitHub without an org', async () => {
  const pr = toPr(merged, { app: 'colorbook/production', pull: 564, state: 'pending', deploys: [], checks: [] })
  const org = orgOf('Signed in to dlite (org_j9m7lj1jp5fg) as derek@dlite.cc.\n')
  expect(verificationUrl(pr, 'http://localhost:3100/', org)).toBe('http://localhost:3100/orgs/org_j9m7lj1jp5fg/apps/colorbook/production/pulls/564')
  expect(verificationUrl(pr, 'https://packrat.sh', null)).toBe('https://github.com/a/b/pull/564')
})
