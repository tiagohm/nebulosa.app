import type { MeridianFlipMonitor, MeridianMechanicalAssessment, MeridianMonitorReason } from 'api'
import { cn } from 'cn'
import { formatClockTime, formatLocalTime } from '../../format'
import { useActiveTimeZone } from '../../location/useLocation'
import { Notice } from '../../ui/Notice'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { formatFromNow, formatTransitOffset, MERIDIAN_AVAILABILITY_LABELS, meridianPhaseText, nextMeridianEvent, secondsToTransit } from './meridianflip'

// Passage readout of the Meridian Flip tool, shown above both of its sections: where the target the monitor follows
// stands, read from the monitor alone. The time to or since the upper transit in large figures (or the state of the
// monitor when it has no forecast), the phase and the next instant of the forecast, whether the pier side the driver
// reports still needs a flip, and the timeline of the preferred window. The countdowns are only interpolated between the
// samples of the server, which takes every decision.

// Text of each mechanical assessment, and its tone.
const MECHANICAL: Readonly<Record<MeridianMechanicalAssessment, readonly [string, StatusTone]>> = {
	unsupportedMountType: ['No flip for this mount type', 'muted'],
	unknown: ['Pier side unknown', 'muted'],
	notDue: ['Flip not due yet', 'neutral'],
	alreadyOnExpectedSide: ['Already on the expected side', 'success'],
	flipCandidate: ['Flip may be needed', 'warning'],
	verificationPending: ['Waiting for the mount to settle', 'neutral'],
}

// Explanation of each reason.
const REASONS: Readonly<Record<MeridianMonitorReason, string>> = {
	disconnected: 'The mount is disconnected; the target is forgotten until it reconnects.',
	noCoordinates: 'The mount has not reported its position.',
	noSite: 'The mount has not reported its site.',
	moving: 'The mount is moving; the previous target is no longer assumed.',
	parked: 'The mount is parked.',
	notTracking: 'The mount is not tracking, so it observes no fixed target; the hour angle is geometry only.',
	settling: 'The mount must hold its position for the settle time before it is a target.',
	altazimuthMount: 'An altazimuth mount needs no meridian flip; only the timing is shown.',
	forkMount: 'A fork mount needs no German equatorial flip; only the timing is shown.',
	unknownMountType: 'The driver has not reported the mount type.',
	noPierSide: 'The driver reports no pier side, so a flip cannot be assessed.',
	nearPole: 'The target is at the pole, where the pier side is undefined.',
	nonSiderealTracking: 'The mount does not track at the sidereal rate; the forecast is approximate.',
}

// Fill of each part of the timeline: the stretches of the bar and the marks of the transit and of now. The approach is
// neutral, since nothing is due during it; only the window and its closing are tinted.
const TIMELINE = {
	outside: 'bg-base-200',
	approach: 'bg-line-200',
	window: 'bg-warning/60',
	closing: 'bg-danger/60',
	transit: 'w-px bg-ink-200',
	now: 'w-1 rounded-full bg-ink-100',
} as const

// Legend of the stretches and the transit mark of the timeline; now and the instants are labeled on the bar itself.
const TIMELINE_LEGEND: readonly { readonly mark: string; readonly label: string }[] = [
	{ mark: cn('h-2 w-4 rounded-sm', TIMELINE.approach), label: 'Approach' },
	{ mark: cn('h-2 w-4 rounded-sm', TIMELINE.window), label: 'Preferred window' },
	{ mark: cn('h-2 w-4 rounded-sm', TIMELINE.closing), label: 'Window closing' },
	{ mark: cn('h-3', TIMELINE.transit), label: 'Upper transit' },
]

