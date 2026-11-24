// explain.json + pr.diff + meta.json → the data the page and the markdown summary read.
// Validates everything, places every hunk of the diff in exactly one step (or a skip group),
// and pins each note onto its line by text. Returns { data, errors, warnings }.
import { createHash } from 'node:crypto'
import { findFile, parseDiff, stats } from './diff.mjs'

const KNOWN_EXPLAIN_KEYS = new Set(['version', 'summary', 'overview', 'kind', 'effort', 'intent', 'architecture', 'flows', 'decisions', 'attention', 'steps', 'stopped', 'skip', 'unchecked', 'diffFingerprint'])

function checkForTodos(obj, path) {
  if (typeof obj === 'string' && /^\s*TODO\b/i.test(obj)) return [`${path}: starts with TODO — fill this in`]
  if (Array.isArray(obj)) return obj.flatMap((v, i) => checkForTodos(v, `${path}[${i}]`))
  if (obj && typeof obj === 'object') return Object.entries(obj).flatMap(([k, v]) => checkForTodos(v, path ? `${path}.${k}` : k))
  return []
}

export const ENUMS = {
  nodeStatus: ['added', 'removed', 'changed', 'same'],
  nodeKind: ['ui', 'service', 'module', 'function', 'store', 'db', 'queue', 'external', 'config', 'test', 'job', 'api'],
  impactKind: ['module', 'dependency', 'api', 'data', 'config', 'boundary', 'pattern', 'infra', 'removal', 'security'],
  impactChange: ['added', 'removed', 'changed'],
  convention: ['follows', 'departs', 'new'],
  intent: ['matches', 'partial', 'mismatch', 'unchecked', 'unstated'],
  msgChange: ['new', 'changed', 'gone', 'same'],
  kind: ['feature', 'fix', 'refactor', 'perf', 'chore', 'docs', 'test', 'mixed'],
}

