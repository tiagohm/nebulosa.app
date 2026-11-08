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
import { formatDeclination, formatRightAscension } from './format'
import { mountRuntime, mountView, slewBlocker, slewMount, slewProgress, stopMount } from './mount'
import { createRequestGuard } from './selection'
import { fetchSkyPosition } from './sky'

// Actions of the selected object in the Object section of the Object Inspector: Show Framing, Add to Observing Planner for
// a catalog object, a major body other than the Sun, or a minor body (which opens the tool to choose a plan, changing nothing else), and
// Slew to Object while the profile's mount is connected. A slew points the mount at the object after an explicit
// confirmation, then shows the real outcome of the operation as the server reports it. The target is resolved by the server at
// the real current time, whatever instant the Sky shows; the dialog previews where the object is now for the
// observer. Accepting the request is never shown as arrival.

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

// Target of the Observing Planner for an object: a catalog object, a major body other than the Sun, or a minor body by its
// SPK-ID; undefined for what the planner does not evaluate (the Sun, constellations, satellites).
export function plannerTarget(ref: SkyObjectRef): ObservingTargetRef | undefined {
	if (ref.kind === 'catalog') return { kind: 'catalog', id: ref.id }
	if (ref.kind === 'body' && ref.code !== '10') return { kind: 'body', code: ref.code }
	if (ref.kind === 'minorBody') return { kind: 'minorBody', spkId: ref.spkId, designation: ref.designation }
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
	const plannable = plannerTarget(target)

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
						Slew to Object
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
			<Modal open={!!preview} onClose={close} title="Slew to object?" className="max-w-md">
				<p className="m-0 text-sm">
					Slew <strong className="text-ink-100">{mount?.name || 'the mount'}</strong> to <strong className="text-ink-100">{targetName}</strong>.
				</p>
				<p className="mt-2 mb-0 text-xs leading-5 text-ink-300">The server resolves the object at the current real time, not at the time simulated in the Sky, and refuses targets below the horizon.</p>
				<div className="mt-3 text-sm">
					{preview?.status === 'loading' && <p className="m-0 text-ink-300">Locating the object now…</p>}
					{preview?.status === 'error' && <p className="m-0 text-danger">The current position is unavailable: {preview.error}</p>}
					{preview?.status === 'ready' && (
						<>
							<p className="m-0 font-mono">
								RA {formatRightAscension(preview.position.rightAscension)} · Dec {formatDeclination(preview.position.declination)}
							</p>
							{preview.position.altitude !== undefined && preview.position.azimuth !== undefined && (
								<p className="m-0 font-mono">
									Alt {formatDeclination(preview.position.altitude)} · Az {formatDegrees(preview.position.azimuth)}
								</p>
							)}
							{preview.position.altitude !== undefined && preview.position.altitude < 0 && <p className="mt-1 mb-0 text-danger">The object is below the horizon now.</p>}
						</>
					)}
				</div>
				<ModalActions>
					<Button variant="secondary" onClick={close}>
						Cancel
					</Button>
					<Button disabled={preview?.status === 'ready' && preview.position.altitude !== undefined && preview.position.altitude < 0} onClick={slew} data-autofocus>
						Slew
					</Button>
				</ModalActions>
			</Modal>
		</>
	)
}

// Outcome of the latest slew, as the server reported it.
function SlewStatus({ targetName, operation }: { readonly targetName: string; readonly operation?: OperationRecord }) {
	if (!operation || operation.state === 'running') return <p className="m-0 text-xs leading-4 text-ink-200">Slewing to {targetName}…</p>
	if (operation.state === 'succeeded') return <p className="m-0 text-xs leading-4 text-ink-200">Arrived at {targetName}.</p>
	return (
		<Notice error>
			The slew to {targetName} failed: {operation.reason ? FAILURE_REASONS[operation.reason] : 'unknown reason'}
			{operation.error ? ` (${operation.error})` : ''}.
		</Notice>
	)
}
