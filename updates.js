/* Uniform auto-update system — see updates/UPDATES_SPEC.md.
   Shared module: latest-release check + Updates section + update ribbon.
   Ribbon: thin, top-center, neutral/theme-aware; the ribbon itself is the
   button (click = update); its × dismisses that version permanently. */
(function () {
  'use strict';
  var REPO = 'marcusdhaynes/MarmaladePlayer';
  var CURRENT_VERSION = '0.1.0';
  var build = document.querySelector('meta[name="marmalade-build"]')?.content || '';
  var stamped = /^[a-f0-9]{40}$/.test(build);
  var installed = stamped ? build.slice(0,12) : 'v'+CURRENT_VERSION;
  function automaticChecks(){try{return localStorage.getItem('marmalade:auto-update-checks')!=='false';}catch{return true;}}
  var inFlight=null;
  function activePlayback(){
    var state=window.MarmaladeAddonBridge?.state,video=document.getElementById('player');
    return !!(state?.broadcasting||state?.guestConn?.open||state?.connections?.size||video&&!video.paused);
  }
  // Dismissal is persisted PER VERSION: localStorage key
  // `updates:dismissed:<version>` — that version's ribbon never reappears.
  function dismissedKey(version) { return 'updates:dismissed:' + version; }

  function parseSemver(v) {
    return String(v).replace(/^v/i, '').split('.').map(function (p) { return parseInt(p, 10) || 0; });
  }
  function isNewer(candidate, current) {
    var a = parseSemver(candidate), b = parseSemver(current);
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var d = (a[i] || 0) - (b[i] || 0);
      if (d !== 0) return d > 0;
    }
    return false;
  }
  function checkForUpdate() {
    if(inFlight)return inFlight;
    var request=stamped?fetch(new URL('build-info.json',document.baseURI),{cache:'no-store'}).then(function(res){
      if(!res.ok)throw Error('Deployment check failed');
      return res.json();
    }).then(function(data){
      if(!/^[a-f0-9]{40}$/.test(data?.commit)||!data.files?.['index.html'])throw Error('Invalid deployment manifest');
      return data.commit===build?null:{version:data.commit.slice(0,12),tag:data.commit,web:true,notes:'A different verified-release identity is deployed. Refresh to load that build.'};
    }):fetch('https://api.github.com/repos/' + REPO + '/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    }).then(function (res) {
      if (!res.ok) throw Error('Release check failed');
      return res.json();
    }).then(function (data) {
      if (!data || !/^v?\d+\.\d+\.\d+$/.test(data.tag_name||'') || !isNewer(data.tag_name, CURRENT_VERSION)) return null;
      var asset = Array.isArray(data.assets) && data.assets[0];
      return {
        version: String(data.tag_name).replace(/^v/i, ''),
        tag: String(data.tag_name),
        notes: String(data.body || ''),
        url: String(data.html_url || ''),
        downloadUrl: (asset && asset.browser_download_url) || data.html_url || null,
      };
    });
    inFlight=request.finally(function(){inFlight=null;});
    return inFlight;
  }
  function isDismissed(version) {
    try { return localStorage.getItem(dismissedKey(version)) !== null; } catch (e) { return false; }
  }
  function dismissVersion(version) {
    try { localStorage.setItem(dismissedKey(version), '1'); } catch (e) { /* ignore */ }
  }
  function applyUpdate(info) {
    // Web: open the release asset/page, then refresh to the new deployed
    // version. APK/native builds hand the download to the platform
    // installer; Android still requires the user's install tap.
    if(activePlayback()){window.MarmaladeAddonBridge?.notify('Pause playback and leave the room before updating.');return;}
    if(info.web){window.location.reload();return;}
    if (info.downloadUrl) window.open(info.downloadUrl, '_blank', 'noopener');
    window.location.reload();
  }

  function renderSection(el,info,status){
    el.replaceChildren();el.className='updates-card';
    var heading=document.createElement('div');heading.className='updates-heading';
    var caption=document.createElement('strong');caption.textContent='Updates';
    var statusText=document.createElement('span');
    statusText.className='updates-state';
    statusText.setAttribute('role','status');
    statusText.textContent=status||(info?'Update Available':'');
    if(status==='Checking…')statusText.dataset.state='checking';
    else if(info)statusText.dataset.state='available';
    else if(status==='You are up to date.')statusText.dataset.state='current';
    else if(status)statusText.dataset.state='error';
    heading.append(caption,statusText);el.append(heading);
    var versions=document.createElement('div');versions.className='updates-versions';
    for(var entry of [['Installed',installed],['Available',info?(info.web?info.version:'v'+info.version):status==='You are up to date.'?installed:'—']]){
      var item=document.createElement('div');item.className='updates-version';
      var label=document.createElement('small');label.textContent=entry[0];
      var value=document.createElement('strong');value.textContent=entry[1];
      item.append(label,value);versions.append(item);
    }
    el.append(versions);
    if(info&&info.notes){
      var notes=document.createElement('details');notes.className='updates-notes';
      var toggle=document.createElement('summary');toggle.textContent="What's New";
      var content=document.createElement('pre');content.textContent=info.notes;
      notes.append(toggle,content);el.append(notes);
    }
    var actions=document.createElement('div');actions.className='updates-actions';
    var check=document.createElement('button');check.type='button';
    check.className='updates-check';check.textContent='Check for Updates';
    check.addEventListener('click',function(){mountSection(el);});
    actions.append(check);
    if(info){
      var update=document.createElement('button');update.type='button';
      update.className='updates-install';update.textContent=info.web?'Reload Deployed Build':'Get v'+info.version;
      update.addEventListener('click',function(){applyUpdate(info);});
      actions.append(update);
    }
    el.append(actions);
  }

  function mountSection(el) {
    renderSection(el, null, 'Checking…');
    checkForUpdate().then(function (info) {
      renderSection(el, info, info ? '' : 'You are up to date.');
    }).catch(function () { renderSection(el, null, 'Could not check for updates.'); });
  }

  function mountRibbon(info) {
    if (document.getElementById('museUpdateRibbon')) return;
    var ribbon = document.createElement('div');
    ribbon.id = 'museUpdateRibbon';
    ribbon.setAttribute('role', 'button');
    ribbon.setAttribute('aria-label', 'Update available, version ' + info.version + '. Activate to update.');
    ribbon.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'display:flex;align-items:center;gap:8px;padding:3px 6px 3px 12px;border-radius:999px;' +
      'font-size:12px;line-height:1.4;background:rgba(127,127,127,.16);' +
      'border:1px solid rgba(127,127,127,.35);backdrop-filter:blur(6px);cursor:pointer;';
    var label = document.createElement('span');
    label.textContent = info.web?'Different deployed build · '+info.version:'Update available · v' + info.version;
    var close = document.createElement('button');
    close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss this update');
    close.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;padding:0 4px;font-size:12px;';
    close.addEventListener('click', function (e) {
      e.stopPropagation(); dismissVersion(info.version); ribbon.remove();
    });
    ribbon.appendChild(label); ribbon.appendChild(close);
    ribbon.addEventListener('click', function () { applyUpdate(info); });
    document.body.appendChild(ribbon);
  }

  window.MuseUpdates = {
    CURRENT_VERSION: CURRENT_VERSION,
    checkForUpdate: checkForUpdate,
    applyUpdate: applyUpdate,
    mountSection: mountSection,
    mountRibbon: mountRibbon,
  };

  // Live wiring entry point: a no-op on pages without the mount points.
  function init() {
    // Live wiring for this repo: the Settings panel (#settingsPanel) is
    // reorganised by settings-layout.js, so the Updates section is created
    // here and appended as the panel's last element — the bottom of Settings.
    if (!document.getElementById('updatesSection')) {
      var panel = document.getElementById('settingsPanel');
      if (panel) {
        var created = document.createElement('section');
        created.id = 'updatesSection';
        created.setAttribute('aria-label', 'Updates');
        panel.insertBefore(created,panel.querySelector('.settings-footer'));
      }
    }
    var section = document.getElementById('updatesSection');
    function automatic(){
      if(!automaticChecks()){document.getElementById('museUpdateRibbon')?.remove();if(section)renderSection(section,null,'Automatic checks off.');return;}
      if(section)mountSection(section);
      checkForUpdate().then(function(info){if(automaticChecks()&&info&&!isDismissed(info.version))mountRibbon(info);}).catch(function(){});
    }
    window.addEventListener('marmalade:update-preference-changed',automatic);
    automatic();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
