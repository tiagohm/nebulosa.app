import { Button } from './components/Button'
import { TextInput } from './components/TextInput'
import { Icons } from './Icon'

export function Demo() {
	return (
		<div className='w-full flex flex-row flex-wrap gap-2 p-4'>
			<Button label='Ghost' variant='ghost' />
			<Button label='Outline' variant='outline' />
			<Button color='danger' label='Solid' variant='solid' />
			<Button color='secondary' label='Secondary' variant='solid' />
			<Button color='success' label='Success' variant='solid' />
			<Button color='warning' label='Warning' variant='solid' />
			<Button label='Icon at Start' size='sm' startContent={<Icons.Filter />} variant='flat' />
			<Button endContent={<Icons.Heart />} label='Icon at End' size='md' />
			<Button endContent={<Icons.Heart />} label='Two Icons' size='lg' startContent={<Icons.Filter />} />
			<Button disabled label='Disabled' />
			<Button label='Loading' loading tooltipContent='This button has a tooltip!' />
			<TextInput fireOnEnter label='Name' onValueChange={alert} />
		</div>
	)
}
