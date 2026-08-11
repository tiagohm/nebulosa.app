import { isAbsolute, resolve, sep } from 'path'

// Composition and containment of the paths a session writes to. `storage.root`, both storage templates and
// every declared id arrive over HTTP, and the contract only states that artifacts stay below an approved
// directory: a single `..` in a frame id or in a rendered template value leaves it. This module is the
// boundary where that is decided, which is where the validation doctrine of the project says to decide it.
//
// A segment is one directory or file name and never contains a separator. A path is a host path. The final
// directory of an artifact is `root/[night]/session/[template directories]`, so the session segment sits
// directly below the root (below the night directory when the definition asks for one) and above everything
// a template can produce: two runs of the same definition therefore never share a destination directory,
// and no template can take that separation away.

// Whether a value can be used as a single path segment. Rejects the empty name, the two relative names,
// anything carrying either host separator, and NUL, which most filesystems reject and some truncate on. `..`
// is the one that escapes the root; the others address a directory the caller did not name.
export function isSequencerPathSegment(value: string) {
	return value.length > 0 && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !value.includes('\0')
}

// Separator a directory template may use, matching either host convention so a definition written on one
// platform still addresses the same directories on the other.
const SEQUENCER_TEMPLATE_SEPARATOR = /[/\\]/

// Splits a directory template into the segments it renders to, accepting both host separators and dropping
// the empty segments a leading, trailing, or repeated separator produces. An empty template yields no
// segment, which is a valid configuration writing straight into the session directory.
export function sequencerPathSegments(template: string): string[] {
	const segments: string[] = []

	for (const segment of template.split(SEQUENCER_TEMPLATE_SEPARATOR)) {
		if (segment.length > 0) segments.push(segment)
	}

	return segments
}

// Where the artifacts of one session live, and the two segments no template controls.
export interface SequencerPathContext {
	// Root directory every artifact is written below, as declared by the definition. Must be absolute.
	readonly root: string
	// Segment derived from the session id, added by the runtime below the root. It is what makes the existence
	// check of a slot mean "this session already captured it" instead of "someone once captured something
	// similar", so a path that lost it is refused rather than written.
	readonly session: string
	// Segment of the observing night, resolved once at session start; absent when the definition does not ask
	// for a per-night directory.
	readonly night?: string
}

// Outcome of composing a path. A failure carries the reason instead of a path, because a path that escaped
// containment must never reach a caller that would write to it.
export type SequencerPathResolution =
	| {
			readonly ok: true
			// Absolute, normalized path.
			readonly path: string
	  }
	| {
			readonly ok: false
			// Why the composition was refused, phrased for the operator editing the definition.
			readonly reason: string
	  }

// Directory of the session, `root/[night]/session`. The result is normalized but not checked: it is built
// only from values the runtime controls, and it is the base every artifact path is contained in.
export function sequencerSessionDirectory(context: SequencerPathContext) {
	return context.night ? resolve(context.root, context.night, context.session) : resolve(context.root, context.session)
}

// Composes the path of one artifact from the directories a template rendered and the final file name, and
// proves it is still contained.
//
// `directories` are the rendered segments of `directoryTemplate`, in order, and `fileName` is the rendered
// file name; neither may carry a separator or a relative name. The composed path is normalized and must
// remain strictly below the session directory, which refuses both a path escaping `storage.root` and one
// that climbed out of the session segment while staying under the root.
export function sequencerArtifactPath(context: SequencerPathContext, directories: readonly string[], fileName: string): SequencerPathResolution {
	if (!isAbsolute(context.root)) return { ok: false, reason: `the storage root "${context.root}" is not an absolute path` }

	for (const directory of directories) {
		if (!isSequencerPathSegment(directory)) return { ok: false, reason: `the directory segment "${directory}" is not a valid path segment` }
	}

	if (!isSequencerPathSegment(fileName)) return { ok: false, reason: `the file name "${fileName}" is not a valid path segment` }

	const base = sequencerSessionDirectory(context)
	const path = resolve(base, ...directories, fileName)

	// Containment is decided after normalization, on the composed path: a segment checked in isolation says
	// nothing about what the whole path resolves to.
	if (!path.startsWith(base + sep)) return { ok: false, reason: `the path "${path}" escapes the session directory "${base}"` }

	return { ok: true, path }
}
