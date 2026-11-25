const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function openCliLogin(message) {
  const names = { codex: 'codex.exe', kiro: 'kiro-cli.exe', antigravity: 'agy.exe' };
  const expected = names[message.provider];
  if (process.platform !== 'win32' || !expected || typeof message.executable !== 'string' ||
      !path.isAbsolute(message.executable) || path.basename(message.executable).toLowerCase() !== expected ||
      /[\r\n\x00]/.test(message.executable) || !fs.existsSync(message.executable)) return;
  const executable = message.executable.replace(/'/g, "''");
  const command = Buffer.from(`& '${executable}'${message.provider === 'antigravity' ? '' : ' login'}`, 'utf16le').toString('base64');
  const environment = {};
  for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  const terminal = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', command],
    { cwd: os.tmpdir(), windowsHide: false, detached: true, stdio: 'ignore', env: environment });
  terminal.on('error', () => {});
  terminal.unref();
}

module.exports = { openCliLogin };
