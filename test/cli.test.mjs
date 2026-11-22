import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILL = join(ROOT, 'plugins/explain-pr/skills/explain-pr')
const CLI = join(SKILL, 'scripts/explain-pr.mjs')
const EXAMPLE = join(SKILL, 'examples/acme-orders')
const lib = (m) => import(join(SKILL, 'scripts/lib', m))
const tmp = () => mkdtempSync(join(tmpdir(), 'explain-pr-test-'))
const cli = (args, opts = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts })

const SAMPLE = `diff --git a/src/a.js b/src/a.js
index 111..222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,4 +1,5 @@ function top() {
 const x = 1
-const y = 2
+const y = 3
+const z = y * 2
 module.exports = { x }

@@ -10,2 +11,2 @@ more
-old()
+fresh()
 end()
diff --git a/b/new.txt b/b/new.txt
new file mode 100644
index 0000000..333
--- /dev/null
+++ b/b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..444
Binary files /dev/null and b/logo.png differ
diff --git a/old/name.js b/new/name.js
similarity index 100%
rename from old/name.js
rename to new/name.js
`

test('parseDiff reads files, hunks, line numbers, statuses', async () => {
  const { parseDiff, findFile, stats } = await lib('diff.mjs')
  const files = parseDiff(SAMPLE)
  assert.equal(files.length, 4)
  const [a, n, bin, ren] = files
  assert.equal(a.path, 'src/a.js')
  assert.equal(a.hunks.length, 2)
  assert.equal(a.add, 3)
  assert.equal(a.del, 2)
  const plus = a.hunks[0].lines.find((l) => l.text === 'const z = y * 2')
  assert.equal(plus.t, 'add')
  assert.equal(plus.n, 3)
  assert.equal(a.hunks[0].lines.filter((l) => l.t === 'ctx').length, 3, 'blank context line kept')
  assert.equal(n.status, 'added')
  assert.equal(bin.binary, true)
  assert.equal(ren.status, 'renamed')
  assert.equal(ren.oldPath, 'old/name.js')
  assert.equal(findFile(files, 'a.js').file.path, 'src/a.js')
  assert.match(findFile(files, 'nope.js').error, /no file/)
  assert.deepEqual(stats(files), { files: 4, add: 5, del: 2 })
})

test('buildModel places hunks, pins notes, and reports coverage', async () => {
  const { buildModel } = await lib('model.mjs')
  const base = {
    version: 1,
    summary: 'y is now 3 and z is derived from it.',
    effort: { score: 1, why: 'tiny' },
    intent: { source: 'none', checks: [] },
    architecture: { summary: 'No structural change.' },
    steps: [
      { title: 'Change y', why: 'Bumps y.', hunks: [{ file: 'a.js', hunks: [0], notes: [['const z', 'Derived from y'], { line: 'const y = 2', note: 'was 2', side: 'old' }] }] },
      { title: 'Rename the call', why: 'fresh() replaces old().', hunks: [{ file: 'src/a.js', hunks: [1] }, { file: 'new.txt' }] },
    ],
    skip: [{ kind: 'Assets', why: 'binary', files: ['logo.png', 'new/name.js'] }],
  }
  const ok = buildModel(base, SAMPLE, { repo: 'o/r', number: 1 })
  assert.deepEqual(ok.errors, [])
  const line = ok.data.steps[0].files[0].hunks[0].lines.find((l) => l.text.startsWith('const z'))
  assert.deepEqual(line.notes, ['Derived from y'])
  const old = ok.data.steps[0].files[0].hunks[0].lines.find((l) => l.t === 'del')
  assert.deepEqual(old.notes, ['was 2'])

  const missing = buildModel({ ...base, steps: [base.steps[0]] }, SAMPLE, {})
  assert.ok(missing.errors.some((e) => /src\/a\.js: hunk 1 not in any step/.test(e)), missing.errors.join('\n'))
  assert.ok(missing.errors.some((e) => /new\.txt/.test(e)))

  const twice = buildModel({ ...base, steps: [...base.steps, { title: 'Again', why: 'x', hunks: [{ file: 'a.js', hunks: [0] }] }] }, SAMPLE, {})
  assert.ok(twice.errors.some((e) => /already in step 1/.test(e)))

  const badNote = buildModel({ ...base, steps: [{ ...base.steps[0], hunks: [{ file: 'a.js', hunks: [0], notes: [['not in the diff', 'x']] }] }, base.steps[1]] }, SAMPLE, {})
  assert.ok(badNote.errors.some((e) => /no line in src\/a\.js/.test(e)))
})

