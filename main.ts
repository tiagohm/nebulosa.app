import { existsSync, rmSync } from 'fs'
import type { MakeDirectoryOptions } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import { join } from 'path'
import { parseArgs } from 'util'
import type { Client, Device, DewHeater, GuideOutput, Thermometer } from 'nebulosa/src/devices/indi/device'
import { CameraManager, CoverManager, DewHeaterManager, FlatPanelManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, ThermometerManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import type { DeviceProvider } from 'nebulosa/src/devices/indi/manager'
import { default as openDefaultApp } from 'open'
import { AlpacaHandler, alpaca } from 'src/api/alpaca'
import { coordinatedAlpacaManagers } from 'src/api/alpaca.adapter'
import { AtlasHandler, atlas } from 'src/api/atlas'
import { AutoFocusHandler, autoFocus } from 'src/api/autofocus'
import { CameraHandler, camera } from 'src/api/camera'
import { CameraCapturer } from 'src/api/camera.capture'
import { CameraCommander } from 'src/api/camera.commander'
import { ConnectionHandler, connection } from 'src/api/connection'
import { CoverHandler, cover } from 'src/api/cover'
import { CoverCommander } from 'src/api/cover.commander'
import { DarvHandler, darv } from 'src/api/darv'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { DewHeaterHandler, dewHeater } from 'src/api/dewheater'
import { DewHeaterCommander } from 'src/api/dewheater.commander'
import { FlatPanelHandler, flatPanel } from 'src/api/flatpanel'
import { FlatPanelCommander } from 'src/api/flatpanel.commander'
import { FlatWizardHandler, flatWizard } from 'src/api/flatwizard'
import { FocuserHandler, focuser } from 'src/api/focuser'
import { FocuserCommander } from 'src/api/focuser.commander'
import { GuideOutputHandler, guideOutput } from 'src/api/guideoutput'
import { GuideOutputCommander } from 'src/api/guideoutput.commander'
import { GuiderHandler, guider } from 'src/api/guider'
import { GuiderCommander } from 'src/api/guider.session'
import type { GuiderCameraPublisher } from 'src/api/guider.session'
import { NOT_FOUND_RESPONSE } from 'src/api/http'
import { IndiDevicePropertyHandler, IndiHandler, IndiServerHandler, indi } from 'src/api/indi'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler, MountRemoteControlHandler, mount } from 'src/api/mount'
import { MountCommander } from 'src/api/mount.commander'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter, resourceDevice, resourceKey } from 'src/api/resource'
import { RotatorHandler, rotator } from 'src/api/rotator'
import { RotatorCommander } from 'src/api/rotator.commander'
import { storage, StorageHandler } from 'src/api/storage'
import { ThermometerHandler, thermometer } from 'src/api/thermometer'
import { TppaHandler, tppa } from 'src/api/tppa'
import { WheelHandler, wheel } from 'src/api/wheel'
import { WheelCommander } from 'src/api/wheel.commander'
import { speedUpTime } from 'src/shared/util'
import type { SequencerDeviceRole } from '#/sequencer'
import { ConfirmationHandler, confirmation } from './src/api/confirmation'
import { FileSystemHandler, fileSystem } from './src/api/filesystem'
import { FramingHandler, framing } from './src/api/framing'
import { ImageHandler, image } from './src/api/image'
import { ImageProcessor } from './src/api/image.processor'
import { PlateSolverHandler, plateSolver } from './src/api/platesolver'
import { SequencerHandler, sequencer } from './src/api/sequencer'
import { sequencerCaptureHandler } from './src/api/sequencer.capture'
import { SequencerChannel } from './src/api/sequencer.channel'
import { sequencerMeridianFlipHandler } from './src/api/sequencer.flip'
import { sequencerAutofocusHandler } from './src/api/sequencer.focus'
import { sequencerDitherHandler } from './src/api/sequencer.guiding'
import { sequencerLifecycleHandlers } from './src/api/sequencer.lifecycle'
import { SequencerPlannerHandler, sequencerPlanner } from './src/api/sequencer.planner'
import { sequencerCenterHandler, sequencerSlewHandler } from './src/api/sequencer.pointing'
import { SequencerBlockRegistry } from './src/api/sequencer.registry'
import { SequencerRuntime } from './src/api/sequencer.runtime'
import type { SequencerDeviceResolver } from './src/api/sequencer.runtime'
import { InMemorySequencerStore } from './src/api/sequencer.store'
import { StarDetectionHandler, starDetection } from './src/api/stardetection'
import homeHtml from './src/web/pages/home/index.html'

