import { galaxyStore } from '@stores/atlas.galaxy.store'
import { EphemerisAndChart, EphemerisPositionContext } from '@ui/Atlas'
import { Checkbox } from '@ui/components/Checkbox'
import { NumberInput } from '@ui/components/NumberInput'
import { Paginator } from '@ui/components/Paginator'
import { Slider } from '@ui/components/Slider'
import { Table } from '@ui/components/Table'
import { TextInput } from '@ui/components/TextInput'
import { ConstellationSelect } from '@ui/ConstellationSelect'
import { SkyObjectNameTypeDropdown } from '@ui/SkyObjectNameTypeDropdown'
import { StellariumObjectTypeSelect } from '@ui/StellariumObjectTypeSelect'
import type { IDockviewPanelProps } from 'dockview-react'
import { CONSTELLATION_LIST } from 'nebulosa/src/astronomy/coordinates/constellation'
import { memo, useEffect } from 'react'
import { skyObjectName, skyObjectType } from 'src/types/galaxy'
import { useSnapshot } from 'valtio'

export const Galaxy = memo(({ api }: IDockviewPanelProps) => {
	useEffect(galaxyStore.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Filter />
			<Result />
			<Page className="col-span-full w-full" />
			<EphemerisPositionContext value={galaxyStore}>
				<EphemerisAndChart />
			</EphemerisPositionContext>
		</div>
	)
})

const Filter = memo(() => {
	const { nameType, name, rightAscension, declination, magnitudeMin, magnitudeMax, constellations, types, visible, visibleAbove, radius } = useSnapshot(galaxyStore.state.request)
	const { loading, bookmarkedOnly } = useSnapshot(galaxyStore.state)

	return (
		<div className="col-span-full grid grid-cols-subgrid items-center gap-2">
			<TextInput clearable className="col-span-full" onValueChange={galaxyStore.setName} placeholder="Search" startContent={<SkyObjectNameTypeDropdown color="secondary" onValueChange={galaxyStore.setNameType} value={nameType} size="sm" />} value={name} />
			<ConstellationSelect className="col-span-6" onValueChange={galaxyStore.setConstellations} value={constellations} />
			<StellariumObjectTypeSelect className="col-span-6" onValueChange={galaxyStore.setTypes} value={types} />
			<TextInput className="col-span-4" disabled={radius <= 0 || loading} label="RA" onValueChange={galaxyStore.setRightAscension} value={rightAscension} />
			<TextInput className="col-span-4" disabled={radius <= 0 || loading} label="DEC" onValueChange={galaxyStore.setDeclination} value={declination} />
			<NumberInput className="col-span-4" fractionDigits={1} label="Radius (°)" maxValue={360} minValue={0} onValueChange={galaxyStore.setRadius} step={0.1} value={radius} />
			<Slider
				className="col-span-5"
				startContent={magnitudeMin.toFixed(1)}
				endContent={magnitudeMax.toFixed(1)}
				label="Magnitude"
				maxValue={30}
				minValue={-30}
				onValueChange={galaxyStore.setMagnitude}
				step={0.1}
				classNames={{ endContent: 'w-[5ch]', startContent: 'w-[5ch]' }}
				value={[magnitudeMin, magnitudeMax]}
			/>
			<Checkbox className="col-span-2 flex w-full max-w-none justify-center" label="Bookmarked only" onValueChange={galaxyStore.setBookmarkedOnly} value={bookmarkedOnly} />
			<Checkbox className="col-span-2 flex w-full max-w-none justify-center" label="Show visible" onValueChange={galaxyStore.setVisible} value={visible} />
			<NumberInput className="col-span-3" disabled={!visible || loading} label="Above (°)" maxValue={89} minValue={0} onValueChange={galaxyStore.setVisibleAbove} value={visibleAbove} />
		</div>
	)
})

const Result = memo(() => {
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

const Page = memo((props: React.ComponentProps<'div'>) => {
	const { page } = useSnapshot(galaxyStore.state.request)
	const { loading, result } = useSnapshot(galaxyStore.state)

	return <Paginator {...props} count={result.length} loading={loading} onNext={galaxyStore.next} onPrev={galaxyStore.prev} page={page} />
})