export function buildModel(explain, diffText, meta = {}) {
  const errors = []
  const warnings = []
  const err = (path, msg) => errors.push(`${path}: ${msg}`)
  const warn = (path, msg) => warnings.push(`${path}: ${msg}`)
  const isStr = (v) => typeof v === 'string' && v.trim().length > 0
  const arr = (v) => (Array.isArray(v) ? v : [])
  const oneOf = (path, v, list, required = false) => {
    if (v === undefined || v === null) {
      if (required) err(path, `required, one of ${list.join(' | ')}`)
      return
    }
    if (!list.includes(v)) err(path, `"${v}" is not one of ${list.join(' | ')}`)
  }

  if (!explain || typeof explain !== 'object') return { data: null, errors: ['explain.json: not a JSON object'], warnings }

  // Warn on unknown top-level keys — catches misspellings like "stoped" or "decision".
  for (const k of Object.keys(explain)) {
    if (!KNOWN_EXPLAIN_KEYS.has(k)) warn(k, `unknown key — did you mean one of: ${[...KNOWN_EXPLAIN_KEYS].join(', ')}?`)
  }

  // Fail if the diff has changed since init ran.
  if (explain.diffFingerprint) {
    const currentFp = createHash('sha256').update(diffText || '').digest('hex').slice(0, 16)
    if (explain.diffFingerprint !== currentFp) {
      err('diffFingerprint', 'the diff has changed since init ran — re-run init and update the explanation')
    }
  }

  if (explain.version !== 1) err('version', 'must be 1')
  if (!isStr(explain.summary)) err('summary', 'required: one sentence on what changes for whoever meets this change')
  else if (explain.summary.length > 200) warn('summary', `${explain.summary.length} characters; aim for one sentence under ~200`)
  oneOf('kind', explain.kind, ENUMS.kind)

  // ---- effort
  const effort = explain.effort
  if (effort) {
    if (!Number.isInteger(effort.score) || effort.score < 1 || effort.score > 5) err('effort.score', 'an integer from 1 (trivial) to 5 (very complex)')
  } else warn('effort', 'missing: add { score: 1-5, why }')

  // ---- intent
  arr(explain.intent?.checks).forEach((c, i) => {
    const p = `intent.checks[${i}]`
    if (!isStr(c.claim)) err(p + '.claim', 'required')
    oneOf(p + '.status', c.status, ENUMS.intent, true)
  })
  if (!explain.intent) warn('intent', 'missing: say where the stated intent came from and check its claims against the code')

  // ---- architecture
  const arch = explain.architecture
  if (!arch) warn('architecture', 'missing: every page should say how the change sits in the architecture, even "no structural change"')
  arr(arch?.impact).forEach((m, i) => {
    const p = `architecture.impact[${i}]`
    if (!isStr(m.title)) err(p + '.title', 'required')
    oneOf(p + '.kind', m.kind, ENUMS.impactKind, true)
    oneOf(p + '.change', m.change, ENUMS.impactChange, true)
  })
  arr(arch?.conventions).forEach((c, i) => {
    const p = `architecture.conventions[${i}]`
    if (!isStr(c.rule)) err(p + '.rule', 'required')
    oneOf(p + '.status', c.status, ENUMS.convention, true)
  })
  const dia = arch?.diagram
  if (dia) checkDiagram(dia, err, warn, oneOf)
  else if (arr(arch?.impact).length) warn('architecture.diagram', 'impact is listed but there is no diagram')

  // ---- flows
  arr(explain.flows).forEach((f, i) => checkFlow(f, `flows[${i}]`, err, warn))

  // ---- decisions / attention / stopped
  arr(explain.decisions).forEach((d, i) => {
    if (!isStr(d.title)) err(`decisions[${i}].title`, 'required')
    if (!isStr(d.why)) warn(`decisions[${i}].why`, 'a decision without a why reads as a guess')
  })
  const stepCount = arr(explain.steps).length
  arr(explain.attention).forEach((a, i) => {
    if (!isStr(a.title)) err(`attention[${i}].title`, 'required')
    if (!isStr(a.tag)) err(`attention[${i}].tag`, 'required, e.g. "Behaviour change", "Breaking", "Subtle", "Unchecked"')
    if (a.step !== undefined && (!Number.isInteger(a.step) || a.step < 1 || a.step > stepCount)) err(`attention[${i}].step`, `must be a step number 1..${stepCount}`)
  })
  arr(explain.stopped).forEach((s, i) => {
    if (!isStr(s.what)) err(`stopped[${i}].what`, 'required')
  })

  // ---- steps: cut the diff
  const files = parseDiff(diffText || '')
  if (!files.length) warn('pr.diff', 'the diff is empty')
  const placed = new Map() // "path#index" -> step number
  const filePlaced = new Set()

  const steps = arr(explain.steps).map((s, i) => {
    const p = `steps[${i}]`
    if (!isStr(s.title)) err(p + '.title', 'required')
    else if (s.title.length > 70) warn(p + '.title', 'long; aim for under ~70 characters')
    if (!isStr(s.why)) err(p + '.why', 'required')
    const out = { n: i + 1, title: s.title, why: s.why, effect: s.effect || s.consequence, pseudocode: s.pseudocode, files: [] }
    const refs = arr(s.hunks)
    if (!refs.length) err(p + '.hunks', 'needs at least one { file }')
    refs.forEach((h, j) => {
      const hp = `${p}.hunks[${j}]`
      if (!isStr(h.file)) return err(hp + '.file', 'required: a path, or a unique ending of one')
      const found = findFile(files, h.file)
      if (found.error) return err(hp + '.file', found.error)
      const f = found.file
      filePlaced.add(f.path)
      let idx = h.hunks ?? f.hunks.map((_, k) => k)
      if (!Array.isArray(idx)) idx = [idx]
      const chosen = []
      for (const k of idx) {
        if (!Number.isInteger(k) || k < 0 || k >= f.hunks.length) {
          err(hp + '.hunks', `${f.path} has hunks 0..${f.hunks.length - 1}; got ${k}`)
          continue
        }
        const key = `${f.path}#${k}`
        if (placed.has(key)) err(hp, `hunk ${k} of ${f.path} is already in step ${placed.get(key)}`)
        placed.set(key, i + 1)
        chosen.push(cloneHunk(f.hunks[k]))
      }
      arr(h.notes).forEach((n, k) => {
        const note = asNote(n)
        const np = `${hp}.notes[${k}]`
        if (!note) return err(np, 'a note is [lineText, note, nth?] or { line, note, nth?, side? }')
        const hit = findLine(chosen, note)
        if (!hit) return err(np, `no line in ${f.path}${h.hunks ? ` hunks ${idx.join(',')}` : ''} contains ${JSON.stringify(note.line)}${note.nth > 1 ? ` (nth ${note.nth})` : ''}`)
        ;(hit.notes ||= []).push(note.note)
      })
      // Merge into one entry per file within the step.
      let entry = out.files.find((e) => e.path === f.path)
      if (!entry) out.files.push((entry = { path: f.path, oldPath: f.oldPath, status: f.status, add: f.add, del: f.del, binary: f.binary, hunks: [] }))
      entry.hunks.push(...chosen)
      entry.hunks.sort((a, b) => a.index - b.index)
    })
    return out
  })
  if (files.length && !steps.length) err('steps', 'required: the diff in reading order')
  if (steps.length > 9) warn('steps', `${steps.length} steps; 2-7 reads best`)

  const skip = arr(explain.skip).map((g, i) => {
    const p = `skip[${i}]`
    if (!isStr(g.kind)) err(p + '.kind', 'required, e.g. "Lockfile", "Generated", "Docs", "Rename"')
    const gf = []
    arr(g.files).forEach((ref, j) => {
      const found = findFile(files, ref)
      if (found.error) return err(`${p}.files[${j}]`, found.error)
      const f = found.file
      for (const h of f.hunks) {
        const key = `${f.path}#${h.index}`
        if (placed.has(key)) err(`${p}.files[${j}]`, `${f.path} hunk ${h.index} is already in step ${placed.get(key)}`)
        placed.set(key, 'skip')
      }
      filePlaced.add(f.path)
      gf.push({ path: f.path, status: f.status, add: f.add, del: f.del })
    })
    if (!gf.length) err(p + '.files', 'needs at least one file')
    return { kind: g.kind, why: g.why || '', files: gf }
  })

  // Every hunk somewhere.
  for (const f of files) {
    const missing = f.hunks.filter((h) => !placed.has(`${f.path}#${h.index}`)).map((h) => h.index)
    if (missing.length) err('coverage', `${f.path}: hunk${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not in any step or skip group`)
    if (!f.hunks.length && !filePlaced.has(f.path)) err('coverage', `${f.path} (${f.binary ? 'binary' : f.status}) is not in any step or skip group`)
  }

  arr(explain.attention).forEach((a, i) => {
    if (a.step && steps[a.step - 1]) (steps[a.step - 1].attention ||= []).push(i)
  })

  // Reject any unfinished TODO placeholders.
  for (const e of checkForTodos(explain, '')) errors.push(e)

  const data = {
    version: 1,
    meta: {
      source: meta.source || 'github',
      mode: meta.mode,
      repo: meta.repo || explain.repo || '',
      number: meta.number,
      url: meta.url,
      title: explain.title || meta.title || '',
      author: meta.author,
      state: meta.state,
      branch: meta.branch,
      base: meta.base,
      head: meta.head,
      generatedAt: meta.generatedAt || new Date().toISOString(),
      ...stats(files),
    },
    summary: explain.summary,
    overview: explain.overview,
    kind: explain.kind,
    effort: explain.effort,
    intent: explain.intent,
    architecture: arch ? { summary: arch.summary, impact: arr(arch.impact), conventions: arr(arch.conventions), diagram: dia } : null,
    flows: arr(explain.flows),
    decisions: arr(explain.decisions),
    attention: arr(explain.attention),
    steps,
    stopped: arr(explain.stopped),
    skip,
    unchecked: arr(explain.unchecked),
  }
  return { data, errors, warnings }
}

