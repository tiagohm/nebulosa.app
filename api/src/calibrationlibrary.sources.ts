import type { Stats } from 'fs'
import { open, readdir, realpath, stat } from 'fs/promises'
import { extname, join, resolve } from 'path'
import { fileHandleSource } from 'nebulosa/src/io/file'
import { type FitsHeader, FitsImageReader, readFits } from 'nebulosa/src/io/formats/fits/fits'
import { readFitsProvenance } from 'nebulosa/src/io/formats/fits/provenance'
import { cfaPatternKeyword, numericKeyword, uncompressedBitpixKeyword, uncompressedHeightKeyword, uncompressedNumberOfChannelsKeyword, uncompressedWidthKeyword } from 'nebulosa/src/io/formats/fits/util'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import { type CalibrationKind, type CalibrationMetadata, compatibilityKey, type Evidenced, groupIdOf, stableId } from './calibrationlibrary.compatibility'
import type { CalibrationSource, SourceFormat, SourceOrigin } from './calibrationlibrary.store'
import { type DarkCapturePlan, type DarkFrameRecord, type DarkPlanGroup, REJECTED_DIRECTORY, STAGING_DIRECTORY } from './darklibrarywizard.store'
import { imageAcquisition } from './images'

// What the Calibration Library knows about files: reading their headers, never their pixels; describing a frame of a
// Dark Library plan from its plan and its file together; and walking a directory an operator chose. Every read is of
// metadata, and no file is written, moved, or deleted here. Filenames and directory names are never evidence of what a
// frame is. Values in a header are verified, values only a plan recorded are plan declared, and the rest stay unknown.

// Extensions of the files an import considers.
const CALIBRATION_EXTENSIONS: ReadonlySet<string> = new Set(['.fit', '.fits', '.fts', '.xisf'])

// Directories of work in progress of the wizards, whose files are not frames yet, or are rejected ones.
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([STAGING_DIRECTORY, REJECTED_DIRECTORY])

// Prefix of the staging directory of a Flat Wizard session.
const FLAT_STAGING_PREFIX = '.flatwizard-'

// Headers read at once by a scan: enough to outrun a disk, few enough to leave capture I/O alone.
const SCAN_CONCURRENCY = 8

// Default deepest directory of a recursive scan, under the chosen one.
export const DEFAULT_SCAN_DEPTH = 8

// Largest number of files one scan considers.
export const MAX_SCAN_FILES = 50000

// Exposure, in integer microseconds, of a time in seconds.
export function exposureMicroseconds(seconds: number) {
	return Math.round(seconds * 1000000)
}

// A verified value, or an unknown one when the file does not say.
function verified<T>(value: T | undefined): Evidenced<T> {
	return value === undefined ? { evidence: 'unknown' } : { value, evidence: 'verified' }
}

// A value a header reports, else the one its plan recorded. A plan is only the source of what the header leaves out:
// when both exist the plan value stays, since it is the exact setting, and the header verified it within tolerance.
function fromPlan<T>(plan: T | undefined, header: unknown): Evidenced<T> {
	if (plan === undefined) return { evidence: 'unknown' }
	return { value: plan, evidence: header === undefined ? 'planDeclared' : 'verified' }
}

// What the header of one file says.
export interface FileInspection {
	// Format of the file.
	readonly format: SourceFormat
	// Whether a job can read its rows without decoding it whole; other files are spilled to staging first.
	readonly rowAddressable: boolean
	// Role written in the file; absent when it does not say or says something else.
	readonly kind?: CalibrationKind
	// Whether it is not a calibration frame: a light, or an already integrated master.
	readonly rejectedRole?: 'light' | 'master'
	// What is known from the header alone.
	readonly metadata: CalibrationMetadata
	// What should be said about it.
	readonly warnings: readonly string[]
	// Full scale of its samples, in digital numbers.
	readonly fullScale: number
	// Target the header names (OBJECT), a hint that never proves where the frame points.
	readonly object?: string
	// Start of the exposure the header gives, Unix milliseconds (UTC).
	readonly observedAt?: number
}

// Returns the digital full scale of samples of a BITPIX; floats declare none and assume 16 bits.
export function digitalFullScale(bitpix: number) {
	return bitpix > 0 ? 2 ** bitpix - 1 : 65535
}

