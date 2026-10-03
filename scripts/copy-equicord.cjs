// Copia el build web de Equicord a murcord-app/equicord para que el instalador lo incluya.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = process.env.MURCORD_EQUICORD_DIR || path.join(root, '..', 'Murcord', 'dist');
const dest = path.join(root, 'equicord');

if (!fs.existsSync(path.join(src, 'Equicord.user.js'))) {
  console.error(`No se encontró Equicord.user.js en: ${src}`);
  console.error('Compila primero el clon:  cd ..\\Murcord  y luego  pnpm buildWeb');
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
for (const file of ['Equicord.user.js', 'Equicord.user.css']) {
  const from = path.join(src, file);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dest, file));
}
console.log(`Equicord copiado desde ${src}`);
