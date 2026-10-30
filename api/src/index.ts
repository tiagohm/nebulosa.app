import { AnnotationService, createAnnotationRoutes } from './annotations'
import { AutoFocusSessions, createAutoFocusRoutes } from './autofocus'
import { CameraCommands, createCameraRoutes } from './cameras'
import { CaptureFrameRegistry, createCaptureFrameRoutes, DEFAULT_CAPTURE_FRAMES_FILE } from './captureframes'
import { CameraCaptures, createCaptureRoutes } from './captures'
import { connections, createConnectionRoutes } from './connection'
import { CoverCommands, createCoverRoutes } from './covers'
import { createDarvRoutes, DarvSessions } from './darv'
import { DarvAnalyzer } from './darv.analysis'
import { createDewHeaterRoutes, DewHeaterCommands } from './dewheaters'
import { createDomeRoutes, DomeCommands } from './domes'
import { createExternalToolsRoutes, DEFAULT_SETTINGS_FILE, ExternalToolsStore } from './externaltools'
import { createFileRoutes } from './files'
import { createFlatPanelRoutes, FlatPanelCommands } from './flatpanels'
import { createFlatWizardRoutes, FlatWizardSessions } from './flatwizard'
import { FlatWizardAnalyzer } from './flatwizard.analysis'
import { DEFAULT_FOCUSERS_FILE, FocuserBacklashStore } from './focuserbacklash'
import { createFocuserRoutes, FocuserCommands } from './focusers'
import { createGuideOutputRoutes, GuideOutputCommands } from './guideoutputs'
import { createGuidingRoutes, GuidingSessions } from './guiding'
import { errorResponse } from './http'
import { createImageProcessingRoutes, ImageProcessingService } from './imageprocessing'
import { createImageRoutes, images } from './images'
import { createIndiRoutes, IndiPropertyService } from './indi'
import { createLunarEclipseRoutes, LunarEclipseService } from './lunareclipses'
import { createPointingModelRoutes, PointingModels } from './mountpointing'
import { createPointingActivationRoutes, MountCorrections, PointingActivations } from './mountpointing.corrections'
import { PointingModelFitter } from './mountpointing.fit'
import { createMountPointingRoutes, MountPointingSessions } from './mountpointing.sessions'
import { PointingModelStore } from './mountpointing.store'
import { createMountRemoteControlRoutes, MountRemoteControlService } from './mountremotecontrol'
import { createMountRoutes, MountCommands } from './mounts'
import { createNotificationRoutes, DEFAULT_NOTIFICATIONS_FILE, NotificationService } from './notifications'
import { NotificationClassifier } from './notifications.rules'
import { createOperationRoutes, OperationRegistry } from './operations'
import { createPlateSolvingRoutes, PlateSolvingService } from './platesolving'
import { createRotatorRoutes, RotatorCommands } from './rotators'
import { annotationSky, skyLocator, skyRoutes } from './sky'
import { createSolarEclipseRoutes, SolarEclipseService } from './solareclipses'
import { createStarDetectionRoutes, StarDetectionService } from './stars'
import { createStreakDetectionRoutes, StreakDetectionService } from './streaks'
import { createTppaRoutes, TppaSessions } from './tppa'
import { broadcast, listenClients, listenSockets, type ServerEvent, type WebSocketData, websocket } from './websocket'
import { createWheelRoutes, WheelCommands } from './wheels'

// HTTP routes and the WebSocket handler of the backend, mounted by the app server.

