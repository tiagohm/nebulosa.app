import { ImageViewerStoreContext } from '@shared/context'
import { Button } from '@ui/components/Button'
import { Chip } from '@ui/components/Chip'
import { NumberInput } from '@ui/components/NumberInput'
import { Select } from '@ui/components/Select'
import { Slider } from '@ui/components/Slider'
import { Switch } from '@ui/components/Switch'
import { TextInput } from '@ui/components/TextInput'
import { CrosshairPresetSelect } from '@ui/CrosshairPresetSelect'
import { Icons } from '@ui/Icon'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { PIOVERTWO } from 'nebulosa/src/core/constants'
import { formatDEC, formatRA, parseAngle } from 'nebulosa/src/math/units/angle'
import { memo, useContext, useEffect, useState } from 'react'
import { CROSSHAIR_ANGULAR_DISPLAY_UNITS, CROSSHAIR_CENTER_SPACES, CROSSHAIR_SPACING_UNITS, crosshairAngleFromDisplayValue, crosshairAngleToDisplayValue, crosshairPointInPixels } from 'src/types/image.crosshair'
import { useSnapshot } from 'valtio'

const CENTER_SPACE_LABELS = { image: 'Image', sky: 'Sky' } as const
const SPACING_UNIT_LABELS = { pixel: 'Pixel', normalized: 'Normalized', angular: 'Angular' } as const
const ANGULAR_UNIT_LABELS = { arcsecond: 'Arcsec', arcminute: 'Arcmin', degree: 'Degree' } as const

export const ImageCrosshair = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const crosshair = viewer.crosshair
	const { enabled, config, projection, wcsStatus } = useSnapshot(crosshair.state)
	const { info } = useSnapshot(viewer.state)
	const { solution } = useSnapshot(viewer.solver.state)
	const width = info?.width ?? 0
	const height = info?.height ?? 0
	const minDimension = Math.min(width, height)
	const hasCompatibleSolution = !!info && !!solution && Number.isFinite(solution.scale) && solution.scale > 0 && solution.widthInPixels === width && solution.heightInPixels === height
	const centerInPixels = config.center.space === 'image' ? crosshairPointInPixels(config.center.point, width, height) : projection?.center
	const angular = config.spacing.unit === 'angular'
	const normalizedSpacing = config.spacing.unit === 'normalized'
	const spacingValue = normalizedSpacing ? config.spacing.value * 100 : config.spacing.unit === 'pixel' ? config.spacing.value : 0
	const spacingMinimum = normalizedSpacing ? 0.5 : Math.min(8, Math.max(1, minDimension))
	const spacingMaximum = normalizedSpacing ? 25 : Math.max(1, minDimension || 100000)
	const blocked = !enabled
	const spacingBlocked = blocked || config.preset === 'crosshair'
	const centerSpaces = !hasCompatibleSolution && config.center.space === 'image' ? (['image'] as const) : CROSSHAIR_CENTER_SPACES
	const spacingUnits = !hasCompatibleSolution && config.spacing.unit !== 'angular' ? (['pixel', 'normalized'] as const) : CROSSHAIR_SPACING_UNITS

	useEffect(crosshair.mount, [])

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Switch className="col-span-9 min-w-0" label="Enabled" onValueChange={crosshair.setEnabled} value={enabled} />
			<Chip className="col-span-3 justify-center" color={wcsStatus === 'ready' ? 'success' : wcsStatus === 'loading' ? 'primary' : wcsStatus === 'outside' ? 'warning' : hasCompatibleSolution ? 'default' : 'danger'} size="sm">
				{wcsStatusLabel(wcsStatus, hasCompatibleSolution)}
			</Chip>

			<CrosshairPresetSelect className="col-span-6" disabled={blocked} onValueChange={crosshair.setPreset} value={config.preset} />
			<Select className="col-span-6" disabled={blocked} items={centerSpaces} label="Center space" onValueChange={crosshair.setCenterSpace} value={config.center.space}>
				{(item) => <span>{CENTER_SPACE_LABELS[item]}</span>}
			</Select>

			{config.center.space === 'image' ? (
				<>
					<NumberInput className="col-span-4 min-w-0" disabled={blocked || width <= 0} label="Center X" maxValue={width} minValue={0} onValueChange={(x) => centerInPixels && crosshair.setCenterFromPixels({ x, y: centerInPixels.y })} step={1} value={Math.round(centerInPixels?.x ?? 0)} />
					<NumberInput className="col-span-4 min-w-0" disabled={blocked || height <= 0} label="Center Y" maxValue={height} minValue={0} onValueChange={(y) => centerInPixels && crosshair.setCenterFromPixels({ x: centerInPixels.x, y })} step={1} value={Math.round(centerInPixels?.y ?? 0)} />
					<Button className="col-span-4" color="danger" disabled={blocked} label="Center" onClick={crosshair.resetCenter} startContent={<Icons.Restore />} />
					<TextInput className="col-span-6 min-w-0" label="RA (J2000)" readOnly value={projection ? formatRA(projection.center.rightAscension) : '--'} />
					<TextInput className="col-span-6 min-w-0" label="DEC (J2000)" readOnly value={projection ? formatDEC(projection.center.declination) : '--'} />
				</>
			) : (
				<SkyCenterFields center={config.center.coordinate} disabled={blocked || !hasCompatibleSolution} onChange={crosshair.setSkyCenter} onReset={crosshair.resetCenter} x={centerInPixels?.x} y={centerInPixels?.y} />
			)}

			<Select className="col-span-6" disabled={spacingBlocked} items={spacingUnits} label="Spacing unit" onValueChange={crosshair.setSpacingUnit} value={config.spacing.unit}>
				{(item) => <span>{SPACING_UNIT_LABELS[item]}</span>}
			</Select>
			{angular ? (
				<AngularSpacing disabled={spacingBlocked || !hasCompatibleSolution} />
			) : (
				<NumberInput
					className="col-span-6 min-w-0"
					disabled={spacingBlocked}
					endContent={normalizedSpacing ? '%' : 'px'}
					fractionDigits={normalizedSpacing ? 1 : 0}
					label="Spacing"
					maxValue={spacingMaximum}
					minValue={spacingMinimum}
					onValueChange={(value) => crosshair.setSpacingValue(normalizedSpacing ? value / 100 : value)}
					step={normalizedSpacing ? 0.5 : 1}
					value={spacingValue}
				/>
			)}

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

