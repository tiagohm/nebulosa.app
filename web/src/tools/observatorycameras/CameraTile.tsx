import type { ObservatoryCamera } from 'api'
import { type Ref, type RefObject, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatClockDuration } from '../../format'
import { siteState } from '../../location/site'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { IconButton } from '../../ui/IconButton'
import { Notice } from '../../ui/Notice'
import { StatusBadge } from '../../ui/StatusBadge'
import { CameraVideo, requestFullscreen } from './CameraVideo'
import { observatoryCamerasState } from './observatorycameras'
import { canPictureInPicture, togglePictureInPicture } from './pictureinpicture'
import { attachTile, playerState, setTileOnscreen, startPlayer, stopPlayer } from './player'
import { cameraStatus, frameText, otherViewers } from './status'

// Tile of a camera in the grid of Observatory Cameras: a 16:9 frame that shows the video only once the operator starts
// its preview (a static placeholder otherwise, so a grid never opens a stream by itself), its name, status, site, host,
// viewers, and time live below the frame, never over the video, and its actions; moving it in the grid is offered only
// while the grid is arranged. A tile that leaves the screen pauses its preview and a tile that goes away stops it, unless
// the preview is in picture-in-picture, which keeps playing in every workspace. The frame, the line under it, and the
// playback controls are shared with the enlarged view.

// Classes of an icon button sized for a finger on phones.
export const TOUCH_BUTTON = 'max-sm:size-12.5'

