// Read the schema field maps out of schemas.ts and emit the index statements the
// adapter would create, so the measurement arms use the shipped code's set.
import fs from 'node:fs'

const file = process.argv[2]
const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function bodyOf (text, start) {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start + 1, i) }
  }
  throw new Error('unbalanced')
}

const rawSchemas = {}
const schemas = {}
for (const m of src.matchAll(/const ([A-Za-z]+): Schema = \{/g)) {
  if (rawSchemas[m[1]] !== undefined) continue
  rawSchemas[m[1]] = bodyOf(src, src.indexOf('{', m.index))
}

function parse (body, name) {
  const fields = {}
  const lineRe = /^ {2}(?:\.\.\.([A-Za-z]+)|'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::\s*\{|,)/gm
  let m
  while ((m = lineRe.exec(body)) !== null) {
    if (m[1] !== undefined) {
      const base = rawSchemas[m[1]]
      if (base === undefined) throw new Error('unknown spread ' + m[1])
      Object.assign(fields, parse(base, m[1]))
      continue
    }
    const key = m[2] ?? m[3] ?? m[4]
    // Field body begins at this line's '{' and ends at the matching brace.
    const last = m[0].trimEnd().slice(-1)
    const open = last === '{' ? m.index + m[0].lastIndexOf('{') : body.indexOf('{', m.index + m[0].length)
    if (open < 0) continue
    const fieldBody = bodyOf(body, open)
    fields[key] = {
      index: /\bindex:\s*true\b/.test(fieldBody),
      indexType: /indexType:\s*'([a-z]+)'/.exec(fieldBody)?.[1]
    }
  }
  return fields
}
for (const name of Object.keys(rawSchemas)) schemas[name] = parse(rawSchemas[name], name)

// domain -> schema, following the domainSchemas literal.
const domainMap = {}
const mapBody = bodyOf(src, src.indexOf('{', src.indexOf('export const domainSchemas')))
for (const m of mapBody.matchAll(/^ {2}(?:\[(?:translateDomain\('([^']+)'\)|(DOMAIN_[A-Z_]+))\]|([A-Za-z_$][\w$]*))\s*:\s*([A-Za-z]+),?$/gm)) {
  domainMap[m[1] ?? m[2] ?? m[3]] = m[4]
}
const domainConsts = { DOMAIN_SPACE: 'space', DOMAIN_TX: 'tx', DOMAIN_MODEL_TX: 'model', DOMAIN_RELATION: 'relation', DOMAIN_COLLABORATOR: 'collaborator', DOMAIN_MODEL: 'model' }
const resolved = {}
for (const [k, v] of Object.entries(domainMap)) resolved[domainConsts[k] ?? k] = v
for (const m of src.matchAll(/addSchema\('([^']+)',\s*([A-Za-z]+)\)/g)) resolved[m[1]] = m[2]

const exclusions = { activity: ['attachedTo'], task: ['space'] }
const tables = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
const out = []
for (const table of tables) {
  const domain = table.replaceAll('-', '_')
  const schemaName = resolved[domain] ?? 'defaultSchema'
  const fields = schemas[schemaName]
  const skip = new Set(exclusions[domain] ?? [])
  for (const [key, field] of Object.entries(fields)) {
    if (!field.index || skip.has(key)) continue
    const using = field.indexType !== undefined && field.indexType !== 'btree' ? ` USING ${field.indexType}` : ''
    out.push(`CREATE INDEX IF NOT EXISTS ${table}_${key} ON ${table}${using} ("${key}");`)
  }
}
const extra = process.argv[4]
if (extra !== undefined && extra !== 'none') {
  const omit = new Set(extra.split(',').filter(Boolean))
  for (const stmt of out) {
    if (omit.has(/IF NOT EXISTS (\S+)/.exec(stmt)[1])) continue
    console.log(stmt)
  }
} else {
  for (const stmt of out) console.log(stmt)
}
