// Starts the Paintrest server and Vite together; stops both on Ctrl+C.
import { spawn } from 'node:child_process';

const extra = process.argv.slice(2);
const procs = [
  spawn(process.execPath, ['server/main.ts'], { stdio: 'inherit' }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', ...extra], { stdio: 'inherit' }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { stop(); process.exitCode = code ?? 0; }));
