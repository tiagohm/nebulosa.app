import type { AlpacaDeviceServer } from 'nebulosa/src/alpaca.discovery'
import type { Angle } from 'nebulosa/src/angle'
import type { HipsSurvey } from 'nebulosa/src/hips2fits'
import type { Camera, Cover, Device, DeviceProperties, DeviceProperty, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, MountTargetCoordinate, Rotator, SlewRate, Thermometer, TrackMode, Wheel } from 'nebulosa/src/indi.device'
import type { Message, NewVector } from 'nebulosa/src/indi.types'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { DetectedStar } from 'nebulosa/src/stardetector'
// biome-ignore format: too long
import type { AlpacaServerStatus, AnnotatedSkyObject, AnnotateImage, AutoFocusStart, BodyPosition, CameraCaptureStart, ChartOfBody, CloseApproach, CloseImage, Confirm, Connect, ConnectionStatus, CoordinateInfo, CreateDirectory, DarvStart, DarvStop, DirectoryEntry, FileSystem, FindCloseApproaches, FindNextLunarEclipse, FindNextSolarEclipse, FlatWizardStart, Framing, GuidePulse, ImageHistogram, ImageInfo, IndiServerStart, IndiServerStatus, ListDirectory, LunarPhaseTime, MinorPlanet, MountRemoteControlProtocol, MountRemoteControlStart, MountRemoteControlStatus, NextLunarEclipse, NextSolarEclipse, OpenImage, PlateSolveStart, PlateSolveStop, PositionOfBody, Satellite, SaveImage, SearchMinorPlanet, SearchSatellite, SearchSkyObject, SolarSeasons, StarDetection, StatisticImage, TppaStart, TppaStop, Twilight } from 'src/shared/types'
import { type ImageCoordinateInterpolation, type SkyObjectSearchItem, X_IMAGE_INFO_HEADER } from 'src/shared/types'

export const API_URL = localStorage.getItem('api.uri') || `${location.protocol}//${location.host}`

const DEFAULT_HEADERS: HeadersInit = {
	'Content-Type': 'application/json',
	Accept: 'application/json',
}

export namespace Api {
	export namespace FileSystem {
		export function list(req: ListDirectory) {
			return json<FileSystem>('/filesystem/list', 'post', req)
		}

		export function create(req: CreateDirectory) {
			return json<{ path: string }>('/filesystem/create', 'post', req)
		}

		export function directory(req: string) {
			return json<{ path?: string }>('/filesystem/directory', 'post', req)
		}

		export function exists(req: DirectoryEntry) {
			return json<boolean>('/filesystem/exists', 'post', req)
		}

		export function join(req: string[]) {
			return json<{ path: string }>('/filesystem/join', 'post', req)
		}
	}

	export namespace Connection {
		export function list() {
			return json<ConnectionStatus[]>('/connections', 'get')
		}

		export function connect(req: Connect | ConnectionStatus) {
			return json<ConnectionStatus>('/connections', 'post', req)
		}

		export function get(id: string) {
			return json<ConnectionStatus>(`/connections/${id}`, 'get')
		}

		export function disconnect(id: string) {
			return res(`/connections/${id}`, 'delete')
		}
	}

	export namespace Confirmation {
		export function confirm(req: Confirm) {
			return res('/confirmation', 'post', req)
		}
	}

	export namespace Image {
		export async function open(req: OpenImage) {
			const response = await res('/image/open', 'post', req)
			if (!response || response.status < 200 || response.status >= 300) return undefined
			const blob = await response.blob()
			const info = JSON.parse(decodeURIComponent(response.headers.get(X_IMAGE_INFO_HEADER)!)) as ImageInfo
			return { blob, info }
		}

		export function close(req: CloseImage) {
			return res('/image/close', 'post', req)
		}

		export function ping(req: CloseImage) {
			return res('/image/ping', 'post', req)
		}

		export function save(req: SaveImage) {
			return res('/image/save', 'post', req)
		}

		export function annotate(req: AnnotateImage) {
			return json<AnnotatedSkyObject[]>('/image/annotate', 'post', req)
		}

		export function coordinateInterpolation(req: PlateSolution) {
			return json<ImageCoordinateInterpolation>('/image/coordinateinterpolation', 'post', req)
		}

		export function statistics(req: StatisticImage) {
			return json<ImageHistogram[]>('/image/statistics', 'post', req)
		}
	}

	export namespace Indi {
		export function devices(connection: ConnectionStatus) {
			return json<string[]>(`/indi/devices?client=${connection.id}`, 'get')
		}

