import type { OrbitCenterPayload } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { useMediaQuery, WIDE_SCREEN } from '../../shell/useMediaQuery'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Slider } from '../../ui/Slider'
import { TextInput } from '../../ui/TextInput'
import { centerGm, convertDraft, customCenter, distanceSymbol, type DistanceUnit, type DraftField, type DraftKind, editDraft, type ExplorerOrbit, type OrbitalMechanicsState, orbitalMechanicsState, type OrbitDraft, parseTdb, setCenter, setUnit, tdbInputValue, velocitySymbol } from './orbitalmechanics'

// Editor of the selected orbit of the Orbital Mechanics Explorer: the kind of definition, which decides its fields
// (an ellipse by its semi-major axis and mean anomaly at an epoch; a parabola, which has neither, and a hyperbola by
// their periapsis distance and time; or a Cartesian state), the plane of its angles, and the center every orbit shares.
// Edits change the draft at once and are solved once they rest; a draft the model cannot take says why under the field
// to fix and keeps the last valid orbit on screen, dashed. Angles are degrees, instants Julian dates TDB, and lengths in the scene's unit.

// Kinds of definition, in the order offered.
const KINDS: readonly DraftKind[] = ['elliptic', 'parabolic', 'hyperbolic', 'cartesian']

// Labels of the kinds.
const KIND_LABELS: Readonly<Record<DraftKind, string>> = { elliptic: 'Ellipse: a, e, M at an epoch', parabolic: 'Parabola: q, periapsis time', hyperbolic: 'Hyperbola: q, e, periapsis time', cartesian: 'State vector: r, v at an epoch' }

// Value of the center select for a custom center.
const CUSTOM = 'custom'

// Editor of the selected orbit.
export function OrbitEditor({ orbit }: { readonly orbit: ExplorerOrbit }) {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState
	const { draft } = orbit
	const { unit } = state
	const edit = (change: (draft: OrbitDraft) => void) => editDraft(orbitalMechanicsState, orbit.id, change)
	const distanceStep = unit === 'km' ? 1 : 1e-6
	// Why the draft cannot be solved, when the problem is the field's.
	const problemOf = (field: DraftField) => (orbit.draftError?.field === field ? orbit.draftError.message : undefined)
	// Border of a numeric field whose value is the problem.
	const invalid = (field: DraftField) => (problemOf(field) ? { input: 'border-danger' } : undefined)

	return (
		<CollapsibleSection id="orbitalmechanics.editor" title="Definition" summary={KIND_LABELS[draft.kind].split(':')[0]}>
			<TextInput label="Name" value={orbit.name} onChange={(e) => (orbitalMechanicsState.orbits.find((o) => o.id === orbit.id)!.name = e.target.value)} />
			<Select label="Defined by" options={KINDS} value={draft.kind} format={(e) => KIND_LABELS[e]} onChange={(kind) => edit((d) => Object.assign(d, convertDraft(d, kind, orbit.solution, unit)))} />
			{draft.kind !== 'cartesian' && <SegmentedControl label="Plane of the angles" options={['equator', 'ecliptic'] as const} value={draft.plane} format={(e) => (e === 'equator' ? 'J2000 equator' : 'J2000 ecliptic')} onChange={(plane) => edit((d) => (d.plane = plane))} />}

			{draft.kind === 'elliptic' && (
				<>
					<NumberInput label="Semi-major axis" suffix={distanceSymbol(unit)} value={draft.semiMajorAxis} min={0} step={distanceStep} classNames={invalid('semiMajorAxis')} onChange={(v) => edit((d) => (d.semiMajorAxis = v))} />
					<FieldProblem message={problemOf('semiMajorAxis')} />
					<Slider label="Eccentricity" value={draft.eccentricity} min={0} max={0.9999} step={0.0001} onChange={(v) => edit((d) => (d.eccentricity = v))} />
					<FieldProblem message={problemOf('eccentricity')} />
				</>
			)}

			{(draft.kind === 'parabolic' || draft.kind === 'hyperbolic') && (
				<>
					<NumberInput label="Periapsis distance" suffix={distanceSymbol(unit)} value={draft.periapsisDistance} min={0} step={distanceStep} classNames={invalid('periapsisDistance')} onChange={(v) => edit((d) => (d.periapsisDistance = v))} />
					<FieldProblem message={problemOf('periapsisDistance')} />
				</>
			)}
			{draft.kind === 'hyperbolic' && (
				<>
					<NumberInput label="Eccentricity" value={draft.hyperbolicEccentricity} min={0} step={0.0001} classNames={invalid('hyperbolicEccentricity')} onChange={(v) => edit((d) => (d.hyperbolicEccentricity = v))} />
					<FieldProblem message={problemOf('hyperbolicEccentricity')} />
				</>
			)}

			{draft.kind !== 'cartesian' && (
				<>
					<Slider label="Inclination (°)" value={draft.inclination} min={0} max={180} step={0.01} onChange={(v) => edit((d) => (d.inclination = v))} />
					<FieldProblem message={problemOf('inclination')} />
					<Slider label="Ascending node Ω (°)" value={draft.node} min={0} max={360} step={0.01} onChange={(v) => edit((d) => (d.node = v))} />
					<Slider label="Argument of periapsis ω (°)" value={draft.argumentOfPeriapsis} min={0} max={360} step={0.01} onChange={(v) => edit((d) => (d.argumentOfPeriapsis = v))} />
					<FieldProblem message={problemOf('node')} />
				</>
			)}

			{draft.kind === 'elliptic' && (
				<>
					<Slider label="Mean anomaly at epoch M (°)" value={draft.meanAnomaly} min={0} max={360} step={0.01} onChange={(v) => edit((d) => (d.meanAnomaly = v))} />
					<FieldProblem message={problemOf('meanAnomaly')} />
				</>
			)}
			{(draft.kind === 'elliptic' || draft.kind === 'cartesian') && <InstantInput label="Epoch" value={draft.epoch} problem={problemOf('epoch')} onChange={(v) => edit((d) => (d.epoch = v))} />}
			{(draft.kind === 'parabolic' || draft.kind === 'hyperbolic') && <InstantInput label="Periapsis time" value={draft.periapsisTime} problem={problemOf('periapsisTime')} onChange={(v) => edit((d) => (d.periapsisTime = v))} />}

			{draft.kind === 'cartesian' && (
				<>
					<Notice>Position and velocity relative to the center, J2000 equatorial axes, used as given.</Notice>
					<VectorInput label="Position" suffix={distanceSymbol(unit)} value={draft.position} step={distanceStep} problem={problemOf('position')} onChange={(i, v) => edit((d) => (d.position[i] = v))} />
					<VectorInput label="Velocity" suffix={velocitySymbol(unit)} value={draft.velocity} step={unit === 'km' ? 0.0001 : 1e-7} problem={problemOf('velocity')} onChange={(i, v) => edit((d) => (d.velocity[i] = v))} />
				</>
			)}

			<FieldProblem message={problemOf('center')} />
			{orbit.error && <Notice error>{orbit.error}</Notice>}
		</CollapsibleSection>
	)
}

