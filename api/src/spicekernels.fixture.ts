// Writer of small, valid little-endian DAF/SPK files for the tests of the SPICE Kernel Library and of the Sky ephemeris:
// each segment is one type 2 Chebyshev record holding a constant position, in km, relative to its center over its
// coverage, in TDB seconds past J2000. The layout follows the DAF Required Reading: the file record, one summary record
// (up to 25 segments), its name record, and the data from the fourth record on.

// Size of a DAF record, in bytes.
const RECORD_SIZE = 1024

// FTP validation string every DAF/ file carries at FTP_OFFSET of its file record.
const FTP_STRING = 'FTPSTR:\r:\n:\r\n:\r\u0000:\u0081:\u0010\u00CE:ENDFTP'

// Byte offset of the FTP validation string.
const FTP_OFFSET = 699

// One constant segment of a fixture.
export interface SpkFixtureSegment {
	// NAIF codes of the center and the target.
	readonly center: number
	readonly target: number
	// Coverage, in TDB seconds past J2000.
	readonly start: number
	readonly end: number
	// Constant position of the target relative to the center, in km.
	readonly position: readonly [number, number, number]
	// NAIF frame code; J2000 (1) by default.
	readonly frame?: number
	// SPK data type written in the descriptor; 2 by default. The data is a type 2 record whatever it says.
	readonly type?: number
}

// Bytes of a DAF/SPK file of segments, in file order.
export function spkFixture(segments: readonly SpkFixtureSegment[]): Buffer {
	const buffer = Buffer.alloc(3 * RECORD_SIZE + segments.length * 12 * 8)
	buffer.write('DAF/SPK ', 0, 'ascii')
	buffer.writeInt32LE(2, 8)
	buffer.writeInt32LE(6, 12)
	buffer.write('NEBULOSA TEST KERNEL', 16, 'ascii')
	buffer.writeInt32LE(2, 76)
	buffer.writeInt32LE(2, 80)
	buffer.writeInt32LE(3 * 128 + segments.length * 12 + 1, 84)
	buffer.write('LTL-IEEE', 88, 'ascii')
	buffer.write(FTP_STRING, FTP_OFFSET, 'latin1')

	const summaries = RECORD_SIZE
	buffer.writeDoubleLE(segments.length, summaries + 16)

	for (const [i, { center, target, start, end, position, frame = 1, type = 2 }] of segments.entries()) {
		const first = 3 * 128 + i * 12 + 1
		const offset = summaries + 24 + i * 40
		buffer.writeDoubleLE(start, offset)
		buffer.writeDoubleLE(end, offset + 8)
		for (const [j, value] of [target, center, frame, type, first, first + 11].entries()) buffer.writeInt32LE(value, offset + 16 + j * 4)
		buffer.write(`SEGMENT ${target}`, 2 * RECORD_SIZE + i * 40, 'ascii')

		const words = [(start + end) / 2, (end - start) / 2, position[0], 0, position[1], 0, position[2], 0, start, end - start, 8, 1]
		for (const [j, value] of words.entries()) buffer.writeDoubleLE(value, (first - 1 + j) * 8)
	}

	return buffer
}
