import type { ObservatoryCamera } from 'api'
import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatClockDuration } from '../../format'
import { siteState } from '../../location/site'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/IconButton'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { CameraVideo, canPictureInPicture, requestFullscreen, togglePictureInPicture } from './CameraVideo'
import { observatoryCamerasState } from './observatorycameras'
import { dockPlayer, playerState, setTileOnscreen, startPlayer, stopPlayer } from './player'
import { cameraStatus } from './status'

// Tile of a camera in the grid of Observatory Cameras: a 16:9 frame that shows the video only once the operator starts
// its preview (a static placeholder otherwise, so a grid never opens a stream by itself), its name, site, host, and
// status below the frame, never over the video, and its actions. A tile that leaves the screen pauses its preview
// unless the preview is docked in the mini-player, and a tile that goes away stops it.

// Props of a camera tile.
export interface CameraTileProps {
	// Camera shown.
	readonly camera: ObservatoryCamera
	// Whether the camera can move up or down in the list shown.
	readonly canMove: { readonly up: boolean; readonly down: boolean }
	// Opens the editor of the camera.
	readonly onEdit: (camera: ObservatoryCamera) => void
	// Opens the enlarged view of the camera.
	readonly onEnlarge: (camera: ObservatoryCamera) => void
	// Moves the camera up (-1) or down (1).
	readonly onMove: (camera: ObservatoryCamera, direction: -1 | 1) => void
}

// Returns the seconds elapsed since startedAt (milliseconds since the Unix epoch), updated every second; undefined
// without a start.
export function useElapsed(startedAt: number | undefined) {
	const [now, setNow] = useState(Date.now)

	useEffect(() => {
		if (startedAt === undefined) return
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [startedAt])

	return startedAt === undefined ? undefined : (now - startedAt) / 1000
}

// Tile of a camera.
export function CameraTile({ camera, canMove, onEdit, onEnlarge, onMove }: CameraTileProps) {
	const player = useSnapshot(playerState).players[camera.id]
	const { streams, gateway } = useSnapshot(observatoryCamerasState)
	const { sites } = useSnapshot(siteState)
	const frame = useRef<HTMLDivElement>(null)
	const video = useRef<HTMLVideoElement>(null)
	const elapsed = useElapsed(player?.status === 'playing' ? player.startedAt : undefined)
	const stream = streams[camera.id]
	const status = cameraStatus(camera, stream, player, gateway)
	const site = camera.observingSiteId === undefined ? 'Every site' : (sites.find((s) => s.id === camera.observingSiteId)?.name ?? 'Every site')
	const playing = player?.status === 'playing'
	const showVideo = player !== undefined && !player.docked && player.stream !== undefined
	const blocked = !camera.enabled ? 'The camera is disabled.' : gateway?.status === 'notInstalled' ? 'MediaMTX is not installed.' : undefined

	useEffect(() => {
		const element = frame.current
		if (!element) return
		const observer = new IntersectionObserver(([entry]) => setTileOnscreen(camera.id, entry.isIntersecting))
		observer.observe(element)

		return () => {
			observer.disconnect()
			setTileOnscreen(camera.id, false)
			if (!playerState.players[camera.id]?.docked) stopPlayer(camera.id)
		}
	}, [camera.id])

	return (
		<article className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-line-100 bg-base-100">
			<div ref={frame} className="relative aspect-video bg-black">
				{showVideo ? <CameraVideo cameraId={camera.id} videoRef={video} /> : <Placeholder text={player?.docked ? 'Playing in the mini-player' : player?.status === 'connecting' || player?.status === 'reconnecting' ? 'Connecting…' : player?.status === 'paused' ? 'Paused' : 'Preview stopped'} />}
			</div>
			<div className="flex flex-col gap-2 p-3">
				<div className="flex min-w-0 items-center gap-2">
					<h3 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">{camera.name}</h3>
					<StatusBadge tone={status.tone} label={status.label} />
				</div>
				<p className="m-0 truncate text-xs leading-4 text-ink-300">
					{site} · {camera.sourceHost}
					{stream && stream.readers > 0 && ` · ${stream.readers} ${stream.readers === 1 ? 'viewer' : 'viewers'}`}
					{elapsed !== undefined && ` · ${formatClockDuration(elapsed)}`}
				</p>
				{status.detail && <Notice error={player?.status === 'failed'}>{status.detail}</Notice>}
				<div className="flex flex-wrap items-center gap-1">
					{player && player.status !== 'failed' ? (
						<Button variant="secondary" onClick={() => stopPlayer(camera.id)}>
							Stop
						</Button>
					) : (
						<Button variant={player ? 'secondary' : 'primary'} disabled={blocked !== undefined} title={blocked} onClick={() => startPlayer(camera.id)}>
							{player ? 'Retry' : 'Start Preview'}
						</Button>
					)}
					<IconButton icon="expand" label="Enlarge" disabled={blocked !== undefined} onClick={() => onEnlarge(camera)} />
					<IconButton icon="dock" label={player?.docked ? 'Back to the tile' : 'Show in the mini-player'} pressed={player?.docked} disabled={!player} onClick={() => dockPlayer(camera.id, !player?.docked)} />
					<IconButton icon="fit" label="Full screen" disabled={!playing || !showVideo} onClick={() => requestFullscreen(video.current)} />
					{canPictureInPicture() && <IconButton icon="pictureInPicture" label="Picture in picture" disabled={!playing || !showVideo} onClick={() => togglePictureInPicture(video.current)} />}
					<span className="ml-auto flex items-center gap-1">
						<IconButton icon="arrow" label="Move up" disabled={!canMove.up} onClick={() => onMove(camera, -1)} />
						<IconButton icon="arrow" label="Move down" className="rotate-180" disabled={!canMove.down} onClick={() => onMove(camera, 1)} />
						<IconButton icon="edit" label="Edit" onClick={() => onEdit(camera)} />
					</span>
				</div>
			</div>
		</article>
	)
}

// Static content of a frame without video: never a picture of the camera, which would need a stream of its own.
export function Placeholder({ text }: { readonly text: string }) {
	return (
		<div className="flex size-full flex-col items-center justify-center gap-2 text-ink-300">
			<Icon name="video" className="size-8" strokeWidth={1.2} />
			<span className="text-xs">{text}</span>
		</div>
	)
}
