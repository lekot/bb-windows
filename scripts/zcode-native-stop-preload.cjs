const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const entry = process.argv[1] && path.resolve(process.argv[1]);
if (entry && path.basename(entry) === 'zcode.cjs' && process.argv[2] === 'app-server') {
  const original = Module._extensions['.js'];
  Module._extensions['.js'] = function load(module, filename) {
    if (path.resolve(filename) !== entry) return original(module, filename);
    const source = fs.readFileSync(filename, 'utf8');
    const needle = 'n.activeAbortController?.abort(new Error("ZCode Protocol session stopped")),i&&await Zh(e,n,"session_stop_goal_paused")';
    if (source.split(needle).length !== 2 || !source.includes('stopActiveForegroundExecution=mUr')) {
      throw new Error('Unsupported ZCode native stop implementation; bb compatibility patch refused');
    }
    const patched = source.replace(needle, 'n.app.runtime.stopActiveForegroundExecution({reason:"bb session stop",preserveQueueAutoDrainOnCancel:false}),'+needle);
    Module._extensions['.js'] = original;
    module._compile(patched, filename);
  };
}