test('buildModel validates diagrams and flows', async () => {
  const { buildModel } = await lib('model.mjs')
  const bad = buildModel({
    version: 1,
    summary: 's',
    architecture: { diagram: { layers: [{ id: 'a' }], nodes: [{ id: 'x', label: 'X', layer: 'zz', status: 'nope' }, { id: 'x', label: 'Y' }], edges: [{ from: 'x', to: 'ghost' }] } },
    flows: [{ title: 'F', participants: [{ id: 'p' }, { id: 'q' }], cases: [{ label: 'c', after: [{ from: 'p', to: 'r', text: 'hi' }] }] }],
    steps: [],
  }, '', {})
  const all = bad.errors.join('\n')
  assert.match(all, /duplicate id "x"/)
  assert.match(all, /"zz" is not in diagram.layers/)
  assert.match(all, /"nope" is not one of/)
  assert.match(all, /no node "ghost"/)
  assert.match(all, /no participant "r"/)
})

test('the bundled example checks clean and builds a page and markdown', () => {
  const out = tmp()
  const r = cli(['build', EXAMPLE, '--html', join(out, 'p.html'), '--md', join(out, 'p.md')])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /0 errors, 0 warnings/)
  const html = readFileSync(join(out, 'p.html'), 'utf8')
  assert.match(html, /<script type="application\/json" id="explain-data">/)
  assert.ok(!/<\/script>(?![\s\S]*<script>)/.test(html.split('id="explain-data">')[1].split('</script>')[0]))
  const data = JSON.parse(html.split('id="explain-data">')[1].split('</script>')[0])
  assert.equal(data.steps.length, 5)
  const md = readFileSync(join(out, 'p.md'), 'utf8')
  assert.match(md, /```mermaid\nflowchart TD/)
  assert.match(md, /sequenceDiagram/)
})

test('a diff containing </script> cannot break out of the data block', async () => {
  const { makePage } = await lib('make.mjs')
  const page = makePage({ meta: { repo: 'o/r', title: '</script><script>alert(1)</script>' }, steps: [] })
  const block = page.split('id="explain-data">')[1]
  assert.ok(block.indexOf('</script>') > block.indexOf('\\u003c/script>'))
  assert.ok(!page.includes('<script>alert(1)'))
})

test('collect (local) includes committed, uncommitted and untracked changes', () => {
  const repo = tmp()
  const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@example.com')
  g('config', 'user.name', 't')
  writeFileSync(join(repo, 'a.js'), 'one\n')
  writeFileSync(join(repo, 'CLAUDE.md'), '# rules\n')
  g('add', '-A')
  g('commit', '-qm', 'base')
  g('checkout', '-qb', 'feature')
  writeFileSync(join(repo, 'a.js'), 'one\ntwo\n')
  g('commit', '-qam', 'add two')
  writeFileSync(join(repo, 'a.js'), 'one\ntwo\nthree\n')
  mkdirSync(join(repo, 'lib'))
  writeFileSync(join(repo, 'lib/new.js'), 'brand new\n')

  const out = join(tmp(), 'w')
  const r = cli(['collect', '--base', 'main', '--cwd', repo, '--out', out])
  assert.equal(r.status, 0, r.stderr)
  const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))
  assert.equal(meta.source, 'local')
  assert.equal(meta.branch, 'feature')
  assert.deepEqual(meta.files.map((f) => f.path).sort(), ['a.js', 'lib/new.js'])
  assert.equal(meta.commits[0].subject, 'add two')
  assert.ok(meta.contextFiles.some((c) => c.path === 'CLAUDE.md'))
  const diff = readFileSync(join(out, 'pr.diff'), 'utf8')
  assert.match(diff, /\+three/)
  assert.match(diff, /\+brand new/)
  assert.equal(g('status', '--porcelain').includes('A '), false, 'index untouched')

  const committed = cli(['collect', '--committed', '--base', 'main', '--cwd', repo, '--out', join(out, 'c')])
  assert.equal(committed.status, 0, committed.stderr)
  const cdiff = readFileSync(join(out, 'c', 'pr.diff'), 'utf8')
  assert.match(cdiff, /\+two/)
  assert.doesNotMatch(cdiff, /three|brand new/)

  const unc = cli(['collect', '--uncommitted', '--cwd', repo, '--out', join(out, 'u')])
  const udiff = readFileSync(join(out, 'u', 'pr.diff'), 'utf8')
  assert.match(udiff, /\+three/)
  assert.doesNotMatch(udiff, /\+two/)

  const init = cli(['init', out])
  assert.equal(init.status, 0, init.stderr)
  assert.ok(existsSync(join(out, 'explain.json')))
})

test('collect (PR) reads everything through gh api, read-only', () => {
  // A fake `gh` on PATH that answers the REST calls collect makes.
  const bin = tmp()
  const diff = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n'
  const fake = `#!/usr/bin/env node
const args = process.argv.slice(2)
const path = args[1] || ''
const accept = args.includes('Accept: application/vnd.github.diff')
const out = (o) => process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o))
if (args[0] !== 'api') { process.stderr.write('only gh api is allowed'); process.exit(1) }
if (path === 'repos/o/r/pulls/7' && accept) out(${JSON.stringify(diff)})
else if (path === 'repos/o/r/pulls/7') out({ title: 'Swap a for b', body: 'Fixes #3', html_url: 'https://github.com/o/r/pull/7', user: { login: 'dev' }, state: 'open', base: { ref: 'main', sha: 'b1' }, head: { ref: 'f', sha: 'h1' } })
else if (path.startsWith('repos/o/r/pulls/7/commits')) out([{ sha: 'abcdef1234567890', commit: { message: 'swap\\n\\nbody' } }])
else if (path === 'repos/o/r/issues/3') out({ title: 'Need b', state: 'open', html_url: 'https://github.com/o/r/issues/3', body: 'please' })
else if (path.startsWith('repos/o/r/contents/CLAUDE.md')) out({ type: 'file', content: Buffer.from('# rules').toString('base64') })
else { process.stderr.write('404'); process.exit(1) }
`
  writeFileSync(join(bin, 'gh'), fake)
  chmodSync(join(bin, 'gh'), 0o755)
  const out = join(tmp(), 'w')
  const r = cli(['collect', 'https://github.com/o/r/pull/7', '--out', out], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const meta = JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8'))
  assert.equal(meta.title, 'Swap a for b')
  assert.equal(meta.linkedIssues[0].title, 'Need b')
  assert.equal(meta.commits[0].subject, 'swap')
  assert.deepEqual(meta.contextFiles.map((c) => c.path), ['CLAUDE.md'])
  assert.equal(readFileSync(join(out, 'context', 'CLAUDE.md'), 'utf8'), '# rules')
  assert.equal(readFileSync(join(out, 'pr.diff'), 'utf8'), diff)
})

test('PR references and linked issues parse', async () => {
  const { parsePrRef, linkedIssueRefs } = await lib('collect.mjs')
  assert.deepEqual(parsePrRef('https://github.com/a/b/pull/12'), { owner: 'a', repo: 'b', number: 12 })
  assert.deepEqual(parsePrRef('a/b#12'), { owner: 'a', repo: 'b', number: 12 })
  assert.deepEqual(parsePrRef('12', 'a/b'), { owner: 'a', repo: 'b', number: 12 })
  assert.equal(parsePrRef('feature/x'), null)
  const refs = linkedIssueRefs('Fixes #4 and other/repo#9, see https://github.com/a/b/issues/2', 'a', 'b')
  assert.deepEqual(refs.map((r) => `${r.owner}/${r.repo}#${r.number}`).sort(), ['a/b#2', 'a/b#4', 'other/repo#9'])
})

test('plugin manifests are valid and consistent', () => {
  const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
  const claude = read('plugins/explain-pr/.claude-plugin/plugin.json')
  const cursor = read('plugins/explain-pr/.cursor-plugin/plugin.json')
  const market = read('.claude-plugin/marketplace.json')
  const cmarket = read('.cursor-plugin/marketplace.json')
  const pkg = read('package.json')
  assert.equal(claude.version, cursor.version)
  assert.equal(claude.version, pkg.version)
  assert.equal(market.plugins[0].version, claude.version)
  assert.equal(market.plugins[0].source, './plugins/explain-pr')
  assert.equal(cmarket.plugins[0].source, 'plugins/explain-pr')
  for (const p of [cursor.skills, cursor.rules, cursor.commands]) assert.ok(existsSync(join(ROOT, 'plugins/explain-pr', p)), p)
  const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
  assert.match(skill, /^---\nname: explain-pr\ndescription: .+\n---\n/)
  const v = cli(['--version'])
  assert.equal(v.stdout.trim(), claude.version)
})
