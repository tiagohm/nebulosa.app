import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AppDatabase } from './database'
import { equipmentKeyOf } from './guidingcalibration'
import { FIXTURE_EVIDENCE, fixtureCalibration } from './guidingcalibration.fixture'
import { GuidingCalibrationStore, MAX_GUIDING_CALIBRATIONS } from './guidingcalibration.store'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-guiding-calibrations-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const KEY = equipmentKeyOf(FIXTURE_EVIDENCE)

test('a saved calibration survives a restart of the server with its measurements', () => {
	const file = join(root, 'restart.sqlite')
	const first = new AppDatabase(file)
	const saved = fixtureCalibration('first', 1000)
	new GuidingCalibrationStore(first).insert(saved)
	first.close()

	const second = new AppDatabase(file)
	const store = new GuidingCalibrationStore(second)
	// As JSON keeps it, which writes -0 as 0.
	const read = JSON.parse(JSON.stringify(saved)) as typeof saved

	try {
		expect(store.list(undefined, 10)).toEqual([{ calibrationId: 'first', createdAt: 1000, equipmentKey: KEY, cameraName: 'Guide Camera', guideOutputName: 'Mount', mountName: 'Mount', sourceDeclination: saved.record.context.declination!, sourcePierSide: 'EAST', quality: saved.assessment.quality, disabled: false }])
		expect(store.get('first')).toEqual(read)
		expect(store.entries(KEY)).toEqual([read])
		expect(store.get('unknown')).toBeUndefined()
	} finally {
		second.close()
	}
})

test('disabling and using a calibration are the only changes of a row', () => {
	const store = new GuidingCalibrationStore(AppDatabase.memory())
	store.insert(fixtureCalibration('a', 1))

	expect(store.setDisabled('a', true)).toBeTrue()
	expect(store.get('a')).toMatchObject({ status: 'valid', disabled: true })
	expect(store.setDisabled('unknown', true)).toBeFalse()
	store.touch('a', 50)
	expect(store.list(KEY, 10)[0]).toMatchObject({ disabled: true, lastUsedAt: 50 })
	expect(store.get('a')).toMatchObject({ lastUsedAt: 50 })
})

test('keeps only the newest calibrations of each equipment', () => {
	const store = new GuidingCalibrationStore(AppDatabase.memory())
	for (let i = 0; i < MAX_GUIDING_CALIBRATIONS + 3; i++) store.insert(fixtureCalibration(`a${i}`, i))
	store.insert(fixtureCalibration('other', 0, { evidence: { ...FIXTURE_EVIDENCE, camera: { key: 'other-camera', name: 'Other' } } }))

	const kept = store.list(KEY, 100)
	expect(kept).toHaveLength(MAX_GUIDING_CALIBRATIONS)
	expect(kept[0].calibrationId).toBe(`a${MAX_GUIDING_CALIBRATIONS + 2}`)
	expect(kept.at(-1)!.calibrationId).toBe('a3')
	expect(store.list(undefined, 100)).toHaveLength(MAX_GUIDING_CALIBRATIONS + 1)
	expect(store.list(undefined, 2)).toHaveLength(2)
})

test('a row whose payload cannot be trusted is listed as invalid, never restored', () => {
	const database = AppDatabase.memory()
	const store = new GuidingCalibrationStore(database)
	store.insert(fixtureCalibration('singular', 1))
	store.insert(fixtureCalibration('future', 2))
	database.db.query("UPDATE guiding_calibrations SET payload = json_set(payload, '$.record.calibration.imageToAxis', json('[1, 0, 0, 1]')) WHERE calibration_id = 'singular'").run()
	database.db.query("UPDATE guiding_calibrations SET payload_version = 9 WHERE calibration_id = 'future'").run()

	expect(store.get('singular')).toMatchObject({ status: 'invalid', reason: 'the image-to-axis matrix is not the inverse of the image-motion matrix' })
	expect(store.get('future')).toMatchObject({ status: 'invalid', reason: 'unsupported payload version 9' })
})
