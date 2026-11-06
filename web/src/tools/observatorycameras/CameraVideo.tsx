import { cn } from 'cn'
import { type Ref, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { markPlaying, playerState, setPictureInPicture } from './player'

// Video element of a camera: shows the stream of the camera's player, the same stream wherever it is shown, muted and
// inline as browsers require to play it without a gesture on each element, letterboxed to keep the camera's aspect.

// Props of the video of a camera.
export interface CameraVideoProps {
	// Id of the camera.
	readonly cameraId: string
	// Classes of the video element.
	readonly className?: string
	// Receives the video element, for full screen and picture-in-picture.
	readonly videoRef?: Ref<HTMLVideoElement>
}

// Video of a camera; empty while its player has no stream.
export function CameraVideo({ cameraId, className, videoRef }: CameraVideoProps) {
	const stream = useSnapshot(playerState).players[cameraId]?.stream
	const element = useRef<HTMLVideoElement>(null)

	useEffect(() => {
		const video = element.current
		if (!video) return
		// The proxy snapshot wraps nothing of a ref, so the stream is the player's own MediaStream.
		if (video.srcObject !== (stream ?? null)) video.srcObject = stream ?? null
	}, [stream])

	useEffect(() => {
		const video = element.current
		if (!video) return
		const enter = () => setPictureInPicture(cameraId)
		const leave = () => setPictureInPicture(undefined)
		video.addEventListener('enterpictureinpicture', enter)
		video.addEventListener('leavepictureinpicture', leave)

		return () => {
			video.removeEventListener('enterpictureinpicture', enter)
			video.removeEventListener('leavepictureinpicture', leave)
		}
	}, [cameraId])

	function bind(video: HTMLVideoElement | null) {
		element.current = video
		if (typeof videoRef === 'function') videoRef(video)
		else if (videoRef) videoRef.current = video
	}

	return <video ref={bind} muted autoPlay playsInline onPlaying={() => markPlaying(cameraId)} onLoadedData={() => markPlaying(cameraId)} className={cn('size-full bg-black object-contain', className)} />
}

// Shows the video element in full screen.
export function requestFullscreen(video: HTMLVideoElement | null) {
	void video?.requestFullscreen().catch(() => undefined)
}

// Whether the browser offers picture-in-picture of videos.
export function canPictureInPicture() {
	return typeof document !== 'undefined' && document.pictureInPictureEnabled
}

// Shows the video element in picture-in-picture, or leaves it when it already is.
export function togglePictureInPicture(video: HTMLVideoElement | null) {
	if (!video) return
	if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => undefined)
	else void video.requestPictureInPicture().catch(() => undefined)
}
