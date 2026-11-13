import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';

export function runCommand(command, args = [], {
  cwd,
  env,
  timeoutMs = 30_000,
  input,
  onOutput
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer;

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onOutput?.({ stream: 'stdout', text });
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onOutput?.({ stream: 'stderr', text });
    });
    child.on('error', (error) => {
      finish({ code: -1, signal: null, stdout, stderr: error.message, timedOut });
    });
    child.on('close', (code, signal) => {
      finish({ code: timedOut ? 124 : (code ?? -1), signal, stdout, stderr, timedOut });
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, 2_000).unref();
      }, timeoutMs);
      timer.unref();
    }
  });
}

export async function commandPath(command, env = process.env) {
  const pathValue = env.PATH || '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin';
  for (const directory of pathValue.split(':')) {
    if (!directory) continue;
    const candidate = `${directory}/${command}`;
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue searching.
    }
  }
  return null;
}
