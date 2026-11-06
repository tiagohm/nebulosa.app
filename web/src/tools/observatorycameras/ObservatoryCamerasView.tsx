import type { ObservatoryCamera } from 'api'
import { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { siteState } from '../../location/site'
import { useActiveSite } from '../../location/useLocation'
import { navigate, routeState } from '../../shell/route'
import { EmptyState, WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { Button } from '../../ui/Button'
import { IconButton } from '../../ui/IconButton'
import { Modal } from '../../ui/Modal'
import { Notice } from '../../ui/Notice'
import { Select } from '../../ui/Select'
import { StatusBadge } from '../../ui/StatusBadge'
import { CameraEditor } from './CameraEditor'
import { CameraTile, Placeholder } from './CameraTile'
import { CameraVideo, canPictureInPicture, requestFullscreen, togglePictureInPicture } from './CameraVideo'
import { filterCameras, moveCamera, observatoryCamerasState, sortedCameras } from './observatorycameras'
import { isTileOnscreen, playerState, startPlayer, stopAllPlayers } from './player'
import { cameraStatus } from './status'

// Observatory Cameras tool: the IP cameras watching the observatory, in a grid. Nothing plays until the operator starts a
// preview, one tile at a time or every tile on screen at once; a preview can be enlarged, shown in full screen or
// picture-in-picture, or docked in the mini-player of the shell, which keeps playing in every workspace. By default the
// grid shows the cameras of the active site and those shared by every site. The cameras, the media gateway, and the key
// of their addresses are the server's; this view only edits them.

// Value of the site filter showing the active site and the shared cameras.
const ACTIVE_SITE = 'site'

// Value of the site filter showing every camera.
const ALL_SITES = 'all'

// Observatory Cameras tool.
export function ObservatoryCamerasView() {
	const state = useSnapshot(observatoryCamerasState)
	const { players } = useSnapshot(playerState)
	const { sites } = useSnapshot(siteState)
	const activeSite = useActiveSite()
	const [filter, setFilter] = useState(ACTIVE_SITE)
	const [editing, setEditing] = useState<ObservatoryCamera | 'new'>()
	const [enlarged, setEnlarged] = useState<string>()
	const [moveError, setMoveError] = useState<string>()
	const cameras = filterCameras(sortedCameras(state.cameras), filter, activeSite?.id)
	const playing = Object.keys(players).length
	const installed = state.gateway !== undefined && state.gateway.status !== 'notInstalled'
	const filterOptions = [ACTIVE_SITE, ALL_SITES, ...sites.map((site) => site.id)]

	function startVisible() {
		for (const camera of cameras) if (camera.enabled && isTileOnscreen(camera.id)) startPlayer(camera.id)
	}

	async function move(camera: ObservatoryCamera, direction: -1 | 1) {
		setMoveError(await moveCamera(observatoryCamerasState, cameras, camera.id, direction))
	}

	const actions = (
		<>
			<Button variant="secondary" disabled={!installed || cameras.length === 0} onClick={startVisible}>
				Start Visible Previews
			</Button>
			<Button variant="secondary" disabled={playing === 0} onClick={stopAllPlayers}>
				Stop All
			</Button>
			<Button onClick={() => setEditing('new')}>Add Camera</Button>
		</>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Observatory Cameras" actions={actions}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					<FeatureNotices cameraCount={Object.keys(state.cameras).length} />
					<div className="flex flex-wrap items-end gap-3">
						<Select
							label="Cameras of"
							className="w-64"
							options={filterOptions}
							value={filter}
							onChange={setFilter}
							format={(value) => (value === ACTIVE_SITE ? (activeSite ? `${activeSite.name} and every site` : 'Every site') : value === ALL_SITES ? 'All sites' : (sites.find((site) => site.id === value)?.name ?? value))}
						/>
						<span className="pb-2 text-sm text-ink-300">{playing === 0 ? 'No preview is playing.' : `${playing} ${playing === 1 ? 'preview' : 'previews'} in this tab; each one decodes its own video.`}</span>
					</div>
					{moveError && <Notice error>{moveError}</Notice>}
					{state.loadError && !state.loaded && <Notice error>{state.loadError}</Notice>}
					{state.loaded && cameras.length === 0 ? (
						<div className="rounded-sm border border-line-100 bg-base-100">
							<EmptyState
								title={Object.keys(state.cameras).length === 0 ? 'No camera yet' : 'No camera of this site'}
								description="Add the RTSP address of an IP camera watching the observatory; its video is relayed to this browser only while you watch it."
								action={<Button onClick={() => setEditing('new')}>Add Camera</Button>}
							/>
						</div>
					) : (
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
							{cameras.map((camera, index) => (
								<CameraTile key={camera.id} camera={camera} canMove={{ up: index > 0, down: index < cameras.length - 1 }} onEdit={setEditing} onEnlarge={(c) => setEnlarged(c.id)} onMove={(c, direction) => void move(c, direction)} />
							))}
						</div>
					)}
				</div>
			</div>
			{editing && <CameraEditor camera={editing === 'new' ? undefined : editing} defaultSiteId={filter === ACTIVE_SITE ? activeSite?.id : filter === ALL_SITES ? undefined : filter} onClose={() => setEditing(undefined)} />}
			{enlarged && state.cameras[enlarged] && <EnlargedCamera camera={state.cameras[enlarged]} onClose={() => setEnlarged(undefined)} />}
		</WorkspaceLayout>
	)
}

// Notices about what the feature needs: MediaMTX, the key of the addresses, the gateway running, and the UDP port.
function FeatureNotices({ cameraCount }: { readonly cameraCount: number }) {
	const { gateway, secretKey, icePort } = useSnapshot(observatoryCamerasState)

	return (
		<>
			{gateway?.status === 'notInstalled' && (
				<div className="flex flex-wrap items-center gap-3 rounded-sm border border-line-100 bg-base-100 p-3">
					<p className="m-0 min-w-0 flex-1 text-sm leading-5 text-ink-200">{gateway.message ?? 'MediaMTX is not installed.'} Cameras can be added now and played once it is.</p>
					<Button variant="secondary" onClick={() => navigate(routeState, { workspace: 'settings', section: 'external-tools', tool: 'mediamtx' })}>
						Open External Tools
					</Button>
				</div>
			)}
			{(gateway?.status === 'unavailable' || gateway?.status === 'restarting') && (
				<Notice error={gateway.status === 'unavailable'}>
					{gateway.message ?? 'The media gateway is not available.'}
					{gateway.status === 'restarting' && ' It is restarting.'}
				</Notice>
			)}
			{secretKey && (secretKey.status === 'invalid' || (secretKey.status === 'unavailable' && cameraCount > 0)) && secretKey.message && <Notice error>{secretKey.message}</Notice>}
			{icePort !== undefined && <Notice>Video reaches this browser directly from the server over UDP port {icePort}: allow it in the server's firewall. Only signaling goes through this page.</Notice>}
		</>
	)
}

// Props of the enlarged view of a camera.
interface EnlargedCameraProps {
	// Camera shown.
	readonly camera: ObservatoryCamera
	// Closes the view.
	readonly onClose: () => void
}

// Enlarged view of a camera in a dialog; opening it starts the preview, which the tile shares.
function EnlargedCamera({ camera, onClose }: EnlargedCameraProps) {
	const player = useSnapshot(playerState).players[camera.id]
	const { streams, gateway } = useSnapshot(observatoryCamerasState)
	const video = useRef<HTMLVideoElement>(null)

	useEffect(() => startPlayer(camera.id), [camera.id])

	const status = cameraStatus(camera, streams[camera.id], player, gateway)
	const playing = player?.status === 'playing'

	return (
		<Modal open onClose={onClose} title={camera.name} className="max-w-6xl">
			<div className="flex flex-col gap-3">
				<div className="relative aspect-video bg-black">{player?.stream ? <CameraVideo cameraId={camera.id} videoRef={video} /> : <Placeholder text={player?.status === 'failed' ? 'Failed' : 'Connecting…'} />}</div>
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge tone={status.tone} label={status.label} />
					{status.detail && <span className="text-xs text-ink-300">{status.detail}</span>}
					<span className="ml-auto flex items-center gap-1">
						{player?.status === 'failed' && (
							<Button variant="secondary" onClick={() => startPlayer(camera.id)}>
								Retry
							</Button>
						)}
						<IconButton icon="fit" label="Full screen" disabled={!playing} onClick={() => requestFullscreen(video.current)} />
						{canPictureInPicture() && <IconButton icon="pictureInPicture" label="Picture in picture" disabled={!playing} onClick={() => togglePictureInPicture(video.current)} />}
					</span>
				</div>
			</div>
		</Modal>
	)
}