// Center shared by every orbit, and the unit of the scene.
export function CenterEditor() {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState
	const [custom, setCustom] = useState({ name: 'Custom body', gm: 398600.4418, radius: 6378 })
	const centers = state.reference?.centers ?? []
	const value = state.center?.code === undefined ? CUSTOM : String(state.center.code)
	const choose = (center: OrbitCenterPayload) => setCenter(orbitalMechanicsState, center)
	const wide = useMediaQuery(WIDE_SCREEN)

	return (
		<CollapsibleSection id="orbitalmechanics.center" title="Center" summary={state.center?.name} defaultOpen={wide}>
			<Select
				label="Center, shared by every orbit"
				options={[...centers.map((e) => String(e.code)), CUSTOM]}
				value={value}
				format={(e) => (e === CUSTOM ? 'Custom…' : centers.find((c) => String(c.code) === e)!.name)}
				onChange={(code) => {
					if (code === CUSTOM) choose(customCenter(custom.name, custom.gm, custom.radius))
					else choose(centers.find((e) => String(e.code) === code)!)
				}}
			/>
			{value === CUSTOM && (
				<>
					<TextInput label="Name" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
					<NumberInput label="GM" suffix="km³/s²" value={custom.gm} min={0} step={0.0001} onChange={(gm) => setCustom({ ...custom, gm })} />
					<NumberInput label="Radius" suffix="km" value={custom.radius} min={0} step={0.1} onChange={(radius) => setCustom({ ...custom, radius })} />
					<Actions>
						<Button variant="secondary" disabled={!(custom.gm > 0)} onClick={() => choose(customCenter(custom.name, custom.gm, custom.radius))}>
							Apply
						</Button>
					</Actions>
				</>
			)}
			{state.center && (
				<Notice>
					GM {centerGm(state.center).toPrecision(12)} km³/s²{state.center.code !== undefined && ' (JPL DE440)'}
					{state.center.system && ', the planet and its satellites at the system barycenter'}.
				</Notice>
			)}
			<SegmentedControl label="Units" options={['km', 'au'] as readonly DistanceUnit[]} value={state.unit} format={(e) => (e === 'km' ? 'km, km/s' : 'AU, AU/day')} onChange={(unit) => setUnit(orbitalMechanicsState, unit)} />
		</CollapsibleSection>
	)
}

// Why a draft cannot be solved, said under the field to fix; nothing when that field is fine.
function FieldProblem({ message }: { readonly message?: string }) {
	return message ? <Notice error>{message}</Notice> : null
}

// An instant typed as a Julian date TDB or as a TDB calendar date and time, with the problem of its value, if any.
function InstantInput({ label, value, problem, onChange }: { readonly label: string; readonly value: number; readonly problem?: string; readonly onChange: (jd: number) => void }) {
	return (
		<div className="flex flex-col gap-2">
			<NumberInput label={`${label} (JD TDB)`} value={value} step={0.00001} classNames={problem ? { input: 'border-danger' } : undefined} onChange={onChange} />
			<TextInput
				label={`${label} (TDB calendar)`}
				type="datetime-local"
				step={1}
				value={tdbInputValue(value)}
				onChange={(e) => {
					const jd = parseTdb(e.target.value)
					if (jd !== undefined) onChange(jd)
				}}
			/>
			<FieldProblem message={problem} />
		</div>
	)
}

// Three components of a vector, with the problem of its value, if any.
function VectorInput({ label, suffix, value, step, problem, onChange }: { readonly label: string; readonly suffix: string; readonly value: readonly number[]; readonly step: number; readonly problem?: string; readonly onChange: (index: number, value: number) => void }) {
	return (
		<div className="grid grid-cols-1 gap-2">
			{(['x', 'y', 'z'] as const).map((axis, i) => (
				<NumberInput key={axis} label={`${label} ${axis}`} suffix={suffix} value={value[i]} step={step} classNames={problem ? { input: 'border-danger' } : undefined} onChange={(v) => onChange(i, v)} />
			))}
			<FieldProblem message={problem} />
		</div>
	)
}
