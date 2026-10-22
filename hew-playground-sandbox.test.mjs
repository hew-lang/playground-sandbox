import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HewSandboxClient,
  createHewSandboxClient,
  isNativeOnlyRefusal,
  loadPublishedSandbox,
} from './dist/hew-playground-sandbox.js';

function bytecode(overrides = {}) {
  return {
    schema_version: 'hew.sandbox.bytecode.v1',
    package_id: 'pkg-1',
    hew_version: '0.6.2',
    compiler_version: '0.6.2',
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
      sandbox_rejections: [],
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
      runBytecode: async () => {
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
  assert.equal(result.compiler_version, '0.6.2');
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
      runBytecode: async () => {
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
  assert.equal(result.engine, 'local');
  assert.equal(isNativeOnlyRefusal(result), false);
});

test('admission results preserve the VM decision and offer remote only for native capabilities', async () => {
  for (const [categories, remote] of [
    [['native_only'], true],
    [['not_implemented'], false],
    [['invalid_package'], false],
    [['native_only', 'not_implemented'], false],
    [[], false],
  ]) {
    const sandbox_rejections = categories.map((category) => ({
      category, code: 'unsupported', capability: 'FileRead::Open',
      message: 'Capability unavailable', span: null,
    }));
    const rejected = trace({ result: 'sandbox_rejected' });
    rejected.final_state.status = 'sandbox_rejected';
    rejected.final_state.stdout = [];
    rejected.final_state.exit_code = null;
    rejected.final_state.sandbox_rejections = sandbox_rejections;
    const client = createHewSandboxClient({
      compiler: { compileToSandboxBytecode: () => ({ diagnostics: [], bytecode: bytecode() }) },
      interpreter: { runBytecode: async () => rejected },
    });
    const result = await client.run('fn main() {}');
    assert.equal(result.status, 'sandbox_rejected');
    assert.equal(result.stdout, '');
    assert.deepEqual(result.sandbox_rejections, sandbox_rejections);
    assert.equal(isNativeOnlyRefusal(result), remote);
  }
});

test('run() forwards seed and stepBudget to the interpreter', async () => {
  let received;
  const client = new HewSandboxClient({
    compiler: { compileToSandboxBytecode: () => ({ diagnostics: [], bytecode: bytecode() }) },
    interpreter: {
      runBytecode: async (_pkg, options) => {
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
  assert.equal(loaded.compilerVersion, '0.7.0');

  const client = new HewSandboxClient(loaded);
  const result = await client.run('fn main() { println("hi"); }');

  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(result.stdout, 'hi\n');
  assert.equal(result.exit_code, 0);
  assert.equal(result.compiler_version, 'hew-wasm-0.7.0');
  assert.equal(result.hew_version, '0.7.0');
  assert.deepEqual(result.sandbox_rejections, []);
  assert.equal(result.state?.schema_version, 'hew.sandbox.playground.v0');
});

test('published compiler preserves parse and type errors as local compile failures', async () => {
  const client = new HewSandboxClient(await loadPublishedSandbox());
  for (const source of [
    'fn main( {',
    'fn main() { let count: i64 = "not a number"; println(count); }',
  ]) {
    const result = await client.run(source);
    assert.equal(result.success, false);
    assert.equal(result.status, 'compile_error');
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
    assert.equal(result.compiler_version, '0.7.0');
    assert.equal(result.engine, 'local');
    assert.equal(result.trace, null);
    assert.equal(result.state, null);
    assert.deepEqual(result.sandbox_rejections, []);
    assert.equal(isNativeOnlyRefusal(result), false);
  }
});

test('published compiler retains related definition notes and actionable suggestions', async () => {
  const client = new HewSandboxClient(await loadPublishedSandbox());
  const duplicate = await client.run('fn same() {} fn same() {} fn main() {}');
  assert.equal(duplicate.status, 'compile_error');
  const definition = duplicate.diagnostics.find((diagnostic) => diagnostic.kind === 'DuplicateDefinition');
  assert.equal(definition.notes[0].message, 'previous definition here');
  assert.deepEqual(definition.notes[0].span, { start: 0, end: 13 });
  const immutable = await client.run('fn main() { let text = "hello"; text = "again"; }');
  assert.ok(immutable.diagnostics.some((diagnostic) => diagnostic.suggestions.includes('consider changing this to `var text`')));
});

test('published VM reports TCP networking as an explicit native-only refusal', async () => {
  const client = new HewSandboxClient(await loadPublishedSandbox());
  const result = await client.run(`
import std.net;
fn main() {
    match net.connect("127.0.0.1:9") {
        .Ok(conn) => conn.close(),
        .Err(_) => println("unavailable"),
    }
}
`);

  assert.equal(result.success, false, JSON.stringify(result));
  assert.equal(result.status, 'sandbox_rejected', JSON.stringify(result.diagnostics));
  assert.equal(result.stdout, '');
  assert.equal(result.exit_code, null);
  assert.equal(result.compiler_version, 'hew-wasm-0.7.0');
  assert.equal(isNativeOnlyRefusal(result), true);
  assert.ok(result.sandbox_rejections.every((rejection) => rejection.capability === 'NativeIo::TcpConnect'));
  assert.deepEqual(result.sandbox_rejections, result.trace.final_state.sandbox_rejections);
});

test('published VM preserves panic, trap, and step-budget results without remote fallback', async () => {
  const client = new HewSandboxClient(await loadPublishedSandbox());
  for (const [source, status, trapKind] of [
    ['fn main() { panic("sandbox panic"); }', 'panic', 'panic'],
    ['fn main() { let denominator = 0; println(1 / denominator); }', 'trap', 'divide_by_zero'],
    ['fn main() { var i = 0; while true { i = i + 1; } }', 'budget_exhausted', 'budget_exhausted'],
  ]) {
    const result = await client.run(source, { fixtureId: `sdk-${status}`, seed: 7, stepBudget: 25 });
    assert.equal(result.success, false);
    assert.equal(result.status, status, JSON.stringify(result));
    assert.equal(result.trace.final_state.status, status);
    assert.equal(result.trace.final_state.runtime_failures[0].trap_kind, trapKind);
    assert.equal(result.trace.fixture_id, `sdk-${status}`);
    assert.equal(result.trace.replay.seed, 7);
    assert.equal(result.trace.replay.step_budget, 25);
    assert.equal(result.engine, 'local');
    assert.deepEqual(result.sandbox_rejections, []);
    assert.equal(isNativeOnlyRefusal(result), false);
  }
});

test('published sandbox supports repeated loading and stateful actor execution', async () => {
  const loaded = await loadPublishedSandbox();
  const loadedAgain = await loadPublishedSandbox();
  assert.equal(loadedAgain.compilerVersion, loaded.compilerVersion);
  const client = new HewSandboxClient(loadedAgain);
  const source = `
actor Counter {
    var count: i64;
    receive fn increment(n: i64) -> i64 {
        count = count + n;
        count
    }
}
fn main() {
    let counter = spawn Counter { count: 0 };
    println(match counter.increment(5) { .Ok(value) => value, .Err(_) => 0 - 1 });
    println(match counter.increment(3) { .Ok(value) => value, .Err(_) => 0 - 1 });
}
`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await client.run(source, { seed: 11, stepBudget: 1000 });
    assert.equal(result.status, 'ok', JSON.stringify(result));
    assert.equal(result.stdout, '5\n8\n');
    assert.equal(result.exit_code, 0);
  }
});


test('run waits for host completion before reading the trace or building state', async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  let stateBuilt = false;
  const client = createHewSandboxClient({
    compiler: { compileToSandboxBytecode: () => ({ diagnostics: [], bytecode: bytecode() }) },
    interpreter: {
      runBytecode: async (_pkg, options) => {
        assert.equal(options.stepBudget, 50);
        return pending;
      },
      buildPlaygroundState: (result) => {
        assert.equal(result.final_state.stdout[0], 'host completed\n');
        stateBuilt = true;
        return { schema_version: 'hew.sandbox.playground.v0' };
      },
    },
  });
  const result = client.run('fn main() {}', { stepBudget: 50 });
  let settled = false;
  result.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(stateBuilt, false);
  const completed = trace();
  completed.final_state.stdout = ['host completed\n'];
  complete(completed);
  assert.equal((await result).stdout, 'host completed\n');
  assert.equal(stateBuilt, true);
});


test('published sandbox uses the compiler codec bridge for generic wire values', async () => {
  const client = new HewSandboxClient(await loadPublishedSandbox());
  const result = await client.run(`
import std.encoding.json;
import std.encoding.cbor;
#[wire]
type Parcel<T> { item: T; }
fn main() {
    let value: Parcel<string> = Parcel { item: "retained".to_upper() };
    assert(json.decode<Parcel<string>>(json.encode(value)).expect("JSON") == value);
    assert(cbor.decode<Parcel<string>>(cbor.encode(value)).expect("CBOR") == value);
    println(value.item);
}
`);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(result.stdout, 'RETAINED\n');
  assert.equal(result.exit_code, 0);
});

for (const [format, document] of [['json', '{"count":7}'], ['toml', 'count = 7'], ['yaml', 'count: 7']]) {
  test(`published sandbox preserves independent ${format.toUpperCase()} values and parser errors`, async () => {
    const client = new HewSandboxClient(await loadPublishedSandbox());
    const result = await client.run(`
import std.encoding.${format};
fn main() {
    let original = ${format}.parse(${JSON.stringify(document)}).expect("document");
    var changed = original;
    changed.set("count", ${format}.from_int(9)).expect("mapping");
    let restored = ${format}.parse(changed.stringify().expect("encode")).expect("decode");
    assert(original.get_field("count").expect("mapping").expect("count").get_int().expect("integer") == 7);
    println(restored.get_field("count").expect("mapping").expect("count").get_int().expect("integer"));
    assert(${format}.parse("[").is_err());
}
`);
    assert.equal(result.status, 'ok', JSON.stringify(result));
    assert.equal(result.stdout, '9\n');
    assert.equal(result.exit_code, 0);
  });
}