speedUpTime()

const CREATE_RECURSIVE_DIRECTORY: MakeDirectoryOptions = { recursive: true }

// Arguments

const args = parseArgs({
	args: Bun.argv,
	options: {
		host: { type: 'string', short: 'h' },
		port: { type: 'string', short: 'p' },
		secure: { type: 'boolean', short: 's' },
		cert: { type: 'string', short: 'c' },
		key: { type: 'string', short: 'k' },
		open: { type: 'boolean', short: 'o' },
		dir: { type: 'string', short: 'd' },
		username: { type: 'string', short: 'u' },
		password: { type: 'string' },
		alpaca: { type: 'boolean', short: 'a' },
		alpacaPort: { type: 'string' },
		alpacaDiscoveryPort: { type: 'string' },
	},
	strict: true,
	allowPositionals: true,
})

const hostname = args.values.host || Bun.env.host || 'localhost'
const port = +(args.values.port || Bun.env.port || '1234')
const cert = args.values.cert || Bun.env.cert || 'cert.pem'
const key = args.values.key || Bun.env.key || 'key.pem'
const secure = args.values.secure || Bun.env.secure === 'true' || undefined
const open = !!args.values.open || Bun.env.open === 'true'
const appDir = args.values.dir || Bun.env.appDir
const username = args.values.username || Bun.env.username || ''
const password = args.values.password || Bun.env.password || ''
const hasAlpaca = args.values.alpaca || Bun.env.alpaca === 'true'
const alpacaPort = +(args.values.alpacaPort || Bun.env.alpacaPort || '') || undefined
const alpacaDiscoveryPort = +(args.values.alpacaDiscoveryPort || Bun.env.alpacaDiscoveryPort || '') || undefined

// Initialize the environment variables

async function checkDirAccess(...paths: string[]) {
	const path = join(...paths)

	try {
		await fs.access(path, fs.constants.R_OK | fs.constants.W_OK)
	} catch {
		console.error('unable to access the app directory at', Bun.env.homeDir)
		process.exit(0)
	}

	return path
}

if (appDir) {
	await checkDirAccess(appDir)
} else {
	Bun.env.homeDir = await checkDirAccess(os.homedir())
}

if (process.platform === 'linux') {
	Bun.env.tmpDir = join(await checkDirAccess('/dev/shm'), 'nebulosa')
	Bun.env.appDir = appDir || join(Bun.env.homeDir, '.nebulosa')
	Bun.env.capturesDir = join(Bun.env.appDir, 'captures')
	Bun.env.satellitesDir = join(Bun.env.appDir, 'satellites')
} else if (process.platform === 'win32') {
	const documentsDir = appDir || join(await checkDirAccess(Bun.env.homeDir, 'Documents'), 'Nebulosa')
	Bun.env.appDir = appDir || join(await checkDirAccess(Bun.env.homeDir, 'AppData', 'Local'), 'Nebulosa')
	Bun.env.tmpDir = join(Bun.env.appDir, 'Temp')
	Bun.env.capturesDir = join(documentsDir, 'Captures')
	Bun.env.satellitesDir = join(Bun.env.appDir, 'Satellites')
}

await fs.mkdir(Bun.env.appDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.tmpDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.capturesDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.satellitesDir, CREATE_RECURSIVE_DIRECTORY)

console.info('app directory is located at', Bun.env.appDir)
console.info('captures directory is located at', Bun.env.capturesDir)
console.info('temp directory is located at', Bun.env.tmpDir)

