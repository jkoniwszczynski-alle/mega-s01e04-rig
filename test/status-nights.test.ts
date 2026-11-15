import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReadNight } from '../src/digest/types.js';
import { createApp } from '../src/app.js';

// The reader is integrated separately; exercise the board against its shared contract.
const { readNight } = vi.hoisted(() => ({ readNight: vi.fn<ReadNight>() }));
vi.mock('../src/digest/index.js', () => ({ readNight }));

let runsDir: string;
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-status-'));
  readNight.mockReset();
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

it('links nights newest first with shared entry counts, preserving missing and zero counts', async () => {
  for (const night of ['2026-10-27', '2026-10-28', '2026-10-29']) {
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
  }
  writeFileSync(join(runsDir, 'ignored.txt'), '');
  readNight.mockImplementation((dir, night) => {
    expect(dir).toBe(runsDir);
    if (night === '2026-10-29') {
      rmSync(join(dir, `${night}.jsonl`));
      return null;
    }
    return {
      night,
      rows: [],
      badLines: 1,
      counts: night === '2026-10-28' ? { ok: 4, retry: 3, fail: 2 } : { ok: 0, retry: 0, fail: 0 },
    };
  });

  const res = await createApp({ ...config, runsDir }).request('/');
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(html.match(/<li>.*?<\/li>/g)).toEqual([
    '<li><a href="/digest/2026-10-29">2026-10-29</a> · ok — / retry — / fail —</li>',
    '<li><a href="/digest/2026-10-28">2026-10-28</a> · ok 4 / retry 3 / fail 2</li>',
    '<li><a href="/digest/2026-10-27">2026-10-27</a> · ok 0 / retry 0 / fail 0</li>',
  ]);
  expect(readNight).toHaveBeenCalledTimes(3);
  expect(html).toContain('<th>adapter</th><td>shim</td>');
  expect(html).toContain(`<th>installed</th><td>${config.installed}</td>`);
  expect(html).toContain('<th>last beat</th>');
});

it('keeps the empty board message without reading any night', async () => {
  const res = await createApp({ ...config, runsDir }).request('/');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('nothing in runs/');
  expect(readNight).not.toHaveBeenCalled();
});
