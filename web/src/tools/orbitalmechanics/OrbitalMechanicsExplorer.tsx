import type { OrbitPreset } from 'api'
import { cn } from 'cn'
import { type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { downloadText } from '../../download'
import { useActiveSite } from '../../location/useLocation'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { useMediaQuery, WIDE_SCREEN } from '../../shell/useMediaQuery'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { takesKeys } from '../../sky/shortcuts'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { IconButton } from '../../ui/IconButton'
import { moveIndex } from '../../ui/navigation'
import { Notice } from '../../ui/Notice'
import { Popover } from '../../ui/Popover'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { addOrbit, addRefusal, cloneOrbit, exportScenario, importScenario, loadPreset, type OrbitalMechanicsState, orbitalMechanicsState, openOrbitalMechanics, type OverlayKey, removeOrbit, selectedOrbit, selectOrbit, setPlane, setPlaying, timelineOf, trackCsv } from './orbitalmechanics'
import { consumePendingTarget, showMinorBodyInSky } from './orbitalmechanics.sources'
import { OrbitComparison } from './OrbitComparison'
import { OrbitEditor, CenterEditor } from './OrbitEditor'
import { OrbitInspector } from './OrbitInspector'
import { OrbitScene } from './OrbitScene'
import { OrbitSources } from './OrbitSources'
import { OrbitTimeline, stepClock, usePlayback } from './OrbitTimeline'
import { PALETTE_TOKENS, presetAngles, toDisplay } from './scene'

// Orbital Mechanics Explorer: a two-body laboratory where an orbit is defined by elements or a state, drawn in 3D,
// played in time, and inspected, with every physical value computed by the server's single Kepler model. The scene is
// the workspace's content with the clock under it; the panel (a drawer on narrow screens) holds the orbits, the center,
// the definition, the exact values, and the view. It changes no other tool: not the Sky's clock, the site, or a device.

// Labels of the layers.
const OVERLAY_LABELS: Readonly<Record<OverlayKey, string>> = {
	referencePlane: 'Reference plane',
	orbitalPlane: 'Orbital plane',
	axes: 'Axes',
	nodes: 'Nodes and line of nodes',
	apsides: 'Periapsis and apoapsis',
	positionVector: 'Position r',
	velocityVector: 'Velocity v (direction)',
	angularMomentum: 'Angular momentum h (direction)',
	eccentricityVector: 'Eccentricity vector e',
	labels: 'Labels',
}

// Orbital Mechanics Explorer tool.
export function OrbitalMechanicsExplorer() {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState
	const orbit = selectedOrbit(state)
	usePlayback()
	useShortcuts()

	// Reads the reference on the first opening of the tab.
	useEffect(() => void openOrbitalMechanics(orbitalMechanicsState), [])

	// Resolves a minor body another tool handed over, once the reference is read.
	useEffect(() => void consumePendingTarget(orbitalMechanicsState), [state.reference, state.pendingTarget])

	const panel = (
		<>
			<OrbitList />
			<CenterEditor />
			{orbit && <OrbitEditor key={orbit.id} orbit={orbit} />}
			{orbit && <OrbitInspector orbit={orbit} />}
			<OrbitSources />
			<OrbitComparison />
			<ViewSection />
		</>
	)

	const source = orbit?.source
	const site = useActiveSite()
	// Actions on the selected orbit: a real minor body can be shown in the Sky, with the Sky's own ephemeris and clock.
	const actions = orbit && source?.kind === 'sbdb' && <IconButton icon="reticle" label="Show in Sky (selects the body there; the Sky's clock does not change)" onClick={() => showMinorBodyInSky(source, orbit.name, site)} />

	return (
		<WorkspaceLayout workspace="tools" title="Orbital Mechanics Explorer" actions={<ExplorerActions />} panel={{ title: orbit?.name ?? 'Orbit', content: panel, actions: actions || undefined, sheet: true }}>
			<div className="flex h-full min-h-0 flex-col">
				<div className="relative min-h-0 flex-1">
					{state.referenceError ? <EmptyState title="The explorer could not start" description={state.referenceError} action={<Button onClick={() => void openOrbitalMechanics(orbitalMechanicsState)}>Retry</Button>} /> : <OrbitScene />}
					<p className="pointer-events-none absolute bottom-2 left-3 m-0 text-xs text-ink-300 max-sm:hidden">
						Two-body model · {state.plane === 'ecliptic' ? 'J2000 ecliptic' : 'J2000 equator'} · {state.centerDrawing === 'marker' ? 'center not to scale' : 'center to scale'} · vectors v, h, e show directions only
						{state.orbits.some((e) => e.visible && e.draftError) && ' · dashed: last valid definition'}
					</p>
				</div>
				<OrbitTimeline />
			</div>
		</WorkspaceLayout>
	)
}

// Shortcuts of the tool while it is shown, unless a field, a list, a button, or a dialog takes the key: Space plays or
// pauses, comma and period step the clock, F fits every orbit and Shift + F the selected one.
function useShortcuts() {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.ctrlKey || event.altKey || event.metaKey || takesKeys(event.target)) return
			const state = orbitalMechanicsState
			// A focused button or disclosure already answers Space itself.
			const pressable = event.target instanceof Element && event.target.closest('button, a, summary') !== null

			if (event.key === ' ' && !pressable && timelineOf(state)) setPlaying(state, !state.playing)
			else if (event.key === ',') stepClock(state, -1)
			else if (event.key === '.') stepClock(state, 1)
			else if (event.key === 'f') state.fitPending = 'scene'
			else if (event.key === 'F' && state.selected) state.fitPending = 'selected'
			else return

			event.preventDefault()
		}

		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [])
}

