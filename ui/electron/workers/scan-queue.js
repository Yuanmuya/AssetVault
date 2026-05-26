/**
 * Scan Queue — manages Python subprocess scans on a background thread.
 *
 * - Only one scan runs at a time (singleton queue)
 * - Pending scans are debounced and merged
 * - Output lines are streamed back to the caller
 * - Caller receives a final { ok, lines } result
 */

const path = require('path');
const { spawn } = require('child_process');

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', '..', 'scripts');

let activeJob = null;
let pendingJob = null;
let jobIdCounter = 0;

function isRunning() {
  return activeJob !== null;
}

function enqueue(job) {
  if (activeJob) {
    // Merge: replace pending with latest request for the same folder
    if (pendingJob && pendingJob.folderPath === job.folderPath && pendingJob.targetDbPath === job.targetDbPath) {
      pendingJob.cancel();
    }
    pendingJob = job;
    return job.promise;
  }
  return startJob(job);
}

function createJob(folderPath, targetDbPath, steps) {
  const id = ++jobIdCounter;
  let cancelled = false;
  let promiseResolve;

  const promise = new Promise((resolve) => {
    promiseResolve = resolve;
  });

  const cancel = () => {
    cancelled = true;
  };

  const run = () => {
    return startJob({ id, folderPath, targetDbPath, steps, cancel, promise, promiseResolve });
  };

  return { id, folderPath, targetDbPath, steps, cancel, promise, promiseResolve, run, cancelled: () => cancelled };
}

function runScript(scriptName, args) {
  return new Promise((resolve) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    const proc = spawn('python', [scriptPath, ...args], {
      cwd: SCRIPTS_DIR,
      windowsHide: true,
    });

    const lines = [];

    proc.stdout.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        const trimmed = line.trimEnd();
        if (trimmed) lines.push({ level: 'stdout', text: trimmed });
      }
    });

    proc.stderr.on('data', (data) => {
      for (const line of data.toString().split('\n')) {
        const trimmed = line.trimEnd();
        if (trimmed) lines.push({ level: 'stderr', text: trimmed });
      }
    });

    proc.on('close', (code) => {
      lines.push({ level: 'info', text: `${scriptName} exited with code ${code}` });
      resolve({ ok: code === 0, lines });
    });

    proc.on('error', (err) => {
      lines.push({ level: 'error', text: `Failed to start ${scriptName}: ${err.message}` });
      resolve({ ok: false, lines });
    });
  });
}

async function startJob(job) {
  activeJob = job;
  const lines = [];
  let overallOk = true;

  for (const step of job.steps) {
    if (job.cancelled()) break;

    const result = await runScript(step.name, step.args);
    lines.push(...result.lines);

    if (!result.ok && step.fatal !== false) {
      overallOk = false;
      break;
    }
  }

  job.promiseResolve({ ok: overallOk, lines });
  activeJob = null;

  // Start next pending job if any
  if (pendingJob) {
    const next = pendingJob;
    pendingJob = null;
    next.run();
  }

  return { ok: overallOk, lines };
}

// ── Factory for common scan pipelines ──

function createFullScan(folderPath, targetDbPath) {
  return createJob(folderPath, targetDbPath, [
    { name: 'init_db.py', args: ['--db', targetDbPath], fatal: true },
    { name: 'scan_assets.py', args: ['--root', folderPath, '--db', targetDbPath], fatal: false },
    { name: 'create_thumbnails.py', args: ['--db', targetDbPath, '--root', folderPath, '--force', '--stream'] },
    { name: 'validate_assets.py', args: ['--db', targetDbPath] },
  ]);
}

function createFileScan(filePath, targetDbPath) {
  return createJob(path.dirname(filePath), targetDbPath, [
    { name: 'init_db.py', args: ['--db', targetDbPath], fatal: true },
    { name: 'scan_assets.py', args: ['--file', filePath, '--db', targetDbPath], fatal: false },
    { name: 'create_thumbnails.py', args: ['--db', targetDbPath, '--model', filePath, '--force', '--stream'] },
    { name: 'validate_assets.py', args: ['--db', targetDbPath] },
  ]);
}

function createThumbnailJob(targetDbPath) {
  // Thumbnail job doesn't need a folder path
  return createJob(null, targetDbPath, [
    { name: 'create_thumbnails.py', args: ['--db', targetDbPath, '--force', '--stream'] },
  ]);
}

function createValidationJob(targetDbPath) {
  return createJob(null, targetDbPath, [
    { name: 'validate_assets.py', args: ['--db', targetDbPath] },
  ]);
}

module.exports = {
  enqueue,
  isRunning,
  createFullScan,
  createFileScan,
  createThumbnailJob,
  createValidationJob,
};