		export function connect(device: Device) {
			return res(`/indi/${device.name}/connect?client=${device.client.id}`, 'post')
		}

		export function disconnect(device: Device) {
			return res(`/indi/${device.name}/disconnect?client=${device.client.id}`, 'post')
		}

		export function messages(device: string | undefined, connection: ConnectionStatus) {
			return json<Message[]>(`/indi/messages?device=${device ?? ''}&client=${connection.id}`, 'get')
		}

		export namespace Properties {
			export function list(device: string, connection: ConnectionStatus) {
				return json<DeviceProperties>(`/indi/${device}/properties?client=${connection.id}`, 'get')
			}

			export function send(device: string, type: DeviceProperty['type'], message: NewVector, connection: ConnectionStatus) {
				return json<DeviceProperties>(`/indi/${device}/properties/send?type=${type}&client=${connection.id}`, 'post', message)
			}

			export function ping(device: string, connection: ConnectionStatus) {
				return res(`/indi/${device}/properties/ping?client=${connection.id}`, 'post')
			}
		}

		export namespace Server {
			export function start(req: IndiServerStart) {
				return res('/indi/server/start', 'post', req)
			}

			export function stop() {
				return res('/indi/server/stop', 'post')
			}

			export function status() {
				return json<IndiServerStatus>('/indi/server/status', 'get')
			}

			export function drivers() {
				return json<string[]>('/indi/server/drivers', 'get')
			}
		}
	}

	export namespace Cameras {
		export function list(connection: ConnectionStatus) {
			return json<Camera[]>(`/cameras?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<Camera>(`/cameras/${name}?client=${connection.id}`, 'get')
		}

		export function cooler(camera: Camera, enabled: boolean) {
			return res(`/cameras/${camera.name}/cooler?client=${camera.client.id}`, 'post', enabled)
		}

		export function temperature(camera: Camera, value: number) {
			return res(`/cameras/${camera.name}/temperature?client=${camera.client.id}`, 'post', value)
		}

		export function start(camera: Camera, req: CameraCaptureStart) {
			return res(`/cameras/${camera.name}/start?client=${camera.client.id}`, 'post', req)
		}

		export function stop(camera: Camera) {
			return res(`/cameras/${camera.name}/stop?client=${camera.client.id}`, 'post')
		}
	}

	export namespace Mounts {
		export function list(connection: ConnectionStatus) {
			return json<Mount[]>(`/mounts?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<Mount>(`/mounts/${name}?client=${connection.id}`, 'get')
		}

		export function goTo(mount: Mount, coordinate: MountTargetCoordinate<string | Angle>) {
			return res(`/mounts/${mount.name}/goto?client=${mount.client.id}`, 'post', coordinate)
		}

		export function sync(mount: Mount, coordinate: MountTargetCoordinate<string | Angle>) {
			return res(`/mounts/${mount.name}/sync?client=${mount.client.id}`, 'post', coordinate)
		}

		export function park(mount: Mount) {
			return res(`/mounts/${mount.name}/park?client=${mount.client.id}`, 'post')
		}

		export function unpark(mount: Mount) {
			return res(`/mounts/${mount.name}/unpark?client=${mount.client.id}`, 'post')
		}

		export function home(mount: Mount) {
			return res(`/mounts/${mount.name}/home?client=${mount.client.id}`, 'post')
		}

		export function findHome(mount: Mount) {
			return res(`/mounts/${mount.name}/findhome?client=${mount.client.id}`, 'post')
		}

		export function tracking(mount: Mount, enable: boolean) {
			return res(`/mounts/${mount.name}/tracking?client=${mount.client.id}`, 'post', enable)
		}

		export function trackMode(mount: Mount, mode: TrackMode) {
			return res(`/mounts/${mount.name}/trackmode?client=${mount.client.id}`, 'post', mode)
		}

		export function slewRate(mount: Mount, rate: SlewRate | string) {
			return res(`/mounts/${mount.name}/slewrate?client=${mount.client.id}`, 'post', rate)
		}

		export function moveNorth(mount: Mount, enable: boolean) {
			return res(`/mounts/${mount.name}/movenorth?client=${mount.client.id}`, 'post', enable)
		}

		export function moveSouth(mount: Mount, enable: boolean) {
			return res(`/mounts/${mount.name}/movesouth?client=${mount.client.id}`, 'post', enable)
		}

		export function moveEast(mount: Mount, enable: boolean) {
			return res(`/mounts/${mount.name}/moveeast?client=${mount.client.id}`, 'post', enable)
		}

		export function moveWest(mount: Mount, enable: boolean) {
			return res(`/mounts/${mount.name}/movewest?client=${mount.client.id}`, 'post', enable)
		}

		export function location(mount: Mount, coordinate: GeographicCoordinate) {
			return res(`/mounts/${mount.name}/location?client=${mount.client.id}`, 'post', coordinate)
		}

		export function time(mount: Mount, time: Mount['time']) {
			return res(`/mounts/${mount.name}/time?client=${mount.client.id}`, 'post', time)
		}

		export function stop(mount: Mount) {
			return res(`/mounts/${mount.name}/stop?client=${mount.client.id}`, 'post')
		}

		export function currentPosition(mount: Mount) {
			return json<CoordinateInfo>(`/mounts/${mount.name}/position/current?client=${mount.client.id}`, 'post')
		}

		export function targetPosition(mount: Mount, target: MountTargetCoordinate) {
			return json<CoordinateInfo>(`/mounts/${mount.name}/position/target?client=${mount.client.id}`, 'post', target)
		}

		export namespace RemoteControl {
			export function start(mount: Mount, req: MountRemoteControlStart) {
				return res(`/mounts/${mount.name}/remotecontrol/start?client=${mount.client.id}`, 'post', req)
			}

			export function stop(mount: Mount, protocol: MountRemoteControlProtocol) {
				return res(`/mounts/${mount.name}/remotecontrol/stop?client=${mount.client.id}`, 'post', protocol)
			}

			export function status(mount: Mount) {
				return json<MountRemoteControlStatus>(`/mounts/${mount.name}/remotecontrol?client=${mount.client.id}`, 'get')
			}
		}
	}