// Running from package.json script has a bug on interrupt signals: https://github.com/oven-sh/bun/issues/11400

// Removes transient files created by the current or a previous process.
function clearTemporaryDirectories() {
	if (existsSync(Bun.env.tmpDir)) {
		console.info('clearing temp directory...')
		rmSync(Bun.env.tmpDir, { recursive: true })
	}
}

clearTemporaryDirectories()

// DNS caching

process.env.BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS = '86400'

Bun.dns.prefetch('celestrak.org')
Bun.dns.prefetch('ssd.jpl.nasa.gov')
Bun.dns.prefetch('sdo.gsfc.nasa.gov')
Bun.dns.prefetch('hpiers.obspm.fr')

// Handlers & INDI Devices

const wsm = new WebSocketMessageHandler()
const imageProcessor = new ImageProcessor()

const cameraManager = new CameraManager()
const focuserManager = new FocuserManager()
const wheelManager = new WheelManager()
const mountManager = new MountManager()
const coverManager = new CoverManager()
const flatPanelManager = new FlatPanelManager()
const rotatorManager = new RotatorManager()

const guideOutputProvider: DeviceProvider<GuideOutput> = {
	get: (client: Client | string | undefined, name: string) => cameraManager.get(client, name) ?? mountManager.get(client, name),
}

const thermometerProvider: DeviceProvider<Thermometer> = {
	get: (client: Client | string | undefined, name: string) => cameraManager.get(client, name) ?? focuserManager.get(client, name),
}

const dewHeaterProvider: DeviceProvider<DewHeater> = {
	get: (client: Client | string | undefined, name: string) => coverManager.get(client, name),
}

const guideOutputManager = new GuideOutputManager(guideOutputProvider)
const thermometerManager = new ThermometerManager(thermometerProvider)
const dewHeaterManager = new DewHeaterManager(dewHeaterProvider)

// Process-wide authority for exclusive physical and logical resource ownership.
const resourceArbiter = new ResourceArbiter()
// Process-wide owner and cancellation registry for top-level operations.
const operationCoordinator = new OperationCoordinator(resourceArbiter)
// Internal manager observer that blocks and cancels resources across device lifecycle transitions.
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)

// Shared terminal path that cancels operations before lifecycle disposal and process exit.
let shutdownTask: Promise<void> | undefined

// Ends the running session, cancels active operations while transports are live, then releases observers and
// transient files.
//
// The sequencer goes first and in one piece (§20.2): it refuses new sessions, records the one it is running as
// interrupted, cancels every operation owned by that session's reservation, waits for their cleanups and only
// then releases the reservation. Doing that before `cancelAll` is what keeps the order observable — a session
// torn down by `cancelAll` would lose the state that was never written, and the owned guiding session, whose
// handle lives in the guider commander rather than in the runtime, would escape past the release. The
// sequencer is wired further down, so `shutdown` is only ever called once it exists.
function shutdown() {
	return (shutdownTask ??= (async () => {
		await sequencerRuntime.shutdown()
		sequencerChannel.close()
		await operationCoordinator.cancelAll('aborted')
		deviceLifecycle.dispose()
		clearTemporaryDirectories()
		process.exit(0)
	})())
}

deviceLifecycle.observe(cameraManager)
deviceLifecycle.observe(mountManager)
deviceLifecycle.observe(focuserManager)
deviceLifecycle.observe(wheelManager)
deviceLifecycle.observe(coverManager)
deviceLifecycle.observe(flatPanelManager)
deviceLifecycle.observe(rotatorManager)
deviceLifecycle.observe(guideOutputManager)
deviceLifecycle.observe(thermometerManager)
deviceLifecycle.observe(dewHeaterManager)

