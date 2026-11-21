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
  const action=$('onlyFramesAction'),modeSelect=$('onlyFramesMode');
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
    control.previous.disabled=!c.previous||busy||!!pendingChoice||cursor<=0;
    control.next.disabled=!c.next||busy||!!pendingChoice;
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
      const head=node('div','games-log-item-top');
      head.append(node('span','games-log-item-number',
        '#'+String(event.index).padStart(2,'0')));
      head.append(node('strong','games-log-item-title',event.title));
      head.append(node('time','games-log-item-time',
        event.at.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})));
      const description=node('p','games-log-item-description',event.description);
      entry.append(head,description);
      if(event.timestamp!==null){
        const stamp=node('div','games-log-item-meta');
        stamp.append(node('span','games-log-timestamp','⏱ '+timeText(event.timestamp)));
        if(event.library)stamp.append(node('span','games-log-source',event.library));
        entry.append(stamp);
      }
      logEntries.append(entry);
    }
    logCount.textContent=eventLog.length+' '+(eventLog.length===1?'EVENT':'EVENTS');
  }
  function populateLibraries(){
    const previously=selectedLibrary||librarySelect.value;
    const libs=mediaLibrary()?.getGameLibraries?.()||[];
    librarySelect.replaceChildren(new Option('Choose a Library…',''));
    for(const lib of libs){
      const option=new Option(lib.name+' · '+lib.count+' video'+(lib.count===1?'':'s'),lib.id);
      librarySelect.add(option);
    }
    if(libs.some(lib=>lib.id===previously))librarySelect.value=previously;
    else if(libs.length===1)librarySelect.value=libs[0].id;
    else librarySelect.value='';
    const available=libs.some(lib=>lib.id===librarySelect.value);
    if(!activeGame){
      hint.textContent=libs.length?'Select a mode and a library to begin.':
        'Add videos to a local Media Library first. Extension-only catalog entries cannot play inside Marmaladeum.';
      action.disabled=!available;
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
    openOverview();
    dialog.hidden=false;
    close.focus();
  }
  function closeDetails(){
    dialog.hidden=true;
    if(pendingChoice){
      pendingChoice=null;
      setGameStatus('CHOOSE NEXT FRAME');
      syncControls();
      appendLog('notice','Frame skipped','No timestamp was chosen.');
    }
    launch.focus();
  }
  function waitForMediaDuration(token){
    const bridge=player(),video=bridge?.media;
    if(!video) return Promise.reject(Error('The video player is unavailable.'));
    return new Promise((resolve,reject)=>{
      let timer;
      const valid=()=>token===generation&&activeGame==='onlyframes'&&
        video.readyState>=1&&Number.isFinite(video.duration)&&video.duration>0&&!video.error;
      const cleanup=()=>{
        video.removeEventListener('loadedmetadata',onReady);
        video.removeEventListener('durationchange',onReady);
        video.removeEventListener('error',onError);
        clearTimeout(timer);
      };
      const onReady=()=>{
        if(token!==generation){cleanup();reject(Error('Game selection changed.'));return;}
        if(!valid())return;
        cleanup();resolve(video.duration);
      };
      const onError=()=>{
        cleanup();reject(Error('This selected video could not be decoded.'));
      };
      video.addEventListener('loadedmetadata',onReady);
      video.addEventListener('durationchange',onReady);
      video.addEventListener('error',onError);
      timer=setTimeout(()=>{cleanup();reject(Error('The video did not report a playable duration.'));},18000);
      onReady();
    });
  }
  function displayTimePicker(video,duration){
    pendingChoice={...video,duration};
    overview.hidden=true;step.hidden=false;dialog.hidden=false;
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
  function recordFrame(video,duration,timestamp,fromHistoryIndex=null,direction='Frame'){
    const bridge=player();
    if(!bridge?.pauseAndSeekGameFrame?.(timestamp))
      throw Error('Unable to show the chosen frame. The video may not be ready.');
    const time=Math.max(0,Math.min(Math.max(0,duration-.05),Number(timestamp)||0));
    if(fromHistoryIndex===null){
      history=history.slice(0,cursor+1);
      history.push({...video,duration,timestamp:time});
      cursor=history.length-1;
    }else cursor=fromHistoryIndex;
    setGameStatus('ACTIVE · FRAME '+String(cursor+1).padStart(2,'0'));
    appendLog('frame',direction+' · '+video.title,
      (mode==='automatic'?'Automatic':'Player’s Choice')+' · '+timeText(time),
      time,video.libraryName);
    syncControls();
  }
  async function displayVideo(video,{existingIndex=null,direction='Frame'}={}){
    if(activeGame!=='onlyframes'||busy)return;
    busy=true;pendingChoice=null;
    const token=++generation;
    setGameStatus('LOADING VIDEO…');syncControls();
    try{
      await mediaLibrary().playGameVideo(video.libraryId,video.id);
      if(token!==generation)return;
      const duration=await waitForMediaDuration(token);
      if(token!==generation)return;
      if(existingIndex!==null){
        recordFrame(video,duration,video.timestamp,existingIndex,direction);
        dialog.hidden=true;
      }else if(mode==='choice'){
        displayTimePicker(video,duration);
      }else{
        const max=Math.max(0,Math.floor(duration-0.05));
        recordFrame(video,duration,randomIndex(max+1),null,direction);
        dialog.hidden=true;
      }
    }catch(error){
      if(token!==generation)return;
      const message=error?.message||'Could not select the video.';
      setGameStatus('SELECTION FAILED');
      hint.textContent=message;
      appendLog('error','Selection failed',message);
      // The game remains selected, so Next can recover after a transient
      // failure without losing the player's scoreboard.
      if(dialog.hidden)player()?.notify?.(message);
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
    activeGame='onlyframes';selectedLibrary=chosen;mode=modeSelect.value==='choice'?'choice':'automatic';
    history=[];cursor=-1;pendingChoice=null;eventLog=[];renderLog();
    appendLog('start','OnlyFrames started',
      (mode==='automatic'?'Automatic':"Player's Choice")+' · '+librarySelect.selectedOptions[0].text);
    toggleLog(false);
    syncControls();
    nextVideo();
  }
  function endGame(){
    if(activeGame!=='onlyframes')return;
    ++generation;busy=false;pendingChoice=null;
    const success=player()?.stopGameVideo?.();
    if(!success){
      hint.textContent='Could not stop the player. Use Stop in the video controls.';
      player()?.media?.pause?.();
    }
    appendLog('end','OnlyFrames ended','Scores reset. Video returned to the default screen.');
    for(const item of players)item.score=0;
    persist();renderScores();
    activeGame=null;selectedLibrary=null;history=[];cursor=-1;
    setGameStatus('SELECT A GAME');
    toggleLog(false);syncControls();
    dialog.hidden=true;step.hidden=true;overview.hidden=false;launch.focus();
  }
  function confirmChoice(){
    const choice=pendingChoice;
    if(!choice||activeGame!=='onlyframes'||busy)return;
    try{
      recordFrame(choice,choice.duration,Number(timeRange.value),null,'Player Choice');
      pendingChoice=null;dialog.hidden=true;step.hidden=true;overview.hidden=false;
      syncControls();
    }catch(error){
      hint.textContent=error?.message||'Unable to seek to this time.';
      setGameStatus('SEEK FAILED');
      player()?.notify?.(hint.textContent);
    }
  }
  action.addEventListener('click',()=>activeGame?endGame():beginGame());
  launch.addEventListener('click',showDetails);
  close.addEventListener('click',closeDetails);
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeDetails();});
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!dialog.hidden)closeDetails();
  });
  librarySelect.addEventListener('change',()=>{
    selectedLibrary=librarySelect.value||null;
    action.disabled=!selectedLibrary;
  });
  timeRange.addEventListener('input',updateTimeLabel);
  $('onlyFramesConfirmTime').addEventListener('click',confirmChoice);
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
