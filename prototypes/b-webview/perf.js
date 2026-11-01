// Engine-independent measurement harness for Phase 0 (runs in Chrome / Android WebView).
// Records: frame times while a scripted camera move runs (sustained FPS, p5 FPS, long frames),
// and named timings (cold start to first map idle, overlay toggle to idle).

export function createPerf() {
  const t0 = performance.timeOrigin ? 0 : performance.now();
  const marks = {};
  const results = { timings: {}, runs: [] };

  function mark(name) {
    marks[name] = performance.now() - t0;
    results.timings[name] = Math.round(marks[name]);
    return marks[name];
  }

  /** Sample frame intervals for `ms` while `drive(progress 0..1)` moves the camera each frame. */
  function frameRun(label, ms, drive) {
    return new Promise((resolve) => {
      const frames = [];
      let start = null, last = null;
      function tick(now) {
        if (start === null) { start = now; last = now; }
        else { frames.push(now - last); last = now; }
        const p = (now - start) / ms;
        if (p < 1) { drive?.(p); requestAnimationFrame(tick); }
        else {
          const sorted = [...frames].sort((a, b) => a - b);
          const avg = frames.reduce((s, x) => s + x, 0) / Math.max(1, frames.length);
          const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
          const run = {
            label,
            durationMs: Math.round(now - start),
            frames: frames.length,
            avgFps: +(1000 / avg).toFixed(1),
            p5Fps: +(1000 / p95).toFixed(1), // the slow 5% of frames
            longFrames: frames.filter((f) => f > 50).length, // > 50 ms = visible stutter
          };
          results.runs.push(run);
          resolve(run);
        }
      }
      requestAnimationFrame(tick);
    });
  }

  /** Live FPS readout (1 s window) for manual gestures. */
  function liveMeter(el) {
    let n = 0, since = performance.now();
    function tick(now) {
      n++;
      if (now - since >= 1000) { el.textContent = `${Math.round((n * 1000) / (now - since))} fps`; n = 0; since = now; }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function report() {
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: `${innerWidth}x${innerHeight}`,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      ...results,
      measuredAt: new Date().toISOString(),
    };
  }

  return { mark, frameRun, liveMeter, report };
}
