const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

async function loadSettings(directory, safeStorage) {
  if (!await safeStorage.isAsyncEncryptionAvailable()) {
    throw new Error('Penyimpanan kredensial aman OS tidak tersedia.');
  }
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'desktop-secrets.bin');
  if (fs.existsSync(filename)) {
    const decrypted = await safeStorage.decryptStringAsync(fs.readFileSync(filename));
    const settings = JSON.parse(decrypted.result);
    if (!/^[a-f0-9]{64}$/.test(settings.encryptionKey) || !/^[a-f0-9]{64}$/.test(settings.authSecret)) {
      throw new Error('Konfigurasi desktop tidak valid. Pulihkan backup data beserta kuncinya.');
    }
    return settings;
  }
  // Never silently replace a missing key for an existing credential database.
  if (fs.existsSync(path.join(directory, 'dashboard.db'))) {
    throw new Error('Kunci desktop hilang. Pulihkan desktop-secrets.bin dari backup perangkat ini.');
  }
  const settings = {
    encryptionKey: randomBytes(32).toString('hex'),
    authSecret: randomBytes(32).toString('hex'),
  };
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(settings));
  fs.writeFileSync(filename, encrypted, { flag: 'wx', mode: 0o600 });
  return settings;
}

module.exports = { loadSettings };
