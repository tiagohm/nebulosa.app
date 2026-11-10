import type { OrbitCompareNode } from 'api'
import { AU_KM, DAYSEC } from 'nebulosa/src/core/constants'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { ticks } from '../../camera/FocusCurve'
import { downloadText } from '../../download'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { formatTdb, type OrbitalMechanicsState, orbitalMechanicsState } from './orbitalmechanics'
import { COMPARE_COUNT_LIMIT, comparisonCsv, comparisonRefusal, DEFAULT_COMPARE_COUNT, runComparison } from './orbitalmechanics.sources'

// Kepler versus SPICE in the Orbital Mechanics Explorer: the osculating two-body orbit of an SPK target's state at an
// anchor, about the scene's DE440 center, against the SPK states over a span around it, with the separation, the speed
// difference, and their RTN components plotted against time. The difference is between two models; it is zero at the
// anchor by construction and is never an uncertainty of either.

// Size of a chart, in viewBox units.
const WIDTH = 320
const HEIGHT = 140

// Margins of a chart, in viewBox units.
const MARGIN = { top: 8, right: 8, bottom: 20, left: 44 } as const

// A series of a chart: its values by node, its label, and its CSS color token.
interface Series {
	readonly label: string
	readonly color: string
	readonly values: readonly (number | undefined)[]
}

// Kilometers of AU.
function km(au: number) {
	return au * AU_KM
}

// Meters per second of AU/day.
function ms(auPerDay: number) {
	return (auPerDay * AU_KM * 1000) / DAYSEC
}

// Line chart of series against the instants of the nodes (days from the anchor), with the anchor marked.
function ResidualChart({ nodes, anchor, series, unit }: { readonly nodes: readonly OrbitCompareNode[]; readonly anchor: number; readonly series: readonly Series[]; readonly unit: string }) {
	const days = nodes.map((e) => e.time - anchor)
	let low = 0
	let high = 0
	for (const { values } of series) for (const value of values) if (value !== undefined && Number.isFinite(value)) [low, high] = [Math.min(low, value), Math.max(high, value)]
	if (high === low) high = low + 1
	const x = (day: number) => MARGIN.left + ((day - days[0]) / (days.at(-1)! - days[0] || 1)) * (WIDTH - MARGIN.left - MARGIN.right)
	const y = (value: number) => HEIGHT - MARGIN.bottom - ((value - low) / (high - low)) * (HEIGHT - MARGIN.top - MARGIN.bottom)

	const path = (values: readonly (number | undefined)[]) => {
		let d = ''
		let pen = 'M'
		for (let i = 0; i < values.length; i++) {
			const value = values[i]
			if (value === undefined || !Number.isFinite(value)) {
				pen = 'M'
				continue
			}
			d += `${pen}${x(days[i]).toFixed(1)},${y(value).toFixed(1)}`
			pen = 'L'
		}
		return d
	}

	return (
		<figure className="m-0 flex flex-col gap-1">
			<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full">
				{ticks(low, high, 4).map((value) => (
					<g key={value}>
						<line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(value)} y2={y(value)} stroke="var(--color-line-100)" strokeWidth={0.5} />
						<text x={MARGIN.left - 4} y={y(value) + 3} textAnchor="end" fontSize={8} fill="var(--color-ink-300)">
							{Number(value.toPrecision(3))}
						</text>
					</g>
				))}
				{ticks(days[0], days.at(-1)!, 5).map((day) => (
					<text key={day} x={x(day)} y={HEIGHT - 6} textAnchor="middle" fontSize={8} fill="var(--color-ink-300)">
						{Number(day.toPrecision(3))}
					</text>
				))}
				<line x1={x(0)} x2={x(0)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="var(--color-ink-300)" strokeDasharray="2 2" strokeWidth={0.75} />
				{series.map((e) => (
					<path key={e.label} d={path(e.values)} fill="none" stroke={`var(${e.color})`} strokeWidth={1.25} />
				))}
			</svg>
			<figcaption className="flex flex-wrap gap-x-3 text-xs text-ink-300">
				{series.map((e) => (
					<span key={e.label} className="flex items-center gap-1">
						<span className="inline-block h-0.5 w-3" style={{ background: `var(${e.color})` }} />
						{e.label}
					</span>
				))}
				<span>{unit} against days from the anchor</span>
			</figcaption>
		</figure>
	)
}

