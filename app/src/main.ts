import { homeArgument } from './home'

// Entry point of the application: applies the command line to the environment the api reads when it loads, then starts
// the server (server.ts). --home becomes NEBULOSA_HOME, which DEFAULT_DATA_DIRECTORY of api reads once, so every path of
// the server derives from it. The server is imported dynamically: a static import of api would be evaluated before
// this module's body, and the executable bundles api into chunks that load before it.

// Data directory --home names, when it names one.
const home = homeArgument(process.argv.slice(2), process.cwd())

if (home) process.env.NEBULOSA_HOME = home

await import('./server')
