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

// Longest a single path component may be, in bytes. Every filesystem this project writes to stops at 255, and
// a longer name does not degrade: the write fails with ENAMETOOLONG for every slot of the group, before a
// single frame is stored. Every character a composed name can carry is ASCII, because the encoding maps
// everything else onto a dash, so a length in characters is a length in bytes.
export const SEQUENCER_NAME_LIMIT = 255

// Longest readable half of a slot token. The hash beside it is what identifies the slot, so the readable half
// is there to be read and may be cut: it still shows the node and the group of a slot whose ids are long, and
// what it gives up is budget the readable part the template asked for gets to use instead.
const SEQUENCER_SLOT_READABLE_LIMIT = 96

// Cuts an encoded segment down to `limit` characters, dropping the separators the cut may have left at the
// edge so the result never ends in a dash or addresses a relative name. Returns the value unchanged when it
// already fits, and the empty string when nothing fits.
function trimSegment(value: string, limit: number) {
	return value.length <= limit ? value : limit <= 0 ? '' : value.slice(0, limit).replace(SEQUENCER_SEPARATOR_EDGE, '')
}

// Cuts a composed name down to `limit` characters, replacing what the cut dropped with the hash of the whole
// name so two names sharing everything up to the cut do not become one. Returns the name unchanged when it
// already fits.
//
// This is for names derived from one this module already composed, such as the temporary and the quarantine
// names the write protocol decorates a final name with: those decorations are appended to a name that may
// already fill the component budget, and the cut has to happen somewhere. `limit` must leave room for the
// hash and the dash joining it, that is at least ten characters, or the result is the hash alone.
export function sequencerBoundedName(name: string, limit: number = SEQUENCER_NAME_LIMIT) {
	if (name.length <= limit) return name

	const hash = hashOf(name)
	const head = trimSegment(name, limit - hash.length - 1)

	return head.length > 0 ? `${head}-${hash}` : hash
}

