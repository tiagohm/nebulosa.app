import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { profileState, setCloseApproachPreferences } from '../../profile/profile'
import { CLOSE_APPROACH_BODIES, CLOSE_APPROACH_DISTANCE_UNITS } from '../../profile/schema'
import { useMediaQuery, WIDE_SCREEN } from '../../shell/useMediaQuery'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import {
	BODY_NAMES,
	CLOSE_APPROACH_PERIODS,
	closeApproachDraftPending,
	closeApproachesState,
	describeCloseApproachFilters,
	distanceStep,
	loadCloseApproaches,
	MAXIMUM_WINDOW_DAYS,
	OBJECT_KIND_LABELS,
	OBJECT_KINDS,
	PERIOD_LABELS,
	searchCloseApproaches,
	setCloseApproachDate,
	setCloseApproachPeriod,
} from './closeapproaches'

// Filters of the Close Approaches tool, grouped by what a search asks: where and when, how close, and which objects.
// They hold pending values until Search, and say so while they differ from the page shown; Refresh asks JPL again for
// the page shown. Below the wide breakpoint they fold into one line naming the search shown, opened with Filters and
// folded again by a search that runs.

// Explains the NEO filter, which is easy to read as a classification.
const NEO_ONLY_HELP = 'Only near-Earth objects. Off, every object is listed, comets included: it does not select the objects that are not NEOs.'

// Explains the PHA filter, which is a screening criterion.
const PHA_ONLY_HELP = 'Only potentially hazardous asteroids, a screening of orbit and size, not a prediction of any impact.'

// Explains the time scale of the days.
const TDB_HELP = `Days of the JPL Barycentric Dynamical Time (TDB), about a minute ahead of UTC, as the source filters them. At most ${MAXIMUM_WINDOW_DAYS} days.`

// Searches the filters being edited; the profile remembers the target and distance of a search that ran. Returns whether
// the search ran.
async function search() {
	await searchCloseApproaches(closeApproachesState)
	if (closeApproachesState.inputError) return false
	const { body, distanceMax, distanceUnit } = closeApproachesState.draft
	setCloseApproachPreferences(profileState, { body, distanceMax, distanceUnit })
	return true
}

// Filters of the tool.
export function CloseApproachFilters() {
	const state = useSnapshot(closeApproachesState)
	const { draft, inputError, loading, filters } = state
	const { period, dateMin, dateMax, body, distanceMax, distanceUnit, kind, neoOnly, phaOnly, hMin, hMax } = draft
	const wide = useMediaQuery(WIDE_SCREEN)
	// Whether the filters are unfolded below the wide breakpoint.
	const [open, setOpen] = useState(false)
	const pending = closeApproachDraftPending(state)

	if (!wide && !open && filters && !inputError) {
		return (
			<div className="flex flex-none items-center gap-2 border-b border-line-100 bg-base-100 px-4 py-2">
				<p className="m-0 min-w-0 flex-1 text-sm leading-5 text-ink-100" title="Filters of the encounters shown">
					{describeCloseApproachFilters(filters)}
				</p>
				<Button variant="secondary" onClick={() => setOpen(true)}>
					{pending ? 'Filters (edited)' : 'Filters'}
				</Button>
			</div>
		)
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				void search().then((ran) => ran && setOpen(false))
			}}
			className="flex max-h-[60%] flex-none flex-col gap-2 overflow-y-auto border-b border-line-100 bg-base-100 px-4 py-3 lg:max-h-none lg:overflow-visible"
		>
			<div className="flex flex-wrap items-end gap-x-5 gap-y-2">
				<div className="flex min-w-0 flex-wrap items-end gap-2">
					<Select label="Target" className="w-36 max-w-full flex-none" options={CLOSE_APPROACH_BODIES} value={body} format={(value) => BODY_NAMES[value]} onChange={(value) => (closeApproachesState.draft.body = value)} />
					<Select label="Period" className="w-40 max-w-full flex-none" options={CLOSE_APPROACH_PERIODS} value={period} format={(value) => PERIOD_LABELS[value]} onChange={(value) => setCloseApproachPeriod(closeApproachesState, value)} />
					<TextInput label="First Day (TDB)" title={TDB_HELP} type="date" className="w-40" value={dateMin} onChange={(e) => setCloseApproachDate(closeApproachesState, 'dateMin', e.target.value)} />
					<TextInput label="Last Day (TDB)" title={TDB_HELP} type="date" className="w-40" value={dateMax} onChange={(e) => setCloseApproachDate(closeApproachesState, 'dateMax', e.target.value)} />
				</div>
				<div className="flex flex-none items-end gap-1">
					<NumberInput label="Largest Distance" className="w-48 min-w-0" suffix={distanceUnit === 'au' ? 'AU' : distanceUnit} min={0} step={distanceStep(distanceUnit)} value={distanceMax} onChange={(value) => (closeApproachesState.draft.distanceMax = value)} />
					<SegmentedControl options={CLOSE_APPROACH_DISTANCE_UNITS} value={distanceUnit} format={(value) => (value === 'au' ? 'AU' : value)} onChange={(value) => (closeApproachesState.draft.distanceUnit = value)} />
				</div>
				<div className="flex min-w-0 flex-wrap items-end gap-2">
					<SegmentedControl label="Objects" options={OBJECT_KINDS} value={kind} format={(value) => OBJECT_KIND_LABELS[value]} onChange={(value) => (closeApproachesState.draft.kind = value)} />
					<div className="flex items-end gap-2">
						<TextInput label="H from" title="Smallest absolute magnitude H, empty for no limit" inputMode="decimal" className="w-20 min-w-0" value={hMin} onChange={(e) => (closeApproachesState.draft.hMin = e.target.value)} />
						<TextInput label="H to" title="Largest absolute magnitude H, empty for no limit" inputMode="decimal" className="w-20 min-w-0" value={hMax} onChange={(e) => (closeApproachesState.draft.hMax = e.target.value)} />
					</div>
					<span className="flex h-9.5 items-center gap-3">
						<Checkbox label="NEOs only" title={NEO_ONLY_HELP} checked={neoOnly} onChange={(value) => (closeApproachesState.draft.neoOnly = value)} />
						<Checkbox label="PHAs only" title={PHA_ONLY_HELP} checked={phaOnly} onChange={(value) => (closeApproachesState.draft.phaOnly = value)} />
					</span>
				</div>
				<div className="ml-auto flex items-center gap-2">
					{pending && <span className="text-xs text-ink-300">Edited, not searched</span>}
					{!wide && filters && (
						<Button variant="secondary" onClick={() => setOpen(false)}>
							Hide
						</Button>
					)}
					<Button variant="secondary" disabled={!filters || loading} title={loading ? 'Reading the page from JPL.' : !filters ? 'Nothing to refresh yet.' : 'Reads the page shown from JPL again.'} onClick={() => void loadCloseApproaches(closeApproachesState, true)}>
						Refresh
					</Button>
					<Button type="submit">Search</Button>
				</div>
			</div>
			{neoOnly && <Notice>{NEO_ONLY_HELP}</Notice>}
			{phaOnly && <Notice>{PHA_ONLY_HELP}</Notice>}
			{inputError && <Notice error>{inputError}</Notice>}
		</form>
	)
}
