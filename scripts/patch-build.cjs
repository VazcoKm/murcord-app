// Ajusta el package.json para empaquetar Murcord con Equicord incluido.
// Uso (una sola vez):  node scripts/patch-build.cjs
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

pkg.scripts = Object.assign({}, pkg.scripts, {
  dist: 'node scripts/copy-equicord.cjs && electron-builder',
  'dist:dir': 'node scripts/copy-equicord.cjs && electron-builder --dir',
});

pkg.build = Object.assign({}, pkg.build, {
  extraResources: [{ from: 'equicord', to: 'equicord' }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build/icon.ico' },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: 'Murcord-Setup-${version}.exe',
    shortcutName: 'Murcord',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
});

fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log('package.json listo para empaquetar.');
