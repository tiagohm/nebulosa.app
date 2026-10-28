import type { OperationRecord, SkyObjectRef, SkyPosition } from 'api'
import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime } from '../equipment-control/control'
import { operationsState } from '../operations'
import type { SkyObserverSettings } from '../profile/schema'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { CollapsibleSection } from './CollapsibleSection'
import { formatDeclination, formatDegrees, formatRightAscension } from './format'
import { mountRuntime, mountView, slewBlocker, slewMount, slewProgress, stopMount } from './mount'
import { apiObserver, fetchSkyPosition } from './sky'

// Slew to Object of the Object Inspector: points the profile's mount at the selected object after an
// explicit confirmation, then shows the real outcome of the operation as the server reports it. The
// target is resolved by the server at the real current time, whatever instant the Sky shows; the dialog
// previews where the object is now for the observer. Accepting the request is never shown as arrival.

export interface SlewSectionProps {
	// Object to slew to.
	readonly target: SkyObjectRef
	// Display name of the object.
	readonly targetName: string
	// Observer of the active profile; slewing needs it to check the horizon.
	readonly observer?: SkyObserverSettings
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

// Preview of the object's place now, or why it is unknown.
type Preview = { readonly status: 'loading' } | { readonly status: 'ready'; readonly position: SkyPosition } | { readonly status: 'error'; readonly error: string }

// Slew to Object section.
export function SlewSection({ target, targetName, observer }: SlewSectionProps) {
	const runtime = mountView(useSnapshot(mountRuntime), useSnapshot(controlRuntime))
	const operations = useSnapshot(operationsState)
	const [preview, setPreview] = useState<Preview>()
	const mount = runtime.target
	const blocker = observer ? slewBlocker(runtime, operations) : 'Set the observer location to check the horizon'
	const progress = slewProgress(runtime, operations)
	const moving = runtime.state?.slewing === true || progress?.state === 'running'

	if (!mount) return null

	// Opens the confirmation with the object's place at the real current time.
	function confirm() {
		if (!observer) return
		setPreview({ status: 'loading' })
		fetchSkyPosition(target, Date.now(), apiObserver(observer), 'fast').then(
			({ position }) => setPreview({ status: 'ready', position }),
			(error: unknown) => setPreview({ status: 'error', error: error instanceof Error ? error.message : 'Request failed' }),
		)
	}

	// Sends the slew and closes the confirmation.
	function slew() {
		setPreview(undefined)
		const current = apiObserver(observer)
		if (current) void slewMount(mountRuntime, target, targetName, current)
	}

	return (
		<CollapsibleSection id="mount" title="Mount" summary={moving ? 'Slewing' : mount.name || undefined}>
			<div className="flex flex-wrap gap-2">
				<Button variant="secondary" disabled={!!blocker} title={blocker} onClick={confirm}>
					Slew to Object
				</Button>
				{moving && (
					<Button variant="secondary" disabled={!runtime.state?.canAbort} onClick={() => void stopMount(mountRuntime)}>
						Stop
					</Button>
				)}
			</div>
			{blocker && !moving && <p className="m-0 text-xs leading-4 text-ink-300">{blocker}.</p>}
			{runtime.slew && <SlewStatus targetName={runtime.slew.targetName} operation={progress} />}
			{runtime.error && <p className="m-0 text-xs leading-4 text-danger">{runtime.error}</p>}
			<Modal open={!!preview} onClose={() => setPreview(undefined)} title="Slew to object?" className="max-w-md">
				<p className="m-0 text-[13px]">
					Slew <strong className="text-ink-100">{mount.name || 'the mount'}</strong> to <strong className="text-ink-100">{targetName}</strong>.
				</p>
				<p className="mt-2 mb-0 text-xs leading-5 text-ink-300">The server resolves the object at the current real time, not at the time simulated in the Sky, and refuses targets below the horizon.</p>
				<div className="mt-3 text-[13px]">
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
				<div className="mt-5 flex justify-end gap-2">
					<Button variant="secondary" onClick={() => setPreview(undefined)}>
						Cancel
					</Button>
					<Button disabled={preview?.status === 'ready' && preview.position.altitude !== undefined && preview.position.altitude < 0} onClick={slew} data-autofocus>
						Slew
					</Button>
				</div>
			</Modal>
		</CollapsibleSection>
	)
}

// Outcome of the latest slew, as the server reported it.
function SlewStatus({ targetName, operation }: { readonly targetName: string; readonly operation?: OperationRecord }) {
	if (!operation || operation.state === 'running') return <p className="m-0 text-xs leading-4 text-ink-200">Slewing to {targetName}…</p>
	if (operation.state === 'succeeded') return <p className="m-0 text-xs leading-4 text-ink-200">Arrived at {targetName}.</p>
	return (
		<p className="m-0 text-xs leading-4 text-danger">
			The slew to {targetName} failed: {operation.reason ? FAILURE_REASONS[operation.reason] : 'unknown reason'}
			{operation.error ? ` (${operation.error})` : ''}.
		</p>
	)
}