const notificationHandler = new NotificationHandler(wsm)
const connectionHandler = new ConnectionHandler(wsm, notificationHandler, operationCoordinator)
const confirmationHandler = new ConfirmationHandler(wsm)
const guiderCommander = new GuiderCommander(operationCoordinator, cameraManager, guideOutputManager)
const guiderHandler = new GuiderHandler(wsm, notificationHandler, guiderCommander)
const cameraCapturer = new CameraCapturer(cameraManager, imageProcessor, resourceArbiter, guiderCommander)
const cameraCommander = new CameraCommander(cameraManager)
const cameraHandler = new CameraHandler(wsm, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, notificationHandler, cameraCapturer, cameraCommander, operationCoordinator)
const guiderCameraPublisher: GuiderCameraPublisher = { watch: cameraCapturer.watch.bind(cameraCapturer), imageProcessor, listener: cameraHandler.sendEvent.bind(cameraHandler) }
guiderCommander.attachCameraPublisher(guiderCameraPublisher)
const mountCommander = new MountCommander(mountManager)
const mountHandler = new MountHandler(wsm, mountManager, confirmationHandler, notificationHandler, mountCommander, operationCoordinator)
const mountRemoteControlHandler = new MountRemoteControlHandler(mountManager, notificationHandler, mountCommander, operationCoordinator)
const focuserCommander = new FocuserCommander(focuserManager)
const focuserHandler = new FocuserHandler(wsm, focuserManager, notificationHandler, focuserCommander, operationCoordinator)
const wheelCommander = new WheelCommander(wheelManager)
const wheelHandler = new WheelHandler(wsm, wheelManager, notificationHandler, wheelCommander, operationCoordinator)
const thermometerHandler = new ThermometerHandler(wsm, thermometerManager)
const guideOutputCommander = new GuideOutputCommander(guideOutputManager)
const guideOutputHandler = new GuideOutputHandler(wsm, guideOutputManager, notificationHandler, guideOutputCommander, operationCoordinator)
const coverCommander = new CoverCommander(coverManager)
const coverHandler = new CoverHandler(wsm, coverManager, notificationHandler, coverCommander, operationCoordinator)
const flatPanelCommander = new FlatPanelCommander(flatPanelManager)
const flatPanelHandler = new FlatPanelHandler(wsm, flatPanelManager, flatPanelCommander, operationCoordinator)
const rotatorCommander = new RotatorCommander(rotatorManager)
const rotatorHandler = new RotatorHandler(wsm, rotatorManager, notificationHandler, rotatorCommander, operationCoordinator)
const dewHeaterCommander = new DewHeaterCommander(dewHeaterManager)
const dewHeaterHandler = new DewHeaterHandler(wsm, dewHeaterManager, dewHeaterCommander, operationCoordinator)
const indiHandler = new IndiHandler(cameraManager, guideOutputManager, thermometerManager, mountManager, focuserManager, wheelManager, coverManager, flatPanelManager, dewHeaterManager, rotatorManager, wsm)
const indiDevicePropertyHandler = new IndiDevicePropertyHandler(wsm, notificationHandler, indiHandler)
const indiServerHandler = new IndiServerHandler(wsm)
const framingHandler = new FramingHandler(imageProcessor)
const fileSystemHandler = new FileSystemHandler()
const starDetectionHandler = new StarDetectionHandler(imageProcessor)
const plateSolverHandler = new PlateSolverHandler(notificationHandler, imageProcessor)
const atlasHandler = new AtlasHandler(notificationHandler)
const sequencerPlannerHandler = new SequencerPlannerHandler()
const imageHandler = new ImageHandler(imageProcessor, notificationHandler)
const tppaHandler = new TppaHandler(wsm, cameraHandler, mountHandler, plateSolverHandler, operationCoordinator)
const darvHandler = new DarvHandler(wsm, cameraHandler, mountHandler, guideOutputHandler, operationCoordinator)
const autoFocusHandler = new AutoFocusHandler(wsm, cameraHandler, focuserHandler, starDetectionHandler, operationCoordinator)
const flatWizardHandler = new FlatWizardHandler(wsm, cameraHandler, imageProcessor, operationCoordinator)
// Alpaca is a second ingress into the same devices, so it writes through coordinated managers instead of
// the raw ones and competes for the same resource keys as the routes and the composite features.
const alpacaManagers = coordinatedAlpacaManagers(
	{ camera: cameraManager, mount: mountManager, focuser: focuserManager, wheel: wheelManager, cover: coverManager, flatPanel: flatPanelManager, rotator: rotatorManager, guideOutput: guideOutputManager },
	{ camera: cameraCommander, mount: mountCommander, focuser: focuserCommander, wheel: wheelCommander, cover: coverCommander, flatPanel: flatPanelCommander, guideOutput: guideOutputCommander },
	operationCoordinator,
)
const alpacaHandler = new AlpacaHandler(wsm, alpacaManagers, alpacaDiscoveryPort)
const storageHandler = new StorageHandler(false)

