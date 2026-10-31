import type { CloseApproach, CloseApproachBody, MinorBody, MinorBodyDetails, MinorBodyPublishedValue } from 'api'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Datum, Note } from '../../sky/InspectorParts'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import {
	BODY_NAMES,
	bodyName,
	CLOSE_APPROACH_BODIES,
	type CloseApproachesState,
	closeApproachesState,
	filterCloseApproachHistory,
	formatApproachTime,
	formatDiameter,
	formatDistance,
	formatDistanceRange,
	formatVelocity,
	HISTORY_WINDOW_LABELS,
	HISTORY_WINDOWS,
	loadCloseApproachObject,
	pageCloseApproachHistory,
	pageCount,
	selectCloseApproach,
} from './closeapproaches'

// Inspector of the Close Approaches tool: what the encounter selected says on its own, then what SBDB publishes about the
// object, each section only when it has something. Values are shown as published, with their units and uncertainties, and
// an unknown value is left out. Terms that are easy to read as a risk say what they mean: none of them is a prediction.

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
	return [value ?? '—', sigma && `± ${sigma}`, units].filter(Boolean).join(' ')
}

// Rows of published values, with the reference of each.
function PublishedValues({ values }: { readonly values: readonly MinorBodyPublishedValue[] }) {
	return values.map((value) => (
		<div key={value.name}>
			<Datum label={value.title}>{publishedText(value)}</Datum>
			{value.notes && <Note>{value.notes}</Note>}
			{value.reference && <Note>{value.reference}</Note>}
		</div>
	))
}

// Datum shown only when there is a value.
function OptionalDatum({ label, children }: { readonly label: string; readonly children?: ReactNode }) {
	return children === undefined || children === '' ? null : <Datum label={label}>{children}</Datum>
}

interface EncounterProps {
	// Encounter selected.
	readonly approach: CloseApproach
	// Zone of the times.
	readonly timeZone: string
}

// Overview of the encounter and, once known, of the object.
function Overview({ approach, timeZone, body, children }: EncounterProps & { readonly body?: MinorBody; readonly children?: ReactNode }) {
	const { distanceDisplay } = useSnapshot(closeApproachesState)
	const { distance, distanceMin, distanceMax, relativeVelocity, time, fullName, designation } = approach

	return (
		<CollapsibleSection id="closeapproaches.overview" title="Overview">
			<p className="m-0 text-base leading-6 font-semibold text-ink-100">{body?.name ?? fullName ?? designation}</p>
			{body && (
				<p className="m-0 text-ink-300">
					{body.kind === 'comet' ? 'Comet' : 'Asteroid'} · {body.orbitClass}
				</p>
			)}
			{body && (
				<p className="m-0 text-xs leading-5 text-ink-200" title={CLASS_NOTE}>
					{[`SPK-ID ${body.spkId}`, body.neo && 'NEO', body.pha && 'PHA'].filter(Boolean).join(' · ')}
				</p>
			)}
			<Datum label="Nominal distance">{formatDistance(distance, distanceDisplay)}</Datum>
			<OptionalDatum label="3σ range">{formatDistanceRange(distanceMin, distanceMax, distanceDisplay)}</OptionalDatum>
			<Datum label="Vrel">{formatVelocity(relativeVelocity)}</Datum>
			<Datum label={`Time (${timeZone})`}>{formatApproachTime(time, timeZone)}</Datum>
			{children}
		</CollapsibleSection>
	)
}

