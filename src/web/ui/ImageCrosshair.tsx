import { ImageViewerStoreContext } from '@shared/context'
import { crosshairPointInPixels, imageMinimumDimension } from '@shared/types/crosshair'
import { Button } from '@ui/components/Button'
import { NumberInput } from '@ui/components/NumberInput'
import { Slider } from '@ui/components/Slider'
import { Switch } from '@ui/components/Switch'
import { CrosshairPresetSelect } from '@ui/CrosshairPresetSelect'
import { CrosshairSpacingUnitSelect } from '@ui/CrosshairSpacingUnitSelect'
import { Icons } from '@ui/Icon'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageCrosshair = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const crosshair = viewer.crosshair
	const { enabled, config } = useSnapshot(crosshair.state)
	const { info } = useSnapshot(viewer.state)
	const width = info?.width ?? 0
	const height = info?.height ?? 0
	const minDimension = imageMinimumDimension(width, height)
	const center = crosshairPointInPixels(config.center, width, height)
	const normalizedSpacing = config.spacing.unit === 'normalized'
	const spacingValue = normalizedSpacing ? config.spacing.value * 100 : config.spacing.value
	const spacingMinimum = normalizedSpacing ? 0.5 : Math.min(8, Math.max(1, minDimension))
	const spacingMaximum = normalizedSpacing ? 25 : Math.max(1, minDimension || 100000)
	const blocked = !enabled

	useEffect(crosshair.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Switch className="col-span-full min-w-0" label="Enabled" onValueChange={(value) => crosshair.update('enabled', value)} value={enabled} />
			<CrosshairPresetSelect className="col-span-6" disabled={blocked} onValueChange={crosshair.setPreset} value={config.preset} />
			<CrosshairSpacingUnitSelect className="col-span-6" disabled={blocked} onValueChange={crosshair.setSpacingUnit} value={config.spacing.unit} />
			<NumberInput className="col-span-4 min-w-0" disabled={blocked || width <= 0} label="Center X" maxValue={width} minValue={0} onValueChange={(x) => crosshair.setCenterFromPixels({ x, y: center.y })} step={1} value={Math.round(center.x)} />
			<NumberInput className="col-span-4 min-w-0" disabled={blocked || height <= 0} label="Center Y" maxValue={height} minValue={0} onValueChange={(y) => crosshair.setCenterFromPixels({ x: center.x, y })} step={1} value={Math.round(center.y)} />
			<Button className="col-span-4" color="danger" disabled={blocked} label="Center" onClick={crosshair.resetCenter} startContent={<Icons.Restore />} />
			<NumberInput
				className="col-span-6 min-w-0"
				disabled={blocked}
				endContent={normalizedSpacing ? '%' : 'px'}
				fractionDigits={normalizedSpacing ? 1 : 0}
				label="Spacing"
				maxValue={spacingMaximum}
				minValue={spacingMinimum}
				onValueChange={(value) => crosshair.setSpacingValue(normalizedSpacing ? value / 100 : value)}
				step={normalizedSpacing ? 0.5 : 1}
				value={spacingValue}
			/>
			<NumberInput className="col-span-6 min-w-0" disabled={blocked} endContent="px" label="Aperture" maxValue={64} minValue={0} onValueChange={crosshair.setAperture} step={1} value={config.aperture} />
			<label className="col-span-6 flex h-10 min-w-0 items-center gap-3 rounded-lg bg-neutral-900/70 px-3 text-sm text-neutral-200">
				<span className="min-w-0 flex-1 truncate">Color</span>
				<input className="h-7 w-10 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-40" disabled={blocked} onChange={(event) => crosshair.setColor(event.currentTarget.value)} type="color" value={config.color} />
			</label>
			<NumberInput className="col-span-6 min-w-0" disabled={blocked} endContent="px" fractionDigits={1} label="Line Width" maxValue={4} minValue={0.5} onValueChange={crosshair.setLineWidth} step={0.5} value={config.lineWidth} />
			<Slider className="col-span-full" disabled={blocked} fullWidth label={`Opacity (${Math.round(config.opacity * 100)}%)`} maxValue={1} minValue={0.1} onValueChange={crosshair.setOpacity} snapPrecision={2} step={0.05} value={config.opacity} />
			<Switch className="col-span-6 min-w-0" disabled={blocked} label="Dashed" onValueChange={crosshair.setDashed} value={config.dashed} />
			<Switch className="col-span-6 min-w-0" disabled={blocked} label="Halo" onValueChange={crosshair.setHalo} value={config.halo} />
		</div>
	)
})