function checkDiagram(d, err, warn, oneOf) {
  const p = 'architecture.diagram'
  const ids = new Set()
  const layers = new Set((d.layers || []).map((l) => l.id))
  if (!Array.isArray(d.nodes) || !d.nodes.length) return err(p + '.nodes', 'needs nodes')
  if (d.nodes.length > 18) warn(p + '.nodes', `${d.nodes.length} nodes; cut to the parts around the change (≤ ~12)`)
  d.nodes.forEach((n, i) => {
    const np = `${p}.nodes[${i}]`
    if (typeof n.id !== 'string' || !n.id) err(np + '.id', 'required')
    else if (ids.has(n.id)) err(np + '.id', `duplicate id "${n.id}"`)
    ids.add(n.id)
    if (typeof n.label !== 'string' || !n.label) err(np + '.label', 'required')
    oneOf(np + '.status', n.status ?? 'same', ENUMS.nodeStatus)
    oneOf(np + '.kind', n.kind, ENUMS.nodeKind)
    if (n.layer !== undefined && layers.size && !layers.has(n.layer)) err(np + '.layer', `"${n.layer}" is not in diagram.layers`)
  })
  ;(d.edges || []).forEach((e, i) => {
    const ep = `${p}.edges[${i}]`
    if (!ids.has(e.from)) err(ep + '.from', `no node "${e.from}"`)
    if (!ids.has(e.to)) err(ep + '.to', `no node "${e.to}"`)
    oneOf(ep + '.status', e.status ?? 'same', ENUMS.nodeStatus)
  })
  const changed = d.nodes.some((n) => n.status && n.status !== 'same') || (d.edges || []).some((e) => e.status && e.status !== 'same')
  if (!changed) warn(p, 'nothing is marked added, removed or changed; the diagram will not show what the change did')
}

