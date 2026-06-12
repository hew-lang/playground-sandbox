# @hew-lang/playground-sandbox

Local / in-browser execution client for Hew. It is the complement to
[`@hew-lang/playground-client`](https://github.com/hew-lang/playground-client):
where that package runs code **remotely over HTTP**, this one executes Hew
**entirely on the client**, deterministically, with no server.

```
                 ┌─────────────────────────────┐
  remote  ──────▶│ @hew-lang/playground-client │──▶ livecode-v1.hew.sh
                 └─────────────────────────────┘
                 ┌─────────────────────────────┐   compile        interpret
  local   ──────▶│ @hew-lang/playground-sandbox│──▶ sandbox-wasm ─▶ sandbox-vm
                 └─────────────────────────────┘   (bytecode v0)   (SandboxTrace)
```

## Status — milestone 0 (pre-wiring)

This package is the **glue** between two upstream artifacts from the
[`hew-lang/hew`](https://github.com/hew-lang/hew) monorepo:

| Upstream | Role | Published as |
| --- | --- | --- |
| `hew-sandbox-wasm` | wasm compiler: parse + type-check + fail-closed profile gate, emits `hew.sandbox.bytecode.v0` | `@hew-lang/sandbox-wasm` *(pending)* |
| `hew-sandbox-vm` | deterministic TS interpreter: `runBytecode` + `buildPlaygroundState` | `@hew-lang/sandbox-vm` *(pending)* |

Those two packages are **not published yet**. Until they are, inject the
`compiler` and `interpreter` implementations yourself (see below). The port
interfaces in this package mirror the upstream public surfaces, so the default
wiring becomes a drop-in once they ship — at which point
`loadPublishedSandbox()` will dynamically import and initialize them instead of
throwing.

## Usage

```ts
import { HewSandboxClient } from '@hew-lang/playground-sandbox';

// Inject the upstream compiler + interpreter (until they publish on npm):
const client = new HewSandboxClient({
  compiler,     // implements compileToSandboxBytecode(source, profile)
  interpreter,  // implements runBytecode(pkg) [+ buildPlaygroundState(trace)]
});

const result = await client.run('fn main() { println("hi"); }', { seed: 1 });
if (result.success) {
  console.log(result.stdout);
} else {
  console.error(result.status, result.diagnostics);
}
```

The `success` / `stdout` / `stderr` / `exit_code` fields mirror
`@hew-lang/playground-client`'s `RunResponse`, so a UI can treat remote and
local execution uniformly. `status`, `trace`, and `state` are sandbox-only
extensions (the full deterministic trace and the playground view model).

## Bytecode version contract

The compiler emits `hew.sandbox.bytecode.v0`; the interpreter declares the
version it understands. `run()` checks them and throws
`SandboxBytecodeVersionError` on a mismatch rather than producing wrong output —
upgrade `@hew-lang/sandbox-wasm` and `@hew-lang/sandbox-vm` together. Override
the expected version via the `expectedBytecodeVersion` client option.

## API overview

| Export | Description |
| --- | --- |
| `HewSandboxClient` | Client with `run(source, options)`. |
| `createHewSandboxClient(options)` | Factory helper. |
| `loadPublishedSandbox()` | Default wiring (throws until upstreams publish). |
| `isPlaygroundSandboxError(e)` | Type guard for `PlaygroundSandboxError`. |
| `SANDBOX_BYTECODE_SCHEMA_VERSION`, `DEFAULT_SANDBOX_PROFILE` | Constants. |

Exported types: `HewSandboxClientOptions`, `SandboxRunOptions`,
`SandboxRunResult`, `SandboxCompiler`, `SandboxInterpreter`, `CompileOutput`,
`SandboxBytecodePackage`, `SandboxDiagnostic`, `SandboxTrace`, `PlaygroundState`,
`SandboxRuntimeStatus`, `PlaygroundSandboxError`, `SandboxBytecodeVersionError`.

## Installing from GitHub Packages

npmjs is the canonical registry; the same versions are mirrored to GitHub
Packages. To install from the mirror, point the `@hew-lang` scope at the GitHub
npm registry in an `.npmrc` (GitHub Packages requires an authenticated token,
even for installs):

```ini
@hew-lang:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## License

MIT License. Copyright (c) 2026 Stephen Olesen.
