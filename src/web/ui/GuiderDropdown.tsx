import { equipmentStore } from '@stores/equipment.store'
import { homeStore } from '@stores/home.store'
import { Dropdown, DropdownItem } from '@ui/components/Dropdown'
import type { DropdownProps } from '@ui/components/Dropdown'
import { IconButton } from '@ui/components/IconButton'
import { Icons } from '@ui/Icon'
import type { Icon } from '@ui/Icon'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import type { GuiderSessionInfo } from '#/guider'

export interface GuiderDropdownProps extends Omit<DropdownProps, 'children' | 'onAction'> {
	readonly value?: GuiderSessionInfo
	readonly onValueChange?: (value?: GuiderSessionInfo) => void
	readonly disallowNoneSelection?: boolean
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
	readonly icon?: Icon
}

function GuiderItem(guider: GuiderSessionInfo | undefined) {
	const key = guider?.id ?? 'none'

	return <DropdownItem key={key} label={guider?.target ?? 'None'} startContent={<GuiderDropdownStartContent isConnected={guider?.connected} />} endContent={guider && <GuiderDropdownEndContent guider={guider} />} />
}

export function GuiderDropdown({ value, onValueChange, disabled, disallowNoneSelection = false, label, showLabel = false, showLabelOnEmpty = showLabel, color, startContent, icon: Icon, ...props }: GuiderDropdownProps) {
	const state = equipmentStore.state.guider
	const length = useSnapshot(state).length

	const items = new Array<GuiderSessionInfo | undefined>(length + (disallowNoneSelection ? 0 : 1))

	let i = 0
	if (!disallowNoneSelection) items[i++] = undefined
	for (let p = 0; p < length; i++, p++) items[i] = state[p]

	function handleAction(index: number) {
		if (index < 0 || index >= items.length) return

		const guider = items[index]

		if (guider === undefined) {
			onValueChange?.(undefined)
		} else {
			const currentguider = state.find((e) => e.id === guider.id)
			if (currentguider) onValueChange?.(currentguider)
		}
	}

	return (
		<Dropdown
			label={showLabel ? (value?.target ?? (showLabelOnEmpty ? (label ?? 'None') : undefined)) : undefined}
			color={color ?? (value === undefined ? 'secondary' : value.connected ? 'success' : 'danger')}
			disabled={disabled || items.length === 0}
			onAction={handleAction}
			startContent={startContent ?? (Icon ? <Icon /> : undefined)}
			{...props}>
			{items.map(GuiderItem)}
		</Dropdown>
	)
}

function guiderStatusColor(isConnected: boolean | undefined) {
	return isConnected === undefined ? 'var(--secondary)' : isConnected ? 'var(--success)' : 'var(--danger)'
}

const GuiderDropdownStartContent = memo(({ isConnected }: { readonly isConnected: boolean | undefined }) => <Icons.Circle color={guiderStatusColor(isConnected)} />)

interface GuiderDropdownEndContentProps {
	readonly guider: GuiderSessionInfo
}

const GuiderDropdownEndContent = memo(({ guider }: GuiderDropdownEndContentProps) => (
	<div className="flex flex-row items-center gap-2">
		<IconButton color="secondary" icon={Icons.OpenInNew} tooltipContent="Open" onClick={() => homeStore.addGuider()} size="sm" />
	</div>
))
