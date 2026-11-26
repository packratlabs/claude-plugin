import type { CommandRunInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const deployedAt = Date.parse('2026-11-07T14:13:38Z')
const merged = [{ number: 572, title: "Show the current month's pace", url: 'https://github.com/a/b/pull/572', mergedAt: '2026-11-07T14:05:00Z' }]
const shown = {
  app: 'colorbook/production', pull: 572, state: 'pending',
  deploys: [{ deployed_at: new Date(deployedAt).toISOString(), verdict: '' }],
  checks: [{
    id: 'chk_1', title: 'The page still loads', what: 'GET /admin/affiliates returns 200.', due_at: '2026-11-07T14:15:07Z',
    closed_at: null as string | null, result: '', accepted: '', source: 'follow_up', runs: [],
  }],
}

const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const typed = (args = ''): CommandRunInput => ({ command: 'packrat', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
const placed = { value: { isPlaced: true as const } }
type Pressable = { press: (target: { key: string }) => Promise<void> }
const openRow = async (pane: unknown, clock: { settle: () => Promise<void> }) => {
  await (pane as Pressable).press({ key: 'pr-572' })
  await clock.settle()
}

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
  on('ui.open', async () => placed)

  await $.command.run(typed())
  await clock.settle()

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  await openRow(pane, clock)
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('"deployed ","4m"," ago"')
  expect(drawn).not.toContain('first look')
})

test("a thing the day-after review found draws as a failed check marked review, with what it found under it", async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  const reviewed = {
    ...shown,
    checks: [
      { ...shown.checks[0]!, closed_at: '2026-11-07T14:16:00Z', result: 'passed' },
      { id: 'chk_2', title: 'Rails routes still answer 304 Not Modified', what: 'Rails routes stopped answering 304', due_at: '2026-11-08T14:13:38Z',
        closed_at: '2026-11-08T14:20:00Z', result: 'failed', accepted: '', source: 'day_after', runs: [],
        outcome: 'Deflater runs inside ETag, so no route gets an ETag.' },
    ],
  }
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('auth status')) return answer('Signed in to dlite (org_abc123) as dev')
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(reviewed))
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => placed)

  await $.command.run(typed())
  await clock.settle()

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  await openRow(pane, clock)
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Rails routes still answer 304 Not Modified')
  expect(drawn).toContain('" review"')
  expect(drawn).toContain('Deflater runs inside ETag, so no route gets an ETag.')
  expect(drawn).not.toContain('COLORBOOK')
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
  await openRow(pane, clock)
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
  on('ui.open', async () => placed)

  await $.command.run(typed('issues'))
  await clock.settle()

  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Affiliate links fail')
  expect(drawn).toContain('1 high')
  expect(asked.find(argv => argv.includes(' issues '))).toContain('issues --json --limit 25 --app colorbook/production')
})

test('an open issue shows its ID, and Add to prompt puts the ID in the draft at the cursor', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(shown))
    if (argv.includes(' issues --json')) {
      return answer(JSON.stringify({
        app: 'colorbook', org: 'org_abc123', period: '14d', issues: [
          { id: 'COLORBOOK-9', kind: 'detected', title: 'Affiliate links fail', culprit: null, status: 'unresolved', substatus: 'new',
            severity: 'high', summary: 'Two retailers send no clicks.', events: 12, users: 4, last_seen: null, errors: ['COLORBOOK-3'] },
        ],
      }))
    }
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => placed)
  on('prompt.read', async () => ({ value: { text: 'fix', cursor: 3 } }))
  const fills: { text: string; mode?: string }[] = []
  on('prompt.fill', async (_$, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })

  await $.command.run(typed('issues'))
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  await (pane as unknown as Pressable).press({ key: 'issue-COLORBOOK-9' })
  await clock.settle()
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('COLORBOOK-9')
  expect(drawn).toContain('Add to prompt')
  expect(drawn).not.toContain('"Ask"')

  await (pane as unknown as Pressable).press({ key: 'add-issue-COLORBOOK-9' })
  await clock.settle()
  expect(fills).toEqual([{ text: ' COLORBOOK-9', mode: 'insert' }])
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
  on('ui.open', async () => placed)
  let isShown = true
  on('ui.panes', async () => ({ value: [{ id: 'packrat', title: 'Packrat', isShown, isFocused: isShown, isPlaced: true }] }))

  await $.command.run(typed())
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

