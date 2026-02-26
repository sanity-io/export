import {readFileSync} from 'node:fs'
import {dirname, join as joinPath} from 'node:path'
import {fileURLToPath} from 'node:url'

interface PackageJson {
  name: string
  version: string
}

let ua: string | null = null

export function getUserAgent(): string {
  if (!ua) {
    const dir = dirname(fileURLToPath(import.meta.url))
    const data = readFileSync(joinPath(dir, '..', 'package.json'), 'utf-8')
    const pkg = JSON.parse(data) as PackageJson
    ua = `${pkg.name}@${pkg.version}`
  }

  return ua
}
