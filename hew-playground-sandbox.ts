/**
 * @hew-lang/playground-sandbox
 *
 * Local / in-browser execution client for Hew. It is the complement to
 * `@hew-lang/playground-client`, which runs code remotely over HTTP: this
 * package executes Hew entirely on the client, deterministically, with no
 * server.
 *
 * It is the *glue* between two upstream artifacts from the `hew-lang/hew`
 * monorepo:
 *   - `@hew-lang/sandbox-wasm` — the wasm compiler. `compileToSandboxBytecode`
 *     performs parse + type-check + a fail-closed sandbox profile gate and
 *     emits a `hew.sandbox.bytecode.v0` package. This is the same analysis
 *     tier editors/LSP front-ends consume.
 *   - `@hew-lang/sandbox-vm` — the deterministic TypeScript interpreter.
 *     `runBytecode` executes a package into a `SandboxTrace`, and
 *     `buildPlaygroundState` shapes that trace for a playground UI.
 *
 * Until those packages are published (see "milestone 0" in the README), inject
 * the `compiler` and `interpreter` implementations yourself via
 * {@link HewSandboxClientOptions}. The port interfaces below mirror the
 * upstream public surfaces, so the default wiring becomes a drop-in once they
 * ship.
 */

/** Canonical sandbox bytecode schema version this client interprets. */
export const SANDBOX_BYTECODE_SCHEMA_VERSION = 'hew.sandbox.bytecode.v0';
/** Human-facing profile alias understood by the sandbox compiler. */
export const DEFAULT_SANDBOX_PROFILE = 'sandbox-vm-export';

// ---------------------------------------------------------------------------
// Structural mirrors of upstream types (only the subset the glue touches).
// Full definitions live in @hew-lang/sandbox-wasm and @hew-lang/sandbox-vm.
// ---------------------------------------------------------------------------

export interface SandboxDiagnosticSpan {
  start: number;
  end: number;
}

/** Mirror of `hew-sandbox-wasm`'s `Diagnostic`. */
export interface SandboxDiagnostic {
  severity: string;
  phase: string;
  message: string;
  span: SandboxDiagnosticSpan;
  start_offset: number;
  end_offset: number;
  kind: string;
  notes: unknown[];
  suggestions: string[];
  source_module?: string;
}

/**
 * Mirror of `@hew-lang/sandbox-vm`'s `SandboxBytecodePackage` (identity fields
 * only — the package is produced by the compiler and handed straight to the
 * interpreter, so this client only reads its version/identity metadata).
 */
export interface SandboxBytecodePackage {
  schema_version: typeof SANDBOX_BYTECODE_SCHEMA_VERSION;
  package_id: string;
  hew_version: string;
  compiler_version: string;
  profile: string;
}

/** Mirror of `hew-sandbox-wasm`'s `CompileOutput`. */
export interface CompileOutput {
  diagnostics: SandboxDiagnostic[];
  bytecode: SandboxBytecodePackage | null;
}

export type SandboxRuntimeStatus =
  | 'ok'
  | 'compile_error'
  | 'sandbox_rejected'
  | 'runtime_failure'
  | 'budget_exhausted'
  | 'panic'
  | 'trap';

export interface SandboxTraceFinalState {
  status: SandboxRuntimeStatus;
  exit_code: number | null;
  stdout: string[];
  stderr: string[];
  diagnostics: unknown[];
}

/** Structural subset of `@hew-lang/sandbox-vm`'s `SandboxTrace`. */
export interface SandboxTrace {
  schema_version: 'hew.sandbox.trace.v0';
  trace_id: string;
  result: SandboxRuntimeStatus;
  final_state: SandboxTraceFinalState;
}

/** Structural subset of `@hew-lang/sandbox-vm`'s `PlaygroundState`. */
export interface PlaygroundState {
  schema_version: 'hew.sandbox.playground.v0';
}

export interface SandboxRunOptions {
  /** Sandbox profile alias; defaults to the client profile. */
  profile?: string;
  /** Fixture identifier recorded in the resulting trace. */
  fixtureId?: string;
  /** Deterministic step budget forwarded to the interpreter. */
  stepBudget?: number;
  /** Deterministic PRNG seed forwarded to the interpreter replay config. */
  seed?: number;
}

// ---------------------------------------------------------------------------
// Ports (dependency injection). These mirror the upstream public surfaces.
// ---------------------------------------------------------------------------

/** Port for `@hew-lang/sandbox-wasm`'s `compileToSandboxBytecode`. */
export interface SandboxCompiler {
  compileToSandboxBytecode(
    source: string,
    profile?: string,
  ): CompileOutput | Promise<CompileOutput>;
}

/** Port for `@hew-lang/sandbox-vm`'s interpreter surface. */
export interface SandboxInterpreter {
  runBytecode(pkg: SandboxBytecodePackage, options?: Record<string, unknown>): SandboxTrace;
  buildPlaygroundState?(trace: SandboxTrace): PlaygroundState;
}

/**
 * Normalized result envelope. The `success`/`stdout`/`stderr`/`exit_code`
 * fields intentionally mirror `@hew-lang/playground-client`'s `RunResponse`
 * so a UI can treat remote and local execution uniformly; `status`, `trace`,
 * and `state` are sandbox-only extensions.
 */
