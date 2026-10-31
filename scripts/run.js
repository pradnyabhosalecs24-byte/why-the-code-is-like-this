// Cross-platform launcher (Windows/macOS/Linux) for backend + frontend together.
//   npm run demo  -> backend in LOCAL DEMO MODE (synthetic data, no credentials) + frontend
//   npm run dev   -> backend with your .env (Neo4j etc.) + frontend
import { spawn } from 'node:child_process';

const mode = process.argv[2] === 'demo' ? 'demo' : 'dev';
const procs = [
  ['backend', 'npm', ['run', mode, '--prefix', 'backend']],
  ['frontend', 'npm', ['run', 'dev', '--prefix', 'frontend']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  p.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
    shutdown();
  });
  return p;
});
console.log(`Starting TraceWhy (${mode === 'demo' ? 'LOCAL DEMO MODE: synthetic data' : 'normal mode'}). Open http://localhost:5173  (Ctrl+C to stop)`);
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
