'use strict'
const http = require('node:http')
http.createServer((request, response) => {
  if (request.url !== '/config.json') { response.writeHead(404).end(); return }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ ACCOUNTS_URL: 'http://account:3000', COLLABORATOR_URL: 'ws://collaborator:3078',
    FILES_URL: 'http://config:8080/files', UPLOAD_URL: 'http://config:8080/files' }))
}).listen(8080, '0.0.0.0')
setTimeout(() => process.exit(124), 4 * 60 * 60 * 1000).unref()
