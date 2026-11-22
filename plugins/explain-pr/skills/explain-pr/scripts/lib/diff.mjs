// Parse a unified diff (git diff / gh pr diff output) into files and hunks.
// Each line keeps its old and new line numbers so notes can be pinned to it.

const FILE_RE = /^diff --git a\/(.*?) b\/(.*)$/
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

const unquote = (p) => {
  // git quotes paths with unusual characters: "a/some path"
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1).replace(/\\(.)/g, '$1')
  return p
}

export function parseDiff(text) {
  const files = []
  let file = null
  let hunk = null
  let oldNo = 0
  let newNo = 0
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  const startFile = (oldPath, newPath) => {
    file = { path: newPath, oldPath, status: 'modified', binary: false, add: 0, del: 0, hunks: [] }
    files.push(file)
    hunk = null
  }

  for (const line of lines) {
    const fm = line.match(FILE_RE)
    if (fm) {
      startFile(unquote(fm[1]), unquote(fm[2]))
      continue
    }
    if (!file) continue

    if (!hunk) {
      // Extended header lines before the first hunk.
      if (line.startsWith('new file mode')) file.status = 'added'
      else if (line.startsWith('deleted file mode')) file.status = 'deleted'
      else if (line.startsWith('rename from ')) { file.oldPath = line.slice(12); file.status = 'renamed' }
      else if (line.startsWith('rename to ')) { file.path = line.slice(10); file.status = 'renamed' }
      else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) file.binary = true
      else if (line.startsWith('--- ')) {
        if (line === '--- /dev/null') file.status = 'added'
      } else if (line.startsWith('+++ ')) {
        if (line === '+++ /dev/null') file.status = 'deleted'
      }
    }

    const hm = line.match(HUNK_RE)
    if (hm) {
      oldNo = Number(hm[1])
      newNo = Number(hm[3])
      hunk = {
        index: file.hunks.length,
        header: line,
        oldStart: oldNo,
        oldCount: hm[2] === undefined ? 1 : Number(hm[2]),
        newStart: newNo,
        newCount: hm[4] === undefined ? 1 : Number(hm[4]),
        context: hm[5] || '',
        lines: [],
      }
      file.hunks.push(hunk)
      continue
    }
    if (!hunk) continue

    const c = line[0]
    if (c === '+') {
      hunk.lines.push({ t: 'add', text: line.slice(1), n: newNo++ })
      file.add++
    } else if (c === '-') {
      hunk.lines.push({ t: 'del', text: line.slice(1), o: oldNo++ })
      file.del++
    } else if (c === ' ') {
      hunk.lines.push({ t: 'ctx', text: line.slice(1), o: oldNo++, n: newNo++ })
    } else if (c === '\\') {
      // "\ No newline at end of file" — keep it out of the page.
    } else if (line === '') {
      // A blank line inside a hunk can be an empty context line whose leading space was stripped.
      if (hunkHasRoom(hunk, oldNo, newNo)) hunk.lines.push({ t: 'ctx', text: '', o: oldNo++, n: newNo++ })
    }
  }
  return files
}

function hunkHasRoom(h, oldNo, newNo) {
  return oldNo < h.oldStart + h.oldCount && newNo < h.newStart + h.newCount
}

// Find a file by full path or by a unique ending of one ("api/users.ts").
export function findFile(files, ref) {
  const exact = files.find((f) => f.path === ref || f.oldPath === ref)
  if (exact) return { file: exact }
  const ends = files.filter((f) => f.path.endsWith('/' + ref) || f.path.endsWith(ref))
  if (ends.length === 1) return { file: ends[0] }
  if (ends.length > 1) return { error: `"${ref}" matches ${ends.length} files: ${ends.map((f) => f.path).join(', ')}` }
  return { error: `no file in the diff matches "${ref}"` }
}

export function stats(files) {
  return {
    files: files.length,
    add: files.reduce((n, f) => n + f.add, 0),
    del: files.reduce((n, f) => n + f.del, 0),
  }
}
