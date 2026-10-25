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

This release pins both published engines to Hew 0.9.3 and supplies their shared
codec bridge for JSON, TOML and YAML values, plus typed JSON and CBOR messages.
Native-only operations
remain explicit capability refusals in the browser; remote execution is a
separate user choice.

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
  interpreter,  // implements runBytecode(pkg), which may return a Promise [+ buildPlaygroundState(trace)]
});
```

The `success` / `stdout` / `stderr` / `exit_code` fields mirror
`@hew-lang/playground-client`'s `RunResponse`, so a UI can treat remote and
local execution uniformly. `status`, `trace`, and `state` are sandbox-only
extensions (the full deterministic trace and the playground view model).

`run()` awaits the interpreter before reading the trace or building UI state.
Injected interpreters may return a trace or a Promise; both use that single
execution path. Compiler diagnostics, related notes and suggestions are passed
through unchanged for the UI to present.

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
`SandboxBytecodePackage`, `SandboxDiagnostic`, `SandboxDiagnosticNote`, `SandboxTrace`, `PlaygroundState`,
`SandboxRuntimeStatus`, `SandboxRejection`, `PlaygroundSandboxError`.

## Install

Install the compiled archive from the versioned public release:

```bash
npm install https://github.com/hew-lang/playground-sandbox/releases/download/v0.3.8/hew-lang-playground-sandbox-0.3.8.tgz
```

The archive includes JavaScript and TypeScript declarations. Its compiler and VM
dependencies are available on public npm; no GitHub package token is required.
Remove any older `@hew-lang` override to GitHub Packages, or point it at
`https://registry.npmjs.org/`. Commit your package-manager lockfile to pin archive
integrity. The release also includes `SHA256SUMS`.

## Release archives

After publication approval, tag a version matching `package.json`. The **Release**
workflow checks the exact tag/version, installs and tests using public engine
archives with the same locked integrity, and publishes the compiled SDK archive
and `SHA256SUMS` with the release notes. The build does not need package-registry
credentials. It records the source tag and commit in `hewSource` metadata.

An approved older tag can be packaged with the workflow's `release_tag` input.
Reruns compare existing assets and refuse to replace different bytes. Existing
GitHub Packages publication remains a separate optional workflow; its package
ownership and permissions are unchanged.

## License

MIT License. Copyright (c) 2026 Stephen Olesen.
