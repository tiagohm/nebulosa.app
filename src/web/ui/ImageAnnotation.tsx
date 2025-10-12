import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageAnnotationMolecule } from '@/molecules/image/annotation'
import { Icons } from './Icon'
import { Modal } from './Modal'
import { TextButton } from './TextButton'

export const ImageAnnotation = memo(() => {
	const annotation = useMolecule(ImageAnnotationMolecule)
	const { loading } = useSnapshot(annotation.state)

	const Footer = (
		<>
			<TextButton color='success' isLoading={loading} label='Annotate' onPointerUp={annotation.annotate} startContent={<Icons.Check />} />
		</>
	)

	return (
		<Modal footer={Footer} header='Annotation' id={`annotation-${annotation.scope.image.key}`} maxWidth='200px' onHide={annotation.hide}>
			<div className='mt-0 grid grid-cols-12 gap-2'></div>
		</Modal>
	)
})