type SkyCenterFieldsProps = {
	readonly center: EquatorialCoordinate
	readonly disabled: boolean
	readonly onChange: (coordinate: EquatorialCoordinate) => void
	readonly onReset: VoidFunction
	readonly x?: number
	readonly y?: number
}

function SkyCenterFields({ center, disabled, onChange, onReset, x, y }: SkyCenterFieldsProps) {
	const [rightAscension, setRightAscension] = useState(() => formatRA(center.rightAscension))
	const [declination, setDeclination] = useState(() => formatDEC(center.declination))

	useEffect(() => setRightAscension(formatRA(center.rightAscension)), [center.rightAscension])
	useEffect(() => setDeclination(formatDEC(center.declination)), [center.declination])

	function commit() {
		const ra = parseAngle(rightAscension, true)
		const dec = parseAngle(declination)

		if (ra !== undefined && dec !== undefined && dec >= -PIOVERTWO && dec <= PIOVERTWO) {
			onChange({ rightAscension: ra, declination: dec })
		} else {
			setRightAscension(formatRA(center.rightAscension))
			setDeclination(formatDEC(center.declination))
		}
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Enter') {
			event.preventDefault()
			commit()
		}
	}

	return (
		<>
			<TextInput className="col-span-6 min-w-0" disabled={disabled} label="RA (J2000)" onBlur={commit} onKeyDown={handleKeyDown} onValueChange={setRightAscension} value={rightAscension} />
			<TextInput className="col-span-6 min-w-0" disabled={disabled} label="DEC (J2000)" onBlur={commit} onKeyDown={handleKeyDown} onValueChange={setDeclination} value={declination} />
			<TextInput className="col-span-4 min-w-0" label="Center X" readOnly value={x === undefined ? '--' : Math.round(x).toString()} />
			<TextInput className="col-span-4 min-w-0" label="Center Y" readOnly value={y === undefined ? '--' : Math.round(y).toString()} />
			<Button className="col-span-4" color="danger" disabled={disabled} label="Center" onClick={onReset} startContent={<Icons.Restore />} />
		</>
	)
}

const AngularSpacing = memo(({ disabled }: { readonly disabled: boolean }) => {
	const { crosshair } = useContext(ImageViewerStoreContext)
	const { config, projection } = useSnapshot(crosshair.state)
	const spacing = config.spacing
	if (spacing.unit !== 'angular') return null

	const displayValue = crosshairAngleToDisplayValue(spacing.value, spacing.displayUnit)
	const effectiveValue = projection?.spacing === undefined ? '--' : crosshairAngleToDisplayValue(projection.spacing, spacing.displayUnit).toLocaleString(undefined, { maximumFractionDigits: 2 })
	const suffix = ANGULAR_UNIT_LABELS[spacing.displayUnit]

	return (
		<>
			<Switch className="col-span-6 min-w-0" disabled={disabled} label="Automatic" onValueChange={crosshair.setAngularAutomatic} value={spacing.automatic} />
			{spacing.automatic ? (
				<TextInput className="col-span-6 min-w-0" disabled={disabled} endContent={suffix} label="Effective spacing" readOnly value={effectiveValue} />
			) : (
				<NumberInput className="col-span-6 min-w-0" disabled={disabled} fractionDigits={2} label="Spacing" minValue={0.01} onValueChange={(value) => crosshair.setSpacingValue(crosshairAngleFromDisplayValue(value, spacing.displayUnit))} step={0.1} value={displayValue} />
			)}
			<Select className="col-span-6" disabled={disabled} items={CROSSHAIR_ANGULAR_DISPLAY_UNITS} label="Angular unit" onValueChange={crosshair.setAngularDisplayUnit} value={spacing.displayUnit}>
				{(item) => <span>{ANGULAR_UNIT_LABELS[item]}</span>}
			</Select>
		</>
	)
})

function wcsStatusLabel(status: string, compatible: boolean) {
	if (!compatible) return 'No WCS'
	return status === 'loading' ? 'Projecting' : status === 'outside' ? 'Outside' : status === 'error' ? 'WCS error' : status === 'ready' ? 'Ready' : 'WCS available'
}
