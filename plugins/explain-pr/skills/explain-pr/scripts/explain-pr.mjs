#!/usr/bin/env node
// explain-pr: collect a change, check the explanation an agent wrote for it, and build the page.
// Zero dependencies; Node 18+. See ../SKILL.md for the workflow.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { collectLocal, collectPr, parsePrRef } from './lib/collect.mjs'
import { initExplain } from './lib/init.mjs'
import { makePage } from './lib/make.mjs'
import { toMarkdown } from './lib/markdown.mjs'
import { buildModel } from './lib/model.mjs'

export const VERSION = '0.1.0'

const HELP = `explain-pr ${VERSION}

Usage:
  explain-pr collect [<pr-url | owner/repo#n | n>] [options]   gather the diff and context into a work folder
      --pr <ref>          a GitHub pull request (needs gh, signed in)
      --repo <owner/repo> repo for a bare PR number
      --base <ref>        local: compare against this branch (default: origin's default branch)
      --committed         local: only committed changes since the merge base
      --uncommitted       local: only changes since HEAD (working tree + untracked)
      --cwd <dir>         local: repository folder (default: current folder)
      --out <dir>         work folder (default: $EXPLAIN_PR_HOME or <tmp>/explain-pr/<slug>)
  explain-pr init  <workdir>             write a starter explain.json (one step per file)
  explain-pr check <workdir>             validate explain.json against pr.diff; exit 1 on errors
  explain-pr build <workdir> [options]   check, then write <slug>.html and <slug>.md
      --html <file> | --md <file>        output paths
      --no-md                            skip the markdown summary
      --open                             open the page in the default browser
  explain-pr --version
`

function args(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      if (v !== undefined) out[k] = v
      else if (argv[i + 1] && !argv[i + 1].startsWith('--') && ['pr', 'repo', 'base', 'cwd', 'out', 'html', 'md'].includes(k)) out[k] = argv[++i]
      else out[k] = true
    } else out._.push(a)
  }
  return out
}

const readJson = (p, what) => {
  if (!existsSync(p)) throw new Error(`${what} not found at ${p}`)
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    throw new Error(`${what} is not valid JSON (${p}): ${e.message}`)
  }
}

function load(workdir) {
  const dir = resolve(workdir || '.')
  const meta = existsSync(join(dir, 'meta.json')) ? readJson(join(dir, 'meta.json'), 'meta.json') : {}
  const explain = readJson(join(dir, 'explain.json'), 'explain.json')
  const diffPath = join(dir, 'pr.diff')
  if (!existsSync(diffPath)) throw new Error(`pr.diff not found in ${dir}; run \`explain-pr collect\` first`)
  return { dir, meta, ...buildModel(explain, readFileSync(diffPath, 'utf8'), meta) }
}

function report({ errors, warnings }) {
  for (const w of warnings) console.log(`warn   ${w}`)
  for (const e of errors) console.log(`ERROR  ${e}`)
  console.log(`${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`)
}

function openFile(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const a = process.platform === 'win32' ? ['/c', 'start', '', file] : [file]
  try {
    spawn(cmd, a, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* no browser available; the path is printed anyway */
  }
}

export function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv
  const o = args(rest)
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return void console.log(HELP)
  if (cmd === '--version' || cmd === 'version' || cmd === '-v') return void console.log(VERSION)

  if (cmd === 'collect') {
    const ref = o.pr || (o._[0] && parsePrRef(o._[0], o.repo) ? o._[0] : null)
    if (o._[0] && !ref) throw new Error(`"${o._[0]}" is not a PR reference; for a local branch use --base <branch>`)
    const mode = o.uncommitted ? 'uncommitted' : o.committed ? 'committed' : 'branch'
    const meta = ref ? collectPr({ ref, repo: o.repo, out: o.out }) : collectLocal({ cwd: o.cwd, base: o.base, mode, out: o.out })
    const s = meta.stats
    console.log(`workdir  ${meta.workDir}`)
    console.log(`change   ${meta.number ? `${meta.repo} #${meta.number}` : `${meta.repo} ${meta.branch} (${meta.mode}, base ${meta.base.ref})`}: ${meta.title}`)
    console.log(`diff     ${s.files} files, +${s.add} −${s.del}`)
    for (const f of meta.files) console.log(`         ${f.status.padEnd(8)} ${f.path} (+${f.add} −${f.del}, ${f.hunks} hunk${f.hunks === 1 ? '' : 's'})`)
    console.log(`intent   ${meta.body ? 'PR description' : meta.commits.length ? `${meta.commits.length} commit message(s)` : 'none stated'}${meta.linkedIssues.length ? ` + ${meta.linkedIssues.length} linked issue(s)` : ''}`)
    console.log(`context  ${meta.contextFiles.length ? meta.contextFiles.map((c) => c.savedAs || c.path).join(', ') : 'none found'}`)
    if (meta.config) console.log(`config   ${meta.config}`)
    if (!s.files) console.log('\nThe diff is empty: nothing to explain.')
    return
  }

  if (cmd === 'init') {
    const dir = resolve(o._[0] || '.')
    const target = join(dir, 'explain.json')
    if (existsSync(target) && !o.force) throw new Error(`${target} exists; pass --force to overwrite`)
    writeFileSync(target, JSON.stringify(initExplain(readJson(join(dir, 'meta.json'), 'meta.json')), null, 2) + '\n')
    console.log(`wrote ${target}`)
    return
  }

  if (cmd === 'check') {
    const r = load(o._[0])
    report(r)
    if (r.errors.length) process.exitCode = 1
    return
  }

  if (cmd === 'build') {
    const r = load(o._[0])
    report(r)
    if (r.errors.length) {
      process.exitCode = 1
      console.log('Not built: fix the errors above.')
      return
    }
    const slug = r.meta.slug || 'explain'
    const html = resolve(o.html || join(r.dir, `${slug}.html`))
    writeFileSync(html, makePage(r.data))
    console.log(`page     ${html}`)
    if (!o['no-md']) {
      const md = resolve(o.md || join(r.dir, `${slug}.md`))
      writeFileSync(md, toMarkdown(r.data))
      console.log(`markdown ${md}`)
    }
    if (o.open) openFile(html)
    return
  }

  throw new Error(`unknown command "${cmd}"\n\n${HELP}`)
}

const real = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}
const isMain = process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))
if (isMain) {
  try {
    main()
  } catch (e) {
    console.error(`explain-pr: ${e.message}`)
    process.exitCode = 2
  }
}
