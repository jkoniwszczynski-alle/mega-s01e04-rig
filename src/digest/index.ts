import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type LogEntry = {
  at: string;
  job: string;
  owner: string | null;
  status: RunStatus;
  error?: string;
};

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

function isEntry(value: unknown): value is LogEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(entry.at)
    && isDay(entry.at.slice(0, 10))
    && Number.isFinite(Date.parse(entry.at))
    && typeof entry.job === 'string' && entry.job.trim().length > 0
    && (typeof entry.owner === 'string' || entry.owner === null)
    && (entry.status === 'ok' || entry.status === 'retry' || entry.status === 'fail')
    && (!('error' in entry) || typeof entry.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isDay(night)) return null;

  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = {
    night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
  };
  const entries: LogEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      digest.badLines++;
      continue;
    }
    if (isEntry(entry)) entries.push(entry);
    else digest.badLines++;
  }

  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rows = new Map<string, DigestRow>();
  for (const entry of entries) {
    let row = rows.get(entry.job);
    if (!row) {
      row = {
        job: entry.job, owner: entry.owner, runs: 0, retries: 0, failures: 0,
        lastStatus: entry.status, lastError: null, firstAt: entry.at, lastAt: entry.at,
      };
      rows.set(entry.job, row);
    }
    row.runs++;
    if (entry.status === 'retry') row.retries++;
    if (entry.status === 'fail') row.failures++;
    row.owner = entry.owner;
    row.lastStatus = entry.status;
    if (entry.error !== undefined) row.lastError = entry.error;
    row.lastAt = entry.at;
    digest.counts[entry.status]++;
  }
  digest.rows = [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
