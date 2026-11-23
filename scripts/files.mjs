import { readFile, writeFile, rename } from 'node:fs/promises';

export const dataFile = name => new URL('../data/' + name, import.meta.url);

export async function readJSON(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function saveJSON(file, value, {compact = false} = {}) {
  const temporary = new URL(file.href + '.' + process.pid + '.tmp');
  await writeFile(temporary, JSON.stringify(value, null, compact ? undefined : 2) + '\n');
  await rename(temporary, file);
}