test('a repository with no app connected draws the step that sets it up, and asks Packrat one question a poll', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  const asked: string[] = []
  let connected = false
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    asked.push(argv.replace(/^\S+\/bin\/packrat /, 'packrat '))
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (connected && argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(shown))
    if (connected && argv.includes('issues --json')) return answer(JSON.stringify({ app: 'b', org: 'org_a', issues: [] }))
    const said = 'packrat: no app is connected to a/b in org_a (Acme).'
    return { value: { exitCode: 3, stdout: '', stderr: said, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', async () => placed)
  on('ui.panes', async () => ({ value: [{ id: 'packrat', title: 'Packrat', isShown: true, isFocused: true, isPlaced: true }] }))

  await $.command.run(typed())
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('Packrat is not set up for ')
  expect(drawn).toContain('Ask Claude to set up Packrat in this app')
  expect(drawn).not.toContain('No deployed pull requests yet.')
  expect(drawn).not.toContain('no app is connected')

  asked.length = 0
  await clock.advance(60 * 1000)
  expect(asked).toEqual(['packrat issues --json --limit 1'])

  connected = true
  await clock.advance(60 * 1000)
  expect(asked).toContain('packrat pr show 572 --json')
  expect(JSON.stringify(await pane.drawn())).not.toContain('Packrat is not set up')
})

test('a pull request deployed minutes ago draws closed and new, and a result that arrives while it is open keeps its chip on the check', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  let answered: object = { ...shown, unread: true }
  const marked: string[] = []
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(answered))
    if (argv.endsWith('pr seen 572')) {
      marked.push(argv)
      return answer('Marked #572 in colorbook/production seen.\n')
    }
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => placed)
  on('ui.panes', async () => ({ value: [{ id: 'packrat', title: 'Packrat', isShown: true, isFocused: true, isPlaced: true }] }))

  await $.command.run(typed())
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 60, placement: 'dock' } as never,
  })
  const closed = JSON.stringify(await pane.drawn())
  expect(closed).not.toContain('The page still loads')
  expect(closed).toContain('" new "')

  await openRow(pane, clock)
  const opened = JSON.stringify(await pane.drawn())
  expect(marked).toHaveLength(1)
  expect(opened).toContain('The page still loads')
  expect(opened).not.toContain('" new "')

  answered = { ...shown, state: 'confirmed', unread: true, checks: [{ ...shown.checks[0]!, closed_at: '2026-11-07T14:16:00Z', result: 'passed', new: true }] }
  await clock.advance(2 * 60 * 1000)
  await clock.settle()
  const drawn = JSON.stringify(await pane.drawn())
  expect(marked).toHaveLength(2)
  expect(drawn).toContain('worked')
  expect(drawn).not.toContain('PR Verifications (1)')
  expect(drawn).toContain('" new "')
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
    return placed
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
  on('ui.open', async () => placed)
  // What the module wrote before the reload: its own variables are gone, and the session's state is not.
  on('state.get', () => ({ value: { value: { shape: 'created-1', value: [{ number: 580, title: 'Add a filter', url: created, mergedAt: '' }] }, version: 1 } }))

  await $.command.run(typed())
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
    if (argv.endsWith('issues --json --limit 1')) return answer(JSON.stringify({ app: 'shop', org: 'org_a', issues: [] }))
    throw new Error(`unexpected ${argv}`)
  })
  let opened = 0
  on('ui.open', async () => {
    opened++
    return placed
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
    return placed
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

test('a settled pull request nests the issue its failed check opened under it, with what fixed it', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  let answered: object = shown
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify(answered))
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => placed)
  on('ui.panes', async () => ({ value: [{ id: 'packrat', title: 'Packrat', isShown: true, isFocused: true, isPlaced: true }] }))

  await $.command.run(typed())
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })
  await openRow(pane, clock)

  answered = {
    ...shown, state: 'partly', settled: true,
    checks: [{ ...shown.checks[0]!, closed_at: '2026-11-07T14:16:00Z', result: 'failed', source: 'day_after', outcome: 'Old lists leave Aritzia out.' }],
    issues: [{ id: 'COLORBOOK-271', link: 'opened', status: 'resolved', fixed_by: 596, check: 'chk_1' }],
  }
  await clock.advance(2 * 60 * 1000)
  await clock.settle()
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain('✓ 1 worked')
  expect(drawn).toContain("│ Didn't work · fixed by ")
  expect(drawn).not.toContain('1 partly')
  expect(drawn).toContain('COLORBOOK-271')
  expect(drawn).toContain('" · fixed by "')
  expect(drawn).toContain('#","596')
  expect(drawn).not.toContain('Old lists leave Aritzia out.')
})