export type { AboutInfo } from './about'
export { createAboutRoutes } from './about'
export type { AnalysisJob, AnalysisJobState } from './analysis'
export type { AutoFocusCaptureSettings, AutoFocusEvent, AutoFocusRequest, AutoFocusSession, AutoFocusSessionSummary, AutoFocusSnapshot, AutoFocusStartResponse, AutoFocusState, AutoFocusVerification, FocusMeasurement } from './autofocus'
export type { FocusCurve, FocusCurveHyperbola, FocusCurveParabola, FocusCurveSeries, FocusCurveSeriesKind, FocusCurveTrendLines } from './autofocus.curve'
export type { CameraCoolerRequest, CameraTemperatureRequest } from './cameras'
export type { CaptureEvent, CaptureFormat, CaptureFrame, CaptureOutput, CaptureOutputMode, CapturePhase, CaptureRequest, CaptureSession, CaptureSettings, CaptureSnapshot, CaptureSnoop, CaptureStartResponse } from './captures'
export type {
	CaptureFrameAvailability,
	CaptureFrameErrorCode,
	CaptureFrameEvent,
	CaptureFrameOpened,
	CaptureFrameOpenRequest,
	CaptureFrameOrigin,
	CaptureFramePage,
	CaptureFramesSnapshot,
	CaptureFrameSummary,
	CaptureFrameUnavailableReason,
	CaptureLeaseReconcileRequest,
	CaptureLeaseReconcileResponse,
	CaptureSourceSummary,
} from './captureframes'
export type { ConnectionCloseCause, ConnectionEvent, ConnectionRegistryEvent, ConnectionStatus, ConnectionType, ConnectRequest, RemoteConnectRequest } from './connection'
export type { CommandAccepted, CommandError, CommandErrorCode, CommandRequest } from './commands'
export type { EclipseDirection, EclipseLocation } from './eclipses'
export type { ApiError } from './http'
export type {
	LocalLunarEclipse,
	LocalLunarEclipseContact,
	LocalLunarEclipseDetails,
	LocalLunarEclipseSvgShape,
	LocalLunarEclipseVisibility,
	LocalLunarEclipseVisibilityKind,
	LocalLunarViewHandedness,
	LocalLunarViewOrientationMode,
	LunarEclipseContactKind,
	LunarEclipseContactPaths,
	LunarEclipseContactTime,
	LunarEclipseErrorCode,
	LunarEclipseLocalView,
	LunarEclipseMap,
	LunarEclipseMapEvent,
	LunarEclipseSummary,
	LunarEclipseType,
	LunarEclipseViewOptions,
} from './lunareclipses'
export type {
	HybridEclipseKind,
	LocalCentralPhaseKind,
	LocalEclipseContactKind,
	LocalSolarEclipse,
	LocalSolarEclipseContact,
	LocalSolarEclipseDetails,
	LocalSolarEclipseSvgShape,
	LocalSolarEclipseVisibility,
	LocalSunMotion,
	LocalViewHandedness,
	LocalViewOrientationMode,
	LocalVisibilityKind,
	SolarEclipseErrorCode,
	SolarEclipseExtreme,
	SolarEclipseLocalView,
	SolarEclipseMap,
	SolarEclipseMapPoint,
	SolarEclipsePathKind,
	SolarEclipsePaths,
	SolarEclipsePointKind,
	SolarEclipseSummary,
	SolarEclipseType,
	SolarEclipseViewOptions,
} from './solareclipses'
export type {
	CameraCapabilities,
	CameraRange,
	CameraSensor,
	CoverState,
	DeviceEvent,
	DeviceRange,
	DeviceStateBase,
	DeviceStateEvent,
	DeviceStateMap,
	DeviceStates,
	DeviceSummary,
	DewHeaterState,
	DomeMeasurements,
	DomeState,
	FlatPanelState,
	FocuserState,
	GuideOutputState,
	ManagedDeviceType,
	MountSite,
	MountState,
	MountTime,
	RotatorState,
	WheelState,
} from './devices'
export type { DewHeaterDutyCycleRequest } from './dewheaters'
export type { DomeAltitudeRequest, DomeBacklashRequest, DomeMotionEvent, DomeMotionRequest, DomeMotionSession, DomeMotionStartResponse, DomeMoveByRequest, DomeShutterRequest, DomeSlavingRequest, DomeSlewRequest, DomeSpeedRequest, DomeSyncRequest } from './domes'
export type {
	ExternalToolCapability,
	ExternalToolCheck,
	ExternalToolCheckCode,
	ExternalToolCheckStatus,
	ExternalToolConfig,
	ExternalToolConfigStatus,
	ExternalToolDefinition,
	ExternalToolEvent,
	ExternalToolField,
	ExternalToolId,
	ExternalToolLoginRequest,
	ExternalToolSaveRequest,
	ExternalToolState,
	ExternalToolTestRequest,
	TimeoutLimits,
} from './externaltools'
export type { LeasedPhase, LeasedSession, LeasedStartResponse, LeaseOptions } from './leases'
export type { DirectoryListing, FileEntry } from './files'
export type { FlatPanelIntensityRequest, FlatPanelLightRequest } from './flatpanels'
export type { FocuserBacklashConfig, FocuserBacklashMode } from './focuserbacklash'
export type { FocuserBacklashEvent, FocuserBacklashSaveRequest, FocuserBacklashState, FocuserDirection, FocuserMoveRequest, FocuserMoveToRequest, FocuserReverseRequest, FocuserSyncRequest } from './focusers'
export type { GuidePulseRequest, GuideRateRequest } from './guideoutputs'
export type {
	IndiClientMessage,
	IndiDeviceEvent,
	IndiDeviceSummary,
	IndiErrorCode,
	IndiMessage,
	IndiMessageEvent,
	IndiPropertyDefinedEvent,
	IndiPropertyRemovedEvent,
	IndiPropertyUpdate,
	IndiPropertyUpdatedEvent,
	IndiServerEvent,
	IndiSnapshotEvent,
	IndiStreamEvent,
	IndiStreamHeader,
	IndiSubscriptionErrorCode,
	IndiSubscriptionErrorEvent,
	IndiWriteRequest,
} from './indi'
export type { IndiBlobElement, IndiBlobProperty, IndiDriver, IndiLightElement, IndiLightProperty, IndiNumberElement, IndiNumberProperty, IndiProperty, IndiPropertyChangeKind, IndiPropertyType, IndiSwitchElement, IndiSwitchProperty, IndiTextElement, IndiTextProperty } from 'nebulosa/src/devices/indi/properties'
export type {
	MountCoordinate,
	MountGoToRequest,
	MountNudgeDirection,
	MountNudgeEvent,
	MountNudgePhase,
	MountNudgeRequest,
	MountNudgeSession,
	MountNudgeStartResponse,
	MountSiteRequest,
	MountSlewRateRequest,
	MountSlewRequest,
	MountSlewResponse,
	MountSyncRequest,
	MountTimeRequest,
	MountTrackingRequest,
	MountTrackModeRequest,
} from './mounts'
export type { MountRemoteClient, MountRemoteControlEvent, MountRemoteErrorCode, MountRemoteKey, MountRemoteProtocol, MountRemoteServer, MountRemoteSnapshot, MountRemoteStartRequest } from './mountremotecontrol'
export type { OperationDevice, OperationEvent, OperationKind, OperationProgress, OperationRecord, OperationState } from './operations'
export type { RotatorMoveByRequest, RotatorMoveToRequest, RotatorReverseRequest, RotatorSyncRequest } from './rotators'
export type { WheelMoveRequest, WheelNamesRequest } from './wheels'
export type {
	AstapStarDetectionSettings,
	BuiltinStarDetectionSettings,
	StarAcceptance,
	StarDetectionErrorCode,
	StarDetectionEvent,
	StarDetectionJob,
	StarDetectionJobState,
	StarDetectionOrigin,
	StarDetectionRequest,
	StarDetectionResult,
	StarDetectionSettings,
	StarDetectionSnapshot,
	StarDetectionSummary,
	StarDetectorProvider,
	StarMeasurement,
} from './stars'
export type {
	AnnotationBodies,
	AnnotationBodyLayer,
	AnnotationCenter,
	AnnotationCounts,
	AnnotationErrorCode,
	AnnotationEvent,
	AnnotationField,
	AnnotationImageContext,
	AnnotationJob,
	AnnotationJobState,
	AnnotationKind,
	AnnotationLayer,
	AnnotationMotion,
	AnnotationObject,
	AnnotationObservation,
	AnnotationRequest,
	AnnotationResult,
	AnnotationSite,
	AnnotationSiteSource,
	AnnotationSnapshot,
	AnnotationSummary,
	AnnotationTimeOrigin,
	AnnotationWcs,
} from './annotations'
export type { StreakContextSources, StreakDetectionErrorCode, StreakDetectionEvent, StreakDetectionJob, StreakDetectionJobState, StreakDetectionRequest, StreakDetectionResult, StreakDetectionSnapshot, StreakDetectionSummary, StreakDetectorSettings } from './streaks'
export type { PlateSolutions, PlateSolveErrorCode, PlateSolveJob, PlateSolveJobState, PlateSolveOrigin, PlateSolveOutcome, PlateSolveRemote, PlateSolveRequest, PlateSolveResult, PlateSolverProvider, PlateSolverSettings, PlateSolveSnapshot, PlateSolveStage, PlateSolveSummary, PlateSolvingEvent } from './platesolving'
export type { PlateSolveHint, PlateSolveHints, PlateSolveHintSource, PlateSolveStrategy, ResolvedPlateSolveHints } from './platesolving.hints'
export type { EphemerisFallbackReason, EphemerisMode, EphemerisSource, SkyEvents, SkyObserver, SkyPosition } from './sky/ephemeris'
export type { SolarActiveRegion, SunActiveRegionsErrorCode, SunActiveRegionsResponse } from './sky/activeregions'
export type { MoonAlmanacRequest, MoonAlmanacResponse, MoonApsisEvent, MoonAppearance, MoonPhaseEvent, MoonPhaseName, MoonPrincipalPhase, MoonSurfacePoint } from './sky/moon'
export type { LunarFeatureCategory, LunarFeatureRow, MoonFeatureCatalog, MoonFeatureCatalogSource } from './sky/moon.features'
export type { SunImageChannel, SunImageErrorCode, SunImageSize } from './sky/sdo'
export type { SolarAstronomicalNight, SolarDailyState, SolarSeasonEvent, SolarSeasonKind, SolarTwilightCrossings, SunAlmanacRequest, SunAlmanacResponse, SunLocalDay, SunPhysicalData } from './sky/sun'
export type { MinorBody, MinorBodyParameter, MinorBodySearchResponse, SkyBodiesRequest, SkyBodyPosition, SkyCatalogObject, SkyConstellation, SkyConstellations, SkyDeepSkyData, SkyObjectCategory, SkyObjectRef, SkyPositionRequest, SkyPositionResponse, SkySearchResult, SkyStarData, SolarSystemBodyCode } from './sky/types'
export type { Binning, DisplayDebayer, DisplayScnr, DisplaySettings, DisplayStretch, ImageAcquisition, ImageCapture, ImageFormat, ImageInfo, ImageOrigin, ImageProperties, ImageProvenance, ProcessingProvenance, RenderRequest, RenderResult, SaveFormat, SaveRequest, SaveResult, Stretch } from './images'
export type {
	ArcsinhStretchOperation,
	BackgroundExtractionOperation,
	BackgroundNeutralizationOperation,
	CosmeticCorrectionOperation,
	DebayerOperation,
	GaussianBlurOperation,
	GrayscaleOperation,
	ImageProcessingErrorCode,
	ImageProcessingEvent,
	ImageProcessingJob,
	ImageProcessingOperation,
	ImageProcessingOperationType,
	ImageProcessingRequest,
	ImageProcessingSnapshot,
	ImageProcessingStep,
	MultiscaleOperation,
	PlainOperation,
} from './imageprocessing'
export type { DarvCaptureSettings, DarvEvent, DarvFinishRequest, DarvMeasurement, DarvMeasurementRequest, DarvMeasurementState, DarvMeasurementTrails, DarvRequest, DarvSession, DarvSessionState, DarvSessionSummary, DarvSnapshot, DarvStartResponse } from './darv'
export type { DarvMeasurementResult, DarvMeasurementStatus, DarvTrail } from './darv.analysis'
export type {
	FlatWizardAttempt,
	FlatWizardCaptureSettings,
	FlatWizardContinueRequest,
	FlatWizardEvent,
	FlatWizardFilter,
	FlatWizardFilterRun,
	FlatWizardFilterState,
	FlatWizardPendingStep,
	FlatWizardPlaneLevel,
	FlatWizardRequest,
	FlatWizardSequenceResult,
	FlatWizardSession,
	FlatWizardSessionSummary,
	FlatWizardSnapshot,
	FlatWizardStartResponse,
	FlatWizardState,
	FlatWizardVerdict,
} from './flatwizard'
export type {
	GuidingCalibrationProgress,
	GuidingCalibrationSummary,
	GuidingCameraSettings,
	GuidingClientSettings,
	GuidingCommand,
	GuidingCommandAccepted,
	GuidingCommandStatus,
	GuidingDitherRequest,
	GuidingEventRecord,
	GuidingExposureRequest,
	GuidingFrameOverlay,
	GuidingPage,
	GuidingPauseRequest,
	GuidingResumeRequest,
	GuidingRms,
	GuidingServerEvent,
	GuidingSessionSummary,
	GuidingSnapshot,
	GuidingStartGuidingRequest,
	GuidingStartRequest,
	GuidingStartResponse,
	GuidingTargetRequest,
	GuidingTelemetryAxis,
	GuidingTelemetrySample,
} from './guiding'
export type { PointingFitModelRequest, PointingFitState, PointingModelDetail, PointingModelEvent, PointingModelPatch, PointingModelsSnapshot } from './mountpointing'
export type { PointingFitStrategy, PointingGate, PointingOfflineMetrics, PointingSampleResidual } from './mountpointing.fit'
export type { CorrectionRefusal, PointingActivateRequest, PointingActivation, PointingActivationEvent, PointingActivationsSnapshot, PointingCorrectionAudit } from './mountpointing.corrections'
export type { EquatorialPosition, PointingSite } from './mountpointing.frames'
export type {
	MountPointingVerifyRequest,
	MountPointingCaptureSettings,
	MountPointingEvent,
	MountPointingPlanPreviewRequest,
	MountPointingPlanRequest,
	MountPointingRequest,
	MountPointingSessionSummary,
	MountPointingSnapshot,
	MountPointingStartResponse,
	MountPointingState,
	MountPointingStep,
} from './mountpointing.sessions'
export type { PointingAcquisitionState, PointingModelExport, PointingModelFile, PointingModelSummary, PointingMountIdentity, PointingOpticsFingerprint, PointingPlanRecord, PointingRevision, PointingSampleRecord, PointingVerification, UnavailablePointingModel } from './mountpointing.store'
export type { TppaAlignment, TppaAttempt, TppaCaptureSettings, TppaEvent, TppaGeometry, TppaOverlay, TppaPoint, TppaRequest, TppaSession, TppaSessionSummary, TppaSnapshot, TppaStartResponse, TppaState } from './tppa'
export type { GuidingProfileCut, GuidingStarProfile } from './guidingprofile'
export type { NotificationCreatedEvent, NotificationRecord, NotificationSnapshot } from './notifications'
export type { NotificationCameraTool, NotificationLevel, NotificationSource, NotificationTarget } from './notifications.rules'
export type { ClientMessage, ServerEvent } from './websocket'
export { websocket }

