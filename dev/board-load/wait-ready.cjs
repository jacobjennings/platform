'use strict'
const net = require('node:net')
const { setTimeout: sleep } = require('node:timers/promises')
async function main() {
  for (const [host, port] of [['config',8080],['account',3000],['transactor',3332],['collaborator',3078],['files',9000]]) {
    let ready = false
    for (let i = 0; i < 60; i++) {
      ready = await new Promise(resolve => {
        const socket = net.connect({ host, port })
        socket.setTimeout(1000)
        socket.once('connect', () => { socket.destroy(); resolve(true) })
        socket.once('error', () => { socket.destroy(); resolve(false) })
        socket.once('timeout', () => { socket.destroy(); resolve(false) })
      })
      if (ready) break
      await sleep(1000)
    }
    if (!ready) throw new Error(`Local ${host} did not start`)
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
