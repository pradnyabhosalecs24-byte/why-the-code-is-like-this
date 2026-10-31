import { badRequest } from './errors.js';

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts "https://github.com/owner/repo", "github.com/owner/repo(.git)", or "owner/repo".
 * Returns { owner, name, id } or throws a 400.
 */
export function parseRepoInput(input) {
  if (typeof input !== 'string' || input.length > 300) throw badRequest('Provide a GitHub repository URL.');
  let s = input.trim();
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (s.toLowerCase().startsWith('github.com/')) s = s.slice('github.com/'.length);
  s = s.replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = s.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p.includes('\\'))) throw badRequest('That does not look like a valid GitHub owner/repository name.');
  if (parts.length < 2) throw badRequest('Expected a URL like https://github.com/owner/repo');
  const [owner, name] = parts;
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || name === '.' || name === '..') {
    throw badRequest('That does not look like a valid GitHub owner/repository name.');
  }
  return { owner, name, id: `${owner}/${name}`.toLowerCase() };
}

/** Repo id used as route/query param: "owner/name" (lowercase). */
export function parseRepoId(value) {
  if (typeof value !== 'string') throw badRequest('Missing repository id.');
  return parseRepoInput(value).id;
}

export function parseQuestion(value) {
  if (typeof value !== 'string') throw badRequest('Question must be text.');
  const q = value.replace(/\s+/g, ' ').trim();
  if (q.length < 3) throw badRequest('Question is too short.');
  if (q.length > 500) throw badRequest('Question is too long (max 500 characters).');
  return q;
}

export function parseNodeId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 400) throw badRequest('Invalid node id.');
  return value;
}
