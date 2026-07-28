# Native Shell

A minimal native-sdk desktop app with a web frontend.

## Setup

`zig build dev`, `zig build run`, and `zig build package` install frontend dependencies automatically. To install them explicitly, run:

```sh
pnpm --dir frontend install
```

The generated build defaults to this Native SDK framework path:

```text
/Users/huozhi/code/was-das/node_modules/.pnpm/@native-sdk+cli@0.6.1/node_modules/@native-sdk/cli

```

Override it with `-Dnative-sdk-path=/path/to/native-sdk` if you move this app.

## Commands

```sh
zig build dev
zig build run
zig build test
zig build package
native doctor --manifest app.zon
```

`zig build dev` starts the frontend dev server from `app.zon`, waits for it, and launches the native shell with `NATIVE_SDK_FRONTEND_URL`.

Frontend:

- Type: next
- Production assets: `frontend/out`
- Dev URL: `http://127.0.0.1:3000/`

## Web Engines

The generated app defaults to the system WebView. On macOS you can switch to Chromium/CEF with:

```sh
native cef install
zig build run -Dplatform=macos -Dweb-engine=chromium
```

`native cef install` downloads Native SDK's prepared CEF runtime, including the native wrapper library.

For one-command local setup, opt into build-time install:

```sh
zig build run -Dplatform=macos -Dweb-engine=chromium -Dcef-auto-install=true
```

Use `-Dcef-dir=/path/to/cef` when you keep CEF outside the platform default under `third_party/cef`.

```sh
native doctor --web-engine chromium
```

Diagnostics:

- Set `NATIVE_SDK_LOG_DIR` to override the platform log directory during development.
- Set `NATIVE_SDK_LOG_FORMAT=text|jsonl` to choose persistent log format.
