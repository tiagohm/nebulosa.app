import type { ObservingMode } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatDegrees, formatGeographic, formatHours } from '../../format'
import { openObservingSites } from '../../location/site'
import { useActiveLocation, useDisplayZone } from '../../location/useLocation'
import { describeDisplayZone } from '../../location/zone'
import { activeProfile, profileState } from '../../profile/profile'
import { PanelSection } from '../../shell/ContextualPanel'
import { routeState } from '../../shell/route'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { AddToPlan } from './AddToPlan'
import { AnalysisSection } from './AnalysisSection'
import { DiscoverSection } from './DiscoverSection'
import { analyze, loadPresets, MODE_LABELS, type NamedTarget, OBSERVING_MODES, OBSERVING_PLANNER_SECTIONS, type ObservingPlannerState, observingPlannerState, refreshAnalysis, SECTION_LABELS, selectMode, tonight } from './observingplanner'
import { PlanSection } from './PlanSection'

// Observing Planner tool: the best targets of a night, the analysis of one target, and manual night plans, all computed by
// the server from local data. The tool always observes from the active profile's site, followed live; nights are named in
// the site's zone, and the display zone of the profile only formats times.
// Nothing here moves the mount, changes the Sky clock, or starts an operation.

// Degrees per radian.
const DEGREES = 180 / Math.PI

// Milliseconds per minute.
const MINUTE_MS = 60_000

// Observing Planner tool.
export function ObservingPlanner() {
	const state = useSnapshot(observingPlannerState) as ObservingPlannerState
	const route = useSnapshot(routeState)
	const profiles = useSnapshot(profileState)
	const profile = activeProfile(profiles)
	const location = useActiveLocation()
	const displayZone = useDisplayZone(location)
	const planId = route.route.workspace === 'tools' && route.route.tool === 'observing-planner' ? route.route.plan : undefined
	const [adding, setAdding] = useState<NamedTarget>()
	const siteId = profile.activeSiteId
	const key = location && JSON.stringify([location.latitude, location.longitude, location.elevation, location.timeZone, state.eveningDate, state.constraints])

	useEffect(() => void loadPresets(observingPlannerState), [])

	// A plan in the route opens the Night Plan section.
	useEffect(() => {
		if (planId) observingPlannerState.section = 'plan'
	}, [planId])

	// Tonight is the default evening of a location, named in its zone.
	useEffect(() => {
		if (location && !observingPlannerState.eveningDate) observingPlannerState.eveningDate = tonight(Date.now(), location.timeZone)
	}, [location?.timeZone])

	// The analysis shown follows the location, the night, and the constraints.
	useEffect(() => {
		if (location && observingPlannerState.selected) void refreshAnalysis(observingPlannerState, location)
	}, [key])

	// A target the Sky sent asks for its plan.
	useEffect(() => {
		if (state.pendingTarget) {
			setAdding(state.pendingTarget)
			observingPlannerState.pendingTarget = undefined
		}
	}, [state.pendingTarget])

	const constraints = state.constraints
	const setConstraint = <K extends keyof NonNullable<ObservingPlannerState['constraints']>>(name: K, value: NonNullable<ObservingPlannerState['constraints']>[K]) => {
		if (observingPlannerState.constraints) observingPlannerState.constraints[name] = value
	}

	const panel = (
		<>
			<PanelSection title="Night">
				<TextInput label="Evening" type="date" value={state.eveningDate ?? ''} onChange={(event) => event.target.value && (observingPlannerState.eveningDate = event.target.value)} />
			</PanelSection>
			{constraints && state.presets && (
				<PanelSection title="Constraints">
					<Select label="Mode" options={OBSERVING_MODES} value={constraints.mode} format={(mode: ObservingMode) => MODE_LABELS[mode]} onChange={(mode) => selectMode(observingPlannerState, mode)} />
					<NumberInput label="Minimum altitude" suffix="°" value={Math.round(constraints.minimumAltitude * DEGREES)} min={0} max={89} onChange={(value) => setConstraint('minimumAltitude', value / DEGREES)} />
					<NumberInput label="Maximum airmass (0 for none)" value={constraints.maximumAirmass ?? 0} min={0} max={10} step={0.1} onChange={(value) => setConstraint('maximumAirmass', value >= 1 ? value : undefined)} />
					<NumberInput label="Maximum Sun altitude" suffix="°" value={Math.round(constraints.maximumSunAltitude * DEGREES)} min={-18} max={0} onChange={(value) => setConstraint('maximumSunAltitude', value / DEGREES)} />
					<NumberInput label="Moon separation while up (0 for none)" suffix="°" value={Math.round((constraints.minimumMoonSeparation ?? 0) * DEGREES)} min={0} max={180} onChange={(value) => setConstraint('minimumMoonSeparation', value > 0 ? value / DEGREES : undefined)} />
					<NumberInput label="Minimum continuous time" suffix="min" value={Math.round(constraints.minimumContinuousMs / MINUTE_MS)} min={state.presets.minimumContinuousMs / MINUTE_MS} max={720} step={5} onChange={(value) => setConstraint('minimumContinuousMs', value * MINUTE_MS)} />
					<p className="m-0 text-xs text-ink-300">
						Hard limits: a target outside them is never ranked. Altitudes are geometric, without refraction or a local horizon. The Moon separation counts only while the Moon is above the horizon. Windows shorter than {formatHours(constraints.minimumContinuousMs)} are left out.
					</p>
				</PanelSection>
			)}
		</>
	)

	return (
		<WorkspaceLayout
			workspace="tools"
			title="Observing Planner"
			context={<SegmentedControl options={OBSERVING_PLANNER_SECTIONS} value={state.section} format={(section) => SECTION_LABELS[section]} onChange={(section) => (observingPlannerState.section = section)} />}
			panel={{ title: 'Night and Constraints', content: panel }}
		>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					{location ? (
						<p className="m-0 text-xs text-ink-300">
							{location.name ?? 'Coordinates entered'} · {formatGeographic(location.latitude, location.longitude)} · {describeDisplayZone(displayZone)}
							{state.eveningDate && ` · night of ${state.eveningDate}`}
							{constraints && ` · ${MODE_LABELS[constraints.mode]}, altitude ≥ ${formatDegrees(constraints.minimumAltitude, 0)}`}
						</p>
					) : (
						state.section !== 'plan' && (
							<Notice>
								<span className="block">Set the observing site of this profile to rank and analyze targets. The catalog can be listed without one.</span>
								<Button variant="secondary" className="mt-2" onClick={() => openObservingSites()}>
									Choose Observing Site
								</Button>
							</Notice>
						)
					)}
					{state.section === 'discover' && <DiscoverSection location={location} timeZone={displayZone.zone} onAdd={setAdding} />}
					{state.section === 'analysis' && <AnalysisSection location={location} activeSite={location} timeZone={displayZone.zone} onAdd={setAdding} />}
					{state.section === 'plan' && <PlanSection planId={planId} location={location} siteId={siteId} activeSite={location} onAnalyze={(target) => location && void analyze(observingPlannerState, location, target)} />}
				</div>
			</div>
			<AddToPlan target={adding} onClose={() => setAdding(undefined)} location={location} siteId={siteId} eveningDate={state.eveningDate} constraints={constraints} />
		</WorkspaceLayout>
	)
}
