import type { ObservingTargetRef, OperationRecord, SkyObjectRef, SkyPosition } from 'api'
import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime } from '../equipment-control/control'
import { formatDegrees } from '../format'
import { type GeographicLocation, siteObserver } from '../location/site'
import { operationsState } from '../operations'
import { addToObservingPlanner } from '../tools/observingplanner/observingplanner'
import { exploreMinorBody } from '../tools/orbitalmechanics/orbitalmechanics.sources'
import { Button } from '../ui/Button'
import { Modal, ModalActions } from '../ui/Modal'
import { Notice } from '../ui/Notice'
import { StatusBadge } from '../ui/StatusBadge'
import { formatDeclination, formatRightAscension } from './format'
import { mountRuntime, mountView, slewBlocker, slewMount, slewProgress, stopMount } from './mount'
import { createRequestGuard } from './selection'
import { fetchSkyPosition } from './sky'

// Actions of the selected object in the Object section of the Object Inspector: Show Framing, Add to Observing Planner for
// a catalog object, a major body other than the Sun, a minor body, or the Sky point as fixed coordinates (which opens the tool to choose a plan, changing nothing else), and
// Slew to Object (Slew to Point for the Sky point) while the profile's mount is connected. A slew points the mount at the object after an explicit
// confirmation, then shows the real outcome of the operation as the server reports it, as a status in words. The target is
// resolved by the server at the real current time, whatever instant the Sky shows; the dialog previews where the object is
// now for the observer, and Slew waits for that preview: it stays disabled while the object is located or below the
// horizon, and reads Slew Anyway when the preview failed (the server still refuses a target below the horizon). The
// dialog opens on Cancel, so a stray Enter never moves the mount. Accepting the request is never shown as arrival.

export interface ObjectActionsProps {
	// Object to slew to.
	readonly target: SkyObjectRef
	// Display name of the object.
	readonly targetName: string
	// Observer of the active profile; slewing needs it to check the horizon.
	readonly observer?: GeographicLocation
	// Opens the framing settings, which draw the field of view around the selection.
	readonly onShowFraming: () => void
}

// Description of each reason a mount operation fails.
const FAILURE_REASONS: Readonly<Record<NonNullable<OperationRecord['reason']>, string>> = {
	busy: 'the mount was busy',
	aborted: 'it was stopped',
	disconnected: 'the mount disconnected',
	removed: 'the mount was removed',
	timeout: 'the mount did not arrive in time',
	alert: 'the driver reported an error',
	commandFailed: 'the command failed',
	unexpectedState: 'the mount was in an unexpected state',
}

// Target of the Observing Planner for an object named `name`: a catalog object, a major body other than the Sun, a minor
// body by its SPK-ID, or fixed coordinates (the Sky point) under that name; undefined for what the planner does not
// evaluate (the Sun, constellations, satellites, meteor shower radiants).
export function plannerTarget(ref: SkyObjectRef, name: string): ObservingTargetRef | undefined {
	if (ref.kind === 'catalog') return { kind: 'catalog', id: ref.id }
	if (ref.kind === 'body' && ref.code !== '10') return { kind: 'body', code: ref.code }
	if (ref.kind === 'minorBody') return { kind: 'minorBody', spkId: ref.spkId, designation: ref.designation }
	if (ref.kind === 'coordinates') return { kind: 'coordinates', name, rightAscension: ref.rightAscension, declination: ref.declination }
	return undefined
}

// Preview of the object's place now, or why it is unknown.
type Preview = { readonly status: 'loading' } | { readonly status: 'ready'; readonly position: SkyPosition } | { readonly status: 'error'; readonly error: string }

