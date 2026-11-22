import { expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { type CameraBottomViews, cameraBottomViewsEntry, chooseBottomView, followAutoFocus } from './bottomview'

test('a new Auto Focus session shows its curve once, and the operator choice then holds for that session', () => {
	const state = proxy<CameraBottomViews>({ views: {}, followed: {} })

	followAutoFocus(state, 'tab', 's1')
	expect(state.views.tab).toBe('curve')
	chooseBottomView(state, 'tab', 'frames')
	followAutoFocus(state, 'tab', 's1')
	expect(state.views.tab).toBe('frames')
	followAutoFocus(state, 'tab', 's2')
	expect(state.views.tab).toBe('curve')
})

test('the bottom views are restored without replacing what the page already set', () => {
	const state = proxy<CameraBottomViews>({ views: { a: 'guiding' }, followed: {} })
	const entry = cameraBottomViewsEntry(state)

	expect(entry.value()).toEqual({ views: { a: 'guiding' }, followed: {} })
	entry.restore({ views: { a: 'curve', b: 'pointing', c: 'unknown' }, followed: { b: 's1' } })
	expect(state.views).toEqual({ a: 'guiding', b: 'pointing' })
	expect(state.followed).toEqual({ b: 's1' })
	expect(cameraBottomViewsEntry(proxy<CameraBottomViews>({ views: {}, followed: {} })).value()).toBeUndefined()
})