// Describes a header: nothing here is inferred from a file name, and a model name never becomes a hardware id.
export function inspectHeader(header: FitsHeader, format: SourceFormat, rowAddressable: boolean, imageType?: string): FileInspection {
	const provenance = readFitsProvenance(imageType === undefined ? header : { ...header, IMAGETYP: header.IMAGETYP ?? imageType })
	const acquisition = imageAcquisition(header)
	const warnings = provenance.diagnostics.map(({ message }) => message)
	const bitpix = uncompressedBitpixKeyword(header, 0)
	const { frameType, master } = provenance
	const rejectedRole = master ? 'master' : frameType === 'light' ? 'light' : undefined
	const kind = frameType === undefined || frameType === 'light' || master ? undefined : frameType
	const origin = (key: string) => (typeof header[key] === 'number' ? numericKeyword(header, key, 0) : undefined)

	const metadata: CalibrationMetadata = {
		cameraId: { evidence: 'unknown' },
		cameraName: provenance.instrument,
		exposure: verified(acquisition.exposure === undefined ? undefined : exposureMicroseconds(acquisition.exposure)),
		setTemperature: verified(provenance.setTemperature),
		sensorTemperature: verified(provenance.sensorTemperature),
		gain: verified(provenance.gain),
		offset: verified(provenance.offset),
		binX: verified(provenance.binning?.[0]),
		binY: verified(provenance.binning?.[1]),
		readoutMode: verified(provenance.readoutMode),
		filter: verified(provenance.filter),
		telescope: verified(provenance.telescope),
		focalLength: verified(acquisition.focalLength),
		width: uncompressedWidthKeyword(header, 0),
		height: uncompressedHeightKeyword(header, 0),
		channels: uncompressedNumberOfChannelsKeyword(header, 1),
		bitpix,
		originX: origin('XORGSUBF'),
		originY: origin('YORGSUBF'),
		cfa: cfaPatternKeyword(header) || undefined,
		bayerOffsetX: origin('XBAYROFF'),
		bayerOffsetY: origin('YBAYROFF'),
	}

	const observedAt = acquisition.date === undefined ? undefined : Date.parse(acquisition.date)
	return { format, rowAddressable, kind, rejectedRole, metadata, warnings, fullScale: digitalFullScale(bitpix), object: acquisition.object, observedAt }
}

// Reads the header of a FITS or XISF file. Returns undefined when it holds no image. Throws when it cannot be opened.
export async function inspectFile(path: string): Promise<FileInspection | undefined> {
	await using source = fileHandleSource(await open(path, 'r'))

	if (extname(path).toLowerCase() === '.xisf') {
		const xisf = await readXisf(source)
		const image = xisf?.images[0]
		return image && inspectHeader(image.header, 'xisf', false, image.imageType)
	}

	const fits = await readFits(source)
	const hdu = fits?.hdus.find((candidate) => uncompressedWidthKeyword(candidate.header, 0) > 0)
	return hdu && inspectHeader(hdu.header, 'fits', new FitsImageReader(hdu).rowAddressable)
}

// Builds the row of a frame from what is known about it. The id comes from the path, so a frame keeps it across
// rebuilds, and paths are compared without case on Windows, where they name the same file.
export function makeSource(
	origin: SourceOrigin,
	originId: string | undefined,
	kind: CalibrationKind,
	path: string,
	format: SourceFormat,
	bytes: number,
	mtimeMillis: number,
	metadata: CalibrationMetadata,
	warnings: readonly string[],
	patch: Partial<Pick<CalibrationSource, 'required' | 'supported' | 'status' | 'digest' | 'excluded'>> = {},
): CalibrationSource {
	const canonical = process.platform === 'win32' ? path.toLowerCase() : path
	const key = compatibilityKey(kind, metadata)
	return { sourceId: stableId(canonical), origin, originId, kind, path, format, bytes, mtimeMillis, metadata, warnings, status: 'available', supported: true, key, groupId: groupIdOf(key), ...patch }
}

// Returns a frame with another role or metadata, in the group they put it in.
export function regrouped(source: CalibrationSource, kind: CalibrationKind, metadata: CalibrationMetadata): CalibrationSource {
	const key = compatibilityKey(kind, metadata)
	return { ...source, kind, metadata, key, groupId: groupIdOf(key) }
}

// Describes a frame of a plan: the plan names the camera and the exact settings, the header verifies them, and the file
// gives the sample geometry. Readings of the plan's trace say what the temperature really was. Warnings keep what the
// wizard said about the frame. Returns undefined for a frame that does not count.
export function darkPlanSource(plan: DarkCapturePlan, group: DarkPlanGroup, frame: DarkFrameRecord, inspection: FileInspection, bytes: number, mtimeMillis: number): CalibrationSource | undefined {
	if (frame.verdict !== 'accepted' && frame.verdict !== 'acceptedWithWarnings') return undefined

	const { capture, camera } = plan
	const { header, temperature } = frame
	const reading = temperature === undefined ? undefined : (temperature.minimum + temperature.maximum) / 2

	const metadata: CalibrationMetadata = {
		...inspection.metadata,
		cameraId: { value: camera.hardwareId, evidence: 'planDeclared' },
		cameraName: camera.name,
		exposure: fromPlan(exposureMicroseconds(group.exposure), header?.exposure),
		setTemperature: group.temperature === undefined ? { evidence: 'unknown' } : { value: group.temperature, evidence: 'planDeclared' },
		sensorTemperature: reading === undefined ? inspection.metadata.sensorTemperature : { value: reading, evidence: 'verified' },
		gain: fromPlan(capture.gain, header?.gain),
		offset: fromPlan(capture.offset, header?.offset),
		binX: fromPlan(capture.binX, header?.binning),
		binY: fromPlan(capture.binY, header?.binning),
		readoutMode: capture.frameFormat ? { value: capture.frameFormat, evidence: inspection.metadata.readoutMode.value === undefined ? 'planDeclared' : 'verified' } : inspection.metadata.readoutMode,
	}

	const warnings = [...inspection.warnings, ...frame.suspicions.map((suspicion) => `Suspicion of light: ${suspicion}`), ...frame.notes.map((note) => `Not verified: ${note}`)]
	const accepted = frame.verdict === 'accepted' || frame.acknowledged === true
	const kind = plan.purpose ?? 'dark'
	return makeSource('darkPlan', `${plan.planId}/${frame.groupId}/${frame.frameId}`, kind, frame.path, inspection.format, bytes, mtimeMillis, metadata, warnings, { required: group.count, excluded: accepted ? undefined : 'Light suspected and not acknowledged' })
}