// Sequencer (§20.1)
//
// The store is the durable state of every definition and session, the registry is the catalog of blocks a
// definition may be compiled against, and the runtime is the only thing that admits, executes and finalizes a
// session. They are created here, in this order, because each one is a collaborator of the next.
const sequencerStore = new InMemorySequencerStore()
const sequencerRegistry = new SequencerBlockRegistry()

// Managers a declared role is looked up in. `guideCamera` resolves against the cameras and `guideOutput`
// against the guide outputs, which is where a mount that pulses publishes itself; a role with no manager —
// the dome, which no device layer implements yet — resolves to nothing and refuses the session that asks for
// it, rather than starting one that would command a device the process cannot reach.
const sequencerDeviceManagers: Readonly<Partial<Record<SequencerDeviceRole, DeviceProvider<Device>>>> = {
	camera: cameraManager,
	guideCamera: cameraManager,
	mount: mountManager,
	wheel: wheelManager,
	focuser: focuserManager,
	rotator: rotatorManager,
	guideOutput: guideOutputManager,
	cover: coverManager,
	flatPanel: flatPanelManager,
}

// Turns a declared role into the physical resource the arbiter arbitrates. It runs at session start and not
// at compile time, because the key is the `hardwareId` of a device that has to be present to have one: a
// definition naming a camera that is not connected is compiled just fine and refused when it would take it.
const sequencerDeviceResolver: SequencerDeviceResolver = (role, deviceId) => {
	const device = sequencerDeviceManagers[role]?.get(undefined, deviceId)
	return device === undefined ? undefined : { key: resourceKey(resourceDevice(device)), device }
}

// Services the safe point in front of every exposure commands: the optical path the frame preparation
// reconciles, and the guider the interlock suspends and the dither displaces. They are not blocks and are
// therefore not registered: they run inside the capture node rather than as nodes of their own.
const sequencerPreparationServices = { wheelCommander, focuserCommander, coverCommander, flatPanelCommander, rotatorCommander, mountCommander }
const sequencerGuidingServices = { guiderCommander }

// The three references close over each other on purpose: the runtime reports what it wrote to the channel,
// the channel derives the snapshot it publishes through the handler, and the handler reads the live half back
// from the runtime. Every one of those calls happens after all three exist.
const sequencerRuntime = new SequencerRuntime({ store: sequencerStore, registry: sequencerRegistry, coordinator: operationCoordinator, resolve: sequencerDeviceResolver, preparation: sequencerPreparationServices, guiding: sequencerGuidingServices, observe: (change) => sequencerChannel.changed(change) })
const sequencerHandler = new SequencerHandler({ store: sequencerStore, runtime: sequencerRuntime, registry: sequencerRegistry, observe: (sessionId) => sequencerRuntime.observation(sessionId) })
const sequencerChannel = new SequencerChannel({ wsm, snapshot: (sessionId) => sequencerHandler.snapshot(sessionId), sessions: () => sequencerStore.sessions() })

