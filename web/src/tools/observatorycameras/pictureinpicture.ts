import { subscribe } from 'valtio'
import { markPlaying, playerState, setPictureInPicture } from './player'

// Picture-in-picture of the observatory cameras: one video element of the page, never of a view, shows the camera in
// the browser's picture-in-picture window, so the window keeps playing when the operator leaves Observatory Cameras and
// its tiles unmount. It shows the player's own stream, follows it across reconnections, and closes when the player
// stops; the views show a placeholder meanwhile, so the camera is still decoded once.

// Video element shown in picture-in-picture, made on first use and kept for the life of the page.
let element: HTMLVideoElement | undefined

// Returns the video element of picture-in-picture: muted and inline so it plays without a gesture, attached to the page
// but invisible (1 px, transparent), since browsers may pause a detached or hidden video.
function pictureInPictureVideo() {
	if (element) return element

	const video = document.createElement('video')
	video.muted = true
	video.autoplay = true
	video.playsInline = true
	video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'

	const playing = () => {
		const id = playerState.pictureInPicture
		if (id) markPlaying(id)
	}

	video.addEventListener('playing', playing)
	video.addEventListener('loadeddata', playing)
	video.addEventListener('leavepictureinpicture', () => {
		video.srcObject = null
		setPictureInPicture(undefined)
	})

	document.body.append(video)
	element = video
	return video
}

// Whether the browser offers picture-in-picture of videos.
export function canPictureInPicture() {
	return typeof document !== 'undefined' && document.pictureInPictureEnabled
}

// Shows a playing camera in picture-in-picture, replacing the camera already there, or leaves picture-in-picture when
// the camera is already in it. Called from a click: the browser requires a user gesture to open the window.
export async function togglePictureInPicture(id: string) {
	if (playerState.pictureInPicture === id) {
		await document.exitPictureInPicture().catch(() => undefined)
		return
	}

	const stream = playerState.players[id]?.stream
	if (!stream) return

	const video = pictureInPictureVideo()
	video.srcObject = stream

	try {
		if (video.readyState < HTMLMediaElement.HAVE_METADATA)
			await new Promise((resolve) => {
				video.addEventListener('loadedmetadata', resolve, { once: true })
			})
		await video.requestPictureInPicture()
		setPictureInPicture(id)
	} catch {
		// The browser refused the window: the element goes back to the camera still in it, if any.
		const current = playerState.pictureInPicture
		video.srcObject = current ? (playerState.players[current]?.stream ?? null) : null
	}
}

// Keeps the picture-in-picture window on its player: a new stream after a reconnection replaces the old one, and a
// stopped player closes the window. Returns the function that stops following the players.
export function watchPictureInPicture() {
	return subscribe(playerState, () => {
		const video = element
		if (!video || document.pictureInPictureElement !== video) return
		const id = playerState.pictureInPicture
		const player = id ? playerState.players[id] : undefined

		if (!player) void document.exitPictureInPicture().catch(() => undefined)
		else if (player.stream && video.srcObject !== player.stream) video.srcObject = player.stream
	})
}
