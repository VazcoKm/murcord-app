// Ajusta el package.json de murcord-app para Murcord.
// Uso (una sola vez):  node patch-package.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

pkg.name = 'murcord';
pkg.productName = 'Murcord';
pkg.version = '0.1.0';
pkg.description = 'Murcord: cliente de Discord con pestañas y perfiles';
pkg.author = 'VazcoKm';
pkg.license = 'GPL-3.0-or-later';
pkg.type = 'commonjs';
pkg.main = 'src/main/index.js';
pkg.scripts = Object.assign({}, pkg.scripts, {
  start: 'electron .',
  dist: 'electron-builder',
});
pkg.build = {
  appId: 'com.vazcokm.murcord',
  productName: 'Murcord',
  directories: { output: 'dist-app' },
  files: ['src/**/*', 'resources/**/*', 'package.json'],
  win: { target: 'nsis', icon: 'build/icon.ico' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
};

fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log('package.json actualizado para Murcord.');
