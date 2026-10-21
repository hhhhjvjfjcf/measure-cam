/* MeasureCam 主控制器 */
(function(){
'use strict';

const $=id=>document.getElementById(id);
const CM=0.01, M=1, IN=0.0254, FT=0.3048;

class App{
  constructor(){
    this.mode='ar';          // ar | est
    this.measure='length';   // length | area
    this.points=[];          // 地面平面点 {x,y} 单位米
    this.pickMode='ar';
    this.unitIdx=0;
    this.units=['cm','m','in','ft'];
    this.ar=null; this.est=null;
    this.history=this.loadHist();
    this._bind();
  }

  loadHist(){
    try{ return JSON.parse(localStorage.getItem('measurecam_hist')||'[]'); }catch(e){ return []; }
  }
  saveHist(){ try{ localStorage.setItem('measurecam_hist',JSON.stringify(this.history.slice(0,40)));}catch(e){} }

  _bind(){
    // 模式切换
    document.querySelectorAll('#modeSwitch .seg').forEach(b=>{
      b.addEventListener('click',()=>this.setMode(b.dataset.mode));
    });
    document.querySelectorAll('.mode-chip').forEach(b=>{
      b.addEventListener('click',()=>{ this.pickMode=b.dataset.pick; document.querySelectorAll('.mode-chip').forEach(c=>c.classList.toggle('sel',c===b)); });
    });
    $('btnStart').addEventListener('click',()=>this.startApp());
    // 测量类型
    $('btnModeMeasure').addEventListener('click',()=>{
      this.setMeasure(this.measure==='length'?'area':'length');
    });
    $('btnClear').addEventListener('click',()=>this.clearPoints());
    $('btnUndo').addEventListener('click',()=>this.undo());
    $('btnUnit').addEventListener('click',()=>{ this.unitIdx=(this.unitIdx+1)%this.units.length; $('btnUnit').textContent=this.units[this.unitIdx]; this.updateResult(); });
    $('btnHistory').addEventListener('click',()=>this.showHistory());
    $('btnCalib').addEventListener('click',()=>this.openCalib());
    $('btnSave').addEventListener('click',()=>this.saveResult());
    // 校准
    $('iHeight').addEventListener('input',e=>{ if(this.est) this.est.setHeight(parseFloat(e.target.value)); });
    $('iFov').addEventListener('input',e=>{ if(this.est) this.est.setFov(parseFloat(e.target.value)); });
    $('btnCalibApply').addEventListener('click',()=>this.applyCalib());
    // sheet 关闭
    document.querySelectorAll('.sheet-close').forEach(b=>{
      b.addEventListener('click',()=>$('calibSheet').classList.add('hidden',$('histSheet').classList.add('hidden')));
    });
    // 估算模式点击取点
    $('viewport').addEventListener('click',(e)=>{ this.onViewportTap(e); });
    // PWA 安装
    window.addEventListener('beforeinstallprompt',(e)=>{ e.preventDefault(); this._deferred=e; $('installBtn').classList.remove('hidden'); });
    $('installBtn').addEventListener('click',()=>{ if(this._deferred){this._deferred.prompt();} });
  }

  async startApp(){
    $('startOverlay').classList.add('hidden');
    $('modeSwitch').querySelectorAll('.seg').forEach(b=>b.classList.remove('active'));
    $('modeSwitch').querySelector(`.seg[data-mode="${this.pickMode}"]`).classList.add('active');
    await this.setMode(this.pickMode);
  }

  async setMode(m){
    if(this.mode===m && this.running) return;
    // 停止旧模式
    if(this.ar) this.ar.stop();
    if(this.est) this.est.stop();
    this.clearPoints();
    $('statusPill').classList.add('hidden');
    $('hint').textContent='';
    this.mode=m;
    document.querySelectorAll('#modeSwitch .seg').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));

    if(m==='ar'){
      $('btnCalib').textContent='提示';
      this.ar=new ARMode(this);
      try{
        await this.ar.start();
        this.running=true;
        $('modeSwitch').querySelector('.seg[data-mode="est"]').disabled=true;
        this.updateHint();
      }catch(err){
        this.toast(err.message||'AR启动失败');
        // 回退提示，但不自动切换
        this.ar=null; this.running=false;
        $('modeSwitch').querySelector('.seg[data-mode="est"]').disabled=false;
      }
    }else{
      $('btnCalib').textContent='校准';
      this.est=new EstimateMode(this);
      try{
        await this.est.start();
        this.running=true;
        $('modeSwitch').querySelector('.seg[data-mode="ar"]').disabled=true;
        this.updateHint();
        // 实时方向显示
        this._orientTimer=setInterval(()=>this.updateStatus(),150);
      }catch(err){
        this.toast(err.message||'相机启动失败，请允许摄像头权限');
        this.est=null; this.running=false;
        $('modeSwitch').querySelector('.seg[data-mode="ar"]').disabled=false;
      }
    }
  }

  updateStatus(){
    if(this.mode!=='est'||!this.est) return;
    const o=this.est.orient;
    if(o.valid){
      $('statusPill').classList.remove('hidden');
      $('statusPill').textContent=`俯仰 ${o.beta.toFixed(0)}° · 侧倾 ${o.gamma.toFixed(0)}° · 高 ${this.est.height.toFixed(2)}m · FOV ${Math.round(this.est.fov)}°`;
    }
  }

  updateHint(){
    const m=this.mode==='ar'?'AR 模式：移动手机对准物体，点按屏幕放置测量点。':'估算模式：握稳手机、让镜头向下对准地面，点按屏幕放置测量点。';
    const act=this.measure==='length'?'长度：放置 2 个点，实时显示两点距离。':'面积：依次放置 ≥3 个点构成多边形，实时显示面积。';
    $('hint').textContent=m+act;
  }

  setMeasure(type){
    this.measure=type;
    this.clearPoints();
    $('btnModeMeasure').textContent=type==='length'?'测长度':'测面积';
    $('btnModeMeasure').classList.toggle('active',false);
    this.updateHint();
  }

  /* 估算模式：viewport 点击 → 取点 */
  onViewportTap(e){
    if(this.mode!=='est'||!this.est||!this.running) return;
    const rect=$('viewport').getBoundingClientRect();
    const tx=e.clientX-rect.left, ty=e.clientY-rect.top;
    try{
      const px=this.mapToVideo(tx,ty);
      const world=this.est.unproject(px.x,px.y);
      this.addPoint({x:world.x,y:world.y},{dx:tx,dy:ty});
    }catch(err){ this.toast(err.message); }
  }

  /* viewport 显示坐标 → 视频像素坐标（object-fit:cover 映射） */
  mapToVideo(tx,ty){
    const v=this.est.video;
    const vw=v.videoWidth, vh=v.videoHeight;
    const r=$('viewport').getBoundingClientRect();
    const cvw=r.width, cvh=r.height;
    const s=Math.max(cvw/vw, cvh/vh);
    const left=(cvw-vw*s)/2, top=(cvh-vh*s)/2;
    return {x:(tx-left)/s, y:(ty-top)/s};
  }

  /* 统一入口：AR/估算放置的点都到这里 */
  onPointPlaced(p){
    // p={x,y} 米（地面平面）
    this.addPoint({x:p.x,y:p.y},{dx:null,dy:null});
  }

  addPoint(world,disp){
    this.points.push(Object.assign({},world,disp||{}));
    this.renderEstVisual();
    this.updateResult();
    if(this.mode==='ar'&&this.ar){ this.ar.drawPoint(world); this.rebuildArLinesFull(); }
    if(this.points.length===1) this.toast('已放置第 1 点，再点一下完成测量',false);
  }

  rebuildArLinesFull(){
    if(!this.ar) return;
    // 清除线层，重画
    while(this.ar.linesGroup.children.length)this.ar.linesGroup.remove(this.ar.linesGroup.children[0]);
    while(this.ar.closedGroup.children.length)this.ar.closedGroup.remove(this.ar.closedGroup.children[0]);
    if(this.measure==='length'){
      if(this.points.length>=2) this.ar.drawLines(this.points.slice(-2));
    }else{
      if(this.points.length>=2) this.ar.drawLines(this.points);
      if(this.points.length>=3) this.ar.drawClosedLoop(this.points);
    }
  }

  undo(){
    if(!this.points.length) return;
    this.points.pop();
    if(this.ar){ this.rebuildArLinesFull(); if(this.ar.pointsGroup.children.length){const g=this.ar.pointsGroup;g.remove(g.children[g.children.length-1]);} }
    this.renderEstVisual(); this.updateResult();
  }

  clearPoints(){
    this.points=[];
    if(this.ar){ this.ar.clearVisual(); }
    this.renderEstVisual(); this.updateResult();
  }

  /* 估算模式覆盖层绘制 */
  renderEstVisual(){
    const c=$('overlay'),ctx=c.getContext('2d');
    const r=$('viewport').getBoundingClientRect();
    c.width=r.width*devicePixelRatio; c.height=r.height*devicePixelRatio;
    c.style.width=r.width+'px'; c.style.height=r.height+'px';
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    ctx.clearRect(0,0,r.width,r.height);
    const pts=this.points;
    if(!pts.length) return;
    ctx.strokeStyle='#22d3ee'; ctx.lineWidth=3; ctx.lineCap='round';
    ctx.fillStyle='#22d3ee';
    if(this.measure==='area'&&pts.length>=3){
      ctx.beginPath();
      pts.forEach((p,i)=>{ if(p.dx==null) return; if(i===0)ctx.moveTo(p.dx,p.dy);else ctx.lineTo(p.dx,p.dy); });
      const first=pts.find(p=>p.dx!=null);
      if(first) ctx.lineTo(first.dx,first.dy);
      ctx.strokeStyle='#34d399'; ctx.stroke();
    }else if(pts.length>=2){
      const a=pts.find(p=>p.dx!=null), b=[...pts].reverse().find(p=>p.dx!=null);
      if(a&&b&&a!==b){ ctx.beginPath(); ctx.moveTo(a.dx,a.dy); ctx.lineTo(b.dx,b.dy); ctx.stroke(); }
    }
    pts.forEach(p=>{ if(p.dx==null) return; ctx.beginPath(); ctx.arc(p.dx,p.dy,6,0,Math.PI*2); ctx.fill(); });
  }

  /* ---- 测量计算 ---- */
  length2D(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
  area2D(pts){
    const n=pts.length; let s=0;
    for(let i=0;i<n;i++){ const a=pts[i],b=pts[(i+1)%n]; s+=a.x*b.y-b.x*a.y; }
    return Math.abs(s/2);
  }

  updateResult(){
    const card=$('resultCard');
    if(this.measure==='length'){
      if(this.points.length>=2){
        const l=this.length2D(this.points[this.points.length-2],this.points[this.points.length-1]);
        card.classList.add('on');
        $('resValue').textContent=this.fmtLen(l);
        $('resUnit').textContent=this.unitLabel();
        $('resSub').textContent=`第 ${this.points.length} 点 · 两点距离`;
        return;
      }
    }else{
      if(this.points.length>=3){
        const a=this.area2D(this.points);
        card.classList.add('on');
        $('resValue').textContent=this.fmtArea(a);
        $('resUnit').textContent=this.unitAreaLabel();
        $('resSub').textContent=`${this.points.length} 个顶点 · 多边形面积 · 可再点添加顶点`;
        return;
      }
    }
    card.classList.remove('on');
  }

  fmtLen(m){
    const u=this.units[this.unitIdx];
    if(u==='cm') return (m/CM).toFixed(1);
    if(u==='m') return (m/M).toFixed(2);
    if(u==='in') return (m/IN).toFixed(1);
    return (m/FT).toFixed(2);
  }
  unitLabel(){ const u=this.units[this.unitIdx]; return u==='cm'?'cm':u; }
  fmtArea(m2){
    const u=this.units[this.unitIdx];
    if(u==='cm') return (m2/(CM*CM)).toFixed(1);
    if(u==='m') return (m2/(M*M)).toFixed(2);
    if(u==='in') return (m2/(IN*IN)).toFixed(1);
    return (m2/(FT*FT)).toFixed(2);
  }
  unitAreaLabel(){ const u=this.units[this.unitIdx]; return u==='cm'?'cm²':u==='m'?'m²':u==='in'?'in²':'ft²'; }

  /* ---- 校准 ---- */
  openCalib(){
    if(this.mode==='ar'){ this.toast('AR 模式为真实测量，无需校准'); return; }
    $('calibSheet').classList.remove('hidden');
    if(this.est){ $('iHeight').value=this.est.height; $('oHeight').textContent=this.est.height.toFixed(2)+' m'; $('iFov').value=this.est.fov; $('oFov').textContent=Math.round(this.est.fov)+'°'; }
  }
  applyCalib(){
    if(!this.est){ this.toast('估算模式未启动'); return; }
    if(this.points.length<2){ this.toast('请先测量一条已知长度的线（放尺子点两端）'); return; }
    const a=this.points[this.points.length-2], b=this.points[this.points.length-1];
    const real=parseFloat(prompt('输入这段真实长度（米），如银行卡长请输入 0.0856：'));
    if(!(real>0)){ this.toast('输入无效'); return; }
    try{
      const f=this.est.calibrateFovByLength(a,b,real);
      this.toast(`已校准：视场角调整为 ${Math.round(f)}°`);
      $('calibSheet').classList.add('hidden');
    }catch(e){ this.toast(e.message); }
  }

  /* ---- 保存到历史 ---- */
  saveResult(){
    if(this.measure==='length'&&this.points.length>=2){
      const l=this.length2D(this.points[this.points.length-2],this.points[this.points.length-1]);
      this.pushHist('长度',this.fmtLen(l),this.unitLabel());
    }else if(this.measure==='area'&&this.points.length>=3){
      const a=this.area2D(this.points);
      this.pushHist('面积',this.fmtArea(a),this.unitAreaLabel());
    }else{ this.toast('还没有可保存的测量结果'); return; }
    this.toast('已保存到历史',false);
  }
  pushHist(type,value,unit){
    this.history.unshift({type,value,unit,time:Date.now()});
    this.saveHist();
  }

  /* ---- 历史 ---- */
  showHistory(){
    const box=$('histList'); box.innerHTML='';
    if(!this.history.length){ box.innerHTML='<div class="note">暂无历史记录。完成测量后点结果卡片的「保存」即可存入。</div>'; }
    this.history.forEach((h,i)=>{
      const d=document.createElement('div'); d.className='hist-item';
      d.innerHTML=`<div><div class="v">${h.value} ${h.unit}</div><div class="m">${h.type} · ${new Date(h.time).toLocaleString()}</div></div>`;
      const btn=document.createElement('button'); btn.textContent='删除';
      btn.onclick=()=>{ this.history.splice(i,1); this.saveHist(); this.showHistory(); };
      d.appendChild(btn); box.appendChild(d);
    });
    $('histSheet').classList.remove('hidden');
  }

  /* ---- 提示 ---- */
  toast(msg,isErr=true){
    const t=$('errToast');
    t.textContent=msg;
    t.style.display='block';
    t.style.background=isErr?'#3b0f0f':'#062a20';
    t.style.borderColor=isErr?'#f87171':'#34d399';
    t.style.color=isErr?'#fecaca':'#a7f3d0';
    clearTimeout(this._tt);
    this._tt=setTimeout(()=>{ t.style.display='none'; },2600);
  }
}

window.App=App;
window.addEventListener('DOMContentLoaded',()=>{ window.__measurecam=new App(); });
})();
