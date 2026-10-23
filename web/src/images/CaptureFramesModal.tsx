import type { CaptureFrameSummary, CaptureSourceSummary } from 'api'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { connectionState } from '../connection/connection'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { captureFramesState, connectionLabel, frameLabel, frameSourceKey, frameUnavailableReason, loadRecentFrames } from './captureframes'
import { imagesState, openCaptureFrame, openLive } from './images'

// Images → Capture Frames: the cameras that captured frames, grouped by connection, and for the camera selected its
// latest frame, Open Latest, Follow Live, and its recent frames, each opened by its own frame id. Frames that can no
// longer be opened stay listed with the reason, and their Open is disabled; nothing ever opens another frame in their
// place. Choosing a camera here never connects, commands, or captures with it.

interface CaptureFramesModalProps {
	// Whether the modal is open.
	readonly open: boolean
	// Closes the modal.
	readonly onClose: () => void
}

// Returns the time of a frame in the browser's local time, as hh:mm:ss.
function frameTime(frame: Pick<CaptureFrameSummary, 'time'>): string {
	return new Date(frame.time).toLocaleTimeString(undefined, { hour12: false })
}

// Returns the storage state of a frame for people.
function storageLabel(frame: CaptureFrameSummary): string {
	if (frame.file === 'saved') return 'Saved'
	if (frame.file === 'saving') return 'Saving'
	if (frame.file === 'failed') return 'Save failed'
	return 'Temporary'
}

// Capture Frames picker of the Images workspace.
export function CaptureFramesModal({ open, onClose }: CaptureFramesModalProps) {
	const state = useSnapshot(captureFramesState)
	const connections = useSnapshot(connectionState)
	const [selected, setSelected] = useState<string>()
	const sources = Object.values(state.sources).toSorted((a, b) => b.revision - a.revision)
	const source = sources.find((s) => frameSourceKey(s.connectionId, s.deviceId) === selected) ?? sources[0]
	const key = source && frameSourceKey(source.connectionId, source.deviceId)

	useEffect(() => {
		if (open && source) void loadRecentFrames(captureFramesState, source.connectionId, source.deviceId)
	}, [open, source?.connectionId, source?.deviceId])

	// Groups the cameras by connection, in the order of their latest change.
	const groups = new Map<string, CaptureSourceSummary[]>()
	for (const s of sources) groups.set(s.connectionId, [...(groups.get(s.connectionId) ?? []), s])

	// Returns the name a camera is shown by, with its connection when another camera has the same name.
	function cameraName(s: CaptureSourceSummary) {
		const twin = sources.some((other) => other !== s && other.cameraName === s.cameraName)
		return twin ? `${s.cameraName} (${connectionLabel(s.connectionId, connections.servers, connections.connections)})` : s.cameraName
	}

	// Opens a frame as a captured frame tab and closes the picker.
	function openFrame(frameId: string) {
		onClose()
		void openCaptureFrame(imagesState, frameId)
	}

	return (
		<Modal open={open} onClose={onClose} title="Capture Frames" fit className="max-w-4xl">
			{sources.length === 0 ? (
				<p className="m-0 py-8 text-center text-[13px] text-ink-300">{state.errors[''] ? `The captured frames could not be loaded: ${state.errors['']}` : state.loaded ? 'No captured frames yet. Frames taken by Camera Capture appear here.' : 'Loading…'}</p>
			) : (
				<div className="flex min-h-0 flex-1 gap-4 max-md:flex-col">
					<nav className="flex min-h-0 w-56 flex-none flex-col gap-3 overflow-y-auto max-md:max-h-40 max-md:w-full">
						{Array.from(groups, ([connectionId, cameras]) => (
							<section key={connectionId}>
								<h3 className="m-0 mb-1 text-xs font-medium text-ink-300">{connectionLabel(connectionId, connections.servers, connections.connections)}</h3>
								<ul className="m-0 list-none p-0">
									{cameras.map((s) => {
										const k = frameSourceKey(s.connectionId, s.deviceId)

										return (
											<li key={k}>
												<button
													type="button"
													onClick={() => setSelected(k)}
													className={cn(
														'flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 px-2 py-1.5 text-left font-mono text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
														k === key ? 'bg-accent-subtle text-accent' : 'bg-transparent text-ink-100 hover:bg-base-300',
													)}
												>
													<span className={cn('size-1.5 flex-none rounded-full', s.connected ? 'bg-success' : 'bg-ink-300')} title={s.connected ? 'Connected' : 'Disconnected'} />
													<span className="min-w-0 flex-1 truncate">{s.cameraName}</span>
													<span className="text-ink-300 tabular-nums">{s.count}</span>
												</button>
											</li>
										)
									})}
								</ul>
							</section>
						))}
					</nav>
					{source && key && <SourceDetail source={source} name={cameraName(source)} connection={connectionLabel(source.connectionId, connections.servers, connections.connections)} frames={state.frames[key]} loading={state.loading[key]} error={state.errors[key]} onOpen={openFrame} onFollow={onClose} />}
				</div>
			)}
		</Modal>
	)
}

