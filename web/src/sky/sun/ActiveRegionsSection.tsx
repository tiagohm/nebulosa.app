import type { SolarActiveRegion, SunActiveRegionsResponse } from 'api'
import { cn } from 'cn'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { formatEclipseTime } from '../../tools/eclipse/eclipse'
import { Datum, Note } from '../InspectorParts'
import { sunState } from './sun'

// Active regions of the latest NOAA SWPC report in the Sun Inspector: one row per region with its location, spot
// count, and magnetic class, and the area, McIntosh class, and Carrington longitude of the row chosen. The report is a
// current observation dated by NOAA, whatever instant the Sky shows; a stale or failed report says so, and fields
// NOAA leaves empty are left out.

// Spot count of a region, for people.
function spots(count: number) {
	return count === 1 ? '1 spot' : `${count} spots`
}

// Summary of the report while the section is collapsed.
function reportSummary(report: SunActiveRegionsResponse | undefined, loading: boolean, error: string | undefined) {
	if (!report) return loading ? 'Loading…' : error ? 'Unavailable' : undefined
	const count = report.regions.length
	const regions = count === 0 ? 'No regions' : count === 1 ? '1 region' : `${count} regions`
	return report.observedDate ? `${regions} · ${report.observedDate}` : regions
}

// Row of a region, expanded with its details when chosen.
function RegionRow({ region, selected, onSelect }: { readonly region: SolarActiveRegion; readonly selected: boolean; readonly onSelect: () => void }) {
	return (
		<li className="flex flex-col">
			<button
				type="button"
				onClick={onSelect}
				title={selected ? 'Hide the details' : 'Show the details'}
				className={cn('flex w-full cursor-pointer flex-wrap items-baseline gap-x-3 rounded-sm border-0 bg-transparent px-1.5 py-1 text-left font-mono text-[13px] text-ink-100 hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-accent', selected && 'bg-accent-subtle')}
			>
				<span className="font-semibold">{region.id}</span>
				{region.location && <span>{region.location}</span>}
				{region.spotCount !== undefined && <span className="text-ink-200">{spots(region.spotCount)}</span>}
				{region.magneticClass && <span className="text-ink-200">{region.magneticClass}</span>}
			</button>
			{selected && (
				<div className="flex flex-col gap-1 px-1.5 pt-1 pb-2">
					{region.area !== undefined && <Datum label="Area">{region.area} MSH</Datum>}
					{region.mcintoshClass && <Datum label="McIntosh class">{region.mcintoshClass}</Datum>}
					{region.magneticClass && <Datum label="Magnetic class">{region.magneticClass}</Datum>}
					{region.latitude !== undefined && region.longitude !== undefined && (
						<Datum label="Heliographic">
							{Math.abs(region.latitude)}° {region.latitude < 0 ? 'S' : 'N'}, {Math.abs(region.longitude)}° {region.longitude < 0 ? 'W' : 'E'}
						</Datum>
					)}
					{region.carringtonLongitude !== undefined && <Datum label="Carrington longitude">{region.carringtonLongitude}°</Datum>}
				</div>
			)}
		</li>
	)
}

// Active Regions section of the Sun Inspector.
export function ActiveRegionsSection() {
	const { value: report, loading, error } = useSnapshot(sunState).regions
	const [selected, setSelected] = useState<string>()

	return (
		<CollapsibleSection id="sky.activeRegions" title="Active Regions" summary={reportSummary(report, loading, error)} defaultOpen={false}>
			{report ? (
				<>
					{report.regions.length === 0 ? (
						<p className="m-0 text-ink-300">No active regions reported{report.observedDate && ` on ${report.observedDate}`}.</p>
					) : (
						<ul className="m-0 flex list-none flex-col p-0">
							{report.regions.map((region) => (
								<RegionRow key={region.id} region={region} selected={selected === region.id} onSelect={() => setSelected(selected === region.id ? undefined : region.id)} />
							))}
						</ul>
					)}
					<Note>
						NOAA SWPC solar region report{report.observedDate && ` observed on ${report.observedDate} (UTC)`}, downloaded {formatEclipseTime(report.fetchedAt, 'UTC')}; a current observation, not the Sky instant. Locations are heliographic, east and west of the central meridian. Spots are counted per region,
						which is not the sunspot number. MSH: millionths of the solar hemisphere.
					</Note>
					{report.stale && <Note danger>NOAA cannot be reached: this is the last report downloaded.</Note>}
				</>
			) : (
				!error && <p className="m-0 text-ink-300">{loading ? 'Loading the NOAA report…' : 'No report.'}</p>
			)}
			{error && <Note danger>NOAA report unavailable: {error}</Note>}
		</CollapsibleSection>
	)
}