// What the encounter publishes, including its raw time in TDB.
function ApproachSection({ approach }: { readonly approach: CloseApproach }) {
	const { body, jd, calendarDate, timeUncertainty, relativeVelocity, infiniteVelocity, orbitId, absoluteMagnitude, diameter, diameterSigma } = approach

	return (
		<CollapsibleSection id="closeapproaches.approach" title="Close Approach">
			<Datum label="Target">{bodyName(body)}</Datum>
			<Datum label="JD (TDB)">{jd}</Datum>
			<Datum label="Calendar (TDB)">{calendarDate}</Datum>
			<OptionalDatum label="Time 3σ">{timeUncertainty}</OptionalDatum>
			<Datum label="Vrel">{formatVelocity(relativeVelocity)}</Datum>
			<OptionalDatum label="Vinf">{infiniteVelocity === undefined ? undefined : formatVelocity(infiniteVelocity)}</OptionalDatum>
			<Datum label="Orbit solution">{orbitId}</Datum>
			<OptionalDatum label="Absolute magnitude H">{absoluteMagnitude?.toFixed(2)}</OptionalDatum>
			<OptionalDatum label="Diameter (1σ)">{diameter === undefined ? undefined : formatDiameter(diameter, diameterSigma)}</OptionalDatum>
			<Note>{RANGE_NOTE}</Note>
			<Note>{VELOCITY_NOTE}</Note>
		</CollapsibleSection>
	)
}

