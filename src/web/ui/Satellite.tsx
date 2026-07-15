import { memo, useCallback } from 'react'
import { useSnapshot } from 'valtio'
import { useStore } from '../hooks/store.hook'
import { satelliteStore } from '../stores/atlas.satellite.store'
import { atlasStore } from '../stores/atlas.store'
import { EphemerisAndChart, isBookmarked } from './Atlas'
import { IconButton } from './components/IconButton'
import { Paginator } from './components/Paginator'
import { Table } from './components/Table'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'
import { SatelliteCategoryChipGroup } from './SatelliteCategoryChipGroup'
import { SatelliteGroupTypeChipGroup } from './SatelliteGroupTypeChipGroup'

export const Satellite = memo(() => {
	const { bookmark } = useSnapshot(atlasStore.state)
	const { selected } = useSnapshot(satelliteStore.state)

	useStore(satelliteStore, [])

	const handleFavoriteChange = useCallback(
		(favorite: boolean) => {
			if (selected) atlasStore.toggleBookmark('satellite', selected.name, selected.id.toFixed(0), favorite)
		},
		[selected],
	)

	return (
		<div className="relative grid grid-cols-12 items-center gap-2">
			<SatelliteFilter />
			<SatelliteTable />
			<SatellitePaginator className="col-span-full w-full" />
			<EphemerisAndChart type="satellite" className="col-span-full" isFavorite={selected && isBookmarked(bookmark.items, 'satellite', selected.id.toFixed(0))} name={selected?.name} onFavoriteChange={handleFavoriteChange} />
		</div>
	)
})

const SatelliteFilter = memo(() => {
	const { groups, category } = useSnapshot(satelliteStore.state.request)
	const { text } = useSnapshot(satelliteStore.state.request)
	const { loading } = useSnapshot(satelliteStore.state)

	return (
		<div className="col-span-full grid grid-cols-subgrid items-center gap-2">
			<div className="col-span-full flex flex-row items-center justify-center gap-2">
				<TextInput className="flex-1" label="Search" onValueChange={(value) => satelliteStore.update('text', value)} value={text} />
				<IconButton color="danger" disabled={loading} icon={Icons.Restore} onClick={satelliteStore.resetFilter} tooltipContent="Reset" variant="flat" />
				<IconButton color="primary" disabled={loading} icon={Icons.Search} onClick={satelliteStore.search} tooltipContent="Filter" variant="flat" />
			</div>
			<p className="col-span-full font-bold">CATEGORY</p>
			<SatelliteCategoryChipGroup className="col-span-full" onValueChange={(value) => satelliteStore.update('category', value)} value={category} />
			<p className="col-span-full font-bold">GROUP</p>
			<SatelliteGroupTypeChipGroup category={category} className="col-span-full" onValueChange={(value) => satelliteStore.update('groups', value)} value={groups} />
		</div>
	)
})

const SatelliteTable = memo(() => {
	const { result } = useSnapshot(satelliteStore.state)

	return (
		<Table rowCount={result.length} columnCount={3} className="col-span-full" onAction={satelliteStore.select}>
			<span>ID</span>
			<span>Name</span>
			<span>Group</span>
			{result.map((item) => (
				<>
					<span>{item.id}</span>
					<span>{item.name}</span>
					<span>{item.groups.join(', ')}</span>
				</>
			))}
		</Table>
	)
})

const SatellitePaginator = memo((props: React.ComponentProps<'div'>) => {
	const { page } = useSnapshot(satelliteStore.state.request)
	const { loading, result } = useSnapshot(satelliteStore.state)

	return <Paginator {...props} count={result.length} loading={loading} onNext={satelliteStore.next} onPrev={satelliteStore.prev} page={page} />
})
