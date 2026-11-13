import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const children = new Set();
let stopping = false;

function start(command, args, label) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: 'inherit'
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${label} 已退出（${signal ?? code}）`);
      stop(code ?? 1);
    }
  });
  return child;
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(exitCode);
  }, 1500).unref();
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start(process.execPath, [path.join(rootDir, 'server', 'index.js')], 'API');
start(process.execPath, [viteBin, '--config', 'web/vite.config.js'], 'Vite');

console.log('Autofix Console 开发模式');
console.log('前端: http://127.0.0.1:5176');
console.log('API:  http://127.0.0.1:4177');
