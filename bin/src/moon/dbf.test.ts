import { expect, test } from 'bun:test'
import { readDbf } from './dbf'

// Builds a dBase III table of character fields, in UTF-8; a record whose first value starts with * is deleted.
function dbf(fields: readonly (readonly [string, number])[], records: readonly (readonly string[])[]) {
	const recordLength = 1 + fields.reduce((sum, [, length]) => sum + length, 0)
	const headerLength = 32 + fields.length * 32 + 1
	const data = Buffer.alloc(headerLength + records.length * recordLength, 0x20)
	data.fill(0, 0, headerLength)
	data.writeUInt32LE(records.length, 4)
	data.writeUInt16LE(headerLength, 8)
	data.writeUInt16LE(recordLength, 10)

	for (const [i, [name, length]] of fields.entries()) {
		data.write(name, 32 + i * 32, 'latin1')
		data.write('C', 32 + i * 32 + 11, 'latin1')
		data[32 + i * 32 + 16] = length
	}

	data[headerLength - 1] = 0x0d

	for (const [i, values] of records.entries()) {
		let offset = headerLength + i * recordLength
		const deleted = values[0].startsWith('*')
		data[offset++] = deleted ? 0x2a : 0x20
		for (const [j, value] of values.entries()) {
			data.write(deleted && j === 0 ? value.slice(1) : value, offset, 'utf8')
			offset += fields[j][1]
		}
	}

	return new Uint8Array(data)
}

test('reads the fields and the records that are not deleted, decoding UTF-8', () => {
	const table = readDbf(
		dbf(
			[
				['name', 20],
				['center_lon', 10],
			],
			[
				['Ångström', '318.5'],
				['*Gone', '1'],
				['Copernicus', '339.92'],
			],
		),
		'UTF-8\n',
	)

	expect(table.fields).toEqual([
		{ name: 'name', type: 'C', length: 20 },
		{ name: 'center_lon', type: 'C', length: 10 },
	])
	expect(table.records).toEqual([
		{ name: 'Ångström', center_lon: '318.5' },
		{ name: 'Copernicus', center_lon: '339.92' },
	])
})
