import type { SpiceKernelJob, SpiceKernelReadiness, SpiceKernelSourceKind } from 'api'
import type { StatusTone } from '../../ui/StatusBadge'

// Display formats of the SPICE Kernel Library tool: NAIF body names, segment epochs, sizes, and the labels and tones of
// readiness, sources, and job states.

// Names of the NAIF codes the SPK files of the library usually hold: the barycenters, the Sun, the planets, and the Moon.
const NAIF_NAMES: Readonly<Record<number, string>> = {
	0: 'Solar system barycenter',
	1: 'Mercury barycenter',
	2: 'Venus barycenter',
	3: 'Earth-Moon barycenter',
	4: 'Mars barycenter',
	5: 'Jupiter barycenter',
	6: 'Saturn barycenter',
	7: 'Uranus barycenter',
	8: 'Neptune barycenter',
	9: 'Pluto barycenter',
	10: 'Sun',
	199: 'Mercury',
	299: 'Venus',
	301: 'Moon',
	399: 'Earth',
	499: 'Mars',
	599: 'Jupiter',
	699: 'Saturn',
	799: 'Uranus',
	899: 'Neptune',
	999: 'Pluto',
}

// Instant of TDB 0 s past J2000 (2000-01-01 12:00:00 TDB) in Unix milliseconds (UTC): 2000-01-01T11:58:55.816Z.
const J2000_UNIX_MS = Date.UTC(2000, 0, 1, 11, 58, 55, 816)

// Name of a NAIF code with the code, such as "Earth (399)", or the code alone when unnamed.
export function naifName(code: number) {
	const name = NAIF_NAMES[code]
	return name ? `${name} (${code})` : `${code}`
}

// UTC date (YYYY-MM-DD) of an epoch in TDB seconds past J2000. The leap seconds since 2000 (under 10 s) and the TDB-TT
// difference (under 2 ms) are ignored, which never matters at the precision of a date.
export function epochDate(seconds: number) {
	const date = new Date(J2000_UNIX_MS + seconds * 1000)
	return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '—'
}

// Size in bytes with a binary unit, such as "31.2 MiB".
export function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`
	if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MiB`
	return `${(bytes / 1073741824).toFixed(2)} GiB`
}

// Label and tone of each readiness.
export const READINESS: Readonly<Record<SpiceKernelReadiness, { readonly label: string; readonly tone: StatusTone }>> = {
	ready: { label: 'Ready', tone: 'success' },
	missingDependency: { label: 'Needs planetary kernel', tone: 'warning' },
	unsupported: { label: 'Unsupported', tone: 'warning' },
	disabled: { label: 'Disabled', tone: 'muted' },
	loading: { label: 'Loading', tone: 'active' },
	invalid: { label: 'Invalid', tone: 'danger' },
	missing: { label: 'Missing file', tone: 'danger' },
}

// Label of each source.
export const SOURCE_LABELS: Readonly<Record<SpiceKernelSourceKind, string>> = { naif: 'NAIF', horizons: 'Horizons', import: 'Upload' }

// Label of each job state.
export const JOB_STATE_LABELS: Readonly<Record<SpiceKernelJob['state'], string>> = {
	queued: 'Queued',
	running: 'Transferring',
	validating: 'Validating',
	publishing: 'Publishing',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Cancelled',
}
