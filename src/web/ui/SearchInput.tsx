import { Input, type InputProps } from '@heroui/react'
import { useState } from 'react'
import { Icons } from './Icon'

export interface SearchInputProps extends Omit<InputProps, 'isClearable' | 'startContent'> {
	minLengthToSearch?: number
}

export function SearchInput({ placeholder = 'Search', minLengthToSearch = 3, value, onValueChange, ...props }: SearchInputProps) {
	const [search, setSearch] = useState(value || '')

	function handleValueChange(value: string) {
		setSearch(value)

		if (value.length === 0 || value.length >= minLengthToSearch) {
			onValueChange?.(value)
		}
	}

	return <Input {...props} isClearable onValueChange={handleValueChange} placeholder={placeholder} startContent={<Icons.Search />} value={search} />
}
