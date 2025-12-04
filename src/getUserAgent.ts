import {readFileSync} from 'node:fs'
import {join as joinPath} from 'node:path'

interface PackageJson {
  name: string
  version: string
}

let ua: string | null = null

export function getUserAgent(): string {
  if (!ua) {
    const data = readFileSync(joinPath(import.meta.dirname, '..', 'package.json'), 'utf-8')
    const pkg = JSON.parse(data) as PackageJson
    ua = `${pkg.name}@${pkg.version}`
  }

  return ua
}