	export namespace Focusers {
		export function list(connection: ConnectionStatus) {
			return json<Focuser[]>(`/focusers?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<Focuser>(`/focusers/${name}?client=${connection.id}`, 'get')
		}

		export function sync(focuser: Focuser, position: number) {
			return res(`/focusers/${focuser.name}/sync?client=${focuser.client.id}`, 'post', position)
		}

		export function moveTo(focuser: Focuser, position: number) {
			return res(`/focusers/${focuser.name}/moveto?client=${focuser.client.id}`, 'post', position)
		}

		export function moveIn(focuser: Focuser, steps: number) {
			return res(`/focusers/${focuser.name}/movein?client=${focuser.client.id}`, 'post', steps)
		}

		export function moveOut(focuser: Focuser, steps: number) {
			return res(`/focusers/${focuser.name}/moveout?client=${focuser.client.id}`, 'post', steps)
		}

		export function reverse(focuser: Focuser, enabled: boolean) {
			return res(`/focusers/${focuser.name}/reverse?client=${focuser.client.id}`, 'post', enabled)
		}

		export function stop(focuser: Focuser) {
			return res(`/focusers/${focuser.name}/stop?client=${focuser.client.id}`, 'post')
		}
	}

	export namespace Wheels {
		export function list(connection: ConnectionStatus) {
			return json<Wheel[]>(`/wheels?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<Wheel>(`/wheels/${name}?client=${connection.id}`, 'get')
		}

		export function moveTo(wheel: Wheel, position: number) {
			return res(`/wheels/${wheel.name}/moveto?client=${wheel.client.id}`, 'post', position)
		}

		export function names(wheel: Wheel, names: string[]) {
			return res(`/wheels/${wheel.name}/names?client=${wheel.client.id}`, 'post', names)
		}
	}

	export namespace Thermometers {
		export function list(connection: ConnectionStatus) {
			return json<Thermometer[]>(`/thermometers?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<Thermometer>(`/thermometers/${name}?client=${connection.id}`, 'get')
		}
	}

	export namespace GuideOutputs {
		export function list(connection: ConnectionStatus) {
			return json<GuideOutput[]>(`/guideoutputs?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<GuideOutput>(`/guideoutputs/${name}?client=${connection.id}`, 'get')
		}

		export function pulse(guideOutput: GuideOutput, req: GuidePulse) {
			return res(`/guideoutputs/${guideOutput.name}/pulse?client=${guideOutput.client.id}`, 'post', req)
		}
	}

