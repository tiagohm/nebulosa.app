import type { SpiceBody, SpiceChainLink, SpiceEvaluation, SpiceEvaluationResult, SpiceKernelSummary } from 'api'
import { AU_KM } from 'nebulosa/src/core/constants'
import { formatHMS, formatSignedDMS } from 'nebulosa/src/math/units/angle'
import { useState } from 'react'
import { formatArcsec, formatDegrees, formatFixed, formatKilometers, formatSpeed, MISSING } from '../../format'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { Select } from '../../ui/Select'
import { Cell, Row, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { type BodyNames, epochDate, naifName, withMinus } from './format'
import { LibrarySection } from './LibrarySection'
import { evaluateSpice, evaluationDifference } from './spicekernels'

// Calculate section of the SPICE Kernel Library tool: the state of a body relative to another at an instant, computed by
// the server from the enabled kernels, either through the selection the ephemeris makes or from one chosen segment of the
// target, and optionally a second source side by side with their difference. Meant to check the kernels and the
// ephemeris: positions are geometric (no light time, aberration, or deflection) in the J2000 (ICRF) axes.

// Value of a source that follows the selection of the ephemeris.
const AUTOMATIC = 'auto'

// A source: the selection of the ephemeris, or a segment of the target as `<kernel id>|<segment index>`.
type Source = string

// Last computation: what was asked, and its results, one per source.
interface Computed {
	// NAIF codes of the target and the center asked for.
	readonly target: number
	readonly center: number
	// Instant asked for, Unix milliseconds (UTC).
	readonly time: number
	readonly results: readonly SpiceEvaluationResult[]
}

// Current instant as the value of a UTC datetime-local control, to the second.
function nowValue() {
	return new Date().toISOString().slice(0, 19)
}

interface CalculateProps {
	// Bodies of the current set; undefined while they are read.
	readonly bodies?: readonly SpiceBody[]
	readonly kernels: readonly SpiceKernelSummary[]
	// Names of the library's small bodies.
	readonly names: BodyNames
}

// Calculate section.
export function Calculate({ bodies, kernels, names }: CalculateProps) {
	const [target, setTarget] = useState<string>()
	const [center, setCenter] = useState<string>()
	const [time, setTime] = useState(nowValue)
	const [sources, setSources] = useState<readonly Source[]>([AUTOMATIC])
	const [compare, setCompare] = useState(false)
	const [computed, setComputed] = useState<Computed>()
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)

	if (!bodies) return <EmptyState title="Loading" description="Reading the bodies of the enabled kernels." />
	if (bodies.length === 0) return <EmptyState title="No bodies" description="Enable a kernel in Installed, or add one in Add Kernel." />

	const codes = ['0', ...bodies.map((e) => String(e.body))]
	const targetCode = target && codes.includes(target) ? target : String(bodies.find((e) => e.body === 699)?.body ?? bodies[0].body)
	const centerCode = center && codes.includes(center) ? center : codes.includes('399') ? '399' : '0'
	const targetBody = bodies.find((e) => String(e.body) === targetCode)
	const sourceOptions = [AUTOMATIC, ...(targetBody?.segments.map((e) => `${e.kernelId}|${e.segment}`) ?? [])]
	const active = (compare ? [0, 1] : [0]).map((i) => (sources[i] && sourceOptions.includes(sources[i]) ? sources[i] : AUTOMATIC))
	const instant = Date.parse(`${time}Z`)
	const invalid = !Number.isFinite(instant) ? 'Enter a UTC instant to the second' : targetCode === centerCode ? 'Choose a center other than the target' : undefined

	function formatSource(source: Source) {
		if (source === AUTOMATIC) return 'Ephemeris selection'
		const segment = targetBody?.segments.find((e) => `${e.kernelId}|${e.segment}` === source)
		if (!segment) return source
		return `${kernelName(kernels, segment.kernelId)} #${segment.segment} (${epochDate(segment.start)} – ${epochDate(segment.end)})`
	}

	function setSource(index: number, source: Source) {
		const next = [...active]
		next[index] = source
		setSources(next)
	}

	async function compute() {
		if (!Number.isFinite(instant)) return
		setBusy(true)
		setError(undefined)

		try {
			const results = await Promise.all(
				active.map((source) => {
					const [kernelId, segment] = source.split('|')
					return evaluateSpice({ target: Number(targetCode), center: Number(centerCode), time: instant, source: source === AUTOMATIC ? undefined : { kernelId, segment: Number(segment) } })
				}),
			)
			setComputed({ target: Number(targetCode), center: Number(centerCode), time: instant, results })
		} catch (e) {
			setError(Error.isError(e) ? e.message : 'The state could not be computed.')
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<LibrarySection title="State of a body">
				<form
					onSubmit={(event) => {
						event.preventDefault()
						void compute()
					}}
					className="flex flex-col gap-3"
				>
					<div className="flex flex-wrap items-end gap-2">
						<Select label="Target" className="w-72 max-sm:w-full" options={codes} value={targetCode} format={(e) => naifName(Number(e), names)} onChange={setTarget} />
						<Select label="Center" className="w-72 max-sm:w-full" options={codes} value={centerCode} format={(e) => naifName(Number(e), names)} onChange={setCenter} />
						<TextInput label="Instant (UTC)" type="datetime-local" step={1} className="w-56" value={time} onChange={(e) => setTime(e.target.value)} />
						<Button variant="secondary" title="Sets the instant to the current UTC time" onClick={() => setTime(nowValue())}>
							Now
						</Button>
					</div>
					<div className="flex flex-wrap items-end gap-2">
						<Select label={compare ? 'Source A' : 'Source'} className="w-96 max-sm:w-full" options={sourceOptions} value={active[0]} format={formatSource} onChange={(e) => setSource(0, e)} />
						{compare && <Select label="Source B" className="w-96 max-sm:w-full" options={sourceOptions} value={active[1]} format={formatSource} onChange={(e) => setSource(1, e)} />}
					</div>
					<div className="flex flex-wrap items-center gap-4">
						<Checkbox label="Compare two sources" checked={compare} onChange={setCompare} />
						<Button type="submit" disabled={busy || invalid !== undefined} title={invalid}>
							{busy ? 'Computing…' : 'Compute'}
						</Button>
					</div>
					<Notice className="max-w-3xl">Geometric state in the J2000 (ICRF) axes, without light time, aberration, or deflection. A source segment is evaluated whatever segment the ephemeris would select, and joined to the center through the selection.</Notice>
					{error && <Notice error>{error}</Notice>}
				</form>
			</LibrarySection>
			{computed && <Results computed={computed} kernels={kernels} names={names} />}
		</>
	)
}

// Name of a kernel by its id, or the id when the library no longer has it.
function kernelName(kernels: readonly SpiceKernelSummary[], id: string) {
	return kernels.find((e) => e.id === id)?.name ?? id
}

// Text of a chain: each link as "body → center: kernel #segment".
function chainText(chain: readonly SpiceChainLink[], kernels: readonly SpiceKernelSummary[], names: BodyNames) {
	return chain.map((e) => `${naifName(e.body, names)} → ${naifName(e.center, names)}: ${kernelName(kernels, e.kernelId)} #${e.segment}${e.preferred ? ' (preferred)' : ''}`)
}

// Why a source has no state, for people.
function missText(result: Exclude<SpiceEvaluationResult, SpiceEvaluation>, kernels: readonly SpiceKernelSummary[], names: BodyNames) {
	const where = result.side === 'source' ? 'The source segment' : result.side === 'target' ? 'The target' : 'The center'
	const segment = result.kernelId !== undefined && result.segment !== undefined ? ` (${kernelName(kernels, result.kernelId)} #${result.segment})` : ''

	switch (result.reason) {
		case 'missing':
			return `${where} needs ${naifName(result.body, names)}${segment}, which no enabled kernel provides.`
		case 'coverage':
			return `${where} needs ${naifName(result.body, names)}${segment}, which no enabled kernel covers at this instant.`
		case 'cycle':
			return `${where} has a cyclic chain at ${naifName(result.body, names)}.`
		default:
			return `${where} selects an unsupported segment for ${naifName(result.body, names)}${segment}.`
	}
}

// One quantity of the results: its label and its text for an evaluation, and, for a comparison, the text of the
// difference A − B.
interface Quantity {
	readonly label: string
	readonly value: (e: SpiceEvaluation) => string
	readonly difference?: (a: SpiceEvaluation, b: SpiceEvaluation) => string
}

// Signed difference with a fixed number of decimals.
function signed(value: number, digits: number, unit: string) {
	return `${value >= 0 ? '+' : '−'}${formatFixed(Math.abs(value), digits)} ${unit}`
}

// Quantities shown for each source.
const QUANTITIES: readonly Quantity[] = [
	{ label: 'X', value: (e) => formatKilometers(e.position[0], 3), difference: (a, b) => signed(a.position[0] - b.position[0], 3, 'km') },
	{ label: 'Y', value: (e) => formatKilometers(e.position[1], 3), difference: (a, b) => signed(a.position[1] - b.position[1], 3, 'km') },
	{ label: 'Z', value: (e) => formatKilometers(e.position[2], 3), difference: (a, b) => signed(a.position[2] - b.position[2], 3, 'km') },
	{ label: 'VX', value: (e) => formatSpeed(e.velocity[0], 6), difference: (a, b) => signed((a.velocity[0] - b.velocity[0]) * 1000, 3, 'm/s') },
	{ label: 'VY', value: (e) => formatSpeed(e.velocity[1], 6), difference: (a, b) => signed((a.velocity[1] - b.velocity[1]) * 1000, 3, 'm/s') },
	{ label: 'VZ', value: (e) => formatSpeed(e.velocity[2], 6), difference: (a, b) => signed((a.velocity[2] - b.velocity[2]) * 1000, 3, 'm/s') },
	{ label: 'Distance', value: (e) => `${formatKilometers(e.distance, 3)} · ${formatFixed(e.distance / AU_KM, 9)} AU`, difference: (a, b) => signed(a.distance - b.distance, 3, 'km') },
	{ label: 'Speed', value: (e) => formatSpeed(e.speed, 6) },
	{ label: 'Range rate', value: (e) => formatSpeed(e.rangeRate, 6) },
	{ label: 'Light time', value: (e) => `${formatFixed(e.lightTime, 3)} s` },
	{ label: 'Right ascension (ICRF)', value: (e) => formatHMS(e.rightAscension, 3) },
	{ label: 'Declination (ICRF)', value: (e) => formatSignedDMS(e.declination, 2) },
	{ label: 'Ecliptic longitude (J2000)', value: (e) => formatDegrees(e.eclipticLongitude, 6) },
	{ label: 'Ecliptic latitude (J2000)', value: (e) => formatDegrees(e.eclipticLatitude, 6) },
	{ label: 'TDB', value: (e) => `JD ${formatFixed(e.tdbJulianDate, 6)} · ${formatFixed(e.tdbSeconds, 3)} s past J2000` },
]

interface ResultsProps {
	readonly computed: Computed
	readonly kernels: readonly SpiceKernelSummary[]
	readonly names: BodyNames
}

// Results of the sources, side by side, with their difference when two have a state; headed by what was asked, so a source
// without a state still names its target and center.
function Results({ computed: { target, center, time, results }, kernels, names }: ResultsProps) {
	const states = results.filter((e): e is SpiceEvaluation => e.ok)
	const pair = results.length === 2 && states.length === 2 ? ([states[0], states[1]] as const) : undefined
	const difference = pair && evaluationDifference(pair[0], pair[1])
	const labels = results.length === 2 ? ['A', 'B'] : ['Value']
	const columns = ['Quantity', ...labels.map((key) => ({ key, label: key, numeric: true })), ...(pair ? [{ key: 'difference', label: 'A − B', numeric: true }] : [])]

	return (
		<LibrarySection title="Result">
			<p className="m-0 text-sm text-ink-100">
				{naifName(target, names)} relative to {naifName(center, names)} at {new Date(time).toISOString().slice(0, 19).replace('T', ' ')} UTC
			</p>
			{results.map((result, i) => !result.ok && <Notice key={labels[i]} error>{`${labels[i]}: ${missText(result, kernels, names)}`}</Notice>)}
			{difference && (
				<Notice>
					A − B: {formatKilometers(difference.position, 3)} apart, velocities {formatFixed(difference.velocity * 1000, 3)} m/s apart, directions {formatArcsec(difference.angle, 4)} apart.
				</Notice>
			)}
			{states.length > 0 && (
				<Table columns={columns} className="max-w-4xl">
					{QUANTITIES.map((quantity) => (
						<Row key={quantity.label}>
							<Cell>{quantity.label}</Cell>
							{results.map((result, i) => (
								<Cell key={labels[i]} numeric>
									{result.ok ? withMinus(quantity.value(result)) : MISSING}
								</Cell>
							))}
							{pair && <Cell numeric>{quantity.difference ? quantity.difference(pair[0], pair[1]) : ''}</Cell>}
						</Row>
					))}
				</Table>
			)}
			{results.map(
				(result, i) =>
					result.ok && (
						<div key={labels[i]} className="flex flex-col gap-1 text-xs leading-4 text-ink-300">
							<span className="font-medium text-ink-200">{results.length === 2 ? `Segments of ${labels[i]}` : 'Segments'}</span>
							{result.source && <span>Source: {chainText([result.source], kernels, names)}</span>}
							{chainText(result.targetChain, kernels, names).map((text) => (
								<span key={`t:${text}`}>Target: {text}</span>
							))}
							{chainText(result.centerChain, kernels, names).map((text) => (
								<span key={`c:${text}`}>Center: {text}</span>
							))}
						</div>
					),
			)}
		</LibrarySection>
	)
}
