#!/usr/bin/env node

/**
 * CLI tool to detect potentially corrupted export files caused by UTF-8
 * multi-byte characters being split across chunk boundaries during streaming.
 *
 * Usage:
 *   npx @sanity/export detect-corrupt <file.ndjson|file.tar.gz|directory>
 */

import {existsSync} from 'node:fs'
import {detectCorruption} from '../dist/detectCorruption.js'

const REPLACEMENT_CHAR_DISPLAY = '�'

function printUsage() {
  console.log(`
Usage: detect-corrupt <file.ndjson|file.tar.gz|directory>

Detects potentially corrupted export files caused by UTF-8 multi-byte
characters being split across chunk boundaries during streaming.

The corruption manifests as U+FFFD replacement characters (${REPLACEMENT_CHAR_DISPLAY}) appearing
where valid multi-byte characters should be.

Supported inputs:
  - .tar.gz or .tgz archive (scans data.ndjson and assets.json inside)
  - .ndjson file
  - Directory containing data.ndjson and/or assets.json

Examples:
  npx @sanity/export detect-corrupt export.tar.gz
  npx @sanity/export detect-corrupt data.ndjson
  npx @sanity/export detect-corrupt ./my-export-folder
`)
}

function printReport(filename, corruptions) {
  console.log(`\n  ${filename}:`)

  // Limit output to avoid overwhelming terminal
  const maxToShow = 10
  const shown = corruptions.slice(0, maxToShow)

  for (const c of shown) {
    console.log(`    Line ${c.line}, col ${c.column}: ${c.count} replacement char(s)`)
    // Escape the context for display
    const displayContext = c.context
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
    console.log(`      Context: "...${displayContext}..."`)
  }

  if (corruptions.length > maxToShow) {
    console.log(`    ... and ${corruptions.length - maxToShow} more occurrences`)
  }
}

async function main() {
  let args = process.argv.slice(2)

  // When called via `npx @sanity/export detect-corrupt`, the command name
  // is passed as the first argument. Skip it if present.
  if (args[0] === 'detect-corrupt') {
    args = args.slice(1)
  }

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  const filePath = args[0]

  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`)
    process.exit(1)
  }

  console.log(`Scanning ${filePath} for UTF-8 corruption...`)

  try {
    const result = await detectCorruption(filePath)

    // Show which files were scanned
    if (result.scannedFiles.length > 0) {
      console.log(`\nScanned files:`)
      for (const file of result.scannedFiles) {
        console.log(`  - ${file}`)
      }
    }

    if (!result.corrupted) {
      console.log('\n✓ No corruption detected')
      process.exit(0)
    }

    console.log(`\n✗ Found potential corruption in ${result.files.size} file(s):`)

    for (const [filename, corruptions] of result.files) {
      printReport(filename, corruptions)
    }

    console.log(`\nTotal: ${result.totalCorruptedLines} line(s) with replacement characters`)
    console.log('\nNote: U+FFFD replacement characters indicate where multi-byte')
    console.log('UTF-8 sequences were corrupted during export streaming.')
    process.exit(1)
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main()
