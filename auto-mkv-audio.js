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
  const isCurrent = session => {
    const state=bridge()?.state;
    return current===session&&!session.closed&&!!state&&(
      session.kind==='native'
        ? state.source==='native'&&state.nativeStreamUrl===session.inputUrl
        : state.source==='file'&&state.file===session.file
    );
  };

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
    if (!isCurrent(session) || session.running ||
        (session.finished && session.seekTo === null) ||
        !session.buffer || session.buffer.updating ||
        (session.seekTo === null && bufferedAhead(session) > 30)) return;
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
      // MediaSource.endOfStream() can RESET duration to the last buffered
      // timestamp. A seek/remux pass can report 'finished' when only the first
      // half of a movie has been appended. Never finalize such a partial range.
      // This must be fixed at the media source; a UI high-water mark alone
      // cannot restore the missing seekable half of a truncated movie.
      const source = session.mediaSource;
      const duration = session.declaredDuration;
      if (source.readyState === 'open' && Number.isFinite(duration) && duration > 0 &&
          Number.isFinite(source.duration) && source.duration < duration - .05) {
        try { source.duration = duration; } catch (error) {
          console.warn('Could not preserve MKV media duration', error);
        }
      }
      let lastBufferedEnd = 0;
      const ranges = session.buffer.buffered;
      for (let i = 0; i < ranges.length; i++)
        lastBufferedEnd = Math.max(lastBufferedEnd, ranges.end(i));
      const atActualEnd = Number.isFinite(duration) && duration > 0 &&
        lastBufferedEnd >= duration - Math.max(1, Math.min(3, duration * .001));
      if (session.finished && session.seekTo === null && atActualEnd &&
          source.readyState === 'open' && !session.buffer.updating) {
        try { source.endOfStream(); } catch (error) {
          console.warn('MKV end-of-stream finalization failed', error);
        }
      } else if (!session.finished) {
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
      // An intervening rapid seek must not wait for the next 300 ms poll or
      // be lost merely because the previous read reached its own EOF.
      if (isCurrent(session) && session.seekTo !== null)
        void nextChunk(session);
    }
  }

  async function handleSource(source, file=null) {
    cleanup();
    const app=bridge();
    if(!app||!source||app.state.role!=='host')return false;
    if(source.kind==='file'&&app.state.file!==file)return false;
    if(source.kind==='native'&&
       (app.state.source!=='native'||app.state.nativeStreamUrl!==source.url))return false;
    if(!supported()){
      app.notify?.('This device does not expose MediaSource playback, required for MKV audio conversion.');
      return false;
    }
    const session={file,kind:source.kind,inputUrl:source.url||'',source,
      video:app.media,closed:false,url:'',originalSrc:app.media.currentSrc||app.media.src,
      wantedTime:app.media.currentTime||0,wasPlaying:!app.media.paused,
      remuxer:null,mediaSource:null,buffer:null,interval:0,
      running:false,finished:false,seekTo:null,declaredDuration:0,
      onSeeking:null,onTimeUpdate:null,stage:'Loading local decoder'};
    current=session;
    try {
      // Dynamic import only after detecting incompatible audio; ordinary
      // videos never download the decoder or incur background CPU overhead.
      // Keep the decoder lazy: ordinary videos do not load WASM at startup.
      // This path is also used for Minternet's HTTP range-backed MKV streams.
      const module = await import('./vendor/libav-wasm/index.js');
      if(typeof module.makeRemuxer!=='function')
        throw new Error('The packaged libav-wasm module has no makeRemuxer export.');
      if (!isCurrent(session)) return false;
      const base = new URL('./vendor/libav-wasm/', document.baseURI).href;
      session.stage='Initializing FFmpeg audio worker / WebAssembly';
      session.remuxer = await module.makeRemuxer({
        publicPath: base,
        workerUrl: new URL('worker.js', base).href,
        workerOptions: { type: 'module' },
        length: source.length,
        bufferSize: 1024 * 1024,
        read: source.read
      });
      if (!isCurrent(session)) return false;
      session.stage='Reading MKV audio and video tracks';
      const header=await session.remuxer.init();
      if (!isCurrent(session)) return false;
      const tracks = [header.info?.output?.videoMimeType,
        header.info?.output?.audioMimeType].filter(Boolean);
      const mime = 'video/mp4; codecs="' + tracks.join(',') + '"';
      if(!header.info?.output?.audioMimeType)
        throw new Error('The decoder did not produce a playable audio track for this MKV.');
      if (!tracks.length || !MediaSource.isTypeSupported(mime))
        throw new Error('This browser cannot play the remuxed video format: ' + mime);

      session.stage='Opening MediaSource stream';
      const mediaSource = new MediaSource();
      session.mediaSource = mediaSource;
      const opened = new Promise((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', resolve, { once: true });
        mediaSource.addEventListener('sourceclose', () => reject(new Error('MediaSource closed')), { once: true });
      });
      // The video and audio are in the SAME MSE timeline: host, guests, and
      // subtitles remain synchronized; no separate audio player is necessary.
      app.media.pause();
      app.state.fileReady = false;
      session.url = URL.createObjectURL(mediaSource);
      app.media.src = session.url;
      app.media.load();
      await opened;
      if (!isCurrent(session)) return false;
      session.stage='Opening decoded audio/video buffer';
      session.buffer = mediaSource.addSourceBuffer(mime);
      session.buffer.mode = 'segments';
      session.buffer.timestampOffset = header.timestampOffset || 0;
      const duration = Number(header.info?.input?.duration);
      if (Number.isFinite(duration) && duration > 0) {
        session.declaredDuration = duration;
        mediaSource.duration = duration;
      }

      session.stage='Appending MKV media initialization segment';
      await append(session, header.data);
      if (!isCurrent(session)) return false;
      session.stage='Decoding first audio segment';
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
      // A native stream was already playing when conversion was requested.
      // Retain that intent and timeline after moving to fragmented MP4.
      if(session.wantedTime>0){
        try{app.media.currentTime=session.wantedTime;}catch{}
      }
      if(session.wasPlaying){
        const resume=app.media.play();
        if(resume?.catch)void resume.catch(()=>app.notify?.(
          'Compatible audio is ready. Press Play once to enable sound.'));
      }
      app.el.fileInfo.textContent = source.name +
        ' · MKV sound converted to compatible AAC locally';
      return true;
    } catch (error) {
      console.warn('Automatic MKV audio compatibility failed at '+session.stage,error);
      if (isCurrent(session)) {
        const wasUsingMSE=!!session.url&&app.media.src===session.url;
        const original=session.originalSrc;
        cleanup();
        if(wasUsingMSE&&original){
          try{app.media.src=original;app.media.load();}catch{}
        }
        const reason=String(error?.message||error||'unknown error').slice(0,220);
        const message='MKV audio conversion failed ('+session.stage+'): '+reason;
        app.el.fileInfo.textContent=source.name+' · Audio conversion unavailable';
        app.notify?.(message);
        // Keep the native file or loopback stream playable when the optional
        // decoder fails. Never leave the <video> element on a dead MSE blob.
        if(wasUsingMSE&&session.wasPlaying){
          const resume=app.media.play();
          if(resume?.catch)void resume.catch(()=>{});
        }
      }
      return false;
    }
  }
  async function handle(file){
    try{
      const source=window.MarmaladeMkvIO?.fromFile(file);
      if(!source)throw new Error('MKV decoder source adapter was not bundled.');
      return await handleSource(source,file);
    }catch(error){
      bridge()?.notify?.('MKV audio setup failed: '+String(error?.message||error));
      return false;
    }
  }
  async function handleNative({url,name,size}={}){
    try{
      const source=window.MarmaladeMkvIO?.fromNativeStream({url,name,size});
      if(!source)throw new Error('Minternet MKV media-range adapter was not bundled.');
      return await handleSource(source);
    }catch(error){
      bridge()?.notify?.('Minternet MKV audio setup failed: '+String(error?.message||error));
      return false;
    }
  }

  window.MarmaladeMkvAudio = {
    handle,handleNative,cleanup,
    getDuration: () => current && isCurrent(current) &&
      Number.isFinite(current.declaredDuration) && current.declaredDuration > 0 ?
      current.declaredDuration : 0
  };
  window.addEventListener('marmalade:media-cleared', cleanup);
})();
