import { expect, mock, test } from 'claude-code/testing'

const deployedAt = Date.parse('2026-11-07T14:13:38Z')
const merged = [{ number: 572, title: "Show the current month's pace", url: 'https://github.com/a/b/pull/572', mergedAt: '2026-11-07T14:05:00Z' }]
const shown = {
  app: 'colorbook/production', pull: 572, state: 'pending',
  deploys: [{ deployed_at: new Date(deployedAt).toISOString(), verdict: '' }],
  checks: [{
    id: 'chk_1', title: 'The page still loads', what: 'GET /admin/affiliates returns 200.', due_at: '2026-11-07T14:15:07Z',
    closed_at: null, result: '', accepted: '', source: 'follow_up', runs: [],
  }],
}

const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('a pull request deployed minutes ago draws, with the time to its first look', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('auth status')) return answer('Signed in to dlite (org_abc123) as dev')
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(shown))
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => ({ value: undefined }))

  await $.command.run({ command: 'packrat' })
  await clock.settle()

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  expect(JSON.stringify(await pane.drawn())).toContain('first look in 6m 00s')
})

test('a pane open across a reload starts again by itself, with no /packrat', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(shown))
    throw new Error(`unexpected ${argv}`)
  })

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  await clock.settle()
  expect(JSON.stringify(await pane.drawn())).toContain('first look in 6m 00s')
})