	export namespace Covers {
		export function list(connection: ConnectionStatus) {
			return json<Cover[]>(`/covers?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<Cover>(`/covers/${name}?client=${connection.id}`, 'get')
		}

		export function park(cover: Cover) {
			return res(`/covers/${cover.name}/park?client=${cover.client.id}`, 'post')
		}

		export function stop(cover: Cover) {
			return res(`/covers/${cover.name}/stop?client=${cover.client.id}`, 'post')
		}

		export function unpark(cover: Cover) {
			return res(`/covers/${cover.name}/unpark?client=${cover.client.id}`, 'post')
		}
	}

	export namespace FlatPanels {
		export function list(connection: ConnectionStatus) {
			return json<FlatPanel[]>(`/flatpanels?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<FlatPanel>(`/flatpanels/${name}?client=${connection.id}`, 'get')
		}

		export function enable(flatPanel: FlatPanel) {
			return res(`/flatpanels/${flatPanel.name}/enable?client=${flatPanel.client.id}`, 'post')
		}

		export function disable(flatPanel: FlatPanel) {
			return res(`/flatpanels/${flatPanel.name}/disable?client=${flatPanel.client.id}`, 'post')
		}

		export function intensity(flatPanel: FlatPanel, value: number) {
			return res(`/flatpanels/${flatPanel.name}/intensity?client=${flatPanel.client.id}`, 'post', value)
		}
	}

