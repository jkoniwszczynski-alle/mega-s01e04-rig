import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest, RunStatus } from '../src/digest/types.js';

const night = '2026-10-28';
let runsDir: string;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

function app() {
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

async function writeNight(entries: unknown[]) {
  await writeFile(join(runsDir, `${night}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join('\n'));
}

function text(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&(?:mdash|#8212|#x2014);/gi, '—').replace(/\s+/g, ' ').trim();
}

function tableRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(([row]) => ({
      html: row,
      cells: [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) => text(cell)),
    }))
    .filter((row) => /<td\b/i.test(row.html));
}

async function readRoutes() {
  const instance = app();
  const jsonResponse = await instance.request(`/api/digest/${night}`);
  const htmlResponse = await instance.request(`/digest/${night}`);
  expect([jsonResponse.status, htmlResponse.status]).toEqual([200, 200]);
  expect(jsonResponse.headers.get('content-type')).toMatch(/application\/json/i);
  expect(htmlResponse.headers.get('content-type')).toMatch(/text\/html/i);
  const digest: NightDigest = await jsonResponse.json();
  return { digest, html: await htmlResponse.text() };
}

// Accept the shared warning style, a semantic highlight, or an explicit warning label.
function hasWarning(row: string) {
  return /class=["'][^"']*\b(?:warn|warning|danger|failed|failure)\b|<mark\b|⚠|\b(?:failed|failures?|high retries|retry warning)\b/i.test(row);
}

describe('digest routes', () => {
  it('serves sorted jobs with the same data in HTML and JSON, including missing owners and original offsets', async () => {
    await writeNight([
      { job: 'zeta', owner: 'Zoe', status: 'ok', at: '2026-10-28T02:10:00-04:00' },
      { job: 'alpha', owner: 'Ada', status: 'ok', at: '2026-10-28T04:30:00+02:00' },
      { job: 'middle', owner: null, status: 'ok', at: '2026-10-28T01:15:00+05:30' },
      { job: 'alpha', owner: 'Ada', status: 'retry', error: 'transient timeout', at: '2026-10-28T04:00:00+02:00' },
    ]);
    const { digest, html } = await readRoutes();
    expect(digest).toEqual({
      night,
      badLines: 0,
      counts: { ok: 3, retry: 1, fail: 0 },
      rows: [
        { job: 'alpha', owner: 'Ada', runs: 2, retries: 1, failures: 0, lastStatus: 'ok', lastError: 'transient timeout', firstAt: '2026-10-28T04:00:00+02:00', lastAt: '2026-10-28T04:30:00+02:00' },
        { job: 'middle', owner: null, runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T01:15:00+05:30', lastAt: '2026-10-28T01:15:00+05:30' },
        { job: 'zeta', owner: 'Zoe', runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T02:10:00-04:00', lastAt: '2026-10-28T02:10:00-04:00' },
      ],
    } satisfies NightDigest);

    const rows = tableRows(html);
    expect(rows).toHaveLength(digest.rows.length);
    expect(rows.map((row) => digest.rows.find((item) => row.cells.includes(item.job))?.job))
      .toEqual(digest.rows.map((row) => row.job));
    for (const [index, row] of digest.rows.entries()) {
      // Column order and nested formatting are deliberately not part of the contract.
      expect(rows[index].cells).toEqual(expect.arrayContaining([
        row.job, row.owner ?? '—', String(row.runs), String(row.retries),
        row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt,
      ]));
    }
  });

  it('visibly marks three or more retries but not two retries', async () => {
    await writeNight([2, 3, 4].flatMap((retries) =>
      Array.from({ length: retries + 1 }, (_, index) => ({
        job: `retried-${retries}`,
        owner: 'Ada',
        status: index < retries ? 'retry' : 'ok',
        at: `2026-10-28T02:0${index}:00+01:00`,
      })),
    ));
    const { digest, html } = await readRoutes();
    expect(digest.rows.map(({ job, retries, lastStatus }) => ({ job, retries, lastStatus }))).toEqual([
      { job: 'retried-2', retries: 2, lastStatus: 'ok' },
      { job: 'retried-3', retries: 3, lastStatus: 'ok' },
      { job: 'retried-4', retries: 4, lastStatus: 'ok' },
    ]);
    const rows = tableRows(html);
    for (const retries of [2, 3, 4]) {
      const row = rows.find((row) => row.cells.includes(`retried-${retries}`));
      expect(row).toBeDefined();
      expect(hasWarning(row!.html)).toBe(retries >= 3);
    }
  });

  it.each<RunStatus>(['fail', 'ok'])('marks a failed job even when its latest status is %s', async (lastStatus) => {
    await writeNight([
      { job: 'recovered-job', owner: 'Ada', status: 'fail', error: 'upstream unavailable', at: '2026-10-28T02:00:00+01:00' },
      { job: 'recovered-job', owner: 'Ada', status: lastStatus, at: '2026-10-28T02:10:00+01:00' },
    ]);
    const { digest, html } = await readRoutes();
    expect(digest.rows).toEqual([
      expect.objectContaining({
        job: 'recovered-job', failures: lastStatus === 'fail' ? 2 : 1,
        retries: 0, lastStatus, lastError: 'upstream unavailable',
      }),
    ]);
    const rows = tableRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toContain(lastStatus);
    expect(text(rows[0].html)).toContain('upstream unavailable');
    expect(hasWarning(rows[0].html)).toBe(true);
  });

  it.each(['/digest', '/api/digest'])('returns 404 for a missing night at %s', async (route) => {
    const response = await app().request(`${route}/${night}`);
    expect(response.status).toBe(404);
    if (route === '/api/digest') {
      expect(response.headers.get('content-type')).toMatch(/application\/json/i);
      expect(await response.json()).toEqual({ error: 'night not found' });
    }
  });

  it('serves an empty night as 200 with nothing ran, not as a missing night', async () => {
    await writeNight([]);
    const { digest, html } = await readRoutes();
    expect(digest).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    expect(text(html).toLowerCase()).toContain('nothing ran');
  });

  it('counts and skips a bad line while rendering valid entries on both sides of it', async () => {
    const entry = { job: 'surviving-job', owner: null, status: 'retry', at: '2026-10-28T02:00:00+01:00' };
    const later = { ...entry, status: 'ok', at: '2026-10-28T02:10:00+01:00' };
    await writeFile(join(runsDir, `${night}.jsonl`), [
      JSON.stringify(entry), 'BROKEN-LINE {not json', JSON.stringify(later), '',
    ].join('\n'));
    const { digest, html } = await readRoutes();
    expect(digest).toEqual({
      night,
      badLines: 1,
      counts: { ok: 1, retry: 1, fail: 0 },
      rows: [{
        job: entry.job, owner: null, runs: 2, retries: 1, failures: 0,
        lastStatus: 'ok', lastError: null, firstAt: entry.at, lastAt: later.at,
      }],
    } satisfies NightDigest);
    const rows = tableRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual(expect.arrayContaining([entry.job, '—', '2', '1', 'ok', entry.at, later.at]));
    expect(text(html)).not.toContain('BROKEN-LINE');
  });
});
