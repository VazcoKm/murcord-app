// Configura package.json para publicar y actualizar Murcord desde GitHub Releases.
// Uso (una sola vez):  node scripts/patch-updater.cjs
const fs = require('fs');
const path = require('path');

const OWNER = 'VazcoKm';
const REPO = 'murcord-app';   // repositorio de GitHub donde se publican las versiones
const VERSION = '0.2.0';      // primera versión que incluye el actualizador

const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

pkg.version = VERSION;
pkg.repository = `https://github.com/${OWNER}/${REPO}`;
pkg.homepage = `https://github.com/${OWNER}/${REPO}`;
pkg.scripts = Object.assign({}, pkg.scripts, {
  release: 'node scripts/copy-equicord.cjs && electron-builder --publish always',
});
pkg.build = Object.assign({}, pkg.build, {
  publish: [{ provider: 'github', owner: OWNER, repo: REPO, releaseType: 'release' }],
});

fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json listo: versión ${VERSION}, publicación en github.com/${OWNER}/${REPO}`);
