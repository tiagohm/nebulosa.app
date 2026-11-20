import type { CloseApproach, CloseApproachBody, MinorBody, MinorBodyDetails, MinorBodyPublishedValue } from 'api'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { formatDate, formatDateTime, formatFixed, formatZonedDateTime, MISSING } from '../../format'
import type { DisplayZone } from '../../location/zone'
import { CLOSE_APPROACH_BODIES, type CloseApproachDistanceDisplay } from '../../profile/schema'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { Notice } from '../../ui/Notice'
import { ObjectTitle } from '../../ui/ObjectTitle'
import { Pager } from '../../ui/Pager'
import { Select } from '../../ui/Select'
import { FoldedNote } from '../observingplanner/FoldedNote'
import {
	BODY_NAMES,
	bodyName,
	type CloseApproachesState,
	closeApproachesState,
	closeApproachFailureNotice,
	filterCloseApproachHistory,
	formatDiameter,
	formatDistance,
	formatDistanceRange,
	formatTimeUncertainty,
	formatVelocity,
	HISTORY_WINDOW_LABELS,
	HISTORY_WINDOWS,
	loadCloseApproachObject,
	pageCloseApproachHistory,
	selectCloseApproach,
} from './closeapproaches'

// Inspector of the Close Approaches tool: what the encounter selected says on its own, where the object stands in the sky
// of the active site, then what SBDB publishes about the object, each section only when it has something. Values are
// shown as published, with their units and uncertainties, and an unknown value is left out. Terms that are easy to read
// as a risk say what they mean: none of them is a prediction.

// What a close approach distance and its range mean.
const RANGE_NOTE = 'Distances are from the target center. The 3σ range is the uncertainty of the nominal distance, not a size of the object.'

// What the two velocities mean.
const VELOCITY_NOTE = 'Vrel is the speed relative to the target at the approach, Vinf the speed relative to a massless target at infinity.'

// What the MOID means.
const MOID_NOTE = 'The MOID is the smallest separation between two orbits, a property of the orbits and not of any encounter.'

// What the classes mean.
const CLASS_NOTE = 'A near-Earth object has a perihelion within 1.3 au. A potentially hazardous asteroid is a screening of orbit and size, not an impact prediction.'

// What the list of virtual impactors means.
const VIRTUAL_IMPACTOR_NOTE = 'As published by the JPL Sentry system through SBDB, for possible future impacts it has not ruled out.'

// Value of a published number with its uncertainty and units.
function publishedText({ value, sigma, units }: MinorBodyPublishedValue) {
	return [value ?? MISSING, sigma && `± ${sigma}`, units].filter(Boolean).join(' ')
}

// Rows of published values, with the reference of each.
function PublishedValues({ values }: { readonly values: readonly MinorBodyPublishedValue[] }) {
	return values.map((value) => (
		<div key={value.name}>
			<DataRow label={value.title}>{publishedText(value)}</DataRow>
			{value.notes && <Notice>{value.notes}</Notice>}
			{value.reference && <Notice>{value.reference}</Notice>}
		</div>
	))
}

// Datum shown only when there is a value.
function OptionalDatum({ label, children }: { readonly label: string; readonly children?: ReactNode }) {
	return children === undefined || children === '' ? null : <DataRow label={label}>{children}</DataRow>
}

interface EncounterProps {
	// Encounter selected.
	readonly approach: CloseApproach
	// Zone of the times, and why it was chosen.
	readonly zone: DisplayZone
	// Unit of the distances.
	readonly distanceDisplay: CloseApproachDistanceDisplay
}