function checkFlow(f, p, err, warn) {
  if (typeof f.title !== 'string' || !f.title) err(p + '.title', 'required')
  const ids = new Set()
  if (!Array.isArray(f.participants) || f.participants.length < 2) err(p + '.participants', 'needs at least two participants')
  ;(f.participants || []).forEach((x, i) => {
    if (!x.id) err(`${p}.participants[${i}].id`, 'required')
    else if (ids.has(x.id)) err(`${p}.participants[${i}].id`, `duplicate "${x.id}"`)
    ids.add(x.id)
  })
  if ((f.participants || []).length > 6) warn(p + '.participants', 'more than 6 lanes gets cramped; cut to 3-5')
  const cases = f.cases
  if (!Array.isArray(cases) || !cases.length) return err(p + '.cases', 'needs at least one case with "after" messages')
  if (!cases.some((c) => Array.isArray(c.before))) warn(p, 'no case has "before" messages; if the change alters behaviour, show the old flow')
  cases.forEach((c, i) => {
    const cp = `${p}.cases[${i}]`
    if (!c.label) err(cp + '.label', 'required')
    for (const side of ['before', 'after']) {
      if (side === 'after' && !Array.isArray(c.after)) err(cp + '.after', 'required (use [] if nothing happens any more)')
      ;(c[side] || []).forEach((m, k) => {
        const mp = `${cp}.${side}[${k}]`
        if (!ids.has(m.from)) err(mp + '.from', `no participant "${m.from}"`)
        if (!ids.has(m.to)) err(mp + '.to', `no participant "${m.to}"`)
        if (typeof m.text !== 'string' || !m.text) err(mp + '.text', 'required')
        if (m.change !== undefined && !ENUMS.msgChange.includes(m.change)) err(mp + '.change', `one of ${ENUMS.msgChange.join(' | ')}`)
      })
    }
    if ((c.after || []).length > 12) warn(cp + '.after', 'more than ~10 messages; cut to the calls around the change')
  })
}

const cloneHunk = (h) => ({ index: h.index, header: h.header, context: h.context, oldStart: h.oldStart, newStart: h.newStart, lines: h.lines.map((l) => ({ ...l })) })

function asNote(n) {
  if (Array.isArray(n) && typeof n[0] === 'string' && typeof n[1] === 'string') return { line: n[0], note: n[1], nth: Number(n[2]) || 1 }
  if (n && typeof n === 'object' && typeof n.line === 'string' && typeof n.note === 'string') return { line: n.line, note: n.note, nth: Number(n.nth) || 1, side: n.side }
  return null
}

// First matching added line, then context line, then removed line (or only removed lines with side: "old").
function findLine(hunks, note) {
  const all = hunks.flatMap((h) => h.lines)
  const order = note.side === 'old' ? ['del'] : ['add', 'ctx', 'del']
  for (const t of order) {
    const hits = all.filter((l) => l.t === t && l.text.includes(note.line))
    if (hits.length >= note.nth) return hits[note.nth - 1]
  }
  return null
}
