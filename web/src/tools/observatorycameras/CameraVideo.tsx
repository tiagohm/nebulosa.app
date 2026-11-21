import { cn } from 'cn'
import { type Ref, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { observatoryCamerasView } from './observatorycameras'
import { markPlaying, playerState } from './player'

// Video element of a camera: shows the stream of the camera's player, the same stream wherever it is shown, muted and
// inline as browsers require to play it without a gesture on each element, filling its frame and letterboxed to keep the
// camera's aspect, so the frame keeps its own shape whatever the camera sends, and dimmed while this browser asks so,
// full screen included. The
// browser's own picture-in-picture is off: it would close with the view, so picture-in-picture goes through
// pictureinpicture.ts, whose element outlives the views.

// Props of the video of a camera.
export interface CameraVideoProps {
	// Id of the camera.
	readonly cameraId: string
	// Classes of the video element.
	readonly className?: string
	// Receives the video element, for full screen.
	readonly videoRef?: Ref<HTMLVideoElement>
}

// Video of a camera; empty while its player has no stream.
export function CameraVideo({ cameraId, className, videoRef }: CameraVideoProps) {
	const stream = useSnapshot(playerState).players[cameraId]?.stream
	const { dimmed } = useSnapshot(observatoryCamerasView)
	const element = useRef<HTMLVideoElement>(null)

	useEffect(() => {
		const video = element.current
		if (!video) return
		// The proxy snapshot wraps nothing of a ref, so the stream is the player's own MediaStream.
		if (video.srcObject !== (stream ?? null)) video.srcObject = stream ?? null
	}, [stream])

	function bind(video: HTMLVideoElement | null) {
		element.current = video
		if (typeof videoRef === 'function') videoRef(video)
		else if (videoRef) videoRef.current = video
	}

	return <video ref={bind} muted autoPlay playsInline disablePictureInPicture onPlaying={() => markPlaying(cameraId)} onLoadedData={() => markPlaying(cameraId)} className={cn('absolute inset-0 size-full bg-black object-contain', dimmed && 'brightness-50', className)} />
}

// Shows the video element in full screen.
export function requestFullscreen(video: HTMLVideoElement | null) {
	void video?.requestFullscreen().catch(() => undefined)
}