// Workspace actions: presets, import, and the exports.
function ExplorerActions() {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState
	const [presetsOpen, setPresetsOpen] = useState(false)
	const input = useRef<HTMLInputElement>(null)
	const orbit = selectedOrbit(state)
	const scenario = () => exportScenario(orbitalMechanicsState)

	async function importFile({ target: { files } }: ChangeEvent<HTMLInputElement>) {
		const file = files?.[0]
		if (input.current) input.current.value = ''
		if (file) importScenario(orbitalMechanicsState, await file.text())
	}

	return (
		<div className="flex items-center gap-1">
			<Popover icon="orbit" label="Presets" open={presetsOpen} onOpenChange={setPresetsOpen}>
				<PresetList presets={state.reference?.presets ?? []} onLoad={() => setPresetsOpen(false)} />
			</Popover>
			<IconButton icon="folder" label="Import scenario" disabled={!state.reference} onClick={() => input.current?.click()} />
			<input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importFile(event)} />
			<IconButton
				icon="save"
				label="Export scenario"
				disabled={state.orbits.every((e) => !e.definition)}
				onClick={() => {
					const value = scenario()
					if (value) downloadText(`${JSON.stringify(value, null, '\t')}\n`, 'orbital-mechanics-scenario.json', 'application/json')
				}}
			/>
			<IconButton icon="file" label="Export states as CSV" disabled={!orbit?.track || !state.center} onClick={() => orbit?.track && state.center && downloadText(trackCsv(orbit, orbit.track, state.center), `${orbit.name}-states.csv`, 'text/csv')} />
		</div>
	)
}

// Presets, each loaded in place of the scene.
function PresetList({ presets, onLoad }: { readonly presets: readonly OrbitPreset[]; readonly onLoad: () => void }) {
	return (
		<div className="flex max-h-[70vh] w-64 max-w-full flex-col gap-2 overflow-y-auto">
			{presets.map((preset) => (
				<button
					key={preset.id}
					type="button"
					className="flex cursor-pointer flex-col gap-1 rounded-sm border border-line-100 bg-transparent p-2 text-left hover:border-ink-300 hover:bg-base-300"
					onClick={() => {
						loadPreset(orbitalMechanicsState, preset)
						onLoad()
					}}
				>
					<span className="flex items-center justify-between gap-2 text-sm text-ink-100">
						{preset.name}
						<span className="flex-none text-xs text-ink-300">{preset.source.kind === 'sourced' ? 'Sourced' : 'Illustrative'}</span>
					</span>
					<span className="text-xs text-ink-200">{preset.description}</span>
					{preset.source.kind === 'sourced' && <span className="text-xs text-ink-300">{preset.source.citation}</span>}
				</button>
			))}
		</div>
	)
}