// Actions of the selected object.
export function ObjectActions({ target, targetName, observer, onShowFraming }: ObjectActionsProps) {
	const runtime = mountView(useSnapshot(mountRuntime), useSnapshot(controlRuntime))
	const operations = useSnapshot(operationsState)
	const [preview, setPreview] = useState<Preview>()
	// Lookup of the place in the confirmation: a closed confirmation, or a later one, ignores an earlier answer.
	const lookup = useRef(createRequestGuard())
	const mount = runtime.target
	const blocker = observer ? slewBlocker(runtime, operations) : 'Set the observer location to check the horizon'
	const progress = slewProgress(runtime, operations)
	const moving = runtime.state?.slewing === true || progress?.state === 'running'
	const connected = !!mount && runtime.state?.connected === true
	const plannable = plannerTarget(target, targetName)
	// What the slew points at, in the button and the confirmation.
	const what = target.kind === 'coordinates' ? 'Point' : 'Object'

	useEffect(() => {
		const guard = lookup.current
		return () => guard.cancel()
	}, [])

	// Opens the confirmation with the object's place at the real current time.
	function confirm() {
		if (!observer) return
		const request = lookup.current.begin()
		setPreview({ status: 'loading' })
		fetchSkyPosition(target, Date.now(), siteObserver(observer), 'fast', request.signal).then(
			({ position }) => request.current() && setPreview({ status: 'ready', position }),
			(error: unknown) => request.current() && setPreview({ status: 'error', error: error instanceof Error ? error.message : 'Request failed' }),
		)
	}

	// Closes the confirmation, ignoring the lookup still in flight.
	function close() {
		lookup.current.cancel()
		setPreview(undefined)
	}

	// Whether the preview shows the object below the horizon now.
	const belowHorizon = preview?.status === 'ready' && preview.position.altitude !== undefined && preview.position.altitude < 0
	// Why Slew cannot be pressed yet; undefined once the preview is known and above the horizon, or failed.
	const slewWait = preview?.status === 'loading' ? 'Locating the object now' : belowHorizon ? 'The object is below the horizon now' : undefined

	// Sends the slew and closes the confirmation.
	function slew() {
		close()
		const current = siteObserver(observer)
		if (current) void slewMount(mountRuntime, target, targetName, current)
	}

	return (
		<>
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" onClick={onShowFraming}>
					Show Framing
				</Button>
				{plannable && (
					<Button variant="secondary" onClick={() => addToObservingPlanner({ target: plannable, name: targetName })}>
						Add to Observing Planner
					</Button>
				)}
				{target.kind === 'minorBody' && (
					<Button variant="secondary" onClick={() => exploreMinorBody({ spkId: target.spkId, name: targetName })}>
						Explore Orbit
					</Button>
				)}
				{connected && (
					<Button variant="secondary" disabled={!!blocker} title={blocker} onClick={confirm}>
						Slew to {what}
					</Button>
				)}
				{connected && moving && (
					<Button variant="secondary" disabled={!runtime.state?.canAbort} onClick={() => void stopMount(mountRuntime)}>
						Stop
					</Button>
				)}
			</div>
			{connected && blocker && !moving && <Notice>{blocker}.</Notice>}
			{mount && runtime.slew && <SlewStatus targetName={runtime.slew.targetName} operation={progress} />}
			{mount && runtime.error && <Notice error>{runtime.error}</Notice>}
			<Modal open={!!preview} onClose={close} title={`Slew to ${what.toLowerCase()}?`} className="max-w-md">
				<p className="m-0 text-sm">
					Slew <strong className="text-ink-100">{mount?.name || 'the mount'}</strong> to <strong className="text-ink-100">{targetName}</strong>.
				</p>
				<p className="mt-2 mb-0 text-xs leading-5 text-ink-300">The server resolves the object at the current real time, not at the time simulated in the Sky, and refuses targets below the horizon.</p>
				<div className="mt-3 text-sm">
					{preview?.status === 'loading' && <Notice>Locating the object now…</Notice>}
					{preview?.status === 'error' && <p className="m-0 text-danger">The current position is unavailable: {preview.error}</p>}
					{preview?.status === 'ready' && (
						<>
							<p className="m-0 font-mono">
								RA {formatRightAscension(preview.position.rightAscension)} · Dec {formatDeclination(preview.position.declination)}
							</p>
							{preview.position.altitude !== undefined && preview.position.azimuth !== undefined && (
								<p className="m-0 font-mono">
									Alt {formatDegrees(preview.position.altitude)} · Az {formatDegrees(preview.position.azimuth)}
								</p>
							)}
							{preview.position.altitude !== undefined && preview.position.altitude < 0 && <p className="mt-1 mb-0 text-danger">The object is below the horizon now.</p>}
						</>
					)}
				</div>
				<ModalActions>
					<Button variant="secondary" onClick={close} data-autofocus>
						Cancel
					</Button>
					<Button disabled={!!slewWait} title={slewWait} onClick={slew}>
						{preview?.status === 'error' ? 'Slew Anyway' : 'Slew'}
					</Button>
				</ModalActions>
			</Modal>
		</>
	)
}

// Outcome of the latest slew, as the server reported it: a status badge (Slewing, Arrived, or Failed) beside the target's
// name, which truncates rather than widening the panel, and the reason of a failure under it.
function SlewStatus({ targetName, operation }: { readonly targetName: string; readonly operation?: OperationRecord }) {
	const running = !operation || operation.state === 'running'
	const succeeded = operation?.state === 'succeeded'

	return (
		<>
			<div className="flex min-w-0 items-center gap-2">
				<StatusBadge tone={running ? 'active' : succeeded ? 'success' : 'danger'} label={running ? 'Slewing' : succeeded ? 'Arrived' : 'Failed'} />
				<span className="min-w-0 truncate text-xs text-ink-200" title={targetName}>
					{targetName}
				</span>
			</div>
			{operation && !running && !succeeded && (
				<Notice error>
					The slew to {targetName} failed: {operation.reason ? FAILURE_REASONS[operation.reason] : 'unknown reason'}
					{operation.error ? ` (${operation.error})` : ''}.
				</Notice>
			)}
		</>
	)
}
