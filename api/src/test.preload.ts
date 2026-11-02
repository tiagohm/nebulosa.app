import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Preloaded by bun test before any test file: points the data directory of the server to a temporary directory of
// the test process, removed when it exits, so nothing a test opens through a default path reaches ~/Nebulosa.

// Data directory of the tests of this process.
const directory = mkdtempSync(join(tmpdir(), 'nebulosa-home-'))
process.env.NEBULOSA_HOME = directory
process.once('exit', () => rmSync(directory, { recursive: true, force: true }))
