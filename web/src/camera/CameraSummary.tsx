import type { CameraCapabilities } from 'api'
import type { ReactNode } from 'react'
import type { CameraExposureSettings } from '../profile/schema'

// Summary of the camera settings of an operation that applies them without editing them: Camera Acquisition owns them.

interface CameraSummaryProps {
	// Camera settings applied.
	readonly exposure: Omit<CameraExposureSettings, 'exposureTime'>
	// What the camera reports.
	readonly capabilities?: CameraCapabilities
}

// The camera settings Camera Acquisition owns, shown only.
export function CameraSummary({ exposure: { gain, offset, binX, binY, subframe, width, height, frameFormat }, capabilities }: CameraSummaryProps) {
	const format = capabilities?.frameFormats.find((each) => each.name === frameFormat)?.label ?? (frameFormat || 'Default')

	return (
		<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
			<SummaryRow label="Gain">{gain}</SummaryRow>
			<SummaryRow label="Offset">{offset}</SummaryRow>
			<SummaryRow label="Binning">{`${binX} × ${binY}`}</SummaryRow>
			<SummaryRow label="Frame">{subframe ? `${width} × ${height}` : 'Full sensor'}</SummaryRow>
			<SummaryRow label="Format">{format}</SummaryRow>
		</dl>
	)
}

// Label and value of a row of a summary list.
export function SummaryRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="contents">
			<dt className="text-ink-300">{label}</dt>
			<dd className="m-0 min-w-0 truncate text-right tabular-nums">{children}</dd>
		</div>
	)
}
