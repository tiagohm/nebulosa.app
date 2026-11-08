import type { OrbitAngle, OrbitElementsPayload, OrbitSolveResponse, OrbitVector, OrbitWarning } from 'api'
import { RAD2DEG } from 'nebulosa/src/core/constants'
import { useSnapshot } from 'valtio'
import { MISSING } from '../../format'
import { useActiveSite } from '../../location/useLocation'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
// oxfmt-ignore
import { definitionKey, distanceSymbol, type DistanceUnit, type ExplorerOrbit, formatTdb, fromAu, fromAuPerDay, inspectionCurrent, type OrbitalMechanicsState, orbitalMechanicsState, solutionCurrent, sourceLabel, velocitySymbol } from './orbitalmechanics'
import { showMinorBodyInSky } from './orbitalmechanics.sources'

// Inspector of the selected orbit of the Orbital Mechanics Explorer: its elements on the reference plane drawn, its
// geometry, dynamics, and Cartesian state, and where it comes from. Every value is exact, read from the server for the
// instant it names: the clock's instant once the clock rests, else the orbit's anchor. While the clock plays, the
// body on screen is interpolated and the values stay those of the instant named, which the header says. An element a
// geometry leaves undefined says why instead of showing zero.

// Why an undefined angle is undefined, for people.
const UNDEFINED_REASONS: Readonly<Record<string, string>> = { circular: 'undefined (circular)', equatorial: 'undefined (equatorial)' }

// Texts of the warnings.
const WARNING_TEXTS: Readonly<Record<OrbitWarning, string>> = {
	periapsisInsideCenter: 'The periapsis is inside the radius of the center: the conic crosses the body. This is geometry, not a prediction of a collision.',
	insideCenter: 'The body is inside the radius of the center at this instant.',
	nearParabolic: 'The eccentricity is close to 1: the period or the asymptotes change strongly with small changes of the orbit.',
}

// Degrees of an angle in radians, to four decimals.
function degrees(radians: number) {
	return `${(radians * RAD2DEG).toFixed(4)}°`
}

// An angle that may be undefined.
function angle(value: OrbitAngle) {
	return value.defined ? degrees(value.value) : UNDEFINED_REASONS[value.reason]
}

// A number with four significant digits, or in exponent form when very large or small.
function significant(value: number, digits = 6) {
	if (!Number.isFinite(value)) return MISSING
	const size = Math.abs(value)
	return value !== 0 && (size >= 1e7 || size < 1e-3) ? value.toExponential(digits - 1) : value.toPrecision(digits)
}

// A distance (AU) in the scene's unit.
function distance(au: number, unit: DistanceUnit) {
	return `${significant(fromAu(au, unit))} ${distanceSymbol(unit)}`
}

// A velocity (AU/day) in the scene's unit.
function velocity(auPerDay: number, unit: DistanceUnit) {
	return `${significant(fromAuPerDay(auPerDay, unit))} ${velocitySymbol(unit)}`
}

// A duration in days, with a readable unit.
function duration(days: number) {
	if (days < 1 / 24) return `${significant(days * 1440, 5)} min`
	if (days < 2) return `${significant(days * 24, 5)} h`
	if (days < 1000) return `${significant(days, 6)} days`
	return `${significant(days / 365.25, 6)} years`
}

// Components of a vector in a unit.
function components(v: OrbitVector, convert: (value: number) => number, symbol: string) {
	return `${v.map((e) => significant(convert(e))).join(', ')} ${symbol}`
}

