const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readCompletedEdit } = require('./zcode-edit-snapshot.cjs');
const path = require('node:path');
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');

test('temporary SQLite writer lock does not discard the completed snapshot', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bb-snapshot-lock-'));
  mkdirSync(path.join(root, 'db'));
  const db = new DatabaseSync(path.join(root, 'db', 'db.sqlite'));
  let release;
  try {
    db.exec('CREATE TABLE session(id TEXT, directory TEXT); CREATE TABLE part(session_id TEXT, data TEXT);');
    db.prepare('INSERT INTO session VALUES (?, ?)').run('sess_abcd', root);
    const file = path.join(root, 'probe.txt');
    db.prepare('INSERT INTO part VALUES (?, ?)').run('sess_abcd', JSON.stringify({ type: 'tool', callID: 'call_lock', state: { status: 'completed', metadata: {
      display: { kind: 'file_diff', filePath: file, structuredPatch: [] },
      readFileState: { path: file, content: 'snapshot', isPartialView: false },
    } } }));
    db.exec('BEGIN EXCLUSIVE');
    const child = spawn(process.execPath, [path.join(__dirname, 'zcode-edit-snapshot.cjs'), 'sess_abcd', 'call_lock', root], {
      env: { ...process.env, ZCODE_ACP_CONFIG_PATH: path.join(root, 'config.json') }, windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    release = setTimeout(() => db.exec('COMMIT'), 220);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    assert.equal(code, 0);
    assert.equal(JSON.parse(output).readFileState.content, 'snapshot');
  } finally {
    clearTimeout(release);
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact native call lookup rejects foreign scope, partial data and ambiguous calls', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE session(id TEXT, directory TEXT); CREATE TABLE part(session_id TEXT, data TEXT);');
    const cwd = process.cwd();
    const file = path.join(cwd, 'probe.txt');
    db.prepare('INSERT INTO session VALUES (?, ?)').run('sess_1234-abcd', cwd);
    const part = { type: 'tool', callID: 'call_123', state: { status: 'completed', metadata: {
      display: { kind: 'file_diff', filePath: file, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }] },
      readFileState: { path: file, content: 'new\n', isPartialView: false },
    } } };
    const insert = () => db.prepare('INSERT INTO part VALUES (?, ?)').run('sess_1234-abcd', JSON.stringify(part));
    insert();
    assert.equal(readCompletedEdit(db, 'sess_1234-abcd', 'call_123', cwd).readFileState.content, 'new\n');
    assert.equal(readCompletedEdit(db, 'sess_abcd', 'call_123', cwd), null);
    assert.equal(readCompletedEdit(db, 'sess_1234-abcd', 'call_other', cwd), null);
    assert.equal(readCompletedEdit(db, 'sess_1234-abcd', 'call_123', path.join(cwd, 'other')), null);
    insert();
    assert.equal(readCompletedEdit(db, 'sess_1234-abcd', 'call_123', cwd), null);
    for (const invalidate of [
      value => { value.state.metadata.display.truncated = true; },
      value => { value.state.metadata.serialization = { truncated: true }; },
      value => { value.state.metadata.readFileState.path = path.join(cwd, 'wrong.txt'); },
      value => { value.state.metadata.readFileState.content = 'x'.repeat(2097153); },
      value => { value.state.status = 'running'; },
    ]) {
      db.exec('DELETE FROM part');
      const invalid = structuredClone(part);
      invalid.state.metadata.readFileState.isPartialView = false;
      invalidate(invalid);
      db.prepare('INSERT INTO part VALUES (?, ?)').run('sess_1234-abcd', JSON.stringify(invalid));
      assert.equal(readCompletedEdit(db, 'sess_1234-abcd', 'call_123', cwd), null);
    }
    db.exec('DELETE FROM part');
    part.state.metadata.readFileState.isPartialView = true;
    insert();
    assert.equal(readCompletedEdit(db, 'sess_1234-abcd', 'call_123', cwd), null);
  } finally { db.close(); }
});
