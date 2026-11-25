import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dataFile } from './files.mjs';
import { overviewFragments } from '../lib/overview.js';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const snapshotJSON = await readFile(dataFile('latest.json'), 'utf8');
const snapshot = JSON.parse(snapshotJSON);
if (snapshot.schemaVersion !== 1 || !Number.isFinite(Date.parse(snapshot.lastDay + 'T00:00:00Z')) || !snapshot.supply?.history?.length) {
  throw Error('Missing validated daily snapshot');
}

const template = await readFile(new URL('index.html', root), 'utf8');
const fragments = overviewFragments(snapshot);
const remaining = new Set(Object.keys(fragments));
const html = template.replace(/<!--snapshot:([\w-]+)-->[\s\S]*?<!--\/snapshot-->/g, (_, id) => {
  if (!remaining.delete(id)) throw Error('Unexpected or repeated snapshot placeholder: ' + id);
  return fragments[id];
});
if (remaining.size) throw Error('Missing snapshot placeholders: ' + [...remaining].join(', '));

await mkdir(new URL('data/', dist), {recursive: true});
await mkdir(new URL('lib/', dist), {recursive: true});
for (const file of ['.nojekyll', 'CNAME', '404.html', 'styles.css', 'app.js', 'assets', 'lib/config.js', 'lib/holders.js', 'lib/burn-cover.js', 'lib/buyback-recap.js', 'lib/burn-value.js', 'lib/format.js', 'lib/overview.js']) {
  await cp(new URL(file, root), new URL(file, dist), {recursive: true});
}
await writeFile(new URL('data/latest.json', dist), snapshotJSON);
await writeFile(new URL('index.html', dist), html);
console.log('Built static site in dist/ with data to ' + snapshot.lastDay);
