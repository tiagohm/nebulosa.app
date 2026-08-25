import type { TrackMode, FrameType, MountTargetCoordinate } from 'nebulosa/src/devices/indi/device'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { AutoFocusFittingMode } from 'nebulosa/src/observation/focus/autofocus'
import type { CameraCaptureStart } from '#/camera'
import { DEFAULT_PLATE_SOLVE_START } from '#/platesolver'
import type { PlateSolveStart } from '#/platesolver'

// Complete, versioned, serializable definition submitted by the UI for one astronomical sequencing workflow.

// All nested values are configuration only; runtime state, device instances, operation handles, and callbacks are excluded.
export interface Sequencer {
	// Schema revision of this serialized contract.
	readonly schemaVersion: 1

	// Optional client-supplied identifier of this recipe. The server copies it onto the session as a label
	// and does not assign or persist a library of definitions.
	readonly id?: string

	// Optional client-supplied revision of this recipe. The session copies it as a label; the server does
	// not increment it.
	readonly revision?: number

	// Human-readable name shown in lists and editors.
	readonly name: string

	// Devices used by the whole session, declared once and referenced by role everywhere else.
	readonly devices: SequencerDevices

	// Target definition, tracking, slew, centering, and observability constraints.
	readonly target: SequencerTarget
	// Primary imaging plan containing camera bindings, scheduling order, defaults, and frame groups.
	readonly capture: SequencerCapture
	// Guiding connection, startup, settling, quality, and recovery configuration.
	readonly guiding: SequencerGuiding
	// Dither triggers, displacement, settling, retry, and failure behavior.
	// Dithering requires an active guider and executes only at safe exposure boundaries.
	readonly dither: SequencerDither
	// Autofocus devices, triggers, algorithm, capture recipe, and failure behavior.
	readonly autofocus: SequencerAutofocus
	// Rotator positioning and restoration configuration.
	readonly rotator: SequencerRotator
	// Meridian-flip trigger and recovery workflow.
	// This feature is relevant to equatorial mounts that can change pier side.
	readonly meridianFlip: SequencerMeridianFlip
	// Mount parking commanded around the session.
	// Tracking, slew, and the meridian flip live on their own blocks; this one only parks and unparks.
	readonly mount: SequencerMount
	// Camera cooling and controlled warm-up configuration.
	// Set enabled to false for uncooled cameras or manually managed thermal control.
	readonly cooling: SequencerCooling
	// Dome or roof lifecycle, slaving, synchronization, and failure configuration.
	// Set enabled to false when no controllable enclosure exists.
	readonly dome: SequencerDome
	// Optical cover or dust-cap lifecycle configuration.
	// Set enabled to false when no controllable cover exists.
	readonly cover: SequencerCover
	// Flat-panel illumination and per-filter brightness configuration.
	// Set enabled to false when flats use sky or a manual light source.
	readonly flatPanel: SequencerFlatPanel
	// Background observation sources and their polling cadence.
	// Monitors feed observations into safety policy and never command devices directly.
	readonly monitoring: SequencerMonitoring
	// Unsafe-condition interruption, protective actions, and recovery configuration.
	// Safety should remain enabled for unattended or remotely operated observatories.
	readonly safety: SequencerSafety
	// Image-quality thresholds, rejection rules, and corrective triggers.
	// Set enabled to false to accept every physically completed frame.
	readonly quality: SequencerQuality
	// Workflow start/end conditions, interruption semantics, checkpointing, and resource retention.
	// These settings govern the session runtime rather than individual devices.
	readonly execution: SequencerExecution
	// Artifact paths, naming templates, and metadata.
	// The host validates all paths before execution.
	readonly storage: SequencerStorage
	// Whether the derived preparation pipeline runs before target acquisition.
	// The steps themselves are declared on the equipment blocks; this flag only arms the pipeline.
	// Set enabled to false when equipment is prepared externally.
	readonly startup: SequencerStartup
	// Whether the derived terminal pipeline runs for selected completion or failure states.
	// The steps themselves are declared on the equipment blocks; this flag only arms the pipeline.
	readonly shutdown: SequencerShutdown
	// Events, channels, and severity threshold used for user notifications.
	// Notification delivery is best-effort and does not replace persisted session events.
	readonly notification: SequencerNotification
}

// Enumerates the device roles a session can occupy.
// Features reference a role; only the root devices object maps a role to a concrete device id.
export type SequencerDeviceRole = 'camera' | 'mount' | 'wheel' | 'focuser' | 'rotator' | 'guideCamera' | 'guideOutput' | 'cover' | 'flatPanel' | 'dome'

// Maps each device role used by the session to a device id, exactly once for the whole definition.
// A role omitted here is unavailable, and every feature requiring it is rejected at compilation.
export interface SequencerDevices {
	// Device id of the primary imaging camera.
	readonly camera: string
	// Device id of the mount that acquires and tracks the target.
	readonly mount?: string
	// Device id of the filter wheel.
	readonly wheel?: string
	// Device id of the focuser.
	readonly focuser?: string
	// Device id of the field rotator.
	readonly rotator?: string
	// Device id of the guide camera, which is normally distinct from the imaging camera.
	readonly guideCamera?: string
	// Device id of the guide-output device that receives guiding pulses.
	readonly guideOutput?: string
	// Device id of the optical cover or dust cap.
	readonly cover?: string
	// Device id of the flat-field illumination panel.
	readonly flatPanel?: string
	// Device id of the dome or roll-off roof.
	readonly dome?: string
}

// Enumerates normalized failure causes understood by retry and terminal-action policies.
// Values are produced by orchestration, device commands, quality checks, safety checks, and storage adapters.
export type SequencerFailureReason = 'busy' | 'aborted' | 'disconnected' | 'removed' | 'timeout' | 'alert' | 'commandFailed' | 'unexpectedState' | 'qualityRejected' | 'unsafe' | 'storageUnavailable' | 'unknown'

// Defines the policy decision applied after a failure.
// Use retry only while attempts remain; terminal choices are skip, pause, suspend, stop, or fail.
export type SequencerFailureAction = 'retry' | 'skip' | 'pause' | 'suspend' | 'stop' | 'fail'

// Controls bounded retries and the terminal decision applied when all attempts are exhausted.
// All delays are seconds and must be finite and non-negative.
export interface SequencerRetryPolicy {
	// Maximum number of total attempts, including the initial execution.
	// Use an integer >= 1; 1 disables retries.
	readonly maxAttempts: number

	// Delay before the first retry.
	// Seconds; use a finite value >= 0.
	readonly delay: number

	// Multiplier applied to the delay after each failed retry.
	// Use a finite value >= 1; 1 produces constant-delay retries.
	readonly backoff: number

	// Upper bound for any computed retry delay.
	// Seconds; use a finite value >= 0 and normally >= delay.
	readonly maximumDelay: number

	// Failure reasons eligible for retry.
	// Use an empty array to disable reason-based retries.
	readonly retryOn: readonly SequencerFailureReason[]
	// Terminal action applied when no retry remains.
	readonly onExhausted: Exclude<SequencerFailureAction, 'retry'>
}

// Defines an optional absolute and solar-altitude execution window.
// When multiple limits are provided, all enabled limits must be satisfied.
export interface SequencerTimeWindow {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Earliest absolute time at which the window is open.
	// Use a valid Unix timestamp; omit for no lower time bound.
	readonly start?: number
	// Latest absolute time at which the window remains open.
	// Use a valid Unix timestamp later than start; omit for no upper time bound.
	readonly end?: number

	// Maximum allowed apparent Sun altitude.
	// Radians in [-π/2, π/2]; negative values select twilight or night.
	readonly maximumSunAltitude?: Angle
}

