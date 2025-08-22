// <driver name="LX200 Basic">indi_lx200basic</driver>
const DRIVER_REGEX = /<driver name="([^"]+)">([^<]+)<\/driver>/g

const response = await fetch('https://raw.githubusercontent.com/indilib/indi/refs/heads/master/drivers.xml')
const text = await response.text()

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

await Bun.write('data/drivers.json', JSON.stringify(res, null, 2))
