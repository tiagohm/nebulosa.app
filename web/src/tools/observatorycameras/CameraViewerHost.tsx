import { useRef } from 'react'
import { useSnapshot } from 'valtio'
import { navigate, routeState } from '../../shell/route'
import { IconButton } from '../../ui/IconButton'
import { StatusBadge } from '../../ui/StatusBadge'
import { CameraVideo, canPictureInPicture, togglePictureInPicture } from './CameraVideo'
import { observatoryCamerasState } from './observatorycameras'
import { dockPlayer, playerState, stopPlayer } from './player'
import { cameraStatus } from './status'

// Host of the mini-player, mounted once by the application shell beside the workspaces, so a camera docked in it keeps
// playing while the operator moves between Images, Sky, Tools, and the other pages. It shows the docked players at the
// bottom left, above the status bar and away from the notification toasts, each with its status, picture-in-picture,
// a way back to its tile, and Close, which stops it. It shows the player's own stream: docking never opens a second
// session.

// Mini-player of the docked cameras; empty when none is docked.
export function CameraViewerHost() {
	const { players } = useSnapshot(playerState)
	const docked = Object.keys(players).filter((id) => players[id].docked)
	if (docked.length === 0) return null

	return (
		<div className="pointer-events-none fixed bottom-10 left-20 z-30 flex w-[min(320px,calc(100vw-96px))] flex-col gap-2">
			{docked.map((id) => (
				<DockedCamera key={id} cameraId={id} />
			))}
		</div>
	)
}

// One docked camera of the mini-player.
function DockedCamera({ cameraId }: { readonly cameraId: string }) {
	const player = useSnapshot(playerState).players[cameraId]
	const { cameras, streams, gateway } = useSnapshot(observatoryCamerasState)
	const video = useRef<HTMLVideoElement>(null)
	const camera = cameras[cameraId]
	if (!camera || !player) return null
	// Inside the mini-player, being in it goes without saying.
	const status = cameraStatus(camera, streams[cameraId], { ...player, docked: false }, gateway)

	function back() {
		dockPlayer(cameraId, false)
		navigate(routeState, { workspace: 'tools', tool: 'observatory-cameras' })
	}

	return (
		<section className="pointer-events-auto overflow-hidden rounded-md border border-line-100 bg-base-200 shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
			<div className="aspect-video bg-black">{player.stream ? <CameraVideo cameraId={cameraId} videoRef={video} /> : <div className="flex size-full items-center justify-center text-xs text-ink-300">{status.label}</div>}</div>
			<div className="flex items-center gap-1 px-2 py-1">
				<span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-100">{camera.name}</span>
				<StatusBadge tone={status.tone} label={status.label} />
				{canPictureInPicture() && <IconButton icon="pictureInPicture" label="Picture in picture" disabled={player.status !== 'playing'} onClick={() => togglePictureInPicture(video.current)} />}
				<IconButton icon="expand" label="Back to Observatory Cameras" onClick={back} />
				<IconButton icon="close" label="Close" onClick={() => stopPlayer(cameraId)} />
			</div>
		</section>
	)
}
