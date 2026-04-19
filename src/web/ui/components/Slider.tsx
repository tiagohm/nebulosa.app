import type * as React from 'react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { clamp, tw } from '@/shared/util'

const sliderStyles = tv({
	slots: {
		base: 'inline-flex min-w-0 select-none',
		label: 'leading-none',
		body: 'flex min-w-0 gap-2',
		content: 'flex shrink-0 items-center whitespace-nowrap',
		control: 'relative overflow-hidden rounded-full touch-none transition',
		fill: 'absolute transition',
		thumb: 'absolute flex items-center justify-center rounded-full bg-white shadow-sm outline-none transition-all duration-150 ease-out focus-visible:ring-0',
		thumbContent: 'pointer-events-none flex items-center justify-center',
	},
	variants: {
		size: {
			sm: {
				label: 'text-xs',
				content: 'text-xs',
				thumb: 'size-4',
				thumbContent: 'text-[0.6rem]',
			},
			md: {
				label: 'text-sm',
				content: 'text-sm',
				thumb: 'size-5',
				thumbContent: 'text-xs',
			},
			lg: {
				label: 'text-base',
				content: 'text-base',
				thumb: 'size-6',
				thumbContent: 'text-sm',
			},
		},
		color: {
			primary: '[--color-variant:var(--primary)]',
			secondary: '[--color-variant:var(--secondary)]',
			success: '[--color-variant:var(--success)]',
			danger: '[--color-variant:var(--danger)]',
			warning: '[--color-variant:var(--warning)]',
		},
		vertical: {
			true: {
				base: 'flex-col items-center',
				body: 'flex-col items-center',
			},
			false: {
				base: 'flex-col items-stretch',
				body: 'items-center',
			},
		},
		fullWidth: {
			true: {
				base: 'w-full',
				body: 'w-full',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		color: 'primary',
		vertical: false,
		fullWidth: false,
	},
})

const sliderSizeStyles = {
	sm: {
		horizontalControl: 'h-4 min-w-24 flex-1',
		verticalControl: 'w-4 min-h-28 h-28',
		thumbRem: 1,
	},
	md: {
		horizontalControl: 'h-5 min-w-28 flex-1',
		verticalControl: 'w-5 min-h-32 h-32',
		thumbRem: 1.25,
	},
	lg: {
		horizontalControl: 'h-6 min-w-32 flex-1',
		verticalControl: 'w-6 min-h-36 h-36',
		thumbRem: 1.5,
	},
} as const

export type SliderSize = keyof typeof sliderSizeStyles
export type SliderRangeValue = readonly [number, number]
export type SliderValue = number | SliderRangeValue

export interface SliderClassNames {
	readonly base?: ClassValue
	readonly label?: ClassValue
	readonly body?: ClassValue
	readonly control?: ClassValue
	readonly fill?: ClassValue
	readonly thumb?: ClassValue
	readonly thumbContent?: ClassValue
	readonly startContent?: ClassValue
	readonly endContent?: ClassValue
}

type SliderVariants = VariantProps<typeof sliderStyles>

export interface SliderProps<V extends SliderValue> extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'color'>, SliderVariants {
	readonly children?: React.ReactNode
	readonly classNames?: SliderClassNames
	readonly label?: React.ReactNode
	readonly value?: V
	readonly onValueChange?: (value: V) => void
	readonly onValueChangeEnd?: (value: V) => void
	readonly minValue?: number
	readonly maxValue?: number
	readonly step?: number
	readonly size?: SliderSize
	readonly disabled?: boolean
	readonly readOnly?: boolean
	readonly thumbContent?: React.ReactNode
	readonly startThumbContent?: React.ReactNode
	readonly endThumbContent?: React.ReactNode
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
	readonly snapPrecision?: number
}

// Normalizes the slider bounds into an ascending tuple.
function normalizeBounds(minValue?: number, maxValue?: number): SliderRangeValue {
	const hasMin = Number.isFinite(minValue)
	const hasMax = Number.isFinite(maxValue)

	if (hasMin && hasMax) return minValue! <= maxValue! ? [minValue!, maxValue!] : [maxValue!, minValue!]
	if (hasMin) return [minValue!, minValue! + 100]
	if (hasMax) return [Math.min(0, maxValue!), maxValue!]
	return [0, 100]
}

// Keeps the configured step positive and finite.
function normalizeStep(step?: number) {
	return Number.isFinite(step) && step! > 0 ? step! : 1
}

// Snaps a raw value into the configured range and step interval.
function snapValue(value: number, minValue: number, maxValue: number, step: number, precision: number) {
	if (minValue === maxValue) return minValue
	const steppedValue = minValue + Math.round((value - minValue) / step) * step
	return Number(clamp(steppedValue, minValue, maxValue).toFixed(precision))
}

// Normalizes a single slider value with bounds and stepping applied.
function normalizeSingleValue(value: number | undefined, minValue: number, maxValue: number, step: number, precision: number) {
	return snapValue(Number.isFinite(value) ? value! : minValue, minValue, maxValue, step, precision)
}

// Normalizes the controlled slider value for single-value and range modes.
function normalizeSliderValue(value: SliderValue | undefined, minValue: number, maxValue: number, step: number, precision: number) {
	if (isRangeValue(value)) {
		const startValue = normalizeSingleValue(value[0], minValue, maxValue, step, precision)
		const endValue = normalizeSingleValue(value[1], minValue, maxValue, step, precision)
		return startValue <= endValue ? ([startValue, endValue] as const) : ([endValue, startValue] as const)
	}

	return normalizeSingleValue(value, minValue, maxValue, step, precision)
}

// Narrows a slider value into its tuple-based range representation.
function isRangeValue(value?: SliderValue): value is SliderRangeValue {
	return Array.isArray(value) && value.length >= 2
}

// Compares slider values without reallocating arrays during drag updates.
function areSliderValuesEqual(firstValue: SliderValue, secondValue: SliderValue) {
	if (isRangeValue(firstValue) !== isRangeValue(secondValue)) return false

	if (isRangeValue(firstValue) && isRangeValue(secondValue)) {
		return firstValue[0] === secondValue[0] && firstValue[1] === secondValue[1]
	}

	return firstValue === secondValue
}

// Builds a stable key so external value updates can resync local drag state.
function sliderValueKey(value: SliderValue) {
	return isRangeValue(value) ? `${value[0]}:${value[1]}` : value
}

// Converts a numeric value into the slider's normalized 0..1 ratio.
function valueToRatio(value: number, minValue: number, maxValue: number) {
	if (minValue === maxValue) return 0
	return clamp((value - minValue) / (maxValue - minValue), 0, 1)
}

// Maps the pointer location into a normalized slider ratio.
function pointerToRatio(clientX: number, clientY: number, rect: DOMRect, vertical: boolean) {
	if (vertical) {
		const thumbSize = rect.width
		const travel = rect.height - thumbSize
		if (travel <= 0) return 0
		return clamp((rect.bottom - clientY - thumbSize / 2) / travel, 0, 1)
	}

	const thumbSize = rect.height
	const travel = rect.width - thumbSize
	if (travel <= 0) return 0
	return clamp((clientX - rect.left - thumbSize / 2) / travel, 0, 1)
}

// Converts pointer movement into a normalized delta across the thumb travel distance.
function pointerDeltaToRatio(startPoint: { readonly x: number; readonly y: number }, clientX: number, clientY: number, rect: DOMRect, vertical: boolean) {
	if (vertical) {
		const thumbSize = rect.width
		const travel = rect.height - thumbSize
		if (travel <= 0) return 0
		return (startPoint.y - clientY) / travel
	}

	const thumbSize = rect.height
	const travel = rect.width - thumbSize
	if (travel <= 0) return 0
	return (clientX - startPoint.x) / travel
}

// Treat tiny pointer jitter as a click instead of a real drag gesture.
function hasPointerMoved(startPoint: { readonly x: number; readonly y: number } | null, clientX: number, clientY: number) {
	if (!startPoint) return false
	return Math.abs(clientX - startPoint.x) >= 2 || Math.abs(clientY - startPoint.y) >= 2
}

// Picks the nearest thumb when the user starts dragging a range slider from the track.
function pickClosestThumb(value: SliderRangeValue, nextValue: number) {
	return Math.abs(value[0] - nextValue) <= Math.abs(value[1] - nextValue) ? 0 : 1
}

// Updates one side of the range while preventing thumbs from crossing.
function updateRangeValue(value: SliderRangeValue, thumbIndex: number, nextValue: number) {
	if (thumbIndex === 0) return [Math.min(nextValue, value[1]), value[1]] as const
	return [value[0], Math.max(nextValue, value[0])] as const
}

// Resolves the visible content for each thumb in single-value and range modes.
function resolveThumbContent(index: number, range: boolean, thumbContent?: React.ReactNode, startThumbContent?: React.ReactNode, endThumbContent?: React.ReactNode) {
	if (range) return index === 0 ? (startThumbContent ?? thumbContent) : (endThumbContent ?? thumbContent)
	return startThumbContent ?? thumbContent
}

// Positions a thumb along its travel axis while keeping it inside the control.
function thumbPositionStyle(ratio: number, vertical: boolean, thumbRem: number): React.CSSProperties {
	const positionPercent = ratio * 100
	const offsetRem = ratio * thumbRem

	if (vertical) return { bottom: `calc(${positionPercent}% - ${offsetRem}rem)`, left: '50%', transform: 'translateX(-50%)' }
	return { left: `calc(${positionPercent}% - ${offsetRem}rem)`, top: '50%', transform: 'translateY(-50%)' }
}

// Converts a normalized value ratio into the aligned thumb-center position on the track.
function thumbCenterPosition(ratio: number, thumbRem: number) {
	return `calc(${ratio * 100}% - ${ratio * thumbRem}rem + ${thumbRem / 2}rem)`
}

// Positions the filled range indicator for both single-value and range modes.
function fillStyle(value: SliderValue, minValue: number, maxValue: number, vertical: boolean, thumbRem: number): React.CSSProperties {
	if (isRangeValue(value)) {
		const startRatio = valueToRatio(value[0], minValue, maxValue)
		const endRatio = valueToRatio(value[1], minValue, maxValue)
		const startPosition = thumbCenterPosition(startRatio, thumbRem)
		const endPosition = thumbCenterPosition(endRatio, thumbRem)

		if (vertical) return { bottom: startPosition, height: `calc(${endPosition} - ${startPosition})`, left: 0, right: 0 }
		return { left: startPosition, width: `calc(${endPosition} - ${startPosition})`, top: 0, bottom: 0 }
	}

	const ratio = valueToRatio(value, minValue, maxValue)
	const position = thumbCenterPosition(ratio, thumbRem)

	if (vertical) return { bottom: 0, height: position, left: 0, right: 0 }
	return { left: 0, width: position, top: 0, bottom: 0 }
}

// Renders a controlled single-value or range slider with draggable circular thumbs.
export function Slider<V extends SliderValue>({
	children,
	className,
	classNames,
	color,
	disabled = false,
	endThumbContent,
	label,
	maxValue,
	minValue,
	onValueChange,
	onValueChangeEnd,
	onWheel,
	readOnly,
	ref,
	size = 'md',
	startContent,
	startThumbContent,
	step,
	style,
	endContent,
	thumbContent,
	value,
	vertical = false,
	fullWidth,
	snapPrecision = 0,
	...props
}: SliderProps<V>) {
	const [minimumValue, maximumValue] = normalizeBounds(minValue, maxValue)
	const normalizedStep = normalizeStep(step)
	const normalizedValue = normalizeSliderValue(value, minimumValue, maximumValue, normalizedStep, snapPrecision)
	const [draftValue, setDraftValue] = useState<SliderValue>(normalizedValue)
	const [activeThumbIndex, setActiveThumbIndex] = useState(0)
	const [draggingThumbIndex, setDraggingThumbIndex] = useState<number | null>(null)
	const controlRef = useRef<HTMLDivElement | null>(null)
	const dragPointerIdRef = useRef<number | null>(null)
	const dragThumbIndexRef = useRef<number | null>(null)
	const dragFromThumbRef = useRef(false)
	const dragMovedRef = useRef(false)
	const dragStartPointRef = useRef<{ readonly x: number; readonly y: number } | null>(null)
	const dragStartValueRef = useRef<SliderValue>(normalizedValue)
	const draftValueRef = useRef<SliderValue>(normalizedValue)
	const styles = sliderStyles({ size, color, vertical, fullWidth })
	const sizeStyles = sliderSizeStyles[size]
	const valueKey = sliderValueKey(normalizedValue)
	const content = label ?? children
	const range = isRangeValue(normalizedValue)
	const hasStartContent = startContent !== undefined && startContent !== null
	const hasEndContent = endContent !== undefined && endContent !== null

	// Keeps the local draft synchronized when the controlled value changes externally.
	useEffect(() => {
		if (dragThumbIndexRef.current !== null) return

		if (!areSliderValuesEqual(draftValueRef.current, normalizedValue)) {
			draftValueRef.current = normalizedValue
			setDraftValue(normalizedValue)
		}
	}, [normalizedValue, valueKey])

	// Applies a new draft value and notifies the live change handler.
	const setInteractiveValue = useEffectEvent((nextValue: SliderValue) => {
		if (areSliderValuesEqual(draftValueRef.current, nextValue)) return
		draftValueRef.current = nextValue
		setDraftValue(nextValue)
		onValueChange?.(nextValue as V)
	})

	// Resolves a slider value from the pointer location and target thumb.
	const valueFromPointer = useEffectEvent((clientX: number, clientY: number, thumbIndex?: number) => {
		const control = controlRef.current

		if (!control) {
			return { thumbIndex: thumbIndex ?? 0, value: draftValueRef.current }
		}

		const ratio = pointerToRatio(clientX, clientY, control.getBoundingClientRect(), vertical)
		const nextValue = snapValue(minimumValue + ratio * (maximumValue - minimumValue), minimumValue, maximumValue, normalizedStep, snapPrecision)
		const currentValue = draftValueRef.current

		if (isRangeValue(currentValue)) {
			const resolvedThumbIndex = thumbIndex ?? pickClosestThumb(currentValue, nextValue)

			return {
				thumbIndex: resolvedThumbIndex,
				value: updateRangeValue(currentValue, resolvedThumbIndex, nextValue),
			}
		}

		return {
			thumbIndex: 0,
			value: nextValue,
		}
	})

	// Resolves a thumb drag value from pointer movement relative to the drag start point.
	const valueFromThumbDrag = useEffectEvent((clientX: number, clientY: number, thumbIndex: number) => {
		const control = controlRef.current
		const dragStartPoint = dragStartPointRef.current
		const dragStartValue = dragStartValueRef.current

		if (!control || !dragStartPoint) {
			return draftValueRef.current
		}

		const ratioDelta = pointerDeltaToRatio(dragStartPoint, clientX, clientY, control.getBoundingClientRect(), vertical)

		if (isRangeValue(dragStartValue)) {
			const startThumbValue = dragStartValue[thumbIndex]
			const startRatio = valueToRatio(startThumbValue, minimumValue, maximumValue)
			const nextRatio = clamp(startRatio + ratioDelta, 0, 1)
			const nextThumbValue = snapValue(minimumValue + nextRatio * (maximumValue - minimumValue), minimumValue, maximumValue, normalizedStep, snapPrecision)
			return updateRangeValue(dragStartValue, thumbIndex, nextThumbValue)
		}

		const startRatio = valueToRatio(dragStartValue, minimumValue, maximumValue)
		const nextRatio = clamp(startRatio + ratioDelta, 0, 1)
		return snapValue(minimumValue + nextRatio * (maximumValue - minimumValue), minimumValue, maximumValue, normalizedStep, snapPrecision)
	})

	// Finishes the active drag session and emits the committed end callback.
	const endInteraction = useEffectEvent((clientX?: number, clientY?: number) => {
		const draggingThumbIndex = dragThumbIndexRef.current

		if (draggingThumbIndex === null) return

		const dragFromThumb = dragFromThumbRef.current
		const dragMoved = dragMovedRef.current
		let nextValue = draftValueRef.current

		if (!dragFromThumb && clientX !== undefined && clientY !== undefined) {
			nextValue = valueFromPointer(clientX, clientY, draggingThumbIndex).value
			setInteractiveValue(nextValue)
		}

		dragPointerIdRef.current = null
		dragThumbIndexRef.current = null
		dragFromThumbRef.current = false
		dragMovedRef.current = false
		dragStartPointRef.current = null
		dragStartValueRef.current = draftValueRef.current
		setDraggingThumbIndex(null)

		if (!dragFromThumb || dragMoved) {
			onValueChangeEnd?.(nextValue as V)
		}
	})

	// Tracks pointer movement while a drag interaction is active.
	useEffect(() => {
		if (draggingThumbIndex === null) return

		function handlePointerMove(event: PointerEvent) {
			if (dragPointerIdRef.current !== null && event.pointerId !== dragPointerIdRef.current) return
			const draggingThumbIndex = dragThumbIndexRef.current

			if (draggingThumbIndex === null) return

			const moved = hasPointerMoved(dragStartPointRef.current, event.clientX, event.clientY)

			if (dragFromThumbRef.current && !moved) return

			dragMovedRef.current = dragMovedRef.current || moved
			const nextValue = dragFromThumbRef.current ? valueFromThumbDrag(event.clientX, event.clientY, draggingThumbIndex) : valueFromPointer(event.clientX, event.clientY, draggingThumbIndex).value
			setInteractiveValue(nextValue)
		}

		function handlePointerUp(event: PointerEvent) {
			if (dragPointerIdRef.current !== null && event.pointerId !== dragPointerIdRef.current) return
			endInteraction(event.clientX, event.clientY)
		}

		window.addEventListener('pointermove', handlePointerMove)
		window.addEventListener('pointerup', handlePointerUp)
		window.addEventListener('pointercancel', handlePointerUp)

		return () => {
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('pointerup', handlePointerUp)
			window.removeEventListener('pointercancel', handlePointerUp)
		}
	}, [draggingThumbIndex, endInteraction, setInteractiveValue, valueFromPointer, valueKey])

	// Starts a drag gesture from the slider track and snaps immediately to the pressed position.
	function handleTrackPointerDown(event: React.PointerEvent<HTMLDivElement>) {
		if (disabled || readOnly) return
		if (event.pointerType === 'mouse' && event.button !== 0) return

		event.preventDefault()
		const resolvedValue = valueFromPointer(event.clientX, event.clientY)
		dragPointerIdRef.current = event.pointerId
		dragThumbIndexRef.current = resolvedValue.thumbIndex
		dragFromThumbRef.current = false
		dragMovedRef.current = false
		dragStartPointRef.current = { x: event.clientX, y: event.clientY }
		dragStartValueRef.current = draftValueRef.current
		setDraggingThumbIndex(resolvedValue.thumbIndex)
		setActiveThumbIndex(resolvedValue.thumbIndex)
		setInteractiveValue(resolvedValue.value)
	}

	// Starts a thumb drag without changing the value until the pointer actually moves.
	function handleThumbPointerDown(event: React.PointerEvent<HTMLButtonElement>, thumbIndex: number) {
		if (disabled || readOnly) return
		if (event.pointerType === 'mouse' && event.button !== 0) return

		event.preventDefault()
		event.stopPropagation()
		dragPointerIdRef.current = event.pointerId
		dragThumbIndexRef.current = thumbIndex
		dragFromThumbRef.current = true
		dragMovedRef.current = false
		dragStartPointRef.current = { x: event.clientX, y: event.clientY }
		dragStartValueRef.current = draftValueRef.current
		setDraggingThumbIndex(thumbIndex)
		setActiveThumbIndex(thumbIndex)
	}

	// Updates the focused thumb from keyboard input without requiring a drag gesture.
	function handleThumbKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, thumbIndex: number) {
		if (disabled || readOnly) {
			if (readOnly && (event.key === ' ' || event.key === 'Spacebar')) {
				event.preventDefault()
			}

			return
		}

		const currentValue = draftValueRef.current
		const currentThumbValue = isRangeValue(currentValue) ? currentValue[thumbIndex] : currentValue
		let nextThumbValue = currentThumbValue

		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowUp':
				nextThumbValue = currentThumbValue + normalizedStep
				break
			case 'ArrowLeft':
			case 'ArrowDown':
				nextThumbValue = currentThumbValue - normalizedStep
				break
			case 'PageUp':
				nextThumbValue = currentThumbValue + normalizedStep * 10
				break
			case 'PageDown':
				nextThumbValue = currentThumbValue - normalizedStep * 10
				break
			case 'Home':
				nextThumbValue = minimumValue
				break
			case 'End':
				nextThumbValue = maximumValue
				break
			default:
				return
		}

		event.preventDefault()
		setActiveThumbIndex(thumbIndex)
		const snappedValue = snapValue(nextThumbValue, minimumValue, maximumValue, normalizedStep, snapPrecision)
		const nextValue = isRangeValue(currentValue) ? updateRangeValue(currentValue, thumbIndex, snappedValue) : snappedValue
		setInteractiveValue(nextValue)
		onValueChangeEnd?.(nextValue as V)
	}

	// Steps the nearest or active thumb from mouse-wheel input.
	function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
		onWheel?.(event)

		if (event.defaultPrevented || disabled || readOnly) return

		const delta = event.deltaY || event.deltaX
		const direction = -Math.sign(delta)

		if (direction !== 1 && direction !== -1) return

		event.preventDefault()
		const currentValue = draftValueRef.current
		const thumbIndex = isRangeValue(currentValue) ? valueFromPointer(event.clientX, event.clientY).thumbIndex : 0
		const currentThumbValue = isRangeValue(currentValue) ? currentValue[thumbIndex] : currentValue
		const nextThumbValue = currentThumbValue + direction * normalizedStep
		const snappedValue = snapValue(nextThumbValue, minimumValue, maximumValue, normalizedStep, snapPrecision)
		const nextValue = isRangeValue(currentValue) ? updateRangeValue(currentValue, thumbIndex, snappedValue) : snappedValue
		setActiveThumbIndex(thumbIndex)
		setInteractiveValue(nextValue)
		onValueChangeEnd?.(nextValue as V)
	}

	const renderedValue = draftValue
	const thumbValues = isRangeValue(renderedValue) ? renderedValue : [renderedValue]

	return (
		<div {...props} className={tw(styles.base(), className, disabled && 'opacity-40 cursor-not-allowed', readOnly && !disabled && 'opacity-90 pointer-events-none', classNames?.base)} ref={ref} style={style}>
			{content !== undefined && content !== null && <span className={tw(styles.label(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-200', classNames?.label)}>{content}</span>}
			<div className={tw(styles.body(), classNames?.body)}>
				{hasStartContent && <div className={tw(styles.content(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-400', classNames?.startContent)}>{startContent}</div>}
				<div
					className={tw(styles.control(), vertical ? sizeStyles.verticalControl : sizeStyles.horizontalControl, disabled ? 'bg-neutral-900/35' : readOnly ? 'bg-neutral-900/55' : 'bg-neutral-800 hover:bg-neutral-700 active:bg-neutral-600', classNames?.control)}
					onPointerDown={handleTrackPointerDown}
					onWheel={handleWheel}
					ref={controlRef}>
					<div className={tw(styles.fill(), 'bg-(--color-variant)', classNames?.fill)} style={fillStyle(renderedValue, minimumValue, maximumValue, vertical, sizeStyles.thumbRem)} />
					{thumbValues.map((thumbValue, index) => {
						const thumbRatio = valueToRatio(thumbValue, minimumValue, maximumValue)
						const thumb = resolveThumbContent(index, range, thumbContent, startThumbContent, endThumbContent)

						return (
							<button
								className={tw(styles.thumb(), disabled ? 'cursor-not-allowed text-neutral-400' : readOnly ? 'cursor-default text-neutral-500' : 'cursor-grab text-(--color-variant) active:cursor-grabbing', classNames?.thumb)}
								key={range ? `${index}-${thumbValue}` : 'slider-thumb'}
								onFocus={() => setActiveThumbIndex(index)}
								onKeyDown={(event) => handleThumbKeyDown(event, index)}
								onPointerDown={(event) => handleThumbPointerDown(event, index)}
								style={{ ...thumbPositionStyle(thumbRatio, vertical, sizeStyles.thumbRem), zIndex: activeThumbIndex === index ? 2 : 1 }}
								tabIndex={disabled ? -1 : 0}
								type='button'>
								<span className={tw(styles.thumbContent(), classNames?.thumbContent)}>{thumb}</span>
							</button>
						)
					})}
				</div>
				{hasEndContent && <div className={tw(styles.content(), disabled ? 'text-neutral-500' : readOnly ? 'text-neutral-300' : 'text-neutral-400', classNames?.endContent)}>{endContent}</div>}
			</div>
		</div>
	)
}
