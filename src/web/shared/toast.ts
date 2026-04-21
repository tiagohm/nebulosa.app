import type * as React from 'react'
import type { ClassValue } from 'tailwind-variants'
import { tw } from './util'

export const TOAST_PLACEMENTS = ['top-start', 'top', 'top-end', 'bottom-start', 'bottom', 'bottom-end'] as const

const DEFAULT_TOAST_COLOR = 'primary'
const DEFAULT_TOAST_DELAY = 2000
const DEFAULT_TOAST_PLACEMENT = 'top-end'
const DEFAULT_TOAST_SIZE = 'md'

export type ToastDefaults = Pick<ToastRecord, 'color' | 'delay' | 'placement' | 'size'>
export type ToastPlacement = (typeof TOAST_PLACEMENTS)[number]
export type ToastColor = 'primary' | 'secondary' | 'success' | 'warning' | 'danger'
export type ToastSize = 'sm' | 'md' | 'lg'

export interface ToastOptions extends Omit<React.ComponentPropsWithoutRef<'div'>, 'children' | 'color' | 'title' | 'className'> {
	readonly className?: ClassValue
	readonly title?: React.ReactNode
	readonly description?: React.ReactNode
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
	readonly color?: ToastColor
	readonly size?: ToastSize
	readonly placement?: ToastPlacement
	readonly delay?: number
	readonly onClose?: (autoDismiss: boolean) => void
}

export interface ToastProviderDefaults extends Partial<ToastOptions> {}

export interface ToastRecord extends ToastOptions {
	readonly id: string
	readonly color: ToastColor
	readonly delay: number
	readonly placement: ToastPlacement
	readonly size: ToastSize
}

let toastSequence = 0
let toastEntries: readonly ToastRecord[] = []
let toastDefaults: ToastProviderDefaults = {
	color: DEFAULT_TOAST_COLOR,
	delay: DEFAULT_TOAST_DELAY,
	placement: DEFAULT_TOAST_PLACEMENT,
	size: DEFAULT_TOAST_SIZE,
}

const toastListeners = new Set<VoidFunction>()

// Broadcasts the current toast list to every mounted provider.
function emitToastChange() {
	for (const listener of toastListeners) {
		listener()
	}
}

// Creates a stable in-memory toast identifier.
function nextToastId() {
	return `toast-${++toastSequence}`
}

// Resolves the complete toast payload from provider defaults and toast overrides.
function resolveToastRecord(options: ToastOptions): ToastRecord {
	const mergedOptions = { ...toastDefaults, ...options, className: tw(toastDefaults.className, options.className) }

	return {
		...mergedOptions,
		id: nextToastId(),
		color: mergedOptions.color ?? DEFAULT_TOAST_COLOR,
		delay: mergedOptions.delay ?? DEFAULT_TOAST_DELAY,
		placement: mergedOptions.placement ?? DEFAULT_TOAST_PLACEMENT,
		size: mergedOptions.size ?? DEFAULT_TOAST_SIZE,
	}
}

// Reads the immutable toast snapshot for useSyncExternalStore consumers.
export function readToasts() {
	return toastEntries
}

// Subscribes a mounted provider to toast list updates.
export function subscribeToasts(listener: VoidFunction) {
	toastListeners.add(listener)

	return () => {
		toastListeners.delete(listener)
	}
}

// Updates the provider-backed defaults used by future toast() calls.
export function updateToastDefaults(defaults: ToastProviderDefaults) {
	toastDefaults = {
		color: DEFAULT_TOAST_COLOR,
		delay: DEFAULT_TOAST_DELAY,
		placement: DEFAULT_TOAST_PLACEMENT,
		size: DEFAULT_TOAST_SIZE,
		...defaults,
	}
}

// Enqueues a new toast and returns its generated identifier.
export function toast(options: ToastOptions) {
	const nextToast = resolveToastRecord(options)
	toastEntries = [nextToast, ...toastEntries]
	emitToastChange()
	return nextToast.id
}

// Removes a toast and runs its close callback once the toast disappears.
export function dismissToast(id: string, autoDismiss: boolean) {
	const nextToast = toastEntries.find((toast) => toast.id === id)

	if (!nextToast) return

	toastEntries = toastEntries.filter((toast) => toast.id !== id)
	emitToastChange()
	nextToast.onClose?.(autoDismiss)
}

// Reads the current provider defaults for callers that need them.
export function readToastDefaults() {
	return toastDefaults
}

export const DEFAULT_TOAST_DEFAULTS: ToastDefaults = {
	color: DEFAULT_TOAST_COLOR,
	delay: DEFAULT_TOAST_DELAY,
	placement: DEFAULT_TOAST_PLACEMENT,
	size: DEFAULT_TOAST_SIZE,
}
