import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/index.js';

const night = '2026-10-28';
const event = { at: '2026-10-29T01:00:00+01:00', job: 'job', owner: 'rook', status: 'ok' };
let runsDir: string;

beforeEach(() => { runsDir = mkdtempSync(join(tmpdir(), 'digest-reader-')); });
afterEach(() => { rmSync(runsDir, { recursive: true, force: true }); });

function writeEntries(entries: unknown[]) {
  writeFileSync(join(runsDir, `${night}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n'));
}

describe('readNight', () => {
  it('reads the real fixture without changing it', () => {
    expect(readNight('runs', night)).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0, failures: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, failures: 0,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, failures: 0,
          lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, failures: 1,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, failures: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('returns null for a missing file or directory', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
  });

  it.each(['', '\n \t\r\n\n'])('returns an empty digest for blank content %j', (text) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), text);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('does not hide I/O errors other than ENOENT', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
    writeFileSync(join(runsDir, 'not-a-directory'), '');
    expect(() => readNight(join(runsDir, 'not-a-directory'), night)).toThrow();
  });

  it('skips blank lines but counts malformed JSON and invalid structures', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '\n \t\r\n{\nnull\n[]\n42\ntrue\n"text"\n{}\n');
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 7, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['at', 'job', 'owner', 'status'])('rejects a missing %s', (field) => {
    const incomplete: Record<string, unknown> = { ...event };
    delete incomplete[field];
    writeEntries([incomplete, event]);
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: 1, counts: { ok: 1, retry: 0, fail: 0 }, rows: [{ runs: 1 }],
    });
  });

  it.each([
    { at: null }, { at: 123 }, { at: '' }, { at: 'not-a-date' },
    { at: '2026-10-29' }, { at: '2026-10-29T01:00:00' },
    { at: '2026-02-30T01:00:00Z' }, { at: '2026-10-29T24:00:00Z' },
    { at: '2026-10-29T01:60:00Z' }, { at: '2026-10-29T01:00:60Z' },
    { at: '2026-10-29T01:00:00+25:00' },
    { job: null }, { job: 1 }, { job: '' }, { job: ' \t' },
    { owner: 1 }, { owner: {} }, { owner: [] },
    { status: 'unknown' }, { status: null }, { status: 1 },
    { error: null }, { error: 1 }, { error: {} },
  ])('counts an invalid field as one bad line: %j', (patch) => {
    writeEntries([{ ...event, ...patch }, event]);
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: 1, counts: { ok: 1, retry: 0, fail: 0 }, rows: [{ runs: 1 }],
    });
  });

  it('orders instants rather than timestamp strings and retains the last recorded error after success', () => {
    writeEntries([
      { ...event, at: '2026-10-29T00:30:00Z', owner: null },
      { ...event, at: '2026-10-28T22:00:00-02:00', status: 'retry', error: 'latest error' },
      { ...event, at: '2026-10-29T01:00:00+02:00', status: 'fail', error: 'earlier error' },
      { ...event, at: '2026-10-29T00:15:00Z', status: 'fail' },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 1, fail: 2 },
      rows: [{
        job: 'job', owner: null, runs: 4, retries: 1, failures: 2,
        lastStatus: 'ok', lastError: 'latest error',
        firstAt: '2026-10-29T01:00:00+02:00', lastAt: '2026-10-29T00:30:00Z',
      }],
    });
  });

  it('uses file order for equal instants, accepts fractions, and retains empty errors', () => {
    writeEntries([
      { ...event, at: '2026-10-29T00:00:00.001Z', owner: null, status: 'retry', error: 'old' },
      { ...event, at: '2026-10-29T01:00:00.001+01:00', status: 'fail', error: '' },
    ]);
    expect(readNight(runsDir, night)?.rows).toEqual([{
      job: 'job', owner: 'rook', runs: 2, retries: 1, failures: 1,
      lastStatus: 'fail', lastError: '',
      firstAt: '2026-10-29T00:00:00.001Z', lastAt: '2026-10-29T01:00:00.001+01:00',
    }]);
  });

  it('sorts job names deterministically without treating object property names specially', () => {
    const jobs = ['z', '__proto__', 'a', 'constructor', 'A'];
    writeEntries(jobs.map((job) => ({ ...event, job, owner: null })));
    expect(readNight(runsDir, night)?.rows.map((row) => row.job)).toEqual([
      'A', '__proto__', 'a', 'constructor', 'z',
    ]);
  });

  it.each([
    '../2026-10-28', '../../2026-10-28', '/2026-10-28', '..\\2026-10-28',
    '%2e%2e%2f2026-10-28', '2026-10-28/../2026-10-27', '2026-10-28.jsonl',
    '2026-10-28\n', '2026-10-28\0', ' 2026-10-28', '2026-1-28',
    '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '2026-10-00', '',
  ])('rejects invalid night %j before reading', (invalid) => {
    expect(() => readNight(runsDir, invalid)).toThrow(RangeError);
  });

  it('accepts a real leap day', () => {
    writeFileSync(join(runsDir, '2024-02-29.jsonl'), JSON.stringify({
      ...event, at: '2024-02-29T23:00:00Z',
    }));
    expect(readNight(runsDir, '2024-02-29')).toMatchObject({ badLines: 0, rows: [{ runs: 1 }] });
  });
});
