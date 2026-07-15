import type { IDockviewPanelProps } from 'dockview-react'
import { temporalFromTime } from 'nebulosa/src/astronomy/time/temporal'
import { memo, useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { atlasStore } from '../stores/atlas.store'
import { sunStore } from '../stores/atlas.sun.store'
import { solarEclipseStore } from '../stores/solar.eclipse.store'
import { AstronomicalEvent, EphemerisAndChart } from './Atlas'
import { Icons } from './Icon'
import { SunImage } from './SunImage'

export const Sun = memo(({ api }: IDockviewPanelProps) => {
	const { source } = useSnapshot(sunStore.state)

	useEffect(() => void atlasStore.tick('sun'), [])

	return (
		<div className="grid grid-cols-12 items-center gap-2">
			<div className="relative col-span-full flex items-center justify-center">
				<NextSolarEclipse />
				<SunImage onSourceChange={(source) => (sunStore.state.source = source)} source={source} />
				<Seasons />
			</div>
			<EphemerisAndChart type="sun" className="col-span-full" name="Sun" />
		</div>
	)
})

const NextSolarEclipse = memo(() => {
	const { eclipses } = useSnapshot(sunStore.state)
	const { offset } = useSnapshot(sunStore.state.request.time)

	if (eclipses.length === 0) return null

	const next = eclipses[0]

	return (
		<div className="flex h-full flex-col justify-center gap-0 text-sm">
			<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Sun} key={next.maximalTime.day} label={next.type} offset={offset} time={temporalFromTime(next.maximalTime)} onClick={() => solarEclipseStore.load(next)} />
		</div>
	)
})

const Seasons = memo(() => {
	const { offset } = useSnapshot(sunStore.state.request.time)
	const { summer, spring, autumn, winter } = useSnapshot(sunStore.state.seasons)
	const { latitude } = useSnapshot(sunStore.state.request.location)
	const isSouthern = latitude < 0

	return (
		<div className="flex h-full flex-col justify-center gap-0 text-sm">
			<AstronomicalEvent format="MM-DD HH:mm" icon={isSouthern ? Icons.Leaf : Icons.Flower} label={isSouthern ? 'AUTUMN/FALL' : 'SPRING'} offset={offset} time={spring} />
			<AstronomicalEvent format="MM-DD HH:mm" icon={isSouthern ? Icons.SnowFlake : Icons.Sun} label={isSouthern ? 'WINTER' : 'SUMMER'} offset={offset} time={summer} />
			<AstronomicalEvent format="MM-DD HH:mm" icon={isSouthern ? Icons.Flower : Icons.Leaf} label={isSouthern ? 'SPRING' : 'AUTUMN/FALL'} offset={offset} time={autumn} />
			<AstronomicalEvent format="MM-DD HH:mm" icon={isSouthern ? Icons.Sun : Icons.SnowFlake} label={isSouthern ? 'SUMMER' : 'WINTER'} offset={offset} time={winter} />
		</div>
	)
})
