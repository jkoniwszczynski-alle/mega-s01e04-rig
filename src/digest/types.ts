export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  // All valid log entries for this job, regardless of status.
  runs: number;
  // Number of retry entries.
  retries: number;
  // Number of fail entries; any positive value marks the job as failed.
  failures: number;
  // Status of the chronologically latest entry.
  lastStatus: RunStatus;
  // Last recorded error chronologically, retained after a later ok; null if none.
  lastError: string | null;
  // Chronological bounds, preserving the original timestamp strings and offsets.
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  // One row per job, sorted by job ascending.
  rows: DigestRow[];
  // Invalid log lines are counted and skipped, not thrown.
  badLines: number;
  // Counts of valid log entries by status, not counts of jobs.
  counts: { ok: number; retry: number; fail: number };
};

// Synchronous readNight export from src/digest/index.ts.
// Missing file or invalid night date: null.
// Empty file: rows: [], badLines: 0, all counts: 0.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
