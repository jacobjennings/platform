'use strict'
// Patch only the ignored build output. The production source is unchanged.
const fs = require('node:fs')
const path = require('node:path')
const file = path.resolve(__dirname, '../../pods/server/bundle/bundle.js')
let code = fs.readFileSync(file, 'utf8')
const marker = 'debug: false,\n          notice: false,\n          onnotice(notice)'
if (code.includes('debug: globalThis.__boardProfileSql ?? false,') && !code.includes(marker)) process.exit(0)
if (code.split(marker).length !== 2) throw new Error('SQL profiling injection point changed')
code = code.replace(marker, 'debug: globalThis.__boardProfileSql ?? false,\n          notice: false,\n          onnotice(notice)')
fs.writeFileSync(file, code)
