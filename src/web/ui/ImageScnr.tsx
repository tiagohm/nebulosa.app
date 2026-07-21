import { ImageViewerStoreContext } from '@shared/context'
import { Button } from '@ui/components/Button'
import { NumberInput } from '@ui/components/NumberInput'
import { Icons } from '@ui/Icon'
import { ImageChannelButtonGroup } from '@ui/ImageChannelButtonGroup'
import { SCNRProtectionMethodSelect } from '@ui/SCNRProtectionMethodSelect'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageScnr = memo(() => {
	const { scnr } = useContext(ImageViewerStoreContext)
	const { method, amount, channel } = useSnapshot(scnr.state.scnr)
	const { info } = useSnapshot(scnr.viewer.state)
	const hasChannel = channel !== undefined

	useEffect(scnr.mount, [])

	if (!info || info.mono) return <div className="flex h-full w-full flex-row items-center justify-center">Not supported</div>

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<ImageChannelButtonGroup allowNoneSelection className="col-span-full min-w-0" fullWidth onValueChange={(value) => scnr.update('channel', value)} value={channel} />
			<SCNRProtectionMethodSelect className="col-span-8 min-w-0" disabled={!hasChannel} fullWidth onValueChange={(value) => scnr.update('method', value)} value={method} />
			<NumberInput className="col-span-4 min-w-0" fractionDigits={1} label="Amount" maxValue={1} minValue={0} onValueChange={(value) => scnr.update('amount', value)} step={0.1} value={amount} />
			<Footer />
		</div>
	)
})

const Footer = memo(() => {
	const { scnr } = useContext(ImageViewerStoreContext)

	return (
		<div className="col-span-full flex flex-row items-center justify-end gap-2">
			<Button color="danger" label="Reset" onClick={scnr.reset} startContent={<Icons.Restore />} />
			<Button color="success" label="Apply" onClick={scnr.apply} startContent={<Icons.Check />} />
		</div>
	)
})
