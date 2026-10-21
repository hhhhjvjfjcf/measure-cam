/* 估算模式核心数学验证（node 环境，无需浏览器/DOM） */
'use strict';
const fs=require('fs');
const path=require('path');
global.window={}; // estimate-mode.js 依赖 window
global.document={ getElementById:()=>({ set textContent(v){}, value:0 }) }; // setHeight/setFov 用到
const code=fs.readFileSync(path.join(__dirname,'js','estimate-mode.js'),'utf8');
eval(code);
const Est=window.EstimateMode;
const app={}; // 不触发 setHeight/setFov 的 DOM

let pass=0, fail=0;
function check(name,cond,extra){ if(cond){pass++;console.log('PASS',name);} else {fail++;console.log('FAIL',name,extra||'');} }
function approx(a,b,tol){ return Math.abs(a-b)<=tol; }

// --- 场景1：中心像素 -> 地面距离 = h*tan(beta)，beta=45, h=1.6 -> 1.6m
const e=new Est(app);
e.height=1.60; e.fov=60;
e.video={videoWidth:1280,videoHeight:720};
e.orient={alpha:0,beta:45,gamma:0,valid:true};
const W=1280,H=720;
const p0=e.unproject(W/2,H/2);
check('中心像素地面距离≈h*tan(beta)', approx(p0.y, 1.6*Math.tan(45*Math.PI/180), 1e-9), `y=${p0.y}`);
check('中心像素 z=0', p0.z===0);

// --- 场景2：图像上方像素(更远)，应比中心点更远
const ptop=e.unproject(W/2, H*0.25);
check('图像上方(像素y小)对应更远地面点', ptop.y>p0.y, `top=${ptop.y.toFixed(3)} center=${p0.y.toFixed(3)}`);

// --- 场景3：水平对称像素 -> |x| 相等（滚转为0时）
const pl=e.unproject(W*0.30,H/2);
const pr=e.unproject(W*0.70,H/2);
check('左右像素 x 对称', approx(Math.abs(pl.x),Math.abs(pr.x),1e-6), `L=${pl.x.toFixed(3)} R=${pr.x.toFixed(3)}`);
// 该地面横向段长度 = |pl.x-pr.x|
const segLen=Math.abs(pl.x-pr.x);
check('横向段长度>0', segLen>0);

// --- 场景4：fov 越小(长焦)，同样屏幕跨度覆盖的地面实际越窄 -> 测得长度越小
const e2=new Est(app); e2.height=1.60; e2.fov=35;
e2.video={videoWidth:1280,videoHeight:720};
e2.orient={alpha:0,beta:45,gamma:0,valid:true};
const pl2=e2.unproject(W*0.30,H/2);
const pr2=e2.unproject(W*0.70,H/2);
const seg2=Math.abs(pl2.x-pr2.x);
check('fov 35° 测得横向段 < fov 60°（长焦视角更窄）', seg2<segLen, `60deg=${segLen.toFixed(3)} 35deg=${seg2.toFixed(3)}`);

// --- 场景5：校准（已知长度），校准后重新测量应匹配真实长度
const a3=e.unproject(W*0.20,H/2), b3=e.unproject(W*0.80,H/2);
const m3=Math.hypot(a3.x-b3.x,a3.y-b3.y);
const real=1.5; // 已知真实 1.5m（需 fov 落在 20-90 区间内）
const fovNew=e.calibrateFovByLength(a3,b3,real);
// 校准后用新 fov 重测
const e3=new Est(app); e3.height=1.60; e3.fov=fovNew;
e3.video={videoWidth:1280,videoHeight:720};
e3.orient={alpha:0,beta:45,gamma:0,valid:true};
const a4=e3.unproject(W*0.20,H/2), b4=e3.unproject(W*0.80,H/2);
const m4=Math.hypot(a4.x-b4.x,a4.y-b4.y);
check('已知长度校准后重测≈真实长度', approx(m4,real,1e-6), `calib后=${m4.toFixed(4)} 真实=${real}`);
check('校准后的 fov 在合理区间', fovNew>=20&&fovNew<=90, `fov=${fovNew.toFixed(1)}`);

// --- 场景6：朝天(仰)时应拒绝（dir.z>=0）
const e4=new Est(app); e4.height=1.60; e4.fov=60;
e4.video={videoWidth:1280,videoHeight:720};
e4.orient={alpha:0,beta:150,gamma:0,valid:true}; // |β|>90° = 朝天拍摄
let rejected=false;
try{ e4.unproject(W/2,H/2); }catch(err){ rejected=true; }
check('朝天拍摄(β=150°)时拒绝测量', rejected);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
