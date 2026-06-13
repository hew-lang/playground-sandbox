import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HewSandboxClient,
  SandboxBytecodeVersionError,
  createHewSandboxClient,
  isPlaygroundSandboxError,
  loadPublishedSandbox,
} from './dist/hew-playground-sandbox.js';

function bytecode(overrides = {}) {
  return {
    schema_version: 'hew.sandbox.bytecode.v0',
    package_id: 'pkg-1',
    hew_version: '0.5.0',
    compiler_version: '0.5.0',
    profile: 'sandbox-vm-export',
    ...overrides,
  };
}

function trace(overrides = {}) {
  return {
    schema_version: 'hew.sandbox.trace.v0',
    trace_id: 'trace-1',
    result: 'ok',
    final_state: {
      status: 'ok',
      exit_code: 0,
      stdout: ['hello\n'],
      stderr: [],
      diagnostics: [],
    },
    ...overrides,
  };
}

function errorDiagnostic(message = 'boom') {
  return {
    severity: 'error',
    phase: 'parse',
    message,
    span: { start: 0, end: 1 },
    start_offset: 0,
    end_offset: 1,
    kind: 'parse_error',
    notes: [],
    suggestions: [],
  };
}

test('run() maps a successful trace to the result envelope', async () => {
  let interpreted = false;
  const client = new HewSandboxClient({
    compiler: {
      compileToSandboxBytecode: () => ({ diagnostics: [], bytecode: bytecode() }),
    },
    interpreter: {
      runBytecode: () => {
        interpreted = true;
        return trace();
      },
      buildPlaygroundState: () => ({ schema_version: 'hew.sandbox.playground.v0' }),
    },
  });

  const result = await client.run('fn main() { println("hello"); }');
  assert.equal(interpreted, true);
  assert.equal(result.success, true);
  assert.equal(result.stdout, 'hello\n');
  assert.equal(result.stderr, '');
  assert.equal(result.exit_code, 0);
  assert.equal(result.status, 'ok');
  assert.equal(result.compiler_version, '0.5.0');
  assert.ok(result.trace);
  assert.deepEqual(result.state, { schema_version: 'hew.sandbox.playground.v0' });
});

test('run() short-circuits on compile diagnostics and never interprets', async () => {
  let interpreted = false;
  const client = createHewSandboxClient({
    compiler: {
      compileToSandboxBytecode: () => ({ diagnostics: [errorDiagnostic()], bytecode: null }),
    },
    interpreter: {
      runBytecode: () => {
        interpreted = true;
        return trace();
      },
    },
  });

  const result = await client.run('fn main() {');
  assert.equal(interpreted, false);
  assert.equal(result.success, false);
  assert.equal(result.status, 'compile_error');
  assert.equal(result.trace, null);
  assert.equal(result.diagnostics.length, 1);
});

test('run() rejects a bytecode version the interpreter does not support', async () => {
  const client = new HewSandboxClient({
    compiler: {
      compileToSandboxBytecode: () => ({
        diagnostics: [],
        bytecode: bytecode({ schema_version: 'hew.sandbox.bytecode.v1' }),
      }),
    },
    interpreter: { runBytecode: () => trace() },
  });

  await assert.rejects(
    () => client.run('fn main() {}'),
    (error) => {
      assert.ok(error instanceof SandboxBytecodeVersionError);
      assert.equal(error.expected, 'hew.sandbox.bytecode.v0');
      assert.equal(error.actual, 'hew.sandbox.bytecode.v1');
      assert.equal(isPlaygroundSandboxError(error), true);
      return true;
    },
  );
});

test('run() forwards seed and stepBudget to the interpreter', async () => {
  let received;
  const client = new HewSandboxClient({
    compiler: { compileToSandboxBytecode: () => ({ diagnostics: [], bytecode: bytecode() }) },
    interpreter: {
      runBytecode: (_pkg, options) => {
        received = options;
        return trace();
      },
    },
  });

  await client.run('fn main() {}', { seed: 7, stepBudget: 1000 });
  assert.deepEqual(received, { stepBudget: 1000, replay: { seed: 7 } });
});

test('loadPublishedSandbox compiles and runs through the published upstreams', async () => {
  const loaded = await loadPublishedSandbox();
  assert.equal(typeof loaded.compiler.compileToSandboxBytecode, 'function');
  assert.equal(typeof loaded.interpreter.runBytecode, 'function');

  const client = new HewSandboxClient(loaded);
  const result = await client.run('fn main() { println("hi"); }');

  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.match(result.stdout, /hi/);
});
