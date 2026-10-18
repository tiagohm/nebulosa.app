# Nebulosa

[![Active Development](https://img.shields.io/badge/Maintenance%20Level-Actively%20Developed-brightgreen.svg)](https://gist.github.com/cheerfulstoic/d107229326a01ff0f333a1d3476e068d)
[![Test](https://github.com/tiagohm/nebulosa.app/actions/workflows/test.yml/badge.svg)](https://github.com/tiagohm/nebulosa.app/actions/workflows/test.yml)

Nebulosa is an integrated astronomical imaging application built with Bun, React, and the [`nebulosa`](https://github.com/tiagohm/nebulosa.ts) TypeScript astronomy toolkit. It combines a local web UI, Bun API server, device-control handlers, and image-processing workflows for capture, planning, solving, and analysis.

## Development

```sh
git clone --recurse-submodules https://github.com/tiagohm/nebulosa.app
bun i
```

| Command       | Description                                        |
| ------------- | -------------------------------------------------- |
| `bun dev`     | Starts the server with hot reload and frontend HMR |
| `bun start`   | Starts the server in production mode               |
| `bun compile` | Builds the standalone executable into `.dist/`     |
| `bun lint`    | Type-checks and Lints the project                  |
| `bun fmt`     | Formats the project                                |
| `bun test`    | Runs the tests                                     |

Workspaces:

- `core`: [`nebulosa`](https://github.com/tiagohm/nebulosa.ts) astronomy toolkit (git submodule)
- `api`: Bun backend
- `web`: React frontend
- `app`: Bundles `api` and `web` into a single server and executable
