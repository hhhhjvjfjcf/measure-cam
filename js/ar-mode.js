/* ARMode - WebXR immersive-ar 真实测量（ARCore 设备） */
(function(){
'use strict';

class ARMode {
  constructor(app){ this.app=app; this.running=false; }

  isSupported(){
    if(!('xr' in navigator)) return false;
    return navigator.xr.isSessionSupported('immersive-ar').catch(()=>false);
  }

  async start(){
    if(!('xr' in navigator)) throw new Error('此设备不支持 WebXR。请改用「估算测量」，或在支持 ARCore 的安卓 Chrome 中使用。');
    const supported=await navigator.xr.isSessionSupported('immersive-ar');
    if(!supported) throw new Error('此设备不支持 AR 会话(immersive-ar)。可尝试「估算测量」。');

    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.xr.enabled=true;
    const canvas=renderer.domElement; canvas.id='xrCanvas';
    document.getElementById('viewport').appendChild(canvas);

    this.renderer=renderer; this.canvas=canvas;
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera();
    this.scene.add(this.camera);

    this.pointsGroup=new THREE.Group(); this.scene.add(this.pointsGroup);
    this.linesGroup=new THREE.Group();  this.scene.add(this.linesGroup);
    this.closedGroup=new THREE.Group(); this.scene.add(this.closedGroup);

    // 准星
    this.reticle=new THREE.Mesh(
      new THREE.TorusGeometry(0.012,0.003,12,24),
      new THREE.MeshBasicMaterial({color:0x22d3ee,transparent:true,opacity:0.9})
    );
    this.reticle.visible=false; this.scene.add(this.reticle);

    const features={requiredFeatures:['hit-test'],optionalFeatures:['dom-overlay','local-floor']};
    const ov=document.getElementById('xrOverlay');
    if(ov) features.domOverlay={root:ov};
    this.session=await navigator.xr.requestSession('immersive-ar',features);
    await renderer.xr.setSession(this.session);

    // reference spaces
    try{ this.refSpace=await this.session.requestReferenceSpace('local-floor'); }
    catch(e){ this.refSpace=await this.session.requestReferenceSpace('local'); }
    this.viewerSpace=await this.session.requestReferenceSpace('viewer');
    try{ this.hitSource=await this.session.requestHitTestSource({space:this.viewerSpace}); }
    catch(e){ this.hitSource=null; }

    this.running=true;
    renderer.setAnimationLoop(this.onFrame.bind(this));

    canvas.addEventListener('pointerdown',this.onTap.bind(this));
    this._onEnter=this._onEnter.bind(this);
    this._onEnd=this._onEnd.bind(this);
    this.session.addEventListener('end',this._onEnd);
    document.getElementById('reticle').classList.add('on');

    // 进入 AR 模式，显示 dom 覆盖层
    ov.classList.remove('hidden');
    return true;
  }

  onFrame(time,frame){
    if(!this.running) return;
    if(frame){
      const pose=frame.getViewerPose(this.refSpace);
      if(pose){
        this.hitPose=null;
        if(this.hitSource){
          const hits=frame.getHitTestResults(this.hitSource);
          if(hits.length) this.hitPose=hits[0].getPose(this.refSpace);
        }
        if(this.hitPose){
          this.reticle.visible=true;
          const m=new THREE.Matrix4().fromArray(this.hitPose.transform.matrix);
          this.reticle.position.setFromMatrixPosition(m);
        } else {
          this.reticle.visible=false;
        }
      }
    }
    this.renderer.render(this.scene,this.camera);
  }

  onTap(){
    if(!this.hitPose) return;
    const m=new THREE.Matrix4().fromArray(this.hitPose.transform.matrix);
    const p=new THREE.Vector3().setFromMatrixPosition(m);
    // 只接受与已有点足够近(容差)或任意新点；交由 app 统一逻辑
    this.app.onPointPlaced({x:p.x,y:p.z,z:p.y}); // 世界: x,z 地面, y 高度
  }

  /* 可视化一个已放置点 */
  drawPoint(p){
    const geo=new THREE.SphereGeometry(0.006,14,14);
    const mat=new THREE.MeshBasicMaterial({color:0x22d3ee});
    const m=new THREE.Mesh(geo,mat);
    m.position.set(p.x,p.z,p.y);
    this.pointsGroup.add(m);
    return m;
  }

  /* 清除所有可视化 */
  clearVisual(){
    while(this.pointsGroup.children.length)this.pointsGroup.remove(this.pointsGroup.children[0]);
    while(this.linesGroup.children.length)this.linesGroup.remove(this.linesGroup.children[0]);
    while(this.closedGroup.children.length)this.closedGroup.remove(this.closedGroup.children[0]);
  }

  drawLines(pts){
    if(pts.length<2) return;
    const arr=[]; pts.forEach(p=>arr.push(p.x,p.z,p.y));
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
    const mat=new THREE.LineBasicMaterial({color:0x22d3ee,linewidth:2});
    const line=new THREE.Line(geo,mat);
    this.linesGroup.add(line);
  }

  drawClosedLoop(pts){
    if(pts.length<3) return;
    const arr=[]; pts.forEach(p=>arr.push(p.x,p.z,p.y));
    arr.push(pts[0].x,pts[0].z,pts[0].y);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
    const mat=new THREE.LineBasicMaterial({color:0x34d399});
    const line=new THREE.Line(geo,mat);
    this.closedGroup.add(line);
  }

  _onEnd(){ this.stop(); }
  _onEnter(){}

  stop(){
    this.running=false;
    if(this.renderer){this.renderer.setAnimationLoop(null);}
    try{ if(this.session) this.session.end(); }catch(e){}
    if(this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    document.getElementById('reticle').classList.remove('on');
    document.getElementById('xrOverlay').classList.add('hidden');
  }
}

window.ARMode=ARMode;
})();