// Target

// Discriminated union of target coordinate representations accepted by the Sequencer.
// The coordinateType property selects the active representation.
export interface SequencerTarget extends MountTargetCoordinate<Angle | string> {
	// Stable identifier used by definitions, checkpoints, events, or ordered actions.
	// Use a non-empty value unique within its owning collection.
	// It is a component of every node id below the target and therefore of artifact identity and file names, so renaming the target must not change it.
	readonly id: string
	// Human-readable label for this object.
	// Use a non-empty value suitable for logs and UI display.
	readonly name: string
	// Controls whether this feature or definition is active.
	readonly enabled: boolean

	// Configuration value for tracking.
	readonly tracking: SequencerTargetTracking
	// Configuration value for goto.
	readonly goto: SequencerGoto
	// Configuration value for center.
	readonly center: SequencerCentering
	// Configuration value for constraints.
	readonly constraints: SequencerTargetConstraint
}

// Configures mount tracking before, during, and after target acquisition.
// Optional non-sidereal rates are radians per second.
export interface SequencerTargetTracking {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Selects the operating mode for this configuration.
	readonly mode: TrackMode
	// Controls whether tracking is stopped after the session ends.
	readonly stopOnShutdown: boolean

	// Optional non-sidereal correction rate along right ascension.
	readonly rightAscensionRate?: Angle
	// Optional non-sidereal correction rate along declination.
	readonly declinationRate?: Angle

	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Configures the initial mount slew and its position verification.
// Angular tolerances are radians; timeout and settle are seconds.
export interface SequencerGoto {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean

	// Angular distance below which the current position is considered already on target, which skips the slew.
	// Radians; use a finite value >= 0 and typically a few arcseconds to arcminutes; 0 always slews.
	readonly skipTolerance: Angle

	// Maximum angular error accepted after the slew completes.
	// Radians; use a finite value >= 0 and normally >= the mount pointing repeatability.
	readonly arrivalTolerance: Angle

	// Maximum time in seconds allowed for the operation to reach its terminal state.
	readonly timeout: number
	// Stable delay or settling policy, in seconds, required after a state transition.
	readonly settle: number
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Configures closed-loop plate-solve centering.
// The routine repeatedly captures, solves, corrects, and verifies until tolerance or attempt limits are reached.
export interface SequencerCentering {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Configuration value for solver.
	readonly solver: Omit<PlateSolveStart, 'id' | 'path'>

	// Maximum plate-solved separation accepted from the target, commonly a few arcseconds.
	readonly tolerance: Angle

	// Maximum number of attempts allowed for this operation or recovery.
	readonly maximumAttempts: number
	// Stable delay or settling policy, in seconds, required after a state transition.
	readonly settle: number
	// Controls whether sync mount is applied.
	readonly syncMount: boolean
	// Capture recipe used by this feature.
	readonly capture: SequencerAuxiliaryCapture
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Defines environmental and geometric conditions under which the target may be observed.
// All enabled constraints are combined and may wait, pause, suspend, stop, or fail the session.
export interface SequencerTargetConstraint {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Configuration value for window.
	readonly window: SequencerTimeWindow

	// Minimum target altitude required for observation.
	// Radians in [-π/2, π/2]; omit to disable the lower limit.
	readonly minimumAltitude?: Angle
	// Maximum target altitude allowed for observation.
	// Radians in [-π/2, π/2]; omit to disable the upper limit.
	readonly maximumAltitude?: Angle
	// Maximum optical airmass accepted for the target.
	// Use a finite value >= 1; values around 2 to 3 are common operational limits.
	readonly maximumAirmass?: number
	// Minimum angular separation from the Moon.
	// Radians in [0, π]; omit to disable this constraint.
	readonly minimumMoonDistance?: Angle
	// Maximum illuminated fraction of the Moon.
	// Use a normalized value in [0, 1]; omit to disable this constraint.
	readonly maximumMoonIllumination?: number
	// Minimum target hour angle allowed.
	// Radians; recommended normalized range [-π, π], with negative values east of the meridian.
	readonly minimumHourAngle?: Angle
	// Maximum target hour angle allowed.
	// Radians; recommended normalized range [-π, π] and >= minimumHourAngle.
	readonly maximumHourAngle?: Angle

	// Decision applied while target constraints are violated.
	readonly onViolation: 'wait' | 'pause' | 'suspend' | 'stop' | 'fail'
	// Continuous time, in seconds, for which violated constraints must become valid before resuming.
	readonly stableFor: number
}

// Capture

// Defines the frame groups and capture scheduling strategy of the primary imaging plan.
// The frames array contains the actual exposure recipes executed by the Sequencer.
export interface SequencerCapture extends SequencerCamera {
	// Controls when or in what order this plan executes relative to related work.
	readonly order: 'sequential' | 'interleaved' | 'roundRobin' | 'weightedRoundRobin'
	// Number of times the complete frame plan is repeated.
	readonly repeat: number
	// Ordered collection of frames.
	// The array may be empty unless the containing feature requires at least one item.
	readonly frames: readonly SequencerFrame[]
	// Default delay, in seconds, inserted between primary frames.
	readonly delay: number
	// Controls whether continue after rejected frame is applied.
	readonly continueAfterRejectedFrame: boolean
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Defines one logical frame group, including exposure, count, filter, and camera overrides.
// A stable id is required so checkpoints and artifacts can resume without duplicating work.
export interface SequencerFrame {
	// Stable identifier used by definitions, checkpoints, events, or ordered actions.
	// Use a non-empty value unique within its owning collection.
	readonly id: string
	// Human-readable label for this object.
	// Use a non-empty value suitable for logs and UI display.
	readonly name: string
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Camera frame classification written to the image metadata.
	readonly frameType: FrameType

	// Exposure duration for each frame in this group.
	// Seconds; use a finite value > 0 within the camera exposure range.
	readonly exposureTime: number

	// Requested number of accepted frames in this group.
	// Use an integer >= 0; 0 makes the group execute nothing.
	readonly count: number

	// Extra slots this group may lose to abandoned frames and still reach its target.
	// Use an integer >= 0; omit for 0, which makes the group execute exactly the slots it needs.
	readonly abandonmentBudget?: number

	// Filter reference associated with this configuration.
	// The referenced name or position must exist on the selected wheel.
	readonly filter?: SequencerFilterReference
	// Relative scheduling weight used by weightedRoundRobin order.
	// Use a finite value > 0; 1 gives equal weight.
	readonly weight: number
	// Optional per-frame delay overriding the capture-level delay.
	// Seconds; use a finite value >= 0; omit to inherit capture.delay.
	readonly delay?: number

	// Per-frame camera-setting overrides applied over capture.defaults.
	// Only supplied properties override defaults; this field is not a camera device reference.
	readonly camera: Partial<SequencerCamera>
}

// Identifies a filter either by its configured name or by its zero/one-based wheel position, according to the driver convention.
// Prefer name when filter mappings are stable across devices; use position only when the physical slot is authoritative.
export type SequencerFilterReference =
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'name'
			// Human-readable label for this object.
			readonly name: string
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'position'
			// Numeric value for position.
			readonly position: number
	  }

// Contains reusable camera settings shared by primary and auxiliary captures.
// Gain, offset, format, binning, and limits remain device-dependent.
export type SequencerCamera = Pick<CameraCaptureStart, 'binX' | 'binY' | 'gain' | 'offset' | 'frameFormat' | 'transferFormat' | 'compressed' | 'x' | 'y' | 'width' | 'height' | 'subframe'>

// Defines a single-frame capture recipe used by autofocus, centering, guiding, and other supporting routines.
// Unlike the main capture plan, it does not include repetition or integration targets.
export interface SequencerAuxiliaryCapture extends SequencerCamera {
	// Exposure duration, in seconds, used by the supporting routine.
	readonly exposureTime: number
	// Camera frame classification written to the image metadata.
	readonly frameType: FrameType
	// Filter reference associated with this configuration.
	readonly filter?: SequencerFilterReference
}

// Guiding and dither

// Configures guider acquisition, startup, settling, quality thresholds, and recovery.
// The connection union determines whether the session is reused, remote, or locally owned.
export interface SequencerGuiding {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Configuration value for connection.
	readonly connection: SequencerGuiderConnection

