import type { SatelliteGroupStatus } from 'api'
import { useSnapshot } from 'valtio'
import { formatCivilDate, formatClockTime, formatDegrees, formatDuration, formatSpan } from '../../format'
import { openObservingSites, type SiteLocation } from '../../location/site'
import { type DisplayZone, describeDisplayZone } from '../../location/zone'
import { EmptyState } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { Cell, Row, Table, type TableColumn } from '../../ui/Table'
import { useNow } from '../../useNow'
import { artificialSatellitesState, highestVisiblePoint, loadTonight, selectSatellite, showSatelliteInSky, TONIGHT_LIMIT, type TonightPass, type TonightResult, type TonightSource, TWILIGHT_LABELS, TWILIGHT_LIMITS, type TwilightLimit } from './artificialsatellites'

// Tonight view of Artificial Satellites, the one the tool opens on: the passes of the profile's favorites, or of the
// members of a downloaded group, that can be seen tonight from the observing site of the active profile (sunlit while
// the Sun is below the twilight limit), in the order they appear, each with how long until it does. What is listed is
// chosen at once; the altitude and the twilight wait for Find Passes. Choosing a pass selects its satellite, whose
// details are the contextual panel; its passes over more days are one view away. Times are in the display zone.

// Interval of the countdowns, in milliseconds: the nearest minute is enough to plan by.
const COUNTDOWN_INTERVAL_MS = 30_000

// Twilight limits offered.
const TWILIGHTS = Object.keys(TWILIGHT_LIMITS) as TwilightLimit[]

// Columns of the table of tonight's passes.
const TONIGHT_COLUMNS: readonly TableColumn[] = ['Satellite', 'When', 'Visible', { key: 'highest', label: 'Highest', numeric: true }, { key: 'altitude', label: 'Alt', numeric: true }, { key: 'startAzimuth', label: 'Start Az', numeric: true }, { key: 'endAzimuth', label: 'End Az', numeric: true }]

// A group Tonight can list: a downloaded group that is not large.
export interface TonightGroup {
	// GP source key of the group (gp:GROUP:<name>).
	readonly key: string
	// Name of the group.
	readonly label: string
	// Objects the group lists.
	readonly members: number
}

// Groups Tonight can list, of the groups of the catalog's sources: those downloaded and not large, whose members it
// predicts at most TONIGHT_LIMIT of.
export function tonightGroups(groups: readonly SatelliteGroupStatus[] | undefined): TonightGroup[] {
	return (groups ?? []).filter((group) => group.members > 0 && !group.large).map((group) => ({ key: `gp:GROUP:${group.group}`, label: group.label, members: group.members }))
}

// Count of the satellites of a source in words: "6 favorites", "17 satellites of Space stations".
function countText(count: number, label: string | undefined) {
	return label === undefined ? `${count} ${count === 1 ? 'favorite' : 'favorites'}` : `${count} ${count === 1 ? 'satellite' : 'satellites'} of ${label}`
}

// When a pass can be seen, against now (Unix milliseconds): over, now, or in how long.
function whenText({ pass }: TonightPass, now: number) {
	const first = pass.visible[0]
	const last = pass.visible.at(-1)!
	if (last.end <= now) return 'Over'
	if (first.start <= now) return 'Now'
	return `in ${formatDuration((first.start - now) / 1000)}`
}

// Dark part of the night at the limit of the search, in words.
function darkText(result: TonightResult, timeZone: string) {
	const crossings = result.night.sun[result.twilight]
	const label = TWILIGHT_LABELS[result.twilight].split(' ')[0].toLowerCase()
	if (crossings.state === 'continuousBelow') return `dark (${label}) all night`
	if (crossings.dusk === undefined || crossings.dawn === undefined) return `no ${label} darkness`
	return `dark (${label}) ${formatSpan(crossings.dusk, crossings.dawn, timeZone)}`
}

