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

## Status

This package is the **glue** between two upstream artifacts from the
[`hew-lang/hew`](https://github.com/hew-lang/hew) monorepo:

| Upstream | Role | Published as |
| --- | --- | --- |
| `hew-sandbox-wasm` | wasm compiler: parse + type-check + fail-closed profile gate, emits `hew.sandbox.bytecode.v0` | `@hew-lang/sandbox-wasm` |
| `hew-sandbox-vm` | deterministic TS interpreter: `runBytecode` + `buildPlaygroundState` | `@hew-lang/sandbox-vm` |

Inject `compiler` and `interpreter` implementations yourself, or call
`loadPublishedSandbox()` to dynamically import and initialize the published
upstreams.

## Usage

```ts
import { HewSandboxClient, loadPublishedSandbox } from '@hew-lang/playground-sandbox';

const client = new HewSandboxClient(await loadPublishedSandbox());

const result = await client.run('fn main() { println("hi"); }', { seed: 1 });
if (result.success) {
  console.log(result.stdout);
} else {
  console.error(result.status, result.diagnostics);
}
```

You can still inject custom ports directly:

```ts
const client = new HewSandboxClient({
  compiler,     // implements compileToSandboxBytecode(source, profile)
  interpreter,  // implements runBytecode(pkg) [+ buildPlaygroundState(trace)]
});
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
| `loadPublishedSandbox()` | Default wiring for the published upstream packages. |
| `isPlaygroundSandboxError(e)` | Type guard for `PlaygroundSandboxError`. |
| `SANDBOX_BYTECODE_SCHEMA_VERSION`, `DEFAULT_SANDBOX_PROFILE` | Constants. |

Exported types: `HewSandboxClientOptions`, `SandboxRunOptions`,
`SandboxRunResult`, `SandboxCompiler`, `SandboxInterpreter`, `CompileOutput`,
`SandboxBytecodePackage`, `SandboxDiagnostic`, `SandboxTrace`, `PlaygroundState`,
`SandboxRuntimeStatus`, `PlaygroundSandboxError`, `SandboxBytecodeVersionError`.

## Installing from GitHub Packages

This package is published to **GitHub Packages**, the canonical registry for the
`@hew-lang` scope (it is not on npmjs — it depends on the GitHub-Packages-only
`@hew-lang/sandbox-wasm` and `@hew-lang/sandbox-vm`). Point the scope at GitHub
Packages in an `.npmrc` (GitHub Packages requires an authenticated token — a
`read:packages` PAT — even for installs):

```ini
@hew-lang:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

## License

MIT License. Copyright (c) 2026 Stephen Olesen.
