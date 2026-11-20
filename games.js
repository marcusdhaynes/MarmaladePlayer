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
  const dialog=$('onlyFramesDialog'),launch=$('onlyFramesLaunch'),close=$('onlyFramesClose');
  const closeGame=()=>{dialog.hidden=true;launch.focus();};
  launch.addEventListener('click',()=>{dialog.hidden=false;close.focus();});
  close.addEventListener('click',closeGame);
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeGame();});
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!dialog.hidden)closeGame();
  });
  addSettingsToggle();show(enabled);renderScores();syncPanels();persist();
  window.MarmaladeGames={show,isVisible:()=>enabled,getScores:()=>players.map(p=>({...p})),
    addPlayer,renderScores};
})();