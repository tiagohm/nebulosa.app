import { lstatSync } from 'fs'
import { isAbsolute, join, resolve, sep } from 'path'

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
//
// Containment is decided twice, because it has two halves. The lexical half is pure and answers what the text
// of a path resolves to, which is all an editor validating a definition can ask about; the verified half also
// reads the filesystem, because a directory that already exists as a symbolic link sends a lexically contained
// write somewhere else entirely. Anything about to write uses the verified one.

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
// proves it is lexically contained.
//
// `directories` are the rendered segments of `directoryTemplate`, in order, and `fileName` is the rendered
// file name; neither may carry a separator or a relative name. The composed path is normalized and must
// remain strictly below the session directory, which refuses both a path escaping `storage.root` and one
// that climbed out of the session segment while staying under the root.
//
// The proof is over the path as text and reads nothing from the filesystem, which is what lets the compiler
// probe a definition without touching a disk. It therefore says nothing about where the path leads once
// symbolic links are followed: a caller about to write must use `sequencerVerifiedArtifactPath` instead.
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

// Composes the path of one artifact and proves it is contained on the filesystem the write will land on.
//
// This is the composition to use before writing. The lexical proof only shows that the text of the path stays
// below the session directory, and a directory that already exists as a symbolic link makes that text lie: the
// write follows the link and lands wherever it points, so `root/night/session/link/frame.fits` writes outside
// the approved root while reading as contained. Every component the runtime creates below the storage root is
// therefore inspected here, and the first one that exists as a link refuses the composition.
//
// The root itself is not inspected: it is the directory the operator declared, and a root that is a link is a
// root they chose. The walk stops at the first component that does not exist yet, because nothing can exist
// below an absent directory; the runtime creates the rest, and a component it cannot create fails the write
// on its own. Each call costs one `lstat` per existing component, which is nothing next to the artifact.
export function sequencerVerifiedArtifactPath(context: SequencerPathContext, directories: readonly string[], fileName: string): SequencerPathResolution {
	const resolution = sequencerArtifactPath(context, directories, fileName)

	if (!resolution.ok) return resolution

	let current = resolve(context.root)

	for (const component of context.night ? [context.night, context.session, ...directories, fileName] : [context.session, ...directories, fileName]) {
		current = join(current, component)

		try {
			if (lstatSync(current).isSymbolicLink()) return { ok: false, reason: `the path component "${current}" is a symbolic link, and the write would follow it out of the session directory` }
		} catch {
			break
		}
	}

	return resolution
}
