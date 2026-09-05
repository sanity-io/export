import {createReadStream, existsSync, statSync} from 'node:fs'
import {basename, join} from 'node:path'
import {createInterface} from 'node:readline'
import {Readable, Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {createGunzip} from 'node:zlib'

import {createTarDecoder, type ParsedTarEntry} from 'modern-tar'

// U+FFFD replacement character - appears when invalid UTF-8 sequences are decoded
const REPLACEMENT_CHAR = '\uFFFD'

/** The shape of `createTarDecoder()`, see the note in {@link scanTarGz}. */
interface TarDecoder {
  readable: ReadableStream<ParsedTarEntry>
  writable: WritableStream<Uint8Array>
}

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
  const results = new Map<string, CorruptionInfo[]>()
  const scannedFiles: string[] = []
  const targetFiles = ['data.ndjson', 'asset.json']

  // `strict` makes the decoder reject a truncated archive or a bad header checksum rather
  // than quietly stopping at the damage. That matters here more than anywhere: reporting a
  // damaged export as "no corruption detected" is the one answer this tool must never give.
  //
  // The annotation restores the types: modern-tar declares this return value as a
  // `ReadableWritablePair`, which node's types only declare inside `node:stream/web` and
  // not globally, so the declaration does not resolve and everything read off the decoder
  // would otherwise be untyped.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const decoder: TarDecoder = createTarDecoder({strict: true})

  // Fed through the writable side rather than `pipeThrough()`, which for the same reason
  // yields entries typed as `unknown`.
  const feeding = pipeline(
    createReadStream(filePath).pipe(createGunzip()),
    Writable.fromWeb(decoder.writable),
  )

  // A read or gunzip failure aborts the decoder, so the loop below is what actually
  // reports it. The handler is attached up front so throwing out of that loop cannot leave
  // this rejection unhandled, and awaited in `finally` purely as a backstop, so that a
  // source failure can never end up reported as a clean scan.
  feeding.catch(() => {})

  try {
    for await (const entry of decoder.readable) {
      if (!targetFiles.includes(basename(entry.header.name))) {
        // The body of every entry has to be disposed of, or the decoder stalls
        await entry.body.cancel()
        continue
      }

      scannedFiles.push(entry.header.name)

      const chunks: Uint8Array[] = []
      for await (const chunk of entry.body) {
        chunks.push(chunk)
      }

      const content = Buffer.concat(chunks).toString('utf8')
      const corruptions: CorruptionInfo[] = []
      const lines = content.split(/\r?\n/)

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
        results.set(entry.header.name, corruptions)
      }
    }
  } finally {
    await feeding
  }

  let totalCorruptedLines = 0
  for (const corruptions of results.values()) {
    totalCorruptedLines += corruptions.length
  }

  return {
    corrupted: results.size > 0,
    files: results,
    totalCorruptedLines,
    scannedFiles,
  }
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
    throw new Error(`No data.ndjson or assets.json found in directory: ${dirPath}`)
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
