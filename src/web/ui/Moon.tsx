import { formatDistance } from '@shared/util'
import { moonStore } from '@stores/atlas.moon.store'
import { AstronomicalEvent, EphemerisAndChart, EphemerisPositionContext } from '@ui/Atlas'
import { Icons } from '@ui/Icon'
import { MoonImage } from '@ui/MoonImage'
import type { IDockviewPanelProps } from 'dockview-react'
import type { LunarPhase } from 'nebulosa/src/astronomy/bodies/moon'
import { temporalFromTime } from 'nebulosa/src/astronomy/time/temporal'
import { memo, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const Moon = memo(({ api }: IDockviewPanelProps) => {
	useEffect(moonStore.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<div className="relative col-span-full flex items-center justify-center gap-2">
				<div className="flex flex-col gap-0">
					<LunarEclipses />
					<LunarApsis />
				</div>
				<MoonImage />
				<MoonPhases />
			</div>
			<EphemerisPositionContext value={moonStore}>
				<EphemerisAndChart />
			</EphemerisPositionContext>
		</div>
	)
})

function mapLunarPhase(phase: LunarPhase, time: number) {
	if (phase === 'NEW') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonNew} key={time} label="NEW MOON" time={time} />
	if (phase === 'FIRST_QUARTER') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonFirstQuarter} key={time} label="FIRST QUARTER" time={time} />
	if (phase === 'FULL') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonFull} key={time} label="FULL MOON" time={time} />
	if (phase === 'LAST_QUARTER') return <AstronomicalEvent format="DD HH:mm" icon={Icons.MoonLastQuarter} key={time} label="LAST QUARTER" time={time} />
	return null
}

const MoonPhases = memo(() => {
	const { phases } = useSnapshot(moonStore.state)

	return <div className="flex flex-col gap-0 text-xs">{phases.map(([phase, time]) => mapLunarPhase(phase, time))}</div>
})

const LunarEclipses = memo(() => {
	const { eclipses } = useSnapshot(moonStore.state)

	if (eclipses.length === 0) return null

	const next = eclipses[0]

	return (
		<div className="flex flex-col gap-0 text-xs">
			<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Moon} key={next.maximalTime.day} label={next.type} time={temporalFromTime(next.maximalTime)} onClick={moonStore.showLunarEclipse} />
		</div>
	)
})

const LunarApsis = memo(() => {
	const { apsis } = useSnapshot(moonStore.state)

	return (
		<div className="flex flex-col gap-0 text-xs">
			<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Moon} label={`APOGEE (${formatDistance(apsis[0].distance)})`} time={temporalFromTime(apsis[0].time)} />
			<AstronomicalEvent format="YYYY-MM-DD HH:mm" icon={Icons.Moon} label={`PERIGEE (${formatDistance(apsis[1].distance)})`} time={temporalFromTime(apsis[1].time)} />
		</div>
	)
})