// Properties of the row of a pass tonight.
interface TonightRowProps {
	// Pass shown.
	readonly entry: TonightPass
	// Index of the pass in the answer, which selects it.
	readonly index: number
	// IANA zone its times are shown in.
	readonly timeZone: string
	// Real current time, Unix milliseconds.
	readonly now: number
	// Observing site of the active profile, which selecting the satellite reads its position for.
	readonly observer: SiteLocation
}

// Row of one pass tonight; a pass already over is muted.
function TonightRow({ entry, index, timeZone, now, observer }: TonightRowProps) {
	const { tonightSelected } = useSnapshot(artificialSatellitesState)
	const { pass } = entry
	const highest = highestVisiblePoint(entry.pass)
	const over = pass.visible.at(-1)!.end <= now
	const select = () => {
		artificialSatellitesState.tonightSelected = index
		void selectSatellite(artificialSatellitesState, entry.noradId, observer)
	}

	return (
		<Row selected={tonightSelected === index} onSelect={select}>
			<Cell className={over ? 'max-w-64 truncate text-ink-300' : 'max-w-64 truncate text-ink-100'} title={entry.name}>
				{entry.name}
			</Cell>
			<Cell className={over ? 'text-ink-300' : 'text-ink-100'}>{whenText(entry, now)}</Cell>
			<Cell>{formatSpan(pass.visible[0].start, pass.visible.at(-1)!.end, timeZone)}</Cell>
			<Cell numeric>{formatClockTime(highest.time, timeZone)}</Cell>
			<Cell numeric>{formatDegrees(highest.altitude, 1)}</Cell>
			<Cell numeric>{formatDegrees(pass.start.azimuth, 0)}</Cell>
			<Cell numeric>{formatDegrees(pass.end.azimuth, 0)}</Cell>
		</Row>
	)
}

// Properties of the Tonight view.
interface SatelliteTonightProps {
	// Observing site of the active profile, which every pass is for; absent without one.
	readonly observer?: SiteLocation
	// Zone the times are shown in.
	readonly zone: DisplayZone
	// Favorites of the active profile, by NORAD id.
	readonly favorites: readonly string[]
	// Satellites listed: the favorites or a group of `groups`.
	readonly source: TonightSource
	// Groups that can be listed.
	readonly groups: readonly TonightGroup[]
	// Key of the inputs the passes shown must be for (tonightKey).
	readonly inputKey: string
}

