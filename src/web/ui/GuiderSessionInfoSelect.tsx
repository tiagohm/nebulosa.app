import { ListItem } from '@ui/components/List'
import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { GuiderSessionInfo } from '#/guider'

export interface GuiderSessionInfoSelectProps extends Omit<SelectProps<GuiderSessionInfo>, 'children' | 'onAction' | 'isItemEqual'> {}

function isGuiderSessionInfoEqual(a: GuiderSessionInfo, b: GuiderSessionInfo) {
	return a.id === b.id || a.key === b.key
}

export function GuiderSessionInfoSelect(props: GuiderSessionInfoSelectProps) {
	return (
		<Select isItemEqual={isGuiderSessionInfoEqual} {...props}>
			{GuiderSessionInfoItem}
		</Select>
	)
}

function GuiderSessionInfoItem(item: GuiderSessionInfo) {
	return <ListItem description={item.mode} label={item.target} />
}
