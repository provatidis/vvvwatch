import { cp, mkdir } from 'node:fs/promises';
import { dataFile, readJSON } from './files.mjs';
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const snapshot = await readJSON(dataFile('latest.json'));
if (snapshot.schemaVersion !== 1 || !snapshot.lastDay || !snapshot.supply?.history?.length) {
  throw Error('Missing validated daily snapshot');
}
await mkdir(new URL('data/', dist), {recursive: true});
await mkdir(new URL('lib/', dist), {recursive: true});
for (const file of ['.nojekyll', 'index.html', 'styles.css', 'app.js', 'assets', 'lib/config.js', 'data/latest.json']) {
  await cp(new URL(file, root), new URL(file, dist), {recursive: true});
}
console.log('Built static site in dist/ with data to ' + snapshot.lastDay);
