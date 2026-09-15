import {createReadStream} from 'node:fs'
import {readdir, stat} from 'node:fs/promises'
import {join as joinPath} from 'node:path'
import {Readable, Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'

import {createTarPacker} from 'modern-tar'

import {debug} from '../debug.js'

/**
 * An incrementally built tar archive.
 *
 * Entries can be added while `stream` is already being consumed, which is what lets an
 * export start writing `data.ndjson` to the output while assets are still downloading.
 *
 * @internal
 */
export interface TarArchive {
  /** The archive bytes. Consume this while adding entries. */
  stream: Readable

  /** Adds the file at `sourcePath` to the archive, stored as `name`. */
  addFile: (sourcePath: string, name: string) => Promise<void>

  /** Adds the directory at `sourcePath`, and everything below it, stored under `name`. */
  addDirectory: (sourcePath: string, name: string) => Promise<void>

  /** Writes the end-of-archive marker and ends `stream`. */
  finalize: () => void

  /** Aborts the archive, making `stream` emit `err`. */
  abort: (err: unknown) => void
}

/**
 * Creates an empty tar archive that entries can be added to one at a time.
 *
 * Headers are deliberately written without owner information and with fixed permissions
 * (0644 for files, 0755 for directories), so that the same set of files always produces
 * the same archive regardless of who ran the export or on which machine.
 *
 * @internal
 */
export function createTarArchive(): TarArchive {
  const {readable, controller} = createTarPacker()

  async function addFile(sourcePath: string, name: string): Promise<void> {
    const stats = await stat(sourcePath)

    debug('Adding archive entry: %s', name)

    // `size` has to match the number of bytes written exactly. Nothing else writes to the
    // staging directory once an entry is being added, and a mismatch throws rather than
    // producing a corrupt archive, so the stat is safe to trust here.
    const body = controller.add({
      name,
      size: stats.size,
      type: 'file',
      mtime: stats.mtime,
    })

    await pipeline(createReadStream(sourcePath), Writable.fromWeb(body))
  }

  async function addDirectory(sourcePath: string, name: string): Promise<void> {
    const stats = await stat(sourcePath)

    debug('Adding archive entry: %s/', name)

    const body = controller.add({
      name: `${name}/`,
      size: 0,
      type: 'directory',
      mtime: stats.mtime,
    })
    await body.close()

    // Sorted so that a given directory always packs in the same order
    const entries = (await readdir(sourcePath, {withFileTypes: true})).sort((a, b) =>
      a.name.localeCompare(b.name),
    )

    for (const entry of entries) {
      const childPath = joinPath(sourcePath, entry.name)
      const childName = `${name}/${entry.name}`

      if (entry.isDirectory()) {
        await addDirectory(childPath, childName)
      } else if (entry.isFile()) {
        await addFile(childPath, childName)
      } else {
        debug('Archive warning: skipping %s, not a regular file or directory', childPath)
      }
    }
  }

  return {
    stream: Readable.fromWeb(readable),
    addFile,
    addDirectory,
    finalize: () => controller.finalize(),
    abort: (err: unknown) => controller.error(err),
  }
}