	// Controls whether calibrate before start is applied.
	readonly calibrateBeforeStart: boolean
	// Controls whether recalibrate after meridian flip is applied.
	readonly recalibrateAfterMeridianFlip: boolean
	// Controls whether restore after interruption is applied.
	readonly restoreAfterInterruption: boolean
	// Controls whether guiding is stopped after the session ends.
	readonly stopOnShutdown: boolean

	// Stable delay or settling policy required after a state transition.
	readonly settle: SequencerGuiderSettle
	// Configuration value for thresholds.
	readonly thresholds: SequencerGuidingThreshold
	// Configuration value for recovery.
	readonly recovery: SequencerGuidingRecovery
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Discriminated union describing how the Sequencer obtains a guider session.
// The mode may connect to a remote guider or create a local one.
export type SequencerGuiderConnection = SequencerRemoteGuider | SequencerLocalGuider

// Defines a network connection to an external guider service such as PHD2.
// TCP ports are integers from 1 to 65535; 4400 is the usual PHD2 default.
export interface SequencerRemoteGuider {
	// Selects the operating mode for this configuration.
	readonly mode: 'remote'
	// Network host name or IP address of the remote service.
	readonly host: string
	// TCP port of the remote guider service.
	readonly port: number
	// Optional named profile understood by the selected backend.
	readonly profile?: string
}

// Defines a guider implemented locally from the session guideCamera and guideOutput devices.
// Focal length and optional pixel size are used to derive image scale and guiding corrections.
export interface SequencerLocalGuider {
	// Selects the operating mode for this configuration.
	readonly mode: 'local'

	// Focal length (mm) of the guide optical system.
	readonly focalLength: number

	// Physical guide-camera pixel size in micrometers.
	readonly pixelSize?: number

	// Capture recipe used by this feature.
	// The nested object must be valid for the selected camera.
	// The filter reference is omitted: a local guider drives its guide camera alone, and the only wheel the
	// session addresses is the imaging one, which a guide filter must never move.
	readonly capture: Omit<SequencerAuxiliaryCapture, 'filter'>
}

// Defines when guiding is considered stable after start, recovery, or dither.
// Tolerance is pixels; time and timeout are seconds.
export interface SequencerGuiderSettle {
	// Maximum guide error, in pixels, accepted while settling.
	readonly tolerance: number
	// Continuous duration, in seconds, for which error must remain below tolerance.
	readonly time: number
	// Maximum time, in seconds, allowed for the guider to settle.
	readonly timeout: number
}

// Defines optional quality thresholds used to pause capture or trigger guiding recovery.
// RMS values are arcseconds and metric thresholds must be finite and non-negative.
export interface SequencerGuidingThreshold {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean

	// Maximum combined guiding RMS error, in arcseconds.
	readonly maximumRMS?: number

	// Maximum right-ascension guiding RMS error, in arcseconds.
	readonly maximumRightAscensionRMS?: number

	// Maximum declination guiding RMS error, in arcseconds.
	readonly maximumDeclinationRMS?: number

	// Minimum guide-star signal-to-noise ratio.
	readonly minimumSNR?: number
	// Minimum accepted guide-star mass in the guider metric domain.
	readonly minimumStarMass?: number
	// Maximum continuous time, in seconds, with no usable guide star.
	readonly maximumLostStarTime?: number
	// Controls whether pause capture when exceeded is applied.
	readonly pauseCaptureWhenExceeded: boolean
}

// Controls the sequence used to restore guiding after lost lock, excessive error, or transport failure.
// Attempts are bounded and the final behavior is explicit.
export interface SequencerGuidingRecovery {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Maximum number of attempts allowed for this operation or recovery.
	readonly maximumAttempts: number
	// Controls whether stop before retry is applied.
	readonly stopBeforeRetry: boolean
	// Controls whether find star before retry is applied.
	readonly findStarBeforeRetry: boolean
	// Controls whether recalibrate is applied.
	readonly recalibrate: boolean
	// Stable delay or settling policy required after a state transition.
	readonly settle: SequencerGuiderSettle
	// Decision applied when this feature cannot recover from failure.
	readonly onFailure: 'continueUnguided' | 'pause' | 'suspend' | 'stop' | 'fail'
}

// Configures periodic guider dithering and the conditions that trigger it.
// Dither runs only at safe exposure boundaries and settles under `guiding.settle` before the next frame.
export interface SequencerDither {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean

	// Requested dither displacement in guider pixels; values around 1 to 10 pixels are common.
	readonly amount: number
	// Controls whether ra only is applied.
	readonly raOnly: boolean

	// Controls whether before first frame is applied.
	readonly beforeFirstFrame: boolean
	// Controls whether after filter change is applied.
	readonly afterFilterChange: boolean

	// Number of accepted frames between dithers, 0 disables this trigger.
	readonly everyFrames: number

	// Elapsed time, in seconds, between dithers, 0 disables this trigger.
	readonly everyTime: number

	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
	// Decision applied when this feature cannot recover from failure.
	readonly onFailure: 'continue' | 'pause' | 'suspend' | 'stop' | 'fail'
}

// Autofocus

// Configures autofocus devices, triggers, capture recipe, star detection, filter offsets, and failure handling.
// Autofocus executes at safe boundaries and temporarily owns the camera and focuser.
export interface SequencerAutofocus {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean

	// Configuration value for triggers.
	readonly triggers: SequencerAutofocusTrigger
	// Configuration value for algorithm.
	readonly algorithm: SequencerAutofocusAlgorithm
	// Capture recipe used by this feature.
	readonly capture: SequencerAuxiliaryCapture
	// Star-detection configuration used to derive image measurements.
	readonly starDetection: SequencerStarDetection
	// Ordered collection of filter offsets.
	readonly filterOffsets: readonly SequencerFilterFocusOffset[]
	// Stable delay or settling policy required after a state transition.
	readonly settle: number
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
	// Decision applied when this feature cannot recover from failure.
	readonly onFailure: 'continue' | 'pause' | 'suspend' | 'stop' | 'fail'
}

// Defines event-, frame-, time-, and temperature-based autofocus triggers.
// Zero disables numeric triggers unless stated otherwise.
export interface SequencerAutofocusTrigger {
	// Controls whether on start is applied.
	readonly onStart: boolean
	// Controls whether on filter change is applied.
	readonly onFilterChange: boolean
	// Controls whether after meridian flip is applied.
	readonly afterMeridianFlip: boolean

	// Number of accepted frames between autofocus runs, 0 disables this trigger.
	readonly everyFrames: number

	// Elapsed time between autofocus runs, 0 disables this trigger.
	readonly everyTime: number

	// Absolute sensor/focuser temperature change that triggers autofocus, 0 disables this trigger.
	readonly temperatureChange: number

