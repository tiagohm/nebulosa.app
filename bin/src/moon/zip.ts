import { inflateRawSync } from 'node:zlib'

// Minimal ZIP reader for the generator's downloaded archives: reads the central directory and returns
// every entry, stored or deflated, in memory. ZIP64, encryption, and multi-disk archives are not
// supported and fail instead of returning partial data.

// Signature of the end of central directory record.
const END_OF_CENTRAL_DIRECTORY = 0x06054b50

// Signature of a central directory file header.
const CENTRAL_FILE_HEADER = 0x02014b50

// Signature of a local file header.
const LOCAL_FILE_HEADER = 0x04034b50

// Size of the end of central directory record without its comment, in bytes.
const END_OF_CENTRAL_DIRECTORY_SIZE = 22

// Longest archive comment, in bytes, which bounds the backward search for the end record.
const MAX_COMMENT_SIZE = 0xffff

// Compression method of a stored entry.
const STORED = 0

// Compression method of a deflated entry.
const DEFLATED = 8

// Returns the entries of a ZIP archive by name, decompressed. Throws on an archive it cannot read.
export function readZip(archive: Uint8Array): Map<string, Uint8Array> {
	const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
	const lowest = Math.max(0, archive.byteLength - END_OF_CENTRAL_DIRECTORY_SIZE - MAX_COMMENT_SIZE)
	let end = archive.byteLength - END_OF_CENTRAL_DIRECTORY_SIZE

	while (end >= lowest && view.getUint32(end, true) !== END_OF_CENTRAL_DIRECTORY) end--
	if (end < lowest) throw new Error('not a ZIP archive: no end of central directory')

	const count = view.getUint16(end + 10, true)
	let offset = view.getUint32(end + 16, true)
	const entries = new Map<string, Uint8Array>()
	const decoder = new TextDecoder()

	for (let i = 0; i < count; i++) {
		if (view.getUint32(offset, true) !== CENTRAL_FILE_HEADER) throw new Error('corrupt ZIP central directory')

		const flags = view.getUint16(offset + 8, true)
		const method = view.getUint16(offset + 10, true)
		const compressedSize = view.getUint32(offset + 20, true)
		const size = view.getUint32(offset + 24, true)
		const nameLength = view.getUint16(offset + 28, true)
		const extraLength = view.getUint16(offset + 30, true)
		const commentLength = view.getUint16(offset + 32, true)
		const local = view.getUint32(offset + 42, true)
		const name = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength))

		if (flags & 1) throw new Error(`encrypted ZIP entry: ${name}`)
		if (compressedSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new Error(`ZIP64 entry: ${name}`)
		if (view.getUint32(local, true) !== LOCAL_FILE_HEADER) throw new Error(`corrupt ZIP local header: ${name}`)

		const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
		const data = archive.subarray(start, start + compressedSize)

		if (method === STORED) entries.set(name, data)
		else if (method === DEFLATED) entries.set(name, new Uint8Array(inflateRawSync(data)))
		else throw new Error(`unsupported ZIP compression method ${method}: ${name}`)

		if (entries.get(name)!.byteLength !== size) throw new Error(`corrupt ZIP entry size: ${name}`)

		offset += 46 + nameLength + extraLength + commentLength
	}

	return entries
}
