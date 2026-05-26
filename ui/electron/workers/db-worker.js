/**
 * Database Worker — runs sql.js in a dedicated worker_thread.
 *
 * Owns the SQLite connection exclusively and persists mutations back to the
 * opened database file.
 *
 * Messages:
 *   { type: 'open',  dbPath } → { ok, stats }
 *   { type: 'query-models', filters } → { rows }
 *   { type: 'get-model', id } → { model }
 *   { type: 'exec', sql, params } → { ok }
 *   { type: 'close' } → { ok }
 */

const { parentPort } = require('worker_threads');
const fs = require('fs');
const initSqlJs = require('sql.js');

let SQL = null;
let db = null;
let dbPath = null;

function persistDatabase() {
  if (!db || !dbPath) return;
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

// ── Open ──

function openDatabase(filePath) {
  try {
    if (db) { db.close(); db = null; }
    const bytes = fs.existsSync(filePath) ? fs.readFileSync(filePath) : undefined;
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    db.run('PRAGMA foreign_keys = ON');
    dbPath = filePath;
    return true;
  } catch (e) {
    return { error: e.message };
  }
}

// ── Query helpers ──

function queryAll(sql, params = []) {
  if (!db) return [];
  let stmt = null;
  try {
    stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } catch (e) {
    return [];
  } finally {
    if (stmt) stmt.free();
  }
}

function queryOne(sql, params = []) {
  if (!db) return undefined;
  let stmt = null;
  try {
    stmt = db.prepare(sql);
    stmt.bind(params);
    return stmt.step() ? stmt.getAsObject() : undefined;
  } catch (e) {
    return undefined;
  } finally {
    if (stmt) stmt.free();
  }
}

function getScalar(sql, params = []) {
  if (!db) return 0;
  let stmt = null;
  try {
    stmt = db.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    if (!row) return 0;
    const keys = Object.keys(row);
    return keys.length > 0 ? (row[keys[0]] ?? 0) : 0;
  } catch (e) {
    return 0;
  } finally {
    if (stmt) stmt.free();
  }
}

function dbRun(sql, params = []) {
  if (!db) return false;
  let stmt = null;
  try {
    stmt = db.prepare(sql);
    stmt.run(params);
    persistDatabase();
    return true;
  } catch (e) {
    return false;
  } finally {
    if (stmt) stmt.free();
  }
}

// ── Query methods ──

function queryModels(filters = {}) {
  if (!db) return [];
  const { search, format, missingOnly, limit = 200, offset = 0 } = filters;

  let sql = `
    SELECT m.id, m.file_path, m.file_name, m.format,
           m.file_size_bytes, m.last_modified, m.scan_timestamp, m.variant,
           COALESCE((SELECT GROUP_CONCAT(map_type) FROM textures WHERE model_id = m.id), '') AS textures_found,
           (SELECT COUNT(*) FROM missing_textures mt WHERE mt.model_id = m.id AND mt.resolved = 0) AS missing_count,
           (SELECT missing_types FROM missing_textures mt WHERE mt.model_id = m.id AND mt.resolved = 0 LIMIT 1) AS missing_types
    FROM models m
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    sql += ` AND (m.file_name LIKE ? OR m.file_path LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  if (format) {
    sql += ` AND m.format = ?`;
    params.push(format);
  }
  if (missingOnly) {
    sql += ` AND m.id IN (SELECT model_id FROM missing_textures WHERE resolved = 0)`;
  }

  sql += ` ORDER BY m.scan_timestamp DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return queryAll(sql, params);
}

function getModelById(id) {
  if (!db) return null;
  const model = queryOne('SELECT * FROM models WHERE id = ?', [id]);
  if (!model) return null;
  model.textures = queryAll('SELECT * FROM textures WHERE model_id = ?', [id]);
  model.missing = queryAll('SELECT * FROM missing_textures WHERE model_id = ? AND resolved = 0', [id]);
  return model;
}

function getModelByPath(filePath) {
  return queryOne('SELECT id, file_path FROM models WHERE file_path = ?', [filePath]);
}

function getStats() {
  if (!db) return {};
  const by_format = queryAll('SELECT format, COUNT(*) AS cnt FROM models GROUP BY format');
  return {
    total_models: getScalar('SELECT COUNT(*) AS count FROM models'),
    by_format,
    total_textures: getScalar('SELECT COUNT(*) AS count FROM textures'),
    unresolved_missing: getScalar('SELECT COUNT(*) AS count FROM missing_textures WHERE resolved = 0'),
    total_missing_models: getScalar('SELECT COUNT(DISTINCT model_id) AS count FROM missing_textures WHERE resolved = 0'),
  };
}

// ── Message handler (synchronous — better-sqlite3 is sync) ──

parentPort.on('message', (msg) => {
  try {
    switch (msg.type) {
      case 'open': {
        const result = openDatabase(msg.dbPath);
        const stats = result === true ? getStats() : null;
        parentPort.postMessage({ id: msg.id, ok: result === true, stats, error: result.error });
        break;
      }

      case 'query-models':
        parentPort.postMessage({ id: msg.id, rows: queryModels(msg.filters) });
        break;

      case 'get-model':
        parentPort.postMessage({ id: msg.id, model: getModelById(msg.id) });
        break;

      case 'get-model-by-path':
        parentPort.postMessage({ id: msg.id, model: getModelByPath(msg.path) });
        break;

      case 'get-validation':
        parentPort.postMessage({ id: msg.id, row: queryOne('SELECT * FROM asset_validation WHERE model_id = ?', [msg.modelId]) });
        break;

      case 'validation-summary': {
        const byStatus = queryAll('SELECT ue_status AS status, COUNT(*) AS count FROM asset_validation GROUP BY ue_status');
        const total = byStatus.reduce((s, r) => s + r.count, 0);
        const issuesRows = queryAll("SELECT ue_issues FROM asset_validation WHERE ue_issues IS NOT NULL AND ue_issues != ''");
        let totalIssues = 0;
        for (const r of issuesRows) {
          if (r.ue_issues) totalIssues += r.ue_issues.split(',').length;
        }
        parentPort.postMessage({ id: msg.id, stats: { byStatus, total, totalIssues } });
        break;
      }

      case 'stats':
        parentPort.postMessage({ id: msg.id, stats: getStats() });
        break;

      case 'query-all':
        parentPort.postMessage({ id: msg.id, rows: queryAll(msg.sql, msg.params) });
        break;

      case 'query-one':
        parentPort.postMessage({ id: msg.id, row: queryOne(msg.sql, msg.params) });
        break;

      case 'exec': {
        const ok = dbRun(msg.sql, msg.params);
        parentPort.postMessage({ id: msg.id, ok });
        break;
      }

      case 'exec-multi': {
        if (!db) { parentPort.postMessage({ id: msg.id, ok: false }); break; }
        try {
          for (const stmt of msg.statements) {
            dbRun(stmt.sql, stmt.params || []);
          }
          persistDatabase();
          parentPort.postMessage({ id: msg.id, ok: true });
        } catch (e) {
          parentPort.postMessage({ id: msg.id, ok: false, error: e.message });
        }
        break;
      }

      case 'get-known-model-paths': {
        const rows = queryAll('SELECT file_path FROM models');
        parentPort.postMessage({ id: msg.id, paths: rows.map(r => r.file_path) });
        break;
      }

      case 'remove-model': {
        if (!db) { parentPort.postMessage({ id: msg.id, ok: false }); break; }
        const model = getModelByPath(msg.filePath);
        if (model) {
          dbRun('DELETE FROM textures WHERE model_id = ?', [model.id]);
          dbRun('DELETE FROM missing_textures WHERE model_id = ?', [model.id]);
          dbRun('DELETE FROM asset_validation WHERE model_id = ?', [model.id]);
          dbRun('DELETE FROM models WHERE id = ?', [model.id]);
          persistDatabase();
          parentPort.postMessage({ id: msg.id, ok: true, removed: true });
        } else {
          parentPort.postMessage({ id: msg.id, ok: true, removed: false });
        }
        break;
      }

      case 'close': {
        if (db) { persistDatabase(); db.close(); db = null; dbPath = null; }
        parentPort.postMessage({ id: msg.id, ok: true });
        break;
      }

      default:
        parentPort.postMessage({ id: msg.id, error: `Unknown message type: ${msg.type}` });
    }
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: e.message });
  }
});

initSqlJs({ locateFile: file => require.resolve(`sql.js/dist/${file}`) })
  .then((sql) => {
    SQL = sql;
    parentPort.postMessage({ type: 'ready' });
  })
  .catch((e) => {
    parentPort.postMessage({ type: 'ready-error', error: e.message });
  });