// Inspector of the selected orbit.
export function OrbitInspector({ orbit }: { readonly orbit: ExplorerOrbit }) {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState
	const { inspection } = state
	// The inspection of this orbit's current definition, at whatever instant it was read.
	const inspected = inspection && orbit.definition && inspection.orbitId === orbit.id && inspection.key === definitionKey(orbit.definition) ? inspection.solution : undefined
	const exact = inspected && inspectionCurrent(state) ? inspected : undefined
	const solution = inspected ?? orbit.solution

	if (!solution) return <div className="px-4 py-3 text-sm text-ink-300">{orbit.loading ? 'Solving…' : 'No solution yet.'}</div>

	const { unit, plane } = state
	const elements = solution.elements[plane]
	const stale = !solutionCurrent(orbit) || orbit.draftError !== undefined
	const instantNote = exact ? 'at the instant shown' : solution.time === solution.anchor ? 'at the epoch' : state.playing ? 'at the instant playback started from; the moving body is interpolated' : 'at another instant'

	return (
		<>
			<div className="flex flex-col gap-1 border-b border-line-100 px-4 py-3 text-sm">
				<span className="text-ink-100">Exact values {instantNote}</span>
				<span className="text-xs text-ink-300 tabular-nums">
					{formatTdb(solution.time)} · JD {solution.time.toFixed(6)} · {new Date(solution.utc).toISOString().replace('T', ' ').slice(0, 19)} UTC
				</span>
				{state.inspecting && <span className="text-xs text-ink-300">Reading exact values…</span>}
				{stale && <Notice>These values belong to the previous definition until the new one is solved.</Notice>}
				{state.inspectionError && <Notice error>{state.inspectionError}</Notice>}
				{solution.warnings.map((e) => (
					<Notice key={e}>{WARNING_TEXTS[e]}</Notice>
				))}
			</div>
			<ElementsSection elements={elements} unit={unit} plane={plane} />
			<GeometrySection elements={elements} solution={solution} unit={unit} />
			<DynamicsSection solution={solution} unit={unit} />
			<StateSection solution={solution} unit={unit} />
			<SourceSection orbit={orbit} solution={solution} />
		</>
	)
}

// Classical elements on the reference plane.
function ElementsSection({ elements, unit, plane }: { readonly elements: OrbitElementsPayload; readonly unit: DistanceUnit; readonly plane: OrbitalMechanicsState['plane'] }) {
	return (
		<CollapsibleSection id="orbitalmechanics.elements" title="Elements" summary={`${elements.conic}, e = ${elements.eccentricity.toFixed(6)}`}>
			<DataRow label="Referred to">{plane === 'ecliptic' ? 'J2000 ecliptic' : 'J2000 equator'}</DataRow>
			<DataRow label="Class">{elements.conic}</DataRow>
			<DataRow label="Eccentricity e">{elements.eccentricity.toPrecision(10)}</DataRow>
			<DataRow label="Semi-major axis a">{elements.semiMajorAxis === undefined ? 'undefined (parabolic)' : distance(elements.semiMajorAxis, unit)}</DataRow>
			<DataRow label="Inclination i">{degrees(elements.inclination)}</DataRow>
			<DataRow label="Ascending node Ω">{angle(elements.node)}</DataRow>
			<DataRow label="Argument of periapsis ω">{angle(elements.argumentOfPeriapsis)}</DataRow>
			<DataRow label="Longitude of periapsis ϖ">{angle(elements.longitudeOfPeriapsis)}</DataRow>
			<DataRow label="True anomaly ν">{angle(elements.trueAnomaly)}</DataRow>
			<DataRow label="Argument of latitude u">{angle(elements.argumentOfLatitude)}</DataRow>
			<DataRow label="True longitude">{degrees(elements.trueLongitude)}</DataRow>
			<DataRow label={elements.eccentricity > 1 ? 'Hyperbolic anomaly H' : 'Eccentric anomaly E'}>{elements.eccentricAnomaly === undefined ? 'undefined' : degrees(elements.eccentricAnomaly)}</DataRow>
			<DataRow label="Mean anomaly M">{elements.meanAnomaly === undefined ? 'undefined' : degrees(elements.meanAnomaly)}</DataRow>
			<DataRow label="Periapsis time">{elements.periapsisTime === undefined ? 'undefined (circular)' : formatTdb(elements.periapsisTime)}</DataRow>
		</CollapsibleSection>
	)
}

// Size and shape of the conic.
function GeometrySection({ elements, solution, unit }: { readonly elements: OrbitElementsPayload; readonly solution: OrbitSolveResponse; readonly unit: DistanceUnit }) {
	const n = solution.diagnostics.normal
	return (
		<CollapsibleSection id="orbitalmechanics.geometry" title="Geometry" summary={`q = ${distance(elements.periapsisDistance, unit)}`}>
			<DataRow label="Periapsis distance q">{distance(elements.periapsisDistance, unit)}</DataRow>
			<DataRow label="Apoapsis distance Q">{elements.apoapsisDistance === undefined ? 'none (open orbit)' : distance(elements.apoapsisDistance, unit)}</DataRow>
			<DataRow label="Semi-minor axis b">{elements.semiMinorAxis === undefined ? 'not applicable' : distance(elements.semiMinorAxis, unit)}</DataRow>
			<DataRow label="Semi-latus rectum p">{distance(elements.semiLatusRectum, unit)}</DataRow>
			<DataRow label="Period">{elements.period === undefined ? 'none (open orbit)' : duration(elements.period)}</DataRow>
			<DataRow label="Mean motion n">{elements.meanMotion === undefined ? 'not applicable' : `${significant(elements.meanMotion * RAD2DEG)} °/day`}</DataRow>
			<DataRow label="Plane normal (J2000)">{n.map((e) => e.toFixed(6)).join(', ')}</DataRow>
		</CollapsibleSection>
	)
}