	// Minimum spacing, in seconds, between autofocus runs regardless of trigger count.
	readonly minimumTimeBetweenRuns: number
}

// Defines the V-curve sampling and fitting parameters used by the autofocus state machine.
// Focuser positions and step sizes are device steps.
export interface SequencerAutofocusAlgorithm {
	// Number of sampling offsets placed on each side of the starting focus position, values around 3 to 8 are typical.
	readonly initialOffsetSteps: number
	// Distance between autofocus samples.
	readonly stepSize: number
	// Configuration value for fitting mode.
	readonly fittingMode: AutoFocusFittingMode
	// Maximum accepted fit RMSD relative to measured star size, 0 disables the fit-quality rejection.
	readonly rmsdThreshold: number
	// Controls whether reversed is applied.
	readonly reversed: boolean
	// Upper focuser travel limit used by the autofocus algorithm.
	readonly maximumPosition: number
	// Configuration value for backlash.
	readonly backlash: SequencerBacklash
}

// Defines optional focuser backlash compensation applied during autofocus motion.
// Steps must be a non-negative integer and should reflect measured mechanical backlash.
export interface SequencerBacklash {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Selects the operating mode for this configuration.
	readonly mode: 'overshoot' | 'inward' | 'outward'
	// Backlash compensation distance.
	readonly steps: number
}

// Associates a filter with a signed focuser offset.
// The offset is expressed in focuser steps and may be positive, negative, or zero.
export interface SequencerFilterFocusOffset {
	// Filter reference associated with this configuration.
	readonly filter: SequencerFilterReference
	// Signed focus correction associated with the filter.
	readonly offset: number
}

// Configures the star-detection backend used by autofocus and image-quality analysis.
// Backend-specific options remain in the options object.
export interface SequencerStarDetection {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'astap' | 'nebulosa'
	// Optional executable path for an external backend.
	readonly executable?: string
	// Maximum time, in seconds, allowed for one star-detection run.
	readonly timeout: number
	// Minimum star signal-to-noise ratio, 0 disables the threshold.
	readonly minimumSNR: number
	// Maximum number of stars returned or considered, 0 means backend default or unlimited.
	readonly maximumStars: number
}

// Rotator and meridian flip

// Configures field rotation, positioning tolerance, movement order, and post-interruption restoration.
export interface SequencerRotator {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean

	// Requested sky position angle.
	readonly angle: Angle

	// Maximum angular positioning error accepted after rotation.
	readonly tolerance: Angle
	// Stable delay or settling policy, in seconds, required after a state transition.
	readonly settle: number
	// Controls whether move before centering is applied.
	readonly moveBeforeCentering: boolean
	// Controls whether restore after meridian flip is applied.
	readonly restoreAfterMeridianFlip: boolean
	// Controls whether reverse is applied.
	readonly reverse: boolean
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Defines when and how an equatorial mount performs a meridian flip.
//
// The crossing is always guarded the same way and the workflow around it is derived rather than declared: the
// exposure in progress is finished first, the pier side is verified when the driver publishes one, the
// guiding is suspended and resumed by the interlock bracket of the safe point, the recentering happens when
// the target declares a centering, and the refocusing when the autofocus block asks to focus after a flip.
export interface SequencerMeridianFlip {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean

	// Earliest post-meridian hour angle at which flip execution may begin.
	// Normally >= 0 and small, such as a few minutes of sidereal angle.
	readonly minimumHourAngle: Angle

	// Latest hour angle at which another exposure may begin before the flip.
	// Normally >= minimumHourAngle after applying exposure/safety calculations.
	readonly maximumHourAngle: Angle

	// Time, in seconds, reserved before the flip boundary so no new exposure overruns it.
	readonly safetyMargin: number

	// Stable delay or settling policy required after a state transition.
	readonly settle: number
	// Maximum time, in seconds, allowed for the operation to reach its terminal state.
	readonly timeout: number
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
	// Decision applied when this feature cannot recover from failure.
	readonly onFailure: 'pause' | 'suspend' | 'stop' | 'fail'
}

// Configures mount parking commanded around the session.
// How the mount tracks and where it points live on the target; this block only parks and unparks.
export interface SequencerMount {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Controls whether the mount is unparked before target acquisition.
	readonly unparkOnStartup: boolean
	// Controls whether the mount is parked after the session ends.
	readonly parkOnShutdown: boolean
	// Maximum time, in seconds, allowed for park or unpark to finish.
	readonly timeout: number
	// Retry policy applied when park or unpark fails.
	readonly retry: SequencerRetryPolicy
}

// Thermal control

// Controls camera cooling before capture and controlled warm-up during shutdown.
// Temperatures are degrees Celsius, rates are degrees Celsius per minute, and durations are seconds.
export interface SequencerCooling {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean

	// Requested cooled sensor temperature.
	// Degrees Celsius; use a finite value within the camera cooler range.
	readonly temperature: number

	// Maximum absolute temperature error accepted before capture.
	readonly tolerance: number

	// Maximum cooling-rate magnitude, in °C per minute, 0 disables controlled ramping.
	readonly ramp: number

	// Controls whether wait for target is applied.
	readonly waitForTarget: boolean
	// Maximum time, in seconds, allowed for the operation to reach its terminal state.
	readonly timeout: number

	// Target sensor temperature during controlled warm-up.
	readonly warmTemperature: number

	// Maximum warm-up rate, in °C per minute.
	readonly warmRamp: number

	// Controls whether turn cooler off after warm is applied.
	readonly turnCoolerOffAfterWarm: boolean
	// Controls whether the camera is warmed after the session ends.
	// Cooling to `temperature` on startup is implied by enabled.
	readonly warmOnShutdown: boolean
	// Retry policy applied when cooling or warming fails.
	readonly retry: SequencerRetryPolicy
}

// Dome, cover and flat panel

// Configures dome or roll-off-roof slaving, synchronization, and failure behavior.
// Opening, closing, parking, and unparking are flags on this block; the compiler emits them in the only
// physically valid order, and parks before closing when both shutdown flags are set.
// Device capabilities determine which requested actions are valid.
export interface SequencerDome {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Controls whether the dome is unparked before target acquisition.
	readonly unparkOnStartup: boolean
	// Controls whether the shutter or roof is opened before target acquisition.
	readonly openOnStartup: boolean
	// Controls whether the dome is parked after the session ends.
	readonly parkOnShutdown: boolean
	// Controls whether the shutter or roof is closed after the session ends.
	readonly closeOnShutdown: boolean

	// Controls whether close on unsafe is applied.
	readonly closeOnUnsafe: boolean

	// Whether the dome azimuth follows the mount while the session is capturing.
	// Slaving is engaged once the dome is open and released before it closes, which is the only meaningful order.
	readonly slaving: boolean

