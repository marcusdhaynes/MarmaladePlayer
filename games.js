/* Marmaladeum Games: an independent library panel and local, deliberate
   scoreboard. No gameplay mechanics are invented before rules arrive. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const panel=$('gamesPanel'),row=$('movieInfoRow');
  const board=$('gameScoreboard'),scoreList=$('gameScoreList');
  if(!panel||!row||!board||!scoreList||window.MarmaladeGames)return;
  const VISIBLE_KEY='marmalade:games:visible:v1';
  const SCORES_KEY='marmalade:games:scores:v1';
  const read=(key,fallback)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
  const save=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
  let enabled=read(VISIBLE_KEY,'false')==='true';
  let players=[];
  let restoredScores=false;
  let nextId=1;
  let armedId=null,armedTimeout=null;
  let holdTimer=null,pressId=null,pressed=false,deleted=new Set();
  try{
    const saved=JSON.parse(read(SCORES_KEY,'null'));
    if(saved && Array.isArray(saved.players)){
      restoredScores=true;
      players=saved.players.slice(0,100).filter(player=>
        player && Number.isSafeInteger(player.id) && player.id>0 &&
        Number.isSafeInteger(player.score)).map(player=>({
          id:player.id,name:String(player.name||'').trim().slice(0,32)||
            ('Player '+String(player.id).padStart(2,'0')),
          score:Math.max(-999999,Math.min(999999,player.score))
        }));
      nextId=Math.max(Number(saved.nextId)||1,...players.map(p=>p.id+1),1);
    }
  }catch{}
  if(!players.length&&!restoredScores)players=[{id:nextId++,name:'Player 01',score:0}];
  function persist(){save(SCORES_KEY,JSON.stringify({nextId,players}));}
  const node=(tag,className,text)=>{
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(text!==undefined)element.textContent=String(text);
    return element;
  };
  const button=(parent,className,label,visible)=>{
    const element=node('button',className,visible);
    element.type='button';element.setAttribute('aria-label',label);
    parent.append(element);return element;
  };
  function syncPanels(){
    const visible=[$('mediaLibraryPanel'),panel,$('mediaInfoPanel')].filter(el=>el&&!el.hidden);
    row.dataset.panelCount=String(visible.length);
    board.hidden=!enabled;
  }
  const observer=new MutationObserver(syncPanels);
  for(const el of [$('mediaLibraryPanel'),panel,$('mediaInfoPanel')])
    if(el)observer.observe(el,{attributes:true,attributeFilter:['hidden']});
  function show(enabledValue){
    enabled=!!enabledValue;panel.hidden=!enabled;save(VISIBLE_KEY,enabled?'true':'false');
    const toggle=$('gamesVisibilityToggle');
    if(toggle)toggle.checked=enabled;
    syncPanels();
  }
  function addSettingsToggle(){
    const stack=document.querySelector('#settingsPageVideo .settings-stack');
    if(!stack||$('gamesVisibilityToggle'))return;
    const label=node('label','settings-row settings-toggle-row games-setting-row');
    label.id='gamesVisibilitySetting';
    label.append(node('span','','Games'));
    const toggle=node('input');toggle.type='checkbox';
    toggle.id='gamesVisibilityToggle';
    toggle.setAttribute('aria-label','Show Games section');
    toggle.checked=enabled;
    toggle.addEventListener('change',()=>show(toggle.checked));
    label.append(toggle);
    const librarySetting=$('mlVisibilitySetting');
    if(librarySetting?.parentElement===stack)librarySetting.after(label);
    else stack.append(label);
  }
  const scoreText=value=>{
    const sign=value<0?'-':'';
    return sign+String(Math.abs(value)).padStart(2,'0');
  };
  function clearArm(){
    armedId=null;
    if(armedTimeout){clearTimeout(armedTimeout);armedTimeout=null;}
    scoreList.querySelectorAll('.game-score-card.delete-armed').forEach(card=>{
      card.classList.remove('delete-armed');
      const hint=card.querySelector('.game-score-delete-hint');
      if(hint)hint.hidden=true;
    });
  }
  function shatter(card,playerId){
    if(deleted.has(playerId))return;
    deleted.add(playerId);clearArm();
    card.classList.add('delete-armed','disintegrating');card.setAttribute('aria-hidden','true');
    card.style.pointerEvents='none';
    const bounds=card.getBoundingClientRect();
    for(let i=0;i<28;i++){
      const particle=node('i','game-score-particle');
      const size=3+(i%5)*2;
      const x=(i*53)%90,y=(i*37)%84;
      particle.style.left=x+'%';particle.style.top=y+'%';
      particle.style.width=size+'px';particle.style.height=size+'px';
      particle.style.setProperty('--disperse-x',(((i*73)%125)-62)+'px');
      particle.style.setProperty('--disperse-y',(((i*97)%100)-70)+'px');
      particle.style.animationDelay=(i%8*30)+'ms';
      card.append(particle);
    }
    card.style.setProperty('--particle-size',Math.min(bounds.width,100)+'px');
    setTimeout(()=>{
      players=players.filter(p=>p.id!==playerId);
      deleted.delete(playerId);persist();renderScores();
    },790);
  }
  function armDelete(card,playerId){
    clearArm();
    armedId=playerId;
    card.classList.add('delete-armed');
    const hint=card.querySelector('.game-score-delete-hint');
    if(hint)hint.hidden=false;
    armedTimeout=setTimeout(()=>clearArm(),12000);
  }
  function handleHold(card,playerId){
    if(armedId===playerId)shatter(card,playerId);
    else armDelete(card,playerId);
  }
  function attachHold(card,playerId){
    const cancel=()=>{
      if(holdTimer){clearTimeout(holdTimer);holdTimer=null;}
      pressed=false;pressId=null;
    };
    card.addEventListener('pointerdown',event=>{
      if((event.pointerType==='mouse'&&event.button!==0)||
         event.target.closest('button')||deleted.has(playerId))return;
      cancel();pressed=true;pressId=playerId;
      holdTimer=setTimeout(()=>{
        holdTimer=null;
        if(pressed&&pressId===playerId)handleHold(card,playerId);
      },800);
    });
    for(const event of ['pointerup','pointercancel','pointerleave','lostpointercapture'])
      card.addEventListener(event,cancel);
    card.addEventListener('contextmenu',event=>event.preventDefault());
    card.addEventListener('keydown',event=>{
      if(event.target!==card||event.key!=='Delete')return;
      event.preventDefault();handleHold(card,playerId);
    });
  }
  function updateScore(player,delta){
    player.score=Math.max(-999999,Math.min(999999,player.score+delta));
    persist();renderScores();
  }
  function renamePlayer(player){
    const input=window.prompt('Player name:',player.name);
    if(input===null)return;
    const name=input.trim().slice(0,32);
    if(!name)return;
    player.name=name;persist();renderScores();
  }
  function addPlayer(){
    const number=nextId++;
    players.push({id:number,name:'Player '+String(number).padStart(2,'0'),score:0});
    persist();renderScores();
    scoreList.lastElementChild?.scrollIntoView({block:'nearest',inline:'end'});
  }
  function renderScores(){
    clearArm();scoreList.replaceChildren();
    for(const player of players){
      const card=node('div','game-score-card');
      card.dataset.playerId=String(player.id);card.tabIndex=0;
      card.setAttribute('role','group');
      card.setAttribute('aria-label',player.name+' score '+player.score+'. Hold twice to delete.');
      const title=button(card,'game-score-name','Rename '+player.name,player.name);
      title.title='Click to rename player';
      title.addEventListener('click',()=>renamePlayer(player));
      const body=node('div','game-score-body');
      const minus=button(body,'game-score-minus','Subtract one from '+player.name,'−');
      minus.addEventListener('click',()=>updateScore(player,-1));
      const value=node('output','game-score-value',scoreText(player.score));
      value.setAttribute('aria-label',String(player.score));
      const plus=button(body,'game-score-plus','Add one to '+player.name,'+');
      plus.addEventListener('click',()=>updateScore(player,1));
      body.append(value);
      body.insertBefore(minus,value);
      body.append(plus);
      card.append(body);
      const hint=node('span','game-score-delete-hint','Hold again to delete');
      hint.hidden=true;card.append(hint);
      attachHold(card,player.id);
      scoreList.append(card);
    }
    const add=button(scoreList,'game-score-add','Add Player','+');
    add.title='Add Player';
  add.addEventListener('click',addPlayer);
  }

  // Games describe their supported controls; unassigned buttons remain true
  // disabled controls, rather than buttons that merely look inactive.
  const GAME_CONTROLS=Object.freeze({
    onlyframes:Object.freeze({previous:true,next:true,log:true,dpad:false})
  });
  const dialog=$('onlyFramesDialog'),launch=$('onlyFramesLaunch'),close=$('onlyFramesClose');
  const overview=$('onlyFramesOverview'),step=$('onlyFramesTimeStep');
  const action=$('onlyFramesAction'),modeToggle=$('onlyFramesMode');
  const modeAutomatic=$('onlyFramesModeAutomatic'),modeChoice=$('onlyFramesModeChoice');
  const librarySelect=$('onlyFramesLibrary'),hint=$('onlyFramesHint');
  const timeRange=$('onlyFramesTimeRange'),timeValue=$('onlyFramesTimeValue');
  const timeDuration=$('onlyFramesTimeDuration'),pickedTitle=$('onlyFramesPickedVideo');
  const status=$('gamesStatus');
  const control={previous:$('gamesPrevious'),next:$('gamesNext'),
    log:$('gamesLogToggle'),up:$('gamesUp'),down:$('gamesDown'),
    left:$('gamesLeft'),right:$('gamesRight')};
  const logPanel=$('gamesLogPanel'),logEntries=$('gamesLogEntries');
  const logCount=$('gamesLogCount');
  const mediaLibrary=()=>window.MarmaladeMediaLibrary;
  const player=()=>window.MarmaladeAddonBridge;
  let activeGame=null,selectedLibrary=null,mode='automatic';
  let busy=false,generation=0,pendingChoice=null;
  let history=[],cursor=-1,eventLog=[];
  const gameCards=[launch];
  // Native dialog is promoted into the browser's top layer. Keeping it
  // outside .games-panel also prevents ancestor stacking contexts from
  // placing the video controls above the game details.
  if(dialog.parentElement!==document.body)document.body.append(dialog);
  function showGameDialog(){
    dialog.hidden=false;
    if(!dialog.open)dialog.showModal();
  }
  function hideGameDialog(){
    if(dialog.open)dialog.close();
    dialog.hidden=true;
  }
  function selectedMode(){return modeChoice.getAttribute('aria-pressed')==='true'?'choice':'automatic';}
  function setSelectedMode(value){
    modeAutomatic.setAttribute('aria-pressed',String(value!=='choice'));
    modeChoice.setAttribute('aria-pressed',String(value==='choice'));
  }
  modeAutomatic.addEventListener('click',()=>setSelectedMode('automatic'));
  modeChoice.addEventListener('click',()=>setSelectedMode('choice'));
  const timeText=seconds=>{
    const time=Math.max(0,Math.floor(Number(seconds)||0));
    const parts=[Math.floor(time/3600),Math.floor(time%3600/60),time%60];
    return parts[0]>0?parts.map(x=>String(x).padStart(2,'0')).join(':'):
      parts.slice(1).map(x=>String(x).padStart(2,'0')).join(':');
  };
  const randomIndex=count=>{
    if(count<1)return -1;
    if(globalThis.crypto?.getRandomValues){
      const buf=new Uint32Array(1);
      crypto.getRandomValues(buf);
      return Math.floor(buf[0]/4294967296*count);
    }
    return Math.floor(Math.random()*count);
  };
  function selectedControls(){
    return activeGame?GAME_CONTROLS[activeGame]||{}:{};
  }
  function toggleLog(open){
    const value=Boolean(open)&&activeGame==='onlyframes';
    logPanel.hidden=!value;
    control.log.setAttribute('aria-expanded',String(value));
  }
  function syncControls(){
    const c=selectedControls();
    control.previous.disabled=!c.previous||busy||!!pendingChoice||!!loadFailure||cursor<=0;
    control.next.disabled=!c.next||busy||!!pendingChoice||!!loadFailure;
    control.log.disabled=!c.log;
    for(const key of ['up','down','left','right'])
      control[key].disabled=!c.dpad||busy;
    if(control.log.disabled)toggleLog(false);
    for(const card of gameCards){
      const selected=activeGame==='onlyframes'&&card===launch;
      card.setAttribute('aria-pressed',String(selected));
      card.disabled=!!activeGame&&!selected;
      card.querySelector('.games-card-active').hidden=!selected;
    }
  }
  function setGameStatus(message){
    status.textContent=message;
    status.dataset.active=String(!!activeGame);
  }
  function appendLog(kind,title,description='',timestamp=null,library=''){
    const item={kind,title,description,timestamp,library,at:new Date(),index:eventLog.length+1};
    eventLog.push(item);
    if(eventLog.length>100)eventLog.shift();
    renderLog();
  }
  function renderLog(){
    logEntries.replaceChildren();
    if(!eventLog.length){
      const empty=node('p','games-log-empty','No game events yet.');
      logEntries.append(empty);
    }else for(const event of eventLog.slice().reverse()){
      const entry=node('div','games-log-entry');
      entry.dataset.kind=event.kind;
      // One receipt line: sequence, event/video, mode or detail, library,
      // then ONE media timestamp (not an additional wall-clock time).
      const parts=[event.title,event.description,event.library,
        event.timestamp===null?'':timeText(event.timestamp)].filter(Boolean);
      const full=parts.join(' · ');
      entry.title=full;
      entry.setAttribute('aria-label',full);
      entry.append(node('span','games-log-item-number',
        '#'+String(event.index).padStart(2,'0')));
      entry.append(node('strong','games-log-item-title',event.title));
      if(event.description)
        entry.append(node('span','games-log-item-description',event.description));
      if(event.library)
        entry.append(node('span','games-log-source',event.library));
      if(event.timestamp!==null)
        entry.append(node('span','games-log-timestamp',timeText(event.timestamp)));
      logEntries.append(entry);
    }
    logCount.textContent=eventLog.length+' '+(eventLog.length===1?'EVENT':'EVENTS');
  }
  function updateLibrarySelection(){
    if(activeGame)return;
    const api=mediaLibrary();
    const libs=api?.getGameLibraries?.()||[];
    const chosen=libs.find(lib=>lib.id===librarySelect.value);
    const playable=chosen?(Number.isFinite(chosen.playableCount)?
      chosen.playableCount:(api?.getGameVideos?.(chosen.id)||[]).length):0;
    action.disabled=!chosen||playable<1;
    if(!libs.length){
      hint.textContent='No libraries found. Create a Media Library to get started.';
    }else if(!chosen){
      hint.textContent='Choose a Media Library to begin.';
    }else if(playable>0){
      hint.textContent=playable+' playable video'+(playable===1?'':'s')+
        ' available in '+chosen.name+'.';
    }else if(chosen.count>0){
      hint.textContent=chosen.name+' contains '+chosen.count+' indexed video'+
        (chosen.count===1?'':'s')+', but none can be opened here. Reconnect its source folder, or use a local / Minternet library.';
    }else{
      hint.textContent=chosen.name+' is empty. Add videos to this library to play.';
    }
  }
  let libraryCatalogSignature='';
  function populateLibraries(){
    const previously=librarySelect.value||selectedLibrary;
    const libs=mediaLibrary()?.getGameLibraries?.()||[];
    const signature=JSON.stringify(libs.map(lib=>[
      lib.id,lib.name,Number(lib.count)||0,Number(lib.playableCount)||0
    ]));
    // Automatic poster lookups re-render the library frequently. Do not
    // destroy an open native select when its actual choices are unchanged.
    if(signature!==libraryCatalogSignature){
      libraryCatalogSignature=signature;
      librarySelect.replaceChildren(new Option('Choose a Library…',''));
      for(const lib of libs){
        const count=Math.max(0,Number(lib.count)||0);
        const option=new Option(lib.name+' · '+count+' video'+(count===1?'':'s'),lib.id);
        librarySelect.add(option);
      }
    }
    if(libs.some(lib=>lib.id===previously))librarySelect.value=previously;
    else if(libs.length===1)librarySelect.value=libs[0].id;
    else librarySelect.value='';
    selectedLibrary=librarySelect.value||null;
    updateLibrarySelection();
  }
  let libraryRefreshToken=0;
  async function refreshLibrariesAfterLoad(){
    const token=++libraryRefreshToken;
    const api=mediaLibrary();
    if(api?.ready){
      try{await api.ready;}catch{}
      if(token!==libraryRefreshToken||dialog.hidden||activeGame)return;
      populateLibraries();
    }
  }
  function openOverview(){
    step.hidden=true;overview.hidden=false;
    populateLibraries();
    action.textContent=activeGame==='onlyframes'?'End Game':'Play Game';
    action.classList.toggle('games-end-action',!!activeGame);
    $('onlyFramesOptions').hidden=!!activeGame;
    if(activeGame){
      hint.textContent='OnlyFrames is active · '+(mode==='automatic'?'Automatic':"Player's Choice")+
        ' · Select End Game to stop the video and reset scores.';
      action.disabled=false;
    }
  }
  function showDetails(){
    if(busy){
      showLoading(loadingTitle.textContent,loadingMessage.textContent);
    }else if(loadFailure){
      showLoadFailure(loadFailure);
    }else if(pendingChoice){
      overview.hidden=true;loadingStep.hidden=true;step.hidden=false;showGameDialog();
    }else{
      loadingStep.hidden=true;openOverview();showGameDialog();
      void refreshLibrariesAfterLoad();
    }
    close.focus();
  }
  function closeDetails(){
    ++libraryRefreshToken;
    hideGameDialog();
    if(pendingChoice&&!busy){
      // Closing the chooser cancels this optional timestamp phase without
      // claiming the frame loaded. The player remains paused.
      pendingChoice=null;
      setGameStatus('FRAME NOT SELECTED');
      syncControls();
      appendLog('notice','Frame skipped','No timestamp was chosen.');
    }
    launch.focus();
  }
  // Gate every phase on decoded video data, not merely metadata. Streaming
  // movies may never be fully buffered: HAVE_CURRENT_DATA is the correct
  // condition for the current frame to be available without autoplay.
  const MEDIA_READY_TIMEOUT_MS=30000;
  let cancelMediaWait=null;
  let loadFailure=null,retryWork=null;
  const loadingStep=$('onlyFramesLoadingStep');
  const loadingTitle=$('onlyFramesLoadingTitle');
  const loadingMessage=$('onlyFramesLoadingMessage');
  const loadingSpinner=$('onlyFramesLoadingSpinner');
  const loadingRetry=$('onlyFramesRetryLoad');

  function showLoading(title,message){
    overview.hidden=true;step.hidden=true;loadingStep.hidden=false;
    loadingTitle.textContent=title;
    loadingMessage.textContent=message;
    loadingSpinner.hidden=false;
    loadingRetry.hidden=true;
    showGameDialog();
    setGameStatus('WAITING FOR VIDEO');
  }
  function showLoadFailure(message){
    overview.hidden=true;step.hidden=true;loadingStep.hidden=false;
    loadingTitle.textContent='Video Not Ready';
    loadingMessage.textContent=message+' No game phase has advanced. Retry the same selection or end the game.';
    loadingSpinner.hidden=true;loadingRetry.hidden=false;
    showGameDialog();
    setGameStatus('VIDEO NOT READY');
    syncControls();
  }
  function cancelWait(){
    const cancel=cancelMediaWait;
    cancelMediaWait=null;
    cancel?.();
  }
  function waitForMedia(token,valid,message){
    const video=player()?.media;
    if(!video)return Promise.reject(Error('Video player is unavailable.'));
    return new Promise((resolve,reject)=>{
      let timer,settleTimer,done=false,settling=false;
      const events=['loadedmetadata','durationchange','loadeddata','canplay',
        'seeked','progress','timeupdate','error','abort','emptied'];
      const cleanup=()=>{
        clearTimeout(timer);
        clearTimeout(settleTimer);
        for(const name of events)video.removeEventListener(name,check);
        if(cancelMediaWait===cancel)cancelMediaWait=null;
      };
      const finish=(error,value)=>{
        if(done)return;
        done=true;cleanup();
        if(error)reject(error);
        else resolve(value);
      };
      const cancel=()=>finish(Error('Game selection canceled.'));
      const check=()=>{
        if(done)return;
        if(token!==generation||activeGame!=='onlyframes')return cancel();
        if(video.error)return finish(Error('The video could not be decoded. Try another video or reconnect the source.'));
        if(!valid(video))return;
        if(settling)return;
        // Confirm readiness a second time after allowing the decoded frame
        // to reach the rendering pipeline. Metadata alone is insufficient.
        settling=true;
        settleTimer=setTimeout(()=>{
          settling=false;
          if(token!==generation||activeGame!=='onlyframes')return cancel();
          if(video.error)return finish(Error('Video decoding failed.'));
          if(valid(video))finish(null,video.duration);
        },40);
      };
      cancelMediaWait=cancel;
      for(const name of events)video.addEventListener(name,check);
      timer=setTimeout(()=>finish(Error(message)),MEDIA_READY_TIMEOUT_MS);
      check();
    });
  }
  const hasDecodedVideo=video=>
    video.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA &&
    Number.isFinite(video.duration)&&video.duration>0 &&
    video.videoWidth>0&&video.videoHeight>0&&
    video.paused&&!video.error;
  function waitForPlayableVideo(token){
    return waitForMedia(token,hasDecodedVideo,
      'This video has not produced a playable picture yet. Check its format, connection, or folder permissions.');
  }
  async function seekToLoadedFrame(token,seconds,duration){
    const bridge=player(),video=bridge?.media;
    if(!video)throw Error('The player is unavailable.');
    const target=Math.max(0,Math.min(Math.max(0,duration-.05),Number(seconds)||0));
    if(!bridge.pauseAndSeekGameFrame?.(target))
      throw Error('Unable to select a frame from this video.');
    await waitForMedia(token,media=>
      hasDecodedVideo(media)&&!media.seeking&&
      Math.abs(media.currentTime-target)<.25,
      'The requested frame has not finished loading or seeking.');
    if(token!==generation||activeGame!=='onlyframes')
      throw Error('Game selection canceled.');
    video.pause();
    return target;
  }
  function displayTimePicker(video,duration){
    pendingChoice={...video,duration};
    overview.hidden=true;loadingStep.hidden=true;step.hidden=false;
    showGameDialog();
    pickedTitle.textContent=video.title+' · '+video.libraryName;
    const max=Math.max(0,Math.floor(duration-0.05));
    timeRange.max=String(max);timeRange.value=String(Math.floor(max/2));
    timeDuration.textContent=timeText(duration);
    updateTimeLabel();
    setGameStatus('CHOOSE A TIMESTAMP');
    syncControls();
    timeRange.focus();
  }
  function updateTimeLabel(){timeValue.textContent=timeText(Number(timeRange.value));}
  // Update gameplay and history only AFTER a real video frame is available.
  function recordFrame(video,duration,timestamp,fromHistoryIndex=null,direction='Frame'){
    const time=Math.max(0,Math.min(Math.max(0,duration-.05),Number(timestamp)||0));
    if(fromHistoryIndex===null){
      history=history.slice(0,cursor+1);
      history.push({...video,duration,timestamp:time});
      cursor=history.length-1;
    }else cursor=fromHistoryIndex;
    setGameStatus('ACTIVE · FRAME '+String(cursor+1).padStart(2,'0'));
    appendLog('frame',direction+' · '+video.title,
      mode==='automatic'?'Automatic':'Player’s Choice',
      time,video.libraryName);
    syncControls();
  }
  async function displayVideo(video,{existingIndex=null,direction='Frame'}={}){
    if(activeGame!=='onlyframes'||busy)return;
    cancelWait();
    busy=true;pendingChoice=null;loadFailure=null;retryWork=null;
    const token=++generation;
    const options={existingIndex,direction};
    showLoading('Loading Video',video.title+' · Waiting for a decoded picture before advancing.');
    syncControls();
    try{
      player()?.setGameFrameMode?.(true);
      await mediaLibrary().playGameVideo(video.libraryId,video.id);
      if(token!==generation)return;
      const duration=await waitForPlayableVideo(token);
      if(token!==generation)return;
      if(existingIndex!==null){
        showLoading('Preparing Frame','Loading the earlier frame before restoring this game turn.');
        const frame=await seekToLoadedFrame(token,video.timestamp,duration);
        if(token!==generation)return;
        recordFrame(video,duration,frame,existingIndex,direction);
        hideGameDialog();
      }else if(mode==='choice'){
        // Player Choice is never shown before the video has loaded a picture.
        displayTimePicker(video,duration);
      }else{
        const max=Math.max(0,Math.floor(duration-0.05));
        const frameTime=randomIndex(max+1);
        showLoading('Preparing Random Frame','Seeking to the random timestamp. Gameplay starts once the frame is ready.');
        const frame=await seekToLoadedFrame(token,frameTime,duration);
        if(token!==generation)return;
        recordFrame(video,duration,frame,null,direction);
        hideGameDialog();
      }
    }catch(error){
      if(token!==generation)return;
      const message=error?.message||'The selected video has not loaded.';
      loadFailure=message;
      retryWork=()=>displayVideo(video,options);
      appendLog('error','Video loading failed',message);
      showLoadFailure(message);
    }finally{
      if(token===generation){busy=false;syncControls();}
    }
  }
  function nextVideo(){
    if(activeGame!=='onlyframes'||busy||pendingChoice)return;
    if(cursor<history.length-1){
      void displayVideo(history[cursor+1],{existingIndex:cursor+1,direction:'Next'});
      return;
    }
    const candidates=mediaLibrary()?.getGameVideos?.(selectedLibrary)||[];
    if(!candidates.length){
      setGameStatus('LIBRARY EMPTY');
      appendLog('error','No videos available','Reconnect or rescan the chosen Media Library.');
      player()?.notify?.('No playable videos in the selected Media Library.');
      return;
    }
    const previous=history[cursor]?.id;
    const pool=candidates.length>1?candidates.filter(v=>v.id!==previous):candidates;
    const candidate=pool[randomIndex(pool.length)];
    if(candidate)void displayVideo(candidate,{direction:history.length?'Next':'First'});
  }
  function previousVideo(){
    if(activeGame!=='onlyframes'||busy||pendingChoice||cursor<=0)return;
    void displayVideo(history[cursor-1],{existingIndex:cursor-1,direction:'Previous'});
  }
  function beginGame(){
    if(activeGame)return;
    const chosen=librarySelect.value;
    const list=mediaLibrary()?.getGameVideos?.(chosen)||[];
    if(!chosen||!list.length){
      hint.textContent='Choose a nonempty Media Library to start OnlyFrames.';
      action.disabled=true;return;
    }
    // Acquire game playback ownership before selecting a random file.
    // The player stays paused while loading metadata and seeking.
    player()?.setGameFrameMode?.(true);
    activeGame='onlyframes';selectedLibrary=chosen;mode=selectedMode();
    history=[];cursor=-1;pendingChoice=null;eventLog=[];renderLog();
    appendLog('start','OnlyFrames started',
      (mode==='automatic'?'Automatic':"Player's Choice")+' · '+librarySelect.selectedOptions[0].text);
    toggleLog(false);
    syncControls();
    nextVideo();
  }
  function endGame(){
    if(activeGame!=='onlyframes')return;
    ++generation;cancelWait();busy=false;pendingChoice=null;
    loadFailure=null;retryWork=null;
    const success=player()?.stopGameVideo?.();
    if(!success){
      hint.textContent='Could not stop the player. Use Stop in the video controls.';
      player()?.media?.pause?.();
    }
    appendLog('end','OnlyFrames ended','Scores reset. Video returned to the default screen.');
    for(const item of players)item.score=0;
    persist();renderScores();
    activeGame=null;selectedLibrary=null;history=[];cursor=-1;
    loadingStep.hidden=true;
    setGameStatus('SELECT A GAME');
    toggleLog(false);syncControls();
    hideGameDialog();step.hidden=true;overview.hidden=false;launch.focus();
  }
  async function confirmChoice(){
    const choice=pendingChoice;
    if(!choice||activeGame!=='onlyframes'||busy)return;
    busy=true;loadFailure=null;retryWork=null;
    const token=++generation;
    const timestamp=Number(timeRange.value);
    showLoading('Preparing Chosen Frame','Waiting for the selected timestamp to decode before continuing.');
    syncControls();
    try{
      const frame=await seekToLoadedFrame(token,timestamp,choice.duration);
      if(token!==generation)return;
      recordFrame(choice,choice.duration,frame,null,'Player Choice');
      pendingChoice=null;loadingStep.hidden=true;step.hidden=true;overview.hidden=false;
      hideGameDialog();
    }catch(error){
      if(token!==generation)return;
      const message=error?.message||'The selected frame has not loaded.';
      loadFailure=message;
      retryWork=()=>confirmChoice();
      appendLog('error','Frame loading failed',message);
      showLoadFailure(message);
    }finally{
      if(token===generation){busy=false;syncControls();}
    }
  }
  action.addEventListener('click',()=>activeGame?endGame():beginGame());
  launch.addEventListener('click',showDetails);
  close.addEventListener('click',closeDetails);
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeDetails();});
  dialog.addEventListener('cancel',event=>{
    event.preventDefault();closeDetails();
  });
  window.addEventListener('marmalade:media-library-updated',()=>{
    if(!dialog.hidden&&!activeGame&&overview.hidden===false)populateLibraries();
  });
  librarySelect.addEventListener('change',()=>{
    selectedLibrary=librarySelect.value||null;
    updateLibrarySelection();
  });
  timeRange.addEventListener('input',updateTimeLabel);
  $('onlyFramesConfirmTime').addEventListener('click',()=>void confirmChoice());
  loadingRetry.addEventListener('click',()=>{
    const retry=retryWork;
    if(!busy&&activeGame==='onlyframes'&&retry){
      loadFailure=null;retryWork=null;
      void retry();
    }
  });
  $('onlyFramesEndLoading').addEventListener('click',endGame);
  control.previous.addEventListener('click',previousVideo);
  control.next.addEventListener('click',nextVideo);
  control.log.addEventListener('click',()=>toggleLog(logPanel.hidden));
  $('gamesLogClose').addEventListener('click',()=>toggleLog(false));
  addSettingsToggle();
  show(enabled);renderScores();renderLog();syncControls();persist();
  setGameStatus('SELECT A GAME');
  window.MarmaladeGames={
    show,isVisible:()=>enabled,getScores:()=>players.map(p=>({...p})),
    addPlayer,renderScores,isGameActive:()=>activeGame!==null,
    activeGame:()=>activeGame,history:()=>history.map(item=>({...item})),
    endGame,controls:()=>({...selectedControls()})
  };
})();