// History of the notifications, created from the events of the connections, the operations, and the sessions; its
// own notification:created events are broadcast directly, so they are never classified again.
const notifications = new NotificationService(broadcast, {
	file: DEFAULT_NOTIFICATIONS_FILE,
	classifier: new NotificationClassifier((connectionId, deviceId) => connections.devices.get(connections.client(connectionId), deviceId)?.name),
})

// Broadcasts an event of the connections, the operations, or the sessions, then hands it to the notification history, so
// a tab sees a change before the notification about it.
function publish(event: ServerEvent) {
	broadcast(event)
	notifications.consume(event)
}

connections.listen(publish)

// Device operations of the process, published to every tab.
const operations = new OperationRegistry(connections.devices, publish)

// Pointing models in force on the mounts of the open connections, which suspend when a mount stops matching them.
const corrections = new MountCorrections(connections.devices.mounts, (event) => publish(event))

// Mount commands and nudge sessions over the devices of the open connections, whose GoTos a model in force corrects.
const mounts = new MountCommands(connections.devices, (id) => connections.client(id), skyLocator, operations, broadcast, undefined, corrections)

// LX200 and Stellarium listeners exposing the mounts of the open connections to planetarium programs, commanding them
// through the shared commander of the mount commands; a listener stops with its mount or connection.
const mountRemoteControl = new MountRemoteControlService(connections.devices, (id) => connections.client(id), mounts, operations, broadcast)
connections.listen((event) => mountRemoteControl.deviceChanged(event))

