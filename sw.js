/* Offline application shell only. Never cache media, credentials or peer data. */
const CACHE = 'marmalade-shell-v80-audio-delay';
const PREFIX = 'marmalade-shell-';
const CORE = ['./','./index.html','./manifest.webmanifest','./favicon.svg','./favicon.ico','./favicon-32.png','./assets/marmalade-icon.webp','./assets/apple-touch-icon.png'];
const scope = new URL(self.registration.scope);
const local = path => {
  try {
    const u = new URL(path, scope);
    return u.origin === scope.origin && u.pathname.startsWith(scope.pathname) ? u : null;
  } catch { return null; }
};
function isShell(u) {
  if (!u || u.pathname.includes('/vendor/libav-wasm/')) return false;
  const path = u.pathname.slice(scope.pathname.length);
  return path === '' || path === 'index.html' || /^[a-z0-9_-]+\.(?:js|css|webmanifest|svg|ico|png)$/i.test(path) ||
    /^assets\/[a-z0-9_./-]+\.(?:png|webp|svg|ico|jpg|jpeg)$/i.test(path);
}
function discover(html) {
  const urls = new Set(CORE.map(p=>local(p).href));
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const u = local(match[1]);
    if (isShell(u) && !u.hash) urls.add(u.href);
  }
  return [...urls];
}
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    const shell=await fetch(local('./index.html').href,{cache:'reload'});
    if(!shell.ok) throw Error('Application shell unavailable');
    const urls=discover(await shell.clone().text());
    await cache.put(local('./index.html').href,shell.clone());
    await cache.put(local('./').href,shell);
    // Require script/style assets to succeed; optional artwork cannot block an update.
    for(const url of urls){
      if(url===local('./').href||url===local('./index.html').href)continue;
      try {
        const response=await fetch(url,{cache:'reload'});
        if(!response.ok)throw Error('Missing shell asset: '+url);
        await cache.put(url,response);
      }catch(e){
        if(/\.(?:js|css|webmanifest)(?:\?|$)/i.test(url))throw e;
      }
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  const req=event.request,u=local(req.url);
  if(req.method!=='GET'||req.headers.has('range')||!isShell(u))return;
  // Never persist URLs with arbitrary query parameters or cache non-shell requests.
  if(u.search && !/^\?v=[a-z0-9._-]+$/i.test(u.search))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(req);
      if(response.ok && response.type!=='opaque' && await cache.match(req)) {
        await cache.put(req,response.clone()).catch(()=>{});
      }
      return response;
    }catch{
      return await cache.match(req) || Response.error();
    }
  })());
});
