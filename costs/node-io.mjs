// node:fs in place of $.fs, for tests and local checks.
import { open, readdir, stat, access } from 'node:fs/promises'

async function range(path, offset, length) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return buffer.subarray(0, bytesRead)
  } finally { await handle.close() }
}

export const nodeIo = {
  exists: path => access(path).then(() => true, () => false),
  list: async path => Promise.all((await readdir(path, { withFileTypes: true })).map(async entry => {
    const kind = entry.isSymbolicLink() ? 'other' : entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other'
    const info = kind === 'file' ? await stat(`${path}/${entry.name}`) : { size: 0, mtimeMs: 0 }
    return { name: entry.name, kind, size: info.size, mtimeMs: info.mtimeMs, isLink: entry.isSymbolicLink() }
  })),
  text: async (path, offset, length) => (await range(path, offset, length)).toString('utf8'),
  bytes: async (path, offset, length) => new Uint8Array(await range(path, offset, length)),
}