// Rendering of a logical slot id inside a file name: the readable encoding of the id, followed by the hash of
// the id itself.
//
// The readable half maps several characters onto the same dash, so two slot ids differing only in a character
// that does not survive the encoding would render the same name, and the second slot would find the file of
// the first and be skipped as already captured — a lost night with no error reported. The hash is what makes
// the token injective in practice, and it is computed over the id and not over the encoding.
//
// The readable half is bounded and the hash is not, which is what keeps the token composable while the ids it
// embeds grow: a node id carries the whole pipeline path of the target, and a definition whose target and
// group ids are merely long — nothing a contract forbids — composes a token no filesystem accepts.
//
// Only the node and the group are cut. The cycle and the ordinal are what separate the slots of one group from
// each other, they sit at the end of the id, and they are a handful of digits, so cutting the tail is what
// would leave a 32-bit hash as the only difference between every slot of a long-named group — a collision
// there maps two slots onto one file, and the reconciliation accepts one frame as satisfying both. Keeping
// them verbatim costs nothing and leaves the hash separating what it already separated before any of this
// was bounded.
export function sequencerSlotToken(logicalSlotId: string) {
	// Start of the `cycle#ordinal` tail. A value that is not a composed slot id has no tail to preserve and is
	// bounded whole.
	const tail = logicalSlotId.lastIndexOf(SEQUENCER_SLOT_SEPARATOR, logicalSlotId.lastIndexOf(SEQUENCER_SLOT_SEPARATOR) - 1)
	const head = tail > 0 ? logicalSlotId.slice(0, tail) : logicalSlotId
	const readable = encodeSegment(`${trimSegment(encodeSegment(head), SEQUENCER_SLOT_READABLE_LIMIT)}${tail > 0 ? logicalSlotId.slice(tail) : ''}`)

	return `${readable}-${hashOf(logicalSlotId)}`
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

// Significant digits kept for an exposure shorter than a second. Three of them separate every exposure an
// operator writes at that scale and keep the relative error of the rendered value below half a percent.
const SEQUENCER_EXPOSURE_DIGITS = 3

// Decimals kept for an exposure of a second or more, which is the resolution a declared exposure of that
// length is written at.
const SEQUENCER_EXPOSURE_DECIMALS = 3

// Renders the exposure of a group, in seconds, for a file name.
//
// An integral duration renders without a decimal point. Below a second the value is rendered with significant
// digits instead of decimals, because the contract accepts any finite positive exposure and a fixed number of
// decimals throws away the whole value at the short end: three decimals render a 0.0004-second exposure — a
// planetary or lucky-imaging frame, not an exotic one — as `0`, and a 0.0005-second one as `0.001`. The name
// then reports an exposure the frame does not have, and a name is what calibration and frame selection read
// when they read a directory. Above a second the decimals are what matter, and the two rules agree at 1.
function exposureOf(exposureTime: number) {
	if (Number.isInteger(exposureTime)) return `${exposureTime}`
	return exposureTime < 1 ? `${Number(exposureTime.toPrecision(SEQUENCER_EXPOSURE_DIGITS))}` : `${Number(exposureTime.toFixed(SEQUENCER_EXPOSURE_DECIMALS))}`
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

// Names Windows reserves for character devices, matched on the part before the first dot because that is what
// the platform resolves: `CON` and `CON.fit` both address the console. `COM0` and `LPT0` are reserved alongside
// the numbered ones on current versions, so the whole digit range is covered. The comparison is
// case-insensitive, and no other spelling can reach it: encoding maps every character outside the safe class
// onto a dash, so the superscript forms of the port numbers never survive to be tested.
const SEQUENCER_RESERVED_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

// Escapes a segment that names a reserved device, by appending a separator the platform does not read as part
// of a device name. A reserved name is at most four characters, so the appended one never pushes a bounded
// segment past the component budget.
//
// The escape is not cosmetic: on a Windows host, creating a directory under a reserved name fails, and it
// fails for every frame of the definition rather than for one of them. A target named `AUX` or a filter named
// `NUL` is an ordinary value no contract forbids.
function escapeReservedSegment(segment: string) {
	return SEQUENCER_RESERVED_DEVICE.test(segment) ? `${segment}-` : segment
}

// Directory segments the directory template renders to for one frame, in order.
//
// Empty segments are dropped, so a template whose only content is a placeholder that rendered empty writes
// straight into the session directory instead of into a directory with no name.
//
// Each segment is bounded by the same component budget as the file name, for the same reason: a directory
// nobody can create fails the write of every frame below it. A directory carries no identity, so cutting it
// costs nothing but readability — two values differing only past the budget end up in one directory, and the
// frames inside it keep the distinct names their slot tokens give them.
//
// A segment naming a reserved device is escaped. Only directories need it: a frame name always carries the
// slot token, and an auxiliary name always carries its kind and ordinal, so neither can be a reserved name.
export function sequencerFrameDirectories(template: string, naming: SequencerFrameNaming) {
	const segments: string[] = []

	for (const segment of render(template, naming).split(/[/\\]/)) {
		const encoded = trimSegment(encodeSegment(segment), SEQUENCER_NAME_LIMIT)
		if (encoded.length > 0) segments.push(escapeReservedSegment(encoded))
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
// The whole name stays inside the component budget of the filesystem. What the template asked for is cut first
// and the identifying part is never cut, because a truncated readable part costs readability while a truncated
// token costs the frame: the name a resumed session predicts would no longer be the name on disk. A template
// interpolating ids that are long on their own — the target and the group both render into the token as well —
// is otherwise enough to make every write of the group fail with ENAMETOOLONG.
//
// `extension` is the file extension without the dot.
export function sequencerFrameFileName(template: string, naming: SequencerFrameNaming, logicalSlotId: string, extension: string) {
	const token = sequencerSlotToken(logicalSlotId)
	const attempt = naming.attempt >= 1 ? `-a${naming.attempt}` : ''
	const identity = `${token}${attempt}.${extension}`

	// One character of the budget belongs to the dash joining the two halves, so a readable part that only fits
	// without it is dropped instead of being separated from the token by nothing.
	const readable = trimSegment(encodeSegment(render(template, naming)), SEQUENCER_NAME_LIMIT - identity.length - 1)

	return `${readable.length > 0 ? `${readable}-` : ''}${identity}`
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
