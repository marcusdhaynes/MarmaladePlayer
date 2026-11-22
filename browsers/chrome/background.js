/* One shared background for Chrome, Edge, Firefox and Safari.
   No Minternet dependency, no background polling and no filesystem reads. */
'use strict';
const runtime=chrome.runtime;
const libraryUrl=itemId=>runtime.getURL('library.html')+
  (itemId?'#play='+encodeURIComponent(String(itemId).slice(0,680)):'');
const openLibrary=async itemId=>chrome.tabs.create({url:libraryUrl(itemId)});
chrome.action.onClicked.addListener(()=>{void openLibrary().catch(console.warn);});
runtime.onInstalled.addListener(()=>{ /* Catalog lives in extension storage. */ });
runtime.onMessage.addListener((message,sender,respond)=>{
  if(!message||typeof message.type!=='string')return false;
  if(message.type==='marmalade:ping'){
    respond({ok:true,extension:'marmalade-library',version:'0.2.0'});return false;
  }
  if(message.type==='marmalade:open-library'){
    void openLibrary(message.itemId||'')
      .then(()=>respond({ok:true}))
      .catch(error=>respond({ok:false,error:String(error)}));
    return true;
  }
  return false;
});
