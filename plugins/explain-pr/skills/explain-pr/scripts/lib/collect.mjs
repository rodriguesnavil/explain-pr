// Gather everything the agent needs to explain a change, into one work folder:
//   pr.diff       the diff
//   meta.json     title, intent (PR body or commit messages), linked issues, files, context files, config
//   context/      copies of architecture/convention docs (PR mode; local mode points at the repo's own files)
// Read-only: it never checks out, installs or runs the code under review.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeSync, closeSync } from 'node:fs'
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
const CONTEXT_DIRS = ['.cursor/rules', '.claude/rules', 'docs/adr', 'docs/adrs', 'docs/decisions', 'adr']
const INTENT_FILES = ['.agent/intent.md', '.claude/intent.md', 'TASK.md', '.task.md']
const CONFIG_FILES = ['.explain-pr.yaml', '.explain-pr.yml', '.explain-pr.json']
const MAX_CONTEXT = 30
const MAX_BUFFER = 256 * 1024 * 1024

// Patterns for files that look like secrets.
const SECRET_NAME_RE = /(?:^|\/)(?:\.env(?:\..+)?|\.?id_rsa[^/]*|credentials[^/]*|[^/]*\.(?:pem|key|p12|pfx|cer|crt|tfvars))$/i
const SECRET_CONTENT_RE = /AKIA[0-9A-Z]{16}|-----BEGIN [A-Z]+ PRIVATE KEY|sk-live-[0-9a-zA-Z]|sk-proj-[0-9a-zA-Z]/

function looksLikeSecret(path) { return SECRET_NAME_RE.test(path) }
function containsSecret(text) { return SECRET_CONTENT_RE.test(text) }

