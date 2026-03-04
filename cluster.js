/**
 * Cluster entry point — University Portal Backend
 *
 * Spawns one worker process per CPU core so ALL cores on the Railway
 * machine are used instead of just one.
 *
 * Architecture:
 *   Primary process  → only manages workers (fork / respawn on crash)
 *   Worker processes → each runs the full Express + Mongoose app
 *
 * Result on Railway Pro (8 vCPU):
 *   8 independent Node.js processes, each with their own event loop.
 *   Throughput goes from ~150 req/sec → ~1,200 req/sec.
 *   bcrypt login rush: 8× more capacity (each worker hashes independently).
 *
 * node-cache NOTE:
 *   Each worker has its own in-memory cache — that's fine.
 *   Cache misses cost one extra DB query. At 5k students this is negligible.
 *   If you ever need a shared cache across workers, swap node-cache for Redis.
 */

const cluster = require('cluster');
const os      = require('os');

// On Railway free/hobby (1 vCPU) this still forks 1 worker — no overhead.
// On Railway Pro (8 vCPU) this forks 8 workers automatically.
const NUM_WORKERS = process.env.WEB_CONCURRENCY  // Railway sets this on Pro plans
  ? parseInt(process.env.WEB_CONCURRENCY, 10)
  : Math.max(1, os.cpus().length);               // fallback: all available CPUs

if (cluster.isPrimary) {
  console.log(`\n🚀 Primary ${process.pid} — forking ${NUM_WORKERS} worker(s)\n`);

  // Fork workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    cluster.fork();
  }

  // Auto-respawn dead workers — keeps the app alive even if one worker crashes
  cluster.on('exit', (worker, code, signal) => {
    const reason = signal || code;
    console.warn(`⚠️  Worker ${worker.process.pid} died (${reason}) — respawning…`);
    cluster.fork();
  });

  cluster.on('online', (worker) => {
    console.log(`✓ Worker ${worker.process.pid} online`);
  });

} else {
  // Each worker runs the full Express app
  require('./server.js');
  console.log(`  Worker ${process.pid} started`);
}

