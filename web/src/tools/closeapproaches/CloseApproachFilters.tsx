import { useSnapshot } from 'valtio'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { NumberInput } from '../../ui/NumberInput'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { Note } from '../eclipse/EclipsePanelParts'
import { BODY_NAMES, CLOSE_APPROACH_BODIES, CLOSE_APPROACH_PERIODS, closeApproachesState, loadCloseApproaches, MAXIMUM_WINDOW_DAYS, OBJECT_KIND_LABELS, OBJECT_KINDS, PERIOD_LABELS, searchCloseApproaches, setCloseApproachDate, setCloseApproachPeriod } from './closeapproaches'

// Filters of the Close Approaches tool. They hold pending values until Search; Refresh asks JPL again for the page shown.

// Units of the largest distance.
const DISTANCE_UNITS = ['LD', 'au'] as const

// Explains the NEO filter, which is easy to read as a classification.
const NEO_ONLY_HELP = 'Only near-Earth objects. Off, every object is listed, comets included: it does not select the objects that are not NEOs.'

// Explains the PHA filter, which is a screening criterion.
const PHA_ONLY_HELP = 'Only potentially hazardous asteroids, a screening of orbit and size, not a prediction of any impact.'

// Explains the time scale of the days.
const TDB_HELP = `Days of the JPL Barycentric Dynamical Time (TDB), about a minute ahead of UTC, as the source filters them. At most ${MAXIMUM_WINDOW_DAYS} days.`

// Filters of the tool.
export function CloseApproachFilters() {
	const { draft, inputError, loading, filters } = useSnapshot(closeApproachesState)
	const { period, dateMin, dateMax, body, distanceMax, distanceUnit, kind, neoOnly, phaOnly, hMin, hMax } = draft

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				void searchCloseApproaches(closeApproachesState)
			}}
			className="flex flex-none flex-col gap-2 border-b border-line-100 bg-base-100 px-4 py-3"
		>
			<div className="flex flex-wrap items-end gap-2">
				<Select label="Target" className="w-36" options={CLOSE_APPROACH_BODIES} value={body} format={(value) => BODY_NAMES[value]} onChange={(value) => (closeApproachesState.draft.body = value)} />
				<Select label="Period" className="w-40" options={CLOSE_APPROACH_PERIODS} value={period} format={(value) => PERIOD_LABELS[value]} onChange={(value) => setCloseApproachPeriod(closeApproachesState, value)} />
				<TextInput label="First Day (TDB)" title={TDB_HELP} type="date" className="w-40" value={dateMin} onChange={(e) => setCloseApproachDate(closeApproachesState, 'dateMin', e.target.value)} />
				<TextInput label="Last Day (TDB)" title={TDB_HELP} type="date" className="w-40" value={dateMax} onChange={(e) => setCloseApproachDate(closeApproachesState, 'dateMax', e.target.value)} />
				<NumberInput label="Largest Distance" className="w-40" min={0} step={1} value={distanceMax} onChange={(value) => (closeApproachesState.draft.distanceMax = value)} />
				<SegmentedControl label="Unit" options={DISTANCE_UNITS} value={distanceUnit} format={(value) => (value === 'au' ? 'AU' : value)} onChange={(value) => (closeApproachesState.draft.distanceUnit = value)} />
				<SegmentedControl label="Objects" options={OBJECT_KINDS} value={kind} format={(value) => OBJECT_KIND_LABELS[value]} onChange={(value) => (closeApproachesState.draft.kind = value)} />
				<TextInput label="H from" title="Smallest absolute magnitude H, empty for no limit" inputMode="decimal" className="w-20 min-w-0" value={hMin} onChange={(e) => (closeApproachesState.draft.hMin = e.target.value)} />
				<TextInput label="H to" title="Largest absolute magnitude H, empty for no limit" inputMode="decimal" className="w-20 min-w-0" value={hMax} onChange={(e) => (closeApproachesState.draft.hMax = e.target.value)} />
				<span className="flex h-9.5 items-center" title={NEO_ONLY_HELP}>
					<Checkbox label="NEOs only" checked={neoOnly} onChange={(value) => (closeApproachesState.draft.neoOnly = value)} />
				</span>
				<span className="flex h-9.5 items-center" title={PHA_ONLY_HELP}>
					<Checkbox label="PHAs only" checked={phaOnly} onChange={(value) => (closeApproachesState.draft.phaOnly = value)} />
				</span>
				<div className="ml-auto flex gap-2">
					<Button variant="secondary" disabled={!filters || loading} title={loading ? 'Reading the page from JPL.' : !filters ? 'Nothing to refresh yet.' : 'Reads the page shown from JPL again.'} onClick={() => void loadCloseApproaches(closeApproachesState, true)}>
						Refresh
					</Button>
					<Button type="submit">Search</Button>
				</div>
			</div>
			{inputError && <Note danger>{inputError}</Note>}
		</form>
	)
}
