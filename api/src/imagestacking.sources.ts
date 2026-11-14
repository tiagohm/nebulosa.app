import { relative, resolve } from 'path'
import { type HeaderMetadata, stableId } from './calibrationlibrary.compatibility'
import type { FileInspection } from './calibrationlibrary.sources'

// What Image Stacking knows about light frames from their headers, never their pixels: their role, the physical filter
// they were taken through, and the acquisition settings that decide which calibration masters fit them. The filter is
// exactly the name its header writes, trimmed, never classified, so names spelled differently are different filters,
// and a header that names none means no filter (None). The target named by OBJECT is a hint shown to the operator.
// Nothing is inferred from a file or directory name.

// Role of a frame in a project:
// - light: a light frame by its header or by an operator's declaration.
// - unclassified: the header says no role; it waits for an operator and joins no filter group.
export type StackingRole = 'light' | 'unclassified'

// Version of the acquisition key. A change regroups cohorts, never the frames of a filter.
export const COHORT_KEY_VERSION = 2

// Filter of the frames whose header names none, or a blank one.
export const NO_FILTER = 'None'

// Returns the filter of a frame: the name its header writes, trimmed, or NO_FILTER when it is absent or blank.
export function filterKeyOf(name: string | undefined) {
	return name?.trim() || NO_FILTER
}

// Serializes the acquisition settings that one set of calibration masters must match: the camera of the Equipment Catalog
// a capture recorded (cameraId; absent when none did), camera name, geometry, sample type, CFA layout, binning, gain,
// offset, readout mode, and exposure in integer microseconds. Unknown values are kept as unknown, so they never agree with
// a known one. Temperature is left out: it is checked against a master, not a cohort.
export function cohortKeyOf(metadata: HeaderMetadata, cameraId?: string) {
	const value = (field: { readonly value?: string | number }) => (field.value === undefined ? '?' : String(field.value))
	const parts = [
		`v${COHORT_KEY_VERSION}`,
		`catalog=${cameraId ?? '?'}`,
		`camera=${metadata.cameraName ?? '?'}`,
		`size=${metadata.width}x${metadata.height}x${metadata.channels}`,
		`bitpix=${metadata.bitpix}`,
		`origin=${metadata.originX ?? '?'},${metadata.originY ?? '?'}`,
		`cfa=${metadata.cfa ?? ''}@${metadata.bayerOffsetX ?? 0},${metadata.bayerOffsetY ?? 0}`,
		`bin=${value(metadata.binX)}x${value(metadata.binY)}`,
		`gain=${value(metadata.gain)}`,
		`offset=${value(metadata.offset)}`,
		`readout=${value(metadata.readoutMode)}`,
		`exposure=${value(metadata.exposure)}`,
	]
	return parts.join('|')
}

// Returns the role a header gives a file in a project, or why it does not belong in one: a calibration frame or an
// integrated master is not a light, and a header without a role leaves the frame unclassified.
export function lightRoleOf(inspection: Pick<FileInspection, 'kind' | 'rejectedRole'>): { readonly role: StackingRole } | { readonly rejected: string } {
	if (inspection.rejectedRole === 'master') return { rejected: 'An integrated master, not a light frame' }
	if (inspection.kind !== undefined) return { rejected: `A ${inspection.kind} frame, not a light frame` }
	return { role: inspection.rejectedRole === 'light' ? 'light' : 'unclassified' }
}

// Returns the id of a frame of a project, derived from its project and path; paths are compared without case on
// Windows, where they name the same file.
export function stackingSourceId(projectId: string, path: string) {
	return stableId(`${projectId}|${process.platform === 'win32' ? path.toLowerCase() : path}`)
}

// Returns whether a path is one of the directories or inside one of them.
export function isWithin(path: string, directories: readonly string[]) {
	const target = resolve(path)

	for (const directory of directories) {
		const rest = relative(resolve(directory), target)
		if (rest === '' || (!rest.startsWith('..') && !rest.startsWith('/') && !rest.startsWith('\\') && !/^[a-zA-Z]:/.test(rest))) return true
	}

	return false
}
