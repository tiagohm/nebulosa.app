import { useStore } from '@hooks/store.hook'
import { skyObjectName, skyObjectType } from '@shared/util'
import { galaxyStore } from '@stores/atlas.galaxy.store'
import { atlasStore } from '@stores/atlas.store'
import { Checkbox } from '@ui/components/Checkbox'
import { IconButton } from '@ui/components/IconButton'
import { NumberInput } from '@ui/components/NumberInput'
import { Paginator } from '@ui/components/Paginator'
import { Slider } from '@ui/components/Slider'
import { Table } from '@ui/components/Table'
import { TextInput } from '@ui/components/TextInput'
import { ConstellationSelect } from '@ui/ConstellationSelect'
import { Icons } from '@ui/Icon'
import { SkyObjectNameTypeDropdown } from '@ui/SkyObjectNameTypeDropdown'
import { StellariumObjectTypeSelect } from '@ui/StellariumObjectTypeSelect'
import type { IDockviewPanelProps } from 'dockview-react'
import { CONSTELLATION_LIST } from 'nebulosa/src/astronomy/coordinates/constellation'
import { memo, useCallback } from 'react'
import { useSnapshot } from 'valtio'

export const Galaxy = memo(({ api }: IDockviewPanelProps) => {
	const { bookmark } = useSnapshot(atlasStore.state)
	const { selected } = useSnapshot(galaxyStore.state)
	const { names, constellation } = useSnapshot(galaxyStore.state.position)

	useStore(galaxyStore, [])

	const handleFavoriteChange = useCallback(
		(favorite: boolean) => {
			if (!selected) return
			const name = names?.length ? skyObjectName(names[0], constellation) : skyObjectName(selected.name, selected.constellation)
			atlasStore.toggleBookmark('galaxy', name, selected.id.toFixed(0), favorite)
		},
		[constellation, names, selected],
	)

	return (
		<div className="grid grid-cols-12 items-center gap-2">
			<GalaxyFilter />
			<GalaxyTable />
			<GalaxyPaginator className="col-span-full w-full" />
			{/* <EphemerisAndChart type="galaxy" className="col-span-full" isFavorite={selected && isBookmarked(bookmark.items, 'galaxy', selected.id.toFixed(0))} onFavoriteChange={handleFavoriteChange} /> */}
		</div>
	)
})

const GalaxyFilter = memo(() => {
	const { nameType, magnitudeMin, magnitudeMax, constellations, types, visible, visibleAbove, radius } = useSnapshot(galaxyStore.state.request)
	const { name, rightAscension, declination } = useSnapshot(galaxyStore.state.request)
	const { loading } = useSnapshot(galaxyStore.state)

	return (
		<div className="col-span-full grid grid-cols-subgrid items-center gap-2">
			<div className="col-span-full flex flex-row items-center justify-center gap-2">
				<TextInput className="flex-1" onValueChange={(value) => galaxyStore.update('name', value)} placeholder="Search" startContent={<SkyObjectNameTypeDropdown color="secondary" onValueChange={(value) => galaxyStore.update('nameType', value)} value={nameType} size="sm" />} value={name} />
				<IconButton color="primary" disabled={loading} icon={Icons.Search} onClick={galaxyStore.search} tooltipContent="Filter" variant="flat" />
			</div>
			<ConstellationSelect className="col-span-6" onValueChange={(value) => galaxyStore.update('constellations', value)} value={constellations} />
			<StellariumObjectTypeSelect className="col-span-6" onValueChange={(value) => galaxyStore.update('types', value)} value={types} />
			<TextInput className="col-span-4" disabled={radius <= 0 || loading} label="RA" onValueChange={(value) => galaxyStore.update('rightAscension', value)} value={rightAscension} />
			<TextInput className="col-span-4" disabled={radius <= 0 || loading} label="DEC" onValueChange={(value) => galaxyStore.update('declination', value)} value={declination} />
			<NumberInput className="col-span-4" fractionDigits={1} label="Radius (°)" maxValue={360} minValue={0} onValueChange={(value) => galaxyStore.update('radius', value)} step={0.1} value={radius} />
			<Slider
				className="col-span-5"
				startContent={magnitudeMin.toFixed(1)}
				endContent={magnitudeMax.toFixed(1)}
				label="Magnitude"
				maxValue={30}
				minValue={-30}
				onValueChange={galaxyStore.updateMagnitude}
				step={0.1}
				classNames={{ endContent: 'w-[5ch]', startContent: 'w-[5ch]' }}
				value={[magnitudeMin, magnitudeMax]}
			/>
			<Checkbox className="col-span-4 flex w-full max-w-none justify-center" label="Show visible" onValueChange={(value) => galaxyStore.update('visible', value)} value={visible} />
			<NumberInput className="col-span-3" disabled={!visible || loading} label="Above (°)" maxValue={89} minValue={0} onValueChange={(value) => galaxyStore.update('visibleAbove', value)} value={visibleAbove} />
		</div>
	)
})

const GalaxyTable = memo(() => {
	const { result } = useSnapshot(galaxyStore.state)

	return (
		<Table rowCount={result.length} columnCount={4} className="col-span-full" onAction={galaxyStore.select}>
			<span>Name</span>
			<span>Mag.</span>
			<span>Type</span>
			<span>Const.</span>
			{result.map((item) => (
				<>
					<span>{skyObjectName(item.name, item.constellation)}</span>
					<span>{item.magnitude}</span>
					<span>{skyObjectType(item.type)}</span>
					<span>{CONSTELLATION_LIST[item.constellation]}</span>
				</>
			))}
		</Table>
	)
})

const GalaxyPaginator = memo((props: React.ComponentProps<'div'>) => {
	const { page } = useSnapshot(galaxyStore.state.request)
	const { loading, result } = useSnapshot(galaxyStore.state)

	return <Paginator {...props} count={result.length} loading={loading} onNext={galaxyStore.next} onPrev={galaxyStore.prev} page={page} />
})
