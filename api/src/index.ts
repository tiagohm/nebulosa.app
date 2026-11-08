import { AnnotationService, createAnnotationRoutes } from './annotations'
import { AstronomicalTimeService, createAstronomicalTimeRoutes } from './astronomicaltime'
import { EarthOrientationData, installEarthOrientation } from './astronomicaltime.eop'
import { AstroWeatherService, createAstroWeatherRoutes } from './astroweather'
import { AutoFocusSessions, createAutoFocusRoutes } from './autofocus'
import { CalibrationLibrary, createCalibrationLibraryRoutes } from './calibrationlibrary'
import { CalibrationLibraryStore, DEFAULT_CALIBRATION_LIBRARY_DIRECTORY } from './calibrationlibrary.store'
import { CameraCommands, createCameraRoutes } from './cameras'
import { CaptureFrameRegistry, createCaptureFrameRoutes } from './captureframes'
import { CameraCaptures, createCaptureRoutes } from './captures'
import { CloseApproachesService, createCloseApproachRoutes } from './closeapproaches'
import { type ConnectionStatus, type ConnectRequest, connections, createConnectionRoutes } from './connection'
import { CoverCommands, createCoverRoutes } from './covers'
import { createDarkLibraryWizardRoutes, DarkLibraryWizardSessions } from './darklibrarywizard'
import { DarkLibraryWizardAnalyzer } from './darklibrarywizard.analysis'
import { createDarvRoutes, DarvSessions } from './darv'
import { DarvAnalyzer } from './darv.analysis'
import { AppDatabase, DEFAULT_DATABASE_FILE } from './database'
import { createDewHeaterRoutes, DewHeaterCommands } from './dewheaters'
import { CaptureDithering } from './dithering'
import { createDomeRoutes, DomeCommands } from './domes'
import { ServerEventDispatcher } from './events'
import { createExternalToolsRoutes, ExternalToolsStore } from './externaltools'
import { createFileRoutes } from './files'
import { createFlatPanelRoutes, FlatPanelCommands } from './flatpanels'
import { createFlatWizardRoutes, FlatWizardSessions } from './flatwizard'
import { FlatWizardAnalyzer } from './flatwizard.analysis'
import { FocuserBacklashStore } from './focuserbacklash'
import { createFocuserRoutes, FocuserCommands } from './focusers'
import { createGuideOutputRoutes, GuideOutputCommands } from './guideoutputs'
import { createGuidingRoutes, GuidingSessions } from './guiding'
import { GuidingCalibrationStore } from './guidingcalibration.store'
import { errorResponse } from './http'
import { createImageProcessingRoutes, ImageProcessingService } from './imageprocessing'
import { createImageRoutes, images } from './images'
import { createImageStackingRoutes, ImageStacking } from './imagestacking'
import { DEFAULT_IMAGE_STACKING_DIRECTORY, ImageStackingStore } from './imagestacking.store'
import { createImageStatisticsRoutes, ImageStatisticsService } from './imagestatistics'
import { createIndiRoutes, IndiPropertyService } from './indi'
import { IndiMessageService } from './indimessages'
import { createIPolarRoutes, IPolarSessions } from './ipolar'
import { createJupiterRoutes, JupiterPlannerService } from './jupiter'
import { JupiterGrsStore } from './jupiter.store'
import { createLiveStackingRoutes, LiveStacking } from './livestacking'
import { LiveStackingStore } from './livestacking.store'
import { createLunarEclipseRoutes, LunarEclipseService } from './lunareclipses'
import { createMeridianFlipRoutes, MeridianFlipService } from './meridianflip'
export type { ExecutorEligibility, FlipStrategyChoice, FlipTrigger, FlipVerification, FlipVerificationMode, MeridianFlipExecutorErrorCode, MeridianFlipExecutorPolicy, WcsEvidence } from './meridianflipexecutor.policy'
export type {
	MeridianFlipArm,
	MeridianFlipAutoFocus,
	MeridianFlipCentering,
	MeridianFlipExecuteRequest,
	MeridianFlipExecution,
	MeridianFlipExecutionRequest,
	MeridianFlipExecutionState,
	MeridianFlipExecutorEvent,
	MeridianFlipExecutorKey,
	MeridianFlipExecutorSnapshot,
	MeridianFlipOutcome,
	MeridianFlipSetup,
	MeridianFlipStep,
	MeridianFlipStepOutcome,
	MeridianFlipStepRecord,
	MeridianFlipTarget,
	PostFlipReadiness,
} from './meridianflipexecutor'
import { createMeridianFlipExecutorRoutes, MeridianFlipExecutor } from './meridianflipexecutor'
import { createPointingModelRoutes, PointingModels } from './mountpointing'
import { createPointingActivationRoutes, MountCorrections, PointingActivations } from './mountpointing.corrections'
import { PointingModelFitter } from './mountpointing.fit'
import { createMountPointingRoutes, MountPointingSessions } from './mountpointing.sessions'
import { PointingModelStore } from './mountpointing.store'
import { createMountRemoteControlRoutes, MountRemoteControlService } from './mountremotecontrol'
import { createMountRoutes, MountCommands } from './mounts'
import { createNotificationRoutes, NotificationService } from './notifications'
import { NotificationClassifier } from './notifications.rules'
import { createObservatoryCameraRoutes, ObservatoryCameraService } from './observatorycameras'
import { CAMERA_SECRET_KEY_VARIABLE, CameraSecretKey, systemSecretStorage } from './observatorycameras.secret'
import { ObservatoryCameraStore } from './observatorycameras.store'
import { createObservingPlannerRoutes, ObservingPlannerService } from './observingplanner'
import { ObservingMinorBodyStore } from './observingplanner.minorbodies.store'
import { ObservingPlanStore } from './observingplanner.store'
import { createOperationHistoryRoutes, OperationRecorder } from './operationhistory'
import { createOperationRoutes, OperationRegistry } from './operations'
import { createOrbitalMechanicsRoutes, OrbitalMechanicsService } from './orbitalmechanics'
import { createPlateSolvingRoutes, PlateSolvingService } from './platesolving'
import { createRotatorRoutes, RotatorCommands } from './rotators'
import { createSatelliteRoutes, SatelliteService, satelliteSkyAdapter } from './satellites'
import { SatelliteAutoDownload } from './satellites.auto'
import { SatelliteEphemeris } from './satellites.ephemeris'
import { SatelliteStore } from './satellites.store'
import { SatelliteSync } from './satellites.sync'
import { createSaturnRoutes, SaturnPlannerService } from './saturn'
import { annotationSky, createSkyApiRoutes, minorBodies, skyCatalog, skyLocator, spiceKernels, ssdRequests } from './sky'
import { createSolarEclipseRoutes, SolarEclipseService } from './solareclipses'
import { createSpiceKernelRoutes, SpiceKernelLibrary } from './spicekernels'
import { SpiceKernelStore } from './spicekernels.store'
import { createStarProfileRoutes, StarProfileService } from './starprofile'
import { createStarDetectionRoutes, StarDetectionService } from './stars'
import { createStreakDetectionRoutes, StreakDetectionService } from './streaks'
import { createTargetCenteringRoutes, TargetCenteringSessions } from './targetcentering'
import { createTppaRoutes, TppaSessions } from './tppa'
import { broadcast, listenClients, listenSockets, type ServerEvent, type WebSocketData, websocket } from './websocket'
import { createWheelRoutes, WheelCommands } from './wheels'
import { createWorkspaceRoutes, Workspace } from './workspace'

