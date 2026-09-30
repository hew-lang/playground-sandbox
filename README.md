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
  local   ──────▶│ @hew-lang/playground-sandbox│──▶ hew-wasm ─▶ sandbox-vm
                 └─────────────────────────────┘   (verified SIR)   (SandboxTrace)
```

## Status

This package is the **glue** between two upstream artifacts from the
[`hew-lang/hew`](https://github.com/hew-lang/hew) monorepo:

| Upstream | Role | Published as |
| --- | --- | --- |
| `hew-wasm` | Wasm compiler: native front end and verified SIR lowering, emits `hew.sandbox.bytecode.v1` | `@hew-lang/wasm` |
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

In a Vite-based browser application, pass the emitted asset URL so the compiler
Wasm is included in the build:

```ts
import wasmUrl from '@hew-lang/wasm/wasm_bg.wasm?url';
const client = new HewSandboxClient(await loadPublishedSandbox({ wasmUrl }));
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

The VM validates the compiler package before executing it. Upgrade
`@hew-lang/wasm` and `@hew-lang/sandbox-vm` together. This client passes
packages through to that authority rather than maintaining another schema gate.

`result.sandbox_rejections` distinguishes native capabilities from missing VM
implementation and invalid packages. `isNativeOnlyRefusal(result)` is true only
when every rejection is a native capability. A UI may then offer an explicit
**Run remotely** action. Compiler errors and VM defects must remain visible;
remote execution is never an automatic fallback.

## API overview

| Export | Description |
| --- | --- |
| `HewSandboxClient` | Client with `run(source, options)`. |
| `createHewSandboxClient(options)` | Factory helper. |
| `loadPublishedSandbox()` | Default wiring for the published upstream packages. |
| `isPlaygroundSandboxError(e)` | Type guard for `PlaygroundSandboxError`. |
| `DEFAULT_SANDBOX_PROFILE` | Default compiler profile. |

Exported types: `HewSandboxClientOptions`, `SandboxRunOptions`,
`SandboxRunResult`, `SandboxCompiler`, `SandboxInterpreter`, `CompileOutput`,
`SandboxBytecodePackage`, `SandboxDiagnostic`, `SandboxTrace`, `PlaygroundState`,
`SandboxRuntimeStatus`, `SandboxRejection`, `PlaygroundSandboxError`.

## Installing from GitHub Packages

This package is published to **GitHub Packages**, the canonical registry for the
`@hew-lang` scope (it is not on npmjs — it depends on the GitHub-Packages-only
`@hew-lang/wasm` and `@hew-lang/sandbox-vm`). Point the scope at GitHub
Packages in an `.npmrc` (GitHub Packages requires an authenticated token — a
`read:packages` PAT — even for installs):

```ini
@hew-lang:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

## License

MIT License. Copyright (c) 2026 Stephen Olesen.
