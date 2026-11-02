import type { CameraCapabilities } from 'api'
import type { CameraExposureSettings } from '../profile/schema'
import { DataList, DataRow } from '../ui/DataRow'

// Summary of the camera settings of an operation that applies them without editing them: Camera Acquisition owns them.

interface CameraSummaryProps {
	// Camera settings applied.
	readonly exposure: Omit<CameraExposureSettings, 'exposureTime'>
	// What the camera reports.
	readonly capabilities?: CameraCapabilities
}

// The camera settings Camera Acquisition owns, shown only.
export function CameraSummary({ exposure: { gain, offset, binX, binY, subframe, width, height, x, y, frameFormat }, capabilities }: CameraSummaryProps) {
	const format = capabilities?.frameFormats.find((each) => each.name === frameFormat)?.label ?? (frameFormat || capabilities?.frameFormat || 'Default')

	return (
		<DataList>
			<DataRow label="Gain">{gain}</DataRow>
			<DataRow label="Offset">{offset}</DataRow>
			<DataRow label="Binning">{`${binX} x ${binY}`}</DataRow>
			<DataRow label="Frame">{subframe ? `${x} ${y} ${width} ${height}` : 'Full sensor'}</DataRow>
			<DataRow label="Readout Mode">{format}</DataRow>
		</DataList>
	)
}