interface SourceDetailProps {
	// Camera shown.
	readonly source: CaptureSourceSummary
	// Name the camera is shown by.
	readonly name: string
	// Name of its connection.
	readonly connection: string
	// Its recent frames, newest first; absent until fetched.
	readonly frames?: readonly CaptureFrameSummary[]
	// Whether they are being fetched.
	readonly loading?: boolean
	// Why they could not be fetched.
	readonly error?: string
	// Opens a frame by its id.
	readonly onOpen: (frameId: string) => void
	// Called once a live tab was opened.
	readonly onFollow: () => void
}

// Latest frame, actions, and recent frames of a camera.
function SourceDetail({ source, name, connection, frames, loading, error, onOpen, onFollow }: SourceDetailProps) {
	const latest = frames?.find((frame) => frame.frameId === source.latestFrameId)
	const latestAvailable = frames?.find((frame) => frame.frameId === source.latestAvailableFrameId)
	const latestReason = latest && frameUnavailableReason(latest)

	function follow() {
		onFollow()
		void openLive(imagesState, { connectionId: source.connectionId, deviceId: source.deviceId, name }, source.latestAvailableFrameId)
	}

	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="m-0 truncate text-[15px] font-medium text-ink-100">{source.cameraName}</p>
					<p className="m-0 text-[13px] text-ink-300">
						{connection} · {source.connected ? 'Connected' : 'Disconnected'}
					</p>
					{latest && (
						<p className="m-0 text-[13px] text-ink-200">
							Latest: #{latest.generation} at {frameTime(latest)}
							{latestReason && <span className="text-danger"> · {latestReason}</span>}
						</p>
					)}
				</div>
				<div className="flex flex-wrap gap-2">
					{latestReason ? (
						latestAvailable && (
							<Button size="sm" variant="secondary" onClick={() => onOpen(latestAvailable.frameId)}>
								Open Latest Available #{latestAvailable.generation}
							</Button>
						)
					) : (
						<Button size="sm" variant="secondary" disabled={!latest} onClick={() => latest && onOpen(latest.frameId)}>
							Open Latest{latest ? ` #${latest.generation}` : ''}
						</Button>
					)}
					<Button size="sm" onClick={follow}>
						Follow Live
					</Button>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-line-100">
				{error ? (
					<p className="m-0 p-4 text-[13px] text-danger">The recent frames could not be loaded: {error}</p>
				) : !frames ? (
					<p className="m-0 p-4 text-[13px] text-ink-300">{loading ? 'Loading…' : ''}</p>
				) : frames.length === 0 ? (
					<p className="m-0 p-4 text-[13px] text-ink-300">No recent frames.</p>
				) : (
					<ul className="m-0 list-none p-0">
						{frames.map((frame) => {
							const reason = frameUnavailableReason(frame)

							return (
								<li key={frame.frameId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-100 px-3 py-2 text-[13px] last:border-b-0">
									<span className="w-14 flex-none text-ink-100 tabular-nums">#{frame.generation}</span>
									<span className="w-20 flex-none text-ink-200 tabular-nums">{frameTime(frame)}</span>
									<span className="w-16 flex-none text-ink-200 tabular-nums">{frame.acquisition?.exposure === undefined ? '—' : `${frame.acquisition.exposure} s`}</span>
									<span className="w-24 flex-none text-ink-200 tabular-nums">{frame.width && frame.height ? `${frame.width}×${frame.height}` : '—'}</span>
									<span className="min-w-0 flex-1 truncate text-ink-300" title={frameLabel(frame)}>
										{reason ? <span className="text-danger">{reason}</span> : storageLabel(frame)}
										{frame.frameId === source.latestFrameId && <span className="text-accent"> · Latest</span>}
									</span>
									<Button size="sm" variant="secondary" disabled={!!reason} title={reason} onClick={() => onOpen(frame.frameId)}>
										Open
									</Button>
								</li>
							)
						})}
					</ul>
				)}
			</div>
		</section>
	)
}
