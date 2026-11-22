// Gather everything the agent needs to explain a change, into one work folder:
//   pr.diff       the diff
//   meta.json     title, intent (PR body or commit messages), linked issues, files, context files, config
//   context/      copies of architecture/convention docs (PR mode; local mode points at the repo's own files)
// Read-only: it never checks out, installs or runs the code under review.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { parseDiff, stats } from './diff.mjs'

const CONTEXT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'ARCHITECTURE.md',
  'architecture.md',
  'docs/architecture.md',
  'docs/ARCHITECTURE.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  'CONTRIBUTING.md',
]
const CONTEXT_DIRS = ['.cursor/rules', 'docs/adr', 'docs/adrs', 'docs/decisions', 'adr']
const CONFIG_FILES = ['.explain-pr.yaml', '.explain-pr.yml', '.explain-pr.json']
const MAX_CONTEXT = 30
const MAX_BUFFER = 256 * 1024 * 1024

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const tryRun = (cmd, args, opts) => {
  try {
    return run(cmd, args, opts)
  } catch {
    return null
  }
}
const slugify = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'change'

// "https://github.com/o/r/pull/12", "o/r#12", "o/r/pull/12" or "12" (with --repo or the current repo's remote).
export function parsePrRef(ref, repoHint) {
  let m = ref.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (m) return { owner: m[1], repo: m[2], number: Number(m[3]) }
  m = ref.match(/^([^/\s]+)\/([^/#\s]+)(?:#|\/pull\/)(\d+)$/)
  if (m) return { owner: m[1], repo: m[2], number: Number(m[3]) }
  m = ref.match(/^#?(\d+)$/)
  if (m) {
    const r = repoHint || remoteRepo()
    if (!r) throw new Error(`"${ref}" is a bare PR number; pass --repo owner/repo or run inside a clone of the repo`)
    const [owner, repo] = r.split('/')
    return { owner, repo, number: Number(m[1]) }
  }
  return null
}

function remoteRepo(cwd) {
  const url = tryRun('git', ['remote', 'get-url', 'origin'], { cwd })
  const m = url && url.trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/)
  return m ? `${m[1]}/${m[2]}` : null
}

// Issues the PR body points at: "#12", "fixes #12", "owner/repo#12", or an issue URL.
export function linkedIssueRefs(body, owner, repo) {
  if (!body) return []
  const refs = new Map()
  const add = (o, r, n) => refs.set(`${o}/${r}#${n}`, { owner: o, repo: r, number: Number(n) })
  for (const m of body.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/g)) add(m[1], m[2], m[3])
  for (const m of body.matchAll(/(?:^|[\s(])([\w.-]+)\/([\w.-]+)#(\d+)\b/g)) add(m[1], m[2], m[3])
  for (const m of body.matchAll(/(?:^|[\s(])#(\d+)\b/g)) add(owner, repo, m[1])
  return [...refs.values()].slice(0, 10)
}

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER })
  if (r.error) throw new Error('the GitHub CLI (gh) is needed for PRs: install it and run `gh auth login`')
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || '').trim().split('\n')[0]}`)
  return r.stdout
}
const ghJson = (path) => JSON.parse(gh(['api', path]))
const ghTry = (path) => {
  try {
    return ghJson(path)
  } catch {
    return null
  }
}

function ancestorsOf(files) {
  const dirs = new Set()
  for (const f of files) {
    let d = dirname(f.path)
    while (d && d !== '.' && d !== '/') {
      dirs.add(d)
      d = dirname(d)
    }
  }
  return [...dirs]
}

function workDirFor(out, slug) {
  const dir = out || join(process.env.EXPLAIN_PR_HOME || join(tmpdir(), 'explain-pr'), slug)
  mkdirSync(dir, { recursive: true })
  return dir
}

function summarizeFiles(files) {
  return files.map((f) => ({ path: f.path, ...(f.oldPath !== f.path && { oldPath: f.oldPath }), status: f.status, add: f.add, del: f.del, hunks: f.hunks.length, ...(f.binary && { binary: true }) }))
}

// ---------- pull request (GitHub, read-only through the REST API) ----------
export function collectPr({ ref, repo: repoHint, out }) {
  const p = parsePrRef(ref, repoHint)
  if (!p) throw new Error(`can't read "${ref}" as a pull request`)
  const base = `repos/${p.owner}/${p.repo}`
  const pr = ghJson(`${base}/pulls/${p.number}`)
  const diff = gh(['api', `${base}/pulls/${p.number}`, '-H', 'Accept: application/vnd.github.diff'])
  const files = parseDiff(diff)

  const commits = (ghTry(`${base}/pulls/${p.number}/commits?per_page=100`) || []).map((c) => {
    const [subject, ...rest] = (c.commit?.message || '').split('\n')
    return { sha: c.sha.slice(0, 12), subject, body: rest.join('\n').trim() }
  })

  const linkedIssues = []
  for (const i of linkedIssueRefs(pr.body, p.owner, p.repo)) {
    const issue = ghTry(`repos/${i.owner}/${i.repo}/issues/${i.number}`)
    if (!issue || issue.pull_request) continue
    linkedIssues.push({ ref: `${i.owner}/${i.repo}#${i.number}`, title: issue.title, state: issue.state, url: issue.html_url, body: (issue.body || '').slice(0, 6000) })
  }

  const slug = `${p.repo}-${p.number}`
  const dir = workDirFor(out, slug)
  const ctxDir = join(dir, 'context')
  mkdirSync(ctxDir, { recursive: true })

  // Context docs at the PR's head, so the agent can compare the change to the conventions it was written against.
  const headSha = pr.head.sha
  const contextFiles = []
  const fetchFile = (path) => {
    if (contextFiles.length >= MAX_CONTEXT) return
    const c = ghTry(`${base}/contents/${encodeURI(path)}?ref=${headSha}`)
    if (!c || Array.isArray(c) || c.type !== 'file' || !c.content) return
    const savedAs = join('context', path.replace(/\//g, '__'))
    writeFileSync(join(dir, savedAs), Buffer.from(c.content, 'base64'))
    contextFiles.push({ path, savedAs })
  }
  for (const f of CONTEXT_FILES) fetchFile(f)
  for (const d of ancestorsOf(files).slice(0, 12)) for (const n of ['CLAUDE.md', 'AGENTS.md']) fetchFile(`${d}/${n}`)
  for (const d of CONTEXT_DIRS) {
    const list = ghTry(`${base}/contents/${d}?ref=${headSha}`)
    if (Array.isArray(list)) for (const e of list.filter((e) => e.type === 'file').slice(0, 10)) fetchFile(e.path)
  }
  let config = null
  for (const f of CONFIG_FILES) {
    const c = ghTry(`${base}/contents/${f}?ref=${headSha}`)
    if (c && c.content) {
      config = join('context', f)
      writeFileSync(join(dir, config), Buffer.from(c.content, 'base64'))
      break
    }
  }

  const meta = {
    version: 1,
    source: 'github',
    repo: `${p.owner}/${p.repo}`,
    number: p.number,
    url: pr.html_url,
    title: pr.title,
    author: pr.user?.login,
    state: pr.merged_at ? 'merged' : pr.state,
    body: pr.body || '',
    base: { ref: pr.base.ref, sha: pr.base.sha },
    head: { ref: pr.head.ref, sha: headSha },
    commits,
    linkedIssues,
    contextFiles,
    config,
    stats: stats(files),
    files: summarizeFiles(files),
    workDir: dir,
    slug,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(join(dir, 'pr.diff'), diff)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  return meta
}

// ---------- local branch / working tree ----------
// mode: 'branch' (default: everything since the merge base, including uncommitted and untracked files),
//       'committed' (merge base..HEAD only), 'uncommitted' (HEAD vs working tree + untracked).
export function collectLocal({ cwd = process.cwd(), base, mode = 'branch', out }) {
  const root = tryRun('git', ['rev-parse', '--show-toplevel'], { cwd })?.trim()
  if (!root) throw new Error('not inside a git repository')
  const g = (...args) => run('git', args, { cwd: root })
  const branch = tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root })?.trim() || 'HEAD'
  const headSha = tryRun('git', ['rev-parse', 'HEAD'], { cwd: root })?.trim() || null

  let baseRef = base || defaultBase(root)
  let mergeBase = null
  if (mode !== 'uncommitted') {
    if (!baseRef) throw new Error('could not find a base branch; pass --base <branch>')
    mergeBase = tryRun('git', ['merge-base', baseRef, 'HEAD'], { cwd: root })?.trim()
    if (!mergeBase) throw new Error(`no common ancestor between ${baseRef} and HEAD`)
  }

  const diffArgs = ['diff', '--no-color', '--no-ext-diff', '-M']
  let diff = ''
  if (mode === 'committed') diff = g(...diffArgs, `${mergeBase}..HEAD`)
  else if (mode === 'uncommitted') diff = headSha ? g(...diffArgs, 'HEAD') : ''
  else diff = g(...diffArgs, mergeBase)

  if (mode !== 'committed') {
    // New files an agent created but nobody has `git add`ed yet: diff each against /dev/null without touching the index.
    const untracked = g('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
    for (const f of untracked) {
      const r = spawnSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f], { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER })
      if (r.stdout) diff += (diff && !diff.endsWith('\n') ? '\n' : '') + r.stdout
    }
  }
  const files = parseDiff(diff)

  const range = mode === 'uncommitted' ? null : `${mergeBase}..HEAD`
  const commits = range
    ? (tryRun('git', ['log', '--format=%h%x1f%s%x1f%b%x1e', range], { cwd: root }) || '')
        .split('\x1e')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [sha, subject, body] = s.split('\x1f')
          return { sha, subject, body: (body || '').trim() }
        })
    : []

  const contextFiles = []
  const consider = (p) => {
    if (contextFiles.length < MAX_CONTEXT && existsSync(join(root, p)) && statSync(join(root, p)).isFile()) contextFiles.push({ path: p })
  }
  for (const f of CONTEXT_FILES) consider(f)
  for (const d of ancestorsOf(files)) for (const n of ['CLAUDE.md', 'AGENTS.md']) consider(`${d}/${n}`)
  for (const d of CONTEXT_DIRS) {
    const abs = join(root, d)
    if (existsSync(abs) && statSync(abs).isDirectory()) for (const n of readdirSync(abs).slice(0, 10)) consider(`${d}/${n}`)
  }
  const config = CONFIG_FILES.find((f) => existsSync(join(root, f))) || null

  const repoName = remoteRepo(root) || basename(root)
  const scope = mode === 'uncommitted' ? 'uncommitted' : mode === 'committed' ? `${branch}-committed` : branch
  const slug = `${basename(repoName)}-${slugify(scope)}`
  const dir = workDirFor(out, slug)
  const lastCommit = commits[0]

  const meta = {
    version: 1,
    source: 'local',
    mode,
    repo: repoName,
    repoRoot: root,
    branch,
    title: commits.length === 1 ? lastCommit.subject : `${branch}${baseRef && mode !== 'uncommitted' ? ` vs ${baseRef}` : ''}`,
    body: '',
    base: { ref: mode === 'uncommitted' ? 'HEAD' : baseRef, sha: mode === 'uncommitted' ? headSha : mergeBase },
    head: { ref: mode === 'committed' ? branch : `${branch} (working tree)`, sha: headSha },
    commits,
    linkedIssues: [],
    contextFiles,
    config,
    stats: stats(files),
    files: summarizeFiles(files),
    workDir: dir,
    slug,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(join(dir, 'pr.diff'), diff)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
  return meta
}

function defaultBase(root) {
  const head = tryRun('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd: root })?.trim()
  if (head) return head.replace('refs/remotes/', '')
  for (const b of ['origin/main', 'origin/master', 'main', 'master', 'origin/develop', 'develop']) {
    if (tryRun('git', ['rev-parse', '--verify', '--quiet', b], { cwd: root })) return b
  }
  return null
}