// Pulse guiding of the guide outputs of the open connections.
const guideOutputs = new GuideOutputCommands(connections.devices, (id) => connections.client(id), operations)

// Focuser, filter wheel, and rotator commands over the devices of the open connections; focuser moves apply the
// backlash compensation saved for each focuser.
const focusers = new FocuserCommands(connections.devices, (id) => connections.client(id), operations, new FocuserBacklashStore(DEFAULT_FOCUSERS_FILE), broadcast)
const wheels = new WheelCommands(connections.devices, (id) => connections.client(id), operations)
const rotators = new RotatorCommands(connections.devices, (id) => connections.client(id), operations)

// Cover, flat panel, and dew heater commands over the devices of the open connections.
const covers = new CoverCommands(connections.devices, (id) => connections.client(id), operations)
const flatPanels = new FlatPanelCommands(connections.devices, (id) => connections.client(id), operations)
const dewHeaters = new DewHeaterCommands(connections.devices, (id) => connections.client(id), operations)

// Dome commands and manual rotation sessions over the devices of the open connections.
const domes = new DomeCommands(connections.devices, (id) => connections.client(id), operations, broadcast)

// Cooling of the cameras of the open connections, arbitrated against their captures.
const cameras = new CameraCommands(connections.devices, (id) => connections.client(id), operations)

