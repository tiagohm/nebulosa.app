import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { formatExposureTime, formatPercent, formatPixelSize } from '../../format'
import { openCameraTool } from '../../images/opencameratool'
import { deviceBusy, operationsState } from '../../operations'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { DataRow } from '../../ui/DataRow'
import { LinkButton } from '../../ui/LinkButton'
import { Notice } from '../../ui/Notice'
import { NumberInput } from '../../ui/NumberInput'
import { controlRuntime, deviceStateOf, sendCommand } from '../control'
import type { InterfaceProps } from '../parts'
import { useBusyReason } from '../useControl'

// Auxiliary controls of a camera: what it is and what it can capture, as its driver reports it, and its cooling
// (cooler switch, target temperature, and cooler power); its sensor temperature is in the header of the device. The
// target typed here is only a request; the sensor temperature shown is the one reported, never the target. Exposures are taken
// by the Camera Acquisition of the camera's tab in Images, and cooling changes are refused while an exposure runs.

// Target temperature when the panel opens and the camera reports none, in degrees Celsius.
const DEFAULT_TARGET = -10

// Controls of a camera.
export function CameraControls({ device }: InterfaceProps) {
	const control = useSnapshot(controlRuntime)
	const operations = useSnapshot(operationsState)
	const camera = deviceStateOf(control.states, 'camera', device.id)!
	const [target, setTarget] = useState(DEFAULT_TARGET)
	const { sensor } = camera
	const busy = useBusyReason(device)
	const capturing = deviceBusy(operations, device.connectionId, device.id)

	return (
		<>
			<PanelSection title="Camera">
				<DataRow label="Model">{camera.name}</DataRow>
				<DataRow label="Sensor">{sensor ? `${sensor.width} × ${sensor.height} px · ${formatPixelSize(sensor.pixelSize)}` : 'Not reported'}</DataRow>
				{camera.exposure && <DataRow label="Exposure">{`${formatExposureTime(camera.exposure.min)} to ${formatExposureTime(camera.exposure.max)}`}</DataRow>}
				{camera.gain && <DataRow label="Gain">{`${camera.gain.min} to ${camera.gain.max}`}</DataRow>}
				{camera.offset && <DataRow label="Offset">{`${camera.offset.min} to ${camera.offset.max}`}</DataRow>}
				{camera.bin && <DataRow label="Binning">{`up to ${camera.bin.x} × ${camera.bin.y}`}</DataRow>}
				{camera.frameFormats.length > 0 && <DataRow label="Readout modes">{camera.frameFormats.map((format) => format.label).join(', ')}</DataRow>}
				<DataRow label="State">{capturing ? 'Capturing' : 'Idle'}</DataRow>
				<Notice>
					Exposures are taken with the <LinkButton onClick={() => openCameraTool(device.connectionId, device.id, 'camera-acquisition')}>Acquisition tool</LinkButton> of this camera's tab in Images.
				</Notice>
			</PanelSection>
			{(camera.cooler !== undefined || camera.canSetTemperature) && (
				<PanelSection title="Cooling">
					{camera.cooler && <DataRow label="Cooler power">{formatPercent(camera.cooler.power / 100)}</DataRow>}
					{camera.cooler?.enabled !== undefined && (
						<Checkbox label="Cooler on" checked={camera.cooler.enabled} disabled={!!busy} title={busy} onChange={(enabled) => void sendCommand(controlRuntime, { type: 'camera', deviceId: device.id, action: 'cooler', label: enabled ? 'Cooler on' : 'Cooler off', body: { enabled } })} />
					)}
					{camera.canSetTemperature && (
						<div className="flex items-end gap-2">
							<NumberInput className="min-w-0 flex-1" label="Target temperature" value={target} min={-60} max={40} step={0.5} suffix="°C" onChange={setTarget} />
							<Button disabled={!!busy} title={busy} onClick={() => void sendCommand(controlRuntime, { type: 'camera', deviceId: device.id, action: 'temperature', label: 'Target temperature', body: { value: target } })}>
								Apply
							</Button>
						</div>
					)}
					{capturing && <Notice>Cooling changes wait until the exposure ends, so the frame stays calibratable.</Notice>}
					{camera.canSetTemperature && <Notice>The sensor reaches the target over minutes; the temperature in the header is the one it reports.</Notice>}
				</PanelSection>
			)}
		</>
	)
}