// Orbit solution of the object.
function OrbitSection({ details: { orbit } }: { readonly details: MinorBodyDetails }) {
	return (
		<CollapsibleSection id="closeapproaches.orbit" title="Orbit" summary={`Solution ${orbit.orbitId}`} defaultOpen={false}>
			<Datum label="Solution">{orbit.orbitId}</Datum>
			<Datum label="Solved">{orbit.solutionDate}</Datum>
			<Datum label="Epoch (TDB)">{orbit.epochCalendar}</Datum>
			<Datum label="Epoch JD (TDB)">{orbit.epoch}</Datum>
			<Datum label="Frame">{orbit.equinox}</Datum>
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
			{orbit.comment && <Note>{orbit.comment}</Note>}
			<Note>{MOID_NOTE}</Note>
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
			{discovery?.narrative && <Note>{discovery.narrative}</Note>}
			{discovery?.citation && <Note>{discovery.citation}</Note>}
			{alternateDesignations.length > 0 && <Datum label="Also">{alternateDesignations.join(', ')}</Datum>}
			<Datum label="First observation">{orbit.firstObservation}</Datum>
			<Datum label="Last observation">{orbit.lastObservation}</Datum>
			<OptionalDatum label="Data arc">{orbit.dataArc && `${orbit.dataArc} days`}</OptionalDatum>
			<Datum label="Observations">{orbit.observations}</Datum>
			<OptionalDatum label="Radar delay">{orbit.delayObservations}</OptionalDatum>
			<OptionalDatum label="Radar Doppler">{orbit.dopplerObservations}</OptionalDatum>
			{satellites.map((satellite) => (
				<Datum key={satellite.name} label={satellite.confirmed ? 'Satellite' : 'Unconfirmed satellite'}>
					{satellite.name}
				</Datum>
			))}
			{alternateOrbits.length > 0 && <Datum label="Earlier solutions">{alternateOrbits.map((e) => e.orbitId).join(', ')}</Datum>}
			{radar.length > 0 && (
				<>
					<p className="m-0 text-ink-300">Radar astrometry</p>
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
			<Note>{VIRTUAL_IMPACTOR_NOTE}</Note>
		</CollapsibleSection>
	)
}

// Other encounters of the object with any target, paged by JPL.
function OtherApproachesSection({ timeZone }: { readonly timeZone: string }) {
	const { history, historyBody, historyWindow, historyPage, historyLoading, historyError, distanceDisplay, selected } = useSnapshot(closeApproachesState) as CloseApproachesState
	const pages = history ? pageCount(history.total, history.pageSize) : 1

	return (
		<CollapsibleSection id="closeapproaches.other-approaches" title="Other Approaches" summary={history && `${history.total} in this span`} defaultOpen={false}>
			<Select label="Target" options={CLOSE_APPROACH_BODIES} value={historyBody} format={(value: CloseApproachBody) => BODY_NAMES[value]} onChange={(value) => void filterCloseApproachHistory(closeApproachesState, { historyBody: value })} />
			<Select label="Span" options={HISTORY_WINDOWS} value={historyWindow} format={(value) => HISTORY_WINDOW_LABELS[value]} onChange={(value) => void filterCloseApproachHistory(closeApproachesState, { historyWindow: value })} />
			{historyError && <Note danger>{historyError}</Note>}
			{historyLoading && !history && <p className="m-0 text-ink-300">Reading from JPL…</p>}
			{history?.rows.length === 0 && <p className="m-0 text-ink-300">No approaches in this span.</p>}
			<ul className="m-0 flex list-none flex-col gap-1 p-0">
				{history?.rows.map((approach) => (
					<li key={approach.id}>
						<button
							type="button"
							onClick={() => void selectCloseApproach(closeApproachesState, approach)}
							className={`flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-sm border-0 px-1 py-0.5 text-left font-mono text-xs hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-accent ${selected?.id === approach.id ? 'bg-accent-subtle text-accent' : 'bg-transparent text-ink-200'}`}
						>
							<span>{formatApproachTime(approach.time, timeZone).slice(0, 10)}</span>
							<span>{bodyName(approach.body)}</span>
							<span>{formatDistance(approach.distance, distanceDisplay)}</span>
						</button>
					</li>
				))}
			</ul>
			{history && pages > 1 && (
				<div className="flex items-center justify-between gap-2">
					<Button variant="secondary" disabled={historyLoading || historyPage <= 1} onClick={() => void pageCloseApproachHistory(closeApproachesState, historyPage - 1)}>
						Previous
					</Button>
					<span className="text-xs tabular-nums">
						{historyPage} of {pages}
					</span>
					<Button variant="secondary" disabled={historyLoading || historyPage >= pages} onClick={() => void pageCloseApproachHistory(closeApproachesState, historyPage + 1)}>
						Next
					</Button>
				</div>
			)}
		</CollapsibleSection>
	)
}

// Inspector of the encounter selected: `overview` adds to the first section, `children` follows the object's sections.
export function CloseApproachInspector({ approach, timeZone, overview, children }: EncounterProps & { readonly overview?: ReactNode; readonly children?: ReactNode }) {
	const { object, objectLoading, objectError, designation } = useSnapshot(closeApproachesState) as CloseApproachesState
	const found = object?.kind === 'found' ? object : undefined

	return (
		<>
			<Overview approach={approach} timeZone={timeZone} body={found?.body}>
				{overview}
				{objectLoading && <Note>Reading the object from SBDB…</Note>}
				{objectError && <Note danger>Object details unavailable: {objectError}</Note>}
				{objectError && designation && (
					<Button variant="secondary" className="self-start" onClick={() => void loadCloseApproachObject(closeApproachesState, designation)}>
						Retry
					</Button>
				)}
				{object?.kind === 'notFound' && <Note>SBDB does not know this designation: {object.message}</Note>}
				{object?.kind === 'ambiguous' && (
					<>
						<Note>This designation matches several objects. Choose one.</Note>
						{object.matches.map((match) => (
							<Button key={match.designation} variant="secondary" className="self-start" onClick={() => void loadCloseApproachObject(closeApproachesState, match.designation)}>
								{match.name}
							</Button>
						))}
					</>
				)}
			</Overview>
			<ApproachSection approach={approach} />
			{found && (
				<>
					<OrbitSection details={found.details} />
					<PhysicalSection details={found.details} />
					<ObservationsSection details={found.details} />
					<VirtualImpactorsSection details={found.details} />
					<OtherApproachesSection timeZone={timeZone} />
					{children}
					<div className="px-4 py-3">
						<Note>
							{found.details.source} {found.details.sourceVersion}, read {formatApproachTime(found.details.fetchedAt, timeZone)}.
						</Note>
					</div>
				</>
			)}
		</>
	)
}