test('a changed pull request draws a new chip and a count on its tab, and opening it marks it seen', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 3 * 60 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  const passed = { ...shown.checks[0]!, closed_at: '2026-11-07T14:16:00Z', result: 'passed', new: true }
  const marked: string[] = []
  const opened: string[] = []
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.endsWith('pr show 572 --json')) return answer(JSON.stringify({ ...shown, org: 'org_abc', state: 'confirmed', unread: true, checks: [passed] }))
    if (e.argv[0] === 'open') {
      opened.push(e.argv[1]!)
      return answer('')
    }
    if (argv.endsWith('pr seen 572')) {
      marked.push(argv)
      return answer('Marked #572 in colorbook/production seen.\n')
    }
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => placed)

  await $.command.run(typed())
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat PR Verifications', isFocused: true, bodyColumns: 72, placement: 'dock' } as never,
  })
  const before = JSON.stringify(await pane.drawn())
  expect(before).toContain('PR Verifications (1)')
  expect(before).toContain('" new "')
  expect(marked).toEqual([])

  await (pane as unknown as { press: (target: { key: string }) => Promise<void> }).press({ key: 'pr-572' })
  await clock.settle()
  const after = JSON.stringify(await pane.drawn())
  expect(marked).toHaveLength(1)
  expect(after).not.toContain('PR Verifications (1)')
  // The check whose result was new keeps its chip while the row is open.
  expect(after).toContain('" new "')
  expect(after).toContain('The page still loads')

  await (pane as unknown as { press: (target: { key: string }) => Promise<void> }).press({ key: `check-${passed.id}` })
  await clock.settle()
  expect(opened).toEqual([`https://packrat.sh/orgs/org_abc/apps/colorbook/production/checks/${passed.id}`])
  expect(JSON.stringify(await pane.drawn())).not.toContain('" new "')
})

test('a pr show that throws keeps the row it drew last, and the next poll reads it again', async ($, on) => {
  const clock = mock.clock(on, { now: deployedAt + 4 * 60 * 1000 })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  let throws = false
  let reads = 0
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer('a/b\n')
    if (argv.startsWith('gh pr list')) return answer(JSON.stringify(merged))
    if (argv.includes('issues --json')) return answer(JSON.stringify({ app: 'colorbook/production', org: 'org_a', issues: [] }))
    if (argv.endsWith('pr show 572 --json')) {
      reads += 1
      if (throws) throw new Error('aborted: still running after 30000ms')
      return answer(JSON.stringify(shown))
    }
    throw new Error(`unexpected ${argv}`)
  })
  on('ui.open', async () => placed)
  on('ui.panes', async () => ({ value: [{ id: 'packrat', title: 'Packrat', isShown: true, isFocused: true, isPlaced: true }] }))

  await $.command.run(typed())
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: true, bodyColumns: 80, placement: 'dock' } as never,
  })

  throws = true
  const before = reads
  await clock.advance(60 * 1000)
  expect(reads).toBe(before + 1)
  const drawn = JSON.stringify(await pane.drawn())
  expect(drawn).toContain("Show the current month's pace")
  expect(drawn).toContain('packrat pr show 572')

  throws = false
  await clock.advance(60 * 1000)
  expect(reads).toBe(before + 2)
  expect(JSON.stringify(await pane.drawn())).not.toContain('packrat pr show 572')
})
