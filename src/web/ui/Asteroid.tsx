import { asteroidStore } from '@stores/atlas.asteroid.store'
import { atlasStore } from '@stores/atlas.store'
import { EphemerisAndChart, isBookmarked, type EphemerisAndChartTag } from '@ui/Atlas'
import { IconButton } from '@ui/components/IconButton'
import { Link } from '@ui/components/Link'
import { ListItem, List } from '@ui/components/List'
import { NumberInput } from '@ui/components/NumberInput'
import { Tabs, Tab, TabPanel } from '@ui/components/Tabs'
import { TextInput } from '@ui/components/TextInput'
import { Icons } from '@ui/Icon'
import type { IDockviewPanelProps } from 'dockview-react'
import type { SmallBodySearchListItem } from 'nebulosa/src/adapters/orbits/sbd'
import { formatTemporal } from 'nebulosa/src/astronomy/time/temporal'
import { memo, useMemo, useCallback } from 'react'
import type { MinorPlanetParameter } from 'src/shared/types'
import { useSnapshot } from 'valtio'

export const Asteroid = memo(({ api }: IDockviewPanelProps) => {
	const { bookmark } = useSnapshot(atlasStore.state)
	const { tab, selected } = useSnapshot(asteroidStore.state)

	const tags = useMemo(() => {
		const tags: EphemerisAndChartTag[] = []

		if (selected) {
			if (selected.orbitType) tags.push({ label: selected.orbitType, color: 'success' })
			if (selected.neo) tags.push({ label: 'NEO', color: 'warning' })
			if (selected.pha) tags.push({ label: 'PHA', color: 'danger' })
		}

		return tags
	}, [selected])

	const handleFavoriteChange = useCallback(
		(favorite: boolean) => {
			if (selected) atlasStore.toggleBookmark('asteroid', selected.name, selected.id, favorite)
		},
		[selected],
	)

	return (
		<div className="grid grid-cols-12 items-center gap-2">
			<div className="col-span-full flex flex-col gap-2">
				<Tabs onValueChange={(value) => (asteroidStore.state.tab = value as never)} value={tab}>
					<Tab id="search"> Search</Tab>
					<Tab id="closeApproaches">Close Approaches</Tab>
					<TabPanel id="search">
						<AsteroidSearchTab />
					</TabPanel>
					<TabPanel id="closeApproaches">
						<AsteroidCloseApproachesTab />
					</TabPanel>
				</Tabs>
			</div>
			<EphemerisAndChart type="asteroid" className="col-span-full" isFavorite={selected && isBookmarked(bookmark.items, 'asteroid', selected.id)} name={selected?.name} onFavoriteChange={handleFavoriteChange} tags={tags} />
		</div>
	)
})

function AsteroidSearchListItem(item: SmallBodySearchListItem, onClick: React.UIEventHandler) {
	return <ListItem description={item.pdes} label={item.name} data-pdes={item.pdes} onClick={onClick} />
}

function AsteroidSearchParameterItem(parameter: MinorPlanetParameter) {
	return (
		<ListItem description={parameter.description}>
			<span className="flex items-center justify-between">
				<span>{parameter.name}</span>
				<span>{parameter.value}</span>
			</span>
		</ListItem>
	)
}

const AsteroidSearchTab = memo(() => {
	const { loading, selected, list } = useSnapshot(asteroidStore.state)
	const { text } = useSnapshot(asteroidStore.state.search)

	function handlePointer(event: React.PointerEvent<HTMLElement>) {
		const pdes = event.currentTarget.dataset.pdes!
		return asteroidStore.select(pdes)
	}

	return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex w-full flex-row items-center justify-center gap-2">
				<TextInput className="flex-1" disabled={loading} label="Search" onValueChange={asteroidStore.updateSearch} placeholder="Enter the IAU number, designation, name or SPK ID" value={text} />
				<IconButton color="primary" disabled={loading || !text} icon={Icons.Search} onClick={asteroidStore.search} variant="ghost" />
			</div>
			{list ? (
				<List fullWidth itemCount={list.length}>
					{(i) => AsteroidSearchListItem(list[i], handlePointer)}
				</List>
			) : selected?.parameters ? (
				<List fullWidth itemCount={selected.parameters.length}>
					{(i) => AsteroidSearchParameterItem(selected.parameters![i])}
				</List>
			) : null}
			<Link href="https://ssd-api.jpl.nasa.gov/doc/sbdb.html" label="NASA/JPL Small-Body Database (SBDB) API" />
		</div>
	)
})

const AsteroidCloseApproachesTab = memo(() => {
	const { loading } = useSnapshot(asteroidStore.state)
	const { days, distance } = useSnapshot(asteroidStore.state.closeApproaches.request)
	const { result } = useSnapshot(asteroidStore.state.closeApproaches)
	const { offset } = useSnapshot(asteroidStore.state.request.time)

	function handleAction(index: number) {
		const item = result[index]
		asteroidStore.state.search.text = item.name
		asteroidStore.state.tab = 'search'
		void asteroidStore.search()
	}

	return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex w-full flex-row items-center justify-center gap-2">
				<NumberInput className="flex-1" disabled={loading} label="Days" maxValue={30} minValue={1} onValueChange={(value) => asteroidStore.updateCloseApproaches('days', value)} value={days} />
				<NumberInput className="flex-1" disabled={loading} fractionDigits={1} label="Distance (LD)" maxValue={100} minValue={0.1} onValueChange={(value) => asteroidStore.updateCloseApproaches('distance', value)} step={0.1} value={distance} />
				<IconButton color="primary" disabled={loading} icon={Icons.Search} onClick={asteroidStore.closeApproaches} variant="ghost" />
			</div>
			<List itemCount={result.length} fullWidth onAction={handleAction}>
				{(i) => {
					const item = result[i]

					return (
						<ListItem className="cursor-pointer" description={`${item.distance.toFixed(3)} LD`}>
							<span className="flex items-center justify-between">
								<span>{item.name}</span>
								<span>{formatTemporal(item.date, 'YYYY-MM-DD HH:mm', offset)}</span>
							</span>
						</ListItem>
					)
				}}
			</List>
			<Link href="https://ssd-api.jpl.nasa.gov/doc/cad.html" label="NASA/JPL SBDB Close Approach Data API" />
		</div>
	)
})