	// Controls whether synchronize before capture is applied.
	readonly synchronizeBeforeCapture: boolean
	// Stable delay or settling policy required after a state transition.
	// When numeric, the value is seconds and must be finite and non-negative.
	readonly settle: number
	// Maximum time, in seconds, allowed for the operation to reach its terminal state.
	readonly timeout: number
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
	// Decision applied when this feature cannot recover from failure.
	readonly onFailure: 'pause' | 'suspend' | 'stop' | 'fail'
}

// Configures dust-cap or cover behavior for unsafe conditions and for the frame types being captured.
// Opening on startup and closing on shutdown are flags on this block; opening before each light and closing
// for darks remain capture-time policies.
// Open/close commands are executed only when device interlocks permit them.
export interface SequencerCover {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Controls whether the cover is opened before target acquisition.
	readonly openOnStartup: boolean
	// Controls whether the cover is closed after the session ends.
	readonly closeOnShutdown: boolean
	// Controls whether close on unsafe is applied.
	readonly closeOnUnsafe: boolean
	// Controls whether open before capture is applied.
	readonly openBeforeCapture: boolean
	// Controls whether close for dark frames is applied.
	readonly closeForDarkFrames: boolean
	// Maximum time, in seconds, allowed for the operation to reach its terminal state.
	readonly timeout: number
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Configures a flat-field illumination panel and optional per-filter brightness values.
// The panel is lit only for frames that require it and is turned off as soon as one does not, which the frame preparation derives instead of declaring here.
// Brightness ranges are device-dependent and must be validated against the selected panel.
export interface SequencerFlatPanel {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Default panel brightness used when no filter-specific value exists.
	// Use a finite device-specific value within the panel-reported range.
	readonly brightness: number
	// Ordered collection of brightness by filter.
	// The array may be empty unless the containing feature requires at least one item.
	readonly brightnessByFilter: readonly SequencerFilterBrightness[]
	// Maximum time, in seconds, allowed for the operation to reach its terminal state.
	readonly timeout: number
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Associates one filter with a device-specific flat-panel brightness.
// The valid brightness range is reported by the panel driver.
export interface SequencerFilterBrightness {
	// Filter reference associated with this configuration.
	// The referenced name or position must exist on the selected wheel.
	readonly filter: SequencerFilterReference
	// Panel brightness used for the referenced filter.
	// Use a finite device-specific value within the panel-reported range.
	readonly brightness: number
}

// Calibration frames

// Groups dark, bias, flat, and dark-flat acquisition plans.
// Each calibration type can be enabled and scheduled independently.
export interface SequencerCalibration {
	// Configuration value for dark.
	readonly dark: SequencerDark
	// Configuration value for bias.
	readonly bias: SequencerBias
	// Configuration value for flat.
	readonly flat: SequencerFlat
	// Configuration value for dark flat.
	readonly darkFlat: SequencerDarkFlat
}

// Shared configuration for every calibration-frame plan.
// Count and timing must be non-negative; retry behavior is applied per failed capture action.
export interface SequencerCalibrationBase {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Controls when or in what order this plan executes relative to related work.
	readonly order: 'beforeLights' | 'afterLights' | 'interleaved'
	// Requested number of accepted calibration frames.
	readonly count: number
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Defines dark-frame acquisition and optional interleaving with light frames.
// Exposure times are seconds and may be derived from the light-frame plan.
export interface SequencerDark extends SequencerCalibrationBase {
	// Number of light frames between interleaved dark groups, 0 disables interleaving.
	readonly everyFrames: number

	// Absolute sensor temperature change since the last accepted dark that makes a new dark eligible.
	// Degrees Celsius; use a finite value >= 0; 0 disables this trigger.
	readonly temperatureChange: number

	// Controls whether move to dark filter is applied.
	readonly moveDarkFilter: boolean
	// Filter reference associated with dark filter.
	readonly darkFilter?: SequencerFilterReference
}

// Defines bias-frame acquisition at the shortest supported exposure.
// The configured exposure is seconds and must be accepted by the camera.
export interface SequencerBias extends SequencerCalibrationBase {
	// Bias exposure duration. Omit to use the shortest positive duration supported by the camera
	readonly exposureTime?: number
}

// Defines flat-frame acquisition from a panel, twilight sky, or manually prepared source.
// Filter selection and automatic exposure behavior are configured separately.
export interface SequencerFlat extends SequencerCalibrationBase {
	// Identifies the data, light, power, or provider source used by this configuration.
	readonly source: 'panel' | 'sky' | 'manual'
	// Ordered set of filters included in this operation.
	// Use unique references unless repeated acquisition is intentional.
	readonly filters: readonly SequencerFilterReference[]
	// Configuration value for exposure.
	readonly exposure: SequencerFlatExposure
	// Controls whether park mount is applied.
	readonly parkMount: boolean
}

// Defines fixed or feedback-controlled exposure selection for flat frames.
// Exposure times are seconds; image-level target and tolerance use the image processor measurement domain.
export interface SequencerFlatExposure {
	// Selects the operating mode for this configuration.
	readonly mode: 'fixed' | 'automatic'
	// Fixed flat exposure, in seconds.
	readonly exposureTime: number
	// Lower exposure bound for automatic flats, in seconds.
	readonly minimumExposureTime: number
	// Upper exposure bound for automatic flats, in seconds.
	readonly maximumExposureTime: number
	// Requested mean signal level for automatic flats.
	// Use the image processor sample domain; it must be above bias/background and below saturation.
	readonly targetMean: number
	// Use a finite value >= 0 and in the same measurement domain as targetMean.
	readonly tolerance: number
}

// Defines dark-flat acquisition matching the exposure settings of flat frames.
// Exposure times are seconds and the optical path should remain dark.
export interface SequencerDarkFlat extends SequencerCalibrationBase {
	// Controls whether move to dark filter is applied.
	readonly moveDarkFilter: boolean
	// Filter reference associated with dark filter.
	readonly darkFilter?: SequencerFilterReference
}

// Monitoring

// Configures the background monitor polling cadence and monitor definitions.
// Monitor workers observe conditions; they never command devices directly.
export interface SequencerMonitoring {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Default polling interval, in seconds, for monitor workers.
	readonly interval: number
	// Monitor definitions evaluated during the session.
	// Monitor ids must be unique within this array.
	readonly monitors: readonly SequencerMonitor[]
}

// Discriminated union containing every monitor configuration supported by the Sequencer.
// The type property selects the concrete monitor and its additional thresholds.
export type SequencerMonitor =
	| SequencerWeatherMonitor
	| SequencerRainMonitor
	| SequencerWindMonitor
	| SequencerHumidityMonitor
	| SequencerDewPointMonitor
	| SequencerCloudMonitor
	| SequencerDeviceMonitor
	| SequencerStorageMonitor
	| SequencerPowerMonitor
	| SequencerGuidingMonitor
	| SequencerMountLimitMonitor
	| SequencerHeartbeatMonitor
	| SequencerCustomMonitor

// Common lifecycle, severity, debounce, freshness, and unknown-state policy for all monitors.
// All timing fields are seconds and must be non-negative.
export interface SequencerMonitorBase {
	// Stable identifier used by definitions, checkpoints, events, or ordered actions.
	readonly id: string
	// Human-readable label for this object.
	readonly name: string
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: string
	// Selects the severity behavior.
	readonly severity: 'warning' | 'unsafe' | 'critical'
	// Continuous duration, in seconds, a bad observation must persist before the monitor asserts.
	readonly assertAfter: number
	// Continuous duration, in seconds, a good observation must persist before the monitor clears.
	readonly clearAfter: number
	// Maximum age, in seconds, of the last observation before it becomes stale.
	readonly staleAfter: number
}

// Reads an aggregate weather-safety source supplied by a device or application provider.
// The provider is responsible for converting raw measurements into monitor observations.
export interface SequencerWeatherMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'weather'
}

// Detects rain or wet-sensor state and maps it to an unsafe observation.
// Rain monitors should normally be critical and fail closed.
export interface SequencerRainMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'rain'
	// Controls whether wet is unsafe is applied.
	readonly wetIsUnsafe: boolean
}

// Declares sustained-wind and gust thresholds for safety decisions.
// Speeds are metres per second and must be non-negative.
export interface SequencerWindMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'wind'

	// Maximum accepted sustained wind speed.
	// Metres per second; use a finite value >= 0.
	readonly maximumSpeed: number

	// Maximum accepted wind-gust speed.
	// Metres per second; use a finite value >= maximumSpeed.
	readonly maximumGust: number
}

// Declares the maximum acceptable relative humidity.
// Humidity is normally a percentage in [0, 100].
export interface SequencerHumidityMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'humidity'
	// Maximum accepted relative humidity.
	readonly maximumHumidity: number
}

// Monitors the margin between ambient temperature and dew point.
// The difference is degrees Celsius and is typically required to remain positive.
export interface SequencerDewPointMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'dewPoint'

