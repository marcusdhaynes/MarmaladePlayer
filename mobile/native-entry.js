/* Only active in the Capacitor Android/iOS app. Native invitations use an
   app-specific URI; normal shared links keep pointing to the public website. */
(() => {
  'use strict';
  const native=window.Capacitor;
  // This script is bundled only inside native mobile builds. Some Capacitor
  // WebViews report a transient false from isNativePlatform() during startup;
  // the Android native bridge must still be discoverable for system PiP.
  if(!native)return;
  const App=native.Plugins?.App;
  const getRoom=url=>{
    try{
      const parsed=new URL(url);
      let code=parsed.searchParams.get('room')||'';
      if(parsed.protocol==='marmaladeplayer:'&&parsed.hostname==='join')
        code=parsed.pathname.replace(/^\//,'')||code;
      return /^[A-Z2-9]{8}$/i.test(code)?code.toUpperCase():'';
    }catch{return '';}
  };
  const route=url=>{
    const code=getRoom(url);
    if(!code)return;
    const current=new URL(location.href);
    if(current.searchParams.get('room')===code)return;
    current.searchParams.set('room',code);
    location.replace(current.toString());
  };
  App?.addListener('appUrlOpen',event=>route(event.url)).catch(()=>{});
  App?.getLaunchUrl?.().then(event=>event?.url&&route(event.url)).catch(()=>{});
  // Capacitor v8 exposes nativePromise on the injected bridge. Our native
  // Android Activity supports true OS PiP even while the media is paused.
  if(native.getPlatform?.()==='android'||/Android/i.test(navigator.userAgent)){
    // Resolve the native bridge at invocation time. Older Capacitor builds may
    // expose Plugins instead of nativePromise; never silently fall back to
    // an in-app mini-player when Android system PiP is available.
    const invokeNative=(method)=>{
      const cap=window.Capacitor;
      const plugin=cap?.Plugins?.MarmaladePictureInPicture;
      if(typeof plugin?.[method]==='function')return plugin[method]();
      if(typeof cap?.nativePromise==='function')
        return cap.nativePromise('MarmaladePictureInPicture',method,{});
      return Promise.reject(new Error('The Android Picture-in-Picture native bridge was not registered.'));
    };
    window.MarmaladeNativePictureInPicture={enter:()=>invokeNative('enter')};
    window.MarmaladeNativeOrientation={set:(mode)=>{
      const cap=window.Capacitor;
      const plugin=cap?.Plugins?.MarmaladePictureInPicture;
      if(typeof plugin?.setOrientation==='function')return plugin.setOrientation({mode});
      if(typeof cap?.nativePromise==='function')return cap.nativePromise('MarmaladePictureInPicture','setOrientation',{mode});
      return Promise.reject(new Error('Native orientation control unavailable'));
    }};
    window.MarmaladeNativeFullscreen={
      enter:()=>invokeNative('enterFullscreen'),
      exit:()=>invokeNative('exitFullscreen')
    };
    window.addEventListener('marmalade:native-pip',event=>{
      document.body.classList.toggle('native-pip-active',!!event.detail?.active);
    });
  }
})();
