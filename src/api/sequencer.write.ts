import { mkdir, open, rename, rm, stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { errorMessage } from 'nebulosa/src/core/util'
import { readFits } from 'nebulosa/src/io/formats/fits/fits'
import { readXisf } from 'nebulosa/src/io/formats/xisf/xisf'
import { fileHandleSource } from 'nebulosa/src/io/io'

// Write protocol of a captured frame and the classification of what a previous run left on disk.
//
// The atomic commit of the store covers state, checkpoint and artifact, and it does not cover the filesystem:
// the file is written outside it. That leaves two unavoidable crash windows — a finished file whose artifact
// was never confirmed, and a partial file already occupying the final path. The second one is the dangerous
// one, because a truncated file under the final name is indistinguishable from a good one to any existence
// check, which is the only check this version has: with no database, the deterministic final path *is* the
// external registry.
//
// So a frame is written to a temporary file on the same filesystem, validated, and renamed into place. Nothing
// observes the path before it is final, and every state the protocol can be interrupted in is classifiable
// afterwards.

// Container formats a frame is written in. It decides which parser validation reads the file with.
export type SequencerFrameFormat = 'fits' | 'xisf'

// Suffix of a temporary frame. It is not a valid frame extension, so a temporary left behind by a crash is
// never picked up as an artifact by anything scanning the directory, and it keeps the final name free.
const SEQUENCER_TEMPORARY_SUFFIX = '.partial'

// Suffix given to an invalid final that the caller asked to preserve for diagnosis.
const SEQUENCER_QUARANTINE_SUFFIX = '.invalid'

// What is on disk for one predicted final path.
//
// - missing: nothing was written, so the frame has to be captured.
// - validFinal: the file exists and parses, so the frame is done and must not be captured again.
// - invalidFinal: the file exists and does not parse; it is removed or quarantined by the classification
//   itself, and the frame is recaptured under a new attempt.
// - orphanTemporary: only the temporary exists, so the write was interrupted before the rename; it is
//   discarded and never promoted, because nothing validated it.
export type SequencerFrameClassification = 'missing' | 'validFinal' | 'invalidFinal' | 'orphanTemporary'

// Outcome of writing one frame.
export type SequencerFrameWrite = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: 'invalidFrame' | 'writeFailed'; readonly error: string }

// Filesystem and validation boundary of the protocol, injectable so a test can describe a disk state instead
// of producing one.
export interface SequencerWriteEnvironment {
	// Directory the temporary file is written into. It must share a filesystem with the final path, which the
	// session start already checked, because a rename across filesystems is a copy and stops being atomic.
	// Defaults to the directory of the final path, which trivially satisfies that.
	readonly temporaryDirectory?: string
	// Whether a written file is a readable frame of the given format. Defaults to parsing it.
	readonly valid?: (path: string, format: SequencerFrameFormat) => Promise<boolean>
	// Directory an invalid final is moved into instead of being removed, when the caller asks to preserve it
	// for diagnosis. It is never inside the namespace of the slots.
	readonly quarantineDirectory?: string
}

// Container format of a path, from its extension. Anything that is not XISF is read as FITS, which is the
// format every camera of this project writes unless it was asked for the other one.
function formatOf(path: string): SequencerFrameFormat {
	return extname(path).toLowerCase() === '.xisf' ? 'xisf' : 'fits'
}

// Whether a file is a readable frame: it exists, it is not empty, and the parser of its format accepts it.
//
// This is the fixed, cheap definition of "valid" the reconciliation is built on. Checksums are deliberately
// out of it: they are computed only when the definition configures them, and a validity test whose strength
// depends on configuration cannot be what decides whether a night's frame exists.
async function readableFrame(path: string, format: SequencerFrameFormat) {
	let handle

	try {
		const size = (await stat(path)).size
		if (size <= 0) return false

		handle = await open(path, 'r')
		const source = fileHandleSource(handle)
		const parsed = format === 'xisf' ? await readXisf(source) : await readFits(source)
		return parsed !== undefined
	} catch {
		return false
	} finally {
		await handle?.close()
	}
}

