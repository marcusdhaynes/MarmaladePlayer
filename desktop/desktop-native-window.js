/* Marmalade desktop: trusted Tauri window fullscreen, not in-WebView CSS maximization.
   Loaded only in packaged desktop builds. Never requests camera/microphone access. */
(()=>{
  'use strict';
  const api=window.__TAURI__?.window;
  if(!api?.getCurrentWindow)return;
  const current=api.getCurrentWindow();
  window.MarmaladeNativeFullscreen={
    enter:()=>current.setFullscreen(true),
    exit:()=>current.setFullscreen(false)
  };
})();
