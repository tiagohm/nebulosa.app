import type { OrbitCenterPayload } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Slider } from '../../ui/Slider'
import { TextInput } from '../../ui/TextInput'
// oxfmt-ignore
import { centerGm, convertDraft, customCenter, distanceSymbol, type DistanceUnit, type DraftKind, editDraft, type ExplorerOrbit, type OrbitalMechanicsState, orbitalMechanicsState, type OrbitDraft, parseTdb, setCenter, setUnit, tdbInputValue, velocitySymbol } from './orbitalmechanics'

// Editor of the selected orbit of the Orbital Mechanics Explorer: the kind of definition, which decides its fields
// (an ellipse by its semi-major axis and mean anomaly at an epoch; a parabola, which has neither, and a hyperbola by
// their periapsis distance and time; or a Cartesian state), the plane of its angles, and the center every orbit shares.
// Edits change the draft at once and are solved once they rest; a draft the model cannot take says why and keeps the
// last valid orbit on screen. Angles are degrees, instants Julian dates TDB, and lengths in the scene's unit.

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

	return (
		<CollapsibleSection id="orbitalmechanics.editor" title="Definition" summary={KIND_LABELS[draft.kind].split(':')[0]}>
			<TextInput label="Name" value={orbit.name} onChange={(e) => (orbitalMechanicsState.orbits.find((o) => o.id === orbit.id)!.name = e.target.value)} />
			<Select label="Defined by" options={KINDS} value={draft.kind} format={(e) => KIND_LABELS[e]} onChange={(kind) => edit((d) => Object.assign(d, convertDraft(d, kind, orbit.solution, unit)))} />
			{draft.kind !== 'cartesian' && <SegmentedControl label="Plane of the angles" options={['equator', 'ecliptic'] as const} value={draft.plane} format={(e) => (e === 'equator' ? 'J2000 equator' : 'J2000 ecliptic')} onChange={(plane) => edit((d) => (d.plane = plane))} />}

			{draft.kind === 'elliptic' && (
				<>
					<NumberInput label="Semi-major axis" suffix={distanceSymbol(unit)} value={draft.semiMajorAxis} min={0} step={distanceStep} onChange={(v) => edit((d) => (d.semiMajorAxis = v))} />
					<Slider label="Eccentricity" value={draft.eccentricity} min={0} max={0.9999} step={0.0001} onChange={(v) => edit((d) => (d.eccentricity = v))} />
				</>
			)}

			{(draft.kind === 'parabolic' || draft.kind === 'hyperbolic') && <NumberInput label="Periapsis distance" suffix={distanceSymbol(unit)} value={draft.periapsisDistance} min={0} step={distanceStep} onChange={(v) => edit((d) => (d.periapsisDistance = v))} />}
			{draft.kind === 'hyperbolic' && <NumberInput label="Eccentricity" value={draft.hyperbolicEccentricity} min={1.0001} step={0.0001} onChange={(v) => edit((d) => (d.hyperbolicEccentricity = v))} />}

			{draft.kind !== 'cartesian' && (
				<>
					<Slider label="Inclination (°)" value={draft.inclination} min={0} max={180} step={0.01} onChange={(v) => edit((d) => (d.inclination = v))} />
					<Slider label="Ascending node Ω (°)" value={draft.node} min={0} max={360} step={0.01} onChange={(v) => edit((d) => (d.node = v))} />
					<Slider label="Argument of periapsis ω (°)" value={draft.argumentOfPeriapsis} min={0} max={360} step={0.01} onChange={(v) => edit((d) => (d.argumentOfPeriapsis = v))} />
				</>
			)}

			{draft.kind === 'elliptic' && <Slider label="Mean anomaly at epoch M (°)" value={draft.meanAnomaly} min={0} max={360} step={0.01} onChange={(v) => edit((d) => (d.meanAnomaly = v))} />}
			{(draft.kind === 'elliptic' || draft.kind === 'cartesian') && <InstantInput label="Epoch" value={draft.epoch} onChange={(v) => edit((d) => (d.epoch = v))} />}
			{(draft.kind === 'parabolic' || draft.kind === 'hyperbolic') && <InstantInput label="Periapsis time" value={draft.periapsisTime} onChange={(v) => edit((d) => (d.periapsisTime = v))} />}

			{draft.kind === 'cartesian' && (
				<>
					<p className="m-0 text-xs text-ink-300">Position and velocity relative to the center, J2000 equatorial axes, used as given.</p>
					<VectorInput label="Position" suffix={distanceSymbol(unit)} value={draft.position} step={distanceStep} onChange={(i, v) => edit((d) => (d.position[i] = v))} />
					<VectorInput label="Velocity" suffix={velocitySymbol(unit)} value={draft.velocity} step={unit === 'km' ? 0.0001 : 1e-7} onChange={(i, v) => edit((d) => (d.velocity[i] = v))} />
				</>
			)}

			{orbit.draftError && <Notice error>{orbit.draftError}</Notice>}
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

	return (
		<CollapsibleSection id="orbitalmechanics.center" title="Center" summary={state.center?.name}>
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
				<p className="m-0 text-xs text-ink-300">
					GM {centerGm(state.center).toPrecision(12)} km³/s²{state.center.code !== undefined && ' (JPL DE440)'}
					{state.center.system && ', the planet and its satellites at the system barycenter'}.
				</p>
			)}
			<SegmentedControl label="Units" options={['km', 'au'] as readonly DistanceUnit[]} value={state.unit} format={(e) => (e === 'km' ? 'km, km/s' : 'AU, AU/day')} onChange={(unit) => setUnit(orbitalMechanicsState, unit)} />
		</CollapsibleSection>
	)
}

// An instant typed as a Julian date TDB or as a TDB calendar date and time.
function InstantInput({ label, value, onChange }: { readonly label: string; readonly value: number; readonly onChange: (jd: number) => void }) {
	return (
		<div className="flex flex-col gap-2">
			<NumberInput label={`${label} (JD TDB)`} value={value} step={0.00001} onChange={onChange} />
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
		</div>
	)
}

// Three components of a vector.
function VectorInput({ label, suffix, value, step, onChange }: { readonly label: string; readonly suffix: string; readonly value: readonly number[]; readonly step: number; readonly onChange: (index: number, value: number) => void }) {
	return (
		<div className="grid grid-cols-1 gap-2">
			{(['x', 'y', 'z'] as const).map((axis, i) => (
				<NumberInput key={axis} label={`${label} ${axis}`} suffix={suffix} value={value[i]} step={step} onChange={(v) => onChange(i, v)} />
			))}
		</div>
	)
}
