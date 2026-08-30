#!/usr/bin/env node
// Build data/community-assets.json from the TrailblazerLabs org repos.
//
// Source of truth = the org's repos (only the program creates repos). This
// script lists them, drops infra/admin repos (config `exclude_repos`), applies
// the visibility gate, and for each remaining repo emits a card: friendly
// title, GitHub description, Topics as tags, license, repo link, and the
// builder (repo admin who is not program staff) as the author.
//
// Run locally:   GITHUB_TOKEN=ghp_xxx node scripts/build-assets.mjs
// In CI:         the workflow passes a token via GITHUB_TOKEN.
//
// No npm dependencies - Node 18+ (built-in fetch) and a minimal YAML reader.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(ROOT, 'data/community-assets-config.yml');
const OUT_PATH = resolve(ROOT, 'data/community-assets.json');

const TOKEN = process.env.GITHUB_TOKEN || process.env.BUILDERS_TOKEN || '';
const API = 'https://api.github.com';

// -- tiny YAML reader --------------------------------------------------------
// Handles only the shapes community-assets-config.yml uses: top-level scalars,
// `- item` lists under a key, and `key: value` maps under a key. Comments and
// blank lines ignored. Deliberately not a general YAML parser.
function parseConfig(text) {
  const cfg = { exclude_repos: [], exclude_authors: [], builders: {}, titles: {} };
  let section = null; // 'exclude_repos' | 'exclude_authors' | 'builders' | 'titles' | null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indented = /^\s+/.test(raw);
    if (!indented) {
      const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!m) { section = null; continue; }
      const [, key, val] = m;
      if (val === '') { section = key; continue; }
      section = null;
      cfg[key] = val.trim();
    } else if (section === 'exclude_repos' || section === 'exclude_authors') {
      const m = line.match(/^\s*-\s*(.+)$/);
      if (m) cfg[section].push(m[1].trim());
    } else if (section === 'builders' || section === 'titles') {
      const m = line.match(/^\s*([\w.-]+):\s*(.+)$/);
      if (m) cfg[section][m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return cfg;
}

async function gh(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'trailblazerlabs-site-builder',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// All repos in the org (paginated). type=all returns private too when the
// token permits; public-only mode filters repo.private afterwards.
async function fetchOrgRepos(org) {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/orgs/${org}/repos?per_page=100&type=all&sort=pushed&page=${page}`);
    if (!batch || batch.length === 0) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

// The builder credited on the card. Priority:
//   1. config `builders:` pin for this repo (always wins)
//   2. the first admin collaborator whose login is not program staff
//      (exclude_authors) AND is a direct collaborator (not org base-role)
//   3. fallback to the org itself
async function resolveBuilder(repoName, fullName, org, excludeAuthors, pin) {
  if (pin) {
    const user = await gh(`/users/${pin}`);
    return { login: pin, avatar: user?.avatar_url || '' };
  }
  const collabs = await gh(`/repos/${fullName}/collaborators?affiliation=direct&per_page=100`);
  if (Array.isArray(collabs)) {
    const builder = collabs.find(
      (c) => c.permissions?.admin && !excludeAuthors.has(c.login.toLowerCase())
    );
    if (builder) {
      return { login: builder.login, avatar: builder.avatar_url };
    }
  }
  const orgProfile = await gh(`/orgs/${org}`);
  return { login: org, avatar: orgProfile?.avatar_url || '' };
}

// The three development tracks are set as a GitHub topic on each repo.
// Pull the track out of the topic list so the site can filter/badge by it;
// remaining topics stay as free-form category tags.
const TRACK_TOPICS = { strategist: 'Strategist', builder: 'Builder', engineer: 'Engineer' };
function splitTrack(names) {
  let track = '';
  const tags = [];
  for (const n of names) {
    const label = TRACK_TOPICS[String(n).toLowerCase()];
    if (label && !track) track = label;
    else tags.push(n);
  }
  return { track, tags };
}

// case-deflection-companion -> "Case Deflection Companion"
function friendlyTitle(name) {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function licenseLabel(license) {
  if (!license) return '';
  return license.spdx_id && license.spdx_id !== 'NOASSERTION'
    ? license.spdx_id
    : (license.name || '');
}

async function main() {
  const cfg = parseConfig(readFileSync(CONFIG_PATH, 'utf8'));
  const org = cfg.org || 'TrailblazerLabs';
  const mode = (cfg.visibility_mode || 'all').toLowerCase();
  const excludeRepos = new Set((cfg.exclude_repos || []).map((s) => s.toLowerCase()));
  const excludeAuthors = new Set((cfg.exclude_authors || []).map((s) => s.toLowerCase()));

  if (!TOKEN) {
    console.warn('!  No GITHUB_TOKEN set - org repo read will likely fail (private org data).');
  }
  console.log(`> org=${org} visibility=${mode}`);

  const allRepos = await fetchOrgRepos(org);
  const repos = allRepos.filter((r) => !excludeRepos.has(r.name.toLowerCase()));
  console.log(`  org repos: ${allRepos.length}  after exclude_repos: ${repos.length}`);

  const out = [];
  for (const repo of repos) {
    if (mode === 'public-only' && repo.private) {
      console.log(`  - ${repo.name}: skipped (private, public-only mode)`);
      continue;
    }

    const topicsRes = await gh(`/repos/${repo.full_name}/topics`);
    const { track, tags } = splitTrack(topicsRes?.names || []);

    const builder = await resolveBuilder(
      repo.name, repo.full_name, org, excludeAuthors, cfg.builders?.[repo.name]
    );

    out.push({
      authorName: builder.login,
      authorAvatar: builder.avatar,
      title: cfg.titles?.[repo.name] || friendlyTitle(repo.name),
      description: repo.description || '',
      track,
      tags,
      repo: repo.html_url,
      license: licenseLabel(repo.license),
      stars: repo.stargazers_count || 0,
      forks: repo.forks_count || 0,
    });
    console.log(`  + ${repo.name}${repo.private ? ' (private)' : ''} -> ${builder.login} [${track || 'no-track'}: ${tags.join(', ')}]`);
  }

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`> wrote ${out.length} assets -> data/community-assets.json`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