export interface SandboxRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  status: SandboxRuntimeStatus;
  diagnostics: SandboxDiagnostic[];
  compiler_version?: string;
  trace: SandboxTrace | null;
  state: PlaygroundState | null;
}

export interface HewSandboxClientOptions {
  /** Injected `@hew-lang/sandbox-wasm` compiler. */
  compiler: SandboxCompiler;
  /** Injected `@hew-lang/sandbox-vm` interpreter. */
  interpreter: SandboxInterpreter;
  /** Default sandbox profile for every `run()`. Defaults to `'sandbox-vm-export'`. */
  profile?: string;
  /**
   * Bytecode schema version the interpreter understands. Defaults to
   * `'hew.sandbox.bytecode.v0'`. A mismatch throws {@link SandboxBytecodeVersionError},
   * enforcing the compiler/VM version contract rather than failing silently.
   */
  expectedBytecodeVersion?: string;
}

export class PlaygroundSandboxError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PlaygroundSandboxError';
    this.code = code;
  }
}

/** Thrown when the compiler emits a bytecode version the interpreter cannot run. */
export class SandboxBytecodeVersionError extends PlaygroundSandboxError {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(
      'bytecode_version_mismatch',
      `sandbox bytecode version mismatch: interpreter expects ${expected} but the compiler emitted ${actual}. ` +
        'Upgrade @hew-lang/sandbox-wasm and @hew-lang/sandbox-vm together.',
    );
    this.name = 'SandboxBytecodeVersionError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class HewSandboxClient {
  private readonly compiler: SandboxCompiler;
  private readonly interpreter: SandboxInterpreter;
  private readonly profile: string;
  private readonly expectedBytecodeVersion: string;

  constructor(options: HewSandboxClientOptions) {
    this.compiler = options.compiler;
    this.interpreter = options.interpreter;
    this.profile = options.profile ?? DEFAULT_SANDBOX_PROFILE;
    this.expectedBytecodeVersion =
      options.expectedBytecodeVersion ?? SANDBOX_BYTECODE_SCHEMA_VERSION;
  }

  async run(source: string, options: SandboxRunOptions = {}): Promise<SandboxRunResult> {
    const profile = options.profile ?? this.profile;
    const compiled = await this.compiler.compileToSandboxBytecode(source, profile);
    const diagnostics = compiled.diagnostics ?? [];

    if (!compiled.bytecode || hasErrorDiagnostic(diagnostics)) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        exit_code: null,
        status: 'compile_error',
        diagnostics,
        trace: null,
        state: null,
      };
    }

    const actualVersion = String(compiled.bytecode.schema_version);
    if (actualVersion !== this.expectedBytecodeVersion) {
      throw new SandboxBytecodeVersionError(this.expectedBytecodeVersion, actualVersion);
    }

    const trace = this.interpreter.runBytecode(compiled.bytecode, toInterpreterOptions(options));
    const state = this.interpreter.buildPlaygroundState
      ? this.interpreter.buildPlaygroundState(trace)
      : null;
    const final = trace.final_state;

    return {
      success: trace.result === 'ok',
      stdout: (final?.stdout ?? []).join(''),
      stderr: (final?.stderr ?? []).join(''),
      exit_code: final?.exit_code ?? null,
      status: trace.result,
      diagnostics,
      compiler_version: compiled.bytecode.compiler_version,
      trace,
      state,
    };
  }
}

export function createHewSandboxClient(options: HewSandboxClientOptions): HewSandboxClient {
  return new HewSandboxClient(options);
}

export function isPlaygroundSandboxError(error: unknown): error is PlaygroundSandboxError {
  return error instanceof PlaygroundSandboxError;
}

/**
 * Default wiring placeholder. Once `@hew-lang/sandbox-wasm` and
 * `@hew-lang/sandbox-vm` are published from the hew monorepo (milestone 0),
 * this will dynamically import them, initialize the wasm module, and return a
 * ready `{ compiler, interpreter }` pair. Until then it throws so callers must
 * inject implementations explicitly.
 */
export async function loadPublishedSandbox(): Promise<{
  compiler: SandboxCompiler;
  interpreter: SandboxInterpreter;
}> {
  throw new PlaygroundSandboxError(
    'upstreams_unpublished',
    'Default sandbox wiring requires @hew-lang/sandbox-wasm and @hew-lang/sandbox-vm to be ' +
      'published (milestone 0). Until then, inject `compiler` and `interpreter` via ' +
      'HewSandboxClientOptions.',
  );
}

function hasErrorDiagnostic(diagnostics: SandboxDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

function toInterpreterOptions(options: SandboxRunOptions): Record<string, unknown> {
  const interpreterOptions: Record<string, unknown> = {};
  if (options.fixtureId !== undefined) {
    interpreterOptions.fixtureId = options.fixtureId;
  }
  if (options.stepBudget !== undefined) {
    interpreterOptions.stepBudget = options.stepBudget;
  }
  if (options.seed !== undefined) {
    interpreterOptions.replay = { seed: options.seed };
  }
  return interpreterOptions;
}