// Overview of the encounter and, once known, of the object.
function Overview({ approach, zone, distanceDisplay, body, children }: EncounterProps & { readonly body?: MinorBody; readonly children?: ReactNode }) {
	const { distance, distanceMin, distanceMax, time, fullName, designation } = approach

	return (
		<CollapsibleSection id="closeapproaches.overview" title="Overview">
			<ObjectTitle name={body?.name ?? fullName ?? designation} kind={body && `${body.kind === 'comet' ? 'Comet' : 'Asteroid'} · ${body.orbitClass}`} designations={body && [`SPK-ID ${body.spkId}`, body.neo && 'NEO', body.pha && 'PHA'].filter(Boolean).join(' · ')} designationsTitle={CLASS_NOTE} />
			<DataRow label="Nominal distance">{formatDistance(distance, distanceDisplay)}</DataRow>
			<OptionalDatum label="3σ range">{formatDistanceRange(distanceMin, distanceMax, distanceDisplay)}</OptionalDatum>
			<DataRow label={`Time (${zone.zone})`}>{formatDateTime(time, zone.zone)}</DataRow>
			{children}
		</CollapsibleSection>
	)
}

// What the encounter publishes, including its raw time in TDB.
function ApproachSection({ approach }: { readonly approach: CloseApproach }) {
	const { body, jd, calendarDate, timeUncertainty, relativeVelocity, infiniteVelocity, orbitId, absoluteMagnitude, diameter, diameterSigma } = approach

	return (
		<CollapsibleSection id="closeapproaches.approach" title="Close Approach">
			<DataRow label="Target">{bodyName(body)}</DataRow>
			<DataRow label="JD (TDB)">{jd}</DataRow>
			<DataRow label="Calendar (TDB)">{calendarDate}</DataRow>
			<OptionalDatum label="Time 3σ">{timeUncertainty && formatTimeUncertainty(timeUncertainty)}</OptionalDatum>
			<DataRow label="Vrel">{formatVelocity(relativeVelocity)}</DataRow>
			<OptionalDatum label="Vinf">{infiniteVelocity === undefined ? undefined : formatVelocity(infiniteVelocity)}</OptionalDatum>
			<DataRow label="Orbit solution">{orbitId}</DataRow>
			<OptionalDatum label="Absolute magnitude H">{absoluteMagnitude === undefined ? undefined : `${formatFixed(absoluteMagnitude, 2)} mag`}</OptionalDatum>
			<OptionalDatum label="Diameter (1σ)">{diameter === undefined ? undefined : formatDiameter(diameter, diameterSigma)}</OptionalDatum>
			<FoldedNote summary="What the range and speeds mean">
				{RANGE_NOTE} {VELOCITY_NOTE}
			</FoldedNote>
		</CollapsibleSection>
	)
}

// Orbit solution of the object.
function OrbitSection({ details: { orbit } }: { readonly details: MinorBodyDetails }) {
	return (
		<CollapsibleSection id="closeapproaches.orbit" title="Orbit" summary={`Solution ${orbit.orbitId}`} defaultOpen={false}>
			<DataRow label="Solution">{orbit.orbitId}</DataRow>
			<DataRow label="Solved">{orbit.solutionDate}</DataRow>
			<DataRow label="Epoch (TDB)">{orbit.epochCalendar}</DataRow>
			<DataRow label="Epoch JD (TDB)">{orbit.epoch}</DataRow>
			<DataRow label="Frame">{orbit.equinox}</DataRow>
			<PublishedValues values={orbit.elements} />
			<PublishedValues values={orbit.model} />
			<OptionalDatum label="Earth MOID">{orbit.moid && `${orbit.moid} au`}</OptionalDatum>
			<OptionalDatum label="Jupiter MOID">{orbit.moidJupiter && `${orbit.moidJupiter} au`}</OptionalDatum>
			<OptionalDatum label="Tisserand (Jupiter)">{orbit.tisserandJupiter}</OptionalDatum>
			<OptionalDatum label="Condition code">{orbit.conditionCode}</OptionalDatum>
			<OptionalDatum label="Residual RMS">{orbit.rms}</OptionalDatum>
			<OptionalDatum label="Ephemeris">{orbit.planetaryEphemeris}</OptionalDatum>
			<OptionalDatum label="Perturbers">{orbit.smallBodyEphemeris}</OptionalDatum>
			<OptionalDatum label="Valid until">{orbit.notValidAfter}</OptionalDatum>
			{orbit.comment && <Notice>{orbit.comment}</Notice>}
			<Notice>{MOID_NOTE}</Notice>
		</CollapsibleSection>
	)
}