	export namespace Rotators {
		export function list(connection: ConnectionStatus) {
			return json<Rotator[]>(`/rotators?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<Rotator>(`/rotators/${name}?client=${connection.id}`, 'get')
		}

		export function sync(rotator: Rotator, angle: number) {
			return res(`/rotators/${rotator.name}/sync?client=${rotator.client.id}`, 'post', angle)
		}

		export function moveTo(rotator: Rotator, angle: number) {
			return res(`/rotators/${rotator.name}/moveto?client=${rotator.client.id}`, 'post', angle)
		}

		export function reverse(rotator: Rotator, enabled: boolean) {
			return res(`/rotators/${rotator.name}/reverse?client=${rotator.client.id}`, 'post', enabled)
		}

		export function home(rotator: Rotator) {
			return res(`/rotators/${rotator.name}/home?client=${rotator.client.id}`, 'post')
		}

		export function stop(rotator: Rotator) {
			return res(`/rotators/${rotator.name}/stop?client=${rotator.client.id}`, 'post')
		}
	}

	export namespace DewHeaters {
		export function list(connection: ConnectionStatus) {
			return json<DewHeater[]>(`/dewheaters?client=${connection.id}`, 'get')
		}

		export function get(name: string, connection: ConnectionStatus) {
			return json<DewHeater>(`/dewheaters/${name}?client=${connection.id}`, 'get')
		}

		export function dutyCycle(dewHeater: DewHeater, value: number) {
			return res(`/dewheaters/${dewHeater.name}/dutycycle?client=${dewHeater.client.id}`, 'post', value)
		}
	}

	export namespace SkyAtlas {
		export function positionOfSun(req: PositionOfBody) {
			return json<BodyPosition>('/atlas/sun/position', 'post', req)
		}

		export function chartOfSun(req: PositionOfBody) {
			return json<number[]>('/atlas/sun/chart', 'post', req)
		}

		export function seasons(req: PositionOfBody) {
			return json<SolarSeasons>('/atlas/sun/seasons', 'post', req)
		}

		export function twilight(req: PositionOfBody) {
			return json<Twilight>('/atlas/sun/twilight', 'post', req)
		}

		export function solarEclipses(req: FindNextSolarEclipse) {
			return json<NextSolarEclipse[]>('/atlas/sun/eclipses', 'post', req)
		}

		export function positionOfMoon(req: PositionOfBody) {
			return json<BodyPosition>('/atlas/moon/position', 'post', req)
		}

		export function chartOfMoon(req: PositionOfBody) {
			return json<number[]>('/atlas/moon/chart', 'post', req)
		}

		export function moonPhases(req: PositionOfBody) {
			return json<LunarPhaseTime[]>('/atlas/moon/phases', 'post', req)
		}

		export function moonEclipses(req: FindNextLunarEclipse) {
			return json<NextLunarEclipse[]>('/atlas/moon/eclipses', 'post', req)
		}

		export function positionOfPlanet(req: PositionOfBody, code: string) {
			return json<BodyPosition>(`/atlas/planets/${code}/position`, 'post', req)
		}

		export function chartOfPlanet(req: PositionOfBody, code: string) {
			return json<number[]>(`/atlas/planets/${code}/chart`, 'post', req)
		}

		export function searchMinorPlanet(req: SearchMinorPlanet) {
			return json<MinorPlanet>('/atlas/minorplanets/search', 'post', req)
		}

		export function findCloseApproaches(req: FindCloseApproaches) {
			return json<CloseApproach[]>('/atlas/minorplanets/closeapproaches', 'post', req)
		}

		export function searchSkyObject(req: SearchSkyObject) {
			return json<SkyObjectSearchItem[]>('/atlas/skyobjects/search', 'post', req)
		}

		export function positionOfSkyObject(req: PositionOfBody, id: string | number) {
			return json<BodyPosition>(`/atlas/skyobjects/${id}/position`, 'post', req)
		}

		export function chartOfSkyObject(req: ChartOfBody, id: string | number) {
			return json<number[]>(`/atlas/skyobjects/${id}/chart`, 'post', req)
		}

		export function searchSatellite(req: SearchSatellite) {
			return json<Satellite[]>('/atlas/satellites/search', 'post', req)
		}

		export function positionOfSatellite(req: PositionOfBody, id: string | number) {
			return json<BodyPosition>(`/atlas/satellites/${id}/position`, 'post', req)
		}

		export function chartOfSatellite(req: PositionOfBody, id: string | number) {
			return json<number[]>(`/atlas/satellites/${id}/chart`, 'post', req)
		}
	}

	export namespace PlateSolver {
		export function start(req: PlateSolveStart) {
			return json<PlateSolution>('/platesolver/start', 'post', req)
		}

		export function stop(req: PlateSolveStop) {
			return res('/platesolver/stop', 'post', req)
		}
	}

	export namespace StarDetection {
		export function detect(req: StarDetection) {
			return json<DetectedStar[]>('/stardetection', 'post', req)
		}
	}

	export namespace Framing {
		export function hipsSurveys() {
			return json<HipsSurvey[]>('/framing/hips-surveys', 'get')
		}

		export function frame(req: Framing) {
			return json<{ path: string }>('/framing', 'post', req)
		}
	}

	export namespace TPPA {
		export function start(camera: Camera, mount: Mount, req: TppaStart) {
			return res(`/tppa/${camera.name}/${mount.name}/start?client=${camera.client.id}`, 'post', req)
		}

		export function stop(req: TppaStop) {
			return res('/tppa/stop', 'post', req)
		}
	}

	export namespace DARV {
		export function start(camera: Camera, mount: Mount, req: DarvStart) {
			return res(`/darv/${camera.name}/${mount.name}/start?client=${camera.client.id}`, 'post', req)
		}

		export function stop(req: DarvStop) {
			return res('/darv/stop', 'post', req)
		}
	}

	export namespace AutoFocus {
		export function start(camera: Camera, focuser: Focuser, req: AutoFocusStart) {
			return res(`/autofocus/${camera.name}/${focuser.name}/start?client=${camera.client.id}`, 'post', req)
		}

		export function stop(camera: Camera, focuser: Focuser) {
			return res(`/autofocus/${camera.name}/${focuser.name}/stop?client=${camera.client.id}`, 'post')
		}
	}

	export namespace FlatWizard {
		export function start(camera: Camera, req: FlatWizardStart) {
			return res(`/flatwizard/${camera.name}/start?client=${camera.client.id}`, 'post', req)
		}

		export function stop(camera: Camera) {
			return res(`/flatwizard/${camera.name}/stop?client=${camera.client.id}`, 'post')
		}
	}

	export namespace Alpaca {
		export function status() {
			return json<AlpacaServerStatus>('/alpaca/status', 'get')
		}

		export function start(port: number) {
			return res(`/alpaca/start?port=${port}`, 'post')
		}

		export function stop() {
			return res('/alpaca/stop', 'post')
		}

		export function discovery() {
			return json<readonly AlpacaDeviceServer[]>('/alpaca/discovery', 'post')
		}
	}
}

function req(path: string, method: 'get' | 'post' | 'put' | 'delete', body?: unknown) {
	const options: RequestInit = { method, cache: 'no-cache', headers: DEFAULT_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) }
	return fetch(`${API_URL}${path}`, options)
}

async function json<T>(path: string, method: 'get' | 'post' | 'put', body?: unknown) {
	const response = await req(path, method, body)
	if (!response.ok) return undefined
	const text = await response.text()
	return text ? (JSON.parse(text) as T) : undefined
}

function res(path: string, method: 'get' | 'post' | 'put' | 'delete', body?: unknown) {
	return req(path, method, body)
}
