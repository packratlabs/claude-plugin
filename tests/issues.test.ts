import { expect, test } from 'claude-code/testing'

import { type Issue, issueDetails, issueSummary, issueTally, issueUrl, severityMark } from '../hooks/logic'

const issue = (over: Partial<Issue>): Issue => ({
  id: 'SHOP-2', kind: 'error', title: 'NoMethodError', culprit: 'CartsController#show', status: 'unresolved', substatus: 'ongoing',
  severity: null, summary: null, events: 3, users: 1, last_seen: '2026-11-07T10:00:00Z', ...over,
})

test('the summary counts issues by severity, worst first', () => {
  const parts = issueSummary([issue({ severity: 'high' }), issue({}), issue({ severity: 'critical' }), issue({ severity: 'high' })])
  expect(parts.map(part => part.text)).toEqual(['▲ 1 critical', '▲ 2 high', '· 1 unrated'])
})

test('an unrated issue has the unrated mark', () => {
  expect(severityMark(issue({})).tone).toBe('subtle')
  expect(severityMark(issue({ severity: 'critical' })).tone).toBe('error')
})

test('the tally names a substatus only when it is news', () => {
  expect(issueTally(issue({}))).toBe('3 ev · 1 user')
  expect(issueTally(issue({ users: 0 }))).toBe('3 ev')
  expect(issueTally(issue({ substatus: 'regressed', users: 4 }))).toBe('regressed · 3 ev · 4 users')
})

test('an issue says its one-line summary, and never the analyst\'s notes', () => {
  const found = issue({ kind: 'detected', culprit: null, summary: 'Gift card carts fail to pay.', state: 'Six of ten looks since the deploy saw it.', errors: ['SHOP-1'], pull: 482, reasons: ['rising'] })
  expect(issueDetails(found)).toEqual(['Gift card carts fail to pay.'])
  expect(issueDetails(issue({ kind: 'detected', state: 'Not back.' }))).toEqual([])
  expect(issueDetails(issue({}))).toEqual([])
})

test('View issue opens the page of its environment, or nothing without an org', () => {
  expect(issueUrl(issue({}), { app: 'shop', org: 'org_a' }, 'production', 'https://packrat.sh/')).toBe('https://packrat.sh/orgs/org_a/apps/shop/production/issues/SHOP-2')
  expect(issueUrl(issue({ environment: 'staging' }), { app: 'shop', org: 'org_a' }, 'production', 'https://packrat.sh')).toContain('/shop/staging/issues/')
  expect(issueUrl(issue({}), { app: 'shop' }, 'production', 'https://packrat.sh')).toBeNull()
})
