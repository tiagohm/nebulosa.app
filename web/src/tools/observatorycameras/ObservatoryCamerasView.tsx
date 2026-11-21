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
import { CameraFrame, CameraMeta, CameraTile, PlaybackControls, TOUCH_BUTTON } from './CameraTile'
import { ALL_SITES, filterCameras, moveCamera, observatoryCamerasState, observatoryCamerasView, siteFilter, sortedCameras } from './observatorycameras'
import { isTileOnscreen, playerState, startPlayer, stopAllPlayers } from './player'
import { cameraStatus } from './status'

// Observatory Cameras tool: the IP cameras watching the observatory, in a grid. Nothing plays until the operator starts a
// preview, one tile at a time or every tile on screen at once; a preview can be enlarged, shown in full screen, or shown
// in picture-in-picture, which keeps playing in every workspace, and this browser can dim the video. The grid shows the
// cameras of one site and those shared by every site, the active site when the page opens, or every camera; the site
// filter appears once there is more than one site. Moving cameras in the grid is a mode of its own, Arrange. The cameras,
// the media gateway, and the key of their addresses are the server's; this view only edits them.

// Observatory Cameras tool.
export function ObservatoryCamerasView() {
	const state = useSnapshot(observatoryCamerasState)
	const { players } = useSnapshot(playerState)
	const { dimmed } = useSnapshot(observatoryCamerasView)
	const { sites } = useSnapshot(siteState)
	const activeSite = useActiveSite()
	const [chosenFilter, setFilter] = useState<string>()
	const [editing, setEditing] = useState<ObservatoryCamera | 'new'>()
	const [enlarged, setEnlarged] = useState<string>()
	const [arranging, setArranging] = useState(false)
	const [moveError, setMoveError] = useState<string>()
	const filter = siteFilter(
		chosenFilter,
		sites.map((site) => site.id),
		activeSite?.id,
	)
	const cameras = filterCameras(sortedCameras(state.cameras), filter)
	const playing = Object.keys(players).length
	const installed = state.gateway !== undefined && state.gateway.status !== 'notInstalled'
	const filterOptions = [ALL_SITES, ...sites.map((site) => site.id)]
	const startBlocked = !installed ? 'MediaMTX is not installed.' : cameras.length === 0 ? 'There is no camera to preview.' : undefined

	function startVisible() {
		for (const camera of cameras) if (camera.enabled && isTileOnscreen(camera.id)) startPlayer(camera.id)
	}

	async function move(camera: ObservatoryCamera, direction: -1 | 1) {
		setMoveError(await moveCamera(observatoryCamerasState, cameras, camera.id, direction))
	}

	const actions = (
		<>
			<Button disabled={startBlocked !== undefined} title={startBlocked} onClick={startVisible}>
				Play All
			</Button>
			<Button variant="secondary" disabled={playing === 0} title={playing === 0 ? 'No preview is playing.' : undefined} onClick={stopAllPlayers}>
				Stop All
			</Button>
			<Button variant="secondary" onClick={() => setEditing('new')}>
				Add Camera
			</Button>
		</>
	)

	return (
		<WorkspaceLayout workspace="tools" title="Observatory Cameras" actions={actions}>
			<div className="h-full overflow-y-auto bg-base-000">
				<div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
					<FeatureNotices cameraCount={Object.keys(state.cameras).length} />
					<div className="flex flex-wrap items-end gap-3">
						{sites.length > 1 && <Select label="Cameras of" className="w-64 flex-none" options={filterOptions} value={filter} onChange={setFilter} format={(value) => (value === ALL_SITES ? 'All sites' : (sites.find((site) => site.id === value)?.name ?? value))} />}
						<span className="pb-2 text-sm text-ink-300">{playing === 0 ? 'No preview is playing.' : `${playing} playing in this tab`}</span>
						<span className="ml-auto flex items-center gap-1">
							<IconButton icon="moon" label={dimmed ? 'Show the video at full brightness' : 'Dim the video'} pressed={dimmed} className={TOUCH_BUTTON} onClick={() => (observatoryCamerasView.dimmed = !dimmed)} />
							<IconButton icon="grip" label={cameras.length < 2 ? 'Arranging needs two cameras or more' : arranging ? 'Stop arranging the cameras' : 'Arrange the cameras'} pressed={arranging} className={TOUCH_BUTTON} disabled={cameras.length < 2 && !arranging} onClick={() => setArranging(!arranging)} />
						</span>
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
								<CameraTile key={camera.id} camera={camera} arranging={arranging} canMove={{ up: index > 0, down: index < cameras.length - 1 }} onEdit={setEditing} onEnlarge={(c) => setEnlarged(c.id)} onMove={(c, direction) => void move(c, direction)} />
							))}
						</div>
					)}
				</div>
			</div>
			{editing && <CameraEditor camera={editing === 'new' ? undefined : editing} defaultSiteId={filter === ALL_SITES ? undefined : filter} onClose={() => setEditing(undefined)} />}
			{enlarged && state.cameras[enlarged] && <EnlargedCamera camera={state.cameras[enlarged]} onClose={() => setEnlarged(undefined)} />}
		</WorkspaceLayout>
	)
}

