import type { DarkFrameAssessment, DarkFrameHeader, DarkPlaneMeasurement, DarkTemperatureTrace } from './darklibrarywizard.analysis'

// Capture plan of the Dark Library Wizard: what a session acquires, the record of each frame it examined, and the
// directories it writes. A plan lives in the memory of its session only; the Calibration Library receives every accepted
// frame as it is published and the plan once the session ended, and nothing is kept to resume. Times are Unix
// milliseconds, exposures seconds, temperatures degrees Celsius.

// Directory of the frames of a group that do not count.
export const REJECTED_DIRECTORY = 'rejected'

// Directory of the frames of a group being acquired.
export const STAGING_DIRECTORY = '.staging'

// Camera settings shared by every frame of a plan; each group adds its exposure and temperature.
export interface DarkPlanCapture {
	// Gain, in driver units.
	readonly gain: number
	// Offset, in driver units.
	readonly offset: number
	// Binning factors.
	readonly binX: number
	readonly binY: number
	// Whether x, y, width, and height select a subframe instead of the full sensor.
	readonly subframe: boolean
	// Subframe, in unbinned sensor pixels.
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
	// Readout mode of the driver; empty leaves it unchanged.
	readonly frameFormat: string
}

// One row of a capture plan.
export interface DarkGroup {
	// Exposure, in seconds; positive.
	readonly exposure: number
	// Target sensor temperature, in degrees Celsius; absent when the temperature is not controlled.
	readonly temperature?: number
	// Accepted frames required; at least 1.
	readonly count: number
}

// Group of a plan.
export interface DarkPlanGroup extends DarkGroup {
	// Id of the group, unique in the plan.
	readonly groupId: string
	// Exact identity of the settings of its frames (darkGroupKey).
	readonly key: string
	// Absolute directory of its frames.
	readonly directory: string
}

// Light protection of a plan: any combination of the mechanisms, each one verified or asserted.
export interface DarkProtection {
	// Dark or opaque slot of the wheel, 0-based; absent leaves the wheel alone.
	readonly darkFilter?: { readonly slot: number }
	// Whether the assigned dust cover is closed.
	readonly closeCover: boolean
	// Whether the assigned flat panel is switched off.
	readonly panelOff: boolean
	// Whether the operator asserts a manual opaque cap.
	readonly manualCap: boolean
	// Whether a suspicion of light on the first frame of each group stops for the operator's decision.
	readonly verifyFirstFrame: boolean
}

// Thermal protocol of the groups with a target temperature.
export interface DarkThermalPolicy {
	// Largest distance from the target, in degrees Celsius; positive.
	readonly tolerance: number
	// Time the sensor must stay inside the tolerance, in seconds.
	readonly hold: number
	// Longest wait for a stable temperature, in seconds.
	readonly timeout: number
}

// Physical device of a plan.
export interface DarkPlanDevice {
	// Id of the hardware.
	readonly hardwareId: string
	// Name of the device.
	readonly name: string
}

// Immutable specification of a capture plan. A change makes another plan.
export interface DarkCapturePlan {
	// Id of the plan.
	readonly planId: string
	// When the plan was created.
	readonly createdAt: number
	// Physical camera.
	readonly camera: DarkPlanDevice & {
		// Executable and version of its driver.
		readonly driver: { readonly executable: string; readonly version: string }
		// Full sensor, in unbinned pixels; absent while unknown.
		readonly sensor?: { readonly width: number; readonly height: number }
	}
	// Devices the protection uses.
	readonly wheel?: DarkPlanDevice & {
		// Name of the dark slot as the wheel reported it, a convenience that proves nothing about its opacity.
		readonly slotName: string
	}
	readonly panel?: DarkPlanDevice
	readonly cover?: DarkPlanDevice
	// Absolute directory the frames are saved under.
	readonly directory: string
	// Camera settings of every frame.
	readonly capture: DarkPlanCapture
	// Groups in acquisition order.
	readonly groups: readonly DarkPlanGroup[]
	// Light protection.
	readonly protection: DarkProtection
	// Thermal protocol.
	readonly thermal: DarkThermalPolicy
	// Rejected frames allowed per group before the session fails.
	readonly maximumRejections: number
	// What the frames are for; absent is an ordinary dark. A dark-flat is the same light-blocked capture at the exposure
	// of a flat, and a driver may write it as a plain DARK.
	readonly purpose?: 'darkFlat'
	// Whether the Calibration Library should build the masters of the complete groups once the acquisition ends.
	readonly generateMasters?: boolean
}

// Outcome of an examined frame:
// - accepted: counts, nothing to report.
// - acceptedWithWarnings: counts, its warnings and whether the operator acknowledged them are recorded.
// - rejected: a proven failure, kept in the rejected directory; never counts.
// - incomplete: never examined, kept in the rejected directory; never counts.
export type DarkFrameVerdict = 'accepted' | 'acceptedWithWarnings' | 'rejected' | 'incomplete'

// Record of one examined frame.
export interface DarkFrameRecord extends DarkFrameAssessment {
	// Id of the frame, unique in the plan.
	readonly frameId: string
	// Group of the frame.
	readonly groupId: string
	// Number of the frame among the files of its group, from 1, never reused.
	readonly sequence: number
	// Absolute path of its file.
	readonly path: string
	// Size of its file, in bytes.
	readonly size: number
	// Instant the exposure started.
	readonly time: number
	// Outcome.
	readonly verdict: DarkFrameVerdict
	// Whether the operator confirmed its suspicion of light.
	readonly acknowledged?: boolean
	// Levels of its planes.
	readonly planes: readonly DarkPlaneMeasurement[]
	// Keywords of its header.
	readonly header?: DarkFrameHeader
	// Temperature during the exposure, as the driver reported it.
	readonly temperature?: Omit<DarkTemperatureTrace, 'at'>
}

// Counts of one group, from its frames.
export interface DarkGroupProgress {
	// Id of the group.
	readonly groupId: string
	// Accepted frames required.
	readonly required: number
	// Frames that count without warnings.
	readonly accepted: number
	// Frames that count with warnings.
	readonly acceptedWithWarnings: number
	// Frames quarantined with a proven failure.
	readonly rejected: number
	// Frames quarantined without being examined.
	readonly incomplete: number
	// Frames still required.
	readonly missing: number
}