// Comparison of the two-body model with the SPICE kernels.
export function OrbitComparison() {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState
	const [target, setTarget] = useState(301)
	const [halfSpan, setHalfSpan] = useState(30)
	const [count, setCount] = useState(DEFAULT_COMPARE_COUNT)
	const center = state.center?.code
	const known = center !== undefined && state.reference?.centers.some((e) => e.code === center)
	const anchor = state.time
	const request = { target, center: center ?? 0, anchor, start: anchor - halfSpan, end: anchor + halfSpan, count }
	const refusal = !known ? 'Comparing needs a scene about a DE440 center, not a custom one.' : state.reference && comparisonRefusal(request, state.reference.limits)
	const comparison = state.comparison
	const nodes = comparison?.response.nodes ?? []
	const sameCenter = comparison?.request.center === center

	return (
		<CollapsibleSection id="orbitalmechanics.comparison" title="Compare with SPICE" summary={comparison ? `${comparison.response.name}, max ${km(comparison.response.summary.maxDistance).toPrecision(4)} km` : undefined} defaultOpen={false}>
			<Notice>
				Starts a two-body orbit from the target&apos;s SPK state at the clock&apos;s instant, about {state.center?.name ?? 'the center'}, and compares it with the installed SPICE kernels over the span. The difference is between two models, zero at the anchor by construction, and not an uncertainty or a
				prediction of an impact.
			</Notice>
			<NumberInput label="Target (NAIF ID)" value={target} step={1} onChange={setTarget} />
			<NumberInput label="Days before and after the anchor" value={halfSpan} min={0.001} step={0.001} onChange={setHalfSpan} />
			<NumberInput label="Instants" value={count} min={2} max={COMPARE_COUNT_LIMIT} step={1} onChange={setCount} />
			<Actions>
				<Button variant="secondary" disabled={state.comparing || refusal !== undefined} title={refusal} onClick={() => void runComparison(orbitalMechanicsState, request)}>
					{state.comparing ? 'Comparing…' : 'Compare'}
				</Button>
				{comparison && (
					<>
						<Button variant="ghost" onClick={() => downloadText(comparisonCsv(comparison), `${comparison.response.name}-kepler-vs-spk.csv`, 'text/csv')}>
							Export CSV
						</Button>
						<Button variant="ghost" onClick={() => downloadText(`${JSON.stringify(comparison, null, '\t')}\n`, `${comparison.response.name}-kepler-vs-spk.json`, 'application/json')}>
							Export JSON
						</Button>
					</>
				)}
			</Actions>
			{refusal && <Notice>{refusal}</Notice>}
			{state.comparisonError && <Notice error>{state.comparisonError}</Notice>}
			{comparison && (
				<>
					<DataRow label="Target">{comparison.response.name}</DataRow>
					<DataRow label="Anchor">{formatTdb(comparison.request.anchor)}</DataRow>
					<DataRow label="Largest separation">{`${km(comparison.response.summary.maxDistance).toPrecision(5)} km at ${formatTdb(comparison.response.summary.maxDistanceTime)}`}</DataRow>
					<DataRow label="Largest speed difference">{`${ms(comparison.response.summary.maxSpeed).toPrecision(5)} m/s`}</DataRow>
					{comparison.response.source.kind === 'spk' && <DataRow label="Kernels">{`${comparison.response.source.kernels.join(', ')} (generation ${comparison.response.source.generation})`}</DataRow>}
					{!sameCenter && <Notice>The scene is about another center now, so this comparison is not drawn in it.</Notice>}
					<ResidualChart nodes={nodes} anchor={comparison.request.anchor} unit="km" series={[{ label: '|Δr|', color: '--color-accent', values: nodes.map((e) => km(e.distance)) }]} />
					<ResidualChart
						nodes={nodes}
						anchor={comparison.request.anchor}
						unit="km"
						series={[
							{ label: 'Radial', color: '--color-danger', values: nodes.map((e) => e.rtnPosition && km(e.rtnPosition[0])) },
							{ label: 'Along-track', color: '--color-success', values: nodes.map((e) => e.rtnPosition && km(e.rtnPosition[1])) },
							{ label: 'Normal', color: '--color-info', values: nodes.map((e) => e.rtnPosition && km(e.rtnPosition[2])) },
						]}
					/>
					<ResidualChart nodes={nodes} anchor={comparison.request.anchor} unit="m/s" series={[{ label: '|Δv|', color: '--color-warning', values: nodes.map((e) => ms(e.speed)) }]} />
				</>
			)}
		</CollapsibleSection>
	)
}
