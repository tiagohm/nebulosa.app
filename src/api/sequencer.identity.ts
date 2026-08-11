import type { SequencerPlanFrameGroup } from '#/sequencer.plan'
import type { SequencerArtifact } from '#/sequencer.state'
import type { SequencerAuxiliaryKind } from './sequencer.path'

// Identity of a captured frame: which slot of the plan it fills, which physical attempt produced it, and what
// it is called on disk.
//
// The identity is deterministic by construction. It comes from the definition, the session, and the
// checkpoint, and never from a loose counter or a clock reading, because in this version the final path is
// itself the external registry: a reconciliation walks the paths the session predicts and the artifact row
// only confirms what it found. A name derived from the instant of the exposure could not be predicted, so
// nothing could ever ask whether a frame already exists.
//
// Exposure times are in seconds.

// Separator between the components of a logical slot id. It is not a path separator and never reaches a file
// name, which carries the rendered token instead.
const SEQUENCER_SLOT_SEPARATOR = '#'

// Slot the definition requires, composed of the node, the frame group, the cycle, and the ordinal inside that
// cycle.
//
// The target is not a fourth component because the node id already carries it, which is exactly why the
// target segment of a node id has to exist from this version on: without it, two targets declaring the same
// frame groups would produce the same slots and fight over the same files.
//
// The cycle is a component because the ordinal restarts on every repetition, so cycle 1 would otherwise
// reproduce the ids of cycle 0. A globally increasing ordinal would solve the collision as well, at the cost
// of persisting it as extra checkpoint state and of an id that no longer says which cycle it belongs to.
export function sequencerLogicalSlotId(nodeId: string, groupId: string, cycle: number, ordinal: number) {
	return `${nodeId}${SEQUENCER_SLOT_SEPARATOR}${groupId}${SEQUENCER_SLOT_SEPARATOR}${cycle}${SEQUENCER_SLOT_SEPARATOR}${ordinal}`
}

// Key of the artifact registry, `sessionId + logicalSlotId + attempt`.
//
// The attempt belongs in the key because a rejected frame and its recapture have to coexist, and the session
// belongs in it because two runs of the same definition produce exactly the same slots.
export function sequencerArtifactId(sessionId: string, logicalSlotId: string, attempt: number) {
	return `${sessionId}${SEQUENCER_SLOT_SEPARATOR}${logicalSlotId}${SEQUENCER_SLOT_SEPARATOR}${attempt}`
}

// Physical attempt to execute next for one slot, derived from the artifact registry rather than stored.
//
// Attempts start at 0 and grow only when a previous one was rejected or abandoned, so a registry that holds
// nothing for the slot answers 0. The highest recorded attempt decides the rest: a `pending` record is the
// attempt that was registered and never finished, and it is executed again under the same number, because
// repeating the attempt is what makes the write idempotent against a crash between the exposure and the
// commit. Anything else recorded is an attempt that is over, and the next one is the number after it.
//
// A slot whose highest record is `committed` is a slot that is done; the caller checks that before asking for
// an attempt, and asking anyway answers the number after the committed one.
//
// `artifacts` are the records of one session, in any order, and only those of `logicalSlotId` are read.
export function sequencerSlotAttempt(artifacts: readonly SequencerArtifact[], logicalSlotId: string) {
	let highest = -1
	let pending = false

	for (const artifact of artifacts) {
		if (artifact.logicalSlotId !== logicalSlotId) continue

		if (artifact.attempt > highest) {
			highest = artifact.attempt
			pending = artifact.status === 'pending'
		}
	}

	if (highest < 0) return 0

	return pending ? highest : highest + 1
}

// Placeholders a storage template may interpolate. Everything here is known before the exposure starts, which
// is what keeps the path derivable from the definition, the session, and the checkpoint alone.
export const SEQUENCER_TEMPLATE_PLACEHOLDERS = ['target', 'group', 'frameType', 'filter', 'exposure', 'cycle', 'ordinal', 'attempt'] as const

