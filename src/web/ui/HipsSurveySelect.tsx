import { SelectItem } from '@heroui/react'
import type { HipsSurvey } from 'nebulosa/src/hips2fits'
import { useEffect, useState } from 'react'
import { Api } from '@/shared/api'
import { FilterableSelect, type FilterableSelectProps } from './FilterableSelect'

export interface HipsSurveyProps extends Omit<FilterableSelectProps<HipsSurvey>, 'items' | 'children' | 'filter' | 'disallowEmptySelection' | 'isVirtualized' | 'itemHeight' | 'onSelectionChange' | 'renderValue' | 'selectedKeys' | 'value' | 'onValueChange' | 'selectionMode'> {
	readonly value?: string
	readonly onValueChange?: (value: string) => void
}

export function HipsSurveySelect({ isDisabled, onValueChange, value, ...props }: HipsSurveyProps) {
	const [items, setItems] = useState<HipsSurvey[]>(() => [])

	// Fetch the HipsSurvey items and update the state
	useEffect(() => {
		Api.Framing.hipsSurveys().then((hipsSurveys) => setItems(hipsSurveys ?? []))
	}, [])

	return (
		<FilterableSelect
			{...props}
			disallowEmptySelection
			filter={(item, search) => item.id.toLowerCase().includes(search) || item.regime.toLowerCase().includes(search)}
			isDisabled={isDisabled || items.length === 0}
			isVirtualized
			itemHeight={42}
			items={items}
			onSelectionChange={(value) => value && onValueChange?.((value as Set<string>).values().next().value as string)}
			renderValue={(selected) => selected.map((item) => <HipsSurveySelectItem item={item.data!} key={item.data!.id} />)}
			selectedKeys={new Set([value ?? ''])}
			selectionMode='single'
			size='sm'>
			{(item) => (
				<SelectItem key={item.id}>
					<HipsSurveySelectItem item={item} />
				</SelectItem>
			)}
		</FilterableSelect>
	)
}

export function HipsSurveySelectItem({ item }: { item: HipsSurvey }) {
	return (
		<div className='p-1 w-full flex flex-col justify-center gap-0'>
			<span className='font-bold whitespace-nowrap'>{item.id}</span>
			<span className='text-default-500 text-xs flex gap-1 items-center'>
				{item.regime} ({(item.skyFraction * 100).toFixed(1)}%)
			</span>
		</div>
	)
}
