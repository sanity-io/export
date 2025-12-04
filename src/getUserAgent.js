import {readFileSync} from 'node:fs'
import {join as joinPath} from 'node:path'

let ua = null

export function getUserAgent() {
  if (!ua) {
    const data = readFileSync(joinPath(import.meta.dirname, '..', 'package.json'), 'utf-8')
    const pkg = JSON.parse(data)
    ua = `${pkg.name}@${pkg.version}`
  }

  return ua
}