// Notices about what the feature needs: MediaMTX, the key of the addresses, the gateway running, and, once a preview of
// this tab got no video, the UDP port the browser must reach.
function FeatureNotices({ cameraCount }: { readonly cameraCount: number }) {
	const { gateway, secretKey, icePort } = useSnapshot(observatoryCamerasState)
	const { players } = useSnapshot(playerState)
	const noVideo = Object.values(players).some((player) => player.noVideo === true && (player.status === 'failed' || player.status === 'reconnecting'))

	return (
		<>
			{gateway?.status === 'notInstalled' && (
				<div className="flex flex-wrap items-center gap-3">
					<div className="min-w-0 flex-1">
						<Notice>{gateway.message ?? 'MediaMTX is not installed.'} Cameras can be added now and played once it is.</Notice>
					</div>
					<Button variant="secondary" onClick={() => navigate(routeState, { workspace: 'settings', section: 'external-tools', tool: 'mediamtx' })}>
						Open External Tools
					</Button>
				</div>
			)}
			{(gateway?.status === 'unavailable' || gateway?.status === 'restarting') && (
				<Notice error={gateway.status === 'unavailable'}>
					{gateway.message ?? 'MediaMTX is not available.'}
					{gateway.status === 'restarting' && ' It is restarting.'}
				</Notice>
			)}
			{secretKey && (secretKey.status === 'invalid' || (secretKey.status === 'unavailable' && cameraCount > 0)) && secretKey.message && <Notice error>{secretKey.message}</Notice>}
			{noVideo && icePort !== undefined && <Notice error>No video reached this browser. The video comes straight from the server over UDP port {icePort}: allow that port in the firewall of the server and of this network.</Notice>}
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

// Enlarged view of a camera in a dialog, with the line and the playback controls of its tile; opening it starts the
// preview, which the tile shares, and Stop stops it without closing the view.
function EnlargedCamera({ camera, onClose }: EnlargedCameraProps) {
	const { players } = useSnapshot(playerState)
	const { streams, gateway } = useSnapshot(observatoryCamerasState)
	const video = useRef<HTMLVideoElement>(null)
	const status = cameraStatus(camera, streams[camera.id], players[camera.id], gateway)

	useEffect(() => startPlayer(camera.id), [camera.id])

	return (
		<Modal open onClose={onClose} title={camera.name} className="max-w-7xl">
			<div className="flex flex-col gap-3">
				<CameraFrame cameraId={camera.id} videoRef={video} />
				<div className="flex flex-wrap items-center gap-2">
					<StatusBadge tone={status.tone} label={status.label} />
					<div className="min-w-0 flex-1">
						<CameraMeta camera={camera} />
					</div>
				</div>
				{status.detail && <Notice error={status.tone === 'danger'}>{status.detail}</Notice>}
				<div className="flex flex-wrap items-center gap-1">
					<PlaybackControls camera={camera} video={video} />
				</div>
			</div>
		</Modal>
	)
}
