import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteBin = path.resolve(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
const signalingScript = path.resolve(rootDir, 'scripts', 'signaling-server.mjs')

function startProcess(label, entrypoint, args) {
  const child = spawn(process.execPath, [entrypoint, ...args], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  })

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return
    }

    console.error(`[dev] ${label} exited`, { code, signal })
    shutdown(code ?? 1)
  })

  return child
}

const children = []
let shuttingDown = false

function shutdown(code) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children) {
    child.kill('SIGTERM')
  }

  process.exit(code)
}

children.push(startProcess('signaling', signalingScript, []))
children.push(startProcess('vite', viteBin, ['--host']))

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))