// Blocks the compiler resolves and the runtime executes. Registering them here rather than inside the
// registry is what keeps the domain modules free of the services they command: each one is a pure function of
// the collaborators it is given.
sequencerRegistry.register(sequencerSlewHandler(mountCommander))
sequencerRegistry.register(sequencerCenterHandler({ cameraHandler, mountCommander, wheelCommander, rotatorCommander, plateSolver: plateSolverHandler }))
sequencerRegistry.register(sequencerAutofocusHandler({ runner: autoFocusHandler.runner, focuserCommander, wheelCommander }))
sequencerRegistry.register(sequencerDitherHandler({ guiderCommander }))
sequencerRegistry.register(sequencerMeridianFlipHandler({ cameraHandler, mountCommander, wheelCommander, rotatorCommander, plateSolver: plateSolverHandler, runner: autoFocusHandler.runner, focuserCommander }))
sequencerRegistry.register(sequencerCaptureHandler({ cameraHandler }))

for (const handler of sequencerLifecycleHandlers({ mountCommander, coverCommander, cameraCommander, guiderCommander })) {
	sequencerRegistry.register(handler)
}

// Registered here and not next to `shutdown` itself: the terminal path ends the sequencer session first, so a
// signal arriving before the sequencer exists would reach a handler that cannot run. Nothing before this point
// holds a device or a reservation, and an interrupt there ends the process the way it always did.
process.once('beforeExit', shutdown)
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

void atlasHandler.refreshImageOfSun()
void atlasHandler.refreshSatellites()
void atlasHandler.refreshEarthOrientationData()

// Server

const server = Bun.serve({
	hostname,
	port,
	reusePort: false,
	development: process.env.NODE_ENV !== 'production' && {
		hmr: true,
		console: true,
	},
	tls: secure && {
		cert: Bun.file(cert),
		key: Bun.file(key),
	},
	fetch: (req, server) => {
		if (server.upgrade(req)) {
		} else {
			console.error(req.method, req.url)
			return NOT_FOUND_RESPONSE
		}
	},
	error: (error) => {
		console.error(error)
	},
	routes: {
		'/': homeHtml,
		...connection(connectionHandler, indiHandler, mountManager, focuserManager, rotatorManager, guideOutputManager),
		...confirmation(confirmationHandler),
		...indi(indiHandler, indiDevicePropertyHandler, indiServerHandler),
		...camera(cameraHandler),
		...mount(mountHandler, mountRemoteControlHandler),
		...focuser(focuserHandler),
		...wheel(wheelHandler),
		...thermometer(thermometerHandler),
		...guideOutput(guideOutputHandler),
		...cover(coverHandler),
		...flatPanel(flatPanelHandler),
		...rotator(rotatorHandler),
		...dewHeater(dewHeaterHandler),
		...atlas(atlasHandler),
		...image(imageHandler),
		...framing(framingHandler),
		...starDetection(starDetectionHandler),
		...plateSolver(plateSolverHandler),
		...fileSystem(fileSystemHandler),
		...tppa(tppaHandler),
		...darv(darvHandler),
		...flatWizard(flatWizardHandler),
		...autoFocus(autoFocusHandler),
		...alpaca(alpacaHandler, alpacaPort, hasAlpaca),
		...guider(guiderHandler),
		...storage(storageHandler),
		...sequencerPlanner(sequencerPlannerHandler),
		...sequencer(sequencerHandler),
	},
	websocket: {
		open: (socket) => wsm.open(socket),
		message: (socket, body) => wsm.message(socket, body),
		close: (socket, code, reason) => wsm.close(socket, code, reason),
	},
})

const everyMinute = Bun.cron('*/1 * * * *', () => {
	imageProcessor.clear()
})

const every15Minutes = Bun.cron('*/15 * * * *', () => {
	void atlasHandler.refreshImageOfSun()
})

const everyDay = Bun.cron('0 0 * * *', () => {
	void atlasHandler.refreshSatellites()
	void atlasHandler.refreshEarthOrientationData()
})

// TODO:
// 	.use(basicAuth({ enabled: username.length >= 5 && password.length >= 8, realm: 'Nebulosa', credentials: [{ username, password }] }))

const url = `http${secure ? 's' : ''}://${server.hostname}:${server.port}`

console.info(`server is started at ${url}`)

if (open) {
	void openDefaultApp(url)
}
