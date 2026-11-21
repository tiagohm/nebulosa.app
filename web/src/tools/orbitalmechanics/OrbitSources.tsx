import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { navigate, routeState } from '../../shell/route'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { bodyName, type OrbitalMechanicsState, orbitalMechanicsState } from './orbitalmechanics'
import { replaceSceneWithPending, resolveMinorBody, resolveSpkState } from './orbitalmechanics.sources'

// Real objects of the Orbital Mechanics Explorer: a minor body by SPK-ID, designation, or name, read from the bodies the
// server resolved recently or, only when asked, from JPL; or the osculating state of an SPK target about a DE440 center at
// the clock's instant from the installed SPICE kernels. An orbit about another center than the scene's replaces the
// scene only when the operator says so.

// Value of the target select for a body typed by its NAIF ID.
const OTHER = 'other'

// An SPK target chosen by name among the DE440 bodies, or typed as any NAIF ID.
export function TargetPicker({ label, value, onChange }: { readonly label: string; readonly value: number; readonly onChange: (code: number) => void }) {
	const centers = useSnapshot(orbitalMechanicsState).reference?.centers ?? []
	// Whether the operator chose to type a NAIF ID even for a body the list names.
	const [typed, setTyped] = useState(false)
	const other = typed || !centers.some((e) => e.code === value)

	return (
		<>
			<Select
				label={label}
				options={[...centers.map((e) => String(e.code)), OTHER]}
				value={other ? OTHER : String(value)}
				format={(e) => (e === OTHER ? 'Other NAIF ID…' : bodyName(+e, centers))}
				onChange={(e) => {
					setTyped(e === OTHER)
					if (e !== OTHER) onChange(+e)
				}}
			/>
			{other && <NumberInput label="NAIF ID" value={value} step={1} onChange={onChange} />}
		</>
	)
}

// Lookup of real objects.
export function OrbitSources() {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState
	const { lookup } = state
	const centers = state.reference?.centers ?? []
	const [target, setTarget] = useState(301)
	const [center, setCenter] = useState(String(state.center?.code ?? 399))
	const query = lookup.query.trim()

	return (
		<CollapsibleSection id="orbitalmechanics.sources" title="Real Objects" summary={lookup.loading ? 'Looking up…' : undefined} defaultOpen={false}>
			<form
				className="flex flex-col gap-2"
				onSubmit={(e) => {
					e.preventDefault()
					if (query && !lookup.loading) void resolveMinorBody(orbitalMechanicsState, query)
				}}
			>
				<TextInput label="Minor body (SPK-ID, designation, or name)" value={lookup.query} onChange={(e) => (orbitalMechanicsState.lookup.query = e.target.value)} placeholder="20099942, 1P, Apophis" />
				<Actions>
					<Button type="submit" variant="secondary" disabled={!query || lookup.loading} title="Asks the JPL Small-Body Database for the published orbit solution; while the ephemeris sources are offline, reads only the bodies the server looked up recently, by SPK-ID.">
						Look Up
					</Button>
				</Actions>
			</form>
			{lookup.matches && (
				<div className="flex flex-col gap-1">
					<span className="text-xs text-ink-300">Several bodies match; choose one:</span>
					{lookup.matches.map((e) => (
						<Button key={e.designation} variant="secondary" className="justify-start" onClick={() => void resolveMinorBody(orbitalMechanicsState, e.designation)}>
							{e.name}
						</Button>
					))}
				</div>
			)}
			<Notice>SBDB publishes osculating heliocentric elements at a solution epoch; the explorer propagates them as a two-body orbit, which drifts from the real motion away from that epoch.</Notice>

			<div className="mt-2 flex flex-col gap-2 border-t border-line-100 pt-3">
				<TargetPicker label="SPK target" value={target} onChange={setTarget} />
				<Select label="About" options={centers.map((e) => String(e.code))} value={centers.some((e) => String(e.code) === center) ? center : String(centers[0]?.code ?? 10)} format={(e) => centers.find((c) => String(c.code) === e)?.name ?? e} onChange={setCenter} />
				<Actions>
					<Button variant="secondary" disabled={lookup.loading || target === +center} title="Reads the geometric state at the clock's instant from the installed SPICE kernels and starts a two-body orbit from it." onClick={() => void resolveSpkState(orbitalMechanicsState, target, +center, state.time)}>
						Osculating Orbit Now
					</Button>
				</Actions>
			</div>

			{lookup.error && <Notice error>{lookup.error}</Notice>}
			{lookup.kernelProblem && (
				<Actions>
					<Button variant="ghost" onClick={() => navigate(routeState, { workspace: 'tools', tool: 'spice-kernel-library' })}>
						Open SPICE Kernel Library
					</Button>
				</Actions>
			)}
			{lookup.pending && (
				<>
					<Notice>
						{lookup.pending.name} is about {bodyName(lookup.pending.center, centers)}, while the scene is about {state.center?.name}. Orbits about different centers are never drawn together.
					</Notice>
					<Actions>
						<Button variant="secondary" onClick={() => replaceSceneWithPending(orbitalMechanicsState)}>
							Replace the Scene
						</Button>
						<Button variant="ghost" onClick={() => (orbitalMechanicsState.lookup.pending = undefined)}>
							Cancel
						</Button>
					</Actions>
				</>
			)}
		</CollapsibleSection>
	)
}
