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

const overviewAnswer = {
  app: 'colorbook/production', org: 'org_abc123',
  report: { id: 'rep_1', subject: 'Watch (afternoon): deploys recorded early', at: new Date(deployedAt - 2 * 3600_000).toISOString(),
            from: new Date(deployedAt - 8 * 3600_000).toISOString(), to: new Date(deployedAt - 2 * 3600_000).toISOString() },
  items: [
    { status: 'watch', title: 'Migration pod records deploys early', changed: 'Two migrations logged their versions half a minute early.',
      matters: 'Deploy times read early.', evidence: '31s and 29s early.', next: 'Have ingest ignore the migration pod.', issue: 'COLORBOOK-70', pull: null,
      chart: { kind: 'bars', unit: 's', caption: 'seconds early by hour', rows: [['2026-11-07 06:00', 0, false], ['2026-11-07 07:00', 31, true]] } },
    { status: 'shipped', title: 'Palette cached', changed: 'The palette is cached.', matters: '', evidence: '', next: 'Nothing.', issue: null,
      pull: { number: 560, title: 'Cache the palette', state: 'refuted', label: 'Did not work', url: null }, chart: null },
  ],
}

const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('a pull request deployed minutes ago draws, with when it deployed', async ($, on) => {
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

  await $.command.run({ command: 'packrat', args: 'pulls' })
  await clock.settle()

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('"deployed ","4m"," ago"')
  expect(drawn).not.toContain('first look')
})

test('a pane open across a reload starts again by itself on the Overview, with no /packrat', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(shown))
    if (argv.endsWith('overview --json')) return answer(JSON.stringify(overviewAnswer))
    throw new Error(`unexpected ${argv}`)
  })

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  await clock.settle()
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Migration pod records deploys')
})

test("/packrat opens the Overview: the latest summary's items, the first problem open, a shipped one marked by its verification", async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(shown))
    if (argv.endsWith('overview --json')) return answer(JSON.stringify(overviewAnswer))
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => ({ value: undefined }))

  const said = await $.command.run({ command: 'packrat' })
  await clock.settle()

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: true, bodyColumns: 64, placement: 'dock' } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(JSON.stringify(said)).toContain('Opened the Overview')
  for (const text of ['Latest summary', '2h', 'Migration pod records deploys early', '▁█', 'COLORBOOK-70', 'What changed', 'Two migrations logged', 'Why it matters', 'Evidence', '"Next"', 'Have ingest ignore',
    'seconds early by hour', '✗', 'Palette cached', '#560 Did not work']) {
    expect(drawn).toContain(text)
  }
  expect(drawn).not.toContain('The palette is cached.')
})

test('/packrat issues opens the Issues tab, asking for the app the pull requests named', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  const asked: string[] = []
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    asked.push(argv)
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(shown))
    if (argv.includes(' issues --json')) {
      return answer(JSON.stringify({
        app: 'colorbook', org: 'org_abc123', period: '14d', issues: [
          { id: 'COLORBOOK-9', kind: 'detected', title: 'Affiliate links fail', culprit: null, status: 'unresolved', substatus: 'new',
            severity: 'high', summary: null, state: 'Two retailers send no clicks.', events: 12, users: 4, last_seen: null, errors: ['COLORBOOK-3'] },
        ],
      }))
    }
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => ({ value: undefined }))

  await $.command.run({ command: 'packrat', args: 'issues' })
  await clock.settle()

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Affiliate links fail')
  expect(drawn).toContain('1 high')
  expect(asked.find(argv => argv.includes(' issues '))).toContain('issues --json --limit 25 --app colorbook --environment production')
})

test('a pane behind another tab asks Packrat nothing, and an old pending pull request is read every five minutes', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 3 * 60 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  let reads = 0
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) {
      reads += 1
      return answer(JSON.stringify(shown))
    }
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => ({ value: undefined }))
  let isShown = true
  on('ui.panes', async () => ({ value: [{ id: 'packrat', title: 'Packrat', isShown, isFocused: isShown, isPlaced: true }] }))

  await $.command.run({ command: 'packrat', args: 'pulls' })
  await clock.settle()
  const first = reads

  await clock.advance(3 * 60 * 1000)
  expect(reads).toBe(first)
  await clock.advance(3 * 60 * 1000)
  expect(reads).toBe(first + 1)

  isShown = false
  await clock.advance(20 * 60 * 1000)
  expect(reads).toBe(first + 1)
})