// Matches one placeholder occurrence, including an unknown one, so a template can be scanned for names the
// renderer does not recognize instead of rendering them literally into a file name.
const SEQUENCER_TEMPLATE_PLACEHOLDER = /\{([^{}]*)\}/g

// Placeholder names of a template that no renderer interpolates, in the order they appear.
//
// A name that is not interpolated would survive into the file name as literal text, which is the silent
// acceptance the compatibility rule forbids: the operator asked for a value and got the word back.
export function sequencerUnknownPlaceholders(template: string) {
	const unknown: string[] = []

	for (const match of template.matchAll(SEQUENCER_TEMPLATE_PLACEHOLDER)) {
		const name = match[1]
		if (!(SEQUENCER_TEMPLATE_PLACEHOLDERS as readonly string[]).includes(name) && !unknown.includes(name)) unknown.push(name)
	}

	return unknown
}

// Characters kept verbatim in a rendered path segment. Everything else becomes a dash, which is what encodes a
// declared id or a rendered value into something that cannot carry a host separator into a segment.
const SEQUENCER_SAFE_CHARACTER = /[^A-Za-z0-9._-]+/g

// Run of separator characters containing at least one dash, collapsed into a single dash so an id full of
// unsafe characters does not render as a row of dashes and so the dots left around a substitution disappear
// with it.
const SEQUENCER_SUBSTITUTE_RUN = /[-.]*-[-.]*/g

// Leading and trailing separator characters. Trimming the dots is what keeps a value that encoded to `..` or to
// `.` from surviving as a relative name: the segment becomes empty and the caller drops it, instead of
// addressing the parent of the directory the session was given.
const SEQUENCER_SEPARATOR_EDGE = /^[-.]+|[-.]+$/g

// Encodes one interpolated value into a path segment: unsafe characters become dashes, separator runs collapse,
// and separators at either edge are dropped. The result can be empty, which a caller composing a name has to
// tolerate rather than write as a segment of its own.
function encodeSegment(value: string) {
	return value.replace(SEQUENCER_SAFE_CHARACTER, '-').replace(SEQUENCER_SUBSTITUTE_RUN, '-').replace(SEQUENCER_SEPARATOR_EDGE, '')
}

// Offset basis of the 32-bit FNV-1a hash.
const SEQUENCER_HASH_BASIS = 0x811c9dc5

// Prime of the 32-bit FNV-1a hash.
const SEQUENCER_HASH_PRIME = 0x01000193

// 32-bit FNV-1a hash of a string, as eight hexadecimal digits.
//
// The hash is implemented here instead of taken from the runtime because the file names of a session outlive
// the process that wrote them: a hash whose algorithm changed between versions would rename every slot of a
// resumed session and orphan the frames already on disk.
function hashOf(value: string) {
	let hash = SEQUENCER_HASH_BASIS

	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, SEQUENCER_HASH_PRIME)
	}

	return (hash >>> 0).toString(16).padStart(8, '0')
}

// Rendering of a logical slot id inside a file name: the readable encoding of the id, followed by the hash of
// the id itself.
//
// The readable half maps several characters onto the same dash, so two slot ids differing only in a character
// that does not survive the encoding would render the same name, and the second slot would find the file of
// the first and be skipped as already captured — a lost night with no error reported. The hash is what makes
// the token injective in practice, and it is computed over the id and not over the encoding.
export function sequencerSlotToken(logicalSlotId: string) {
	return `${encodeSegment(logicalSlotId)}-${hashOf(logicalSlotId)}`
}

// Everything a template interpolates for one frame, plus the identity the file name has to carry.
export interface SequencerFrameNaming {
	// Declared target id, which is the readable half of the node segment.
	readonly targetId: string
	// Group providing the frame.
	readonly group: SequencerPlanFrameGroup
	// Cycle of the slot.
	readonly cycle: number
	// Ordinal of the slot inside the group and cycle.
	readonly ordinal: number
	// Physical attempt producing the file.
	readonly attempt: number
	// Filter installed for the exposure, absent when the session commands no wheel. It is the resolved name and
	// not the reference of the group, because a group may address a filter by slot.
	readonly filter?: string
}

