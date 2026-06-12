import {
  HewSandboxClient,
  type CompileOutput,
  type SandboxCompiler,
  type SandboxInterpreter,
  type SandboxTrace,
} from './dist/hew-playground-sandbox.js';

const compiler: SandboxCompiler = {
  compileToSandboxBytecode(source: string): CompileOutput {
    return {
      diagnostics: [],
      bytecode: {
        schema_version: 'hew.sandbox.bytecode.v0',
        package_id: 'consumer-check',
        hew_version: '0.5.0',
        compiler_version: '0.5.0',
        profile: 'sandbox-vm-export',
      },
    };
  },
};

const interpreter: SandboxInterpreter = {
  runBytecode(): SandboxTrace {
    return {
      schema_version: 'hew.sandbox.trace.v0',
      trace_id: 'consumer-check',
      result: 'ok',
      final_state: {
        status: 'ok',
        exit_code: 0,
        stdout: [],
        stderr: [],
        diagnostics: [],
      },
    };
  },
};

const client = new HewSandboxClient({ compiler, interpreter, profile: 'sandbox-vm-export' });

await client.run('fn main() {}', { seed: 1 });
