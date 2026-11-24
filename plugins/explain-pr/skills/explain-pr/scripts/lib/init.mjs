// A starting explain.json from meta.json: one step per changed file, and obvious noise
// (lockfiles, generated, snapshots, build output) already in skip groups. The agent rewrites it into the real story.
import { createHash } from 'node:crypto'

const SKIP_PATTERNS = [
  { kind: 'Lockfile', why: 'Regenerated dependency lockfile.', re: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum|Podfile\.lock|pubspec\.lock|mix\.lock)$/ },
  { kind: 'Generated', why: 'Generated code; read its source instead.', re: /(\.min\.(js|css)$|\.pb\.go$|_pb2\.py$|\.generated\.|(^|\/)generated\/|(^|\/)__generated__\/|\.g\.dart$)/ },
  { kind: 'Snapshots', why: 'Test snapshots that follow from the code change.', re: /(__snapshots__\/|\.snap$)/ },
  { kind: 'Build output', why: 'Build artifact; not source.', re: /(^|\/)(?:dist|build|out|\.next|\.nuxt|\.output)\// },
]

export function initExplain(meta, diffText) {
  const skip = []
  const steps = []
  for (const f of meta.files || []) {
    const pat = SKIP_PATTERNS.find((p) => p.re.test(f.path))
    if (pat) {
      let g = skip.find((s) => s.kind === pat.kind)
      if (!g) skip.push((g = { kind: pat.kind, why: pat.why, files: [] }))
      g.files.push(f.path)
      continue
    }
    steps.push({ title: `TODO: what changes in ${f.path}`, why: 'TODO', effect: '', hunks: [{ file: f.path, notes: [] }] })
  }

  const intentSource = meta.intentSource || (meta.body ? 'PR description' : meta.commits?.length ? 'commit messages' : 'none')

  return {
    version: 1,
    diffFingerprint: createHash('sha256').update(diffText || '').digest('hex').slice(0, 16),
    summary: 'TODO: one sentence on what changes for whoever meets this change',
    kind: 'feature',
    effort: { score: 2, why: 'TODO' },
    intent: { source: intentSource, checks: [] },
    architecture: {
      summary: 'TODO',
      impact: [],
      conventions: [],
    },
    flows: [],
    decisions: [],
    attention: [],
    steps,
    stopped: [],
    skip,
    unchecked: [],
  }
}
