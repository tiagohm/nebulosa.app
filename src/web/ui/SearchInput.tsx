import { useState } from 'react'
import { TextInput, type TextInputProps } from './components/TextInput'
import { Icons } from './Icon'

export interface SearchInputProps extends Omit<TextInputProps, 'startContent'> {
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

	return <TextInput onValueChange={handleValueChange} placeholder={placeholder} startContent={<Icons.Search />} value={search} {...props} />
}