// Temporary path a frame is written to before it is renamed into `finalPath`.
//
// The name is derived from the final one, so an interrupted write is traceable to the slot it belonged to and
// two slots never share a temporary. It carries the reserved suffix instead of the frame extension.
export function sequencerTemporaryPath(finalPath: string, temporaryDirectory?: string) {
	return join(temporaryDirectory ?? dirname(finalPath), `${basename(finalPath)}${SEQUENCER_TEMPORARY_SUFFIX}`)
}

// Writes one frame through the protocol: temporary file, validation, atomic rename into the final path.
//
// The caller registers the artifact as pending before calling and confirms it with the checkpoint in one
// commit afterwards, which is the half of the protocol the store owns. This half guarantees that the final
// path either does not exist or holds a frame that parsed, so the existence check the next run performs
// answers what it is meant to answer.
//
// An invalid frame leaves nothing behind: the temporary is removed, the final path is untouched, and the
// caller recaptures under a new attempt. Returns the final path on success.
export async function writeSequencerFrame(data: Uint8Array, finalPath: string, environment: SequencerWriteEnvironment = {}): Promise<SequencerFrameWrite> {
	const temporary = sequencerTemporaryPath(finalPath, environment.temporaryDirectory)
	const valid = environment.valid ?? readableFrame

	try {
		await mkdir(dirname(finalPath), { recursive: true })
		if (environment.temporaryDirectory !== undefined) await mkdir(environment.temporaryDirectory, { recursive: true })
		await Bun.write(temporary, data)

		if (!(await valid(temporary, formatOf(finalPath)))) {
			await rm(temporary, { force: true })
			return { ok: false, reason: 'invalidFrame', error: `the frame written for ${basename(finalPath)} is not a readable image` }
		}

		await rename(temporary, finalPath)
		return { ok: true, path: finalPath }
	} catch (error) {
		// The temporary is the only thing this function created, and leaving it behind would be classified as an
		// orphan later anyway; removing it now keeps the failure from costing disk until then.
		await rm(temporary, { force: true }).catch(() => {})
		return { ok: false, reason: 'writeFailed', error: errorMessage(error) }
	}
}

// Classifies what is on disk for one predicted final path, leaving the directory in the state the
// classification reports.
//
// An invalid final is removed at classification time rather than ignored. By the suffix rule of the frame
// identity, attempt 0 occupies the clean name of the template: an unreadable file left there would keep the
// canonical name forever while the good recapture is born with a suffix, which is the opposite of what anyone
// reading the directory expects. It is unreadable by definition, its artifact row was never committed, and
// nothing references it. When `quarantineDirectory` is given, it is moved there under the quarantine suffix
// instead, which keeps it out of the namespace of the slots either way.
//
// An orphan temporary is discarded and never promoted: nothing validated it, and the exposure that produced it
// was interrupted before the protocol could.
export async function classifySequencerFrame(finalPath: string, environment: SequencerWriteEnvironment = {}): Promise<SequencerFrameClassification> {
	const valid = environment.valid ?? readableFrame

	if (await Bun.file(finalPath).exists()) {
		if (await valid(finalPath, formatOf(finalPath))) return 'validFinal'

		if (environment.quarantineDirectory !== undefined) {
			await mkdir(environment.quarantineDirectory, { recursive: true })
			await rename(finalPath, join(environment.quarantineDirectory, `${basename(finalPath)}${SEQUENCER_QUARANTINE_SUFFIX}`))
		} else {
			await rm(finalPath, { force: true })
		}

		return 'invalidFinal'
	}

	const temporary = sequencerTemporaryPath(finalPath, environment.temporaryDirectory)

	if (await Bun.file(temporary).exists()) {
		await rm(temporary, { force: true })
		return 'orphanTemporary'
	}

	return 'missing'
}
