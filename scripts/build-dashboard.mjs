#!/usr/bin/env node
// Organization dashboard generator. Only publication-safe metadata is written.
// Source: default-branch commits, open issue/PR titles, workflow outcomes and repo names.
import fs from 'node:fs/promises';

const ORG = 'LinkBabyPL';
const TOKEN = process.env.DASHBOARD_TOKEN;
if (!TOKEN) throw new Error('Missing LINKBABY_DASHBOARD_TOKEN. No partial dashboard will be published.');
const baseHeaders = {
  Accept: 'application/vnd.github+json',
  Authorization: 'Bearer ' + TOKEN,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'linkbaby-organization-dashboard'
};

async function api(path, optionalStatuses = []) {
  const response = await fetch('https://api.github.com' + path, { headers: baseHeaders, signal: AbortSignal.timeout(30000) });
  if (optionalStatuses.includes(response.status)) return null;
  if (!response.ok) {
    const message = (await response.text()).slice(0, 300);
    throw new Error('GitHub API ' + response.status + ' on ' + path.split('?')[0] + ': ' + message);
  }
  return response.json();
}

async function pages(path, { limit = 60, optionalStatuses = [], unwrap = null } = {}) {
  const items = [];
  for (let page = 1; page <= limit; page++) {
    const join = path.includes('?') ? '&' : '?';
    const result = await api(path + join + 'per_page=100&page=' + page, optionalStatuses);
    if (result === null) return items;
    const batch = unwrap ? result[unwrap] : result;
    if (!Array.isArray(batch)) throw new Error('Non-array paginated response for ' + path);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error('Pagination limit reached for ' + path + '; refusing to publish incomplete totals.');
}

const safe = value => String(value ?? '').replace(/[\r\n\t]/g, ' ').replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;')
  .replace(/[\u0000-\u001f]/g, ' ').slice(0, 180);
const date = value => value ? new Date(value).toISOString().slice(0, 10) : '-';
const repoLink = repo => 'https://github.com/' + ORG + '/' + encodeURIComponent(repo.name);
const repoLabel = repo => '[' + safe(repo.name) + '](' + repoLink(repo) + ')';
const isoDay = value => new Date(value).toISOString().slice(0, 10);

const now = new Date();
const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const mondayOffset = (current.getUTCDay() + 6) % 7;
const firstDay = new Date(current.getTime() - (mondayOffset + 12 * 7) * 86400000);
const after = firstDay.toISOString();
const startDay = isoDay(firstDay);
const dayCounts = new Map();
for (let i = 0; i < 91; i++) dayCounts.set(isoDay(new Date(firstDay.getTime() + i * 86400000)), 0);

const repos = await pages('/orgs/' + ORG + '/repos?type=all&sort=pushed&direction=desc', { limit: 10 });
// Access control for this public dashboard: never silently publish a public-only
// snapshot if the read-only credential loses private organization access.
// Update these baselines when repositories are intentionally removed.
const MIN_EXPECTED_REPOS = 20;
const MIN_EXPECTED_PRIVATE = 19;
const REQUIRED_PRIVATE_NAMES = [
  'browser-automation-runtime',
  'django-at-pythonanywhere',
  'powerbi-management-cockpit'
];
const visiblePrivate = repos.filter(r => r.private);
const names = new Set(visiblePrivate.map(r => r.name));
const missing = REQUIRED_PRIVATE_NAMES.filter(name => !names.has(name));
if (repos.length < MIN_EXPECTED_REPOS ||
    visiblePrivate.length < MIN_EXPECTED_PRIVATE ||
    missing.length) {
  throw new Error(
    'Incomplete GitHub token coverage: found ' + repos.length + ' repositories (' +
    visiblePrivate.length + ' private), expected at least ' + MIN_EXPECTED_REPOS +
    ' total / ' + MIN_EXPECTED_PRIVATE + ' private. Missing key private repos: ' +
    (missing.join(', ') || 'none') +
    '. Check fine-grained PAT Resource owner = LinkBabyPL, repository access = All repositories, ' +
    'organization approval, and Actions secret LINKBABY_DASHBOARD_TOKEN. ' +
    'Aborting to preserve the previous dashboard instead of publishing incorrect zeros.'
  );
}
const states = [];
for (let i = 0; i < repos.length; i += 4) {
  const group = await Promise.all(repos.slice(i, i + 4).map(async repo => {
    const full = encodeURIComponent(ORG) + '/' + encodeURIComponent(repo.name);
    const commits = await pages('/repos/' + full + '/commits?sha=' + encodeURIComponent(repo.default_branch || 'main') + '&since=' + encodeURIComponent(after),
      { limit: 60, optionalStatuses: [409] });
    const workItems = await pages('/repos/' + full + '/issues?state=open&sort=updated&direction=desc', { limit: 30 });
    // Actions permission is optional. Its absence must not be mistaken for a passing CI run.
    const runs = await api('/repos/' + full + '/actions/runs?per_page=1', [403, 404]);
    const issues = workItems.filter(item => !item.pull_request);
    const prs = workItems.filter(item => item.pull_request);
    return {
      repo, commits, issues, prs,
      workflow: runs === null ? 'not available'
        : !runs.workflow_runs?.length ? 'not configured'
        : runs.workflow_runs[0].status !== 'completed' ? 'running'
        : runs.workflow_runs[0].conclusion || 'unknown'
    };
  }));
  states.push(...group);
}
const commits = [];
const issues = [];
const prs = [];
for (const item of states) {
  issues.push(...item.issues.map(x => ({ ...x, repo: item.repo })));
  prs.push(...item.prs.map(x => ({ ...x, repo: item.repo })));
  if (item.repo.name !== '.github') {
    for (const commit of item.commits) {
      const timestamp = commit.commit?.committer?.date || commit.commit?.author?.date;
      if (!timestamp) continue;
      const key = timestamp.slice(0, 10);
      if (dayCounts.has(key)) dayCounts.set(key, dayCounts.get(key) + 1);
      commits.push({ repo: item.repo, sha: commit.sha, message: commit.commit?.message || '(no message)', date: timestamp });
    }
  }
}
commits.sort((a,b) => b.date.localeCompare(a.date));
issues.sort((a,b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
prs.sort((a,b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
states.sort((a,b) => (b.repo.pushed_at || '').localeCompare(a.repo.pushed_at || ''));
const priv = repos.filter(r => r.private).length;
const failures = states.filter(s => s.workflow === 'failure' || s.workflow === 'timed_out').length;
const unavailable = states.filter(s => s.workflow === 'not available').length;
const totalCommits = [...dayCounts.values()].reduce((a,b)=>a+b,0);

function heatmap() {
  const w = 840, h = 178, ox = 70, oy = 40, cell = 12, gap = 4;
  const shades = ['#161b22','#0e4429','#006d32','#26a641','#39d353'];
  const max = Math.max(1, ...dayCounts.values());
  let out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
    '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Commits per UTC day over the last 13 weeks">';
  out += '<rect width="100%" height="100%" rx="12" fill="#0d1117"/>';
  out += '<text x="18" y="22" fill="#e6edf3" font-size="14" font-family="sans-serif">Default-branch commits per day · 13 weeks</text>';
  ['Mon','Wed','Fri'].forEach((label,i) => {
    out += '<text x="18" y="' + (oy + (i*2)* (cell+gap) + 10) +
      '" fill="#8b949e" font-size="11" font-family="sans-serif">' + label + '</text>';
  });
  [...dayCounts.entries()].forEach(([day,count],idx) => {
    const col = Math.floor(idx/7), row = idx%7;
    const level = count===0 ? 0 : Math.min(4, 1+Math.floor(count/max*3.99));
    const x=ox+col*(cell+gap), y=oy+row*(cell+gap);
    out += '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell +
      '" rx="2" fill="' + shades[level] + '"><title>' + day + ': ' + count + ' commits</title></rect>';
  });
  out += '<text x="300" y="159" fill="#8b949e" font-size="12" font-family="sans-serif">' +
    totalCommits + ' commits · UTC dates · excludes dashboard automation</text>';
  out += '<text x="655" y="40" fill="#8b949e" font-size="12" font-family="sans-serif">Less</text>';
  shades.forEach((color,i)=> {out += '<rect x="' + (685+i*18) + '" y="49" width="12" height="12" rx="2" fill="' + color + '"/>';});
  out += '<text x="780" y="60" fill="#8b949e" font-size="12" font-family="sans-serif">More</text>';
  return out + '</svg>\n';
}

const rows = [];
rows.push('# LinkBabyPL · Engineering dashboard');
rows.push('');
rows.push('**GitHub organization overview** · Updated ' + now.toISOString().replace('T',' ').slice(0,16) + ' UTC');
rows.push('');
rows.push('> **Public dashboard:** Includes repository names, commit messages, issue and pull-request titles, and activity metadata from **both private and public repositories**. Private source code and issue bodies are not copied here. Links into private repositories work only for authorized members.');
rows.push('');
rows.push('| Repositories | Private | Public | Open issues | Open PRs | Latest CI failures |');
rows.push('| ---: | ---: | ---: | ---: | ---: | ---: |');
rows.push('| **'+repos.length+'** | **'+priv+'** | **'+(repos.length-priv)+'** | **'+issues.length+'** | **'+prs.length+'** | **'+failures+'**'+(unavailable?'*':'')+' |');
rows.push('');
rows.push('## Commit activity');
rows.push('');
rows.push('![Default-branch commit heatmap](./assets/commit-heatmap.svg)');
rows.push('');
rows.push('**'+totalCommits+' commits** on default branches during the 13-week period starting '+startDay+' (UTC). The dashboard repository itself is excluded.');
rows.push('');
rows.push('## Recent commits');
rows.push('');
rows.push('| Date (UTC) | Repository | Commit |');
rows.push('| --- | --- | --- |');
for (const item of commits.slice(0, 12)) {
  rows.push('| '+date(item.date)+' | '+repoLabel(item.repo)+' | ['+safe(item.message.split('\n')[0]).slice(0,100)+'](https://github.com/'+ORG+'/'+encodeURIComponent(item.repo.name)+'/commit/'+item.sha+') |');
}
if (!commits.length) rows.push('| - | - | No commits within this period |');
rows.push('');
rows.push('## Open issues');
rows.push('');
rows.push('| Repository | Issue | Updated |');
rows.push('| --- | --- | --- |');
for (const item of issues.slice(0,12)) {
  rows.push('| '+repoLabel(item.repo)+' | [#'+item.number+' '+safe(item.title)+'](https://github.com/'+ORG+'/'+encodeURIComponent(item.repo.name)+'/issues/'+item.number+') | '+date(item.updated_at)+' |');
}
if (!issues.length) rows.push('| - | No open issues | - |');
rows.push('');
rows.push('## Open pull requests');
rows.push('');
if (prs.length) {
  rows.push('| Repository | Pull request | Updated |');
  rows.push('| --- | --- | --- |');
  for (const item of prs.slice(0,12)) {
    rows.push('| '+repoLabel(item.repo)+' | [#'+item.number+' '+safe(item.title)+'](https://github.com/'+ORG+'/'+encodeURIComponent(item.repo.name)+'/pull/'+item.number+') | '+date(item.updated_at)+' |');
  }
} else rows.push('No open pull requests.');
rows.push('');
rows.push('## Repository health');
rows.push('');
rows.push('| Repository | Visibility | Last push | Open issues | Open PRs | Latest workflow |');
rows.push('| --- | --- | --- | ---: | ---: | --- |');
for (const {repo,issues:openIssues,prs:openPrs,workflow} of states) {
  rows.push('| '+repoLabel(repo)+' | '+(repo.private?'Private':'Public')+' | '+date(repo.pushed_at)+' | '+openIssues.length+' | '+openPrs.length+' | '+safe(workflow)+' |');
}
rows.push('');
rows.push('---');
rows.push('');
rows.push('<sub>Automatically generated from GitHub APIs. Commit counts cover default-branch history, not every unmerged feature branch. Latest workflow is not a guarantee of overall repository health. '+(unavailable?'*Some CI results are unavailable to the configured token. ':'')+'Private metadata displayed here is publicly visible. Generator: [scripts/build-dashboard.mjs](https://github.com/'+ORG+'/.github/blob/main/scripts/build-dashboard.mjs).</sub>');
rows.push('');
await fs.mkdir('profile/assets', { recursive: true });
await fs.writeFile('profile/assets/commit-heatmap.svg', heatmap(), 'utf8');
await fs.writeFile('profile/README.md', rows.join('\n'), 'utf8');
console.log('Updated dashboard: '+repos.length+' repositories, '+totalCommits+' commits, '+issues.length+' issues, '+prs.length+' PRs.');