// Energy, momentum, and speeds.
function DynamicsSection({ solution: { diagnostics: d }, unit }: { readonly solution: OrbitSolveResponse; readonly unit: DistanceUnit }) {
	const kms = fromAuPerDay(1, 'km')
	const energy = unit === 'km' ? `${significant(d.specificEnergy * kms * kms)} km²/s²` : `${significant(d.specificEnergy)} AU²/day²`
	const momentum = unit === 'km' ? `${significant(fromAu(fromAuPerDay(d.angularMomentumMagnitude, 'km'), 'km'))} km²/s` : `${significant(d.angularMomentumMagnitude)} AU²/day`
	return (
		<CollapsibleSection id="orbitalmechanics.dynamics" title="Dynamics" summary={velocity(d.speed, unit)}>
			<DataRow label="Distance r">{distance(d.radius, unit)}</DataRow>
			<DataRow label="Speed |v|">{velocity(d.speed, unit)}</DataRow>
			<DataRow label="Radial speed">{velocity(d.radialSpeed, unit)}</DataRow>
			<DataRow label="Transverse speed">{velocity(d.transverseSpeed, unit)}</DataRow>
			<DataRow label="Escape speed here">{velocity(d.escapeSpeed, unit)}</DataRow>
			<DataRow label="Specific energy ε">{energy}</DataRow>
			<DataRow label="Specific angular momentum |h|">{momentum}</DataRow>
		</CollapsibleSection>
	)
}

// Position and velocity relative to the center.
function StateSection({ solution, unit }: { readonly solution: OrbitSolveResponse; readonly unit: DistanceUnit }) {
	return (
		<CollapsibleSection id="orbitalmechanics.state" title="Cartesian State" summary="J2000 equatorial" defaultOpen={false}>
			<DataRow label="Position">{components(solution.position, (e) => fromAu(e, unit), distanceSymbol(unit))}</DataRow>
			<DataRow label="Velocity">{components(solution.velocity, (e) => fromAuPerDay(e, unit), velocitySymbol(unit))}</DataRow>
			<DataRow label="Axes">J2000 equatorial (ICRF-aligned), geometric, relative to the center</DataRow>
		</CollapsibleSection>
	)
}

// Where the orbit comes from and what kind of values these are.
function SourceSection({ orbit, solution }: { readonly orbit: ExplorerOrbit; readonly solution: OrbitSolveResponse }) {
	const { source } = orbit
	const site = useActiveSite()
	return (
		<CollapsibleSection id="orbitalmechanics.source" title="Source & Accuracy" summary={source.kind === 'preset' ? (source.sourced ? 'Sourced preset' : 'Illustrative preset') : sourceLabel(source)} defaultOpen={false}>
			<DataRow label="Source">{sourceLabel(source)}</DataRow>
			{source.kind === 'preset' && <DataRow label="Kind">{source.sourced ? 'Published elements' : 'Illustrative orbit'}</DataRow>}
			{source.kind === 'preset' && source.citation && <DataRow label="Citation">{source.citation}</DataRow>}
			{source.kind === 'sbdb' && source.solutionDate && <DataRow label="Solution date">{source.solutionDate}</DataRow>}
			{source.kind === 'sbdb' && <DataRow label="Fetched">{new Date(source.fetchedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC</DataRow>}
			{source.kind === 'spk' && <DataRow label="Kernels">{source.kernels.join(', ')}</DataRow>}
			{source.kind === 'spk' && <DataRow label="Library generation">{source.generation}</DataRow>}
			<DataRow label="Model">Two-body Kepler, universal variables</DataRow>
			<DataRow label="Anchor">{formatTdb(solution.anchor)}</DataRow>
			<DataRow label="Fingerprint">{solution.fingerprint}</DataRow>
			<Notice>A two-body model ignores every perturbation, so it drifts from a real object&apos;s motion away from its epoch. It is not a precise ephemeris.</Notice>
			{source.kind === 'sbdb' && (
				<Actions>
					<Button variant="secondary" title="Selects the body in the Sky, which computes its place with its own ephemeris. The Sky's clock does not change." onClick={() => showMinorBodyInSky(source, orbit.name, site)}>
						Show in Sky
					</Button>
				</Actions>
			)}
		</CollapsibleSection>
	)
}