// Physical parameters of the object, when any is published.
function PhysicalSection({ details: { physical } }: { readonly details: MinorBodyDetails }) {
	if (physical.length === 0) return null

	return (
		<CollapsibleSection id="closeapproaches.physical" title="Physical Properties" summary={`${physical.length} published`} defaultOpen={false}>
			<PublishedValues values={physical} />
		</CollapsibleSection>
	)
}

// Discovery, observations, and what SBDB adds about them.
function ObservationsSection({ details }: { readonly details: MinorBodyDetails }) {
	const { orbit, discovery, radar, satellites, alternateOrbits, alternateDesignations } = details

	return (
		<CollapsibleSection id="closeapproaches.observations" title="Observations & Discovery" summary={`${orbit.observations} observations`} defaultOpen={false}>
			<OptionalDatum label="Discovered">{discovery?.date}</OptionalDatum>
			<OptionalDatum label="At">{discovery?.location}</OptionalDatum>
			<OptionalDatum label="By">{discovery?.who}</OptionalDatum>
			{discovery?.narrative && <Notice>{discovery.narrative}</Notice>}
			{discovery?.citation && <Notice>{discovery.citation}</Notice>}
			{alternateDesignations.length > 0 && <DataRow label="Also">{alternateDesignations.join(', ')}</DataRow>}
			<DataRow label="First observation">{orbit.firstObservation}</DataRow>
			<DataRow label="Last observation">{orbit.lastObservation}</DataRow>
			<OptionalDatum label="Data arc">{orbit.dataArc && `${orbit.dataArc} days`}</OptionalDatum>
			<DataRow label="Observations">{orbit.observations}</DataRow>
			<OptionalDatum label="Radar delay">{orbit.delayObservations}</OptionalDatum>
			<OptionalDatum label="Radar Doppler">{orbit.dopplerObservations}</OptionalDatum>
			{satellites.map((satellite) => (
				<DataRow key={satellite.name} label={satellite.confirmed ? 'Satellite' : 'Unconfirmed satellite'}>
					{satellite.name}
				</DataRow>
			))}
			{alternateOrbits.length > 0 && <DataRow label="Earlier solutions">{alternateOrbits.map((e) => e.orbitId).join(', ')}</DataRow>}
			{radar.length > 0 && (
				<>
					<Notice>Radar astrometry</Notice>
					<ul className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0 font-mono text-xs">
						{radar.map((e) => (
							<li key={`${e.epoch}${e.units}${e.value}`} title={e.observer}>
								{e.epoch} · {e.value}
								{e.sigma && ` ± ${e.sigma}`} {e.units}
							</li>
						))}
					</ul>
				</>
			)}
		</CollapsibleSection>
	)
}

// Virtual impactors, when SBDB lists any. An absent section says nothing about the risk.
function VirtualImpactorsSection({ details: { virtualImpactors } }: { readonly details: MinorBodyDetails }) {
	if (virtualImpactors.length === 0) return null

	return (
		<CollapsibleSection id="closeapproaches.virtual-impactors" title="Virtual Impactors" summary={`${virtualImpactors.length} listed`} defaultOpen={false}>
			<ul className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0 font-mono text-xs">
				{virtualImpactors.map((e) => (
					<li key={e.date}>
						{e.date} · IP {e.probability}
						{e.palermo && ` · Palermo ${e.palermo}`}
						{e.torino && ` · Torino ${e.torino}`}
					</li>
				))}
			</ul>
			<Notice>{VIRTUAL_IMPACTOR_NOTE}</Notice>
		</CollapsibleSection>
	)
}

