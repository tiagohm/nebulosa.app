import { ImageViewerStoreContext } from '@shared/context'
import { CfaPatternSelect } from '@ui/CfaPatternSelect'
import { Switch } from '@ui/components/Switch'
import { memo, useContext, useEffect } from 'react'
import { useSnapshot } from 'valtio'

export const ImageDebayer = memo(() => {
	const { debayer } = useContext(ImageViewerStoreContext)
	const { enabled, transformation } = useSnapshot(debayer.state)
	const { info } = useSnapshot(debayer.viewer.state)

	useEffect(debayer.mount, [])

	if (!info?.metadata.bayer) return <div className="flex h-full w-full flex-row items-center justify-center">Not supported</div>

	return (
		<div className="grid grid-cols-12 items-center gap-2 p-3">
			<Switch className="col-span-full min-w-0" label="Enabled" onValueChange={(value) => debayer.update('enabled', value)} value={enabled} />
			<CfaPatternSelect className="col-span-full min-w-0" fullWidth onValueChange={(value) => debayer.updateTransformation('cfaPattern', value)} value={transformation.cfaPattern} />
		</div>
	)
})
