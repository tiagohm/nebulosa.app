import type { SpiceKernelJob, SpiceKernelReadiness, SpiceKernelSourceKind, SpiceSegmentUsage } from 'api'
import { MISSING } from '../../format'
import type { StatusTone } from '../../ui/StatusBadge'

// Display formats of the SPICE Kernel Library tool: NAIF body names, segment epochs, sizes, and the labels and tones of
// readiness, sources, and job states.

// Names of the NAIF codes the SPK files of the library usually hold: the barycenters, the Sun, the planets, the Moon,
// and the major moons of the curated satellite kernels.
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
	401: 'Phobos',
	402: 'Deimos',
	499: 'Mars',
	501: 'Io',
	502: 'Europa',
	503: 'Ganymede',
	504: 'Callisto',
	505: 'Amalthea',
	514: 'Thebe',
	515: 'Adrastea',
	516: 'Metis',
	599: 'Jupiter',
	601: 'Mimas',
	602: 'Enceladus',
	603: 'Tethys',
	604: 'Dione',
	605: 'Rhea',
	606: 'Titan',
	607: 'Hyperion',
	608: 'Iapetus',
	609: 'Phoebe',
	612: 'Helene',
	613: 'Telesto',
	614: 'Calypso',
	632: 'Methone',
	634: 'Polydeuces',
	699: 'Saturn',
	799: 'Uranus',
	801: 'Triton',
	899: 'Neptune',
	901: 'Charon',
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
	return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : MISSING
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

// Label and tone of how much of its coverage a segment is selected for.
export const USAGE: Readonly<Record<SpiceSegmentUsage, { readonly label: string; readonly tone: StatusTone }>> = {
	full: { label: 'Used', tone: 'success' },
	partial: { label: 'Partly used', tone: 'neutral' },
	never: { label: 'Never used', tone: 'muted' },
}

// UTC date and time (YYYY-MM-DD HH:MM) of an epoch in TDB seconds past J2000, to the minute, under the same
// approximation as epochDate.
export function epochDateTime(seconds: number) {
	const date = new Date(J2000_UNIX_MS + seconds * 1000)
	return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}` : MISSING
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
