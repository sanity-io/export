import {createReadStream, existsSync, statSync} from 'node:fs'
import {basename, join} from 'node:path'
import {createInterface} from 'node:readline'
import type {Readable} from 'node:stream'
import {createGunzip} from 'node:zlib'

import tarStream from 'tar-stream'

// U+FFFD replacement character - appears when invalid UTF-8 sequences are decoded
const REPLACEMENT_CHAR = '\uFFFD'

/**
 * Information about corruption found on a specific line
 * @public
 */
export interface CorruptionInfo {
  /** Line number (1-indexed) */
  line: number
  /** Column position of first replacement char */
  column: number
  /** Surrounding text for context */
  context: string
  /** Number of replacement chars on this line */
  count: number
}

/**
 * Result of scanning a file for corruption
 * @public
 */
export interface ScanResult {
  /** Whether corruption was detected */
  corrupted: boolean
  /** Map of filename to corruption info (for tar.gz, multiple files may be scanned) */
  files: Map<string, CorruptionInfo[]>
  /** Total number of corrupted lines across all files */
  totalCorruptedLines: number
  /** List of files that were scanned */
  scannedFiles: string[]
}

/**
 * Scans a line for U+FFFD replacement characters
 */
function scanLine(line: string, lineNumber: number): CorruptionInfo | null {
  const index = line.indexOf(REPLACEMENT_CHAR)
  if (index === -1) return null

  // Count total replacement chars on this line
  let count = 0
  for (const char of line) {
    if (char === REPLACEMENT_CHAR) count++
  }

  // Extract context around the corruption
  const contextStart = Math.max(0, index - 20)
  const contextEnd = Math.min(line.length, index + 30)
  const context = line.slice(contextStart, contextEnd)

  return {
    line: lineNumber,
    column: index + 1,
    context,
    count,
  }
}

/**
 * Scans a readable stream (expecting UTF-8 text) for corruption
 */
async function scanStream(stream: Readable): Promise<CorruptionInfo[]> {
  const corruptions: CorruptionInfo[] = []
  let lineNumber = 0

  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    lineNumber++
    const corruption = scanLine(line, lineNumber)
    if (corruption) {
      corruptions.push(corruption)
    }
  }

  return corruptions
}

/**
 * Scans an NDJSON file for UTF-8 corruption
 *
 * @param filePath - Path to the ndjson file
 * @returns Scan result with corruption information
 * @public
 */
export async function scanNdjsonFile(filePath: string): Promise<ScanResult> {
  const stream = createReadStream(filePath, {encoding: 'utf8'})
  const corruptions = await scanStream(stream)

  const files = new Map<string, CorruptionInfo[]>()
  if (corruptions.length > 0) {
    files.set(filePath, corruptions)
  }

  return {
    corrupted: corruptions.length > 0,
    files,
    totalCorruptedLines: corruptions.length,
    scannedFiles: [filePath],
  }
}

/**
 * Scans a tar.gz archive for UTF-8 corruption in data.ndjson and asset.json files
 *
 * @param filePath - Path to the tar.gz file
 * @returns Scan result with corruption information
 * @public
 */
export async function scanTarGz(filePath: string): Promise<ScanResult> {
  const extract = tarStream.extract()

  const results = new Map<string, CorruptionInfo[]>()
  const scannedFiles: string[] = []
  const targetFiles = ['data.ndjson', 'asset.json']

  return new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const fileBasename = basename(header.name)

      if (targetFiles.includes(fileBasename)) {
        scannedFiles.push(header.name)
        const chunks: Buffer[] = []

        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        stream.on('end', () => {
          // Combine all chunks and convert to string
          const content = Buffer.concat(chunks).toString('utf8')
          const lines = content.split(/\r?\n/)
          const corruptions: CorruptionInfo[] = []

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            if (line !== undefined && line.length > 0) {
              const corruption = scanLine(line, i + 1)
              if (corruption) {
                corruptions.push(corruption)
              }
            }
          }

          if (corruptions.length > 0) {
            results.set(header.name, corruptions)
          }
          next()
        })

        stream.on('error', reject)
      } else {
        // Skip this entry
        stream.on('end', next)
        stream.resume()
      }
    })

    extract.on('finish', () => {
      let totalCorruptedLines = 0
      for (const corruptions of results.values()) {
        totalCorruptedLines += corruptions.length
      }

      resolve({
        corrupted: results.size > 0,
        files: results,
        totalCorruptedLines,
        scannedFiles,
      })
    })

    extract.on('error', reject)

    const gunzip = createGunzip()
    gunzip.on('error', reject)

    createReadStream(filePath).pipe(gunzip).pipe(extract)
  })
}

/**
 * Scans a directory for UTF-8 corruption in data.ndjson and assets.json files
 *
 * @param dirPath - Path to the directory
 * @returns Scan result with corruption information
 * @public
 */
export async function scanDirectory(dirPath: string): Promise<ScanResult> {
  const targetFiles = ['data.ndjson', 'assets.json']
  const foundFiles: string[] = []

  for (const filename of targetFiles) {
    const filePath = join(dirPath, filename)
    if (existsSync(filePath)) {
      foundFiles.push(filePath)
    }
  }

  if (foundFiles.length === 0) {
    throw new Error(
      `No data.ndjson or assets.json found in directory: ${dirPath}`,
    )
  }

  const results = new Map<string, CorruptionInfo[]>()
  const scannedFiles: string[] = []
  let totalCorruptedLines = 0

  for (const filePath of foundFiles) {
    const result = await scanNdjsonFile(filePath)
    scannedFiles.push(...result.scannedFiles)
    for (const [file, corruptions] of result.files) {
      results.set(file, corruptions)
      totalCorruptedLines += corruptions.length
    }
  }

  return {
    corrupted: results.size > 0,
    files: results,
    totalCorruptedLines,
    scannedFiles,
  }
}

/**
 * Detects UTF-8 corruption in an export file (ndjson, tar.gz, or directory)
 *
 * The corruption manifests as U+FFFD replacement characters appearing
 * where valid multi-byte characters (CJK, emoji, etc.) should be.
 *
 * @param filePath - Path to the file or directory to scan
 * @returns Scan result with corruption information
 * @public
 */
export async function detectCorruption(filePath: string): Promise<ScanResult> {
  const stat = statSync(filePath)

  if (stat.isDirectory()) {
    return scanDirectory(filePath)
  }

  const isGzip = filePath.endsWith('.tar.gz') || filePath.endsWith('.tgz')
  return isGzip ? scanTarGz(filePath) : scanNdjsonFile(filePath)
}
