#!/usr/bin/env node
// Build data/builders.json from the df26-cohort GitHub team.
//
// Source of truth for membership = the GitHub team. This script reads the team,
// drops program staff (config `exclude`), enriches each remaining member with
// their public GitHub profile + residency project repo, applies the visibility
// gate, and writes data/builders.json in the shape index.html already renders.
//
// Run locally:   GITHUB_TOKEN=ghp_xxx node scripts/build-builders.mjs
// In CI:         the workflow passes a token via GITHUB_TOKEN.
//
// No npm dependencies — Node 18+ (built-in fetch) and a minimal YAML reader.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(ROOT, 'data/builders-config.yml');
const OUT_PATH = resolve(ROOT, 'data/builders.json');

const TOKEN = process.env.GITHUB_TOKEN || process.env.BUILDERS_TOKEN || '';
const API = 'https://api.github.com';

// ── tiny YAML reader ─────────────────────────────────────────────────────────
// Handles only the shapes builders-config.yml uses: top-level scalars, a
// `- item` list under a key, and `key: value` maps under a key. Comments and
// blank lines ignored. Deliberately not a general YAML parser.
function parseConfig(text) {
  const cfg = { exclude: [], roles: {}, projects: {} };
  let section = null; // 'exclude' | 'roles' | 'projects' | null
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
    } else if (section === 'exclude') {
      const m = line.match(/^\s*-\s*(.+)$/);
      if (m) cfg.exclude.push(m[1].trim());
    } else if (section === 'roles' || section === 'projects') {
      const m = line.match(/^\s*([\w.-]+):\s*(.+)$/);
      if (m) cfg[section][m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return cfg;
}

async function gh(path, { raw = false } = {}) {
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
  return raw ? res : res.json();
}

// All team members (paginated).
async function fetchTeamMembers(org, team) {
  const members = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`/orgs/${org}/teams/${team}/members?per_page=100&page=${page}`);
    if (!batch || batch.length === 0) break;
    members.push(...batch);
    if (batch.length < 100) break;
  }
  return members;
}

// Pick the builder's residency project repo: config override, else the most
// recently pushed repo in the org that the builder administers.
async function resolveProjectRepo(login, org, override) {
  if (override) {
    const repo = await gh(`/repos/${override}`);
    return repo;
  }
  const repos = await gh(`/users/${login}/repos?per_page=100&sort=pushed&type=all`);
  if (!repos) return null;
  const inOrg = repos.filter(
    (r) => r.owner?.login?.toLowerCase() === org.toLowerCase() && r.permissions?.admin
  );
  return inOrg[0] || null;
}

// Is `login` an admin collaborator on this repo? Checks the BUILDER's
// permission, not the token's — the correct gate for public-only launch.
async function isBuilderAdmin(login, fullName) {
  const perm = await gh(`/repos/${fullName}/collaborators/${login}/permission`);
  return perm?.permission === 'admin';
}

function firstName(name, login) {
  return (name || login || '').trim();
}

async function main() {
  const cfg = parseConfig(readFileSync(CONFIG_PATH, 'utf8'));
  const org = cfg.org || 'TrailblazerLabs';
  const team = cfg.team || 'df26-cohort';
  const mode = (cfg.visibility_mode || 'all').toLowerCase();
  const exclude = new Set((cfg.exclude || []).map((s) => s.toLowerCase()));

  if (!TOKEN) {
    console.warn('⚠  No GITHUB_TOKEN set — team membership read will likely fail (org data is private).');
  }
  console.log(`▶ org=${org} team=${team} visibility=${mode}`);

  const members = await fetchTeamMembers(org, team);
  const builders = members.filter((m) => !exclude.has(m.login.toLowerCase()));
  console.log(`  team members: ${members.length}  builders after exclude: ${builders.length}`);

  const out = [];
  for (const m of builders) {
    const login = m.login;
    const profile = await gh(`/users/${login}`);
    if (!profile) { console.warn(`  ! no profile for ${login}, skipping`); continue; }

    const repo = await resolveProjectRepo(login, org, cfg.projects?.[login]);

    // Visibility gate.
    if (mode === 'public-only') {
      if (!repo || repo.private) {
        console.log(`  – ${login}: skipped (no public residency repo)`);
        continue;
      }
      const admin = await isBuilderAdmin(login, repo.full_name);
      if (!admin) {
        console.log(`  – ${login}: skipped (not admin of ${repo.full_name})`);
        continue;
      }
    }

    out.push({
      name: firstName(profile.name, login),
      github: login,
      avatar: profile.avatar_url,
      country: profile.location || '',
      role: cfg.roles?.[login] || '',
      bio: profile.bio || '',
      project: repo
        ? { title: repo.name, url: repo.html_url }
        : { title: '', url: '' },
    });
    console.log(`  ✓ ${login}${repo ? ` → ${repo.full_name}${repo.private ? ' (private)' : ''}` : ' (no repo)'}`);
  }

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`▶ wrote ${out.length} builders → data/builders.json`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
