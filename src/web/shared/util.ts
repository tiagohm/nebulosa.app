import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { ONE_GIGAPARSEC, ONE_KILOPARSEC, ONE_MEGAPARSEC } from 'nebulosa/src/core/constants'
import { toKilometer, toLightYear } from 'nebulosa/src/math/units/distance'
import type { Distance } from 'nebulosa/src/math/units/distance'
import { twMerge } from 'tailwind-merge'

export function tw(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

export function assignRef<T>(ref: React.Ref<T> | undefined, value: T) {
	if (typeof ref === 'function') {
		ref(value)
	} else if (ref) {
		ref.current = value
	}
}

export function hasRootInteraction(props: React.DOMAttributes<HTMLElement>) {
	return props.onClick !== undefined || props.onPointerDown !== undefined || props.onPointerUp !== undefined || props.onDoubleClick !== undefined || props.onContextMenu !== undefined
}

export function activityMode(visible: boolean | undefined | null) {
	return visible === true ? 'visible' : 'hidden'
}

export function formatNumber(value: number | undefined | null, fractionDigits: number) {
	return value !== undefined && value !== null && Number.isFinite(value) ? value.toFixed(fractionDigits) : '--'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

export function finiteNumber(value: unknown, fallback: number) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// Clamps a number into the inclusive [min, max] range.
export function clamp(value: number, min: number, max: number) {
	if (!(value >= min)) return min // handles NaN value
	if (value > max) return max
	return value
}

// Clamps a number into an integer range.
export function clampInteger(value: number, min: number, max: number) {
	if (max < min) return min
	if (!Number.isFinite(value)) return min
	return Math.max(min, Math.min(Math.trunc(value), max))
}

// Stops the propagation of an event to parent elements
export function stopPropagation(event: Event | React.BaseSyntheticEvent<Event>) {
	event.stopPropagation()
}

// Stops the propagation of an event to parent elements and
// prevents the default action of an event if it is cancelable
export function stopPropagationAndPreventDefault(event: Event | React.BaseSyntheticEvent<Event>) {
	stopPropagation(event)
	preventDefault(event)
}

const EVENTS = ['onClick', 'onPointerUp', 'onPointerDown'] as const

export function stopPropagationForAll<P extends React.DOMAttributes<HTMLElement>>(props?: P): P | undefined {
	if (props === undefined) return

	for (const event of EVENTS) {
		const callback = props[event]

		if (callback !== undefined) {
			props[event] = function (event) {
				stopPropagation(event)
				callback(event as never)
			}
		}
	}

	return props
}

// Prevents the default action of an event if it is cancelable
export function preventDefault(event: Event | React.BaseSyntheticEvent<Event>) {
	event.cancelable && event.preventDefault()
}

// Checks if the Wake Lock API is supported
export function isWakeLockSupported() {
	return 'wakeLock' in navigator
}

// Checks if device like a mouse or a similar accurate pointing device is present.
export function isMouseDeviceSupported() {
	return matchMedia('(pointer:fine)').matches
}

export function saveAs(blob: Blob | MediaSource, name: string) {
	const url = URL.createObjectURL(blob)

	const a = document.createElement('a')
	a.href = url
	a.download = name

	try {
		document.body.append(a)
		a.click()
	} finally {
		URL.revokeObjectURL(url)
		a.remove()
	}
}

export function isObject(value: unknown): value is object {
	if (value === null) return false
	const type = typeof value
	return type === 'object'
}

function assignKey<T extends {}>(to: T, from: T, key: keyof T & string) {
	var value = from[key]

	if (value === undefined || value === null || !isObject(to)) {
		return
	}

	if (Object.hasOwnProperty.call(to, key) && isObject(value) && !Array.isArray(value)) {
		to[key] = deepAssign(to[key] as never, from[key] as never)
	} else {
		to[key] = value
	}
}

export function deepAssign<T extends {}>(to: T, from: Partial<T>) {
	if (to === from) {
		return to
	}

	for (const key in from) {
		if (Object.hasOwnProperty.call(from, key)) {
			assignKey(to, from, key)
		}
	}

	return to
}

// Deletes undefined or null properties
export function deleteUndefinedOrNull<T extends object>(o: T): T {
	for (const [key, value] of Object.entries(o)) {
		if (value === undefined || value === null) {
			delete (o as Record<string, unknown>)[key]
		}
	}

	return o
}

// Formats a distance value into a human-readable string with appropriate units
export function formatDistance(distance: Distance) {
	if (distance <= 0) return '0'
	if (distance >= ONE_GIGAPARSEC) return `${(distance / ONE_GIGAPARSEC).toFixed(2)} Gpc`
	if (distance >= ONE_MEGAPARSEC) return `${(distance / ONE_MEGAPARSEC).toFixed(2)} Mpc`
	if (distance >= ONE_KILOPARSEC) return `${(distance / ONE_KILOPARSEC).toFixed(2)} kpc`
	if (distance >= 63241.077084266280268653583182) return `${toLightYear(distance).toFixed(2)} ly`
	if (distance >= 1) return `${distance.toFixed(3)} AU`
	return `${toKilometer(distance).toFixed(0)} km`
}