	// Minimum ambient-temperature minus dew-point margin.
	readonly minimumDifference: number
}

// Declares the maximum acceptable cloud-cover estimate.
// Cloud cover is normally a percentage in [0, 100].
export interface SequencerCloudMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'cloud'
	// Maximum accepted cloud-cover estimate.
	readonly maximumCloudCover: number
}

// Checks required device connectivity, availability, and physical quiescence.
// The listed devices are evaluated as one monitor observation.
export interface SequencerDeviceMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'device'
	// Roles, resolved through the session devices, evaluated as one monitor observation.
	readonly devices: readonly SequencerDeviceRole[]
	// Controls whether require connected is applied.
	readonly requireConnected: boolean
	// Controls whether require available is applied.
	readonly requireAvailable: boolean
	// Controls whether require quiescent is applied.
	readonly requireQuiescent: boolean
}

// Checks free space and write access for the image destination.
// Free-space thresholds are bytes and must be non-negative integers.
export interface SequencerStorageMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'storage'
	// Optional filesystem path used by this feature.
	// The host must validate access and normalize the path before use.
	readonly path?: string

	// Minimum free capacity, in bytes, required at the destination.
	readonly minimumFreeSpace: number

	// Controls whether require writable is applied.
	readonly requireWritable: boolean
}

// Checks external-power state and remaining battery or UPS capacity.
// Battery level is normally a percentage in [0, 100].
export interface SequencerPowerMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'power'
	// Identifies the data, light, power, or provider source used by this configuration.
	readonly source?: string
	// Minimum remaining battery/UPS capacity.
	readonly minimumBatteryLevel: number
	// Controls whether require external power is applied.
	readonly requireExternalPower: boolean
}

// Applies guiding quality thresholds to a selected guider session.
// The monitor may trigger recovery or safety according to severity.
export interface SequencerGuidingMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'guiding'
	// Configuration value for thresholds.
	readonly thresholds: SequencerGuidingThreshold
}

// Monitors mount altitude and hour-angle boundaries independently of target constraints.
// All limits are radians and should follow the mount coordinate conventions.
export interface SequencerMountLimitMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'mountLimit'
	// Angular value for minimum altitude.
	readonly minimumAltitude?: Angle
	// Angular value for maximum altitude.
	readonly maximumAltitude?: Angle
	// Angular value for minimum hour angle.
	readonly minimumHourAngle?: Angle
	// Angular value for maximum hour angle.
	readonly maximumHourAngle?: Angle
}

// Requires periodic activity from an external source or subsystem.
// Missing activity for longer than timeout yields an unknown or unsafe observation.
export interface SequencerHeartbeatMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'heartbeat'
	// Identifies the data, light, power, or provider source used by this configuration.
	readonly source: string
	// Maximum elapsed time, in seconds, since the source heartbeat.
	readonly timeout: number
}

// Configures an application-provided monitor not represented by a built-in type.
// Provider and options are interpreted only by the host application.
export interface SequencerCustomMonitor extends SequencerMonitorBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'custom'
	// Identifier of the host-provided implementation.
	readonly provider: string
}

// Safety and recovery

// Defines how monitor decisions interrupt normal execution and which ordered protective actions run.
// Safety actions are checkpointed and execute only after active operations reach cleanup boundaries.
export interface SequencerSafety {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Controls whether trigger on warning is applied.
	readonly triggerOnWarning: boolean
	// Controls whether abort current exposure is applied.
	readonly abortCurrentExposure: boolean
	// Ordered actions executed by this pipeline.
	// The array may be empty when the pipeline is enabled only for future configuration.
	readonly actions: readonly SequencerSafetyAction[]
	// Configuration value for recovery.
	readonly recovery: SequencerRecovery
}

// Discriminated union of ordered actions available to the safety routine.
// Actions are executed in array order and each action has its own retry, timeout, and continuation policy.
export type SequencerSafetyAction =
	| SequencerAbortCaptureSafetyAction
	| SequencerStopGuidingSafetyAction
	| SequencerStopTrackingSafetyAction
	| SequencerCloseCoverSafetyAction
	| SequencerParkMountSafetyAction
	| SequencerParkDomeSafetyAction
	| SequencerCloseDomeSafetyAction
	| SequencerWarmCameraSafetyAction
	| SequencerSwitchSafetyAction
	| SequencerCustomSafetyAction

// Shared identity, timeout, retry, and continuation policy for one safety action.
// Timeout values are seconds and must be finite and positive for physical commands.
export interface SequencerSafetyActionBase {
	// Stable identifier used by definitions, checkpoints, events, or ordered actions.
	// Use a non-empty value unique within its owning collection.
	readonly id: string
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Controls whether later ordered actions execute after this action fails.
	// true provides best-effort continuation; false stops the containing pipeline.
	readonly continueOnFailure: boolean
	// Maximum time, in seconds, allowed for the operation to reach its terminal state.
	readonly timeout: number
	// Retry policy applied when this operation fails.
	readonly retry: SequencerRetryPolicy
}

// Configures the AbortCapture step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerAbortCaptureSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'abortCapture'
}

// Configures the StopGuiding step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerStopGuidingSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'stopGuiding'
}

// Configures the StopTracking step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerStopTrackingSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'stopTracking'
}

// Configures the CloseCover step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerCloseCoverSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'closeCover'
}

// Configures the ParkMount step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerParkMountSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'parkMount'
}

// Configures the ParkDome step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerParkDomeSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'parkDome'
}

// Configures the CloseDome step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerCloseDomeSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'closeDome'
}

// Configures the WarmCamera step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerWarmCameraSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	// The setpoint, the ramp, and the cooler switch-off are not declared here: SequencerCooling is the single
	// authority for the thermal targets, exactly as for the derived warmCamera lifecycle step.
	readonly type: 'warmCamera'
}

// Configures the Switch step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerSwitchSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'switch'
	// Serialized value for device.
	readonly device: string
	// Name or identifier of the switch/property to change.
	readonly switch: string
	// Value written by the switch or custom action.
	readonly value: boolean | number | string
}

// Configures the Custom step used by the ordered safety routine.
// It inherits identity, timeout, retry, and continuation behavior from SequencerSafetyActionBase.
export interface SequencerCustomSafetyAction extends SequencerSafetyActionBase {
	// Discriminator selecting the concrete variant represented by this object.
	readonly type: 'custom'
	// Identifier of the custom host-side action handler.
	readonly handler: string
}

// Configures restoration of devices and observing state after conditions become safe again.
// Recovery begins only after the configured continuous safe period.
export interface SequencerRecovery {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Controls whether the operation starts without an explicit user command.
	// false leaves the session waiting for manual intervention.
	readonly automatic: boolean

	// Continuous safe period, in seconds, required before recovery starts.
	readonly stableFor: number

	// Maximum time spent waiting for safe conditions and required devices.
	readonly maximumWait: number
	// Controls whether reconnect devices is applied.
	readonly reconnectDevices: boolean
	// Controls whether unpark mount is applied.
	readonly unparkMount: boolean
	// Controls whether restore tracking is applied.
	readonly restoreTracking: boolean
	// Controls whether resume capture is applied.
	readonly resumeCapture: boolean
	// Decision applied when this feature cannot recover from failure.
	readonly onFailure: 'pause' | 'suspend' | 'stop' | 'fail'
}

// Image quality

