import { dataFile, readJSON } from './files.mjs';

const journal = await readJSON(dataFile('alerts.json'));
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) throw new Error('Issue delivery requires GITHUB_REPOSITORY and GITHUB_TOKEN.');
const endpoint = 'https://api.github.com/repos/' + repo + '/issues';
const headers = {authorization: 'Bearer ' + token, accept: 'application/vnd.github+json',
  'content-type': 'application/json', 'user-agent': 'vvvwatch'};
async function request(suffix, method = 'GET', params) {
  const res = await fetch(endpoint + suffix, {method, headers, signal: AbortSignal.timeout(25_000),
    body: params ? JSON.stringify(params) : undefined});
  if (!res.ok) throw new Error('GitHub Issues returned ' + res.status + ' for ' + method + ' ' + suffix);
  return res.json();
}
if (Object.keys(journal.issues).length) {
  const existing = new Map();
  for (let page = 1; ; page++) {
    const result = await request('?state=all&per_page=100&page=' + page);
    for (const issue of result) {
      const key = issue.body?.match(/^<!-- vvvwatch:([\w-]+) -->/);
      if (key && !issue.pull_request && issue.user?.login === 'github-actions[bot]') existing.set(key[1], issue);
    }
    if (result.length < 100) break;
  }
  for (const [id, wanted] of Object.entries(journal.issues)) {
    const issue = existing.get(id);
    const state = wanted.open ? 'open' : 'closed';
    const body = '<!-- vvvwatch:' + id + ' -->\n' + wanted.body +
      '\n\n[Daily evidence](https://github.com/' + repo + '/tree/main/data)';
    if (!issue && wanted.open) await request('', 'POST', {title: wanted.title, body});
    else if (issue && !wanted.once && (issue.state !== state || issue.body !== body || issue.title !== wanted.title)) {
      await request('/' + issue.number, 'PATCH', {title: wanted.title, body, state});
    }
  }
}
