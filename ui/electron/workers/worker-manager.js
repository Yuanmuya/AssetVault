/**
 * Worker Manager — coordinates database, scan, and thumbnail workers.
 *
 * Provides a unified async API to main.js. The database worker runs
 * in a separate thread (sql.js isolated). The scan queue runs
 * Python subprocesses sequentially with merging. The thumbnail
 * queue processes batch Blender jobs.
 */

const { Worker } = require('worker_threads');
const path = require('path');
const scanQueue = require('./scan-queue');
const thumbQueue = require('./thumbnail-queue');

let dbWorker = null;
let requestId = 0;
const pending = new Map();

// ── Database worker bootstrap ──

function startDbWorker() {
  return new Promise((resolve, reject) => {
    dbWorker = new Worker(path.join(__dirname, 'db-worker.js'));

    dbWorker.on('message', (msg) => {
      if (msg.type === 'ready') {
        resolve();
        return;
      }
      const resolveFn = pending.get(msg.id);
      if (resolveFn) {
        pending.delete(msg.id);
        resolveFn(msg);
      }
    });

    dbWorker.on('error', reject);
    dbWorker.on('exit', (code) => {
      if (code !== 0) console.error(`DB worker exited with code ${code}`);
      dbWorker = null;
    });
  });
}

function dbCall(type, payload = {}) {
  return new Promise((resolve) => {
    const id = ++requestId;
    pending.set(id, resolve);
    dbWorker.postMessage({ id, type, ...payload });
  });
}

// ── Public API for main.js ──

async function init() {
  await startDbWorker();
}

// ── Database methods ──

async function openDatabase(dbPath) {
  const result = await dbCall('open', { dbPath });
  return result;
}

async function queryModels(filters = {}) {
  const result = await dbCall('query-models', { filters });
  return result.rows || [];
}

async function getModel(id) {
  const result = await dbCall('get-model', { id });
  return result.model || null;
}

async function getValidation(modelId) {
  const result = await dbCall('get-validation', { modelId });
  return result.row || null;
}

async function getValidationSummary() {
  const result = await dbCall('validation-summary');
  return result.stats || {};
}

async function getStats() {
  const result = await dbCall('stats');
  return result.stats || {};
}

async function getKnownModelPaths() {
  const result = await dbCall('get-known-model-paths');
  return result.paths || [];
}

async function removeModel(filePath) {
  const result = await dbCall('remove-model', { filePath });
  return {
    ok: result.ok || false,
    removed: result.removed || false,
    error: result.error,
  };
}

async function execSQL(sql, params = []) {
  const result = await dbCall('exec', { sql, params });
  return result.ok;
}

async function execMulti(statements) {
  const result = await dbCall('exec-multi', { statements });
  return result.ok;
}

async function queryAll(sql, params = []) {
  const result = await dbCall('query-all', { sql, params });
  return result.rows || [];
}

async function queryOne(sql, params = []) {
  const result = await dbCall('query-one', { sql, params });
  return result.row || null;
}

async function closeDatabase() {
  const result = await dbCall('close');
  return result.ok;
}

// ── Scan methods ──

function enqueueScan(folderPath, dbPath) {
  const job = scanQueue.createFullScan(folderPath, dbPath);
  return scanQueue.enqueue(job);
}

function enqueueFileScan(filePath, dbPath) {
  const job = scanQueue.createFileScan(filePath, dbPath);
  return scanQueue.enqueue(job);
}

function enqueueThumbnails(dbPath) {
  const job = scanQueue.createThumbnailJob(dbPath);
  return scanQueue.enqueue(job);
}

function enqueueValidation(dbPath) {
  const job = scanQueue.createValidationJob(dbPath);
  return scanQueue.enqueue(job);
}

function isScanRunning() {
  return scanQueue.isRunning();
}

// ── Thumbnail queue ──

function enqueueThumbnailBatch(modelPaths, dbPath, options) {
  return thumbQueue.enqueue(modelPaths, dbPath, options);
}

// ── Shutdown ──

async function shutdown() {
  if (dbWorker) {
    await dbCall('close');
    dbWorker.terminate();
    dbWorker = null;
  }
}

module.exports = {
  init,
  shutdown,
  openDatabase,
  queryModels,
  getModel,
  getValidation,
  getValidationSummary,
  getStats,
  getKnownModelPaths,
  removeModel,
  execSQL,
  execMulti,
  queryAll,
  queryOne,
  closeDatabase,
  enqueueScan,
  enqueueFileScan,
  enqueueThumbnails,
  enqueueValidation,
  enqueueThumbnailBatch,
  isScanRunning,
};