// Props of a camera tile.
export interface CameraTileProps {
	// Camera shown.
	readonly camera: ObservatoryCamera
	// Whether the grid is being arranged, which offers moving the camera.
	readonly arranging: boolean
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

// Returns why a camera cannot play now, or undefined when it can.
export function playBlocked(camera: ObservatoryCamera, gatewayInstalled: boolean) {
	if (!camera.enabled) return 'The camera is disabled.'
	if (!gatewayInstalled) return 'MediaMTX is not installed.'
	return undefined
}

// Tile of a camera.
export function CameraTile({ camera, arranging, canMove, onEdit, onEnlarge, onMove }: CameraTileProps) {
	const { players } = useSnapshot(playerState)
	const { streams, gateway } = useSnapshot(observatoryCamerasState)
	const frame = useRef<HTMLDivElement>(null)
	const video = useRef<HTMLVideoElement>(null)
	const player = players[camera.id]
	const status = cameraStatus(camera, streams[camera.id], player, gateway)

	useEffect(() => {
		const element = frame.current
		if (!element) return
		const detach = attachTile(camera.id)
		const observer = new IntersectionObserver(([entry]) => setTileOnscreen(camera.id, entry.isIntersecting))
		observer.observe(element)

		return () => {
			observer.disconnect()
			detach()
		}
	}, [camera.id])

	return (
		<article className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-line-100 bg-base-100">
			<CameraFrame cameraId={camera.id} frameRef={frame} videoRef={video} />
			<div className="flex flex-col gap-2 p-3">
				<div className="flex min-w-0 items-center gap-2">
					<h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">{camera.name}</h2>
					<StatusBadge tone={status.tone} label={status.label} />
				</div>
				<CameraMeta camera={camera} />
				{status.detail && <Notice error={status.tone === 'danger'}>{status.detail}</Notice>}
				<div className="flex flex-wrap items-center gap-1">
					<PlaybackControls camera={camera} video={video} onEnlarge={onEnlarge} />
					<span className="ml-auto flex items-center gap-1">
						{arranging && (
							<>
								<IconButton icon="arrow" label={canMove.up ? 'Move up' : 'The camera is first'} className={TOUCH_BUTTON} disabled={!canMove.up} onClick={() => onMove(camera, -1)} />
								<IconButton icon="arrow" label={canMove.down ? 'Move down' : 'The camera is last'} className={`rotate-180 ${TOUCH_BUTTON}`} disabled={!canMove.down} onClick={() => onMove(camera, 1)} />
							</>
						)}
						<IconButton icon="edit" label="Edit" className={TOUCH_BUTTON} onClick={() => onEdit(camera)} />
					</span>
				</div>
			</div>
		</article>
	)
}

// Props of the frame of a camera.
export interface CameraFrameProps {
	// Id of the camera shown.
	readonly cameraId: string
	// Receives the frame element, to tell whether it is on screen.
	readonly frameRef?: Ref<HTMLDivElement>
	// Receives the video element, for full screen.
	readonly videoRef: Ref<HTMLVideoElement>
}

// 16:9 frame of a camera: the video once the player has a stream (mounted before its first frame, which marks it
// playing), covered by the placeholder of the player's state until then.
export function CameraFrame({ cameraId, frameRef, videoRef }: CameraFrameProps) {
	const { players, pictureInPicture } = useSnapshot(playerState)
	const player = players[cameraId]
	const inPictureInPicture = pictureInPicture === cameraId
	const showVideo = player?.stream !== undefined && !inPictureInPicture

	return (
		<div ref={frameRef} className="relative aspect-video overflow-hidden bg-black">
			{showVideo && <CameraVideo cameraId={cameraId} videoRef={videoRef} />}
			{(!showVideo || player.status !== 'playing') && <Placeholder text={frameText(player, inPictureInPicture)} />}
		</div>
	)
}

// Line under the frame of a camera: its site, the host of its address, the viewers other than this tab, and how long
// this tab's preview has been live.
export function CameraMeta({ camera }: { readonly camera: ObservatoryCamera }) {
	const { players } = useSnapshot(playerState)
	const { streams } = useSnapshot(observatoryCamerasState)
	const { sites } = useSnapshot(siteState)
	const player = players[camera.id]
	const elapsed = useElapsed(player?.status === 'playing' ? player.startedAt : undefined)
	const site = camera.observingSiteId === undefined ? 'Every site' : (sites.find((s) => s.id === camera.observingSiteId)?.name ?? 'Every site')
	const viewers = otherViewers(streams[camera.id]?.readers ?? 0, player?.stream !== undefined)
	const parts = [site, camera.sourceHost, viewers, elapsed !== undefined && `live for ${formatClockDuration(elapsed)}`].filter((part) => typeof part === 'string' && part.length > 0)

	return <p className="m-0 text-xs leading-4 wrap-break-word text-ink-300">{parts.join(' · ')}</p>
}

// Props of the playback controls of a camera.
export interface PlaybackControlsProps {
	// Camera controlled.
	readonly camera: ObservatoryCamera
	// Video element shown in full screen.
	readonly video: RefObject<HTMLVideoElement | null>
	// Opens the enlarged view; absent where the camera is already enlarged.
	readonly onEnlarge?: (camera: ObservatoryCamera) => void
}

// Start, Stop, or Retry of the preview of a camera, then Enlarge, Full screen, and picture-in-picture; an unavailable
// one says why in its tooltip.
export function PlaybackControls({ camera, video, onEnlarge }: PlaybackControlsProps) {
	const { players, pictureInPicture } = useSnapshot(playerState)
	const { gateway } = useSnapshot(observatoryCamerasState)
	const player = players[camera.id]
	const inPictureInPicture = pictureInPicture === camera.id
	const playing = player?.status === 'playing'
	const blocked = playBlocked(camera, gateway?.status !== 'notInstalled')
	const fullScreenLabel = inPictureInPicture ? 'Leave picture-in-picture to show it in full screen' : playing ? 'Full screen' : 'Start the preview to show it in full screen'
	const pictureInPictureLabel = inPictureInPicture ? 'Leave picture-in-picture' : playing ? 'Picture-in-picture' : 'Start the preview to show it in picture-in-picture'

	return (
		<>
			{player && player.status !== 'failed' ? (
				<Button variant="secondary" onClick={() => stopPlayer(camera.id)}>
					Stop
				</Button>
			) : (
				<Button variant="secondary" disabled={blocked !== undefined} title={blocked} onClick={() => startPlayer(camera.id)}>
					{player ? 'Retry' : 'Play'}
				</Button>
			)}
			{onEnlarge && <IconButton icon="zoomIn" label={blocked ?? 'Enlarge'} className={TOUCH_BUTTON} disabled={blocked !== undefined} onClick={() => onEnlarge(camera)} />}
			<IconButton icon="expand" label={fullScreenLabel} className={TOUCH_BUTTON} disabled={!playing || inPictureInPicture} onClick={() => requestFullscreen(video.current)} />
			{canPictureInPicture() && <IconButton icon="pictureInPicture" label={pictureInPictureLabel} className={TOUCH_BUTTON} pressed={inPictureInPicture} disabled={!playing && !inPictureInPicture} onClick={() => void togglePictureInPicture(camera.id)} />}
		</>
	)
}

// Static content of a frame without video: never a picture of the camera, which would need a stream of its own.
export function Placeholder({ text }: { readonly text: string }) {
	return (
		<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black text-ink-300">
			<Icon name="video" className="size-8" strokeWidth={1.2} />
			<span className="text-xs">{text}</span>
		</div>
	)
}
