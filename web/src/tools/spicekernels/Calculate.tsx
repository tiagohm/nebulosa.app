import type { SpiceBody, SpiceChainLink, SpiceEvaluation, SpiceEvaluationResult, SpiceKernelSummary } from 'api'
import { AU_KM } from 'nebulosa/src/core/constants'
import { formatDEC, formatRA } from 'nebulosa/src/math/units/angle'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatArcsec, formatDegrees, formatFixed, formatKilometers, MISSING } from '../../format'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { Select } from '../../ui/Select'
import { Cell, Row, Table } from '../../ui/Table'
import { TextInput } from '../../ui/TextInput'
import { epochDate, naifName } from './format'
import { evaluateSpice, evaluationDifference, fetchSpiceBodies, spiceKernelsState } from './spicekernels'

// Calculate section of the SPICE Kernel Library tool: the state of a body relative to another at an instant, computed by
// the server from the enabled kernels, either through the selection the ephemeris makes or from one chosen segment of the
// target, and optionally a second source side by side with their difference. Meant to check the kernels and the
// ephemeris: positions are geometric (no light time, aberration, or deflection) in the J2000 (ICRF) axes.

// Value of a source that follows the selection of the ephemeris.
const AUTOMATIC = 'auto'

// A source: the selection of the ephemeris, or a segment of the target as `<kernel id>|<segment index>`.
type Source = string

// Results of the last computation, one per source.
interface Computed {
	readonly results: readonly SpiceEvaluationResult[]
}

// Current instant as the value of a UTC datetime-local control, to the second.
function nowValue() {
	return new Date().toISOString().slice(0, 19)
}

// Calculate section.
export function Calculate() {
	const state = useSnapshot(spiceKernelsState)
	const [bodies, setBodies] = useState<readonly SpiceBody[]>()
	const [target, setTarget] = useState<string>()
	const [center, setCenter] = useState<string>()
	const [time, setTime] = useState(nowValue)
	const [sources, setSources] = useState<readonly Source[]>([AUTOMATIC])
	const [compare, setCompare] = useState(false)
	const [computed, setComputed] = useState<Computed>()
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)
	const kernels = state.snapshot?.kernels ?? []

	useEffect(() => {
		const controller = new AbortController()
		void fetchSpiceBodies(controller.signal).then((value) => !controller.signal.aborted && setBodies(value?.bodies ?? []))
		return () => controller.abort()
	}, [state.revision])

	if (!bodies) return <EmptyState title="Loading" description="Reading the bodies of the enabled kernels." />
	if (bodies.length === 0) return <EmptyState title="No bodies" description="Enable a kernel in Installed, or add one in Add Kernel." />

	const codes = ['0', ...bodies.map((e) => String(e.body))]
	const targetCode = target && codes.includes(target) ? target : String(bodies.find((e) => e.body === 699)?.body ?? bodies[0].body)
	const centerCode = center && codes.includes(center) ? center : codes.includes('399') ? '399' : '0'
	const targetBody = bodies.find((e) => String(e.body) === targetCode)
	const sourceOptions = [AUTOMATIC, ...(targetBody?.segments.map((e) => `${e.kernelId}|${e.segment}`) ?? [])]
	const active = (compare ? [0, 1] : [0]).map((i) => (sources[i] && sourceOptions.includes(sources[i]) ? sources[i] : AUTOMATIC))
	const instant = Date.parse(`${time}Z`)

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
			setComputed({ results })
		} catch (e) {
			setError(Error.isError(e) ? e.message : 'The state could not be computed.')
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			<form
				onSubmit={(event) => {
					event.preventDefault()
					void compute()
				}}
				className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4"
			>
				<div className="flex flex-wrap items-end gap-2">
					<Select label="Target" className="w-60" options={codes} value={targetCode} format={(e) => naifName(Number(e))} onChange={setTarget} />
					<Select label="Center" className="w-60" options={codes} value={centerCode} format={(e) => naifName(Number(e))} onChange={setCenter} />
					<TextInput label="Instant (UTC)" type="datetime-local" step={1} className="w-56" value={time} onChange={(e) => setTime(e.target.value)} />
				</div>
				<div className="flex flex-wrap items-end gap-2">
					<Select label={compare ? 'Source A' : 'Source'} className="w-96" options={sourceOptions} value={active[0]} format={formatSource} onChange={(e) => setSource(0, e)} />
					{compare && <Select label="Source B" className="w-96" options={sourceOptions} value={active[1]} format={formatSource} onChange={(e) => setSource(1, e)} />}
				</div>
				<div className="flex flex-wrap items-center gap-4">
					<Checkbox label="Compare two sources" checked={compare} onChange={setCompare} />
					<Button type="submit" disabled={busy || !Number.isFinite(instant) || targetCode === centerCode}>
						{busy ? 'Computing…' : 'Compute'}
					</Button>
				</div>
				<Notice>Geometric state in the J2000 (ICRF) axes, without light time, aberration, or deflection. A source segment is evaluated whatever segment the ephemeris would select, and joined to the center through the selection.</Notice>
				{error && <Notice error>{error}</Notice>}
			</form>
			{computed && <Results results={computed.results} kernels={kernels} />}
		</>
	)
}

// Name of a kernel by its id, or the id when the library no longer has it.
function kernelName(kernels: readonly SpiceKernelSummary[], id: string) {
	return kernels.find((e) => e.id === id)?.name ?? id
}