// Returns the identity of a file of known status: device:inode, or its real path where inodes are not reported.
export async function fileIdentity(path: string, info: Pick<Stats, 'dev' | 'ino'>) {
	return info.ino ? `${info.dev}:${info.ino}` : await realpath(path)
}

// Options of a scan.
export interface ScanOptions {
	// Directory to scan.
	readonly path: string
	// Whether to enter subdirectories.
	readonly recursive: boolean
	// Deepest directory under the chosen one.
	readonly depth?: number
	// Reports the files seen and their total size, in bytes.
	readonly progress?: (files: number, bytes: number) => void
	// Stops the scan.
	readonly signal?: AbortSignal
}

// File a scan found.
export interface ScanCandidate {
	// Absolute path.
	readonly path: string
	// Size, in bytes.
	readonly bytes: number
	// Modification time, in milliseconds since the epoch.
	readonly mtimeMillis: number
	// Identity of the file on its device (device:inode), or its real path where inodes are not reported, the same for
	// every name of one file.
	readonly identity: string
	// Header of the file; absent when it could not be read.
	readonly inspection?: FileInspection
	// Why it could not be read.
	readonly error?: string
}

// Outcome of a scan.
export interface ScanResult {
	// Files found, in path order.
	readonly candidates: readonly ScanCandidate[]
	// Whether the limit on files stopped the walk.
	readonly truncated: boolean
}

// Walks a directory, and reads the headers of what it finds with a bounded concurrency. Directory links are followed
// once by their real path, so a loop ends; a file reached twice through a hard link or another name counts once.
// Directories that cannot be read are skipped. Throws when the signal aborts or the directory cannot be read at all.
export async function scanDirectory({ path, recursive, depth = DEFAULT_SCAN_DEPTH, progress, signal }: ScanOptions): Promise<ScanResult> {
	const root = resolve(path)
	const visited = new Set<string>()
	const known = new Set<string>()
	const found: { readonly path: string; readonly bytes: number; readonly mtimeMillis: number; readonly identity: string }[] = []
	let bytes = 0
	let truncated = false

	async function walk(directory: string, level: number) {
		signal?.throwIfAborted()
		if (truncated) return

		const real = await realpath(directory)
		if (visited.has(real)) return
		visited.add(real)

		let entries

		try {
			entries = await readdir(directory, { withFileTypes: true })
		} catch (error) {
			if (level === 0) throw error
			return
		}

		for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
			const child = join(directory, entry.name)
			const link = entry.isSymbolicLink()

			if (entry.isDirectory() || link) {
				const info = await stat(child).catch(() => undefined)

				if (info?.isDirectory()) {
					if (recursive && level < depth && !SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(FLAT_STAGING_PREFIX)) await walk(child, level + 1)
					continue
				}

				if (!info) continue
			}

			if (!CALIBRATION_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue

			const info = await stat(child).catch(() => undefined)
			if (!info?.isFile()) continue

			const identity = await fileIdentity(child, info)
			if (known.has(identity)) continue
			known.add(identity)

			if (found.length >= MAX_SCAN_FILES) {
				truncated = true
				return
			}

			found.push({ path: child, bytes: info.size, mtimeMillis: info.mtimeMs, identity })
			bytes += info.size
			progress?.(found.length, bytes)
		}
	}

	await walk(root, 0)

	const candidates = new Array<ScanCandidate>(found.length)
	let next = 0

	async function inspectNext() {
		for (let index = next++; index < found.length; index = next++) {
			signal?.throwIfAborted()
			const file = found[index]

			try {
				const inspection = await inspectFile(file.path)
				candidates[index] = inspection ? { ...file, inspection } : { ...file, error: 'The file holds no image' }
			} catch (error) {
				candidates[index] = { ...file, error: Error.isError(error) ? error.message : String(error) }
			}
		}
	}

	await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, inspectNext))
	return { candidates, truncated }
}
