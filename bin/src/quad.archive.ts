import { createWriteStream } from 'fs'
import { mkdir, rename, rm, stat } from 'fs/promises'
import { basename, join, resolve } from 'path'
import { exit } from 'process'
import { pipeline } from 'stream/promises'
import { parseArgs } from 'util'
import { constants, createZstdCompress } from 'zlib'

// Packs the quad index files of a folder written by bun make:quads into one zstd-compressed tarball per band of its
// manifest. The tarball is streamed file by file through zstd to disk, so no band is held in memory (Bun.Archive needs
// every entry in memory, and writes a lazy Bun.file as an empty entry).
// Usage: bun bin/src/quad.archive.ts <folder> [--output <directory>] [--level 1..22]

// Band of the manifest, as far as the packing needs it.
interface ManifestBand {
	readonly tileNside: number
	readonly partial: boolean
	readonly files: readonly string[]
}

// Manifest written by bun make:quads.
interface Manifest {
	readonly catalog: string
	readonly bands: readonly ManifestBand[]
}

// Size of a tar block, bytes: headers are one block and file contents are padded to whole blocks.
const BLOCK = 512

// Largest file size the 11 octal digits of a ustar header hold, bytes (8 GiB - 1).
const MAX_TAR_SIZE = 0o77777777777

// Default zstd compression level: high, while still compressing a few MiB per second (the range is 1..22).
const DEFAULT_LEVEL = 19

const encoder = new TextEncoder()

// Writes text as ASCII at an offset of a header.
function put(header: Uint8Array, offset: number, text: string) {
	header.set(encoder.encode(text), offset)
}

// Returns the ustar header of a regular file: its name (at most 100 bytes), size in bytes and modification time in seconds.
function tarHeader(name: string, size: number, mtime: number) {
	const header = new Uint8Array(BLOCK)
	put(header, 0, name)
	put(header, 100, '0000644\0')
	put(header, 108, '0000000\0')
	put(header, 116, '0000000\0')
	put(header, 124, `${size.toString(8).padStart(11, '0')}\0`)
	put(header, 136, `${Math.floor(mtime).toString(8).padStart(11, '0')}\0`)
	// The checksum is computed with its own field filled with spaces.
	put(header, 148, '        ')
	put(header, 156, '0')
	put(header, 257, 'ustar\0')
	put(header, 263, '00')

	let checksum = 0
	for (const byte of header) checksum += byte
	put(header, 148, `${checksum.toString(8).padStart(6, '0')}\0 `)

	return header
}

// Yields the tar stream of files of a folder, reading each one in chunks; throws when a file changes size while read.
async function* tarStream(folder: string, names: readonly string[]) {
	for (const name of names) {
		const path = join(folder, name)
		const { size, mtimeMs } = await stat(path)
		yield tarHeader(name, size, mtimeMs / 1000)

		let read = 0

		for await (const chunk of Bun.file(path).stream()) {
			read += chunk.byteLength
			yield chunk
		}

		if (read !== size) throw new Error(`${path} changed while it was packed`)
		if (size % BLOCK !== 0) yield new Uint8Array(BLOCK - (size % BLOCK))
	}

	// The archive ends with two zero blocks.
	yield new Uint8Array(2 * BLOCK)
}

const { values, positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true, options: { output: { type: 'string' }, level: { type: 'string', default: `${DEFAULT_LEVEL}` } } })

if (positionals.length !== 1) {
	console.error('Usage: bun bin/src/quad.archive.ts <folder> [--output <directory>] [--level 1..22]')
	exit(1)
}

const folder = resolve(positionals[0])
const output = resolve(values.output ?? `${folder}-archives`)
const level = +values.level

await mkdir(output, { recursive: true })
const manifest = (await Bun.file(join(folder, 'manifest.json')).json()) as Manifest

for (const band of manifest.bands) {
	if (band.files.length === 0) continue

	// nqi-<band>-<tileNside>-<tile>[-region].nqi gives nqi-<band>-<tileNside>[-region].tar.zst.
	const [prefix, size, tileNside] = band.files[0].split('-')
	const name = `${prefix}-${size}-${tileNside}${band.partial ? '-region' : ''}.tar.zst`
	let bytes = 0

	for (const file of band.files) {
		const info = await stat(join(folder, file)).catch(() => undefined)

		if (info === undefined) {
			console.error(`${file} of the manifest is missing from ${folder}`)
			exit(1)
		} else if (encoder.encode(file).length > 100 || info.size > MAX_TAR_SIZE) {
			console.error(`${file} does not fit a ustar header`)
			exit(1)
		}

		bytes += info.size
	}

	// Written under a temporary name, so an interrupted run leaves no truncated tarball.
	const path = join(output, name)
	const partial = `${path}.part`
	const started = performance.now()

	try {
		await pipeline(tarStream(folder, band.files), createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: level, [constants.ZSTD_c_checksumFlag]: 1 } }), createWriteStream(partial))
		await rename(partial, path)
	} catch (error) {
		await rm(partial, { force: true })
		throw error
	}

	const packed = Bun.file(path).size
	const hasher = new Bun.CryptoHasher('sha256')
	for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
	console.info(`${name}: ${band.files.length} files, ${(bytes / 1048576).toFixed(1)} MiB into ${(packed / 1048576).toFixed(1)} MiB, ${((performance.now() - started) / 1000).toFixed(1)} s, files ${band.files.length}, bytes ${bytes}, archiveBytes ${packed}, sha256 ${hasher.digest('hex')}`)
}

console.info(`packed ${manifest.catalog} from ${basename(folder)} into ${output}`)