// Text of a chain: each link as "body → center (kernel #segment)".
function chainText(chain: readonly SpiceChainLink[], kernels: readonly SpiceKernelSummary[]) {
	return chain.map((e) => `${naifName(e.body)} → ${naifName(e.center)}: ${kernelName(kernels, e.kernelId)} #${e.segment}${e.preferred ? ' (preferred)' : ''}`)
}

// Why a source has no state, for people.
function missText(result: Exclude<SpiceEvaluationResult, SpiceEvaluation>, kernels: readonly SpiceKernelSummary[]) {
	const where = result.side === 'source' ? 'The source segment' : result.side === 'target' ? 'The target' : 'The center'
	const segment = result.kernelId !== undefined && result.segment !== undefined ? ` (${kernelName(kernels, result.kernelId)} #${result.segment})` : ''

	switch (result.reason) {
		case 'missing':
			return `${where} needs ${naifName(result.body)}${segment}, which no enabled kernel provides.`
		case 'coverage':
			return `${where} needs ${naifName(result.body)}${segment}, which no enabled kernel covers at this instant.`
		case 'cycle':
			return `${where} has a cyclic chain at ${naifName(result.body)}.`
		default:
			return `${where} selects an unsupported segment for ${naifName(result.body)}${segment}.`
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
	{ label: 'VX', value: (e) => `${formatFixed(e.velocity[0], 6)} km/s`, difference: (a, b) => signed((a.velocity[0] - b.velocity[0]) * 1000, 3, 'm/s') },
	{ label: 'VY', value: (e) => `${formatFixed(e.velocity[1], 6)} km/s`, difference: (a, b) => signed((a.velocity[1] - b.velocity[1]) * 1000, 3, 'm/s') },
	{ label: 'VZ', value: (e) => `${formatFixed(e.velocity[2], 6)} km/s`, difference: (a, b) => signed((a.velocity[2] - b.velocity[2]) * 1000, 3, 'm/s') },
	{ label: 'Distance', value: (e) => `${formatKilometers(e.distance, 3)} · ${formatFixed(e.distance / AU_KM, 9)} AU`, difference: (a, b) => signed(a.distance - b.distance, 3, 'km') },
	{ label: 'Speed', value: (e) => `${formatFixed(e.speed, 6)} km/s` },
	{ label: 'Range rate', value: (e) => `${formatFixed(e.rangeRate, 6)} km/s` },
	{ label: 'Light time', value: (e) => `${formatFixed(e.lightTime, 3)} s` },
	{ label: 'Right ascension (ICRF)', value: (e) => formatRA(e.rightAscension, 3) },
	{ label: 'Declination (ICRF)', value: (e) => formatDEC(e.declination, 2) },
	{ label: 'Ecliptic longitude (J2000)', value: (e) => formatDegrees(e.eclipticLongitude, 6) },
	{ label: 'Ecliptic latitude (J2000)', value: (e) => formatDegrees(e.eclipticLatitude, 6) },
	{ label: 'TDB', value: (e) => `JD ${formatFixed(e.tdbJulianDate, 6)} · ${formatFixed(e.tdbSeconds, 3)} s past J2000` },
]

interface ResultsProps {
	readonly results: readonly SpiceEvaluationResult[]
	readonly kernels: readonly SpiceKernelSummary[]
}

// Results of the sources, side by side, with their difference when two have a state.
function Results({ results, kernels }: ResultsProps) {
	const states = results.filter((e): e is SpiceEvaluation => e.ok)
	const pair = results.length === 2 && states.length === 2 ? ([states[0], states[1]] as const) : undefined
	const difference = pair && evaluationDifference(pair[0], pair[1])
	const names = results.length === 2 ? ['A', 'B'] : ['Value']
	const columns = ['Quantity', ...names, ...(pair ? ['A − B'] : [])]

	return (
		<section className="flex flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-sm font-semibold text-ink-100">
				{naifName(results[0].ok ? results[0].target : 0)} relative to {naifName(results[0].ok ? results[0].center : 0)}
			</h2>
			{results.map((result, i) => !result.ok && <Notice key={names[i]} error>{`${names[i]}: ${missText(result, kernels)}`}</Notice>)}
			{difference && (
				<Notice>
					A − B: {formatKilometers(difference.position, 3)} apart, velocities {formatFixed(difference.velocity * 1000, 3)} m/s apart, directions {formatArcsec(difference.angle, 4)} apart.
				</Notice>
			)}
			{states.length > 0 && (
				<Table columns={columns}>
					{QUANTITIES.map((quantity) => (
						<Row key={quantity.label}>
							<Cell>{quantity.label}</Cell>
							{results.map((result, i) => (
								<Cell key={names[i]}>{result.ok ? quantity.value(result) : MISSING}</Cell>
							))}
							{pair && <Cell>{quantity.difference ? quantity.difference(pair[0], pair[1]) : ''}</Cell>}
						</Row>
					))}
				</Table>
			)}
			{results.map(
				(result, i) =>
					result.ok && (
						<div key={names[i]} className="flex flex-col gap-1 text-xs text-ink-300">
							<span className="font-medium text-ink-200">{results.length === 2 ? `Segments of ${names[i]}` : 'Segments'}</span>
							{result.source && <span>Source: {chainText([result.source], kernels)}</span>}
							{chainText(result.targetChain, kernels).map((text) => (
								<span key={`t:${text}`}>Target: {text}</span>
							))}
							{chainText(result.centerChain, kernels).map((text) => (
								<span key={`c:${text}`}>Center: {text}</span>
							))}
						</div>
					),
			)}
		</section>
	)
}