// Orbits of the scene: selection, visibility, copy, and removal. The arrow keys, Home, and End move the selection
// between the orbits' names.
function OrbitList() {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState
	const refusal = addRefusal(state)

	function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		const names = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-orbit]')]
		const index = names.indexOf(event.target as HTMLButtonElement)
		if (index < 0) return
		const next = moveIndex(index, names.length, event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? '' : event.key)
		if (next === undefined) return
		event.preventDefault()
		selectOrbit(orbitalMechanicsState, names[next].dataset.orbit!)
		names[next].focus()
	}

	return (
		<CollapsibleSection id="orbitalmechanics.orbits" title="Orbits" summary={`${state.orbits.length}`}>
			{state.importError && <Notice error>{state.importError}</Notice>}
			<div className="flex flex-col gap-1" onKeyDown={onKeyDown}>
				{state.orbits.map((orbit) => (
					<div key={orbit.id} className={cn('flex items-center gap-2 rounded-sm px-2 py-1', orbit.id === state.selected ? 'bg-accent-subtle' : 'hover:bg-base-300')}>
						<span className="size-3 flex-none rounded-full" style={{ background: `var(${PALETTE_TOKENS[orbit.color % PALETTE_TOKENS.length]})` }} />
						<button
							type="button"
							data-orbit={orbit.id}
							tabIndex={orbit.id === state.selected ? 0 : -1}
							className="min-w-0 flex-1 cursor-pointer truncate rounded-sm border-0 bg-transparent p-0 text-left text-sm text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
							onClick={() => selectOrbit(orbitalMechanicsState, orbit.id)}
						>
							{orbit.name}
							{orbit.loading && <span className="text-ink-300"> · updating</span>}
						</button>
						<Checkbox label="Shown" hideLabel title="Shown in the scene" checked={orbit.visible} onChange={(visible) => (orbitalMechanicsState.orbits.find((e) => e.id === orbit.id)!.visible = visible)} />
						<IconButton icon="duplicate" label="Copy" disabled={refusal !== undefined || !orbit.definition} onClick={() => cloneOrbit(orbitalMechanicsState, orbit.id)} />
						<IconButton icon="trash" label="Remove" disabled={state.orbits.length === 1} onClick={() => removeOrbit(orbitalMechanicsState, orbit.id)} />
					</div>
				))}
			</div>
			<Actions>
				<Button
					variant="secondary"
					disabled={refusal !== undefined || !state.center}
					onClick={() => {
						const { center } = orbitalMechanicsState
						if (center)
							addOrbit(
								orbitalMechanicsState,
								{ kind: 'elliptic', mu: center.mu, plane: orbitalMechanicsState.plane, semiMajorAxis: Math.max(center.radius * 2, center.code === 10 ? 1 : center.radius * 2), eccentricity: 0.2, inclination: 0.3, node: 0, argumentOfPeriapsis: 0, meanAnomaly: 0, epoch: orbitalMechanicsState.time },
								`Orbit ${state.orbits.length + 1}`,
								{ kind: 'manual' },
							)
					}}
				>
					New Orbit
				</Button>
			</Actions>
			{refusal && <Notice>{refusal}</Notice>}
			<Notice>Every orbit is about the same center, in the same axes, on the same clock.</Notice>
		</CollapsibleSection>
	)
}

// The reference plane, the camera, and the layers.
function ViewSection() {
	const state = useSnapshot(orbitalMechanicsState) as OrbitalMechanicsState

	const look = (kind: 'top' | 'side' | 'normal') => {
		const orbit = selectedOrbit(orbitalMechanicsState)
		const normal = orbit?.solution && toDisplay(orbit.solution.diagnostics.normal, orbitalMechanicsState.plane)
		Object.assign(orbitalMechanicsState.view, presetAngles(kind, normal))
	}

	const wide = useMediaQuery(WIDE_SCREEN)

	return (
		<CollapsibleSection id="orbitalmechanics.view" title="View" summary={state.plane === 'ecliptic' ? 'Ecliptic' : 'Equator'} defaultOpen={wide}>
			<SegmentedControl label="Plane drawn" options={['equator', 'ecliptic'] as const} value={state.plane} format={(e) => (e === 'equator' ? 'J2000 equator' : 'J2000 ecliptic')} onChange={(plane) => setPlane(orbitalMechanicsState, plane)} />
			<SegmentedControl label="Projection" options={['perspective', 'orthographic'] as const} value={state.view.projection} format={(e) => (e === 'perspective' ? 'Perspective' : 'Orthographic')} onChange={(projection) => (orbitalMechanicsState.view.projection = projection)} />
			<SegmentedControl label="Central body drawn" options={['true', 'marker'] as const} value={state.centerDrawing} format={(e) => (e === 'true' ? 'To scale' : 'As a marker')} onChange={(drawing) => (orbitalMechanicsState.centerDrawing = drawing)} />
			<Actions>
				<Button variant="secondary" onClick={() => look('top')}>
					Top
				</Button>
				<Button variant="secondary" onClick={() => look('side')}>
					Side
				</Button>
				<Button variant="secondary" onClick={() => look('normal')}>
					Face-on
				</Button>
				<Button variant="secondary" title="Frames every orbit drawn" onClick={() => (orbitalMechanicsState.fitPending = 'scene')}>
					Fit All
				</Button>
				<Button variant="secondary" title="Frames the selected orbit" disabled={!state.selected} onClick={() => (orbitalMechanicsState.fitPending = 'selected')}>
					Fit Selected
				</Button>
			</Actions>
			{(Object.keys(OVERLAY_LABELS) as OverlayKey[]).map((key) => (
				<Checkbox key={key} label={OVERLAY_LABELS[key]} checked={state.overlays[key]} onChange={(checked) => (orbitalMechanicsState.overlays[key] = checked)} />
			))}
		</CollapsibleSection>
	)
}