// Directory and property streams of the INDI devices of the open connections; a stream reaches only the
// sockets that subscribed to it.
const indi = new IndiPropertyService(connections.devices, (id) => connections.client(id), operations, broadcast, undefined, corrections)
listenSockets(indi)

// Settings of the external programs, such as ASTAP, read by the services that run them.
const externalTools = new ExternalToolsStore(DEFAULT_SETTINGS_FILE, broadcast)

// Star detection of the image documents, shared by the Images workspace and the captures.
const stars = new StarDetectionService(images, externalTools, broadcast)
const plateSolving = new PlateSolvingService(images, externalTools, broadcast)

// Streak detection of the image documents, classified with the solutions and stars already found for each image.
const streaks = new StreakDetectionService(images, plateSolving, stars, broadcast)

// Annotation of the image documents with the sky catalog and SkyBoT, through the WCS of each image.
const annotations = new AnnotationService(images, plateSolving, annotationSky, broadcast)

// Image processing pipelines of the image documents, each adopting its result as a new derived document.
const imageProcessing = new ImageProcessingService(images, broadcast)

// Index of the captured frames of every camera, holding their documents for the Images workspace; the leases of a tab
// follow its event sockets, and cameras are republished when their connection state changes.
const captureFrames = new CaptureFrameRegistry(images, broadcast, {
	file: DEFAULT_CAPTURE_FRAMES_FILE,
	connected: (connectionId, deviceId) => {
		const client = connections.client(connectionId)
		return !!client && !!connections.devices.camera(client, deviceId)?.connected
	},
})
connections.listen((event) => captureFrames.deviceChanged(event))
listenClients(captureFrames)