// Other encounters of the object with any target, paged by JPL.
function OtherApproachesSection({ zone, distanceDisplay }: Omit<EncounterProps, 'approach'>) {
	const { history, historyBody, historyWindow, historyPage, historyLoading, historyError, selected } = useSnapshot(closeApproachesState) as CloseApproachesState

	return (
		<CollapsibleSection id="closeapproaches.other-approaches" title="Other Approaches" summary={history && `${history.total} in this span`} defaultOpen={false}>
			<Select label="Target" options={CLOSE_APPROACH_BODIES} value={historyBody} format={(value: CloseApproachBody) => BODY_NAMES[value]} onChange={(value) => void filterCloseApproachHistory(closeApproachesState, { historyBody: value })} />
			<Select label="Span" options={HISTORY_WINDOWS} value={historyWindow} format={(value) => HISTORY_WINDOW_LABELS[value]} onChange={(value) => void filterCloseApproachHistory(closeApproachesState, { historyWindow: value })} />
			{historyError && <Notice error>{historyError}</Notice>}
			{historyLoading && !history && <Notice>Reading from JPL…</Notice>}
			{history?.rows.length === 0 && <Notice>No approaches in this span.</Notice>}
			<ul className="m-0 flex list-none flex-col gap-1 p-0">
				{history?.rows.map((approach) => (
					<li key={approach.id}>
						<button
							type="button"
							onClick={() => void selectCloseApproach(closeApproachesState, approach)}
							className={`flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-sm border-0 px-1 py-0.5 text-left font-mono text-xs hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-accent ${selected?.id === approach.id ? 'bg-accent-subtle text-accent' : 'bg-transparent text-ink-200'}`}
						>
							<span>{formatDate(approach.time, zone.zone)}</span>
							<span>{bodyName(approach.body)}</span>
							<span>{formatDistance(approach.distance, distanceDisplay)}</span>
						</button>
					</li>
				))}
			</ul>
			{history && <Pager page={historyPage - 1} total={history.total} pageSize={history.pageSize} noun="approaches" loading={historyLoading} onPage={(index) => void pageCloseApproachHistory(closeApproachesState, index + 1)} />}
		</CollapsibleSection>
	)
}

// Inspector of the encounter selected: `actions` receives the body once known and adds to the first section, and
// `observability` receives it right after, before what the encounter and SBDB publish.
export function CloseApproachInspector({ approach, zone, distanceDisplay, actions, observability }: EncounterProps & { readonly actions: (body: MinorBody) => ReactNode; readonly observability: (body: MinorBody) => ReactNode }) {
	const { object, objectLoading, objectError, designation } = useSnapshot(closeApproachesState) as CloseApproachesState
	const found = object?.kind === 'found' ? object : undefined
	const failure = objectError && closeApproachFailureNotice(objectError)

	return (
		<>
			<Overview approach={approach} zone={zone} distanceDisplay={distanceDisplay} body={found?.body}>
				{found && actions(found.body)}
				{objectLoading && <Notice>Reading the object from SBDB…</Notice>}
				{failure && (
					<Notice error>
						Object details unavailable. {failure.title}: {failure.description}
					</Notice>
				)}
				{failure?.retry && designation && (
					<Button variant="secondary" className="self-start" onClick={() => void loadCloseApproachObject(closeApproachesState, designation)}>
						Retry
					</Button>
				)}
				{object?.kind === 'notFound' && <Notice>SBDB does not know this designation: {object.message}</Notice>}
				{object?.kind === 'ambiguous' && (
					<>
						<Notice>This designation matches several objects. Choose one.</Notice>
						{object.matches.map((match) => (
							<Button key={match.designation} variant="secondary" className="self-start" onClick={() => void loadCloseApproachObject(closeApproachesState, match.designation)}>
								{match.name}
							</Button>
						))}
					</>
				)}
			</Overview>
			{found && observability(found.body)}
			<ApproachSection approach={approach} />
			{found && (
				<>
					<OrbitSection details={found.details} />
					<PhysicalSection details={found.details} />
					<ObservationsSection details={found.details} />
					<VirtualImpactorsSection details={found.details} />
					<OtherApproachesSection zone={zone} distanceDisplay={distanceDisplay} />
					<CollapsibleSection id="closeapproaches.source" title="Source" summary={found.details.source} defaultOpen={false}>
						<Notice>
							{found.details.source} {found.details.sourceVersion}, read {formatZonedDateTime(found.details.fetchedAt, zone.zone)}.
						</Notice>
					</CollapsibleSection>
				</>
			)}
		</>
	)
}
