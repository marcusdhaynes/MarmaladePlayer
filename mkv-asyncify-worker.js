/*
 * WebView2 compatibility entry for the pinned libav-wasm worker.
 *
 * Upstream supplies BOTH JSPI and Asyncify WebAssembly builds. Chromium-based
 * WebView2 runtimes can report JSPI support while failing in the JSPI worker,
 * so this entry selects the upstream Asyncify implementation without modifying
 * its licensed binaries. Firefox/Chrome can keep the faster native JSPI path.
 *
 * This file runs inside a dedicated module Worker, not on the UI thread.
 */
try {
  Object.defineProperty(WebAssembly,'Suspending',{
    value:undefined,writable:true,configurable:true
  });
} catch {
  try { WebAssembly.Suspending=undefined; } catch {}
}
await import('./vendor/libav-wasm/worker.js');
