import fs from 'node:fs'
import path from 'node:path'

let ua = null

export function getUserAgent() {
  if (!ua) {
    const data = fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf-8')
    const pkg = JSON.parse(data)
    ua = `${pkg.name}@${pkg.version}`
  }

  return ua
}
