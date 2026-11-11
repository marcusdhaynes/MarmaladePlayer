/*
 * On-demand, privacy-preserving MKV audio compatibility.
 *
 * libav-wasm runs FFmpeg's demuxer and audio decoder in a worker. H.264
 * video is STREAM-COPIED, while E-AC-3/AC-3/DTS/TrueHD is encoded to AAC.
 * MSE receives small fragmented-MP4 segments; never read the whole movie.
 * The original file stays on this device and the existing shared timeline,
 * seek bar, subtitle overlay and WebRTC capture continue to use #player.
 *
 * The pinned decoder is self-hosted under vendor/libav-wasm at build time.
 */
(() => {
  'use strict';
  let current = null;
  const bridge = () => window.MarmaladeAddonBridge;
  const supported = () => typeof MediaSource !== 'undefined' &&
    typeof MediaSource.isTypeSupported === 'function';
  const isCurrent = session => current === session && !session.closed &&
    bridge()?.state?.file === session.file &&
    bridge()?.state?.source === 'file';

  function cleanup() {
    const session = current;
    current = null;
    if (!session) return;
    session.closed = true;
    clearInterval(session.interval);
    session.video?.removeEventListener('seeking', session.onSeeking);
    session.video?.removeEventListener('timeupdate', session.onTimeUpdate);
    // Stopping must not re-open the file picker. Abort worker IO and its timer.
    try { session.remuxer?.destroy?.().catch(() => {}); } catch {}
    if (session.url) URL.revokeObjectURL(session.url);
  }

  function waitForUpdate(buffer, write) {
    return new Promise((resolve, reject) => {
      const clear = () => {
        buffer.removeEventListener('updateend', ok);
        buffer.removeEventListener('error', fail);
        buffer.removeEventListener('abort', fail);
      };
      const ok = () => { clear(); resolve(); };
      const fail = () => { clear(); reject(new Error('Media buffer update failed')); };
      buffer.addEventListener('updateend', ok, { once: true });
      buffer.addEventListener('error', fail, { once: true });
      buffer.addEventListener('abort', fail, { once: true });
      try { write(); } catch (error) { clear(); reject(error); }
    });
  }

  async function append(session, data) {
    if (!isCurrent(session) || !data?.byteLength) return;
    await waitForUpdate(session.buffer, () => session.buffer.appendBuffer(data));
  }

  function bufferedHere(session, time) {
    const ranges = session.buffer?.buffered;
    if (!ranges) return false;
    for (let i = 0; i < ranges.length; i++)
      if (ranges.start(i) <= time + .08 && ranges.end(i) >= time - .08) return true;
    return false;
  }

  function bufferedAhead(session) {
    const ranges = session.buffer?.buffered;
    const time = session.video.currentTime;
    if (!ranges) return 0;
    for (let i = 0; i < ranges.length; i++)
      if (ranges.start(i) <= time + .05 && ranges.end(i) > time)
        return ranges.end(i) - time;
    return 0;
  }

  async function discardOld(session) {
    if (!isCurrent(session) || session.buffer.updating) return;
    const time = session.video.currentTime;
    const ranges = session.buffer.buffered;
    if (!ranges.length) return;
    // Retain 25 seconds behind the playhead for brief rewinds.
    const removeUntil = Math.min(time - 25, ranges.start(0) + 60);
    if (removeUntil > ranges.start(0) + 5)
      await waitForUpdate(session.buffer, () =>
        session.buffer.remove(ranges.start(0), removeUntil));
  }

  async function nextChunk(session) {
    if (!isCurrent(session) || session.running || session.finished ||
        !session.buffer || session.buffer.updating ||
        bufferedAhead(session) > 30) return;
    session.running = true;
    try {
      if (session.seekTo !== null) {
        const time = session.seekTo;
        session.seekTo = null;
        const chunk = await session.remuxer.seek(time);
        await append(session, chunk?.data);
        session.finished = !!chunk?.finished;
      } else {
        const chunk = await session.remuxer.read();
        await append(session, chunk?.data);
        session.finished = !!chunk?.finished || !chunk?.data?.byteLength;
      }
      if (!isCurrent(session)) return;
      if (session.finished && session.mediaSource.readyState === 'open' &&
          !session.buffer.updating) {
        try { session.mediaSource.endOfStream(); } catch {}
      } else {
        await discardOld(session);
      }
    } catch (error) {
      if (isCurrent(session) && error?.message !== 'Cancelled') {
        console.error('Automatic MKV audio remux failed', error);
        session.finished = true;
        bridge()?.el && (bridge().el.fileInfo.textContent += ' · Decoder stopped');
      }
    } finally {
      session.running = false;
    }
  }

  async function handle(file) {
    cleanup();
    const app = bridge();
    if (!file || app?.state?.file !== file || app.state.role !== 'host' ||
        !supported()) return false;

    const session = { file, video: app.media, closed: false, url: '',
      remuxer: null, mediaSource: null, buffer: null, interval: 0,
      running: false, finished: false, seekTo: null,
      onSeeking: null, onTimeUpdate: null };
    current = session;

    try {
      // Dynamic import only after detecting incompatible audio; ordinary
      // videos never download the decoder or incur background CPU overhead.
      const module = await import('./vendor/libav-wasm/index.js');
      if (!isCurrent(session)) return false;
      const base = new URL('./vendor/libav-wasm/', document.baseURI).href;
      session.remuxer = await module.makeRemuxer({
        publicPath: base,
        workerUrl: new URL('worker.js', base).href,
        workerOptions: { type: 'module' },
        length: file.size,
        bufferSize: 1024 * 1024,
        audioCodecs: ['aac', 'opus', 'flac'],
        read: (offset, size) =>
          file.slice(offset, Math.min(offset + size, file.size)).arrayBuffer()
      });
      if (!isCurrent(session)) return false;
      const header = await session.remuxer.init();
      if (!isCurrent(session)) return false;
      const tracks = [header.info?.output?.videoMimeType,
        header.info?.output?.audioMimeType].filter(Boolean);
      const mime = 'video/mp4; codecs="' + tracks.join(',') + '"';
      if (!tracks.length || !MediaSource.isTypeSupported(mime))
        throw new Error('This browser cannot play the remuxed video format: ' + mime);

      const source = new MediaSource();
      session.mediaSource = source;
      const opened = new Promise((resolve, reject) => {
        source.addEventListener('sourceopen', resolve, { once: true });
        source.addEventListener('sourceclose', () => reject(new Error('MediaSource closed')), { once: true });
      });
      // The video and audio are in the SAME MSE timeline: host, guests, and
      // subtitles remain synchronized; no separate audio player is necessary.
      app.media.pause();
      app.state.fileReady = false;
      session.url = URL.createObjectURL(source);
      app.media.src = session.url;
      app.media.load();
      await opened;
      if (!isCurrent(session)) return false;
      session.buffer = source.addSourceBuffer(mime);
      session.buffer.mode = 'segments';
      session.buffer.timestampOffset = header.timestampOffset || 0;
      const duration = Number(header.info?.input?.duration);
      if (Number.isFinite(duration) && duration > 0)
        source.duration = duration;

      await append(session, header.data);
      if (!isCurrent(session)) return false;
      await nextChunk(session);

      session.onSeeking = () => {
        if (!isCurrent(session)) return;
        const time = session.video.currentTime;
        if (!bufferedHere(session, time)) {
          session.seekTo = time;
          session.finished = false;
          void nextChunk(session);
        }
      };
      session.onTimeUpdate = () => { if (isCurrent(session)) void nextChunk(session); };
      app.media.addEventListener('seeking', session.onSeeking);
      app.media.addEventListener('timeupdate', session.onTimeUpdate);
      session.interval = setInterval(() => void nextChunk(session), 300);
      app.el.fileInfo.textContent = file.name + ' · Compatible AAC audio (automatic)';
      return true;
    } catch (error) {
      console.warn('Automatic MKV audio compatibility unavailable', error);
      if (isCurrent(session)) {
        cleanup();
        // Do not claim sound is fixed when the fallback could not initialize.
        app.el.fileInfo.textContent = file.name + ' · Automatic audio decode unavailable';
        const toast = app.el.toast;
        if (toast) {
          toast.textContent = 'Could not initialize the built-in MKV audio decoder on this device. This movie may play without sound.';
          toast.hidden = false;
        }
      }
      return false;
    }
  }

  window.MarmaladeMkvAudio = { handle, cleanup };
  window.addEventListener('marmalade:media-cleared', cleanup);
})();
