#!/usr/bin/env node
// Build data/pitches.json from the Cohort-Applications repo's GitHub Discussions.
//
// Source of truth = the discussions in category "Cohort Applications". Each
// discussion is a builder's pitch; the ecosystem upvotes them to signal demand.
// This script pulls those discussions (GraphQL - discussions have no REST list
// endpoint), drops staff test pitches (config exclude_authors), applies the
// visibility gate, and writes data/pitches.json sorted by upvotes desc, in the
// shape index.html's #pitches grid renders.
//
// Run locally:   GITHUB_TOKEN=github_pat_xxx node scripts/build-pitches.mjs
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
const CONFIG_PATH = resolve(ROOT, 'data/pitches-config.yml');
const OUT_PATH = resolve(ROOT, 'data/pitches.json');

const TOKEN = process.env.GITHUB_TOKEN || process.env.BUILDERS_TOKEN || '';
const API = 'https://api.github.com';
const GRAPHQL = 'https://api.github.com/graphql';

// -- tiny YAML reader --------------------------------------------------------
// Handles only the shapes pitches-config.yml uses: top-level scalars and a
// `- item` list under a key. Comments and blank lines ignored. Deliberately
// not a general YAML parser.
function parseConfig(text) {
  const cfg = { exclude_authors: [] };
  let section = null; // 'exclude_authors' | null
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
    } else if (section === 'exclude_authors') {
      const m = line.match(/^\s*-\s*(.+)$/);
      if (m) cfg.exclude_authors.push(m[1].trim());
    }
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
        '       fine-grained PAT (and grant it access to the Cohort-Applications repo).\n' +
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
    discussions(first:50, after:$after, orderBy:{field:CREATED_AT, direction:DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        url
        upvoteCount
        bodyText
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

// The form writes the body as "## Heading\nanswer" blocks. bodyText strips the
// markdown, so headings arrive as plain lines. Pull the answer under a given
// heading (e.g. "Elevator Pitch") rather than flattening the whole body.
function sectionUnder(bodyText, heading) {
  const lines = (bodyText || '').split('\n');
  const start = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
  if (start === -1) return '';
  const known = new Set([
    'elevator pitch', 'problem statement', 'development track',
    'builder profile', 'required acknowledgments', 'submitted by',
  ]);
  const answer = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (known.has(lines[i].trim().toLowerCase())) break;
    answer.push(lines[i]);
  }
  return answer.join(' ').trim();
}

// Card excerpt: prefer the Elevator Pitch answer, then Problem Statement,
// then whatever the body starts with (older/free-form discussions).
function excerptOf(bodyText) {
  const pick =
    sectionUnder(bodyText, 'Elevator Pitch') ||
    sectionUnder(bodyText, 'Problem Statement') ||
    (bodyText || '');
  return clamp(pick);
}

// New pitches submit a bare title. Older discussions used a "[Pitch]: " prefix;
// strip it so those cards match. Leaves other titles as-is.
function cleanTitle(title) {
  return (title || '').replace(/^\s*\[pitch\]:\s*/i, '').trim();
}

async function main() {
  const cfg = parseConfig(readFileSync(CONFIG_PATH, 'utf8'));
  const org = cfg.org || 'TrailblazerLabs';
  const repo = cfg.repo || 'Cohort-Applications';
  const category = (cfg.category || 'Cohort Applications').toLowerCase();
  const mode = (cfg.visibility_mode || 'all').toLowerCase();
  const excludeAuthors = new Set((cfg.exclude_authors || []).map((s) => s.toLowerCase()));

  if (!TOKEN) {
    console.warn('!  No GITHUB_TOKEN set - discussions read will likely fail (private repo data).');
  }
  console.log(`> org=${org} repo=${repo} category="${category}" visibility=${mode}`);

  const { discussions, isPrivate } = await fetchDiscussions(org, repo);
  console.log(`  discussions fetched: ${discussions.length}  repo private: ${isPrivate}`);

  if (mode === 'public-only' && isPrivate) {
    console.log('  repo is private and visibility_mode=public-only -> writing empty pitches.json');
    writeFileSync(OUT_PATH, JSON.stringify([], null, 2) + '\n');
    return;
  }

  const out = [];
  for (const d of discussions) {
    if ((d.category?.name || '').toLowerCase() !== category) continue;
    const login = d.author?.login || '';
    if (excludeAuthors.has(login.toLowerCase())) {
      console.log(`  - skipped (staff author ${login}): ${d.title}`);
      continue;
    }
    out.push({
      author: login || org,
      avatar: d.author?.avatarUrl || '',
      title: cleanTitle(d.title),
      excerpt: excerptOf(d.bodyText),
      elevator: sectionUnder(d.bodyText, 'Elevator Pitch'),
      problem: sectionUnder(d.bodyText, 'Problem Statement'),
      profile: sectionUnder(d.bodyText, 'Builder Profile'),
      track: sectionUnder(d.bodyText, 'Development Track'),
      url: d.url,
      upvotes: d.upvoteCount || 0,
    });
    console.log(`  + ${d.title} -> ${login} [${d.upvoteCount} upvotes]`);
  }

  out.sort((a, b) => b.upvotes - a.upvotes);

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.log(`> wrote ${out.length} pitches -> data/pitches.json`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
