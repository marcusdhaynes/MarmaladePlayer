/* Only active in the Capacitor Android/iOS app. Native invitations use an
   app-specific URI; normal shared links keep pointing to the public website. */
(() => {
  'use strict';
  const native=window.Capacitor;
  if(!native?.isNativePlatform?.())return;
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
  if(native.getPlatform?.()==='android'&&typeof native.nativePromise==='function'){
    window.MarmaladeNativePictureInPicture={
      enter:()=>native.nativePromise('MarmaladePictureInPicture','enter',{})
    };
    window.MarmaladeNativeFullscreen={
      enter:()=>native.nativePromise('MarmaladePictureInPicture','enterFullscreen',{}),
      exit:()=>native.nativePromise('MarmaladePictureInPicture','exitFullscreen',{})
    };
    window.addEventListener('marmalade:native-pip',event=>{
      document.body.classList.toggle('native-pip-active',!!event.detail?.active);
    });
  }
})();