// Renders the exposure of a group for a file name: an integral duration renders without a decimal point, and
// a fractional one keeps up to three decimals, which is the resolution a declared exposure is written at.
function exposureOf(exposureTime: number) {
	return Number.isInteger(exposureTime) ? `${exposureTime}` : `${Number(exposureTime.toFixed(3))}`
}

// Interpolates the recognized placeholders of a template, encoding every value into path-segment characters.
//
// An unrecognized placeholder is left untouched, because the compiler refuses the template that carries one
// and reaching here with one is a bug rather than a value to invent.
function render(template: string, naming: SequencerFrameNaming) {
	const { group } = naming

	return template.replace(SEQUENCER_TEMPLATE_PLACEHOLDER, (match, name: string) => {
		switch (name) {
			case 'target':
				return encodeSegment(naming.targetId)
			case 'group':
				return encodeSegment(group.id)
			case 'frameType':
				return encodeSegment(group.frameType)
			case 'filter':
				return encodeSegment(naming.filter ?? '')
			case 'exposure':
				return exposureOf(group.exposureTime)
			case 'cycle':
				return `${naming.cycle}`
			case 'ordinal':
				return `${naming.ordinal}`
			case 'attempt':
				return `${naming.attempt}`
			default:
				return match
		}
	})
}

// Directory segments the directory template renders to for one frame, in order.
//
// Empty segments are dropped, so a template whose only content is a placeholder that rendered empty writes
// straight into the session directory instead of into a directory with no name.
export function sequencerFrameDirectories(template: string, naming: SequencerFrameNaming) {
	const segments: string[] = []

	for (const segment of render(template, naming).split(/[/\\]/)) {
		const encoded = encodeSegment(segment)
		if (encoded.length > 0) segments.push(encoded)
	}

	return segments
}

// File name of one frame: the readable part the template asked for, the slot token, the attempt suffix from
// the second attempt on, and the extension.
//
// The template decides the readable part and cannot remove the identifying one. A template with no
// placeholder at all is a valid configuration, and without the slot token it would name every slot the same
// way. The attempt appears only from attempt 1 on, so the ordinary case — the only case in this version —
// produces exactly the name the template would have produced without the notion of attempts, and a future
// recapture needs neither a separate namespace nor a rename of the file it replaces.
//
// `extension` is the file extension without the dot.
export function sequencerFrameFileName(template: string, naming: SequencerFrameNaming, logicalSlotId: string, extension: string) {
	const readable = encodeSegment(render(template, naming))
	const token = sequencerSlotToken(logicalSlotId)
	const attempt = naming.attempt >= 1 ? `-a${naming.attempt}` : ''

	return `${readable.length > 0 ? `${readable}-` : ''}${token}${attempt}.${extension}`
}

// Digits of the ordinal of an auxiliary image, enough that a night of autofocus runs sorts lexicographically
// and small enough to stay readable.
const SEQUENCER_AUXILIARY_DIGITS = 5

// File name of one auxiliary image: the kind that produced it and an ordinal inside that kind.
//
// The name deliberately carries no slot token and no storage template. An auxiliary image fills no slot, so a
// name shaped like a slot would be found by the reconciliation and counted as a frame of the plan, and a
// template placeholder like the group or the ordinal has nothing to render from. The ordinal only separates
// the images of one kind from each other and orders them; it means nothing to the plan.
//
// `extension` is the file extension without the dot.
export function sequencerAuxiliaryFileName(kind: SequencerAuxiliaryKind, ordinal: number, extension: string) {
	return `${kind}-${`${ordinal}`.padStart(SEQUENCER_AUXILIARY_DIGITS, '0')}.${extension}`
}