// Tonight view.
export function SatelliteTonight({ observer, zone, favorites, source, groups, inputKey }: SatelliteTonightProps) {
	const { tonightDraft, tonight, tonightLoading, tonightError, tonightSelected } = useSnapshot(artificialSatellitesState)
	const now = useNow(!!tonight, COUNTDOWN_INTERVAL_MS)
	const draft = artificialSatellitesState.tonightDraft
	const timeZone = zone.zone
	const find = () => void loadTonight(artificialSatellitesState, source, favorites, observer, inputKey)
	const selected = tonightSelected === undefined ? undefined : tonight?.passes[tonightSelected]
	const labelOf = (key: TonightSource) => (key ? (groups.find((group) => group.key === key)?.label ?? key) : undefined)
	const shownLabel = tonight && labelOf(tonight.source)
	const noFavorites = !source && favorites.length === 0

	if (!observer) return <EmptyState title="No observing site" description="Tonight's passes are predicted for the observing site of the profile." action={<Button onClick={() => openObservingSites()}>Set Location</Button>} />

	return (
		<div className="flex h-full min-h-0 flex-col overflow-y-auto">
			<form
				onSubmit={(event) => {
					event.preventDefault()
					find()
				}}
				className="flex flex-none flex-wrap items-end gap-2 border-b border-line-100 bg-base-100 px-4 py-3"
			>
				<Select label="List" className="w-56 max-w-full flex-none" options={['', ...groups.map((group) => group.key)]} value={source} format={(key) => labelOf(key) ?? 'Favorites'} onChange={(key) => (artificialSatellitesState.tonightSource = key)} />
				<NumberInput label="Minimum altitude" suffix="°" className="w-36" min={0} max={89} value={tonightDraft.minAltitude} onChange={(value) => (draft.minAltitude = value)} />
				<Select label="Twilight" className="w-52 max-w-full flex-none" options={TWILIGHTS} value={tonightDraft.twilight} format={(value) => TWILIGHT_LABELS[value]} onChange={(value) => (draft.twilight = value)} />
				<Button type="submit" className="ml-auto" disabled={tonightLoading || noFavorites} title={noFavorites ? 'Mark satellites as favorites first, or list a group.' : undefined}>
					Find Passes
				</Button>
			</form>
			{noFavorites && (
				<EmptyState
					title="No favorite satellites"
					description="Search for satellites above and mark them with their star, or list a downloaded group."
					action={groups.length > 0 ? <Button onClick={() => (artificialSatellitesState.tonightSource = groups[0].key)}>{`List ${groups[0].label}`}</Button> : undefined}
				/>
			)}
			{!noFavorites && tonightError && <EmptyState title="Tonight's passes could not be predicted" description={tonightError} action={<Button onClick={find}>Retry</Button>} />}
			{!noFavorites && tonightLoading && <EmptyState title="Predicting tonight's passes" description={source ? labelOf(source) : countText(Math.min(favorites.length, TONIGHT_LIMIT), undefined)} />}
			{!noFavorites && tonight && !tonightLoading && !tonightError && (
				<div className="flex flex-col gap-3 px-4 py-3">
					<div className="text-xs text-ink-300">
						Night of {formatCivilDate(tonight.night.sun.localDate)} · {darkText(tonight, timeZone)} · times {describeDisplayZone(zone)}
					</div>
					{tonight.night.sun[tonight.twilight].state === 'continuousAbove' ? (
						<Notice>The Sun stays above the {TWILIGHT_LABELS[tonight.twilight].toLowerCase()} limit tonight, so no satellite can be seen in a dark sky. Choose a brighter twilight limit.</Notice>
					) : tonight.passes.length === 0 ? (
						<Notice>
							{shownLabel === undefined ? (tonight.predicted === 1 ? 'Your favorite has' : `None of your ${tonight.predicted} favorites has`) : `None of the ${countText(tonight.predicted, shownLabel)} has`} a visible pass tonight above {tonight.minAltitude}°: each pass is in daylight or in the Earth's
							shadow. Lower the minimum altitude, or open a satellite's Passes to search the next days.
						</Notice>
					) : (
						<>
							<div className="text-sm text-ink-100">
								{tonight.passes.length} visible {tonight.passes.length === 1 ? 'pass' : 'passes'} among {countText(tonight.predicted, shownLabel)}
							</div>
							<Table columns={TONIGHT_COLUMNS} className="whitespace-nowrap">
								{tonight.passes.map((entry, index) => (
									<TonightRow key={`${entry.noradId}:${entry.pass.start.time}`} entry={entry} index={index} timeZone={timeZone} now={now} observer={observer} />
								))}
							</Table>
							{selected && (
								<div className="flex flex-wrap gap-2">
									<Button variant="secondary" title="Sets the Sky time to the highest visible point and shows the satellite there." onClick={() => showSatelliteInSky(selected.noradId, selected.name, observer, highestVisiblePoint(selected.pass).time)}>
										View in Sky at the Highest Point
									</Button>
									<Button variant="secondary" title={`Shows the passes of ${selected.name} over more days.`} onClick={() => (artificialSatellitesState.tab = 'passes')}>
										All Passes
									</Button>
								</div>
							)}
						</>
					)}
					{tonight.failures.length > 0 && <Notice error>Not predicted: {tonight.failures.map((failure) => `${failure.name} (${failure.error})`).join('; ')}.</Notice>}
					{tonight.leftOut > 0 && <Notice>{`${countText(tonight.leftOut, shownLabel)} ${tonight.leftOut === 1 ? 'was' : 'were'} left out: tonight predicts the first ${TONIGHT_LIMIT}.`}</Notice>}
					<p className="m-0 max-w-3xl text-xs leading-4 text-pretty text-ink-300">Visible means sunlit while the Sun is below the twilight limit; altitudes are geometric and brightness is unknown, so a faint satellite may not be seen.</p>
				</div>
			)}
		</div>
	)
}
