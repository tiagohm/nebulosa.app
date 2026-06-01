import { type CSSProperties, memo, useContext, useLayoutEffect } from 'react'
import { tv } from 'tailwind-variants'
import { useSnapshot } from 'valtio'
import { IMAGE_ROI_HANDLES, type ImageRoiHandle } from '@/stores/image.roi.store'
import { ImageViewerStoreContext } from '../shared/context'

const HANDLE_STYLES = {
	n: { top: 0, left: '50%', transform: 'translate(-50%, -50%)' },
	ne: { top: 0, right: 0, transform: 'translate(50%, -50%)' },
	e: { top: '50%', right: 0, transform: 'translate(50%, -50%)' },
	se: { right: 0, bottom: 0, transform: 'translate(50%, 50%)' },
	s: { bottom: 0, left: '50%', transform: 'translate(-50%, 50%)' },
	sw: { bottom: 0, left: 0, transform: 'translate(-50%, 50%)' },
	w: { top: '50%', left: 0, transform: 'translate(-50%, -50%)' },
	nw: { top: 0, left: 0, transform: 'translate(-50%, -50%)' },
} satisfies Record<Exclude<ImageRoiHandle, 'move'>, CSSProperties>

const roiStyles = tv({
	slots: {
		root: 'roi pointer-events-auto absolute cursor-move touch-none border border-white bg-transparent',
		label: 'pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[11px] leading-4 font-semibold text-white shadow',
		handle: 'absolute h-3 w-3 rounded-full border-2 border-white bg-sky-500 transition-[background-color,box-shadow] hover:bg-sky-300 hover:shadow-[0_0_0_3px_rgba(56,189,248,0.45)] active:bg-sky-400',
	},
	variants: {
		handle: {
			n: { handle: 'cursor-n-resize' },
			ne: { handle: 'cursor-ne-resize' },
			e: { handle: 'cursor-e-resize' },
			se: { handle: 'cursor-se-resize' },
			s: { handle: 'cursor-s-resize' },
			sw: { handle: 'cursor-sw-resize' },
			w: { handle: 'cursor-w-resize' },
			nw: { handle: 'cursor-nw-resize' },
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
				<div className={roiStyles({ handle }).handle()} key={handle} onPointerDown={(event) => roi.startGesture(handle, event)} style={HANDLE_STYLES[handle]} />
			))}
		</div>
	)
})
