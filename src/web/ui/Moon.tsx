import { formatDistance } from '@shared/util'
import { moonStore } from '@stores/atlas.moon.store'
import { lunarEclipseStore } from '@stores/lunar.eclipse.store'
import { AstronomicalEvent } from '@ui/Atlas'
import { Icons } from '@ui/Icon'
import { MoonImage } from '@ui/MoonImage'
import type { IDockviewPanelProps } from 'dockview-react'
import type { LunarPhase } from 'nebulosa/src/astronomy/bodies/moon'
import { temporalFromTime } from 'nebulosa/src/astronomy/time/temporal'
import { memo } from 'react'
import { useSnapshot } from 'valtio'

export const Moon = memo(({ api }: IDockviewPanelProps) => (
	<div className="grid grid-cols-12 items-center gap-2">
		<div className="relative col-span-full flex items-center justify-center">
			<div className="p-0 text-sm">
				<LunarEclipses />
				<LunarApsis />
			</div>
			<MoonImage />
			<div className="p-0 text-sm">
				<MoonPhases />
			</div>
		</div>
		{/* <EphemerisAndChart type="moon" className="col-span-full" name="Moon" /> */}
	</div>
))

function mapLunarPhase(phase: LunarPhase, time: number, offset: number) {
	if (phase === 'NEW') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonNew} key={time} label="NEW MOON" offset={offset} time={time} />
	if (phase === 'FIRST_QUARTER') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonFirstQuarter} key={time} label="FIRST QUARTER" offset={offset} time={time} />
	if (phase === 'FULL') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonFull} key={time} label="FULL MOON" offset={offset} time={time} />
	if (phase === 'LAST_QUARTER') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonLastQuarter} key={time} label="LAST QUARTER" offset={offset} time={time} />
	return null
}

const MoonPhases = memo(() => {
	const { phases } = useSnapshot(moonStore.state)
	const { offset } = useSnapshot(moonStore.state.request.time)

	return <div className="flex flex-col gap-0">{phases.map(([phase, time]) => mapLunarPhase(phase, time, offset))}</div>
})

const LunarEclipses = memo(() => {
	const { eclipses } = useSnapshot(moonStore.state)
	const { offset } = useSnapshot(moonStore.state.request.time)

	if (eclipses.length === 0) return null

	const next = eclipses[0]

	return (
		<div className="flex flex-col gap-0">
			<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Moon} key={next.maximalTime.day} label={next.type} offset={offset} time={temporalFromTime(next.maximalTime)} onClick={() => lunarEclipseStore.load(next)} />
		</div>
	)
})

const LunarApsis = memo(() => {
	const { apsis } = useSnapshot(moonStore.state)
	const { offset } = useSnapshot(moonStore.state.request.time)

	return (
		<div className="flex flex-col gap-0">
			<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Moon} label={`APOGEE (${formatDistance(apsis[0].distance)})`} offset={offset} time={temporalFromTime(apsis[0].time)} />
			<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Moon} label={`PERIGEE (${formatDistance(apsis[1].distance)})`} offset={offset} time={temporalFromTime(apsis[1].time)} />
		</div>
	)
})
