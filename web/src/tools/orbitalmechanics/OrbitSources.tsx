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
import { type OrbitalMechanicsState, orbitalMechanicsState } from './orbitalmechanics'
import { replaceSceneWithPending, resolveMinorBody, resolveSpkState } from './orbitalmechanics.sources'

// Real objects of the Orbital Mechanics Explorer: a minor body by SPK-ID, designation, or name, read from the bodies the
// server resolved recently or, only when asked, from JPL; or the osculating state of an SPK target about a DE440 center at
// the clock's instant from the installed SPICE kernels. An orbit about another center than the scene's replaces the
// scene only when the operator says so.

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
			<TextInput label="Minor body (SPK-ID, designation, or name)" value={lookup.query} onChange={(e) => (orbitalMechanicsState.lookup.query = e.target.value)} placeholder="20099942, 1P, Apophis" />
			<Actions>
				<Button variant="secondary" disabled={!query || lookup.loading} title="Reads only the bodies the server looked up recently, by SPK-ID; never asks JPL." onClick={() => void resolveMinorBody(orbitalMechanicsState, query, false)}>
					Find
				</Button>
				<Button variant="secondary" disabled={!query || lookup.loading} title="Asks the JPL Small-Body Database for the published orbit solution." onClick={() => void resolveMinorBody(orbitalMechanicsState, query, true)}>
					Look up on JPL
				</Button>
			</Actions>
			{lookup.matches && (
				<div className="flex flex-col gap-1">
					<span className="text-xs text-ink-300">Several bodies match; choose one:</span>
					{lookup.matches.map((e) => (
						<Button key={e.designation} variant="ghost" className="justify-start" onClick={() => void resolveMinorBody(orbitalMechanicsState, e.designation, true)}>
							{e.name}
						</Button>
					))}
				</div>
			)}
			<p className="m-0 text-xs text-ink-300">SBDB publishes osculating heliocentric elements at a solution epoch; the explorer propagates them as a two-body orbit, which drifts from the real motion away from that epoch.</p>

			<div className="mt-2 flex flex-col gap-2 border-t border-line-100 pt-3">
				<NumberInput label="SPK target (NAIF ID)" value={target} step={1} onChange={setTarget} />
				<Select label="About" options={centers.map((e) => String(e.code))} value={centers.some((e) => String(e.code) === center) ? center : String(centers[0]?.code ?? 10)} format={(e) => centers.find((c) => String(c.code) === e)?.name ?? e} onChange={setCenter} />
				<Actions>
					<Button variant="secondary" disabled={lookup.loading || target === +center} title="Reads the geometric state at the clock's instant from the installed SPICE kernels and starts a two-body orbit from it." onClick={() => void resolveSpkState(orbitalMechanicsState, target, +center, state.time)}>
						Osculating Orbit Now
					</Button>
				</Actions>
			</div>

			{lookup.error && <Notice error>{lookup.error}</Notice>}
			{lookup.offerOnline && (
				<Actions>
					<Button variant="secondary" onClick={() => void resolveMinorBody(orbitalMechanicsState, query, true)}>
						Look up on JPL
					</Button>
				</Actions>
			)}
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
						{lookup.pending.name} is about {centers.find((e) => e.code === lookup.pending!.center)?.name ?? `NAIF ${lookup.pending.center}`}, while the scene is about {state.center?.name}. Orbits about different centers are never drawn together.
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