// HTTP routes and the WebSocket handler of the backend, mounted by the app server.

export type { AboutInfo } from './about'
export { createAboutRoutes } from './about'
export { MAX_SPICE_KERNEL_BYTES } from './spicekernels'
export type { AnalysisJob, AnalysisJobState } from './analysis'
export type { AstronomicalTimeErrorCode, AstronomicalTimeInput, AstronomicalTimeQuality, AstronomicalTimeReference, AstronomicalTimeReferenceRequest, AstronomicalTimeRequest, AstronomicalTimeResult, CalendarReference, LeapSecondStatus, TimeScaleName, TimeScaleReading } from './astronomicaltime'
export type { AstroWeatherAstronomy, AstroWeatherErrorCode, AstroWeatherForecast, AstroWeatherMeteorology, AstroWeatherProvider, AstroWeatherSource, AstroWeatherSourceState } from './astroweather'
export type { AstroWeatherMoon, AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
export type { MeteorologyGrid, MeteorologySample } from './astroweather.openmeteo'
export type { AstronomicalSample, SevenTimerClass } from './astroweather.seventimer'
export type { EarthOrientationCoverage, EarthOrientationSource, EarthOrientationStatus } from './astronomicaltime.eop'
export type { AutoFocusCaptureSettings, AutoFocusEvent, AutoFocusRequest, AutoFocusSession, AutoFocusSessionSummary, AutoFocusSnapshot, AutoFocusStartResponse, AutoFocusState, AutoFocusVerification, FocusMeasurement } from './autofocus'
export type { FocusCurve, FocusCurveHyperbola, FocusCurveParabola, FocusCurveSeries, FocusCurveSeriesKind, FocusCurveTrendLines } from './autofocus.curve'
export type {
	CalibrationGroupDetail,
	CalibrationGroupSummary,
	CalibrationLibraryErrorCode,
	CalibrationLibraryEvent,
	CalibrationLibrarySnapshot,
	CalibrationMasterDetail,
	CalibrationMasterSummary,
	FlatFrameRegistration,
	ImportCandidate,
	ImportCandidatePage,
	ImportCommit,
	ImportRequest,
	MasterRequest,
	MasterRequestResult,
	RecipeValidation,
	ResolvePreview,
	StateCounts,
} from './calibrationlibrary'
export type { CalibrationKind, CalibrationMetadata, CalibrationRecipe, CalibrationTarget, CompatibilityFinding, EvidenceLevel, Evidenced, FindingCode, FindingSeverity, GroupReadiness, MasterReference, OverridableField } from './calibrationlibrary.compatibility'
export type { CalibrationJobErrorCode, CalibrationJobState, CalibrationJobSummary, CalibrationJobType } from './calibrationlibrary.jobs'
export type { CalibrationMaster, CalibrationMasterDiagnostics, CalibrationSource, CalibrationSourceSummary, MasterCalibrationState, Page, ProductStatus, SourceFormat, SourceOrigin, SourceStatus } from './calibrationlibrary.store'
export type { IntegrationProgress } from './calibrationlibrary.analysis'
export type { CameraCoolerRequest, CameraTemperatureRequest } from './cameras'
export type {
	CaptureEvent,
	CaptureFormat,
	CaptureAdmission,
	CaptureAdmissionOptions,
	CaptureAdmitted,
	CaptureControlRequest,
	CaptureDitherProgress,
	CaptureFrame,
	CaptureOutput,
	CaptureOutputMode,
	CapturePhase,
	CaptureRequest,
	CaptureSession,
	CaptureSettings,
	CaptureStartRequest,
	CaptureSnapshot,
	CaptureSnoop,
	CaptureSuspensionState,
	CaptureStartResponse,
} from './captures'
export type { CaptureDither, CaptureDitherErrorCode, GuidedCaptureDither, MountCaptureDither, PulseCaptureDither, SlewCaptureDither } from './dithering'
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
export type { CloseApproach, CloseApproachErrorCode, CloseApproachFilters, CloseApproachHistoryFilters, CloseApproachPageResponse } from './closeapproaches'
export type { CloseApproachBody, CloseApproachSort, CloseApproachSortField } from 'nebulosa/src/adapters/orbits/sbd'
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
export type {
	IndiDeviceMessage,
	IndiGlobalMessageEvent,
	IndiGlobalMessagesSuppressedEvent,
	IndiMessageReceivedEvent,
	IndiMessagesClientMessage,
	IndiMessagesHeader,
	IndiMessagesServerEvent,
	IndiMessagesSnapshotEvent,
	IndiMessagesStreamEvent,
	IndiMessagesSubscriptionErrorCode,
	IndiMessagesSubscriptionErrorEvent,
} from './indimessages'
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
export type {
	MeridianAvailability,
	MeridianExposureAssessment,
	MeridianExposureRequest,
	MeridianFlipErrorCode,
	MeridianFlipEvent,
	MeridianFlipKey,
	MeridianFlipMonitor,
	MeridianFlipSettings,
	MeridianFlipSettingsRequest,
	MeridianFlipSnapshot,
	MeridianFlipTransition,
	MeridianMechanicalAssessment,
	MeridianMonitorReason,
	MeridianMountView,
	MeridianTiming,
	MeridianTimingPhase,
	MeridianTimingQuality,
	MeridianTransitionKind,
} from './meridianflip'
export type { MountRemoteClient, MountRemoteControlEvent, MountRemoteErrorCode, MountRemoteKey, MountRemoteProtocol, MountRemoteServer, MountRemoteSnapshot, MountRemoteStartRequest } from './mountremotecontrol'
export type { ObservatoryCamera, ObservatoryCameraErrorCode, ObservatoryCameraEvent, ObservatoryCameraSaveRequest, ObservatoryCameraSecretKeyState, ObservatoryCameraStream, ObservatoryCameraStreamCode, ObservatoryCameraStreamState, ObservatoryCamerasSnapshot, RtspTransport } from './observatorycameras'
export type {
	ObservingCandidate,
	ObservingConstraints,
	ObservingDiscoveryPage,
	ObservingDiscoveryRequest,
	ObservingConstraintsOverride,
	ObservingMinorBodyRefresh,
	ObservingMode,
	ObservingPlan,
	ObservingPlanDocument,
	ObservingPlanDuplicateRequest,
	ObservingPlanEvent,
	ObservingPlanItem,
	ObservingPlanItemPreview,
	ObservingPlanPreview,
	ObservingPlanPreviewRequest,
	ObservingPlanSaveRequest,
	ObservingPlansSnapshot,
	ObservingScheduleConflict,
	ObservingScheduleConflictCode,
	ObservingPlannerErrorCode,
	ObservingPlannerPresets,
	ObservingReasonCode,
	ObservingSample,
	ObservingScore,
	ObservingStatus,
	ObservingSummary,
	ObservingTargetRef,
	ObservingWindow,
	PlannerEphemerisProvenance,
	PlannerEphemerisSource,
	PlanningBodyCode,
	PlanningSite,
	ScheduleItemDiagnostics,
	ScheduleTotals,
	TargetAnalysis,
	TargetAnalysisRequest,
} from './observingplanner'
export type { GatewayCode, GatewayState, GatewayStatus, SourceCode } from './observatorycameras.gateway'
export type { CameraSecretKeyStatus } from './observatorycameras.secret'
export type { WhepErrorCode } from './observatorycameras.whep'
export type { OperationDevice, OperationEvent, OperationKind, OperationProgress, OperationRecord, OperationState } from './operations'
export type { OperationHistoryPage, OperationRun, OperationRunDevice, OperationRunState } from './operationhistory'
// oxfmt-ignore
export type { OrbitalMechanicsErrorCode, OrbitalMechanicsLimits, OrbitalMechanicsReference, OrbitCenterPayload, OrbitCompareNode, OrbitCompareRequest, OrbitCompareResponse, OrbitDefinitionPayload, OrbitElementsPayload, OrbitMarkerPayload, OrbitResolveRequest, OrbitResolveResponse, OrbitSolveRequest, OrbitSourcePayload, OrbitStateTable, OrbitSolveResponse, OrbitTrajectoryRequest, OrbitTrajectoryResponse, OrbitVector, OrbitWarning } from './orbitalmechanics'
export type { OrbitPreset, OrbitPresetSource } from './orbitalmechanics.presets'
export type { ClassicalElements, ConicClass, OrbitAngle, OrbitDiagnostics, ReferencePlane, UndefinedAngleReason } from 'nebulosa/src/astronomy/orbits/mechanics'
export type { ConicMarkerKind } from 'nebulosa/src/astronomy/orbits/sampling'
export type { RotatorMoveByRequest, RotatorMoveToRequest, RotatorReverseRequest, RotatorSyncRequest } from './rotators'
export type {
	SatelliteAutoDownloadRequest,
	SatelliteDetails,
	SatelliteElementSourceRequest,
	SatelliteEphemerisRequest,
	SatelliteEphemerisResponse,
	SatelliteErrorCode,
	SatelliteGroundTrackRequest,
	SatelliteGroundTrackResponse,
	SatelliteGroupStatus,
	SatelliteImportRequest,
	SatelliteImportResponse,
	SatellitePassesRequest,
	SatellitePassesResponse,
	SatellitePositionRequest,
	SatellitePositionResponse,
	SatelliteRefreshResponse,
	SatellitesChangedEvent,
	SatelliteSourcesSnapshot,
	SatelliteTrackEntry,
	SatelliteTracksRequest,
	SatelliteTracksResponse,
} from './satellites'
export type { RejectedRecord, SatelliteRecordError } from './satellites.elements'
export type {
	SpiceCatalogItem,
	SpiceEphemerisPolicy,
	SpiceKernelCoverage,
	SpiceKernelDetails,
	SpiceKernelDownloadRequest,
	SpiceKernelErrorCode,
	SpiceKernelEvent,
	SpiceKernelGenerateRequest,
	SpiceKernelImportResponse,
	SpiceKernelJob,
	SpiceKernelJobKind,
	SpiceKernelJobState,
	SpiceKernelLibrarySnapshot,
	SpiceKernelReadiness,
	SpiceKernelRecord,
	SpiceKernelSettingsRequest,
	SpiceKernelSourceKind,
	SpiceKernelState,
	SpiceKernelSummary,
	SpiceKernelUpdateRequest,
	SpiceSegmentRecord,
} from './spicekernels'
export type { SatelliteElementsRef, SatelliteEphemerisRow, SatelliteGroundTrack, SatelliteOrbitSummary, SatellitePassPoint, SatellitePassPrediction, SatellitePosition, SatelliteQuality, SatelliteQualityReason, SatelliteSuitability, SatelliteTrack, SatelliteVisiblePart } from './satellites.ephemeris'
export type { SatelliteCatalogMetadata, SatelliteElementKind, SatelliteObjectType, SatelliteProvider, SatelliteSearchPage, SatelliteSourceState, SatelliteSummary } from './satellites.store'
export type { SatelliteRefreshErrorCode } from './satellites.sync'
export type { PlanetaryFallbackReason, PlanetaryKernelReadiness, PlanetaryReadinessReport, PlanetarySourceErrorCode, PlanetarySourceMiss } from './planetary.source'
export type { PlanetEventVisibility, PlanetNight, PlanetVisibilityStatus } from './planetary.visibility'
export type { SaturnErrorCode, SaturnEvents } from './saturn'
// oxfmt-ignore
export type { SaturnElongation, SaturnElongations, SaturnElongationsRequest, SaturnFallbackReason, SaturnMoon, SaturnMoonsState, SaturnMoonState, SaturnRingEvent, SaturnRingModel, SaturnRings, SaturnRingState, SaturnRingTimeline, SaturnRingTimelineRequest, SaturnScope, SaturnShadow, SaturnSignature, SaturnSource, SaturnSourceMiss, SaturnSourceReport, SaturnSourceRequest, SaturnStateRequest, SaturnTrack, SaturnTrackMoon, SaturnTrackRequest } from './saturn.astronomy'
// oxfmt-ignore
export type { SaturnEvent, SaturnEventContacts, SaturnEventKind, SaturnEventsRequest, SaturnEventVisibility, SaturnNight, SaturnVisibilityReason, SaturnVisibilityStatus } from './saturn.events'
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
export type { StarProfileCut, StarProfileMeasured, StarProfileMeasurement, StarProfileNoStar, StarProfileNoStarReason, StarProfilePreview, StarProfileRequest, StarProfileResult } from './starprofile.analysis'
export type { StarProfileErrorCode } from './starprofile'
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
export type { SampleTileHeader } from './imagesamples'
export type { ImageStatisticsErrorCode, ImageStatisticsEvent, ImageStatisticsJob, ImageStatisticsJobState, ImageStatisticsReport, ImageStatisticsRequest, ImageStatisticsSnapshot, ImageStatisticsSummary, PlaneStatistics, StatisticsBackground, StatisticsHistogram, StatisticsNumericLimits } from './imagestatistics'
export type { StreakContextSources, StreakDetectionErrorCode, StreakDetectionEvent, StreakDetectionJob, StreakDetectionJobState, StreakDetectionRequest, StreakDetectionResult, StreakDetectionSnapshot, StreakDetectionSummary, StreakDetectorSettings } from './streaks'
export type { PlateSolutions, PlateSolveErrorCode, PlateSolveJob, PlateSolveJobState, PlateSolveOrigin, PlateSolveOutcome, PlateSolveRemote, PlateSolveRequest, PlateSolveResult, PlateSolverProvider, PlateSolverSettings, PlateSolveSnapshot, PlateSolveStage, PlateSolveSummary, PlateSolvingEvent } from './platesolving'
export type { PlateSolveHint, PlateSolveHints, PlateSolveHintSource, PlateSolveStrategy, ResolvedPlateSolveHints } from './platesolving.hints'
export type { EphemerisFallbackReason, EphemerisMode, EphemerisSource, EphemerisUnavailableCode, SkyEvents, SkyObserver, SkyPosition, SkyPositionKernels } from './sky/ephemeris'
export type { SolarActiveRegion, SunActiveRegionsErrorCode, SunActiveRegionsResponse } from './sky/activeregions'
export type { MoonAlmanacRequest, MoonAlmanacResponse, MoonApsisEvent, MoonAppearance, MoonPhaseEvent, MoonPhaseName, MoonPrincipalPhase, MoonSurfacePoint } from './sky/moon'
export type { LunarFeatureCategory, LunarFeatureRow, MoonFeatureCatalog, MoonFeatureCatalogSource } from './sky/moon.features'
export type { SunImageChannel, SunImageErrorCode, SunImageSize } from './sky/sdo'
export type { SolarAstronomicalNight, SolarDailyState, SolarSeasonEvent, SolarSeasonKind, SolarTwilightCrossings, SunAlmanacRequest, SunAlmanacResponse, SunLocalDay, SunLocalNight, SunPhysicalData, TimeSpan } from './sky/sun'
export type {
	MinorBody,
	MinorBodyAlternateOrbit,
	MinorBodyDetails,
	MinorBodyDetailsResponse,
	MinorBodyDiscovery,
	MinorBodyOrbitDetails,
	MinorBodyParameter,
	MinorBodyPublishedValue,
	MinorBodyRadarObservation,
	MinorBodySatellite,
	MinorBodySearchResponse,
	MinorBodyVirtualImpactor,
	SkyBodiesRequest,
	SkyBodyPosition,
	SkyCatalogClass,
	SkyCatalogEntry,
	SkyCatalogObject,
	SkyCatalogPage,
	SkyCatalogQuery,
	SkyConstellation,
	SkyConstellations,
	SkyDeepSkyData,
	SkyObjectCategory,
	SkyObjectRef,
	SkyPositionRequest,
	SkyPositionResponse,
	SkySearchResult,
	SkyStarData,
	SolarSystemBodyCode,
} from './sky/types'
export type {
	Binning,
	DisplayDebayer,
	DisplayScnr,
	DisplaySettings,
	DisplayStretch,
	ImageAcquisition,
	ImageCapture,
	ImageFormat,
	ImageInfo,
	ImageOpenRequest,
	ImageOrigin,
	ImageProperties,
	ImageProvenance,
	ImageRect,
	LiveStackingProvenance,
	LiveStackingProvenanceStack,
	ProcessingProvenance,
	RenderRequest,
	RenderResult,
	SampleConversion,
	SaveFormat,
	SaveRequest,
	SaveResult,
	Stretch,
} from './images'
export type {
	ArcsinhStretchOperation,
	BackgroundExtractionOperation,
	BackgroundNeutralizationOperation,
	CosmeticCorrectionOperation,
	DebayerOperation,
	GaussianBlurOperation,
	GrayscaleOperation,
	ImageProcessingClaimRequest,
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
export type {
	ImageStackingErrorCode,
	ImageStackingEvent,
	ImageStackingSnapshot,
	LightMasterKind,
	StackingCohort,
	StackingCohortPatch,
	StackingCompositeDetail,
	StackingCompositeSummary,
	StackingCompositionIssue,
	StackingCompositionIssueCode,
	StackingCompositionValidation,
	StackingFilterGroup,
	StackingFinding,
	StackingFindingCode,
	StackingFindingSeverity,
	StackingFrameSummary,
	StackingImportCandidate,
	StackingImportCommit,
	StackingImportRequest,
	StackingJobState,
	StackingJobSummary,
	StackingMasterCandidate,
	StackingPreflight,
	StackingPreflightGroup,
	StackingProductDetail,
	StackingProductStatus,
	StackingProductSummary,
	StackingProjectDetail,
	StackingProjectSummary,
	StackingSourceDetail,
	StackingRunRequest,
	StackingSourcePatch,
	StackingValidation,
} from './imagestacking'
export type { IntegrationPlan } from './imagestacking.integration'
export type { StackingRole } from './imagestacking.sources'
// oxfmt-ignore
export type { StackingCalibration, StackingCohortDecision, StackingComposite, StackingCompositeDiagnostics, StackingComposition, StackingCompositionLuminance, StackingCompositionSource, StackingFrameAnalysis, StackingFrameNormalization, StackingProduct, StackingProductDiagnostics, StackingProductSource, StackingProject, StackingProjectAnalysis, StackingRecipe, StackingRegistration, StackingSettings, StackingSourceSummary } from './imagestacking.store'
export type { JupiterErrorCode, JupiterGrsResponse } from './jupiter'
// oxfmt-ignore
export type { JupiterDisk, JupiterEvent, JupiterEventContacts, JupiterEventKind, JupiterEvents, JupiterEventsRequest, JupiterEventVisibility, JupiterFallbackReason, JupiterGrsMarker, JupiterGrsQuality, JupiterGrsStatus, JupiterGrsTransit, JupiterKernelReadiness, JupiterMoonState, JupiterNight, JupiterSignature, JupiterSource, JupiterSourceMiss, JupiterSourceReport, JupiterSourceRequest, JupiterState, JupiterStateRequest, JupiterTrack, JupiterTrackMoon, JupiterTrackRequest, JupiterVisibilityReason, JupiterVisibilityStatus } from './jupiter.astronomy'
export type { JupiterGrsEvent, JupiterGrsModel, JupiterGrsSaveRequest, JupiterGrsSettings } from './jupiter.store'
export type {
	LiveCohortAcquisition,
	LiveStackingCapture,
	LiveStackingCohort,
	LiveStackingCounters,
	LiveStackingErrorCode,
	LiveStackingEvent,
	LiveStackingFieldSummary,
	LiveStackingProductDetail,
	LiveStackingSession,
	LiveStackingSnapshot,
	LiveStackingStartRequest,
	LiveStackingState,
	LiveStackingView,
	LiveStackingViewTarget,
} from './livestacking'
export type { LiveCompositionSource, LiveExportTarget, LiveStackingComposition, LiveStackingRecipe } from './livestacking.engine'
export type { LiveCalibrationFallback, LiveFilterCalibration, LiveMasterKind, LiveStackingCalibration } from './livestacking.groups'
export type { LiveProductCohort, LiveStackingProduct } from './livestacking.store'
export type { DarvCaptureSettings, DarvEvent, DarvFinishRequest, DarvMeasurement, DarvMeasurementRequest, DarvMeasurementState, DarvMeasurementTrails, DarvRequest, DarvSession, DarvSessionState, DarvSessionSummary, DarvSnapshot, DarvStartResponse } from './darv'
export type { DarvMeasurementResult, DarvMeasurementStatus, DarvTrail } from './darv.analysis'
export type {
	DarkLibraryWizardAttempt,
	DarkLibraryWizardCaptureSettings,
	DarkLibraryWizardContinueRequest,
	DarkLibraryWizardErrorCode,
	DarkLibraryWizardEvent,
	DarkLibraryWizardGroupRun,
	DarkLibraryWizardGroupState,
	DarkLibraryWizardPendingStep,
	DarkLibraryWizardRequest,
	DarkLibraryWizardSession,
	DarkLibraryWizardSessionSummary,
	DarkLibraryWizardSnapshot,
	DarkLibraryWizardStartResponse,
	DarkLibraryWizardState,
} from './darklibrarywizard'
export type { DarkFrameNote, DarkLightSuspicion, DarkPlaneMeasurement, DarkRejectionCode, DarkTemperatureTrace } from './darklibrarywizard.analysis'
export type { DarkFrameRecord, DarkFrameVerdict, DarkGroup, DarkGroupProgress, DarkPlanCapture, DarkProtection, DarkThermalPolicy } from './darklibrarywizard.plan'
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
	GuidingCalibrationCandidates,
	GuidingCalibrationList,
	GuidingCalibrationPatch,
	GuidingCalibrationPolicy,
	GuidingCalibrationProgress,
	GuidingCalibrationSummary,
	GuidingCameraSettings,
	GuidingClientSettings,
	GuidingCommand,
	GuidingCommandAccepted,
	GuidingCommandStatus,
	GuidingDarkCalibration,
	GuidingDarkCandidates,
	GuidingDarkChange,
	GuidingDarkRequest,
	GuidingDitherRequest,
	GuidingEventRecord,
	GuidingExposureRequest,
	GuidingFrameOverlay,
	GuidingMountContext,
	GuidingPage,
	GuidingPauseRequest,
	GuidingRestoreCalibrationRequest,
	GuidingResumeRequest,
	GuidingRms,
	GuidingServerEvent,
	GuidingSessionCalibration,
	GuidingSessionSummary,
	GuidingSnapshot,
	GuidingStartGuidingRequest,
	GuidingStartRequest,
	GuidingStartResponse,
	GuidingTargetRequest,
	GuidingTelemetryAxis,
	GuidingTelemetryPhase,
	GuidingTelemetrySample,
} from './guiding'
export type { GuidingCalibrationCandidate, GuidingCalibrationEntry, GuidingCalibrationEvidence, GuidingCalibrationRejection, StoredGuidingCalibration } from './guidingcalibration'
export type { GuidingCalibrationHeader } from './guidingcalibration.store'
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
export type { PointingAcquisitionState, PointingModelExport, PointingModelFile, PointingModelSummary, PointingMountIdentity, PointingOpticsFingerprint, PointingPlanRecord, PointingRevision, PointingSampleRecord, PointingVerification } from './mountpointing.store'
export type { TppaAlignment, TppaAttempt, TppaCaptureSettings, TppaEvent, TppaGeometry, TppaOverlay, TppaPoint, TppaRequest, TppaSession, TppaSessionSummary, TppaSnapshot, TppaStartResponse, TppaState } from './tppa'
export type { DarkEvidence, DarkRejection } from './calibrationdark'
export type {
	IPolarAttempt,
	IPolarCalibrationSummary,
	IPolarCaptureSettings,
	IPolarDarkCode,
	IPolarDarkRequest,
	IPolarDarkState,
	IPolarDarkStatus,
	IPolarErrorCode,
	IPolarEvent,
	IPolarMeasurementSummary,
	IPolarOverlay,
	IPolarPose,
	IPolarRejectionSummary,
	IPolarRequest,
	IPolarSession,
	IPolarSessionSummary,
	IPolarSite,
	IPolarSnapshot,
	IPolarStartResponse,
	IPolarState,
} from './ipolar'
export type {
	TargetCenteringAttempt,
	TargetCenteringCaptureSettings,
	TargetCenteringEvent,
	TargetCenteringGuidingRestoration,
	TargetCenteringMode,
	TargetCenteringOutcome,
	TargetCenteringRefusal,
	TargetCenteringRequest,
	TargetCenteringSession,
	TargetCenteringSessionSummary,
	TargetCenteringSnapshot,
	TargetCenteringStartResponse,
	TargetCenteringState,
	TargetCenteringStep,
	TargetCenteringTarget,
} from './targetcentering'
export type { GuidingProfileCut, GuidingStarProfile } from './guidingprofile'
export type { NotificationCreatedEvent, NotificationRecord, NotificationSnapshot } from './notifications'
export type { NotificationCameraTool, NotificationLevel, NotificationSource, NotificationTarget } from './notifications.rules'
export type { ClientMessage, ServerEvent } from './websocket'
export type {
	ObservingSite,
	ObservingSiteSaveRequest,
	ProfileCameraForm,
	ProfilePreferenceKey,
	ProfileRecord,
	ProfileSaveRequest,
	SavedConnection,
	SavedConnectionSaveRequest,
	WorkspaceDevice,
	WorkspaceErrorCode,
	WorkspaceEvent,
	WorkspaceFramingReference,
	WorkspaceMountBinding,
	WorkspaceNotificationState,
	WorkspaceSnapshot,
	WorkspaceValue,
	WorkspaceValueSaveRequest,
} from './workspace'
export { websocket }

// Whether the operational database is locked against every other process while the server runs: in production only,
// so a second server on the same data directory is refused, while in development a database browser can read and write it
// beside the server.
const EXCLUSIVE_DATABASE = process.env.NODE_ENV === 'production'

// Operational database of the server, opened by the app before it serves; a test that only imports this module opens
// nothing.
const database = new AppDatabase(DEFAULT_DATABASE_FILE, EXCLUSIVE_DATABASE)

// Saved connections and profiles of the operators, shared by every tab and browser; the observatory cameras of a deleted
// site become shared by every site.
const workspace = new Workspace(database, (event) => {
	broadcast(event)
	if (event.type === 'observingSite:removed') observatoryCameras.siteRemoved(event.id)
})

// Name of a device of an open connection, or undefined.
function deviceName(connectionId: string, deviceId: string) {
	return connections.devices.get(connections.client(connectionId), deviceId)?.name
}

// History of the notifications, created from the events of the connections, the operations, and the sessions; its
// own notification:created events are broadcast directly, so they are never classified again.
const notifications = new NotificationService(broadcast, { database, classifier: new NotificationClassifier(deviceName) })

// History of the device operations: when each one started and how it ended.
const operationHistory = new OperationRecorder(database, deviceName)

// Fan-out of the events of the connections, the operations, and the sessions: the broadcast first, then the operation
// history and the notification history, so a tab sees a change before the notification about it; a service of the process
// observing the others subscribes after them.
const events = new ServerEventDispatcher()
events.subscribe(broadcast)
events.subscribe((event) => operationHistory.consume(event))
events.subscribe((event) => notifications.consume(event))

// Publishes an event of the connections, the operations, or the sessions to every subscriber of events.
function publish(event: ServerEvent) {
	events.publish(event)
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

// Meridian Flip Monitors of the mounts of the open connections: they observe the mount telemetry and the motion
// operations through the dispatcher, after its other subscribers, and command nothing.
const meridianFlip = new MeridianFlipService(connections.devices, (id) => connections.client(id), operations, publish)
events.subscribe((event) => meridianFlip.consume(event))

// Pulse guiding of the guide outputs of the open connections.
const guideOutputs = new GuideOutputCommands(connections.devices, (id) => connections.client(id), operations)

// Focuser, filter wheel, and rotator commands over the devices of the open connections; focuser moves apply the
// backlash compensation saved for each focuser.
const focusers = new FocuserCommands(connections.devices, (id) => connections.client(id), operations, new FocuserBacklashStore(database), broadcast)
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

// The <message> elements of the INDI servers of the open connections: a global one becomes a notification through
// the server events, a device one is kept for the Messages view of that device and streamed only to the sockets
// that subscribed to it; a connection that closes drops what it kept.
const indiMessages = new IndiMessageService(connections.devices, (id) => connections.client(id), publish)
listenSockets(indiMessages)
connections.listen((event) => indiMessages.connectionChanged(event))

// Settings of the external programs, such as ASTAP, read by the services that run them; a change of MediaMTX restarts the
// gateway of the observatory cameras.
const externalTools = new ExternalToolsStore(database, (event) => {
	broadcast(event)
	observatoryCameras.externalToolChanged(event)
})

// IP cameras watching the observatory, relayed to the browsers by the MediaMTX gateway set in External Tools; their
// addresses are encrypted with the key of NEBULOSA_CAMERA_SECRET_KEY, else of the operating system's credential storage.
const observatoryCameras = new ObservatoryCameraService(
	new ObservatoryCameraStore(database),
	new CameraSecretKey(process.env[CAMERA_SECRET_KEY_VARIABLE], systemSecretStorage(DEFAULT_DATABASE_FILE)),
	async () => {
		const tool = await externalTools.resolve('mediamtx')
		return tool && { executable: tool.executable, timeout: tool.timeout }
	},
	broadcast,
)

// Star detection of the image documents, shared by the Images workspace and the captures.
const stars = new StarDetectionService(images, externalTools, broadcast)
const plateSolving = new PlateSolvingService(images, externalTools, broadcast)

// Measurements of the stars a person points at in the image documents.
const starProfiles = new StarProfileService(images)

// Streak detection of the image documents, classified with the solutions and stars already found for each image.
const streaks = new StreakDetectionService(images, plateSolving, stars, broadcast)

// Histogram and statistics of the original samples of the image documents, scanned on the image worker.
const imageStatistics = new ImageStatisticsService(images, broadcast)

// Annotation of the image documents with the sky catalog and SkyBoT, through the WCS of each image.
const annotations = new AnnotationService(images, plateSolving, annotationSky, broadcast)

// Image processing pipelines of the image documents, each adopting its result as a new derived document.
const imageProcessing = new ImageProcessingService(images, broadcast)

// Index of the captured frames of every camera, holding their documents for the Images workspace; the leases of a tab
// follow its event sockets, and cameras are republished when their connection state changes.
const captureFrames = new CaptureFrameRegistry(images, broadcast, {
	database,
	connected: (connectionId, deviceId) => {
		const client = connections.client(connectionId)
		return !!client && !!connections.devices.camera(client, deviceId)?.connected
	},
})
connections.listen((event) => captureFrames.deviceChanged(event))
listenClients(captureFrames)
listenClients(images)

// The Calibration Library, single owner of the calibration frames and masters, which needs no connection and holds no
// device; its automatic masters wait for the camera operations, and the guiding sessions read its master darks too.
const calibrationLibrary = new CalibrationLibrary(new CalibrationLibraryStore(database), publish, () => operations.running().some(({ kind }) => kind.startsWith('camera.')))

// Guiding sessions of the guide cameras of the open connections, dispatching their pulses through the commander of the
// guide output commands and previewing their frames in the image store and the capture frame registry.
const guiding = new GuidingSessions(connections.devices, (id) => connections.client(id), operations, guideOutputs.commander, images, captureFrames, externalTools, new GuidingCalibrationStore(database), calibrationLibrary, publish)

// Automatic dithering of the camera captures, commanded to the guiding sessions, or moving the mounts with the commanders of
// the mount and guide output commands, refusing a GoTo dither the Meridian Flip Monitor or the geometry says could flip.
const dithering = new CaptureDithering(connections.devices, (id) => connections.client(id), operations, guiding, { mount: mounts.commander, guideOutput: guideOutputs.commander }, meridianFlip)

// Camera captures over the devices of the open connections, their frames entering the image store, dithering between
// their frames when their request asks for it.
const captures = new CameraCaptures(connections.devices, (id) => connections.client(id), operations, images, captureFrames, publish, undefined, dithering)

// Auto Focus sessions of the cameras of the open connections, taking their frames with the capturer of the captures and
// moving the focusers with their backlash compensation.
const autoFocus = new AutoFocusSessions(connections.devices, (id) => connections.client(id), operations, captures.capturer, focusers.mover, images, captureFrames, stars, publish)

// TPPA sessions of the cameras of the open connections, rotating the mounts with the commander of the mount commands,
// taking their frames with the capturer of the captures, and solving them with the plate solving service.
const tppa = new TppaSessions(connections.devices, (id) => connections.client(id), operations, mounts.commander, captures.capturer, images, captureFrames, plateSolving, publish)

// iPolar sessions of the cameras of the open connections, rotating the mounts in automatic mode with the commander of
// the mount commands, taking their frames with the capturer of the captures, and solving them with the plate solving service,
// less the master dark of the Calibration Library a session pinned.
const ipolar = new IPolarSessions(connections.devices, (id) => connections.client(id), operations, mounts.commander, captures.capturer, images, captureFrames, plateSolving, calibrationLibrary, publish)

// Fits the pointing models on a worker of its own.
const pointingModelFitter = new PointingModelFitter()

// Mount pointing models, persisted under the home of the server and fitted on a worker of their own.
const pointingModels = new PointingModels(new PointingModelStore(database), pointingModelFitter, publish)

// Mount pointing sessions of the cameras of the open connections, slewing the mounts with the commander of the mount
// commands, so no model corrects them, taking their frames with the capturer of the captures, and solving them with the
// plate solving service.
const mountPointing = new MountPointingSessions(connections.devices, (id) => connections.client(id), operations, mounts.commander, captures.capturer, images, captureFrames, plateSolving, pointingModels, publish)

// Activation of the models: the checks of the moment, and the routes of the models in force.
const pointingActivations = new PointingActivations(connections.devices, (id) => connections.client(id), corrections, pointingModels, operations)

// Analyzes the DARV frames on a worker of its own.
const darvAnalyzer = new DarvAnalyzer(images)

// DARV sessions of the cameras of the open connections, moving the mounts with the commander of the mount commands,
// taking their frames with the capturer of the captures, and analyzing them on a worker of their own.
const darv = new DarvSessions(connections.devices, (id) => connections.client(id), operations, mounts.commander, captures.capturer, images, captureFrames, darvAnalyzer, publish)

// Projects of light frames for Image Stacking, which need no connection and hold no device. Imports never read the
// directories of Nebulosa: its stacks and the Calibration Library.
const imageStacking = new ImageStacking(new ImageStackingStore(database), publish, calibrationLibrary, [DEFAULT_IMAGE_STACKING_DIRECTORY, DEFAULT_CALIBRATION_LIBRARY_DIRECTORY])

// Live Stacking sessions of the cameras of the open connections, fed every light frame of their captures by the capture
// service, calibrated with the masters of the Calibration Library, and integrated on a worker of their own per session.
const liveStacking = new LiveStacking(captures, connections.devices, (id) => connections.client(id), calibrationLibrary, images, new LiveStackingStore(database), publish)

// Measures Flat Wizard frames in DN on a worker of its own.
const flatWizardAnalyzer = new FlatWizardAnalyzer()

// Flat Wizard sessions of the cameras of the open connections, taking their frames with the capturer of the captures,
// moving the wheels, driving the panels, and closing and opening the covers with the commanders of their commands,
// previewing and recording the frames in the capture frame registry, and measuring them in DN on a worker of their own.
const flatWizard = new FlatWizardSessions(
	connections.devices,
	(id) => connections.client(id),
	operations,
	captures.capturer,
	wheels.commander,
	flatPanels.commander,
	covers.commander,
	images,
	captureFrames,
	flatWizardAnalyzer,
	publish,
	undefined,
	(frame) => void calibrationLibrary.registerFlat(frame).catch((error: unknown) => console.error('A flat could not be registered', error)),
	(ended) => void calibrationLibrary.flatSessionEnded(ended).catch((error: unknown) => console.error('The calibration library could not build the flats of a session', error)),
)

// Dark Library Wizard sessions of the cameras of the open connections, taking their frames with the capturer of the
// captures, cooling the cameras, moving the wheels, and driving the panels and covers with the commanders of their
// commands, measuring their frames in DN on a worker of their own, and handing the darks they publish to the Calibration Library.
const darkLibraryWizardAnalyzer = new DarkLibraryWizardAnalyzer()

const darkLibraryWizard = new DarkLibraryWizardSessions(
	connections.devices,
	(id) => connections.client(id),
	operations,
	captures.capturer,
	cameras.commander,
	wheels.commander,
	flatPanels.commander,
	covers.commander,
	images,
	captureFrames,
	darkLibraryWizardAnalyzer,
	publish,
	undefined,
	(frame) => void calibrationLibrary.registerDark(frame).catch((error: unknown) => console.error('A dark could not be registered', error)),
	(plan) => void calibrationLibrary.darkSessionEnded(plan).catch((error: unknown) => console.error('The calibration library could not build the darks of a session', error)),
)

// Target Centering sessions of the cameras of the open connections, sending the first slew through the mount commands, so a
// model in force corrects it once, correcting with their commander from what the plate solving service measures, and taking
// their frames with the capturer of the captures.
const targetCentering = new TargetCenteringSessions(connections.devices, (id) => connections.client(id), operations, mounts, mounts.commander, captures.capturer, images, captureFrames, plateSolving, guiding, publish)

// Meridian Flip Executor of the mounts of the open connections: flips at the meridian passage the Monitor follows, composing the
// captures, guiding, mount commands, Target Centering, and Auto Focus, after the Monitor so it reads its state of each event.
const meridianFlipExecutor = new MeridianFlipExecutor(connections.devices, (id) => connections.client(id), operations, { monitor: meridianFlip, mounts, captures, guiding, targetCentering, autoFocus }, publish)
events.subscribe((event) => meridianFlipExecutor.consume(event))

// Lunar eclipse queries of the Lunar Eclipse Map tool.
const lunarEclipses = new LunarEclipseService()

// Solar eclipse queries of the Solar Eclipse Map tool; their maps are computed on a worker.
const solarEclipses = new SolarEclipseService()

// Close approach queries of the Close Approaches tool, over the minor bodies and the JPL queue of the Sky.
const closeApproaches = new CloseApproachesService(minorBodies, ssdRequests)

// Stateless two-body analysis of the Orbital Mechanics Explorer.
const orbitalMechanics = new OrbitalMechanicsService({ minorBodies, kernels: spiceKernels })

// Forecasts of the Astro Weather tool, read from their public services and cached for every tab.
const astroWeather = new AstroWeatherService()

// Target discovery and analysis of the Observing Planner, over the sky catalog and the nights of Astro Weather, and its
// night plans in the operational database, sent to every tab once saved.
const observingPlanner = new ObservingPlannerService({ catalog: skyCatalog, night: (request) => astroWeather.night(request), store: new ObservingPlanStore(database), listener: broadcast, minorBodies, kernels: spiceKernels, queue: ssdRequests, minorBodyStore: new ObservingMinorBodyStore(database) })

// Read-only predictions of the Jupiter Observing Planner over the SPICE kernels or the analytical theories, and the
// server's Great Red Spot model in the operational database, sent to every tab once saved.
const jupiterPlanner = new JupiterPlannerService({ kernels: spiceKernels, night: (request) => astroWeather.night(request), store: new JupiterGrsStore(database, broadcast) })
const saturnPlanner = new SaturnPlannerService({ kernels: spiceKernels, night: (request) => astroWeather.night(request) })

// Earth orientation tables of the process, shared by the converter and, once installed, by every Time of the server.
const earthOrientation = new EarthOrientationData()

// Conversions of the Astronomical Time Converter and the real-time reference of the status bar clock.
const astronomicalTime = new AstronomicalTimeService(earthOrientation)

// Artificial satellite catalog of the operational database, its CelesTrak downloads under the provider's fair-use
// rules, and the SGP4 predictions of the Artificial Satellites tool and the Sky.
const satelliteStore = new SatelliteStore(database)
const satelliteSync = new SatelliteSync(satelliteStore, () => satellites.changed())
const satellites = new SatelliteService(satelliteStore, satelliteSync, new SatelliteEphemeris((utc) => earthOrientation.coverage(utc)), broadcast)
const satelliteAutoDownload = new SatelliteAutoDownload(satellites)

// SPICE Kernel Library: the SPK files of the operational database and its directory, the runtime set the Sky ephemeris
// evaluates, and the curated downloads and Horizons generations, which share the JPL queue.
const spiceKernelLibrary = new SpiceKernelLibrary(new SpiceKernelStore(database), spiceKernels, broadcast, ssdRequests)

// Opens the operational database and brings its schema up to date, before anything is served, creates the Default
// profile when it has none, and records the operations and the pointing model acquisitions a previous run left running
// as interrupted; nothing resumes them. Throws an Error saying why it cannot be opened (another server uses it, the file
// is not a database, or its schema is newer than this server knows), leaving the file as it is; the app then stops.
export function startDatabase() {
	database.open()
	workspace.ensureProfile()
	operationHistory.interruptRunning()
	pointingModels.store.interruptRunning()
}

// Closes the operational database, for a server about to stop.
export function closeDatabase() {
	database.close()
}

// Longest wait for the running operations to stop before the server exits, in milliseconds: within the 5 s Windows gives
// a console window that is being closed, leaving time to close the database.
const STOP_TIMEOUT = 3000

// Cancels every running device operation and waits, at most STOP_TIMEOUT, for each one to stop what it commanded, so a
// server about to exit never leaves a device moving, such as a mount under a held nudge, whose driver keeps the motion
// once the connection closes. Called by the app before it closes the database; never rejects.
export function stopOperations() {
	return operations.stop(STOP_TIMEOUT)
}

// Services holding devices, sockets, listeners, timers, or workers, in the order a server stopping in place releases them:
// the sessions and commands before the registries they use, the image documents once nothing closes one any more, the
// connections last.
const RESOURCES: readonly Disposable[] = [
	meridianFlipExecutor,
	liveStacking,
	imageStacking,
	calibrationLibrary,
	guiding,
	darkLibraryWizard,
	darkLibraryWizardAnalyzer,
	flatWizardAnalyzer,
	darvAnalyzer,
	pointingModelFitter,
	captures,
	captureFrames,
	mountRemoteControl,
	observatoryCameras,
	meridianFlip,
	indi,
	indiMessages,
	mounts,
	corrections,
	guideOutputs,
	focusers,
	wheels,
	rotators,
	covers,
	flatPanels,
	dewHeaters,
	cameras,
	domes,
	solarEclipses,
	satelliteAutoDownload,
	spiceKernelLibrary,
	spiceKernels,
	stars,
	streaks,
	imageStatistics,
	imageProcessing,
	images,
	operations,
	connections,
]

// Stops the server in place, as development does before a hot reload evaluates the server code again, which otherwise
// leaves the previous run alive beside the new one: its connections to the devices, the operations commanding them, the
// listeners on their ports, and the database. Cancels the running operations as stopOperations does, releases every
// service, closes every connection and the database, and resolves the requests of the connections that were open, so
// the next run can open them again. A service that fails to release is logged and the others still are. Never rejects.
export async function stopServer(): Promise<ConnectRequest[]> {
	const open = connections.list().map(connectRequestOf)
	await stopOperations()
	await stopObservatoryCameras()

	for (const resource of RESOURCES) {
		try {
			resource[Symbol.dispose]()
		} catch (error) {
			console.error('A service could not be released', error)
		}
	}

	database.close()
	return open
}

// Returns the request that opens a connection again: its endpoint, without its id.
function connectRequestOf(status: ConnectionStatus): ConnectRequest {
	return status.type === 'SIMULATOR' ? { type: 'SIMULATOR' } : { type: status.type, host: status.host, port: status.port }
}

// Opens again the connections a previous run of the server had open, one by one; one that cannot be opened is logged.
export async function reopenConnections(requests: readonly ConnectRequest[]) {
	for (const request of requests) {
		try {
			await connections.connect(request)
		} catch (error) {
			console.error(`The connection to ${request.type === 'SIMULATOR' ? 'the simulator' : `${request.host}:${request.port}`} could not be opened again`, Error.isError(error) ? error.message : error)
		}
	}
}

// Reads the cached Earth orientation tables and makes them the default of the toolkit, so the Sky, the mounts, and the pointing
// models read the same UT1 as the converter, and starts a refresh of old tables, so they are kept current even if nothing ever
// opens the converter or the clock. Called by the app before it serves; a test that only imports this module keeps the empty
// tables of the toolkit. Never waits on the network, and never rejects.
export async function startEarthOrientation() {
	await earthOrientation.prepare()
	installEarthOrientation(earthOrientation)
}

// Opens the Calibration Library, the projects of Image Stacking, and the saved stacks of Live Stacking in the background,
// so what a crash left of their products is finished before anyone opens the tools. Called by the app after startDatabase and before it serves; a test
// that only imports this module opens no file. Never rejects: a request opens them again and reports its failure.
export function startStores() {
	void calibrationLibrary.ready().catch((error: unknown) => console.error('The calibration library could not be opened', error))
	void imageStacking.ready().catch((error: unknown) => console.error('The image stacking projects could not be opened', error))
	void liveStacking.ready().catch((error: unknown) => console.error('The live stacking products could not be opened', error))
}

// Opens the kernels of the SPICE Kernel Library in the background, after finishing what a previous run left (staged
// files, pending deletions) and checking their files; until then the Sky uses its other sources. Called by the app after
// startDatabase; a test that only imports this module opens no kernel. Never rejects.
export function startSpiceKernels() {
	void spiceKernelLibrary.start()
}

// Starts the automatic downloads of the CelesTrak groups an operator turned on: one run now, then every 6 hours, each
// group within its fair-use interval. Called by the app after startDatabase and identifyCelestrakClient; a test that only
// imports this module downloads nothing. Never rejects.
export function startSatelliteDownloads() {
	satelliteAutoDownload.start()
}

// Starts the MediaMTX gateway of the observatory cameras when any is enabled and MediaMTX is set in External Tools, and
// configures their paths; a stream is still read only while a browser watches it. Called by the app after startDatabase;
// a test that only imports this module starts nothing. Never rejects: a gateway that cannot start degrades only this feature.
export function startObservatoryCameras() {
	void observatoryCameras.start().catch((error: unknown) => console.error('The observatory cameras could not be started', error))
}

// Stops the gateway of the observatory cameras and waits for its process to end, so a server stopping (or replaced by a
// hot reload) never leaves it running. Never rejects.
export function stopObservatoryCameras() {
	return observatoryCameras.stop()
}

// Names the running version to JPL, as its fair-use policy asks of automated clients. Called by the app before it serves,
// since this package does not know the version of the distribution.
export function identifyJplClient(version: string) {
	ssdRequests.identify(version)
}

// Names the running version to CelesTrak in the User-Agent of the satellite catalog downloads. Called by the app before
// it serves, like identifyJplClient.
export function identifyCelestrakClient(version: string) {
	satelliteSync.identify(version)
}

// Bun.serve routes under /api/.
export const routes = {
	'/api/health': {
		GET: () => Response.json({ status: 'ok' }),
	},
	...createOperationRoutes(operations),
	...createOperationHistoryRoutes(operationHistory),
	...createNotificationRoutes(notifications),
	...createConnectionRoutes(connections),
	...createIndiRoutes(indi),
	...createMountRoutes(mounts),
	...createMountRemoteControlRoutes(mountRemoteControl),
	...createMeridianFlipRoutes(meridianFlip),
	...createMeridianFlipExecutorRoutes(meridianFlipExecutor),
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
	...createIPolarRoutes(ipolar),
	...createPointingModelRoutes(pointingModels),
	...createMountPointingRoutes(mountPointing),
	...createPointingActivationRoutes(pointingActivations),
	...createDarvRoutes(darv),
	...createFlatWizardRoutes(flatWizard),
	...createDarkLibraryWizardRoutes(darkLibraryWizard),
	...createCalibrationLibraryRoutes(calibrationLibrary),
	...createImageStackingRoutes(imageStacking),
	...createLiveStackingRoutes(liveStacking),
	...createGuidingRoutes(guiding),
	...createTargetCenteringRoutes(targetCentering),
	...createFileRoutes(),
	...createImageRoutes(images),
	...createImageProcessingRoutes(imageProcessing),
	...createExternalToolsRoutes(externalTools),
	...createObservatoryCameraRoutes(observatoryCameras),
	...createWorkspaceRoutes(workspace),
	...createStarDetectionRoutes(stars),
	...createStarProfileRoutes(starProfiles),
	...createPlateSolvingRoutes(plateSolving),
	...createStreakDetectionRoutes(streaks),
	...createImageStatisticsRoutes(imageStatistics),
	...createAnnotationRoutes(annotations),
	...createCaptureFrameRoutes(captureFrames),
	...createSkyApiRoutes(satelliteSkyAdapter(satellites)),
	...createLunarEclipseRoutes(lunarEclipses),
	...createSolarEclipseRoutes(solarEclipses),
	...createCloseApproachRoutes(closeApproaches),
	...createOrbitalMechanicsRoutes(orbitalMechanics),
	...createAstroWeatherRoutes(astroWeather),
	...createObservingPlannerRoutes(observingPlanner),
	...createJupiterRoutes(jupiterPlanner),
	...createSaturnRoutes(saturnPlanner),
	...createAstronomicalTimeRoutes(astronomicalTime),
	...createSatelliteRoutes(satellites),
	...createSpiceKernelRoutes(spiceKernelLibrary),
	'/api/ws': {
		// Upgrades to the event WebSocket, attaching the client id the tab names itself with; Bun sends the handshake
		// response itself.
		GET: (req, server) => {
			const client = new URL(req.url).searchParams.get('client') || undefined
			return server.upgrade(req, { data: { client } satisfies WebSocketData }) ? undefined : errorResponse('WebSocket upgrade failed', 400, 'upgradeFailed')
		},
	},
} as Readonly<Bun.Serve.Routes<WebSocketData, string>>
