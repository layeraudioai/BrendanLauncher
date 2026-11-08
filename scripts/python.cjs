'use strict';
// Shared Python executable selection for native Windows, MSYS2 and Unix builds.
function pythonCommand() {
  return process.env.PYTHON || process.env.PYTHON3 || (process.platform === 'win32' ? 'python' : 'python3');
}
module.exports = {pythonCommand};