// Redact secret file contents from an already-assembled diff text.
function redactSecrets(diffText) {
  const secretFiles = []
  const lines = diffText.split('\n')
  const result = []
  let inSecretFile = false
  let inHunk = false

  for (const line of lines) {
    if (line.startsWith('diff --git ')) { inSecretFile = false; inHunk = false }
    if (!inSecretFile && line.startsWith('+++ b/')) {
      const path = line.slice(6)
      if (looksLikeSecret(path)) { inSecretFile = true; secretFiles.push(path) }
    }
    if (inSecretFile) {
      if (line.startsWith('@@ ')) {
        result.push(line)
        result.push('+[hidden: looks like a secret — contents not shown]')
        inHunk = true
        continue
      }
      if (inHunk && (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) continue
    }
    result.push(line)
  }
  return { diffText: result.join('\n'), secretFiles }
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const tryRun = (cmd, args, opts) => {
  try {
    return run(cmd, args, opts)
  } catch {
    return null
  }
}
const slugify = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'change'
const repoHash = (root) => createHash('sha256').update(root).digest('hex').slice(0, 6)

// Write a file with restricted permissions (owner-read-write only).
const writeSecure = (p, content) => {
  const fd = openSync(p, 'w', 0o600)
  try {
    if (typeof content === 'string') writeSync(fd, content, 'utf8')
    else writeSync(fd, content)
  } finally { closeSync(fd) }
}

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
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function summarizeFiles(files) {
  return files.map((f) => ({ path: f.path, ...(f.oldPath && f.oldPath !== f.path && { oldPath: f.oldPath }), status: f.status, add: f.add, del: f.del, hunks: f.hunks.length, ...(f.binary && { binary: true }), ...(f.oldMode && { oldMode: f.oldMode }), ...(f.newMode && { newMode: f.newMode }) }))
}

// Read a simple config file (.json or basic key: value YAML — no YAML library needed).
function readConfig(path) {
  try {
    const text = readFileSync(path, 'utf8')
    if (path.endsWith('.json')) return JSON.parse(text)
    const cfg = {}
    for (const line of text.split('\n')) {
      const m = line.match(/^(\w+):\s*(.+)$/)
      if (m) cfg[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim()
    }
    return cfg
  } catch { return {} }
}

// ---------- pull request (GitHub, read-only through the REST API) ----------
export function collectPr({ ref, repo: repoHint, out }) {
  const p = parsePrRef(ref, repoHint)
  if (!p) throw new Error(`can't read "${ref}" as a pull request`)
  const base = `repos/${p.owner}/${p.repo}`
  const pr = ghJson(`${base}/pulls/${p.number}`)

  let diff
  try {
    diff = gh(['api', `${base}/pulls/${p.number}`, '-H', 'Accept: application/vnd.github.diff'])
  } catch (e) {
    if (e.message.includes('406') || e.message.toLowerCase().includes('too large')) {
      throw new Error(`PR diff is too large for GitHub's API. Use --committed or --uncommitted on a local clone instead.`)
    }
    throw e
  }

  // Paginate through all commits (GitHub returns at most 100 per page).
  const allCommits = []
  let page = 1
  while (true) {
    const batch = ghTry(`${base}/pulls/${p.number}/commits?per_page=100&page=${page}`) || []
    for (const c of batch) {
      const [subject, ...rest] = (c.commit?.message || '').split('\n')
      allCommits.push({ sha: c.sha.slice(0, 12), subject, body: rest.join('\n').trim() })
    }
    if (batch.length < 100) break
    page++
  }
  const commits = allCommits

  const { diffText: redacted, secretFiles } = redactSecrets(diff)
  const files = parseDiff(redacted)

  const linkedIssues = []
  for (const i of linkedIssueRefs(pr.body, p.owner, p.repo)) {
    const issue = ghTry(`repos/${i.owner}/${i.repo}/issues/${i.number}`)
    if (!issue || issue.pull_request) continue
    linkedIssues.push({ ref: `${i.owner}/${i.repo}#${i.number}`, title: issue.title, state: issue.state, url: issue.html_url, body: (issue.body || '').slice(0, 6000) })
  }

  const slug = `${p.repo}-${p.number}`
  const dir = workDirFor(out, slug)
  const ctxDir = join(dir, 'context')
  mkdirSync(ctxDir, { recursive: true, mode: 0o700 })

  // Context docs at the PR's head, so the agent can compare the change to the conventions it was written against.
  const headSha = pr.head.sha
  const contextFiles = []
  const fetchFile = (path) => {
    if (contextFiles.length >= MAX_CONTEXT) return
    const c = ghTry(`${base}/contents/${encodeURI(path)}?ref=${headSha}`)
    if (!c || Array.isArray(c) || c.type !== 'file' || !c.content) return
    const savedAs = join('context', path.replace(/\//g, '__'))
    writeSecure(join(dir, savedAs), Buffer.from(c.content, 'base64'))
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
      writeSecure(join(dir, config), Buffer.from(c.content, 'base64'))
      break
    }
  }

  const intentSource = pr.body ? 'PR description' : commits.length ? `${commits.length} commit message${commits.length === 1 ? '' : 's'}` : 'none'

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
    intentSource,
    base: { ref: pr.base.ref, sha: pr.base.sha },
    head: { ref: pr.head.ref, sha: headSha },
    commits,
    linkedIssues,
    contextFiles,
    config,
    ...(secretFiles.length && { secretFiles }),
    stats: stats(files),
    files: summarizeFiles(files),
    workDir: dir,
    slug,
    generatedAt: new Date().toISOString(),
  }
  writeSecure(join(dir, 'pr.diff'), redacted)
  writeSecure(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
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

  // Read config early so we can apply the base from it.
  const configFile = CONFIG_FILES.find((f) => existsSync(join(root, f))) || null
  const configData = configFile ? readConfig(join(root, configFile)) : {}

  let baseRef = base || configData.base || defaultBase(root)
  let mergeBase = null
  if (mode !== 'uncommitted') {
    if (!baseRef) throw new Error('could not find a base branch; pass --base <branch>')
    if (!tryRun('git', ['rev-parse', '--verify', '--quiet', baseRef], { cwd: root })) {
      throw new Error(`branch "${baseRef}" not found`)
    }
    mergeBase = tryRun('git', ['merge-base', baseRef, 'HEAD'], { cwd: root })?.trim()
    if (!mergeBase) throw new Error(`no common ancestor between "${baseRef}" and HEAD`)
  }

  const diffArgs = ['diff', '--no-color', '--no-ext-diff', '-M']
  let diff = ''
  if (mode === 'committed') diff = g(...diffArgs, `${mergeBase}..HEAD`)
  else if (mode === 'uncommitted') diff = headSha ? g(...diffArgs, 'HEAD') : ''
  else diff = g(...diffArgs, mergeBase)

  const secretFiles = []
  const skippedDirs = []

  if (mode !== 'committed') {
    // New files an agent created but nobody has `git add`ed yet.
    // Use -z (NUL-separated) to handle accented and special file names correctly.
    const untrackedRaw = run('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root })
    const untracked = untrackedRaw.split('\0').filter(Boolean)
    for (const f of untracked) {
      const abs = join(root, f)
      // Skip directories (e.g. nested repos that git treats as untracked dirs).
      try {
        if (statSync(abs).isDirectory()) {
          skippedDirs.push(f)
          continue
        }
      } catch { continue }

      if (looksLikeSecret(f)) {
        diff += `\ndiff --git a/${f} b/${f}\nnew file mode 100644\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1 @@\n+[hidden: looks like a secret — contents not shown]\n`
        secretFiles.push(f)
        continue
      }
      const r = spawnSync('git', ['diff', '--no-color', '--no-index', '--', '/dev/null', f], { cwd: root, encoding: 'utf8', maxBuffer: MAX_BUFFER })
      if (r.stdout) {
        if (containsSecret(r.stdout)) {
          diff += `\ndiff --git a/${f} b/${f}\nnew file mode 100644\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1 @@\n+[hidden: contains what looks like a secret — contents not shown]\n`
          secretFiles.push(f)
        } else {
          diff += (diff && !diff.endsWith('\n') ? '\n' : '') + r.stdout
        }
      }
    }
  }

  // Redact any secret files that are part of the committed diff.
  const { diffText: redacted, secretFiles: redactedFiles } = redactSecrets(diff)
  diff = redacted
  secretFiles.push(...redactedFiles)

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

  // Find where the intent comes from.
  let intentSource = ''
  let intentBody = ''
  if (commits.length) {
    intentSource = `${commits.length} commit message${commits.length === 1 ? '' : 's'}`
  } else {
    for (const f of INTENT_FILES) {
      if (existsSync(join(root, f))) {
        intentBody = readFileSync(join(root, f), 'utf8').slice(0, 6000)
        intentSource = f
        break
      }
    }
    if (!intentSource) intentSource = 'none'
  }

  const contextFiles = []
  const consider = (p) => {
    if (contextFiles.length < MAX_CONTEXT && existsSync(join(root, p)) && statSync(join(root, p)).isFile()) contextFiles.push({ path: p })
  }
  for (const f of CONTEXT_FILES) consider(f)
  for (const d of ancestorsOf(files)) for (const n of ['CLAUDE.md', 'AGENTS.md']) consider(`${d}/${n}`)
  for (const d of CONTEXT_DIRS) {
    const abs = join(root, d)
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      for (const n of readdirSync(abs).slice(0, 10)) consider(`${d}/${n}`)
    }
  }

  const repoName = remoteRepo(root) || basename(root)
  const scope = mode === 'uncommitted' ? 'uncommitted' : mode === 'committed' ? `${branch}-committed` : branch
  // Include a hash of the repo root to avoid collisions between repos with the same name + branch.
  const slug = `${basename(repoName)}-${repoHash(root)}-${slugify(scope)}`
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
    body: intentBody,
    intentSource,
    base: { ref: mode === 'uncommitted' ? 'HEAD' : baseRef, sha: mode === 'uncommitted' ? headSha : mergeBase },
    head: { ref: mode === 'committed' ? branch : `${branch} (working tree)`, sha: headSha },
    commits,
    linkedIssues: [],
    contextFiles,
    config: configFile,
    ...(secretFiles.length && { secretFiles }),
    stats: stats(files),
    files: summarizeFiles(files),
    workDir: dir,
    slug,
    generatedAt: new Date().toISOString(),
  }
  writeSecure(join(dir, 'pr.diff'), diff)
  writeSecure(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')

  if (skippedDirs.length) console.log(`skipped  ${skippedDirs.length} director${skippedDirs.length === 1 ? 'y' : 'ies'} (nested repo or unreadable): ${skippedDirs.join(', ')}`)
  if (secretFiles.length) console.log(`secrets  ${secretFiles.length} file${secretFiles.length === 1 ? '' : 's'} hidden (looks like a secret): ${secretFiles.join(', ')}`)

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