// Where the tracked target stands at instant now (Unix milliseconds): the time to or since the transit in large figures
// (or the state of the monitor when it has no forecast), the phase and the next instant of the forecast, whether a flip
// may be needed, and the timeline; the one reading of the tool meant to be read from across the room.
export function MeridianFlipReadout({ monitor, now }: { readonly monitor?: MeridianFlipMonitor; readonly now: number }) {
	const timeZone = useActiveTimeZone()

	if (!monitor) {
		return (
			<section className="flex flex-col gap-1">
				<p className="m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-300">Not monitoring</p>
				<p className="m-0 text-sm leading-5 text-ink-200">Enable the monitor to follow the target the mount tracks. It runs on the server, so it keeps going when this tab closes.</p>
			</section>
		)
	}

	const seconds = secondsToTransit(monitor, now)
	const stale = monitor.timing.secondsToTransit !== undefined && seconds === undefined
	const forecast = monitor.availability === 'monitoring' && seconds !== undefined
	const next = forecast ? nextMeridianEvent(monitor.timing, now) : undefined
	const [mechanical, mechanicalTone] = MECHANICAL[monitor.mechanical]
	const tone = monitor.mechanical === 'flipCandidate' && monitor.timing.phase === 'pastDeadline' ? 'danger' : mechanicalTone
	const headline = forecast ? formatTransitOffset(seconds) : stale ? 'Stale' : MERIDIAN_AVAILABILITY_LABELS[monitor.availability]
	const phase = stale ? `The last sample, at ${formatClockTime(monitor.sampledAt, timeZone, { seconds: true })}, is too old to count down from.` : meridianPhaseText(monitor, now)

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
				<div className="flex min-w-0 flex-col gap-1">
					<p className={cn('m-0 text-3xl leading-9 font-semibold tracking-[-0.01em] tabular-nums', forecast ? 'text-ink-100' : 'text-ink-200')}>{headline}</p>
					<p className="m-0 text-sm leading-5 text-ink-200 tabular-nums">
						{phase}
						{next && (
							<span className="text-ink-300">
								{' · '}
								{next.label} {formatFromNow(next.at, now)}, at {formatLocalTime(next.at, timeZone, now)}
							</span>
						)}
					</p>
				</div>
				<StatusBadge tone={tone} label={mechanical} title={monitor.reason ? REASONS[monitor.reason] : undefined} />
			</div>
			{forecast && <Timeline monitor={monitor} now={now} />}
			{monitor.reason && <Notice>{REASONS[monitor.reason]}</Notice>}
		</section>
	)
}

// Timeline from the early warning to the closing of the window, with the transit and now marked on it, at instant now
// (Unix milliseconds); now off the scale is said rather than pinned to an edge.
function Timeline({ monitor, now }: { readonly monitor: MeridianFlipMonitor; readonly now: number }) {
	const timeZone = useActiveTimeZone()
	const { warningAt, transitAt, windowOpensAt, deadlineWarningAt, windowClosesAt } = monitor.timing

	if (warningAt === undefined || transitAt === undefined || windowOpensAt === undefined || deadlineWarningAt === undefined || windowClosesAt === undefined) return null

	const span = Math.max(windowClosesAt - warningAt, 60000)
	const start = warningAt - span * 0.1
	const end = windowClosesAt + span * 0.1
	const fraction = (time: number) => (time - start) / (end - start)
	const position = (time: number) => `${(Math.min(Math.max(fraction(time), 0), 1) * 100).toFixed(2)}%`
	const width = (from: number, to: number) => `${((Math.max(to - from, 0) / (end - start)) * 100).toFixed(2)}%`
	const inside = fraction(now) >= 0 && fraction(now) <= 1

	return (
		<div className="flex flex-col gap-2">
			<div className="relative mx-3 h-10">
				{inside && (
					<span className="absolute top-0 -translate-x-1/2 text-xs leading-4 text-ink-100" style={{ left: position(now) }}>
						Now
					</span>
				)}
				<div className={cn('absolute inset-x-0 top-5 h-2 rounded-full', TIMELINE.outside)} />
				<div className={cn('absolute top-5 h-2 border-r border-base-000', TIMELINE.approach)} style={{ left: position(warningAt), width: width(warningAt, windowOpensAt) }} />
				<div className={cn('absolute top-5 h-2 border-r border-base-000', TIMELINE.window)} style={{ left: position(windowOpensAt), width: width(windowOpensAt, deadlineWarningAt) }} />
				<div className={cn('absolute top-5 h-2', TIMELINE.closing)} style={{ left: position(deadlineWarningAt), width: width(deadlineWarningAt, windowClosesAt) }} />
				<div className={cn('absolute top-4 h-4', TIMELINE.transit)} style={{ left: position(transitAt) }} />
				{inside && <div className={cn('absolute top-4 h-4 -translate-x-1/2', TIMELINE.now)} style={{ left: position(now) }} />}
			</div>
			<div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs leading-4 text-ink-300 tabular-nums">
				<span>Warning {formatLocalTime(warningAt, timeZone, now)}</span>
				<span>Transit {formatLocalTime(transitAt, timeZone, now)}</span>
				<span>Opens {formatLocalTime(windowOpensAt, timeZone, now)}</span>
				<span>Closes {formatLocalTime(windowClosesAt, timeZone, now)}</span>
			</div>
			{!inside && <Notice>{now < start ? 'Now is before the timeline, which starts shortly before the early warning.' : 'Now is past the end of the timeline: the window closed.'}</Notice>}
			<ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs leading-4 text-ink-300">
				{TIMELINE_LEGEND.map(({ mark, label }) => (
					<li key={label} className="flex items-center gap-1.5">
						<span className={cn('flex-none', mark)} />
						{label}
					</li>
				))}
			</ul>
		</div>
	)
}
