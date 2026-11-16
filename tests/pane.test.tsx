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

  await $.command.run({ command: 'packrat' })
  await clock.settle()

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('"deployed ","4m"," ago"')
  expect(drawn).not.toContain('first look')
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
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('"deployed ","4m"," ago"')
  expect(drawn).not.toContain('first look')
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

  await $.command.run({ command: 'packrat' })
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

test('a pull request that opened by itself while live stays open once its verdict arrives', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  let answered = shown
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(answered))
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: [{ id: 'packrat', title: 'Packrat', isShown: true, isFocused: true, isPlaced: true }] }))

  await $.command.run({ command: 'packrat' })
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  expect(JSON.stringify(await pane.drawn())).toContain('The page still loads')

  answered = { ...shown, state: 'confirmed', checks: [{ ...shown.checks[0]!, closed_at: '2026-11-07T14:16:00Z', result: 'passed' }] }
  await clock.advance(2 * 60 * 1000)
  await clock.settle()
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('worked')
  expect(drawn).toContain('The page still loads')
})

const created = 'https://github.com/a/b/pull/580'
// What packrat pr show answers before the deploy: the checks are declared, and none has run.
const declared = { app: 'colorbook/production', pull: 580, state: null, analysed: true, deploys: [], checks: [], declared: [{ title: 'One' }, { title: 'Two' }] }

test('gh pr create in a repository Packrat verifies opens the pane, unfocused, on the new pull request as waiting', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.startsWith('gh pr view 580')) return answer('Add a filter\n')
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(shown))
    if (argv.endsWith('pr show 580 --json')) return answer(JSON.stringify(declared))
    throw new Error(`unexpected ${argv}`)
  })
  const opened: unknown[] = []
  on('ui.open', async (_$, e) => {
    opened.push(e)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: { stdout: `${created}\n`, stderr: '' } }))

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title "Add a filter" --body "x"' })
  await clock.settle()

  expect(JSON.stringify(opened)).toContain('"id":"packrat"')
  expect(JSON.stringify(opened)).not.toContain('"focus":true')
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Add a filter')
  expect(drawn).toContain('waiting for deploy · 2 checks')
  expect(drawn.indexOf('Add a filter')).toBeLessThan(drawn.indexOf("Show the current month's pace"))
})

test('a pull request this session opened is still waiting after the plugin reloads', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('auth status')) return answer('Signed in to dlite (org_abc123) as dev')
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(shown))
    if (argv.endsWith('pr show 580 --json')) return answer(JSON.stringify(declared))
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => ({ value: undefined }))
  // What the module wrote before the reload: its own variables are gone, and the session's state is not.
  on('state.get', () => ({ value: { value: { shape: 'created-1', value: [{ number: 580, title: 'Add a filter', url: created, mergedAt: '' }] }, version: 1 } }))

  await $.command.run({ command: 'packrat' })
  await clock.settle()

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Add a filter')
  expect(drawn).toContain('waiting for deploy · 2 checks')
})

test('the first pull request of a new app opens the pane once the hook has declared its checks', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  let asked = 0
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer('[]')
    if (argv.startsWith('gh pr view 580')) return answer('Set up Packrat\n')
    // The app has only its development data, and the hook declares the checks after the first question.
    if (argv.endsWith('pr show 580 --json')) return answer(JSON.stringify({ ...declared, app: 'shop/development', analysed: false, declared: ++asked > 2 ? declared.declared : [] }))
    throw new Error(`unexpected ${argv}`)
  })
  let opened = 0
  on('ui.open', async () => {
    opened++
    return { value: undefined }
  })
  on('tool.call', () => ({ result: { stdout: `${created}\n`, stderr: '' } }))

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  await clock.settle()
  await clock.advance(2_000)
  await clock.settle()
  await clock.advance(2_000)
  await clock.settle()

  expect(opened).toBe(1)
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: false, bodyColumns: 60, placement: 'dock' } as never,
  })
  expect(JSON.stringify(await pane.drawn())).toContain('waiting for deploy · 2 checks')
})

test('gh pr create in a repository Packrat does not verify opens nothing, and asks only the one question', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  const asked: string[] = []
  on('process.run', async (_$, e) => {
    asked.push(e.argv.slice(1).join(' '))
    return { value: { exitCode: 1, stdout: '', stderr: 'packrat pr show: no app is connected to a/b on GitHub.', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  let opened = 0
  on('ui.open', async () => {
    opened++
    return { value: undefined }
  })
  on('tool.call', () => ({ result: { stdout: `${created}\n`, stderr: '' } }))

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  await clock.settle()

  expect(opened).toBe(0)
  expect(asked).toEqual(['pr show 580 --json'])
})

test('a Bash command that is not gh pr create, or one that failed, asks nothing', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  let asked = 0
  on('process.run', async () => {
    asked++
    return answer('')
  })
  on('tool.call', (_$, e) => (String((e as { command?: string }).command).startsWith('gh pr create')
    ? { result: { stdout: 'a pull request for branch "f" already exists\n', stderr: '' }, isError: true }
    : { result: { stdout: `${created}\n`, stderr: '' } }))

  await $.tool.call({ tool: 'Bash', command: 'gh pr view 580' })
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' })
  await clock.settle()

  expect(asked).toBe(0)
})