// Camera captures over the devices of the open connections, their frames entering the image store.
const captures = new CameraCaptures(connections.devices, (id) => connections.client(id), operations, images, captureFrames, publish)

// Auto Focus sessions of the cameras of the open connections, taking their frames with the capturer of the captures and
// moving the focusers with their backlash compensation.
const autoFocus = new AutoFocusSessions(connections.devices, (id) => connections.client(id), operations, captures.capturer, focusers.mover, images, captureFrames, stars, publish)

// TPPA sessions of the cameras of the open connections, rotating the mounts with the commander of the mount commands,
// taking their frames with the capturer of the captures, and solving them with the plate solving service.
const tppa = new TppaSessions(connections.devices, (id) => connections.client(id), operations, mounts.commander, captures.capturer, images, captureFrames, plateSolving, publish)

// Mount pointing models, persisted under the home of the server and fitted on a worker of their own.
const pointingModels = new PointingModels(new PointingModelStore(), new PointingModelFitter(), publish)

// Mount pointing sessions of the cameras of the open connections, slewing the mounts with the commander of the mount
// commands, so no model corrects them, taking their frames with the capturer of the captures, and solving them with the
// plate solving service.
const mountPointing = new MountPointingSessions(connections.devices, (id) => connections.client(id), operations, mounts.commander, captures.capturer, images, captureFrames, plateSolving, pointingModels, publish)

