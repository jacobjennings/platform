import { execFileSync } from 'child_process'

/**
 * The suites in this folder need the docker services started by
 * `tests/prepare-tests.sh`. Jest decides whether to register a suite before any
 * hook runs, so probe the service synchronously and skip the suite when it is
 * not available instead of failing a test run on a machine without the stack.
 */
export function isPortReachable (host: string, port: number): boolean {
  const probe = [
    "const net = require('net')",
    `const socket = net.connect({ host: ${JSON.stringify(host)}, port: ${port} })`,
    'socket.setTimeout(1500)',
    "socket.once('connect', () => { socket.destroy(); process.exit(0) })",
    "socket.once('timeout', () => process.exit(1))",
    "socket.once('error', () => process.exit(1))"
  ].join('; ')

  try {
    execFileSync(process.execPath, ['-e', probe], { timeout: 4000, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function isAddressReachable (address: string): boolean {
  const separator = address.lastIndexOf(':')
  if (separator <= 0) return false
  const port = Number(address.slice(separator + 1))
  if (!Number.isInteger(port) || port <= 0) return false
  return isPortReachable(address.slice(0, separator), port)
}

export function isUrlReachable (rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.port !== '') return isPortReachable(url.hostname, Number(url.port))
  return isPortReachable(url.hostname, url.protocol === 'https:' ? 443 : 80)
}
