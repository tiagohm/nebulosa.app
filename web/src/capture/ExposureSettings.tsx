import type { CameraCapabilities } from 'api'
import { type ReactNode, useState } from 'react'
import type { CameraExposureSettings } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { Select } from '../ui/Select'
import { ExposureTimeInput } from './ExposureTimeInput'

// Controls of the exposure and camera settings of a physical camera, the one block Camera Acquisition and Auto Focus
// share: the exposure time with the range the camera supports, and the less frequent camera settings (gain, offset,
// binning, readout mode, subframe). Editing them changes the next operation of either kind, never a running one,
// which keeps the snapshot it started with. A control the camera does not report is not shown.

// Formats a duration in seconds without float noise, such as 0.0001 or 3600.
export function formatSeconds(value: number) {
	return String(Number(value.toPrecision(6)))
}

interface ExposureSectionProps {
	// Exposure and camera settings of the camera.
	readonly settings: Readonly<CameraExposureSettings>
	// Capabilities of the camera, when known.
	readonly capabilities?: CameraCapabilities
	// Whether a running operation locks the controls.
	readonly disabled: boolean
	// Updates fields of the settings.
	readonly onChange: (patch: Partial<CameraExposureSettings>) => void
	// Controls of the operation shown after the exposure time, such as the frame type of a capture.
	readonly children?: ReactNode
}

// Exposure section: the exposure time of the camera and the range it supports.
export function ExposureSection({ settings, capabilities, disabled, onChange, children }: ExposureSectionProps) {
	return (
		<PanelSection title="Exposure">
			<ExposureTimeInput value={settings.exposureTime} exposure={capabilities?.exposure} disabled={disabled} onChange={(exposureTime) => onChange({ exposureTime })} />
			{capabilities?.exposure && (
				<p className="m-0 text-xs leading-4 text-ink-300">
					{formatSeconds(capabilities.exposure.min)} – {formatSeconds(capabilities.exposure.max)} s supported by the camera.
				</p>
			)}
			{children}
		</PanelSection>
	)
}

interface CameraSettingsProps {
	// Exposure and camera settings of the camera.
	readonly settings: Readonly<CameraExposureSettings>
	// Capabilities of the camera, when known.
	readonly capabilities?: CameraCapabilities
	// Whether a running capture locks the controls.
	readonly disabled: boolean
	// Updates fields of the settings.
	readonly onChange: (patch: Partial<CameraExposureSettings>) => void
}

// Settings changed less often, collapsed by default: gain, offset, binning, readout mode, and subframe, each
// only when the camera reports it, and the sensor temperature and cooler state.
export function CameraSettings({ settings, capabilities, disabled, onChange }: CameraSettingsProps) {
	const [open, setOpen] = useState(false)

	if (!capabilities) {
		return (
			<PanelSection title="Camera">
				<p className="m-0 text-ink-300">Camera settings appear once the camera reports them.</p>
			</PanelSection>
		)
	}

	const { gain, offset, bin, subframe, frameFormats, temperature, cooler } = capabilities
	const formats = frameFormats.map((format) => format.name)

	return (
		<PanelSection title="Camera">
			{(temperature !== undefined || cooler) && (
				<p className="m-0 tabular-nums">
					{temperature !== undefined && `Sensor ${temperature.toFixed(1)} °C`}
					{temperature !== undefined && cooler && ' · '}
					{cooler && `Cooler ${cooler.enabled === false ? 'off' : `${Math.round(cooler.power)} %`}`}
				</p>
			)}
			<Button variant="ghost" className="self-start px-1" onClick={() => setOpen(!open)}>
				{open ? 'Hide settings' : 'Show settings'}
			</Button>
			{open && (
				<>
					{gain && <NumberInput label="Gain" value={Math.min(gain.max, Math.max(gain.min, settings.gain))} min={gain.min} max={gain.max} disabled={disabled} onChange={(value) => onChange({ gain: value })} />}
					{offset && <NumberInput label="Offset" value={Math.min(offset.max, Math.max(offset.min, settings.offset))} min={offset.min} max={offset.max} disabled={disabled} onChange={(value) => onChange({ offset: value })} />}
					{bin && <NumberInput label="Binning" value={Math.min(bin.x, settings.binX)} min={1} max={Math.min(bin.x, bin.y)} disabled={disabled} onChange={(value) => onChange({ binX: value, binY: value })} />}
					{formats.length > 0 && (
						<Select
							label="Readout Mode"
							options={formats}
							value={formats.includes(settings.frameFormat) ? settings.frameFormat : capabilities.frameFormat || formats[0]}
							format={(name) => frameFormats.find((format) => format.name === name)?.label || name}
							disabled={disabled}
							onChange={(frameFormat) => onChange({ frameFormat })}
						/>
					)}
					{subframe && (
						<>
							<Checkbox label="Subframe (ROI)" checked={settings.subframe} disabled={disabled} onChange={(checked) => onChange({ subframe: checked, ...(checked && settings.width <= 0 && { x: 0, y: 0, width: subframe.width, height: subframe.height }) })} />
							{settings.subframe && (
								<div className="grid grid-cols-2 gap-2">
									<NumberInput label="X" value={settings.x} min={0} max={subframe.width - 1} disabled={disabled} onChange={(x) => onChange({ x })} />
									<NumberInput label="Y" value={settings.y} min={0} max={subframe.height - 1} disabled={disabled} onChange={(y) => onChange({ y })} />
									<NumberInput label="Width" value={settings.width} min={1} max={subframe.width} disabled={disabled} onChange={(width) => onChange({ width })} />
									<NumberInput label="Height" value={settings.height} min={1} max={subframe.height} disabled={disabled} onChange={(height) => onChange({ height })} />
									<Button variant="secondary" size="sm" className="col-span-2" disabled={disabled} onClick={() => onChange({ x: 0, y: 0, width: subframe.width, height: subframe.height })}>
										Fullscreen
									</Button>
								</div>
							)}
						</>
					)}
					{!gain && !offset && !bin && formats.length === 0 && !subframe && <p className="m-0 text-ink-300">The camera reports no adjustable settings.</p>}
				</>
			)}
		</PanelSection>
	)
}