// Defines image-quality measurements, rejection thresholds, and corrective actions.
// Threshold domains are documented per property and evaluated after an image is available.
export interface SequencerQuality {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Star-detection configuration used to derive image measurements.
	readonly starDetection: SequencerStarDetection
	// Number of newly accepted frames between quality evaluations.
	readonly evaluateEveryFrames: number

	// Minimum detected-star count accepted for a frame.
	readonly minimumStarCount?: number
	// Minimum aggregate or representative image SNR accepted.
	readonly minimumSNR?: number
	// Maximum accepted half-flux diameter.
	readonly maximumHFD?: number
	// Maximum accepted full width at half maximum.
	readonly maximumFWHM?: number
	// Maximum accepted stellar eccentricity.
	readonly maximumEccentricity?: number
	// Maximum accepted image background level.
	readonly maximumBackground?: number
	// Maximum accepted background non-uniformity.
	readonly maximumBackgroundVariation?: number
	// Maximum accepted saturated-pixel fraction.
	readonly maximumSaturation?: number

	// Controls whether reject frame is applied.
	readonly rejectFrame: boolean
}

// Execution

// Defines session start/end conditions, interruption modes, default retry behavior, and checkpointing.
// It controls workflow semantics rather than device-specific settings.
export interface SequencerExecution {
	// Configuration value for start.
	readonly start: SequencerStartCondition
	// Configuration value for end.
	readonly end: SequencerEndCondition
	// Selects the pause mode behavior.
	readonly pauseMode: 'afterCurrentAction' | 'afterCurrentExposure' | 'immediate'
	// Selects the stop mode behavior.
	readonly stopMode: 'graceful' | 'immediate'
	// Configuration value for default retry.
	readonly defaultRetry: SequencerRetryPolicy
	// Configuration value for checkpoint.
	readonly checkpoint: SequencerCheckpoint
}

// Discriminated union defining when a session is allowed to start.
// Conditions may be manual, absolute-time based, or driven by Sun/target altitude crossings.
export type SequencerStartCondition =
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'manual'
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'at'
			// Duration or timestamp value used by this condition.
			readonly time: number
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'sunAltitude'
			// Angular value for altitude.
			readonly altitude: Angle
			// Selects the direction behavior.
			readonly direction: 'rising' | 'setting'
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'targetAltitude'
			// Angular value for altitude.
			readonly altitude: Angle
			// Selects the direction behavior.
			readonly direction: 'rising' | 'setting'
	  }

// Discriminated union defining the normal completion boundary of a session.
// Completion may follow the sequence, a timestamp, an altitude crossing, or accumulated integration time.
export type SequencerEndCondition =
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'afterSequence'
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'at'
			// Duration or timestamp value used by this condition.
			readonly time: number
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'sunAltitude'
			// Angular value for altitude.
			readonly altitude: Angle
			// Selects the direction behavior.
			readonly direction: 'rising' | 'setting'
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'targetAltitude'
			// Angular value for altitude.
			readonly altitude: Angle
			// Selects the direction behavior.
			readonly direction: 'rising' | 'setting'
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'integrationTime'
			// Duration or timestamp value used by this condition.
			readonly time: number
	  }

// Controls when durable runtime checkpoints are requested from the host.
// The interval is seconds; zero disables interval-based checkpoints.
export interface SequencerCheckpoint {
	// Controls whether after every action is applied.
	readonly afterEveryAction: boolean
	// Controls whether after every frame is applied.
	readonly afterEveryFrame: boolean
	// Controls whether after every artifact is applied.
	readonly afterEveryArtifact: boolean
	// Maximum time between interval-based checkpoints.
	readonly interval: number
}

// Storage

// Defines image path templates and additional metadata.
// Paths are interpreted by the host application and should be absolute or rooted under an approved storage directory.
// Artifacts are always written, always through the atomic protocol, and never overwrite an existing file.
export interface SequencerStorage {
	// Root directory for all session artifacts.
	// Use a non-empty host-approved directory path.
	readonly root: string
	// Template used to generate deterministic file names.
	// Use only placeholders recognized by the host and avoid path separators.
	readonly fileNameTemplate: string
	// Template used to generate directories below root.
	// Use only host-supported placeholders and relative path components.
	readonly directoryTemplate: string
	// Optional directory used for atomic temporary writes.
	// Use a writable path on the same filesystem as the final destination when atomic rename is required.
	readonly temporaryDirectory?: string
	// Selects the auto sub folder mode behavior.
	readonly autoSubFolderMode: 'off' | 'noon' | 'midnight'
}

// Startup and shutdown

// Arms the derived preparation pipeline executed before the target sequence.
// The steps are declared on the equipment blocks and lowered in a fixed physical order.
export interface SequencerStartup {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Controls whether later ordered actions execute after this action fails.
	// true provides best-effort continuation; false stops the containing pipeline.
	readonly continueOnFailure: boolean
}

// Arms the derived shutdown pipeline and the terminal states that trigger it.
// The steps are declared on the equipment blocks; the pipeline should leave the observatory in a physically safe state.
export interface SequencerShutdown {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Controls whether run on completion is applied.
	readonly runOnCompletion: boolean
	// Controls whether run on stop is applied.
	readonly runOnStop: boolean
	// Controls whether run on failure is applied.
	readonly runOnFailure: boolean
	// Controls whether later ordered actions execute after this action fails.
	// true provides best-effort continuation; false stops the containing pipeline.
	readonly continueOnFailure: boolean
}

// Names of the device reconciliations the compiler may emit into a startup or shutdown pipeline.
// The definition never lists these; each one is derived from a flag on the block that owns the device.
export type SequencerLifecycleActionType = 'unparkDome' | 'openDome' | 'unparkMount' | 'startTracking' | 'openCover' | 'coolCamera' | 'startGuiding' | 'stopGuiding' | 'stopTracking' | 'parkMount' | 'closeCover' | 'parkDome' | 'closeDome' | 'warmCamera'

// Notifications

// Selects domain events, delivery channels, and minimum severity for user notifications.
// Notification failures must not alter Sequencer correctness unless a custom adapter explicitly does so.
export interface SequencerNotification {
	// Controls whether this feature or definition is active.
	readonly enabled: boolean
	// Domain events selected for this feature.
	// Use unique values from the corresponding event union.
	readonly events: readonly SequencerNotificationEvent[]
	// Notification delivery channels.
	// Each channel requires a host adapter and valid channel-specific configuration.
	readonly channels: readonly SequencerNotificationChannel[]
	// Lowest event severity delivered to configured channels.
	readonly minimumSeverity: 'info' | 'warning' | 'error' | 'critical'
}

// Enumerates domain events that may trigger user notifications.
// Select only events useful to the configured channels to avoid notification noise.
export type SequencerNotificationEvent =
	| 'sessionStarted'
	| 'sessionPaused'
	| 'sessionSuspended'
	| 'sessionResumed'
	| 'sessionCompleted'
	| 'sessionStopped'
	| 'sessionFailed'
	| 'actionFailed'
	| 'retryScheduled'
	| 'unsafe'
	| 'safe'
	| 'recoveryStarted'
	| 'recoveryCompleted'
	| 'recoveryFailed'
	| 'meridianFlipStarted'
	| 'meridianFlipCompleted'
	| 'autofocusStarted'
	| 'autofocusCompleted'
	| 'frameRejected'
	| 'deviceDisconnected'
	| 'storageLow'

// Discriminated union of notification delivery channels.
// Web and system channels are local; webhook and custom channels require host-side adapters.
export type SequencerNotificationChannel =
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'web'
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'system'
	  }
	| {
			// Discriminator selecting the concrete variant represented by this object.
			readonly type: 'webhook'
			// Serialized value for url.
			readonly url: string
			// HTTP headers attached to webhook requests.
			// Keys and values must be valid header strings and must not expose secrets to untrusted destinations.
			readonly headers: Readonly<Record<string, string>>
	  }

