// The page: a fixed template with the data written in. Nothing is rebuilt per change.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '../../assets/page.html')

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// JSON inside <script>: escaping "<" keeps a "</script>" in a diff from closing the block;
// U+2028/2029 are escaped because some parsers treat them as line ends.
export const jsonBlock = (data) =>
  JSON.stringify(data).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'))

export function makePage(data, template = readFileSync(TEMPLATE, 'utf8')) {
  const m = data.meta
  const name = m.number ? `${m.repo} #${m.number}` : `${m.repo}${m.branch ? ` · ${m.branch}` : ''}`
  const title = `${name} — ${m.title || 'explained'}`
  if (!template.includes('<!--EXPLAIN_DATA-->')) throw new Error('template is missing the <!--EXPLAIN_DATA--> marker')
  return template
    .replace('<!--EXPLAIN_TITLE-->', () => esc(title))
    .replace('<!--EXPLAIN_DATA-->', () => `<script type="application/json" id="explain-data">${jsonBlock(data)}</script>`)
}
