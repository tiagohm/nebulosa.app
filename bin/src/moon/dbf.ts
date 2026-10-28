// Minimal dBase III reader for the attribute table (.dbf) of a shapefile: every field of every record as
// trimmed text, decoded with the encoding of the shapefile's .cpg file. Deleted records are skipped. The
// caller parses numbers, since a numeric field is text in the file.

// Field descriptor terminator of the header.
const HEADER_TERMINATOR = 0x0d

// First byte of a deleted record.
const DELETED = 0x2a

// Size of the file header and of each field descriptor, in bytes.
const DESCRIPTOR_SIZE = 32

// A field of a .dbf table.
export interface DbfField {
	// Field name.
	readonly name: string
	// dBase type letter: C (character), N (numeric), F (float), D (date), L (logical).
	readonly type: string
	// Width of the field in each record, in bytes.
	readonly length: number
}

// A decoded .dbf table.
export interface DbfTable {
	// Fields in record order.
	readonly fields: readonly DbfField[]
	// Records that are not deleted, each mapping a field name to its trimmed text.
	readonly records: readonly Readonly<Record<string, string>>[]
}

// Decodes a .dbf table; `encoding` is the WHATWG label of its text (the .cpg content, UTF-8 by default).
export function readDbf(data: Uint8Array, encoding = 'utf-8'): DbfTable {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
	const count = view.getUint32(4, true)
	const headerLength = view.getUint16(8, true)
	const recordLength = view.getUint16(10, true)
	const latin1 = new TextDecoder('latin1')
	const decoder = new TextDecoder(encoding.trim() || 'utf-8')
	const fields: DbfField[] = []

	for (let offset = DESCRIPTOR_SIZE; offset < headerLength && data[offset] !== HEADER_TERMINATOR; offset += DESCRIPTOR_SIZE) {
		const raw = latin1.decode(data.subarray(offset, offset + 11))
		const end = raw.indexOf('\0')
		fields.push({ name: end < 0 ? raw : raw.slice(0, end), type: String.fromCharCode(data[offset + 11]), length: data[offset + 16] })
	}

	if (fields.reduce((sum, field) => sum + field.length, 1) !== recordLength) throw new Error('corrupt DBF header: field widths do not match the record length')
	if (headerLength + count * recordLength > data.byteLength) throw new Error('truncated DBF file')

	const records: Record<string, string>[] = []

	for (let i = 0; i < count; i++) {
		let offset = headerLength + i * recordLength
		if (data[offset] === DELETED) continue
		offset++

		const record: Record<string, string> = {}

		for (const field of fields) {
			record[field.name] = decoder.decode(data.subarray(offset, offset + field.length)).trim()
			offset += field.length
		}

		records.push(record)
	}

	return { fields, records }
}
