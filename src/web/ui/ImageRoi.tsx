import { memo, useContext, useLayoutEffect } from 'react'
import { tv } from 'tailwind-variants'
import { useSnapshot } from 'valtio'
import { IMAGE_ROI_HANDLES } from '@/stores/image.roi.store'
import { ImageViewerStoreContext } from '../shared/context'

const roiStyles = tv({
	slots: {
		root: 'roi pointer-events-auto absolute cursor-move touch-none border border-white bg-transparent',
		label: 'pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[11px] leading-4 font-semibold text-white shadow',
		handle: 'absolute h-4 w-4 touch-none rounded-full border-2 border-white bg-sky-500 transition-[background-color,box-shadow] select-none hover:bg-sky-300 hover:shadow-[0_0_0_3px_rgba(56,189,248,0.45)] active:bg-sky-400',
	},
	variants: {
		handle: {
			n: { handle: 'cursor-n-resize top-0 left-1/2 -translate-1/2' },
			ne: { handle: 'cursor-ne-resize top-0 right-0 translate-x-1/2 -translate-y-1/2' },
			e: { handle: 'cursor-e-resize top-1/2 right-0 translate-x-1/2 -translate-y-1/2' },
			se: { handle: 'cursor-se-resize right-0 bottom-0 translate-1/2' },
			s: { handle: 'cursor-s-resize bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2' },
			sw: { handle: 'cursor-sw-resize bottom-0 left-0 -translate-x-1/2 translate-y-1/2' },
			w: { handle: 'cursor-w-resize top-1/2 left-0 -translate-1/2' },
			nw: { handle: 'cursor-nw-resize top-0 left-0 -translate-1/2' },
		},
	},
})

const styles = roiStyles()

export const ImageRoi = memo(() => {
	const viewer = useContext(ImageViewerStoreContext)
	const { roi } = viewer
	const { visible } = useSnapshot(roi.state)

	useLayoutEffect(roi.sync, [roi, visible])

	if (!visible) return null

	return (
		<div className={styles.root()} onPointerDown={(event) => roi.startGesture('move', event)} ref={roi.attachRoot}>
			<div className={styles.label()} ref={roi.attachLabel} />
			{IMAGE_ROI_HANDLES.map((handle) => (
				<div className={roiStyles({ handle }).handle()} key={handle} onPointerDown={(event) => roi.startGesture(handle, event)} />
			))}
		</div>
	)
})
