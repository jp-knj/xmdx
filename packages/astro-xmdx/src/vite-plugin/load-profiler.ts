/**
 * Debug timing and load profiling utilities for the Vite plugin.
 * @module vite-plugin/load-profiler
 */

const DEBUG_TIMING = process.env.XMDX_DEBUG_TIMING === '1';

export function debugTime(label: string): void {
  if (DEBUG_TIMING) console.time(`[xmdx:timing] ${label}`);
}

export function debugTimeEnd(label: string): void {
  if (DEBUG_TIMING) console.timeEnd(`[xmdx:timing] ${label}`);
}

export function debugLog(message: string): void {
  if (DEBUG_TIMING) console.log(`[xmdx:timing] ${message}`);
}

export const LOAD_PROFILE = process.env.XMDX_LOAD_PROFILE === '1';
const LOAD_PROFILE_TOP = Number(process.env.XMDX_LOAD_PROFILE_TOP) || 10;

type PhaseStats = { totalMs: number; count: number; maxMs: number };

export class LoadProfiler {
  phases = new Map<string, PhaseStats>();
  cacheHits = 0;
  esbuildCacheHits = 0;
  cacheMisses = 0;
  callCount = 0;
  totalMs = 0;
  slowest: Array<{ file: string; ms: number }> = [];
  private dumped = false;
  private rootFallback = '';

  constructor() {
    process.on('exit', () => {
      if (!this.dumped) this.dump(this.rootFallback);
    });
  }

  setRoot(root: string): void {
    this.rootFallback = root;
  }

  private ensure(phase: string): PhaseStats {
    let s = this.phases.get(phase);
    if (!s) {
      s = { totalMs: 0, count: 0, maxMs: 0 };
      this.phases.set(phase, s);
    }
    return s;
  }

  record(phase: string, ms: number): void {
    const s = this.ensure(phase);
    s.totalMs += ms;
    s.count++;
    if (ms > s.maxMs) s.maxMs = ms;
  }

  recordFile(file: string, ms: number): void {
    this.callCount++;
    this.totalMs += ms;

    if (this.slowest.length < LOAD_PROFILE_TOP || ms > this.slowest[this.slowest.length - 1]!.ms) {
      this.slowest.push({ file, ms });
      this.slowest.sort((a, b) => b.ms - a.ms);
      if (this.slowest.length > LOAD_PROFILE_TOP) this.slowest.length = LOAD_PROFILE_TOP;
    }
  }

  dump(root: string): void {
    if (this.dumped) return;
    this.dumped = true;
    const p = (label: string) => `[xmdx:load-profiler] ${label}`;
    console.info(p(`calls=${this.callCount} total=${this.totalMs.toFixed(0)}ms`));
    console.info(
      p(`esbuild-cache-hit=${this.esbuildCacheHits} compilation-cache-hit=${this.cacheHits} cache-miss=${this.cacheMisses}`)
    );
    for (const [phase, s] of this.phases) {
      console.info(
        p(
          `${phase} total=${s.totalMs.toFixed(0)}ms avg=${s.count ? (s.totalMs / s.count).toFixed(2) : 0}ms max=${s.maxMs.toFixed(2)}ms count=${s.count}`
        )
      );
    }
    const overhead = this.totalMs - [...this.phases.values()].reduce((a, s) => a + s.totalMs, 0);
    console.info(
      p(`overhead total=${overhead.toFixed(0)}ms avg=${this.callCount ? (overhead / this.callCount).toFixed(2) : 0}ms`)
    );
    if (this.slowest.length > 0) {
      console.info(p(`top ${this.slowest.length} slowest files:`));
      for (const { file, ms } of this.slowest) {
        console.info(p(`  ${ms.toFixed(0)}ms ${file.replace(root, '')}`));
      }
    }
  }
}

export function createLoadProfiler(): LoadProfiler | null {
  return LOAD_PROFILE ? new LoadProfiler() : null;
}