export const DEFAULT_SEQUENCER_RETRY_POLICY: SequencerRetryPolicy = {
	maxAttempts: 3,
	delay: 0,
	backoff: 1,
	maximumDelay: 0,
	retryOn: ['timeout', 'commandFailed'],
	onExhausted: 'fail',
}

export const DEFAULT_SEQUENCER_CAMERA: SequencerCamera = {
	binX: 1,
	binY: 1,
	gain: 0,
	offset: 0,
	frameFormat: '',
	transferFormat: 'FITS',
	compressed: false,
	x: 0,
	y: 0,
	width: 0,
	height: 0,
	subframe: false,
}

export const DEFAULT_SEQUENCER_AUXILIARY_CAPTURE: SequencerAuxiliaryCapture = {
	...DEFAULT_SEQUENCER_CAMERA,
	exposureTime: 1,
	frameType: 'LIGHT',
}

export const DEFAULT_SEQUENCER: Sequencer = {
	schemaVersion: 1,
	id: '',
	revision: 1,
	name: '',
	devices: {
		camera: '',
	},
	target: {
		id: '',
		name: '',
		enabled: false,
		type: 'JNOW',
		JNOW: {
			x: '00 00 00.00',
			y: '00 00 00.00',
		},
		tracking: {
			enabled: false,
			mode: 'SIDEREAL',
			stopOnShutdown: false,
			retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
		},
		goto: {
			enabled: false,
			skipTolerance: 0.001,
			arrivalTolerance: 0.0005,
			timeout: 300,
			settle: 2,
			retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
		},
		center: {
			enabled: false,
			solver: structuredClone(DEFAULT_PLATE_SOLVE_START),
			tolerance: 0.0001,
			maximumAttempts: 3,
			settle: 1,
			syncMount: true,
			capture: structuredClone(DEFAULT_SEQUENCER_AUXILIARY_CAPTURE),
			retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
		},
		constraints: {
			enabled: false,
			window: {
				enabled: false,
			},
			onViolation: 'wait',
			stableFor: 60,
		},
	},
	capture: {
		order: 'sequential',
		repeat: 1,
		delay: 1,
		continueAfterRejectedFrame: false,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
		frames: [],
		...DEFAULT_SEQUENCER_CAMERA,
	},
	guiding: {
		enabled: false,
		connection: {
			mode: 'remote',
			host: '127.0.0.1',
			port: 4400,
		},
		calibrateBeforeStart: false,
		recalibrateAfterMeridianFlip: true,
		restoreAfterInterruption: true,
		stopOnShutdown: false,
		settle: {
			tolerance: 1.5,
			time: 2,
			timeout: 30,
		},
		thresholds: {
			enabled: false,
			pauseCaptureWhenExceeded: false,
		},
		recovery: {
			enabled: false,
			maximumAttempts: 3,
			stopBeforeRetry: true,
			findStarBeforeRetry: true,
			recalibrate: false,
			settle: {
				tolerance: 1.5,
				time: 2,
				timeout: 30,
			},
			onFailure: 'pause',
		},
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
	},
	dither: {
		enabled: false,
		amount: 3,
		raOnly: false,
		beforeFirstFrame: false,
		afterFilterChange: false,
		everyFrames: 2,
		everyTime: 0,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
		onFailure: 'continue',
	},
	autofocus: {
		enabled: false,
		triggers: {
			onStart: true,
			onFilterChange: true,
			afterMeridianFlip: true,
			everyFrames: 0,
			everyTime: 0,
			temperatureChange: 0,
			minimumTimeBetweenRuns: 30,
		},
		algorithm: {
			initialOffsetSteps: 3,
			stepSize: 50,
			fittingMode: 'TREND_HYPERBOLIC',
			rmsdThreshold: 0.5,
			reversed: false,
			maximumPosition: 50000,
			backlash: {
				enabled: false,
				mode: 'overshoot',
				steps: 0,
			},
		},
		capture: structuredClone(DEFAULT_SEQUENCER_AUXILIARY_CAPTURE),
		starDetection: {
			type: 'nebulosa',
			timeout: 10,
			minimumSNR: 10,
			maximumStars: 200,
		},
		filterOffsets: [],
		settle: 1,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
		onFailure: 'continue',
	},
	rotator: {
		enabled: false,
		angle: 0.5,
		tolerance: 0.001,
		settle: 1,
		moveBeforeCentering: true,
		restoreAfterMeridianFlip: false,
		reverse: false,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
	},
	meridianFlip: {
		enabled: false,
		minimumHourAngle: 0.01,
		maximumHourAngle: 0.08,
		safetyMargin: 10,
		settle: 2,
		timeout: 120,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
		onFailure: 'pause',
	},
	mount: {
		enabled: false,
		unparkOnStartup: false,
		parkOnShutdown: false,
		timeout: 300,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
	},
	cooling: {
		enabled: false,
		temperature: -10,
		tolerance: 1,
		ramp: 2,
		waitForTarget: true,
		timeout: 60,
		warmTemperature: 15,
		warmRamp: 2,
		turnCoolerOffAfterWarm: true,
		warmOnShutdown: false,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
	},
	dome: {
		enabled: false,
		unparkOnStartup: false,
		openOnStartup: false,
		parkOnShutdown: false,
		closeOnShutdown: false,
		closeOnUnsafe: true,
		slaving: false,
		synchronizeBeforeCapture: false,
		settle: 5,
		timeout: 300,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
		onFailure: 'pause',
	},
	cover: {
		enabled: false,
		openOnStartup: false,
		closeOnShutdown: false,
		closeOnUnsafe: false,
		openBeforeCapture: true,
		closeForDarkFrames: true,
		timeout: 30,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
	},
	flatPanel: {
		enabled: false,
		brightness: 80,
		brightnessByFilter: [],
		timeout: 20,
		retry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
	},
	monitoring: {
		enabled: false,
		interval: 30,
		monitors: [],
	},
	safety: {
		enabled: false,
		triggerOnWarning: false,
		abortCurrentExposure: true,
		actions: [],
		recovery: {
			enabled: false,
			automatic: true,
			stableFor: 600,
			maximumWait: 3600,
			reconnectDevices: true,
			unparkMount: true,
			restoreTracking: true,
			resumeCapture: true,
			onFailure: 'pause',
		},
	},
	quality: {
		enabled: false,
		starDetection: {
			type: 'nebulosa',
			timeout: 10,
			minimumSNR: 10,
			maximumStars: 200,
		},
		evaluateEveryFrames: 1,
		rejectFrame: false,
	},
	execution: {
		start: {
			type: 'manual',
		},
		end: {
			type: 'afterSequence',
		},
		pauseMode: 'afterCurrentExposure',
		stopMode: 'graceful',
		defaultRetry: structuredClone(DEFAULT_SEQUENCER_RETRY_POLICY),
		checkpoint: {
			afterEveryAction: true,
			afterEveryFrame: true,
			afterEveryArtifact: true,
			interval: 30,
		},
	},
	storage: {
		root: '',
		fileNameTemplate: '{target}-{filter}-{exposure}',
		directoryTemplate: '{target}/{frameType}',
		autoSubFolderMode: 'off',
	},
	startup: {
		enabled: false,
		continueOnFailure: false,
	},
	shutdown: {
		enabled: false,
		runOnCompletion: true,
		runOnStop: true,
		runOnFailure: true,
		continueOnFailure: true,
	},
	notification: {
		enabled: false,
		events: [],
		channels: [],
		minimumSeverity: 'warning',
	},
}
