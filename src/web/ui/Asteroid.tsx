import { asteroidStore } from '@stores/atlas.asteroid.store'
import { EphemerisAndChart, EphemerisPositionContext } from '@ui/Atlas'
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
import { memo, useEffect } from 'react'
import type { MinorPlanetParameter } from 'src/types/asteroid'
import { useSnapshot } from 'valtio'

export const Asteroid = memo(({ api }: IDockviewPanelProps) => {
	useEffect(asteroidStore.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<SearchAndCloseApproaches />
			<EphemerisPositionContext value={asteroidStore}>
				<EphemerisAndChart />
			</EphemerisPositionContext>
		</div>
	)
})

function SearchAndCloseApproaches() {
	const { tab } = useSnapshot(asteroidStore.state)

	return (
		<div className="col-span-full flex flex-col gap-2">
			<Tabs onValueChange={(value) => (asteroidStore.state.tab = value)} value={tab}>
				<Tab id="search"> Search</Tab>
				<Tab id="closeApproaches">Close Approaches</Tab>
				<Tab id="bookmarked">Bookmark</Tab>
				<TabPanel id="search">
					<Search />
				</TabPanel>
				<TabPanel id="closeApproaches">
					<CloseApproaches />
				</TabPanel>
				<TabPanel id="bookmarked">
					<Bookmarked />
				</TabPanel>
			</Tabs>
		</div>
	)
}

const Search = memo(() => {
	const { loading, selected, list } = useSnapshot(asteroidStore.state)
	const { text } = useSnapshot(asteroidStore.state.search)

	function handleSearchItemClick(event: React.MouseEvent<HTMLElement>) {
		const pdes = event.currentTarget.dataset.pdes!
		return asteroidStore.select(pdes)
	}

	return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex w-full flex-row items-center justify-center gap-2">
				<TextInput className="flex-1" disabled={loading} label="Search" onValueChange={asteroidStore.setSearch} placeholder="Enter the IAU number, designation, name or SPK ID" value={text} />
				<IconButton color="primary" disabled={loading || !text} icon={Icons.Search} onClick={asteroidStore.search} variant="ghost" />
			</div>
			{list ? (
				<List fullWidth itemCount={list.length} className="max-h-100">
					{(i) => AsteroidSearchListItem(list[i], handleSearchItemClick)}
				</List>
			) : selected?.parameters ? (
				<List fullWidth itemCount={selected.parameters.length} className="max-h-100">
					{(i) => AsteroidSearchParameterItem(selected.parameters![i])}
				</List>
			) : null}
			<Link href="https://ssd-api.jpl.nasa.gov/doc/sbdb.html" label="NASA/JPL Small-Body Database (SBDB) API" />
		</div>
	)
})

function AsteroidSearchListItem(item: SmallBodySearchListItem, onClick: React.UIEventHandler) {
	return <ListItem description={item.pdes} label={item.name} data-pdes={item.pdes} onClick={onClick} />
}

function AsteroidSearchParameterItem(parameter: MinorPlanetParameter) {
	return (
		<ListItem description={parameter.description}>
			<div className="flex items-center justify-between">
				<span>{parameter.name}</span>
				<span>{parameter.value}</span>
			</div>
		</ListItem>
	)
}

const CloseApproaches = memo(() => {
	const { loading } = useSnapshot(asteroidStore.state)
	const { days, distance } = useSnapshot(asteroidStore.state.closeApproaches.request)
	const { result } = useSnapshot(asteroidStore.state.closeApproaches)

	function handleAction(index: number) {
		const item = result[index]
		asteroidStore.state.search.text = item.name
		asteroidStore.state.tab = 'search'
		void asteroidStore.search()
	}

	return (
		<div className="flex w-full flex-col gap-2">
			<div className="flex w-full flex-row items-center justify-center gap-2">
				<NumberInput className="flex-1" disabled={loading} label="Days" maxValue={30} minValue={1} onValueChange={asteroidStore.setCloseApproachesDays} value={days} />
				<NumberInput className="flex-1" disabled={loading} fractionDigits={1} label="Distance (LD)" maxValue={100} minValue={0.1} onValueChange={asteroidStore.setCloseApproachesDistance} step={0.1} value={distance} />
				<IconButton color="primary" disabled={loading} icon={Icons.Search} onClick={asteroidStore.findCloseApproaches} variant="ghost" />
			</div>
			<List itemCount={result.length} fullWidth onAction={handleAction}>
				{(i) => {
					const { distance, name, date } = result[i]

					return (
						<ListItem className="cursor-pointer" description={`${distance.toFixed(3)} LD`}>
							<span className="flex items-center justify-between">
								<span>{name}</span>
								<span>{formatTemporal(date, 'YYYY-MM-DD HH:mm')}</span>
							</span>
						</ListItem>
					)
				}}
			</List>
			<Link href="https://ssd-api.jpl.nasa.gov/doc/cad.html" label="NASA/JPL SBDB Close Approach Data API" />
		</div>
	)
})

const Bookmarked = memo(() => {
	const { bookmark } = useSnapshot(asteroidStore.state)

	function handleAction(index: number) {
		return asteroidStore.select(bookmark[index].code)
	}

	return (
		<List itemCount={bookmark.length} fullWidth onAction={handleAction} emptyContent="No items">
			{(i) => {
				const { name, code } = bookmark[i]

				return <ListItem className="cursor-pointer" description={code} label={name} />
			}}
		</List>
	)
})
