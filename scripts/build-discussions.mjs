#!/usr/bin/env node
// Build data/discussions.json from the community-hub repo's GitHub Discussions.
//
// Source of truth = every discussion in the community-hub repo, across all
// categories (Announcements, General, Ideas, Q&A, Show and tell). Unlike the
// pitches pipeline this DOES NOT exclude any authors: internal Salesforce folks
// are welcome here, and a program Announcement should surface on the site.
// Announcements are floated to the top; everything else follows by most-recent
// activity. Writes data/discussions.json in the shape engage.html's #community
// list renders.
//
// Run locally:   GITHUB_TOKEN=github_pat_xxx node scripts/build-discussions.mjs
// In CI:         the workflow passes a token via GITHUB_TOKEN.
//
// The token needs Repository -> Discussions: Read on the fine-grained PAT while
// the repo is private (visibility_mode: all). See the 403 remediation below.
//
// No npm dependencies - Node 18+ (built-in fetch) and a minimal YAML reader.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(ROOT, 'data/discussions-config.yml');
const OUT_PATH = resolve(ROOT, 'data/discussions.json');

const TOKEN = process.env.GITHUB_TOKEN || process.env.BUILDERS_TOKEN || '';
const GRAPHQL = 'https://api.github.com/graphql';

// -- tiny YAML reader --------------------------------------------------------
// Handles only the shapes discussions-config.yml uses: top-level scalars.
// Comments and blank lines ignored. Deliberately not a general YAML parser.
function parseConfig(text) {
  const cfg = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^\s+/.test(raw)) continue; // no nested lists in this config
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (val !== '') cfg[key] = val.trim();
  }
  return cfg;
}

async function ghGraphQL(query, variables) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'trailblazerlabs-site-builder',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    const msg = json.errors ? json.errors.map((e) => e.message).join('; ') : `HTTP ${res.status}`;
    const forbidden =
      res.status === 401 || res.status === 403 ||
      (json.errors || []).some((e) => /forbidden|permission|scope|not have|resource not accessible/i.test(e.message || ''));
    if (forbidden) {
      console.error(
        'GitHub rejected the discussions query (auth/permission).\n' +
        '  Fix: add Repository -> Discussions: Read to the BUILDERS_TOKEN\n' +
        '       fine-grained PAT (and grant it access to the community-hub repo).\n' +
        `  Detail: ${msg}`
      );
      process.exit(1);
    }
    throw new Error(`GraphQL error: ${msg}`);
  }
  return json.data;
}

const DISCUSSIONS_QUERY = `
query($owner:String!, $repo:String!, $after:String) {
  repository(owner:$owner, name:$repo) {
    isPrivate
    discussions(first:50, after:$after, orderBy:{field:UPDATED_AT, direction:DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        url
        bodyText
        updatedAt
        comments { totalCount }
        category { name }
        author { login avatarUrl }
      }
    }
  }
}`;

async function fetchDiscussions(owner, repo) {
  const all = [];
  let isPrivate = false;
  let after = null;
  for (;;) {
    const data = await ghGraphQL(DISCUSSIONS_QUERY, { owner, repo, after });
    const r = data?.repository;
    if (!r) throw new Error(`Repository ${owner}/${repo} not found (or no access).`);
    isPrivate = r.isPrivate;
    const conn = r.discussions;
    all.push(...(conn?.nodes || []));
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return { discussions: all, isPrivate };
}

// Trim a chunk of text to a card-sized excerpt.
function clamp(text, max = 180) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3).replace(/\s+\S*$/, '') + '...';
}

async function main() {
  const cfg = parseConfig(readFileSync(CONFIG_PATH, 'utf8'));
  const org = cfg.org || 'TrailblazerLabs';
  const repo = cfg.repo || 'community-hub';
  const mode = (cfg.visibility_mode || 'all').toLowerCase();

  if (!TOKEN) {
    console.warn('!  No GITHUB_TOKEN set - discussions read will likely fail (private repo data).');
  }
  console.log(`> org=${org} repo=${repo} visibility=${mode}`);

  const { discussions, isPrivate } = await fetchDiscussions(org, repo);
  console.log(`  discussions fetched: ${discussions.length}  repo private: ${isPrivate}`);

  if (mode === 'public-only' && isPrivate) {
    console.log('  repo is private and visibility_mode=public-only -> writing empty discussions.json');
    writeFileSync(OUT_PATH, JSON.stringify([], null, 2) + '\n');
    return;
  }

  const out = discussions.map((d) => ({
    author: d.author?.login || org,
    avatar: d.author?.avatarUrl || '',
    title: (d.title || '').trim(),
    excerpt: clamp(d.bodyText),
    category: d.category?.name || '',
    comments: d.comments?.totalCount || 0,
    updatedAt: d.updatedAt || '',
    url: d.url,
  }));

  // Announcements first; then most-recent activity within each bucket.
  const isAnnouncement = (c) => (c || '').toLowerCase() === 'announcements';
  out.sort((a, b) => {
    const aa = isAnnouncement(a.category);
    const ba = isAnnouncement(b.category);
    if (aa !== ba) return aa ? -1 : 1;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`> wrote ${out.length} discussions -> data/discussions.json`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
