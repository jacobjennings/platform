'use strict'
const fs = require('node:fs')
const crypto = require('node:crypto')
const folder = process.argv[2]
if (!folder) throw new Error('Explicit local state folder required')
const secret = crypto.randomBytes(32).toString('hex')
const access = crypto.randomBytes(12).toString('hex')
const password = crypto.randomBytes(24).toString('hex')
fs.writeFileSync(`${folder}/secrets.env`, `SERVER_SECRET=${secret}\nSECRET=${secret}\nMINIO_ROOT_USER=${access}\nMINIO_ROOT_PASSWORD=${password}\nSTORAGE_CONFIG=minio|files:9000?accessKey=${access}&secretKey=${password}&useSSL=false\n`, { mode: 0o600 })
