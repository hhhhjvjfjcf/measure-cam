/* EstimateMode - 纯视觉估算：设备方向 + 相机高度/FOV 反投影到地面 */
(function(){
'use strict';

const D2R = Math.PI/180;

/* 3x3 matrix helpers (row-major arrays) */
function mmul(A,B){const r=[];for(let i=0;i<3;i++)for(let j=0;j<3;j++){let s=0;for(let k=0;k<3;k++)s+=A[i*3+k]*B[k*3+j];r[i*3+j]=s;}return r;}
function matVec(A,v){return [A[0]*v[0]+A[1]*v[1]+A[2]*v[2], A[3]*v[0]+A[4]*v[1]+A[5]*v[2], A[6]*v[0]+A[7]*v[1]+A[8]*v[2]];}
function rz(a){const c=Math.cos(a),s=Math.sin(a);return [c,-s,0,s,c,0,0,0,1];}
function rx(a){const c=Math.cos(a),s=Math.sin(a);return [1,0,0,0,c,-s,0,s,c];}
function ry(a){const c=Math.cos(a),s=Math.sin(a);return [c,0,s,0,1,0,-s,0,c];}

class EstimateMode {
  constructor(app){
    this.app=app;
    this.cam=null; this.video=null; this.stream=null;
    this.height=1.60;   // 相机离地高度 m
    this.fov=60;        // 垂直视场角 deg
    this.orient={beta:null,gamma:null,alpha:null,valid:false};
    this.lastFrameTime=0;
  }

  async start(){
    // 请求摄像头（估算模式必须在网页中看视频）
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
      throw new Error('当前浏览器不支持摄像头(getUserMedia)。请用手机浏览器或较新版Chrome。');
    }
    this.stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}},
      audio:false
    });
    this.video=document.getElementById('cam');
    this.video.style.display='block';
    this.video.srcObject=this.stream;
    await this.video.play().catch(()=>{});
    // 设备方向
    await this.enableOrientation();
    return true;
  }

  async enableOrientation(){
    if(typeof DeviceOrientationEvent==='undefined'){
      this.orient.valid=false; return;
    }
    // iOS 需要用户手势授权
    if(typeof DeviceOrientationEvent.requestPermission==='function'){
      try{ await DeviceOrientationEvent.requestPermission(); }catch(e){}
    }
    window.addEventListener('deviceorientation',(e)=>{
      if(e.beta!=null){
        this.orient.beta=e.beta; this.orient.gamma=e.gamma;
        this.orient.alpha=(e.alpha!=null?e.alpha:0); this.orient.valid=true;
      }
    },true);
  }

  hasOrientation(){ return this.orient.valid; }

  setHeight(h){ this.height=h; document.getElementById('oHeight').textContent=h.toFixed(2)+' m'; }
  setFov(f){ this.fov=f; document.getElementById('oFov').textContent=Math.round(f)+'°'; }

  /* 核心：把屏幕像素 (px,py) 反投影到地面平面，返回 {x,y,z} (米)，z=高度=0 */
  unproject(px,py){
    if(!this.orient.valid) throw new Error('无设备方向数据，无法估算。请握稳手机并靠近地面拍摄。');
    if(!this.video || this.video.videoWidth===0) throw new Error('摄像头未就绪');
    const W=this.video.videoWidth,H=this.video.videoHeight;
    // 像素→归一化设备坐标（相对视频原图）
    const f=(H/2)/Math.tan(this.fov*D2R/2); // 焦距(px)
    const nx=(px-W/2)/f;                     // 向右为正
    const ny=(H/2-py)/f;                     // 向上为正
    // 设备帧射线（相机局部：右=+x, 上=+y, 前=+z）
    const dc=[nx,ny,1];

    // 世界方向 Rz(alpha)*Rx(beta)*Ry(gamma) 作用于设备帧
    const R=mmul(rz(this.orient.alpha*D2R), mmul(rx(this.orient.beta*D2R), ry(this.orient.gamma*D2R)));
    // 世界系 ENU: x=东, y=北, z=上。相机位置 (0,0,height)
    const forward=matVec(R,[0,0,-1]);
    const up=matVec(R,[0,1,0]);
    const right=matVec(R,[1,0,0]);
    // 射线世界方向 = nx*right + ny*up + 1*forward
    const dir=[nx*right[0]+ny*up[0]+forward[0],
               nx*right[1]+ny*up[1]+forward[1],
               nx*right[2]+ny*up[2]+forward[2]];
    // 与地面平面(z=0)求交: 射线 P=(0,0,h)+t*dir, 令 P.z=0
    if(dir[2]>=0) throw new Error('请让摄像头向下对准地面再测量。');
    const t=this.height/(-dir[2]);
    const world=[dir[0]*t, dir[1]*t, 0];
    // 归一化到 "相机下方为原点、面朝方向为z" 的局部系，便于显示
    return {x:world[0], y:world[1], z:0, raw:world};
  }

  /* 已知长度校准：调整 FOV 使 last2 两点长度匹配真实长度(米) */
  calibrateFovByLength(ptA,ptB,realMeters){
    const measured=Math.hypot(ptA.x-ptB.x, ptA.y-ptB.y);
    if(measured<=0) throw new Error('两点距离为0，无法校准');
    // 世界距离与焦距成反比：measured ∝ 1/f。要令重测=realMeters：
    // realMeters = measured * f_old/f_new  =>  f_new = f_old * measured/realMeters
    const ratio=measured/realMeters;
    const H=this.video.videoHeight;
    const fOld=(H/2)/Math.tan(this.fov*D2R/2);
    const fNew=fOld*ratio;
    let fovNew=2*Math.atan(H/2/fNew)/D2R;
    fovNew=Math.min(90,Math.max(20,fovNew));
    this.setFov(fovNew);
    return fovNew;
  }

  stop(){
    if(this.stream){this.stream.getTracks().forEach(t=>t.stop());this.stream=null;}
    const v=document.getElementById('cam'); if(v){v.srcObject=null;v.style.display='none';}
  }
}

window.EstimateMode=EstimateMode;
})();
