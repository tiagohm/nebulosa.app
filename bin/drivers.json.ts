import { write } from 'bun'

const DRIVER_REGEX = /<driver name="([^"]+)">([^<]+)<\/driver>/g

let response = await fetch('https://raw.githubusercontent.com/indilib/indi/refs/heads/master/drivers.xml')
let text = await response.text()

response = await fetch('https://raw.githubusercontent.com/KDE/kstars/refs/heads/master/kstars/data/indidrivers.xml')
text += await response.text()

const drivers = Array.from(text.matchAll(DRIVER_REGEX)).map(([, name, driver]) => ({ name, driver }))
const duplicated = new Set<string>()
const res: { name: string; driver: string }[] = []

for (const { name, driver } of drivers) {
	if (duplicated.has(name) || duplicated.has(driver)) continue

	duplicated.add(name)
	duplicated.add(driver)

	res.push({ name, driver })
}

res.sort((a, b) => a.name.localeCompare(b.name))

await write('data/drivers.json', JSON.stringify(res, null, 2))