// Activation of the models: the checks of the moment, and the routes of the models in force.
const pointingActivations = new PointingActivations(connections.devices, (id) => connections.client(id), corrections, pointingModels, operations)

// DARV sessions of the cameras of the open connections, moving the mounts with the commander of the mount commands,
// taking their frames with the capturer of the captures, and analyzing them on a worker of their own.
const darv = new DarvSessions(connections.devices, (id) => connections.client(id), operations, mounts.commander, captures.capturer, images, captureFrames, new DarvAnalyzer(images), publish)

// Flat Wizard sessions of the cameras of the open connections, taking their frames with the capturer of the captures,
// moving the wheels, driving the panels, and closing and opening the covers with the commanders of their commands,
// previewing and recording the frames in the capture frame registry, and measuring them in DN on a worker of their own.
const flatWizard = new FlatWizardSessions(connections.devices, (id) => connections.client(id), operations, captures.capturer, wheels.commander, flatPanels.commander, covers.commander, images, captureFrames, new FlatWizardAnalyzer(), publish)

// Guiding sessions of the guide cameras of the open connections, dispatching their pulses through the commander of the
// guide output commands and previewing their frames in the image store and the capture frame registry.
const guiding = new GuidingSessions(connections.devices, (id) => connections.client(id), operations, guideOutputs.commander, images, captureFrames, externalTools, publish)

// Lunar eclipse queries of the Lunar Eclipse Map tool.
const lunarEclipses = new LunarEclipseService()

// Solar eclipse queries of the Solar Eclipse Map tool; their maps are computed on a worker.
const solarEclipses = new SolarEclipseService()

// Writes the changes the persisted stores still hold in memory, for a server about to stop. Resolves once they are
// written or failed to be; never rejects.
export async function flushStores() {
	await Promise.all([captureFrames.flush(), notifications.flush()])
}

// Bun.serve routes under /api/.
export const routes = {
	'/api/health': {
		GET: () => Response.json({ status: 'ok' }),
	},
	...createOperationRoutes(operations),
	...createNotificationRoutes(notifications),
	...createConnectionRoutes(connections),
	...createIndiRoutes(indi),
	...createMountRoutes(mounts),
	...createMountRemoteControlRoutes(mountRemoteControl),
	...createGuideOutputRoutes(guideOutputs),
	...createFocuserRoutes(focusers),
	...createWheelRoutes(wheels),
	...createRotatorRoutes(rotators),
	...createCoverRoutes(covers),
	...createFlatPanelRoutes(flatPanels),
	...createDewHeaterRoutes(dewHeaters),
	...createDomeRoutes(domes),
	...createCameraRoutes(cameras),
	...createCaptureRoutes(captures),
	...createAutoFocusRoutes(autoFocus),
	...createTppaRoutes(tppa),
	...createPointingModelRoutes(pointingModels),
	...createMountPointingRoutes(mountPointing),
	...createPointingActivationRoutes(pointingActivations),
	...createDarvRoutes(darv),
	...createFlatWizardRoutes(flatWizard),
	...createGuidingRoutes(guiding),
	...createFileRoutes(),
	...createImageRoutes(images),
	...createImageProcessingRoutes(imageProcessing),
	...createExternalToolsRoutes(externalTools),
	...createStarDetectionRoutes(stars),
	...createPlateSolvingRoutes(plateSolving),
	...createStreakDetectionRoutes(streaks),
	...createAnnotationRoutes(annotations),
	...createCaptureFrameRoutes(captureFrames),
	...skyRoutes,
	...createLunarEclipseRoutes(lunarEclipses),
	...createSolarEclipseRoutes(solarEclipses),
	'/api/ws': {
		// Upgrades to the event WebSocket, attaching the client id the tab names itself with; Bun sends the handshake
		// response itself.
		GET: (req, server) => {
			const client = new URL(req.url).searchParams.get('client') || undefined
			return server.upgrade(req, { data: { client } satisfies WebSocketData }) ? undefined : errorResponse('WebSocket upgrade failed', 400, 'upgradeFailed')
		},
	},
} as Readonly<Bun.Serve.Routes<WebSocketData, string>>
