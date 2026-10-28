import { expect, test } from 'bun:test'
import { deflateRawSync } from 'node:zlib'
import { readZip } from './zip'

// Builds a ZIP archive of named entries, each stored or deflated.
function zip(entries: readonly (readonly [string, Uint8Array, boolean])[]) {
	const locals: Buffer[] = []
	const centrals: Buffer[] = []
	let offset = 0

	for (const [name, data, deflate] of entries) {
		const body = deflate ? deflateRawSync(data) : Buffer.from(data)
		const nameBytes = Buffer.from(name)
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(deflate ? 8 : 0, 8)
		local.writeUInt32LE(body.length, 18)
		local.writeUInt32LE(data.length, 22)
		local.writeUInt16LE(nameBytes.length, 26)
		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(deflate ? 8 : 0, 10)
		central.writeUInt32LE(body.length, 20)
		central.writeUInt32LE(data.length, 24)
		central.writeUInt16LE(nameBytes.length, 28)
		central.writeUInt32LE(offset, 42)
		locals.push(local, nameBytes, body)
		centrals.push(central, nameBytes)
		offset += local.length + nameBytes.length + body.length
	}

	const directory = Buffer.concat(centrals)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(entries.length, 8)
	end.writeUInt16LE(entries.length, 10)
	end.writeUInt32LE(directory.length, 12)
	end.writeUInt32LE(offset, 16)
	return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

test('reads stored and deflated entries', () => {
	const text = new TextEncoder().encode('Mare Tranquillitatis '.repeat(100))
	const entries = readZip(
		zip([
			['a.cpg', new TextEncoder().encode('UTF-8'), false],
			['b.dbf', text, true],
		]),
	)
	expect([...entries.keys()]).toEqual(['a.cpg', 'b.dbf'])
	expect(new TextDecoder().decode(entries.get('a.cpg'))).toBe('UTF-8')
	expect(entries.get('b.dbf')).toEqual(text)
})

test('rejects a file that is not an archive', () => {
	expect(() => readZip(new Uint8Array(100))).toThrow('not a ZIP archive')
})
