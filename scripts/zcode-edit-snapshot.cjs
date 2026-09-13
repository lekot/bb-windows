const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

function readCompletedEdit(db, sessionId, callId, cwd) {
  if (!/^sess_[a-f0-9-]+$/.test(sessionId) || !/^call_[a-zA-Z0-9_-]+$/.test(callId) || !path.isAbsolute(cwd)) return null;
  const session = db.prepare('SELECT directory FROM session WHERE id = ?').get(sessionId);
  const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (!session || canonical(session.directory) !== canonical(cwd)) return null;
  const rows = db.prepare(`SELECT data FROM part WHERE session_id = ?
    AND length(CAST(data AS BLOB)) <= 2097152
    AND json_valid(data) AND json_extract(data, '$.type') = 'tool'
    AND json_extract(data, '$.callID') = ? LIMIT 2`).all(sessionId, callId);
  if (rows.length !== 1) return null;
  const part = JSON.parse(rows[0].data);
  const state = part.state;
  const metadata = state?.metadata;
  const display = metadata?.display;
  const snapshot = metadata?.readFileState;
  if (state?.status !== 'completed' || display?.kind !== 'file_diff' || display.truncated === true
    || metadata.serialization?.truncated === true || snapshot?.isPartialView !== false
    || typeof snapshot.content !== 'string' || !Array.isArray(display.structuredPatch)
    || typeof display.filePath !== 'string' || !path.isAbsolute(display.filePath)
    || snapshot.path !== display.filePath) return null;
  return { display, readFileState: snapshot, serialization: metadata.serialization };
}

module.exports = { readCompletedEdit };

async function main() {
  let db;
  try {
    const directory = process.env.ZCODE_ACP_CONFIG_PATH
      ? path.dirname(process.env.ZCODE_ACP_CONFIG_PATH) : path.join(os.homedir(), '.zcode', 'cli');
    db = new DatabaseSync(path.join(directory, 'db', 'db.sqlite'), { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 100');
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = readCompletedEdit(db, ...process.argv.slice(2));
        break;
      } catch (error) {
        const primaryCode = typeof error.errcode === 'number' ? error.errcode & 255 : null;
        if (attempt === 2 || (primaryCode !== 5 && primaryCode !== 6)) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stdout.write('null');
  } finally {
    db?.close();
  }
}

if (require.main === module) void main();
