import type { MeridianFlipMonitor } from 'api'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { captureRuntime } from '../../camera/capture'
import type { RoleDevice } from '../../equipment/useEquipment'
import { formatClockDuration, formatLocalTime } from '../../format'
import { useActiveTimeZone } from '../../location/useLocation'
import { Button } from '../../ui/Button'
import { ConfirmButton } from '../../ui/ConfirmButton'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { useNow } from '../../useNow'
import { formatFromNow, monitorKey } from './meridianflip'
import { cancelMeridianFlip, capturePausedBy, disarmMeridianFlip, latestExecution, meridianFlipExecutionHeadline, meridianFlipExecutorState, resumePausedCapture } from './meridianflipexecutor'

// Flip strip of the Meridian Flip tool, shown above both of its sections: the flip of the MOUNT of the Equipment Setup
// that runs, is armed or scheduled, or left the capture paused, with the one command each of those asks for (Stop Flip,
// Disarm, or Resume Capture), so it can be answered from either section. Every command is the server's to carry out.

// Live flip of the mount of the Equipment Setup, shown above both sections of the tool while one runs, is armed or
// scheduled, or left the capture paused, with the one command each of those asks for; nothing otherwise.
export function MeridianFlipStrip({ mount, monitor }: { readonly mount: RoleDevice; readonly monitor?: MeridianFlipMonitor }) {
	const timeZone = useActiveTimeZone()
	const state = useSnapshot(meridianFlipExecutorState)
	const captures = useSnapshot(captureRuntime)
	const device = mount.device
	const execution = device ? latestExecution(state, device.connectionId, device.id) : undefined
	const key = device ? monitorKey(device.connectionId, device.id) : undefined
	const arm = key ? state.arms[key] : undefined
	const pending = key ? !!state.pending[key] : false
	const running = execution?.state === 'running'
	const paused = capturePausedBy(execution, captures.sessions)
	const now = useNow(running || arm !== undefined)

	if (!device) return null

	let badge: readonly [string, StatusTone]
	let text: string
	let action: ReactNode

	if (running) {
		const [headline] = meridianFlipExecutionHeadline(execution)
		badge = ['Flipping', 'active']
		text = `Step ${execution.steps.length}: ${headline} · started ${formatLocalTime(execution.startedAt, timeZone, now)}, ${formatClockDuration((now - execution.startedAt) / 1000)} elapsed`
		action = (
			<ConfirmButton
				title="Stop the meridian flip?"
				message={`The flip of ${execution.mountName} ends at its current step, and the operations it runs are cancelled. If the mount already moved across the meridian, the capture stays paused and guiding suspended for you; if it has not, imaging goes on as before.`}
				confirmLabel="Stop Flip"
				destructive
				disabled={pending}
				tooltip={pending ? 'Waiting for the server to answer the last request.' : undefined}
				onConfirm={() => void cancelMeridianFlip(meridianFlipExecutorState, execution)}
			>
				Stop Flip
			</ConfirmButton>
		)
	} else if (arm) {
		const opensAt = monitor?.timing.windowOpensAt
		badge = ['Scheduled', 'neutral']
		text = arm.decision.decision === 'refuse' ? `${arm.decision.reason}.` : opensAt !== undefined && opensAt > now ? `Flips when the window opens at ${formatLocalTime(opensAt, timeZone, now)}, ${formatFromNow(opensAt, now)}.` : `Flips as soon as it is eligible: ${arm.decision.reason}.`
		action = (
			<Button variant="secondary" disabled={pending} title={pending ? 'Waiting for the server to answer the last request.' : 'Removes the arm; moves nothing.'} onClick={() => void disarmMeridianFlip(meridianFlipExecutorState, device.connectionId, device.id)}>
				Disarm
			</Button>
		)
	} else if (paused && execution) {
		badge = meridianFlipExecutionHeadline(execution)
		text = `The capture is paused since the flip ended at ${formatLocalTime(execution.endedAt ?? execution.startedAt, timeZone, now)}. Check the mount, the framing, and guiding before resuming it.`
		action = (
			<ConfirmButton title="Resume the paused capture?" message="The flip did not leave imaging ready. Resume the capture only once you checked the mount, the framing, and guiding." confirmLabel="Resume" disabled={pending} onConfirm={() => void resumePausedCapture(meridianFlipExecutorState, execution)}>
				Resume Capture
			</ConfirmButton>
		)
	} else {
		return null
	}

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line-100 bg-base-100 px-3 py-2">
			<StatusBadge tone={badge[1]} label={badge[0]} />
			<span className="order-last w-full min-w-0 text-sm leading-5 text-ink-200 tabular-nums sm:order-0 sm:w-auto sm:flex-1">{text}</span>
			<div className="ml-auto flex">{action}</div>
		</div>
	)
}
