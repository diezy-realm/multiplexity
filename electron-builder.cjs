module.exports = {
  appId: 'internal.manager-system.desktop',
  productName: 'Multiplexity',
  directories: { app: 'desktop-dist/shell', output: 'release' },
  // Electron loads its shell from ASAR; the Node backend uses traced physical files.
  asar: true,
  npmRebuild: false,
  afterPack: async context => require('./scripts/verify-desktop-package.cjs').verifyPackage(context.appOutDir),
  beforePack: async context => {
    if (process.platform !== 'win32' || process.arch !== 'x64' ||
        context.electronPlatformName !== 'win32' || context.arch !== 1) {
      throw new Error('Installer desktop harus dibuat pada Windows x64 untuk target Windows x64.');
    }
  },
  files: ['desktop/**/*.cjs', 'desktop/licenses/*.txt', 'package.json', '!node_modules{,/**/*}'],
  extraResources: [{ from: 'desktop-dist/backend', to: 'backend', filter: [
    '**/*',
    '!**/.env*',
    '!**/config.json',
    '!**/*.db',
    '!**/*.db-wal',
    '!**/*.db-shm',
    '!**/.test-artifacts/**',
    '!**/.test-tmp/**',
  ] }, {
    // electron-builder excludes a source root named node_modules from generic copies.
    from: 'desktop-dist/backend/node_modules', to: 'backend/node_modules',
    filter: ['**/*', '!**/.env*', '!**/config.json', '!**/*.db', '!**/*.db-wal', '!**/*.db-shm'],
  }],
  win: { target: ['nsis'], icon:'public/brand/multiplexity.ico', artifactName: '${productName}-Setup-${version}-${arch}.${ext}', signAndEditExecutable: false },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
};
