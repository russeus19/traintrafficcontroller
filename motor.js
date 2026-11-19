'use strict';

/* =====================================================================
   0. Boot + errors
   ===================================================================== */
const bootEl=document.getElementById('boot');
/* the page's texts that name the station come from the level sheet */
(function nivelTextos(){const V={nombre:NIVEL.nombre,largo:NIVEL.nombreLargo,n:NIVEL.n,lineaCorta:NIVEL.lineaCorta||NIVEL.linea,o:NIVEL.lado.o,e:NIVEL.lado.e},
  f=t=>t.replace(/\{(\w+)\}/g,(m,k)=>V[k]!==undefined?V[k]:m);
  document.querySelectorAll('[data-nt]').forEach(n=>{n.textContent=f(n.getAttribute('data-nt'));});
  document.querySelectorAll('[data-na]').forEach(n=>{n.setAttribute('aria-label',f(n.getAttribute('data-na')));});})();
function fatal(msg){
  bootEl.classList.remove('gone');
  bootEl.innerHTML=('<div><h2>'+NIVEL.nombre+'</h2><p></p></div>');
  bootEl.querySelector('p').textContent='No se pudo montar la maqueta: '+msg;
}
window.addEventListener('error',e=>fatal(e.message||'error desconocido'));
if(typeof THREE==='undefined'){ fatal('no se pudo cargar la librería 3D. Revisa la conexión y recarga.'); throw new Error('sin THREE'); }
// treat hex colours as sRGB (r149 defaults to legacy mode, which washes everything out)
if(THREE.ColorManagement){ if('legacyMode' in THREE.ColorManagement) THREE.ColorManagement.legacyMode=false; else THREE.ColorManagement.enabled=true; }

/* =====================================================================
   1. Helpers
   ===================================================================== */
const PI=Math.PI, TAU=PI*2;
const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
const lerp=(a,b,t)=>a+(b-a)*t;
const damp=(a,b,l,dt)=>a+(b-a)*(1-Math.exp(-l*dt));
const ss=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const easeIO=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
let _s=4111;
const rnd=()=>{_s=(_s*1664525+1013904223)>>>0;return _s/4294967296;};
const rr=(a,b)=>a+(b-a)*rnd();
const pick=a=>a[Math.floor(rnd()*a.length)];
function hash2(x,z){const s=Math.sin(x*127.1+z*311.7)*43758.5453;return s-Math.floor(s);}
function vnoise(x,z){
  const xi=Math.floor(x),zi=Math.floor(z),xf=x-xi,zf=z-zi;
  const u=xf*xf*(3-2*xf),v=zf*zf*(3-2*zf);
  return lerp(lerp(hash2(xi,zi),hash2(xi+1,zi),u),lerp(hash2(xi,zi+1),hash2(xi+1,zi+1),u),v);
}
function fbm(x,z){return vnoise(x,z)*.55+vnoise(x*2.07+5.3,z*2.07+1.7)*.3+vnoise(x*4.13+9.1,z*4.13+3.3)*.15;}
const IS_TOUCH=()=>!!(window.matchMedia&&matchMedia('(pointer: coarse)').matches);
const reduceMotion=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
const IS_PHONE=Math.min(window.innerWidth,window.innerHeight)<560;

/* =====================================================================
   2. Board and terrain height
   1 unit = 1 metre. x runs along the line (left/-x = lado Miranda, right/+x = lado Burgos),
   z runs across it (north = pueblo, south = campos).
   ===================================================================== */
/* tablero: tamaño de la maqueta y relieve del terreno (en el archivo del nivel) */
const {X0,X1,Z0,Z1,BW,BD,OX0,OX1,EX0,EX1,groundH}=NIVEL.tablero();
const CLIP=[new THREE.Plane(new THREE.Vector3(1,0,0),-X0),new THREE.Plane(new THREE.Vector3(-1,0,0),X1)];
/* catenary wires: drawn as lines, so their colour is lit by hand like the galvanised masts (see updateDayNight) */
const WIRE_MAT=new THREE.LineBasicMaterial({color:0x7F8782});

/* =====================================================================
   3. Track layout (data used by both the 3D scene and the control panel)
   ===================================================================== */
function zAt(pts,x){
  if(x<pts[0][0]-0.01||x>pts[pts.length-1][0]+0.01) return null;
  for(let i=1;i<pts.length;i++){ if(x<=pts[i][0]+1e-6){ const a=pts[i-1],b=pts[i];const t=(x-a[0])/((b[0]-a[0])||1);return lerp(a[1],b[1],clamp(t,0,1)); } }
  return pts[pts.length-1][1];
}
function join(){const o=[];for(let j=0;j<arguments.length;j++){const a=arguments[j];for(let i=0;i<a.length;i++){if(j>0&&i===0)continue;o.push(a[i]);}}return o;}
function scurve(x0,z0,x1,z1){const n=Math.max(10,Math.round(Math.abs(x1-x0)/1.1));const o=[];for(let i=0;i<=n;i++){const t=i/n;o.push([lerp(x0,x1,t),z0+(z1-z0)*(t*t*(3-2*t))]);}return o;}
function line(x0,x1,z,step){const n=Math.max(1,Math.round(Math.abs(x1-x0)/(step||6)));const o=[];for(let i=0;i<=n;i++)o.push([lerp(x0,x1,i/n),z]);return o;}
/* vias: vías, desvíos, señales y paso a nivel (en el archivo del nivel) */
const {TZ,PH,TRACKS,SWITCHES,SIGNALS,PN,DIV,LU,FACING,ENDS,VNUM,PLAT,TOPE,RETRO}=NIVEL.vias();
const vn=t=>String(VNUM[t]||(t&&t[1])||'');
const apTxt=t=>{const a=NIVEL.apartar(t?t.dir:1);return ttIn5()?a.replace(' o 5',''):a;};   // where a train can be put aside   // número de la vía en el plano (las claves internas son otras)
/* =====================================================================
   4. Renderer, scene, lights
   ===================================================================== */
const canvas=document.getElementById('scene'),stageEl=document.getElementById('stage');
const VW=()=>Math.max(1,stageEl.clientWidth),VH=()=>Math.max(1,stageEl.clientHeight);
/* layout mode: wide (three columns), mid (no right column), phone (bottom sheet) */
const LAYQ=()=>window.innerWidth<=760?'phone':(window.innerWidth<1280?'mid':'wide');
document.getElementById('app').setAttribute('data-lay',LAYQ());
const renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true,powerPreference:'high-performance'});
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=0.98;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
let pixelCap=Math.min(window.devicePixelRatio||1,IS_PHONE?2:1.75);

const scene=new THREE.Scene();
const hemi=new THREE.HemisphereLight(0xEEF3F6,0xB9A27C,0.85); scene.add(hemi);
const sun=new THREE.DirectionalLight(0xFFF0D6,1.42);
sun.position.set(-150,210,170); sun.castShadow=true;
const SH=IS_PHONE?2048:4096; sun.shadow.mapSize.set(SH,SH);
(function(c){c.left=-330;c.right=330;c.top=300;c.bottom=-300;c.near=20;c.far=900;c.updateProjectionMatrix();})(sun.shadow.camera);
sun.shadow.bias=-0.00035; sun.shadow.normalBias=0.55;
scene.add(sun); sun.target.position.set(0,0,-55); scene.add(sun.target);
const bounce=new THREE.DirectionalLight(0xC9D6E6,0.26); bounce.position.set(180,120,-160); scene.add(bounce);
/* sky dome around the camera: gradient by sun height, sun disc and halo, moon, stars (colours written as shown) */
const skyMat=new THREE.ShaderMaterial({
  uniforms:{uSun:{value:new THREE.Vector3(0,1,0)},uMoon:{value:new THREE.Vector3(0,1,0)},uZen:{value:new THREE.Color()},uHor:{value:new THREE.Color()},uGnd:{value:new THREE.Color()},
    uSunCol:{value:new THREE.Color()},uSunI:{value:1},uStars:{value:0},uMoonI:{value:0},
    uCloud:{value:0},uCloudCol:{value:new THREE.Color(0.7,0.72,0.75)},uCloudT:{value:0}},
  vertexShader:'varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:[
    'uniform vec3 uSun,uMoon,uZen,uHor,uGnd,uSunCol,uCloudCol;uniform float uSunI,uStars,uMoonI,uCloud,uCloudT;varying vec3 vDir;',
    'float hash(vec3 p){p=fract(p*0.3183099+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}',
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(vec3(i,1.0)),hash(vec3(i+vec2(1.0,0.0),1.0)),f.x),mix(hash(vec3(i+vec2(0.0,1.0),1.0)),hash(vec3(i+vec2(1.0,1.0),1.0)),f.x),f.y);}',
    'float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return s;}',
    'void main(){vec3 d=normalize(vDir);float h=d.y;',
    ' vec3 col=h>0.0?mix(uHor,uZen,pow(clamp(h,0.0,1.0),0.5)):mix(uHor,uGnd,clamp(-h*5.0,0.0,1.0));',
    ' float s=max(dot(d,uSun),0.0);col+=uSunCol*(pow(s,6.0)*0.22+pow(s,90.0)*0.45)*uSunI;',
    ' col=mix(col,vec3(1.0,0.97,0.9),smoothstep(0.99972,0.99980,s)*uSunI*smoothstep(-0.03,0.0,h));',
    ' if(uStars>0.0&&h>0.0){vec3 q=floor(d*380.0);float r=hash(q);col+=vec3(step(0.9968,r)*(0.35+0.65*hash(q+7.3)))*uStars*smoothstep(0.0,0.2,h);}',
    ' float m=max(dot(d,uMoon),0.0);col+=vec3(0.30,0.34,0.44)*pow(m,60.0)*uMoonI*0.5;col=mix(col,vec3(0.86,0.88,0.92),smoothstep(0.99978,0.99984,m)*uMoonI);',
    ' if(uCloud>0.0){vec2 p=d.xz/(max(h,0.0)+0.12)*0.9+vec2(uCloudT,uCloudT*0.4);float n=fbm(p);',
    '  float ca=smoothstep(1.0-uCloud,1.0-uCloud+0.35,n+0.25*uCloud)*smoothstep(-0.03,0.05,h);',
    '  col=mix(col,uCloudCol*(0.80+0.40*n),ca);}',
    ' gl_FragColor=vec4(col,1.0);}'].join('\n'),
  side:THREE.BackSide,depthWrite:false,depthTest:false,toneMapped:false});
const sky=new THREE.Mesh(new THREE.SphereGeometry(1400,40,20),skyMat);sky.renderOrder=-10;sky.frustumCulled=false;scene.add(sky);
scene.background=null;

/* =====================================================================
   5. Materials, batching, triangle soups
   ===================================================================== */
const MAT_HEX=new Map();
function lam(hex,o){const m=new THREE.MeshLambertMaterial(Object.assign({color:hex},o||{}));MAT_HEX.set(m,hex);return m;}
/* weather on every Lambert surface: wet ground darkens, settled snow whitens the faces that look up (patchy) */
const WXU={uSnow:{value:0},uWet:{value:0},uPud:{value:0},uSkyZ:{value:new THREE.Color()},uSkyH:{value:new THREE.Color()},uSunW:{value:new THREE.Vector3(0,1,0)},uSunC:{value:new THREE.Color()},uWxT:{value:0},uRainNow:{value:0},uCov:{value:0},uCT:{value:0}};
THREE.MeshLambertMaterial.prototype.onBeforeCompile=function(s){
  if(s.vertexShader.indexOf('#include <project_vertex>')<0||s.fragmentShader.indexOf('#include <emissivemap_fragment>')<0)return;
  Object.assign(s.uniforms,WXU);
  s.vertexShader='varying vec3 vWxP;\n'+s.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n{vec4 q=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\nq=instanceMatrix*q;\n#endif\nvWxP=(modelMatrix*q).xyz;}');
  s.fragmentShader='uniform float uSnow,uWet,uPud,uWxT,uRainNow,uCov,uCT;uniform vec3 uSkyZ,uSkyH,uSunW,uSunC;varying vec3 vWxP;\nvec2 wxH(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}\nfloat wxN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);vec4 k=vec4(dot(i,vec2(127.1,311.7)));k+=vec4(0.0,127.1,311.7,438.8);vec4 r=fract(sin(k)*43758.5453);return mix(mix(r.x,r.y,f.x),mix(r.z,r.w,f.x),f.y);}\n'+
    s.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\nif(uSnow+uWet+uPud>0.001){vec3 wn=(vec4(normal,0.0)*viewMatrix).xyz;float up=smoothstep(0.35,0.8,wn.y);\n'+
    /* everything that gets rained on: darker (water soaks in, more on what faces the sky) and a film of water on top that
       mirrors the sky with Fresnel and catches the sun; streets, roofs, platforms and stone glossier than grass and soil,
       walls only a little; the film trembles with the falling drops */
    ' float gloss=1.0-0.65*clamp((diffuseColor.g-max(diffuseColor.r,diffuseColor.b))*5.0+0.2*(diffuseColor.r-diffuseColor.b)*3.0,0.0,1.0);\n'+
    ' diffuseColor.rgb*=1.0-uWet*(0.30*up+0.12*(1.0-up))*mix(1.15,0.85,gloss);\n'+
    ' if(uWet>0.01){vec3 V0=isOrthographic?vec3(0.0,0.0,1.0):normalize(-(viewMatrix*vec4(vWxP,1.0)).xyz);\n'+
    '  vec2 tw=vec2(wxN(vWxP.xz*5.0+uWxT*2.0),wxN(vWxP.zx*5.0-uWxT*1.7))-0.5;vec3 Nw=normalize(wn+vec3(tw.x,0.0,tw.y)*0.05*uRainNow*up);\n'+
    '  vec3 Nv=normalize((viewMatrix*vec4(Nw,0.0)).xyz),Rv=reflect(-V0,Nv),Rw=(vec4(Rv,0.0)*viewMatrix).xyz;float ry=max(Rw.y,0.02);\n'+
    '  vec3 sk=mix(uSkyH,uSkyZ,sqrt(clamp(ry,0.0,1.0)));vec2 cp=Rw.xz/(ry+0.12)*0.9+vWxP.xz*0.09+vec2(uCT,uCT*0.4);sk*=mix(1.0,0.6+0.8*(0.6*wxN(cp)+0.4*wxN(cp*2.03+1.7)),uCov);\n'+
    '  float Fr=0.02+0.98*pow(1.0-clamp(dot(Nv,V0),0.0,1.0),5.0),film=uWet*(0.3+0.7*up)*(0.35+0.65*gloss)*(1.0-uSnow);\n'+
    '  vec3 Lw=normalize((viewMatrix*vec4(uSunW,0.0)).xyz),Hh=normalize(Lw+V0);float sp=pow(max(dot(Nv,Hh),0.0),70.0)*0.9+pow(max(dot(Nv,Hh),0.0),14.0)*0.06;\n'+
    '  totalEmissiveRadiance+=film*(sk*(Fr*2.4+0.12)+uSunC*sp*(0.3+gloss));}\n'+
    /* puddles on level ground and platforms: rounded pools (one chance per 3.5 m cell, oval, wobbly rim) that grow as the
       rain goes on, wet dark halo around them, the floor seen darker through the water, the sky mirrored with Fresnel,
       a wind ripple, rings from the drops and the sun glint when it comes out */
    /* WX_PUD 1 = open ground (fewer, bigger pools), 2 = platforms (many small shallow ones over the paving) */
    '#ifdef WX_PUD\n if(uPud>0.001){float pk=WX_PUD>1.5?1.0:0.0,cs=mix(3.5,2.2,pk),rk=mix(1.0,0.55,pk),pr=mix(0.75,0.85,pk),lo=mix(0.3,0.22,pk);\n'+
    '  float fl=smoothstep(0.9,0.97,wn.y)*(1.0-uSnow),best=9.0;vec2 q=vWxP.xz/cs,qi=floor(q);\n'+
    '  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 c=qi+vec2(float(i),float(j)),h1=wxH(c),h2=wxH(c+17.3);\n'+
    '   if(h2.x>smoothstep(lo,0.75,wxN(c*(1.085/cs)+5.1))*pr)continue;\n'+
    '   float rad=(0.6+1.9*fract(h2.x*7.7))*rk*clamp(uPud*1.3+0.05-0.4*fract(h2.y*5.3),0.0,1.0);if(rad<0.02)continue;\n'+
    '   vec2 dv=vWxP.xz-(c+0.25+0.5*h1)*cs;float an=h2.y*6.2832;vec2 e=vec2(cos(an),sin(an));\n'+
    '   float s=length(vec2(dot(dv,e),dot(dv,vec2(-e.y,e.x))*(1.1+0.7*fract(h1.y*9.1))))-rad;\n'+
    '   float k=0.7*rk,hh=clamp(0.5+0.5*(best-s)/k,0.0,1.0);best=mix(best,s,hh)-k*hh*(1.0-hh);}\n'+
    '  best+=(wxN(vWxP.xz*0.9/rk)-0.5)*0.4*rk+(wxN(vWxP.xz*3.3)-0.5)*0.08;\n'+
    '  float pd=smoothstep(0.02,-0.02,best)*fl,halo=smoothstep(1.1*rk,0.0,best)*fl*(1.0-pd),dep=smoothstep(0.0,-0.7,best);\n'+
    '  diffuseColor.rgb*=1.0-0.3*halo;diffuseColor.rgb*=mix(1.0,mix(0.62,0.32,dep),pd);\n'+
    '  if(pd>0.0){vec2 g=vWxP.xz*1.7,ci=floor(g),cf=fract(g)-0.5;float ph=fract(sin(dot(ci,vec2(12.9898,78.233)))*43758.5453);\n'+
    '   float t=fract(uWxT*0.75+ph);vec2 jt=cf+(vec2(ph,fract(ph*7.13))-0.5)*0.3;float rr=length(jt);\n'+
    '   float ring=smoothstep(0.03,0.0,abs(rr-t*0.3))*(1.0-t)*uRainNow;vec2 rd=jt/max(rr,1e-3)*ring*0.3;\n'+
    '   vec2 wv=vec2(wxN(vWxP.xz*1.6+uWxT*0.35),wxN(vWxP.zx*1.6-uWxT*0.3))-0.5+0.35*(vec2(wxN(vWxP.xz*6.0+uWxT),wxN(vWxP.zx*6.0-uWxT))-0.5);\n'+
    '   vec3 Nw=normalize(vec3(rd.x+wv.x*0.05,1.0,rd.y+wv.y*0.05)),Np=normalize((viewMatrix*vec4(Nw,0.0)).xyz);\n'+
    '   vec3 V=isOrthographic?vec3(0.0,0.0,1.0):normalize(-(viewMatrix*vec4(vWxP,1.0)).xyz),Rv=reflect(-V,Np),Rw=(vec4(Rv,0.0)*viewMatrix).xyz;\n'+
    '   float ry=max(Rw.y,0.02);vec3 sky=mix(uSkyH,uSkyZ,sqrt(clamp(ry,0.0,1.0)));\n'+
    '   vec2 cp=Rw.xz/(ry+0.12)*0.9+vWxP.xz*0.09+vec2(uCT,uCT*0.4);float cn=0.5*wxN(cp)+0.3*wxN(cp*2.03+1.7)+0.2*wxN(cp*4.1+9.2);\n'+
    '   sky*=mix(1.0,0.6+0.8*cn,uCov);\n'+
    '   float F=min(1.0,(0.02+0.98*pow(1.0-clamp(dot(Np,V),0.0,1.0),5.0))*2.2+0.07);\n'+
    '   vec3 Lv=normalize((viewMatrix*vec4(uSunW,0.0)).xyz);float sd=max(dot(Rv,Lv),0.0),gl=pow(sd,600.0)*3.0+pow(sd,80.0)*0.12;\n'+
    '   totalEmissiveRadiance+=pd*(sky*F*(1.0+0.5*ring)+uSunC*gl*(0.15+F));}}\n#endif\n'+
    ' float n=0.62*wxN(vWxP.xz*0.45)+0.38*wxN(vWxP.xz*2.1);\n float cv=clamp((uSnow*1.35-(1.0-n))*3.0,0.0,1.0)*up;\n diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.93,0.95,0.98),cv);}');
};
const _mid=new Map();let _midN=0;
function matId(m){let v=_mid.get(m);if(v===undefined){v=++_midN;_mid.set(m,v);}return v;}
const _ds=new Map();
function ds(m){let c=_ds.get(m);if(!c){c=m.clone();c.side=THREE.DoubleSide;MAT_HEX.set(c,MAT_HEX.get(m));_ds.set(m,c);}return c;}

/* tile texture shared by every roof (tinted by material colour) */
function canvasTex(w,h,draw,repeat){
  const c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d');draw(ctx,w,h);
  const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;
  if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;}
  t.userData={c:c,ctx:ctx,draw:draw};return t;
}
function redraw(t){t.userData.draw(t.userData.ctx,t.userData.c.width,t.userData.c.height);t.needsUpdate=true;}
const tileTex=canvasTex(64,64,(c,w,h)=>{
  c.fillStyle='#fff';c.fillRect(0,0,w,h);
  for(let r=0;r<2;r++){
    const y=r*32;
    const g=c.createLinearGradient(0,y,0,y+32);g.addColorStop(0,'#e6e6e6');g.addColorStop(.75,'#ffffff');g.addColorStop(1,'#8e8e8e');
    c.fillStyle=g;c.fillRect(0,y,w,32);
    c.fillStyle='rgba(0,0,0,.16)';
    for(let k=0;k<4;k++){c.fillRect(k*16+(r?8:0),y,2,32);}
  }
},true);

const C={
  cal:0xEFE8DA, cal2:0xE8DFCD, granate:0x8A2E27, teja:0xB5603F, teja2:0xA9573C, teja3:0xC27352, tejaVieja:0x9C6450,
  piedra:0xCDB994, piedra2:0xBBA781, piedraOsc:0x9E8D6E,
  hormigon:0xC7BFAF, bordillo:0xE6DFCF, amarillo:0xE2B63B,
  balasto:0x8C847A, traviesa:0x9C978E, carril:0x6E645B,
  hierro:0x3B4245, galva:0x7F8782, verdeFarola:0x2F4C3D, madera:0x6B4A33, maderaClara:0x9A7552,
  cristal:0x2C3A41, puerta:0x4A3A2C, azulAdif:0x1D4F91, blanco:0xF4F1EA, negro:0x1E2022, rojo:0xB33A2E,
  vagon:0x7A3A2C, chasis:0x2D2A28, tronco:0x6D5844, encina:0x4C5F3A, encina2:0x5B6C40, encina3:0x3F5233,
  chopo:0xD7B341, chopo2:0xB7A845, platano:0x93A050, paca:0xD8B868, tractor:0x2F6B3A, coche:0xB8C0C4,
  nave:0xD69B78, chapa:0xA9A8A0, silo:0xBFC2C0, tierra1:0x6E5136, tierra2:0xA97F55, tierra3:0xD2BC93,
  marco:0x5E4130, marco2:0x4A3324, cigueña:0xF6F4EF, nido:0x6A5236, bronce:0x6F5A34, aislador:0x5A2C36
};
const M={};
Object.keys(C).forEach(k=>{M[k]=lam(C[k]);});
/* lamp glass and lit windows (three window groups switch on and off at different hours) */
M.farola=lam(C.blanco);M.vA=lam(C.cristal);M.vB=lam(C.cristal);M.vC=lam(C.cristal);M.vSala=lam(C.cristal);M.vViv=lam(C.cristal);
[M.farola,M.vA,M.vB,M.vC,M.vSala,M.vViv].forEach(m=>{m.emissive=new THREE.Color(0xFFC983);m.emissiveIntensity=0;});M.farola.emissive.setHex(0xFFE2B0);
/* window glass picked by position (does not consume the village's random stream) */
/* house windows: a third stay dark (curtains, empty rooms); the rest share one lit material per house, so each house switches its own lights (houseLights) */
function houseWin(H,x,y,z){const r=Math.abs(Math.sin(x*12.9898+y*78.233+z*37.719)*43758.5453)%1;if(r<0.34)return M.cristal;
  if(!H.winM){H.winM=lam(C.cristal);H.winM.emissive=new THREE.Color(0xFFC983);H.winM.emissiveIntensity=0;H.lit=0;}return H.winM;}
function winMat(x,y,z){const r=Math.abs(Math.sin(x*12.9898+y*78.233+z*37.719)*43758.5453)%1;return r<0.34?M.cristal:(r<0.5?M.vA:(r<0.8?M.vB:M.vC));}
const ROOF=[C.teja,C.teja2,C.teja3,C.tejaVieja].map(h=>{const m=lam(h,{map:tileTex,side:THREE.DoubleSide});return m;});
const WALLS=[M.cal,M.cal,M.cal2,lam(0xD9A866),lam(0xE3A37D),lam(0xCDBB98),lam(0xE2CFA8),lam(0xD4B48C)];

const GEO={
  box:new THREE.BoxGeometry(1,1,1),
  cyl:new THREE.CylinderGeometry(1,1,1,14),
  cyl6:new THREE.CylinderGeometry(1,1,1,6),
  ico:new THREE.IcosahedronGeometry(1,1),
  cone:new THREE.ConeGeometry(1,1,10),
  cone4:new THREE.ConeGeometry(1,1,4),
  halfcyl:new THREE.CylinderGeometry(1,1,1,12,1,false,0,PI),
  halfcone:new THREE.ConeGeometry(1,1,12,1,false,0,PI)
};
const BATCH=new Map();
function put(g,mat,x,y,z,sx,sy,sz,rx,ry,rz,noShadow){
  const key=g+'|'+matId(mat);
  let b=BATCH.get(key);if(!b){b={g:g,mat:mat,list:[],shadow:!noShadow};BATCH.set(key,b);}
  b.list.push([x,y,z,sx,sy,sz,rx||0,ry||0,rz||0]);
}
function sbox(mat,cx,y0,cz,w,h,d,ry,noShadow){put('box',mat,cx,y0+h/2,cz,w,h,d,0,ry||0,0,noShadow);}
function sboxX(mat,x0,x1,y0,y1,z0,z1,noShadow){sbox(mat,(x0+x1)/2,y0,(z0+z1)/2,Math.abs(x1-x0),y1-y0,Math.abs(z1-z0),0,noShadow);}
function scyl(mat,cx,y0,cz,r,h,six){put(six?'cyl6':'cyl',mat,cx,y0+h/2,cz,r,h,r);}
function sico(mat,cx,cy,cz,sx,sy,sz){put('ico',mat,cx,cy,cz,sx,sy,sz);}
function scone(mat,cx,y0,cz,r,h,four){put(four?'cone4':'cone',mat,cx,y0+h/2,cz,r,h,r,0,four?PI/4:0,0);}
const _o=new THREE.Object3D();
function flushBatches(){
  BATCH.forEach(b=>{
    const im=new THREE.InstancedMesh(GEO[b.g],b.mat,b.list.length);
    for(let i=0;i<b.list.length;i++){const p=b.list[i];
      _o.position.set(p[0],p[1],p[2]);_o.scale.set(p[3],p[4],p[5]);_o.rotation.set(p[6],p[7],p[8]);_o.updateMatrix();im.setMatrixAt(i,_o.matrix);}
    im.castShadow=b.shadow;im.receiveShadow=true;im.frustumCulled=false;im.instanceMatrix.needsUpdate=true;scene.add(im);
  });
}
const SOUP=new Map();
function soup(mat,noShadow){const k=matId(mat);let s=SOUP.get(k);if(!s){s={mat:mat,pos:[],uv:[],shadow:!noShadow};SOUP.set(k,s);}return s;}
function tri(s,a,b,c,ua,ub,uc){
  s.pos.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);
  ua=ua||[0,0];ub=ub||[0,0];uc=uc||[0,0];s.uv.push(ua[0],ua[1],ub[0],ub[1],uc[0],uc[1]);
}
function quad(s,a,b,c,d,ua,ub,uc,ud){tri(s,a,b,c,ua,ub,uc);tri(s,a,c,d,ua,uc,ud);}
function geoFrom(s){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(s.pos,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(s.uv,2));
  g.computeVertexNormals();return g;
}
function flushSoups(){
  SOUP.forEach(s=>{if(!s.pos.length)return;const m=new THREE.Mesh(geoFrom(s),s.mat);m.castShadow=s.shadow;m.receiveShadow=true;scene.add(m);});
}

/* sweep a 2D profile [u (across), v (up)] along a polyline of [x,z] points */
function frames(pts){
  return pts.map((p,i)=>{const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];
    let tx=b[0]-a[0],tz=b[1]-a[1];const l=Math.hypot(tx,tz)||1;tx/=l;tz/=l;
    return {x:p[0],z:p[1],tx:tx,tz:tz,nx:-tz,nz:tx};});
}
function sweep(s,F,prof,uOff,yB){
  for(let i=0;i<F.length-1;i++){const A=F[i],B=F[i+1];
    for(let k=0;k<prof.length-1;k++){const p0=prof[k],p1=prof[k+1];
      const P=(f,p)=>[f.x+f.nx*(p[0]+uOff),yB+p[1],f.z+f.nz*(p[0]+uOff)];
      quad(s,P(A,p0),P(A,p1),P(B,p1),P(B,p0));}}
}

/* roofs: ridge along x (axis 'x') or along z (axis 'z') */
function gable(roofMat,wallMat,x0,x1,z0,z1,yE,rise,o,axis){
  const rs=soup(roofMat), ws=soup(ds(wallMat));
  const sw=axis==='z';
  const P=(u,y,v)=>sw?[v,y,u]:[u,y,v];
  const u0=sw?z0:x0,u1=sw?z1:x1,v0=sw?x0:z0,v1=sw?x1:z1;
  const vm=(v0+v1)/2,half=(v1-v0)/2,yR=yE+rise,yO=yE-rise/half*o,run=half+o;
  const A=P(u0-o,yO,v0-o),B=P(u1+o,yO,v0-o),R1=P(u0-o,yR,vm),R2=P(u1+o,yR,vm),Cc=P(u1+o,yO,v1+o),D=P(u0-o,yO,v1+o);
  quad(rs,A,R1,R2,B,[u0-o,0],[u0-o,run],[u1+o,run],[u1+o,0]);
  quad(rs,Cc,R2,R1,D,[u1+o,0],[u1+o,run],[u0-o,run],[u0-o,0]);
  tri(ws,P(u0,yE,v0),P(u0,yE,v1),P(u0,yR,vm));
  tri(ws,P(u1,yE,v1),P(u1,yE,v0),P(u1,yR,vm));
}
function hip(roofMat,x0,x1,z0,z1,yE,rise,o){
  const s=soup(roofMat);
  const xa=x0-o,xb=x1+o,za=z0-o,zb=z1+o,zm=(za+zb)/2,hd=(zb-za)/2;
  let r1=xa+hd,r2=xb-hd;if(r1>r2){r1=r2=(xa+xb)/2;}
  const yR=yE+rise,yO=yE-rise/((z1-z0)/2)*o;
  const A=[xa,yO,za],B=[xb,yO,za],Cc=[xb,yO,zb],D=[xa,yO,zb],R1=[r1,yR,zm],R2=[r2,yR,zm];
  quad(s,A,R1,R2,B,[xa,0],[r1,hd],[r2,hd],[xb,0]);
  quad(s,Cc,R2,R1,D,[xb,0],[r2,hd],[r1,hd],[xa,0]);
  tri(s,A,D,R1,[za,0],[zb,0],[zm,r1-xa]);
  tri(s,Cc,B,R2,[zb,0],[za,0],[zm,xb-r2]);
}

/* =====================================================================
   6. Entities (everything you can hover or select)
   ===================================================================== */
const ENT={};const PICK=[];
const HIT=new THREE.MeshBasicMaterial({visible:false});
const hitGroup=new THREE.Group();scene.add(hitGroup);
function ent(id,o){ENT[id]=Object.assign({id:id,rows:[],hl:[]},o);return ENT[id];}
function hitBox(id,cx,y0,cz,w,h,d,ry){
  const m=new THREE.Mesh(GEO.box,HIT);m.position.set(cx,y0+h/2,cz);m.scale.set(w,h,d);m.rotation.y=ry||0;
  m.userData.ent=id;hitGroup.add(m);m.updateMatrixWorld(true);PICK.push(m);return m;
}
function bb(id,x0,y0,z0,x1,y1,z1){ENT[id].bb=[x0,y0,z0,x1,y1,z1];ENT[id].anchor=[(x0+x1)/2,y1,(z0+z1)/2];}

/* =====================================================================
   7. Village plan (computed first so the ground can be painted around it)
   ===================================================================== */
function distPoly(px,pz,p){let d=1e9;for(let i=1;i<p.length;i++)d=Math.min(d,distSeg(px,pz,p[i-1],p[i]));return d;}
function distSeg(px,pz,a,b){const dx=b[0]-a[0],dz=b[1]-a[1];const L=dx*dx+dz*dz||1;let t=((px-a[0])*dx+(pz-a[1])*dz)/L;t=clamp(t,0,1);return Math.hypot(px-(a[0]+dx*t),pz-(a[1]+dz*t));}
/* plano: plano del pueblo: calles, caminos, plaza, casas, naves y árboles (en el archivo del nivel) */
const {ROADS,CAMINOS,ROADS2,ASF_THRU,PLZ,PLZ_TREES,AYTO,SQ,PK,HOUSES,SHEDS,FARM,TREES,isFree}=NIVEL.plano();
/* =====================================================================
   8. Ground texture (painted top-down) + terrain mesh + diorama board
   ===================================================================== */
const GS=4;   // px per metre
const GX=x=>(x-X0)*GS, GZ=z=>(z-Z0)*GS;
/* suelo: campos y suelo pintado de la maqueta (en el archivo del nivel) */
const {paintMan,treeShade,VD,groundTex,FIELDS}=NIVEL.suelo();
groundTex.anisotropy=renderer.capabilities.getMaxAnisotropy?Math.min(8,renderer.capabilities.getMaxAnisotropy()):4;
const groundMat=new THREE.MeshLambertMaterial({map:groundTex});MAT_HEX.set(groundMat,0xB6A673);
groundMat.defines=Object.assign({},groundMat.defines,{WX_PUD:'1.0'});
[M.hormigon,M.bordillo].forEach(m=>{m.defines=Object.assign({},m.defines,{WX_PUD:'2.0'});});   // platforms
(function terrain(){
  const sx=130,sz=70;
  const g=new THREE.PlaneGeometry(BW,BD,sx,sz);
  g.rotateX(-PI/2);g.translate((X0+X1)/2,0,(Z0+Z1)/2);
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++){p.setY(i,groundH(p.getX(i),p.getZ(i)));}
  g.computeVertexNormals();
  const m=new THREE.Mesh(g,groundMat);m.receiveShadow=true;m.castShadow=true;scene.add(m);
})();
/* village close-up: 12 px/m (8 on phones) over the village and the station square, on a mesh that follows the terrain
   triangle for triangle, so streets, paving and car-park lines stay sharp up close */
/* the same close-up strips along the roads out of the village, so their paint stays sharp too (edges on the 4 m grid,
   abutting the village one and each other) */
function groundDecal(V,shade){const S=IS_PHONE?8:12,W=(V.x1-V.x0)*S,H=(V.z1-V.z0)*S;
  const t=canvasTex(W,H,c=>{c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(groundTex.userData.c,(V.x0-X0)*GS,(V.z0-Z0)*GS,(V.x1-V.x0)*GS,(V.z1-V.z0)*GS,0,0,W,H);
    /* fine grain at this scale (grit, pebbles, dry grass specks), so the enlarged board texture does not look out of focus;
       the streets and pavings are painted over it */
    if(shade){const G=mulberry(3391+Math.round(V.x0)),N=Math.round((V.x1-V.x0)*(V.z1-V.z0)*2.2),cols=['rgba(236,224,188,.34)','rgba(120,104,70,.3)','rgba(160,142,98,.3)','rgba(104,112,62,.28)','rgba(206,196,170,.4)'];
      for(let i=0;i<N;i++){const x=G()*W,y=G()*H,k=Math.floor(G()*cols.length),r=k===4?S*(0.05+0.07*G()):S*(0.025+0.05*G()),ed=Math.min(x,y,W-x,H-y)/(8*S);if(ed<G())continue;c.fillStyle=cols[k];   // thinning out towards the edges, where the board texture takes over
        if(k===3){c.fillRect(x,y,Math.max(1,S*0.03),S*(0.1+0.14*G()));}else{c.beginPath();c.arc(x,y,Math.max(0.6,r),0,TAU);c.fill();}}}
    paintMan(c,S,V.x0,V.z0,W,H);if(shade)treeShade(c,S,V.x0,V.z0,t=>t.x+t.r*1.5>V.x0&&t.x-t.r*1.5<V.x1&&t.z+t.r*1.5>V.z0&&t.z-t.r*1.5<V.z1);});
  t.anisotropy=groundTex.anisotropy;
  const g=new THREE.PlaneGeometry(V.x1-V.x0,V.z1-V.z0,(V.x1-V.x0)/4,(V.z1-V.z0)/4);g.rotateX(-PI/2);g.translate((V.x0+V.x1)/2,0,(V.z0+V.z1)/2);
  const p=g.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,groundH(p.getX(i),p.getZ(i))+0.02);g.computeVertexNormals();
  const mat=new THREE.MeshLambertMaterial({map:t});MAT_HEX.set(mat,0xB6A673);   // no polygon offset: at low angles it would lift the ground over the lamp light
  mat.defines=Object.assign({},mat.defines,{WX_PUD:'1.0'});
  const m=new THREE.Mesh(g,mat);m.receiveShadow=true;scene.add(m);
}
groundDecal(VD,true);
[{x0:92,x1:260,z0:-108,z1:-72},{x0:-260,x1:-132,z0:-88,z1:-28},{x0:-248,x1:-200,z0:-28,z1:80}].forEach(V=>groundDecal(V,false));
(function skirt(){
  const bands=[[M.tierra1,0,-1.0],[M.tierra2,-1.0,-3.6],[M.tierra3,-3.6,-6.2]];
  const edges=[
    {pts:line(X0,X1,Z1,4)},                                        // south, traverse +x
    {pts:line(X1,X0,Z0,4).map(p=>[p[0],Z0])},                       // north, traverse -x
    {pts:(function(){const o=[];for(let z=Z1;z>=Z0-0.01;z-=4)o.push([X1,z]);return o;})()}, // east, traverse -z
    {pts:(function(){const o=[];for(let z=Z0;z<=Z1+0.01;z+=4)o.push([X0,z]);return o;})()}  // west, traverse +z
  ];
  edges.forEach(e=>{
    for(let i=1;i<e.pts.length;i++){const a=e.pts[i-1],b=e.pts[i];const ha=groundH(a[0],a[1]),hb=groundH(b[0],b[1]);
      bands.forEach((bd,k)=>{
        const topA=k===0?ha:(k===1?ha-1.0:-3.6), topB=k===0?hb:(k===1?hb-1.0:-3.6);
        const botA=k===0?ha-1.0:(k===1?-3.6:-6.2), botB=k===0?hb-1.0:(k===1?-3.6:-6.2);
        if(topA<=botA&&topB<=botB)return;
        quad(soup(ds(bd[0])),[a[0],topA,a[1]],[a[0],botA,a[1]],[b[0],botB,b[1]],[b[0],topB,b[1]]);
      });
    }
  });
})();
// wooden frame of the model board
(function frame(){
  const t=1.6,y0=-9.6,y1=-5.4;
  sboxX(M.marco,X0-t,X1+t,y0,y1,Z1,Z1+t);
  sboxX(M.marco,X0-t,X1+t,y0,y1,Z0-t,Z0);
  sboxX(M.marco,X0-t,X0,y0,y1,Z0,Z1);
  sboxX(M.marco,X1,X1+t,y0,y1,Z0,Z1);
  sboxX(M.marco2,X0-t-0.4,X1+t+0.4,y0-0.7,y0,Z0-t-0.4,Z1+t+0.4);
})();
/* placa: placa del marco de la maqueta (en el archivo del nivel) */
const {plaqueTex}=NIVEL.placa();
(function(){const m=new THREE.Mesh(new THREE.PlaneGeometry(56,7),new THREE.MeshLambertMaterial({map:plaqueTex}));
  m.position.set(0,-7.5,Z1+1.62);scene.add(m);})();
const contactTex=canvasTex(256,256,(c,w,h)=>{const g=c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);
  g.addColorStop(0,'rgba(0,0,0,.42)');g.addColorStop(.62,'rgba(0,0,0,.20)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(0,0,w,h);});
(function(){const m=new THREE.Mesh(new THREE.PlaneGeometry(BW*1.35,BD*1.6),new THREE.MeshBasicMaterial({map:contactTex,transparent:true,depthWrite:false}));
  m.rotation.x=-PI/2;m.position.set(0,-10.4,(Z0+Z1)/2);scene.add(m);})();

/* =====================================================================
   9. Track: ballast, sleepers, rails, hit volumes, highlight ribbons
   ===================================================================== */
const HL_HOVER=new THREE.MeshBasicMaterial({color:0xF3D27A,transparent:true,opacity:0.55,depthWrite:false});
const HL_SEL=new THREE.MeshBasicMaterial({color:0xE0574A,transparent:true,opacity:0.75,depthWrite:false});
const LEG_MAT=new THREE.MeshBasicMaterial({color:0x46D17E});
function ribbon(F,width,y,mat){const s={pos:[],uv:[]};sweep(s,F,[[-width/2,0],[width/2,0]],0,y);const m=new THREE.Mesh(geoFrom(s),mat);return m;}
(function tracks(){
  const BAL=[[-2.45,0],[-1.75,0.45],[1.75,0.45],[2.45,0]];
  const RAIL=[[-0.085,0],[-0.085,0.17],[0.085,0.17],[0.085,0]];
  Object.keys(TRACKS).forEach(id=>{
    const T=TRACKS[id];const F=frames(T.pts);T.F=F;
    sweep(soup(M.balasto),F,BAL,0,0.01);
    sweep(soup(M.carril),F,RAIL,-0.835,0.61);
    sweep(soup(M.carril),F,RAIL,0.835,0.61);
    // sleepers every 0.75 m
    let acc=0;
    for(let i=1;i<T.pts.length;i++){const a=T.pts[i-1],b=T.pts[i];const L=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const ry=Math.atan2(b[0]-a[0],b[1]-a[1]);
      while(acc<L){const t=acc/L;put('box',M.traviesa,lerp(a[0],b[0],t),0.53,lerp(a[1],b[1],t),2.6,0.16,0.27,0,ry,0,true);acc+=0.75;}
      acc-=L;}
    // hit + highlight
    const hit=ribbon(F,3.8,0.9,HIT);hit.userData.ent=(SWITCHES.find(S=>S.hl===id)||{}).id||id;hitGroup.add(hit);hit.updateMatrixWorld(true);PICK.push(hit);
    const hl=ribbon(F,2.1,0.83,HL_HOVER);hl.visible=false;hl.renderOrder=2;scene.add(hl);T.hl=hl;
  });
  // buffer-free open line ends are hidden by the frame; add small track-end markers at the board edge
})();
/* switches: motor boxes + position indicator legs */
function legPts(pts,fromStart,len){const a=fromStart?pts:pts.slice().reverse();const o=[a[0]];let L=0;
  for(let i=1;i<a.length;i++){const d=Math.hypot(a[i][0]-a[i-1][0],a[i][1]-a[i-1][1]);
    if(L+d>=len){const t=(len-L)/d;o.push([lerp(a[i-1][0],a[i][0],t),lerp(a[i-1][1],a[i][1],t)]);break;}L+=d;o.push(a[i]);}
  return o;}
SWITCHES.forEach(S=>{
  S.legs.forEach(L=>{
    const z=TZ[L.t];
    const straight=[[L.x,z],[L.x+L.dir*4.5,z],[L.x+L.dir*9,z]];
    const branch=legPts(TRACKS[L.br].pts,L.fromStart,9.2);
    L.mStraight=ribbon(frames(straight),0.62,0.86,LEG_MAT);L.mBranch=ribbon(frames(branch),0.62,0.86,LEG_MAT);
    L.mBranch.visible=false;scene.add(L.mStraight);scene.add(L.mBranch);
    const side=L.t===1?-1:1;
    sbox(M.galva,L.x+L.dir*1.6,0,z+side*2.35,1.1,0.55,0.7);
    sbox(M.amarillo,L.x+L.dir*1.6,0.55,z+side*2.35,1.1,0.06,0.7,0,true);
    L.hit=hitBox(S.id,L.x+L.dir*5,0,z+(branch[branch.length-1][1]-z)/2,11,2.2,Math.abs(branch[branch.length-1][1]-z)+4);
  });
  const L0=S.legs[0];const zs=S.legs.map(l=>TZ[l.t]);
  ent(S.id,{kind:'switch',sw:S,name:S.name,sub:S.connects+' · lado '+S.side});
  const xs=S.legs.map(l=>l.x);
  ENT[S.id].anchor=[(Math.min.apply(null,xs)+Math.max.apply(null,xs))/2+(S.legs.length===1?L0.dir*5:0),1.2,(Math.min.apply(null,zs)+Math.max.apply(null,zs))/2+(S.legs.length===1?2:0)];
  ENT[S.id].hlTracks=S.hl?[S.hl]:[];
});
function setSwitch(id,rev){
  const S=SWITCHES.find(s=>s.id===id);if(!S)return;S.reverse=rev;
  S.legs.forEach(L=>{L.mStraight.visible=!rev;L.mBranch.visible=rev;});
  drawEsq();if(selId===id)renderInspector();
}

/* =====================================================================
   10. Platforms, crossing, station building
   ===================================================================== */
/* estacion: andenes, edificio de viajeros, mobiliario, farolas y muelle (en el archivo del nivel) */
const {nameTex,blueTex,LAMPS}=NIVEL.estacion();
const NIGHT=(function(){
  const glowTex=canvasTex(64,64,(c,w,h)=>{const g=c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(0.18,'rgba(255,255,255,.55)');g.addColorStop(0.5,'rgba(255,255,255,.12)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(0,0,w,h);});
  const poolTex=canvasTex(128,128,(c,w,h)=>{const g=c.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);g.addColorStop(0,'rgba(255,255,255,.9)');g.addColorStop(0.45,'rgba(255,255,255,.35)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(0,0,w,h);});
  /* headlight on the ground ahead of the train: a lamp 1.6 m above the plane aimed at a point 25 m ahead (beam
     sigma 3.5 deg vertical, 7.5 deg horizontal, plus a weak wide spill). Irradiance = beam profile x cos(incidence) / d^2,
     so the light peaks ~14 m ahead and fades all round it: dark under the nose, gone by ~60 m.
     Canvas top row = at the nose, bottom = BEAM.L metres ahead; across = BEAM.W metres. */
  const BEAM={W:14,L:64};
  const beamTex=canvasTex(96,384,(c,w,h)=>{const H=1.6,aim=Math.atan2(H,25),sv=3.5*PI/180,sh=7.5*PI/180,sv2=9*PI/180,sh2=16*PI/180;
    const E=(u,v)=>{const d=Math.sqrt(u*u+v*v+H*H),dep=Math.atan2(H,Math.hypot(u,v))-aim,hz=Math.atan2(u,v);
      const q=dep/sv,r=hz/sh,q2=dep/sv2,r2=hz/sh2;return(Math.exp(-q*q-r*r)+0.08*Math.exp(-q2*q2-r2*r2))*H/(d*d*d);};
    const im=c.createImageData(w,h),val=new Float32Array(w*h);let mx=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const e=E(((x+0.5)/w-0.5)*BEAM.W,(y+0.5)/h*BEAM.L);val[y*w+x]=e;if(e>mx)mx=e;}
    for(let i=0;i<w*h;i++){const a=Math.pow(val[i]/mx,0.8);im.data[i*4]=im.data[i*4+1]=im.data[i*4+2]=255;im.data[i*4+3]=Math.round(255*a);}
    c.putImageData(im,0,0);});
  const spr=(col)=>new THREE.SpriteMaterial({map:glowTex,color:col,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0,clippingPlanes:CLIP});
  const flat=(tex,col)=>new THREE.MeshBasicMaterial({map:tex,color:col,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0,clippingPlanes:CLIP,toneMapped:false});
  return{glowW:spr(0xFFF1D0),glowR:spr(0xFF3A26),glowLamp:spr(0xFFD9A0),haze:Object.assign(spr(0xFFE4C2),{fog:false}),sig:{rojo:spr(0xFF3B2A),verde:spr(0x37F08A),amarillo:spr(0xFFC23A),blanco:spr(0xF2F4FF)},
    pool:Object.assign(flat(poolTex,0xFFC98A),{polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),beam:flat(beamTex,0xFFE7BF),BEAM:BEAM,winMats:[],N:0};
})();
/* =====================================================================
   12. Signals
   ===================================================================== */
const LAMP_OFF=0x1B1C1D;
const LAMP_ON={rojo:0xFF3B2A,verde:0x37F08A,amarillo:0xFFC23A,blanco:0xF4F6FF};
/* mono de retroceso: [foco, columna −1 izq./+1 der., fila +1 arriba/−1 abajo, color] y focos encendidos en cada indicación */
const MONO_L=[['r',-1,1,'rojo'],['tr',1,1,'blanco'],['bl',-1,-1,'blanco'],['br',1,-1,'blanco']];
const MONO_ON={parada:['r'],general:['tr','br'],desviada:['bl','br']};
/* station signals (entry, exit, intermediate) after the Adif model: a rounded black head with a white rim and three lamps
   with visors (green, red, yellow from the top), and under it a round head with the white lamp (rebase autorizado, with
   the red), on a light grey mast with a black band, a ladder behind and a concrete base. Built once for all of them,
   one mesh per material. Local frame: u across the track, y up, w towards the trains it faces. */
const MONO_LOW=[['verde',-1,1],['rojo',1,1],['amarillo',-1,-1],['blanco',1,-1]];
const SIGA={negro:arrNew(),blanco:arrNew(),visera:arrNew()},M_MASTIL=lam(0xB7BBBC),M_VISERA=lam(0x4E5356);
function sigMap(S){const f=S.face,m=(u,y,w)=>[S.x+f*w,y,S.sz-f*u];m.n=(nu,ny,nw)=>[f*nw,ny,-f*nu];return m;}
function sigPrism(A,mp,out,w0,w1){
  const n=out.length,cu=out.reduce((a,p)=>a+p[0],0)/n,cy=out.reduce((a,p)=>a+p[1],0)/n;
  [[w1,1],[w0,-1]].forEach(([w,sg])=>{const o=A.pos.length/3;A.pos.push(...mp(cu,cy,w));A.uv.push(0,0);
    out.forEach(p=>{A.pos.push(...mp(p[0],p[1],w));A.uv.push(0,0);});
    for(let i=0;i<n;i++){const a=o+1+i,b=o+1+(i+1)%n;if(sg>0)A.idx.push(o,a,b);else A.idx.push(o,b,a);}});
  for(let i=0;i<n;i++){const p=out[i],q=out[(i+1)%n];quadN(A,[mp(p[0],p[1],w0),mp(q[0],q[1],w0),mp(q[0],q[1],w1),mp(p[0],p[1],w1)],null,mp.n(q[1]-p[1],-(q[0]-p[0]),0));}
}
const sigStadium=(W,H,yc,k)=>{const R=W/2,hh=H/2-R,o=[];for(let i=0;i<=k;i++){const a=PI*i/k;o.push([R*Math.cos(a),yc+hh+R*Math.sin(a)]);}
  for(let i=0;i<=k;i++){const a=PI+PI*i/k;o.push([R*Math.cos(a),yc-hh+R*Math.sin(a)]);}return o;};
const sigCircle=(r,yc,k)=>{const o=[];for(let i=0;i<k;i++){const a=2*PI*i/k;o.push([r*Math.cos(a),yc+r*Math.sin(a)]);}return o;};
function sigVisor(A,mp,yc,r,w0,w1){const k=7,a0=-0.2,a1=PI+0.2;
  for(let i=0;i<k;i++){const a=a0+(a1-a0)*i/k,b=a0+(a1-a0)*(i+1)/k,P=(t,w)=>mp(r*Math.cos(t),yc+r*Math.sin(t),w);
    const nx=Math.cos((a+b)/2),ny=Math.sin((a+b)/2);
    quadN(A,[P(a,w0),P(b,w0),P(b,w1),P(a,w1)],null,mp.n(nx,ny,0));quadN(A,[P(a,w0),P(a,w1),P(b,w1),P(b,w0)],null,mp.n(-nx,-ny,0));}}
SIGNALS.forEach(S=>{
  const y0=S.y0||0,h=(S.kind==='entrada'?5.8:(S.low?1.15:4.3))+y0;
  const z=S.sz,x=S.x,f=S.face;
  if(S.kind==='retroceso'){monoRetro(S);return;}
  if(S.low)monoLow(S,y0);else{
  const mp=sigMap(S),yW=h-0.47,P=(u,y,w)=>mp(u,y,w);
  // heads: the three-lamp one (0.52 × 1.32 m) and the round one with the white lamp, each with its white rim
  sigPrism(SIGA.blanco,mp,sigStadium(0.62,1.42,h+0.55,8),-0.07,0.09);sigPrism(SIGA.negro,mp,sigStadium(0.52,1.32,h+0.55,8),-0.11,0.12);
  sigPrism(SIGA.blanco,mp,sigCircle(0.28,yW,16),-0.05,0.09);sigPrism(SIGA.negro,mp,sigCircle(0.23,yW,16),-0.09,0.12);
  [h+0.95,h+0.55,h+0.15,yW].forEach(y=>sigVisor(SIGA.visera,mp,y,0.13,0.12,0.24));
  // mast behind the heads, black band, brackets to the round head, ladder and base
  const xm=x-f*0.2,top=h+0.9;
  scyl(M_MASTIL,xm,y0,z,S.low?0.08:0.09,top-y0,false);
  if(!S.low){scyl(M.negro,xm,y0+(h-y0)*0.42,z,0.095,0.38,false);sbox(M.hormigon,xm,y0,z,0.55,0.32,0.55);
    for(const s2 of[-1,1])sbox(M_MASTIL,x-f*0.36,y0+0.3,z+s2*0.17,0.03,top-0.5-y0,0.03,0,true);
    for(let y=y0+0.6;y<top-0.3;y+=0.32)sbox(M_MASTIL,x-f*0.36,y,z,0.025,0.025,0.34,0,true);}
  else sbox(M.hormigon,xm,y0,z,0.36,0.18,0.36);
  for(const s2 of[-1,1]){sbox(M_MASTIL,x-f*0.02,yW,z+s2*0.31,0.04,h-0.05-yW,0.04,0,true);}
  S.lamps={};
  [['verde',h+0.95],['rojo',h+0.55],['amarillo',h+0.15],['blanco',yW]].forEach(L=>{
    const mat=new THREE.MeshBasicMaterial({color:LAMP_OFF});MAT_HEX.set(mat,LAMP_OFF);
    const m=new THREE.Mesh(new THREE.CircleGeometry(0.1,14),mat);
    m.position.set(x+f*0.125,L[1],z);m.rotation.y=f>0?PI/2:-PI/2;scene.add(m);
    S.lamps[L[0]]=mat;
    const gl=new THREE.Sprite(NIGHT.sig[L[0]]);gl.position.set(x+f*0.26,L[1],z);gl.scale.set(1.3,1.3,1);gl.visible=false;scene.add(gl);(S.glow||(S.glow={}))[L[0]]=gl;
  });
  }
  const id='sig:'+S.id;
  const via=vn('v'+S.t),KN={entrada:'Entrada',salida:'Salida',intermedia:'Intermedia',retroceso:'Retroceso'}[S.kind];
  const sideTxt=S.kind==='entrada'?'llegando desde '+S.side:S.kind==='retroceso'?'hacia la estación, lado '+S.side:(S.kind==='intermedia'?'hacia '+S.side:'saliendo hacia '+S.side);
  ent(id,{kind:'signal',sig:S,name:'Señal '+S.id,sub:KN+' · vía '+via+' · '+sideTxt,
    rows:[['Tipo',S.kind==='entrada'?'Entrada · alta':(S.low?KN+' · baja (mono de cuatro focos: verde y rojo arriba, amarillo y blanco abajo)':KN+' · alta')],['Vía',via],['P.K.',S.pk||'—'],
      ['Lado',S.side],S.protects?['Protege',S.protects]:['Protege','Salida de la vía '+via]]});
  hitBox(id,x,y0,z,2.4,h-y0+1.8,2.0);bb(id,x-0.5,y0,z-0.6,x+0.5,h+1.3,z+0.6);
});
Object.keys(SIGA).forEach(k=>{const m=new THREE.Mesh(geoFromArrays(SIGA[k]),k==='negro'?M.negro:k==='blanco'?M.blanco:M_VISERA);m.castShadow=true;m.receiveShadow=true;scene.add(m);});
/* low signals (exits and the intermediate of vías 3 and 5) are monos of four lamps: green top left, red top right,
   yellow bottom left, white bottom right (left and right as the driver coming to it sees them) */
function monoLow(S,y0){
  const x=S.x,z=S.sz,f=S.face,yc=y0+0.62;
  sbox(M.hierro,x,y0,z,0.30,0.22,0.30,0,true);sbox(M.negro,x,y0+0.22,z,0.22,0.70,0.62);
  sbox(M.blanco,x-f*0.115,y0+0.18,z,0.02,0.86,0.80,0,true);
  S.lamps={};S.glow={};
  MONO_LOW.forEach(([col,dz,dy])=>{const mat=new THREE.MeshBasicMaterial({color:LAMP_OFF});MAT_HEX.set(mat,LAMP_OFF);
    const pz=z-f*dz*0.15,py=yc+dy*0.15;
    const m=new THREE.Mesh(new THREE.CircleGeometry(0.09,12),mat);m.position.set(x+f*0.115,py,pz);m.rotation.y=f>0?PI/2:-PI/2;scene.add(m);
    S.lamps[col]=mat;
    const gl=new THREE.Sprite(NIGHT.sig[col]);gl.position.set(x+f*0.2,py,pz);gl.scale.set(0.9,0.9,1);gl.visible=false;scene.add(gl);S.glow[col]=gl;});
}
/* señal de retroceso: mono de cuatro focos a ras de suelo. Arriba a la izquierda el rojo; los otros tres, blancos.
   Parada: el rojo. Con la entrada abierta, hacia vía general sin pasar por los cambios: los dos de la derecha;
   hacia vía desviada: los dos de abajo */
function monoRetro(S){
  const x=S.x,z=S.sz,f=S.face,yc=0.62;
  sbox(M.hierro,x,0,z,0.30,0.22,0.30,0,true);sbox(M.negro,x,0.22,z,0.22,0.70,0.62);
  sbox(M.blanco,x-f*0.115,0.18,z,0.02,0.86,0.80,0,true);
  S.lamps={};S.glow={};
  MONO_L.forEach(([k,dz,dy,col])=>{const mat=new THREE.MeshBasicMaterial({color:LAMP_OFF});MAT_HEX.set(mat,LAMP_OFF);
    const pz=z-f*dz*0.15,py=yc+dy*0.15;   // left/right as seen by the driver coming towards it
    const m=new THREE.Mesh(new THREE.CircleGeometry(0.09,12),mat);m.position.set(x+f*0.115,py,pz);m.rotation.y=f>0?PI/2:-PI/2;scene.add(m);
    S.lamps[k]={mat:mat,col:col};
    const gl=new THREE.Sprite(NIGHT.sig[col]);gl.position.set(x+f*0.2,py,pz);gl.scale.set(0.9,0.9,1);gl.visible=false;scene.add(gl);S.glow[k]=gl;});
  const id='sig:'+S.id,via=vn('v'+S.t);
  ent(id,{kind:'signal',sig:S,name:'Señal '+S.id,sub:'Retroceso · vía '+via+' · hacia la estación, lado '+S.side,
    rows:[['Tipo','Retroceso · mono de cuatro focos (rojo arriba a la izquierda, tres blancos)'],['Vía',via],['P.K.',S.pk||'—'],['Lado',S.side],['Protege',S.protects||'—'],
      ['Indicaciones','Parada: el rojo. Con la entrada abierta, dos blancos a la derecha: va a vía general sin pasar por los cambios; dos blancos abajo: va a vía desviada.'],
      ['Función','Ordena el retroceso a la estación de un tren que ha salido por esta vía y tiene que volver (orden de marcha invalidada). A los trenes que entran por esta vía les repite la entrada: en parada si la entrada está en parada; si está abierta, dice si van a vía general o a desviada.'],
      ['Rebase','Si el itinerario de entrada no tiene comprobación (aguja sin comprobación, falsa ocupación) queda en parada como la entrada: hay que autorizar el rebase de las dos.']]});
  hitBox(id,x,0,z,2.0,2.2,2.0);bb(id,x-0.5,0,z-0.6,x+0.5,1.4,z+0.6);
}
function setAspect(S,a){
  S.aspect=a;
  if(S.kind==='retroceso'){const on=MONO_ON[a]||MONO_ON.parada;
    Object.keys(S.lamps).forEach(k=>{const L=S.lamps[k],lit=on.includes(k);L.mat.color.setHex(lit?LAMP_ON[L.col]:LAMP_OFF);S.glow[k].visible=lit;});return;}
  S.lamps.rojo.color.setHex(a==='parada'?LAMP_ON.rojo:LAMP_OFF);
  S.lamps.verde.color.setHex(a==='libre'?LAMP_ON.verde:LAMP_OFF);
  S.lamps.amarillo.color.setHex(a==='anuncio'?LAMP_ON.amarillo:LAMP_OFF);
  if(a==='rebase')S.lamps.rojo.color.setHex(LAMP_ON.rojo);
  if(S.lamps.blanco)S.lamps.blanco.color.setHex(a==='rebase'?LAMP_ON.blanco:LAMP_OFF);
  if(S.glow){S.glow.rojo.visible=a==='parada'||a==='rebase';S.glow.verde.visible=a==='libre';S.glow.amarillo.visible=a==='anuncio';if(S.glow.blanco)S.glow.blanco.visible=a==='rebase';}
}
SIGNALS.forEach(S=>setAspect(S,'parada'));

/* =====================================================================
   13. Catenary (3 kV cc)
   ===================================================================== */
/* catenaria: catenaria: postes y hilos (en el archivo del nivel) */
NIVEL.catenaria();
/* =====================================================================
   14. Paso a nivel (lado Miranda)
   ===================================================================== */
/* pasoNivel: paso a nivel (en el archivo del nivel) */
const {barriers,deckH}=NIVEL.pasoNivel();
/* =====================================================================
   15. Village: houses, sheds, church, farm
   ===================================================================== */
/* pueblo: casas, naves, iglesia, granja, plaza y ayuntamiento (en el archivo del nivel) */
const {benchW}=NIVEL.pueblo();
function vehicle(name,hex){const G=vehGeo(name),D=VEH[name],g=new THREE.Group(),paint=lam(hex,{side:THREE.DoubleSide});
  Object.keys(G).forEach(k=>{const m=new THREE.Mesh(G[k],k==='paint'?paint:D.mat[k]);m.castShadow=k!=='glass';m.receiveShadow=true;g.add(m);});g.userData.paint=paint;return g;}
function vehGeo(name){const D=VEH[name];if(D.geo)return D.geo;
  const bin=atob(D.b64),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  const dv=new DataView(u8.buffer),nv=dv.getUint32(0,true),nf=dv.getUint32(4,true);let o=8;
  const V=new Int16Array(u8.buffer.slice(o,o+nv*6));o+=nv*6;const F=new Uint16Array(u8.buffer.slice(o,o+nf*6));o+=nf*6;const K=u8.subarray(o,o+nf);
  // face normals (area-weighted) and, per corner, the average of the faces round that vertex that bend less than 35°
  const FN=new Float32Array(nf*3),cnt=new Uint32Array(nv+1);
  for(let f=0;f<nf;f++){const a=F[f*3]*3,b=F[f*3+1]*3,c=F[f*3+2]*3,ux=V[b]-V[a],uy=V[b+1]-V[a+1],uz=V[b+2]-V[a+2],vx=V[c]-V[a],vy=V[c+1]-V[a+1],vz=V[c+2]-V[a+2];
    FN[f*3]=uy*vz-uz*vy;FN[f*3+1]=uz*vx-ux*vz;FN[f*3+2]=ux*vy-uy*vx;for(let j=0;j<3;j++)cnt[F[f*3+j]+1]++;}
  for(let i=0;i<nv;i++)cnt[i+1]+=cnt[i];const adj=new Uint32Array(nf*3),fill=cnt.slice(0,nv);
  for(let f=0;f<nf;f++)for(let j=0;j<3;j++)adj[fill[F[f*3+j]]++]=f;
  const L=f=>Math.hypot(FN[f*3],FN[f*3+1],FN[f*3+2])||1,CR=Math.cos(35*PI/180);
  const A=D.keys.map(()=>({p:[],n:[]}));
  for(let f=0;f<nf;f++){const o2=A[K[f]],lf=L(f);
    for(let j=0;j<3;j++){const v=F[f*3+j];let nx=0,ny=0,nz=0;
      for(let q=cnt[v];q<cnt[v+1];q++){const g=adj[q],lg=L(g);if((FN[f*3]*FN[g*3]+FN[f*3+1]*FN[g*3+1]+FN[f*3+2]*FN[g*3+2])/(lf*lg)<CR)continue;nx+=FN[g*3];ny+=FN[g*3+1];nz+=FN[g*3+2];}
      const ln=Math.hypot(nx,ny,nz)||1;o2.p.push(V[v*3]/1000,V[v*3+1]/1000,V[v*3+2]/1000);o2.n.push(nx/ln,ny/ln,nz/ln);}}
  D.geo={};D.keys.forEach((k,i)=>{if(!A[i].p.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(A[i].p,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(A[i].n,3));D.geo[k]=g;});
  D.mat={};Object.keys(D.cols).forEach(k=>{D.mat[k]=lam(D.cols[k],{side:THREE.DoubleSide});});
  D.b64=null;return D.geo;}
/* plazaEstacion: plaza y aparcamiento de la estación, señales de tráfico, árboles, pacas y tractor (en el archivo del nivel) */
const {PARKING}=NIVEL.plazaEstacion();
/* vegetacion: cereal, rastrojo, hierba y arbustos (en el archivo del nivel); el cereal sigue el mes del día de juego */
const {VEG_SEASON}=NIVEL.vegetacion?NIVEL.vegetacion():{VEG_SEASON:()=>{}};
if(NIVEL.ambiente)NIVEL.ambiente();   // machinery, animals and smoke (they move from NIVEL.tick, called each frame)
flushBatches();
flushSoups();

/* =====================================================================
   16. Camera (orthographic, isometric diorama)
   ===================================================================== */
const camO=new THREE.OrthographicCamera(-1,1,1,-1,1,3000);
/* free camera: perspective, can tilt down to eye level and get close */
const camP=new THREE.PerspectiveCamera(40,1,0.3,6000);
let camera=camO;const FREE={on:false};
/* camara: vista inicial (en el archivo del nivel) */
const {HOME}=NIVEL.camara();
/* the home view frames about 210 m of station across the stage, whatever room the panels leave */
(function(){const a=VW()/VH();if(a>=1)HOME.size=clamp(210/a,115,190);})();
const cam={theta:HOME.theta,elev:HOME.elev,size:HOME.size,target:new THREE.Vector3(HOME.tx,0,HOME.tz)};
const vel={theta:0,elev:0,px:0,pz:0};
let camAnim=null;
function frustum(){
  const w=VW(),h=VH(),a=w/h;let hw,hh;
  if(a>=1){hh=cam.size/2;hw=hh*a;}else{hw=cam.size/2;hh=hw/a;}
  if(camera===camP){camP.aspect=a;camP.updateProjectionMatrix();return;}
  camera.left=-hw;camera.right=hw;camera.top=hh;camera.bottom=-hh;camera.updateProjectionMatrix();
}
function placeCam(){
  frustum();
  const D=FREE.on?camDist():900,ce=Math.cos(cam.elev),se=Math.sin(cam.elev);
  if(FREE.on){camP.near=clamp(D*0.004,0.1,3);camP.far=D+2500;camP.updateProjectionMatrix();}
  camera.position.set(cam.target.x+D*ce*Math.sin(cam.theta),cam.target.y+D*se,cam.target.z+D*ce*Math.cos(cam.theta));
  camera.lookAt(cam.target);camera.updateMatrixWorld();
}
/* perspective distance that shows the same height of scene as the orthographic view */
function camDist(){const a=VW()/VH(),hh=a>=1?cam.size/2:cam.size/2/a;return hh/Math.tan(camP.fov*PI/360);}
function viewW(){if(!FREE.on)return camera.right-camera.left;const a=VW()/VH();return 2*camDist()*Math.tan(camP.fov*PI/360)*a;}
const CAMLIM=()=>FREE.on?{e0:0.0,e1:1.45,s0:3,s1:700}:{e0:0.30,e1:1.38,s0:36,s1:560};
function setFree(on){
  if(CAB.on){cabOff();return;}
  if(on===FREE.on)return;FREE.on=on;camAnim=null;
  if(on){camera=camP;}
  else{camera=camO;cam.target.y=0;const L=CAMLIM();cam.elev=clamp(cam.elev,L.e0,L.e1);cam.size=clamp(cam.size,L.s0,L.s1);}
  const b=document.getElementById('freeCam');if(b)b.setAttribute('aria-pressed',on?'true':'false');
  placeCam();hoverDirtyTag=true;
  toast(on?(IS_TOUCH()?'Cámara libre · arrastra un dedo hacia arriba para bajar hasta el suelo, pellizca para acercarte y mueve con dos dedos':'Cámara libre · arrastra hacia arriba para bajar hasta el suelo y acércate con la rueda'):'Vista de maqueta');
}
function animTo(o,dur){
  if(reduceMotion){if(o.theta!==undefined)cam.theta=o.theta;if(o.elev!==undefined)cam.elev=o.elev;if(o.size!==undefined)cam.size=o.size;
    if(o.tx!==undefined){cam.target.x=o.tx;cam.target.z=o.tz;}return;}
  camAnim={t:0,d:dur||0.7,f:{theta:cam.theta,elev:cam.elev,size:cam.size,tx:cam.target.x,tz:cam.target.z},
    to:{theta:o.theta!==undefined?o.theta:cam.theta,elev:o.elev!==undefined?o.elev:cam.elev,size:o.size!==undefined?o.size:cam.size,
        tx:o.tx!==undefined?o.tx:cam.target.x,tz:o.tz!==undefined?o.tz:cam.target.z}};
}
function stepCam(dt){
  if(CAB.on){camAnim=null;vel.theta=vel.elev=vel.px=vel.pz=0;frustum();return;}   // the cab view places itself once the trains have moved (cabCam)
  if(camAnim){camAnim.t+=dt/camAnim.d;const k=easeIO(clamp(camAnim.t,0,1)),f=camAnim.f,t=camAnim.to;
    cam.theta=lerp(f.theta,t.theta,k);cam.elev=lerp(f.elev,t.elev,k);cam.size=lerp(f.size,t.size,k);
    cam.target.x=lerp(f.tx,t.tx,k);cam.target.z=lerp(f.tz,t.tz,k);if(camAnim.t>=1)camAnim=null;}
  else if(!mode){cam.theta+=vel.theta;cam.elev+=vel.elev;cam.target.x+=vel.px;cam.target.z+=vel.pz;}
  const d=Math.exp(-8*dt);vel.theta*=d;vel.elev*=d;vel.px*=d;vel.pz*=d;
  const CL=CAMLIM();cam.elev=clamp(cam.elev,CL.e0,CL.e1);cam.size=clamp(cam.size,CL.s0,CL.s1);
  /* free camera: the pivot rises to eye height as it gets low, so it never digs into the ground */
  cam.target.y=FREE.on?lerp(cam.target.y,1.6*(1-clamp(cam.elev/0.6,0,1))+0.2,1-Math.exp(-6*dt)):0;
  cam.target.x=clamp(cam.target.x,X0,X1);cam.target.z=clamp(cam.target.z,Z0,Z1);
  placeCam();
}
const ray=new THREE.Raycaster();const _ndc=new THREE.Vector2();const groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
function toNdc(px,py){const r=canvas.getBoundingClientRect();_ndc.set(((px-r.left)/r.width)*2-1,-((py-r.top)/r.height)*2+1);return _ndc;}
function groundAt(px,py){ray.setFromCamera(toNdc(px,py),camera);const v=new THREE.Vector3();return ray.ray.intersectPlane(groundPlane,v)?v:null;}
function zoomAt(px,py,factor){
  const CL=CAMLIM();const a=groundAt(px,py);cam.size=clamp(cam.size*factor,CL.s0,CL.s1);placeCam();const b=groundAt(px,py);
  if(a&&b){cam.target.x+=a.x-b.x;cam.target.z+=a.z-b.z;placeCam();}
}
function panPx(dx,dy){
  const wpp=viewW()/VW();
  const rx=Math.cos(cam.theta),rz=-Math.sin(cam.theta),fx=-Math.sin(cam.theta),fz=-Math.cos(cam.theta);
  const k=1/Math.max(0.3,Math.sin(cam.elev));
  vel.px+=(-dx*rx+dy*fx*k)*wpp*0.22; vel.pz+=(-dx*rz+dy*fz*k)*wpp*0.22;
  cam.target.x+=(-dx*rx+dy*fx*k)*wpp; cam.target.z+=(-dx*rz+dy*fz*k)*wpp;
}

/* ---- cab view: the camera rides on the front of a train of the player's choice, at the height of the driver's eyes, and
   looks wherever the player turns it (drag to look round, wheel or pinch to zoom, Q and E a quarter turn). It shows no
   cab: it is the view from just ahead of the nose. It is the free camera with its place and heading taken from the leading vehicle
   (cabCam, once the trains have moved in the frame); leaving it gives back the view there was, centred on the train ---- */
const CAB={on:false,tr:null,yaw:0,pitch:0,yawTo:null,fov:62,h:null,keep:null,hudT:0};
const CAB_EYE=2.75,CAB_FWD=1.6;   // metres above the rail, and ahead of the nose (so that, looking back, the front of the train is seen and not a wall)
const cabEl=document.createElement('div');cabEl.id='cabhud';cabEl.hidden=true;
cabEl.innerHTML='<span id="cabhud-t"></span><button class="btn" data-c="front" title="Volver a mirar hacia delante">Al frente</button><button class="btn primary" data-c="exit" title="Volver a la maqueta (Esc)">Salir de la cabina</button>';
stageEl.appendChild(cabEl);
cabEl.addEventListener('click',e=>{const b=e.target.closest('[data-c]');if(!b)return;if(b.getAttribute('data-c')==='exit')cabOff();else{CAB.yawTo=0;CAB.pitch=-0.03;}});
/* a train can be ridden while its head is on the board (they run some two kilometres beyond it, over nothing) */
function cabOK(tr){if(!tr||!tr.spawned||tr.done||!tr.cars||!tr.cars.length||!tr.P||TRAINS.indexOf(tr)<0)return false;const x=pathAt(tr.P,tr.s).x;return x>X0+1&&x<X1-1;}
function cabOn(tr){
  if(!cabOK(tr)){toast('La vista desde cabina está disponible mientras el tren está en la maqueta');return;}
  if(!CAB.on)CAB.keep={free:FREE.on,theta:cam.theta,elev:cam.elev,size:cam.size,tx:cam.target.x,tz:cam.target.z};
  CAB.on=true;CAB.tr=tr;CAB.yaw=0;CAB.pitch=-0.03;CAB.yawTo=null;CAB.h=null;CAB.fov=62;CAB.hudT=0;camAnim=null;
  FREE.on=true;camera=camP;cabEl.hidden=false;cabCam(0);hoverDirtyTag=true;uiDirty=true;lastInsp='';paint();
  toast(IS_TOUCH()?'Vista desde cabina · arrastra para mirar alrededor y pellizca para acercar':'Vista desde cabina · arrastra para mirar alrededor, rueda para acercar');
}
function cabOff(why){
  if(!CAB.on)return;const k=CAB.keep||{},tr=CAB.tr;CAB.on=false;CAB.tr=null;cabEl.hidden=true;camAnim=null;
  camP.fov=40;camP.updateProjectionMatrix();FREE.on=!!k.free;camera=k.free?camP:camO;
  if(k.theta!==undefined){cam.theta=k.theta;cam.elev=k.elev;cam.size=k.size;}
  /* left by the player: the view there was, centred on the train; left because the train has gone: the view there was, where it was */
  const a=!why&&cabOK(tr)?pathAt(tr.P,tr.s):null;if(a){cam.target.x=clamp(a.x,X0,X1);cam.target.z=clamp(a.z,Z0,Z1);}else if(k.tx!==undefined){cam.target.x=k.tx;cam.target.z=k.tz;}cam.target.y=0;
  const b=document.getElementById('freeCam');if(b)b.setAttribute('aria-pressed',FREE.on?'true':'false');
  placeCam();hoverDirtyTag=true;uiDirty=true;lastInsp='';paint();toast(why||(FREE.on?'Cámara libre':'Vista de maqueta'));
}
function cabLook(dx,dy){const k=CAB.fov*PI/180/VH();CAB.yawTo=null;CAB.yaw+=dx*k;CAB.pitch=clamp(CAB.pitch+dy*k,-1.35,1.35);}
function cabZoom(f){CAB.fov=clamp(CAB.fov*f,22,95);}
function cabCam(dt){const tr=CAB.tr;
  if(GAME.demo||!cabOK(tr)){cabOff('El tren ha salido de la maqueta · vista de maqueta');return;}
  /* on the nose of the leading vehicle, pointing as its body does (from one bogie to the other, as placeCars lays it) */
  const c=tr.cars[0],cs=tr.s-c.L/2,f=pathAt(tr.P,cs+c.L/2-3),r=pathAt(tr.P,cs-c.L/2+3),dl=Math.hypot(f.x-r.x,f.z-r.z)||1,dx=(f.x-r.x)/dl,dz=(f.z-r.z)/dl,H=Math.atan2(dx,dz);
  if(CAB.h===null)CAB.h=H;else{const d=Math.atan2(Math.sin(H-CAB.h),Math.cos(H-CAB.h));CAB.h+=d*(1-Math.exp(-12*dt));}
  if(CAB.yawTo!==null){const d=CAB.yawTo-CAB.yaw;CAB.yaw+=d*(1-Math.exp(-9*dt));if(Math.abs(d)<0.003){CAB.yaw=CAB.yawTo;CAB.yawTo=null;}}
  const px=c.g.position.x+dx*(c.L/2+CAB_FWD),pz=c.g.position.z+dz*(c.L/2+CAB_FWD),py=c.g.position.y+CAB_EYE,a=CAB.h+CAB.yaw,cp=Math.cos(CAB.pitch);
  frustum();if(camP.fov!==CAB.fov||camP.near!==0.12){camP.fov=CAB.fov;camP.near=0.12;camP.far=5000;camP.updateProjectionMatrix();}
  camP.position.set(px,py,pz);camP.lookAt(px+Math.sin(a)*cp,py+Math.sin(CAB.pitch),pz+Math.cos(a)*cp);camP.updateMatrixWorld();
  /* what the rest reads of the camera (shadows, rain, sound): a view of some 90 m centred a little ahead */
  cam.target.set(clamp(px+Math.sin(a)*35,X0,X1),0,clamp(pz+Math.cos(a)*35,Z0,Z1));cam.size=90;
  CAB.hudT-=dt;if(CAB.hudT<=0){CAB.hudT=0.25;const kmh=Math.round(Math.abs(tr.v||0)*3.6);
    document.getElementById('cabhud-t').innerHTML='Cabina · <b>'+esc(tr.label||('Tren '+tr.svc.num))+'</b> · <b>'+kmh+'</b> km/h';}
}

/* =====================================================================
   17. Render
   ===================================================================== */
function renderFrame(){renderer.render(scene,camera);const I=renderer.info&&renderer.info.render;if(I){PERF.calls=I.calls;PERF.tris=I.triangles;}}
/* performance meter: frames, CPU time of our frame, what the graphics card is asked to draw and to hold */
const PERF={n:0,acc:0,cpu:0,worst:0,t1:0,tm:0,vram:0,ntex:0,calls:0,tris:0};
function texMB(){const seen=new Set();let b=0;
  scene.traverse(o=>{const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];
    ms.forEach(m=>['map','emissiveMap','alphaMap','normalMap','bumpMap','aoMap','lightMap','specularMap'].forEach(k=>{const t=m[k];if(!t||seen.has(t))return;seen.add(t);
      const im=t.image,w=im&&(im.width||im.videoWidth)||0,h=im&&(im.height||im.videoHeight)||0;b+=w*h*4*(t.generateMipmaps===false?1:1.33);}));});
  const sh=sun.shadow&&sun.shadow.mapSize;if(sh)b+=sh.x*sh.y*4;
  b+=canvas.width*canvas.height*8;   // colour + depth of the screen
  PERF.ntex=seen.size;return b/1048576;}
function perfTick(now,t0,dt){const cpu=performance.now()-t0;PERF.n++;PERF.acc+=dt;PERF.cpu+=cpu;PERF.worst=Math.max(PERF.worst,dt*1000);
  if(now-PERF.t1<1000)return;PERF.t1=now;sweep10k(performance.now());
  const fps=PERF.n/Math.max(PERF.acc,1e-3),cpuA=PERF.cpu/PERF.n,worst=PERF.worst;PERF.n=0;PERF.acc=0;PERF.cpu=0;PERF.worst=0;
  if(devP.hidden)return;
  if(now-PERF.tm>3000){PERF.tm=now;PERF.vram=texMB();}
  const M=renderer.info&&renderer.info.memory||{},pr=renderer.info&&renderer.info.programs,heap=performance.memory?performance.memory.usedJSHeapSize/1048576:null;
  const n10=Object.keys(TEX10K).length,f=(v,d)=>(+v||0).toLocaleString('es-ES',{maximumFractionDigits:d||0}),W=(bad,txt)=>bad?'<span class="w">'+txt+'</span>':txt;
  document.getElementById('dev-perf').innerHTML=
    '<b>Fotogramas</b><span>'+W(fps<50,f(fps)+' fps')+' · peor '+W(worst>34,f(worst)+' ms')+'</span>'+
    '<b>CPU</b><span>'+W(cpuA>10,f(cpuA,1)+' ms')+' por fotograma</span>'+
    '<b>Dibujo</b><span>'+W(PERF.calls>400,f(PERF.calls)+' órdenes')+' · '+f(PERF.tris/1000)+' k triángulos</span>'+
    '<b>Tarjeta</b><span>'+W(PERF.vram>600,'≈ '+f(PERF.vram)+' MB')+' · '+PERF.ntex+' texturas ('+n10+' libreas 10000)</span>'+
    '<b>Recursos</b><span>'+f(M.geometries||0)+' geometrías · '+(pr&&pr.length?pr.length:0)+' sombreadores</span>'+
    (heap!=null?'<b>Memoria JS</b><span>'+W(heap>700,f(heap)+' MB')+'</span>':'')+
    '<b>Pantalla</b><span>'+canvas.width+' × '+canvas.height+' (× '+f(pixelCap,2)+')</span>';}
function resize(){
  const w=VW(),h=VH();
  renderer.setPixelRatio(pixelCap);renderer.setSize(w,h,false);
  canvas.style.width='100%';canvas.style.height='100%';
  placeCam();
}

/* =====================================================================
   18. Day and night: sun and moon over Santa Olalla de Bureba
   Real solar position (NOAA formulas) for 42.59 N 3.44 W on today's date
   and the simulation clock in Spanish time (CET/CEST). The track (+x,
   towards Burgos) runs roughly to the SW, bearing 225 deg.
   ===================================================================== */
/* calendario de la carrera: cada jornada (un día de la simulación, de 00:00 a 24:00) cae una estación del año después de
   la anterior. 91 días son 13 semanas justas: todas caen en el mismo día de la semana, laborable. La primera jornada, en
   otoño: miércoles 20 de octubre de 1999. El sol, el clima, la vegetación y la ropa siguen la fecha de la jornada */
const DATE0=new Date(1999,9,20,12),JORN_SALTO=91;
const dayDate=d=>new Date(DATE0.getFullYear(),DATE0.getMonth(),DATE0.getDate()+JORN_SALTO*d,12),dowOf=d=>dayDate(d).getDay(),monthOf=d=>dayDate(d).getMonth();
const ESTACION=m=>m===11||m<=1?'invierno':m<=4?'primavera':m<=7?'verano':'otoño';
/* sitio: situación (latitud, longitud y orientación de la línea) (en el archivo del nivel) */
const {SITE}=NIVEL.sitio();
const DAY={el:40,az:180,N:0,over:null,winT:{A:0,B:0,C:0,S:0,V:0},lampT:0};
const STN={sala:true,warned:null};   // luces de la sala de viajeros (taquillas), las enciende y apaga el jugador
function spainOffset(d){const y=d.getUTCFullYear(),ls=m=>{const t=new Date(Date.UTC(y,m+1,0));return Date.UTC(y,m,t.getUTCDate()-t.getUTCDay(),1);};const u=d.getTime();return(u>=ls(2)&&u<ls(9))?2:1;}
function solarPos(hLocal){
  const now=dayDate(Math.floor(sim.t/86400)),y=now.getFullYear(),doy=Math.floor((Date.UTC(y,now.getMonth(),now.getDate())-Date.UTC(y,0,0))/864e5);
  const tz=spainOffset(now),hu=hLocal-tz,gm=2*PI/365*(doy-1+(hu-12)/24);
  const eq=229.18*(0.000075+0.001868*Math.cos(gm)-0.032077*Math.sin(gm)-0.014615*Math.cos(2*gm)-0.040849*Math.sin(2*gm));
  const de=0.006918-0.399912*Math.cos(gm)+0.070257*Math.sin(gm)-0.006758*Math.cos(2*gm)+0.000907*Math.sin(2*gm)-0.002697*Math.cos(3*gm)+0.00148*Math.sin(3*gm);
  const tst=hu*60+eq+4*SITE.lon,ha=(tst/4-180)*PI/180,la=SITE.lat*PI/180;
  const ce=Math.sin(la)*Math.sin(de)+Math.cos(la)*Math.cos(de)*Math.cos(ha),el=Math.asin(clamp(ce,-1,1));
  const az=Math.atan2(Math.sin(ha),Math.cos(ha)*Math.sin(la)-Math.tan(de)*Math.cos(la))+PI;
  return{el:el*180/PI,az:az*180/PI};
}
/* compass bearing + elevation → scene direction (+x is SITE.bearing, +z is bearing+90) */
function dirOf(az,el,out){const a=(az-SITE.bearing)*PI/180,e=el*PI/180;return out.set(Math.cos(e)*Math.cos(a),Math.sin(e),Math.cos(e)*Math.sin(a));}
/* key frames by sun elevation (degrees): sky zenith / horizon / below-horizon haze, lights */
const SKYK=[
  {e:-18,zen:0x05080F,hor:0x0B1120,gnd:0x07090F,sun:0xFF6A3A,sI:0,hS:0x3C4C78,hG:0x1A1C24,hI:0.30,mI:0.40,bI:0.05},
  {e:-10,zen:0x0C1430,hor:0x1F2643,gnd:0x0B0E18,sun:0xFF6A3A,sI:0,hS:0x404E7C,hG:0x1C1E28,hI:0.32,mI:0.38,bI:0.05},
  {e:-5,zen:0x1F3366,hor:0x7A5A78,gnd:0x1E1E28,sun:0xFF6A3A,sI:0,hS:0x6A6A94,hG:0x2A2830,hI:0.40,mI:0.20,bI:0.08},
  {e:-1,zen:0x3A5A92,hor:0xE08A5C,gnd:0x4E4038,sun:0xFF7A45,sI:0.05,hS:0xA08EA0,hG:0x50443A,hI:0.52,mI:0,bI:0.12},
  {e:3,zen:0x4F78B0,hor:0xF2B079,gnd:0x9A8A74,sun:0xFF9A55,sI:0.45,hS:0xD8C8C0,hG:0x8A7658,hI:0.64,mI:0,bI:0.18},
  {e:10,zen:0x4A86C8,hor:0xDCCBB0,gnd:0xCBC2B0,sun:0xFFC98A,sI:0.95,hS:0xE6E8EA,hG:0xAD9772,hI:0.76,mI:0,bI:0.22},
  {e:25,zen:0x3F80CC,hor:0xC8DCEC,gnd:0xDCD6CA,sun:0xFFF0D6,sI:1.42,hS:0xEEF3F6,hG:0xB9A27C,hI:0.85,mI:0,bI:0.26},
  {e:90,zen:0x3A7CCB,hor:0xC4DAEC,gnd:0xE0DBD0,sun:0xFFF0D6,sI:1.42,hS:0xEEF3F6,hG:0xB9A27C,hI:0.85,mI:0,bI:0.26}];
const _c1=new THREE.Color(),_c2=new THREE.Color(),_sd=new THREE.Vector3(),_md=new THREE.Vector3(),_ld=new THREE.Vector3();
function keyAt(e){let i=0;while(i<SKYK.length-2&&e>SKYK[i+1].e)i++;const a=SKYK[i],b=SKYK[i+1];return{a:a,b:b,t:clamp((e-a.e)/(b.e-a.e),0,1)};}
function mixHex(k,f,out){return out.setHex(k.a[f]).lerp(_c2.setHex(k.b[f]),k.t);}
/* ---------------------------------------------------------------------
   Weather: sunny, cloudy, fog, rain, thunderstorm, snow
   Daily odds for the current month from the AEMET climate normals of
   Burgos Aeropuerto (Villafría, 1981-2010), 40 km from Santa Olalla:
     snow     = days of snow (DN) / days in the month
     rain     = days of precipitation >= 1 mm (DR), less half the snow days
                (snow days that also reach 1 mm), / days in the month
     sunny    = hours of sun (I) / astronomically possible hours, capped by the dry days
     cloudy   = the rest of the dry days
   The sky changes every 3 simulated hours: it keeps its weather with
   probability 0.55 or draws again from the monthly odds, so over time each
   kind of day turns up as often as the odds say.
   --------------------------------------------------------------------- */
/* clima: climatología AEMET de la estación meteorológica más cercana (en el archivo del nivel) */
const {AEMET_BU}=NIVEL.clima();
const MES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const WX_K=['sol','nubes','niebla','lluvia','tormenta','nieve'],WX_N={sol:'Soleado',nubes:'Nublado',niebla:'Niebla',lluvia:'Lluvia',tormenta:'Tormenta',nieve:'Nieve'};
const WX_TGT={sol:{c:0,r:0,s:0},nubes:{c:0.78,r:0,s:0},niebla:{c:0.45,r:0,s:0,f:1},lluvia:{c:1,r:1,s:0},tormenta:{c:1,r:1,s:0,st:1},nieve:{c:0.97,r:0,s:1}};
const WX_BLOCK=3*3600,WX_STAY=0.55;
function dayLen(m){const doy=[15,46,74,105,135,166,196,227,258,288,319,349][m],de=0.4093*Math.sin(2*PI*(doy-81)/365),la=42.36*PI/180;
  return 24/PI*Math.acos(clamp((Math.sin(-0.833*PI/180)-Math.sin(la)*Math.sin(de))/(Math.cos(la)*Math.cos(de)),-1,1));}
/* storm = days of thunder (DT), taken out of the rain days; fog = days of fog (DF), taken out of the dry days */
function climProb(m){const n=new Date(2026,m+1,0).getDate(),A=AEMET_BU,nieve=A.DN[m]/n,tormenta=A.DT[m]/n,niebla=A.DF[m]/n,
  lluvia=Math.max(0,A.DR[m]-0.5*A.DN[m]-A.DT[m])/n,seco=Math.max(0,1-nieve-tormenta-niebla-lluvia),
  sol=Math.min(seco,A.I[m]/(dayLen(m)*n));return{sol:sol,nubes:seco-sol,niebla:niebla,lluvia:lluvia,tormenta:tormenta,nieve:nieve};}
/* whole percentages that add up to 100 (largest remainder) */
function pct100(P){const raw=WX_K.map(k=>P[k]*100),fl=raw.map(Math.floor);let left=100-fl.reduce((a,b)=>a+b,0);
  raw.map((v,i)=>[v-fl[i],i]).sort((a,b)=>b[0]-a[0]).forEach(([,i])=>{if(left>0){fl[i]++;left--;}});const o={};WX_K.forEach((k,i)=>o[k]=fl[i]);return o;}
const WX={k:'sol',over:null,next:0,cover:0,rain:0,snow:0,wet:0,acc:0,pud:0,fog:0,storm:0,flash:0,flashN:0,m:monthOf(0),P:null,cloudT:0};
WX.P=climProb(WX.m);
function wxDraw(){let r=Math.random();for(const q of WX_K){r-=WX.P[q];if(r<0)return q;}return'nubes';}
scene.fog=new THREE.Fog(0x9AA0A8,1e6,2e6);
/* fog lies on the land, not on the lens: in the diorama view it thickens with the distance on the ground from the spot you
   are looking at (the camera stands 900 m off along its axis), so zooming in or out does not change it; the free camera
   keeps ordinary distance-from-the-eye fog */
if(THREE.ShaderChunk)THREE.ShaderChunk.fog_vertex=['#ifdef USE_FOG',
  // the view centre is the point 900 m ahead in view space, so ground offset = R^T (mvPosition + (0,0,900)); viewMatrix only
  ' if(isOrthographic){vec3 d=mvPosition.xyz+vec3(0.0,0.0,900.0);vFogDepth=length(vec2(dot(viewMatrix[0].xyz,d),dot(viewMatrix[2].xyz,d)));}',
  ' else vFogDepth=-mvPosition.z;',
  '#endif'].join('\n');
/* how fog closes in: a veil over everything (fogNear, 0..1) and then a halo that thickens as (d/V)^2, where V = fogFar is the
   distance at which almost nothing is left to see */
if(THREE.ShaderChunk&&THREE.ShaderChunk.fog_fragment)THREE.ShaderChunk.fog_fragment=THREE.ShaderChunk.fog_fragment.replace(
  'float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );',
  'float fq = vFogDepth / fogFar; float fogFactor = clamp( fogNear + ( 1.0 - fogNear ) * ( 1.0 - exp( -3.0 * fq * fq ) ), 0.0, 1.0 );');
/* rain streaks and snowflakes on a lattice that repeats every uS metres, drawn in a box that follows the view */
const PRECIP=(function(){
  const NR=IS_PHONE?6000:15000,NS=IS_PHONE?6000:15000,_f=new THREE.Vector3(),_sz=new THREE.Vector2();
  const sr=new Float32Array(NR*6),er=new Float32Array(NR*2);
  for(let i=0;i<NR;i++){const a=Math.random(),b=Math.random(),c=Math.random();for(let j=0;j<2;j++){sr.set([a,b,c],(i*2+j)*3);er[i*2+j]=j;}}
  const gr=new THREE.BufferGeometry();gr.setAttribute('position',new THREE.BufferAttribute(sr,3));gr.setAttribute('aEnd',new THREE.BufferAttribute(er,1));
  const ss=new Float32Array(NS*3);for(let i=0;i<ss.length;i++)ss[i]=Math.random();
  const gs=new THREE.BufferGeometry();gs.setAttribute('position',new THREE.BufferAttribute(ss,3));
  const U={uC:{value:new THREE.Vector3()},uS:{value:200},uH:{value:60},uT:{value:0},uLen:{value:1},uA:{value:0},uCol:{value:new THREE.Color(1,1,1)},
    uW:{value:new THREE.Vector2(1.6,0.7)},uB:{value:new THREE.Vector4(X0,Z0,X1,Z1)},uPPM:{value:1},uOrtho:{value:1},uPx:{value:1}};
  const Us={};Object.keys(U).forEach(k=>Us[k]={value:U[k].value.clone?U[k].value.clone():U[k].value});
  const head='uniform vec3 uC;uniform float uS,uH,uT;uniform vec2 uW;varying vec2 vXZ;\n'+
    'vec3 place(vec3 s,float sp,vec2 drift){float y=fract(s.y-uT*sp/uH);vec2 xz=s.xz*uS+drift;xz=uC.xz+(fract((xz-uC.xz)/uS+0.5)-0.5)*uS;return vec3(xz.x,uC.y+y*uH,xz.y);}\n';
  const tail='uniform vec3 uCol;uniform float uA;uniform vec4 uB;varying vec2 vXZ;\n';
  const out='if(vXZ.x<uB.x||vXZ.x>uB.z||vXZ.y<uB.y||vXZ.y>uB.w)discard;';
  const rain=new THREE.LineSegments(gr,new THREE.ShaderMaterial({uniforms:U,transparent:true,depthWrite:false,
    vertexShader:head+'attribute float aEnd;uniform float uLen;varying float vE,vK;\nvoid main(){vec3 s=position;float sp=8.0+3.0*fract(s.x*91.7+s.z*13.1);vec3 p=place(s,sp,uW*uT);'+
      'vK=0.35+0.65*fract(s.z*57.3+s.y*21.9);p-=normalize(vec3(uW.x,-sp,uW.y))*uLen*(0.6+0.4*vK)*aEnd;vE=aEnd;vXZ=p.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}',
    fragmentShader:tail+'varying float vE,vK;\nvoid main(){'+out+'gl_FragColor=vec4(uCol,uA*vK*(1.0-vE));}'}));
  const snow=new THREE.Points(gs,new THREE.ShaderMaterial({uniforms:Us,transparent:true,depthWrite:false,
    vertexShader:head+'uniform float uPPM,uOrtho,uPx;\nvoid main(){vec3 s=position;float sp=0.9+0.6*fract(s.x*53.1);'+
      'vec2 sw=vec2(sin(uT*0.9+s.z*40.0),cos(uT*0.7+s.x*33.0))*0.7;vec3 p=place(s,sp,uW*uT*0.45+sw);vXZ=p.xz;'+
      'vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;float ppm=uOrtho>0.5?uPPM:uPPM/max(-mv.z,0.1);gl_PointSize=clamp(0.09*ppm,1.5*uPx,10.0*uPx);}',
    fragmentShader:tail+'void main(){'+out+'vec2 c=gl_PointCoord-0.5;float d=dot(c,c);if(d>0.25)discard;gl_FragColor=vec4(uCol,uA*smoothstep(0.25,0.06,d));}'}));
  [rain,snow].forEach(o=>{o.frustumCulled=false;o.renderOrder=5;o.visible=false;scene.add(o);});
  return{rain:rain,snow:snow,update(dt,day){
    let S,H;
    if(FREE.on){const D=camDist();S=clamp(D*1.6,40,260);H=Math.max(25,S*0.45);_f.subVectors(cam.target,camera.position).setY(0);
      if(_f.lengthSq()<1e-6)_f.set(0,0,-1);_f.normalize();U.uC.value.copy(camera.position).addScaledVector(_f,S*0.3);}
    else{S=viewW()*1.25;H=S*0.3;U.uC.value.copy(cam.target);}
    U.uC.value.y=0;renderer.getDrawingBufferSize(_sz);
    const ppm=FREE.on?_sz.y/(2*Math.tan(camP.fov*PI/360)):_sz.y/(camera.top-camera.bottom),pr=renderer.getPixelRatio();
    U.uT.value+=dt;U.uS.value=S;U.uH.value=H;U.uLen.value=FREE.on?0.8:clamp(12*pr/ppm,0.55,5);
    ['uC','uT','uS','uH'].forEach(k=>{if(Us[k].value.copy)Us[k].value.copy(U[k].value);else Us[k].value=U[k].value;});
    Us.uPPM.value=ppm;Us.uOrtho.value=FREE.on?0:1;Us.uPx.value=pr;
    const nr=Math.round(NR*0.85*clamp(WX.rain*(1.2+0.4*WX.storm),0,1.15)),ns=Math.round(NS*clamp(WX.snow*1.2,0,1));
    rain.visible=nr>0;snow.visible=ns>0;gr.setDrawRange(0,nr*2);gs.setDrawRange(0,ns);
    U.uCol.value.copy(U.uCol.value.setHex(0x2A3038).lerp(_c2.setHex(0xBCC3CC),day));U.uA.value=0.32+0.1*WX.storm;
    Us.uCol.value.setHex(0x30343C).lerp(_c2.setHex(0xF4F6FA),day);Us.uA.value=0.9;}};
})();
function wxStep(dt,gdt){
  if(!WX.next){WX.k=wxDraw();WX.next=(Math.floor(sim.t/WX_BLOCK)+1)*WX_BLOCK;const T0=WX_TGT[WX.k];
    WX.cover=T0.c;WX.rain=T0.r;WX.snow=T0.s;WX.fog=T0.f||0;WX.storm=T0.st||0;WX.acc=WX.k==='nieve'?0.6:0;WX.wet=WX.k==='lluvia'?0.8:0;WX.pud=WX.k==='lluvia'?0.7:0;}
  while(sim.t>=WX.next){if(Math.random()>=WX_STAY)WX.k=wxDraw();WX.next+=WX_BLOCK;}
  /* clouds build up in ~25 simulated minutes and rain or snow starts once the sky is overcast;
     forced from the developer panel, the change takes a few seconds */
  const k=WX.over||WX.k,T=WX_TGT[k],fast=WX.over?dt/2.5:0,hr=gdt/3600;
  const ap=(v,t,tau)=>v+(t-v)*(1-Math.exp(-(gdt/tau+fast)));
  WX.cover=ap(WX.cover,T.c,1500);const ready=clamp((WX.cover-0.6)/0.3,0,1);
  WX.rain=ap(WX.rain,T.r*ready,900);WX.snow=ap(WX.snow,T.s*ready,900);
  /* fog thickens at night and in the morning and thins to haze in the afternoon; a storm builds with the rain and
     throws lightning (in real time, two-stroke flashes now and then) */
  {const hn=hourNow(),fh=hn<11||hn>=18||WX.over?1:1-0.45*clamp(Math.min(hn-11,18-hn)/2,0,1);WX.fog=ap(WX.fog,(T.f||0)*fh,1200);}
  WX.storm=ap(WX.storm,(T.st||0)*ready,600);
  if(WX.storm>0.5&&Math.random()<dt*0.1*WX.storm){WX.flash=1;WX.flashN=Math.random()<0.6?1:0;WX.bolt=(WX.bolt||0)+1;}
  WX.flash=Math.max(0,WX.flash-dt*6);if(WX.flash<0.15&&WX.flashN>0){WX.flash=0.8;WX.flashN--;}
  /* ground: snow settles in ~1.5 h of steady snowfall and melts at a pace set by the month's mean temperature;
     rain soaks it in ~15 min and it dries in ~3 h */
  if(WX.snow>0.3)WX.acc=Math.min(1,WX.acc+(hr*0.7+fast*0.5)*WX.snow);
  else WX.acc=Math.max(0,WX.acc-(hr*(0.1+0.03*AEMET_BU.T[WX.m])+(k!=='nieve'?fast*0.5:0)));
  if(WX.rain>0.3)WX.wet=Math.min(1,WX.wet+(hr*4+fast)*WX.rain);
  else WX.wet=Math.max(WX.acc>0.05&&WX.snow<0.3?0.5*WX.acc:0,WX.wet-hr*(0.12+0.012*AEMET_BU.T[WX.m])*(1.3-0.6*WX.cover));
  /* puddles: the first ones show within minutes of the rain, they fill in ~40 min (~40 s when forced) and dry slowly,
     only with simulated time: ~6 h in winter, ~4 h in summer, longer under cloud */
  if(WX.rain>0.3)WX.pud=Math.min(1,WX.pud+(hr*1.5+fast*0.06)*WX.rain);
  else WX.pud=Math.max(0,WX.pud-hr*(0.1+0.008*AEMET_BU.T[WX.m])*(1.3-0.6*WX.cover));
  WXU.uSnow.value=WX.acc;WXU.uWet.value=WX.wet*(1-WX.acc);WXU.uPud.value=WX.pud;WXU.uRainNow.value=WX.rain;WXU.uWxT.value+=dt;
  WX.cloudT+=dt*0.006*(1+WX.rain);
}
const _cc=new THREE.Color(),_gy=new THREE.Color(),_fc=new THREE.Color();
function greyOf(c,out){const l=0.3*c.r+0.59*c.g+0.11*c.b;return out.setRGB(l,l*1.01,l*1.04);}
function hourNow(){const h=DAY.over!==null?DAY.over:((sim.t/3600)%24+24)%24;return h;}
function updateDayNight(dt){
  const hl=hourNow(),sp=solarPos(hl);DAY.el=sp.el;DAY.az=sp.az;
  const k=keyAt(sp.el),U=skyMat.uniforms,lin=f=>lerp(k.a[f],k.b[f],k.t);
  dirOf(sp.az,sp.el,_sd);U.uSun.value.copy(_sd);
  /* the moon: a fixed high position to the south-west at night (no lunar ephemeris) */
  dirOf(215,48,_md);U.uMoon.value.copy(_md);
  mixHex(k,'zen',U.uZen.value);mixHex(k,'hor',U.uHor.value);mixHex(k,'gnd',U.uGnd.value);mixHex(k,'sun',U.uSunCol.value);
  U.uSunI.value=clamp((sp.el+2)/4,0,1);U.uStars.value=clamp((-sp.el-5)/7,0,1);U.uMoonI.value=clamp((-sp.el-3)/6,0,1);
  /* clouds: grey deck lit by the hour (warmer at dusk), darker in rain; it hides sun, moon and stars */
  const cv=WX.cover,day=clamp((sp.el+6)/16,0,1),fg=WX.fog,st=WX.storm,fl=WX.flash;
  _cc.setHex(0x14171D).lerp(_c2.setHex(0xBCC1C8),day).lerp(U.uHor.value,0.35*day*(1-day)*4).multiplyScalar((1-0.32*WX.rain)*(1-0.35*st));
  _fc.setHex(0x5C6269).lerp(_c2.setHex(0xD4D7DA),day);   // fog: white-grey by day, a dim grey veil at night (it scatters what light there is)
  _cc.addScalar(0.75*fl);
  U.uCloudCol.value.copy(_cc);U.uCloud.value=cv;U.uCloudT.value=WX.cloudT;
  U.uZen.value.lerp(_cc,0.85*cv);U.uHor.value.lerp(_cc,0.75*cv);U.uGnd.value.lerp(_cc,0.6*cv);
  U.uZen.value.lerp(_fc,0.8*fg);U.uHor.value.lerp(_fc,0.97*fg);U.uGnd.value.lerp(_fc,fg);
  U.uSunI.value*=(1-cv)*(1-fg);U.uStars.value*=(1-cv)*(1-fg);U.uMoonI.value*=(1-cv)*(1-fg);
  sky.position.copy(camera.position);
  // one directional light: the sun by day, the moon by night (shadows kept at a workable angle)
  const sI=lin('sI'),mI=lin('mI');
  if(sI>=mI){dirOf(sp.az,Math.max(sp.el,14),_ld);mixHex(k,'sun',sun.color);sun.intensity=sI*(1-0.85*cv)*(1-0.7*fg);}
  else{dirOf(215,48,_ld);sun.color.setHex(0x9FB4E0);sun.intensity=mI*(1-0.9*cv)*(1-0.8*fg);}
  {const C=sun.shadow.camera,hw=clamp(Math.ceil((viewW()*0.62+40)/40)*40,160,Math.max(BW,BD)/2+90),g=hw/64;
    if(C.right!==hw){C.left=-hw;C.right=hw;C.top=Math.min(hw,300);C.bottom=-Math.min(hw,300);C.updateProjectionMatrix();}
    sun.target.position.set(Math.round(clamp(cam.target.x,X0,X1)/g)*g,0,Math.round(clamp(cam.target.z-55*(hw/520),Z0,Z1)/g)*g);sun.target.updateMatrixWorld();}
  sun.position.copy(sun.target.position).addScaledVector(_ld,400);
  mixHex(k,'hS',hemi.color);mixHex(k,'hG',hemi.groundColor);hemi.intensity=lin('hI')*(1+0.2*cv)*(1-0.25*WX.rain)*(1-0.3*st)*(1+0.1*fg+0.45*fg*(1-day))+2.2*fl;bounce.intensity=lin('bI')*(1-0.5*cv);
  // overcast and foggy light is grey and even; settled snow throws light back up; lightning is a cold white flash
  hemi.color.lerp(greyOf(hemi.color,_gy),Math.min(1,0.6*cv+0.6*fg));hemi.groundColor.lerp(greyOf(hemi.groundColor,_gy),0.5*cv).lerp(_c2.setHex(0xD8DCE2),0.55*WX.acc);
  if(fl>0)hemi.color.lerp(_c2.setHex(0xDCE4FF),Math.min(1,fl));
  renderer.toneMappingExposure=0.98*(1-0.08*WX.rain);
  WXU.uSkyZ.value.copy(U.uZen.value).convertSRGBToLinear().multiplyScalar(0.85);WXU.uSkyH.value.copy(U.uHor.value).convertSRGBToLinear().multiplyScalar(0.85);
  WXU.uCov.value=cv;WXU.uCT.value=WX.cloudT;WXU.uSunW.value.copy(_sd);WXU.uSunC.value.copy(sun.color).multiplyScalar(sI>=mI?sun.intensity*U.uSunI.value:0);
  /* falling rain or snow hides the far side of the diorama */
  {const f=clamp(0.55*WX.rain*(1+0.3*st)+0.75*WX.snow+0.08*cv+0.97*fg,0,1),F=scene.fog;
   if(f<0.01){F.near=0;F.far=1e7;}
   else if(FREE.on){F.near=0.1*fg;F.far=lerp(4000,150,f);}
   else{   // metres on the ground from the view centre. Thick fog: a light veil (18 %), half hidden at ~100 m,
           // gone by ~200 m; the afternoon haze (fog 0.55) closes by ~320 m (forced from the panel, fog stays thick). Rain and snow only dim the far ends of the board
     const fo=Math.max(fg,0.001),ff=200/Math.pow(fo,0.8),fp=clamp(0.55*WX.rain*(1+0.3*st)+0.75*WX.snow+0.08*cv,0,1),pf=600+4000*(1-fp)*(1-fp);
     F.far=Math.min(ff,pf);F.near=Math.max(0.18*fg,0.05*fp);}
   F.color.copy(_cc).lerp(_fc,clamp(fg*1.5,0,1)).convertSRGBToLinear();}
  PRECIP.update(dt,day);
  /* wire colour = mast colour × the light a thin vertical mast face receives (Lambert, legacy lights) */
  {const E=_c1.copy(hemi.color).add(_c2.copy(hemi.groundColor)).multiplyScalar(0.5*hemi.intensity);
   E.add(_c2.copy(sun.color).multiplyScalar(sun.intensity*0.38)).add(_c2.copy(bounce.color).multiplyScalar(bounce.intensity*0.3));
   WIRE_MAT.color.setHex(C.galva).multiply(E);}
  // night factor for artificial lights: on from 4 deg above the horizon to fully at -3
  const N=clamp((4-(sp.el-6*cv-2*WX.rain-5*fg-3*st))/7,0,1);DAY.N=N;NIGHT.N=N;
  const ap=(cur,tg,r)=>cur+(tg-cur)*(1-Math.exp(-r*dt));
  DAY.lampT=ap(DAY.lampT,N>0.3?1:0,2.5);
  const evening=hl>=17||hl<1,morning=hl>=6&&hl<9.5;
  DAY.winT.A=ap(DAY.winT.A,N>0.45?1:0,1.5);
  DAY.winT.B=ap(DAY.winT.B,N>0.45&&((hl>=17&&hl<23.6)||morning)?1:0,1.2);
  DAY.winT.C=ap(DAY.winT.C,N>0.45&&hl>=18&&hl<22.2?1:0,1.0);
  M.farola.emissiveIntensity=1.3*DAY.lampT;M.vA.emissiveIntensity=0.85*DAY.winT.A;M.vB.emissiveIntensity=0.85*DAY.winT.B;M.vC.emissiveIntensity=0.85*DAY.winT.C;
  // station building: the gabinete de circulación is lit all night (you are working); the sala de viajeros only while
  // its lights are on; the vivienda del jefe de estación goes to bed around midnight and gets up at six
  {const night=Math.floor((sim.t-43200)/86400),rh=k=>Math.abs(Math.sin(k*12.9898+night*37.719)*43758.5453)%1,tt=((hl-12)%24+24)%24;
   DAY.winT.S=ap(DAY.winT.S,N>0.45&&STN.sala?1:0,3);DAY.winT.V=ap(DAY.winT.V,N>0.45&&(tt<11.25+rh(1)||tt>=18+rh(2)*0.75)?1:0,3);
   M.vSala.emissiveIntensity=0.85*DAY.winT.S;M.vViv.emissiveIntensity=0.85*DAY.winT.V;}
  NIGHT.glowLamp.opacity=0.9*DAY.lampT;NIGHT.haze.opacity=0.3*DAY.lampT*WX.fog;NIGHT.pool.opacity=0.42*DAY.lampT*(1+0.75*WX.wet);
  NIGHT.glowW.opacity=0.15+0.85*N;NIGHT.glowR.opacity=0.10+0.80*N;NIGHT.beam.opacity=0.75*N;
  Object.values(NIGHT.sig).forEach(m=>m.opacity=0.85*N);
  NIGHT.winMats.forEach(m=>m.emissiveIntensity=0.9*N);
  if(window.MARCAS_M)MARCAS_M.emissiveIntensity=0.35*(1-N);
  houseLights(hl,N,ap);
}
/* lamp glows and the pools of light they throw on the ground (radius 6 m) */
(function lampFX(){
  LAMPS.forEach(p=>{const s=new THREE.Sprite(NIGHT.glowLamp);s.position.set(p[0],p[1],p[2]);s.scale.set(3.2,3.2,1);scene.add(s);
    const h=new THREE.Sprite(NIGHT.haze);h.position.set(p[0],p[1]-0.6,p[2]);h.scale.set(13,13,1);h.renderOrder=3;scene.add(h);});   // in fog each lamp lights a ball of mist round it
  const flatL=LAMPS.filter(p=>p[3]===undefined||p[3]===PH),drape=LAMPS.filter(p=>!(p[3]===undefined||p[3]===PH));
  const pg=new THREE.PlaneGeometry(1,1);pg.rotateX(-PI/2);
  const im=new THREE.InstancedMesh(pg,NIGHT.pool,flatL.length);
  flatL.forEach((p,i)=>{_o.position.set(p[0],PH+0.03,p[2]);_o.scale.set(12.1,1,12.1);_o.rotation.set(0,0,0);_o.updateMatrix();im.setMatrixAt(i,_o.matrix);});
  im.frustumCulled=false;im.renderOrder=2;scene.add(im);
  const N=10,R=6.05,pos=[],uv=[],idx=[];
  drape.forEach(p=>{const cx=p[0]+(p[4]||0)*0.4,cz=p[2]+(p[5]||0)*0.4,b=pos.length/3;
    for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){const x=cx-R+2*R*i/N,z=cz-R+2*R*j/N;pos.push(x,walkY(x,z)+0.06,z);uv.push(i/N,1-j/N);}
    for(let j=0;j<N;j++)for(let i=0;i<N;i++){const a=b+j*(N+1)+i;idx.push(a,a+N+1,a+1,a+1,a+N+1,a+N+2);}});
  // a wall lantern also lights the wall it hangs on: the ground pool and this one together make the full disc
  drape.forEach(p=>{if(p[4]===undefined)return;const nx=p[4],nz=p[5],wx=p[0]-nx*0.58+nx*0.05,wz=p[2]-nz*0.58+nz*0.05,tx=-nz,tz=nx,H=3.2,b=pos.length/3;
    for(let j=0;j<=1;j++)for(let i=0;i<=N;i++){const u=i/N,x=wx+tx*(-R+2*R*u),z=wz+tz*(-R+2*R*u),gy=walkY(x-nx*0.6,z-nz*0.6),y=gy+(j?H:0);
      pos.push(x,y,z);uv.push(u,0.5+(j?H:0)/(2*R));}
    for(let i=0;i<N;i++){const a=b+i;idx.push(a,a+1,a+N+1,a+1,a+N+2,a+N+1);}});
  if(drape.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);
    const m=new THREE.Mesh(g,NIGHT.pool);m.frustumCulled=false;m.renderOrder=2;scene.add(m);}
})();
/* trains: glows on every lit lamp, a beam ahead of the leading vehicle, lit saloons */
function lampClusters(geo){const p=geo.attributes.position,out=[];
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);let c=out.find(o=>Math.abs(o.x/o.n-x)<0.35&&Math.abs(o.y/o.n-y)<0.35&&Math.abs(o.z/o.n-z)<0.35);
    if(!c){c={x:0,y:0,z:0,n:0};out.push(c);}c.x+=x;c.y+=y;c.z+=z;c.n++;}
  return out.map(o=>[o.x/o.n,o.y/o.n,o.z/o.n]);}
function nightFX(c,sp,i){
  if(!TEX470.ready)return;const W=TEX470.solid.lightW,Rr=TEX470.solid.lightR,add=[];
  c.g.traverse(o=>{if(o.isMesh&&(o.material===W||o.material===Rr))add.push(o);});
  add.forEach(o=>lampClusters(o.geometry).forEach(q=>{const s=new THREE.Sprite(o.material===W?NIGHT.glowW:NIGHT.glowR);s.position.set(q[0],q[1],q[2]+(q[2]>0?0.12:-0.12));
    const big=o.material===W;s.scale.set(big?1.7:0.9,big?1.7:0.9,1);o.parent.add(s);}));
  if(i===0&&(/^(md|loco)/.test(sp.k)||((sp.k==='r432'||sp.k==='r448')&&sp.cab!==0))){const B=NIGHT.BEAM,b=new THREE.Mesh(new THREE.PlaneGeometry(B.W,B.L),NIGHT.beam);b.rotation.x=-PI/2;b.position.set(0,-0.12,(c.rev?-1:1)*(c.L/2+B.L/2));b.renderOrder=2;c.g.add(b);}
}
/* saloon windows glow at night: an emissive mask made from the glass colours of a painted side */
function glassMask(src,hexes){
  const w=src.width,h=src.height,cv=document.createElement('canvas');cv.width=w;cv.height=h;const x=cv.getContext('2d');
  try{const d=src.getContext('2d').getImageData(0,0,w,h).data,o=x.createImageData(w,h),cols=hexes.map(s=>[parseInt(s.slice(1,3),16),parseInt(s.slice(3,5),16),parseInt(s.slice(5,7),16)]);
    for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];const hit=cols.some(c=>Math.abs(c[0]-r)+Math.abs(c[1]-g)+Math.abs(c[2]-b)<10);const v=hit?255:0;o.data[i]=v;o.data[i+1]=v*0.92;o.data[i+2]=v*0.78;o.data[i+3]=255;}
    x.putImageData(o,0,0);}catch(e){x.fillStyle='#000';x.fillRect(0,0,w,h);}
  const t=new THREE.CanvasTexture(cv);t.encoding=THREE.sRGBEncoding;t.userData={c:cv};return t;}
function litSaloon(mat,tex,hexes,unlit){mat.emissive=new THREE.Color(0xFFD7A0);mat.emissiveMap=glassMask(tex.userData.c,hexes);
  if(unlit){const cv=mat.emissiveMap.userData.c;unlit(cv.getContext('2d'),cv.width,cv.height);mat.emissiveMap.needsUpdate=true;}mat.emissiveIntensity=0;NIGHT.winMats.push(mat);}

/* =====================================================================
   19. Hover, selection, inspector
   ===================================================================== */
const el={tag:document.getElementById('tag'),toast:document.getElementById('toast'),insp:document.getElementById('insp'),
  title:document.getElementById('i-title'),sub:document.getElementById('i-sub'),chip:document.getElementById('i-chip'),body:document.getElementById('i-body'),
  mando:document.getElementById('mando'),esq:document.getElementById('esq'),trains:document.getElementById('trains'),tlist:document.getElementById('tlist'),
  trNext:document.getElementById('tr-next'),clock:document.getElementById('clock'),app:document.getElementById('app')};
let hoverId=null,selId=null,toastT=0;
const outlineH=new THREE.LineSegments(new THREE.EdgesGeometry(GEO.box),new THREE.LineBasicMaterial({color:0xF3D27A}));outlineH.visible=false;scene.add(outlineH);
const outlineS=new THREE.LineSegments(new THREE.EdgesGeometry(GEO.box),new THREE.LineBasicMaterial({color:0xE0574A}));outlineS.visible=false;scene.add(outlineS);
const pin=new THREE.Group();(function(){const m=new THREE.MeshBasicMaterial({color:0xC2453B});
  const c=new THREE.Mesh(new THREE.ConeGeometry(0.9,2.2,4),m);c.rotation.x=PI;c.position.y=1.1;pin.add(c);
  const s=new THREE.Mesh(new THREE.SphereGeometry(1.05,12,9),m);s.position.y=2.9;pin.add(s);
  const d=new THREE.Mesh(new THREE.SphereGeometry(0.45,10,8),new THREE.MeshBasicMaterial({color:0xFBF6EC}));d.position.y=2.9;pin.add(d);})();
pin.visible=false;scene.add(pin);
function getA(E){if(!E)return null;return typeof E.anchor==='function'?E.anchor():E.anchor;}
function getBB(E){if(!E)return null;return typeof E.bbFn==='function'?E.bbFn():E.bb;}
function trackIdsOf(id){const E=ENT[id];if(!E)return[];if(E.kind==='track')return[id];if(E.hlTracks)return E.hlTracks;return[];}
function paint(){
  Object.keys(TRACKS).forEach(k=>{TRACKS[k].hl.visible=false;});
  outlineH.visible=false;outlineS.visible=false;
  const show=(id,mat,ol)=>{if(!id||!ENT[id])return;const t=trackIdsOf(id);
    t.forEach(k=>{TRACKS[k].hl.material=mat;TRACKS[k].hl.visible=true;});
    const b=getBB(ENT[id]);if(b&&!t.length){ol.position.set((b[0]+b[3])/2,(b[1]+b[4])/2,(b[2]+b[5])/2);ol.scale.set(Math.abs(b[3]-b[0])+1,Math.abs(b[4]-b[1])+0.8,Math.abs(b[5]-b[2])+1);ol.visible=true;}};
  if(hoverId&&hoverId!==selId)show(hoverId,HL_HOVER,outlineH);
  if(!(CAB.on&&selId&&ENT[selId]&&ENT[selId].train===CAB.tr))show(selId,HL_SEL,outlineS);   // (from its own cab, a train is not outlined)
  updatePin();
  document.querySelectorAll('#esq [data-ent]').forEach(n=>{const id=n.getAttribute('data-ent');n.classList.toggle('sel',id===selId);n.classList.toggle('hl',id===hoverId);});
}
function updatePin(){
  const a=selId&&getA(ENT[selId]);
  if(a&&!(CAB.on&&ENT[selId].train===CAB.tr)){pin.position.set(a[0],a[1]+1.5,a[2]);pin.visible=true;pin.scale.setScalar(clamp(cam.size/220,0.45,2.2));}else pin.visible=false;
}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);}
function toast(msg){if(typeof MENU_ON!=='undefined'&&MENU_ON)return;hoverDirtyTag=true;el.toast.textContent=msg;el.toast.classList.add('on');toastT=2.8;}

/* =====================================================================
   20. Rail graph and itinerary search
   ===================================================================== */
renderer.localClippingEnabled=true;
/* CLIP: board-edge clipping planes (defined with the board) */
const OFF=2400, V_DIV=30/3.6;
const SW_BY={};SWITCHES.forEach(s=>{SW_BY[s.id]=s;});
function pieceRange(t){if(t==='v1'||t==='v2')return[-OFF,OFF];const p=TRACKS[t].pts;return[p[0][0],p[p.length-1][0]];}
function zOn(t,x){if(t==='v1')return TZ[1];if(t==='v2')return TZ[2];const z=zAt(TRACKS[t].pts,x);return z===null?0:z;}
function ptsRange(t,xa,xb){
  const out=[{x:xa,z:zOn(t,xa),t:t}],dir=xb>=xa?1:-1;
  if(t!=='v1'&&t!=='v2'){const inner=TRACKS[t].pts.filter(q=>(q[0]-xa)*dir>0.01&&(xb-q[0])*dir>0.01);if(dir<0)inner.reverse();inner.forEach(q=>out.push({x:q[0],z:q[1],t:t}));}
  out.push({x:xb,z:zOn(t,xb),t:t});return out;
}
function mkSec(t,a,b){return{t:t,a:Math.min(a,b),b:Math.max(a,b)};}
function salidaOf(n,dir){return SIGNALS.find(s=>s.kind==='salida'&&s.t===n&&s.face===-dir);}
function goalX(goal,t,dir){
  if(goal.kind==='at'){const r=pieceRange(t);return(goal.x-r[0])*(goal.x-r[1])<=0?goal.x:null;}
  if(goal.kind==='sig')return t===goal.t?goal.x:null;   // up to a given signal of that track (an intermediate one)
  if(t!==goal.t)return null;if(goal.kind==='stop'){const s=salidaOf(+t[1],dir);if(s)return s.x;const T=TOPE[t];return T&&T.dir===dir?T.x-dir*2:null;}
  if(goal.kind==='exit')return dir>0?X1-4:X0+4;return null;}
/* where a train received on a track stops: 10 m short of the exit signal, or 8 m short of the buffer stop */
function stopOf(t,dir){const s=salidaOf(+t[1],dir);if(s)return s.x-dir*10;const T=TOPE[t];return T?T.x-dir*8:null;}
/* depth-first search over facing switches; collects required positions and track sections */
function search(t,x,dir,goal,req,depth){
  depth=depth||0;if(depth>12)return null;req=Object.assign({},req);
  let secs=[],pts=[],ct=t,cx=x;
  for(let g=0;g<30;g++){
    const rg=pieceRange(ct),endX=dir>0?rg[1]:rg[0];
    let ev=null,evd=1e9;
    FACING[ct].forEach(f=>{const d=(f.x-cx)*dir;if(d>0.01&&d<evd){evd=d;ev=f;}});
    const gx=goalX(goal,ct,dir);
    if(gx!==null){const gd=(gx-cx)*dir;if(gd>=-0.01&&gd<=evd){secs.push(mkSec(ct,cx,gx));pts=pts.concat(ptsRange(ct,cx,gx));return{req:req,secs:secs,pts:pts};}}
    if(!ev){secs.push(mkSec(ct,cx,endX));pts=pts.concat(ptsRange(ct,cx,endX));
      const e=ENDS[ct]&&ENDS[ct][dir>0?'e':'w'];if(!e)return null;
      if(req[e[1]]==='N')return null;req[e[1]]='R';ct=e[0];cx=endX;continue;}
    secs.push(mkSec(ct,cx,ev.x));pts=pts.concat(ptsRange(ct,cx,ev.x));cx=ev.x;
    if(ev.dir!==dir){if(req[ev.u]==='R')return null;req[ev.u]='N';continue;}
    const opts=req[ev.u]?[req[ev.u]]:['N','R'];
    for(const o of opts){const r2=Object.assign({},req);r2[ev.u]=o;
      const sub=search(o==='N'?ct:ev.br,ev.x,dir,goal,r2,depth+1);
      if(sub)return{req:sub.req,secs:secs.concat(sub.secs),pts:pts.concat(sub.pts)};}
    return null;
  }
  return null;
}
/* follow the switches as they are now */
function walkCurrent(t,x,dir){
  let pts=[],ct=t,cx=x;
  for(let g=0;g<30;g++){
    const rg=pieceRange(ct),endX=dir>0?rg[1]:rg[0];
    let ev=null,evd=1e9;
    FACING[ct].forEach(f=>{if(f.dir!==dir)return;const d=(f.x-cx)*dir;if(d>0.01&&d<evd){evd=d;ev=f;}});
    if(ev){pts=pts.concat(ptsRange(ct,cx,ev.x));cx=ev.x;if(SW_BY[ev.u].reverse)ct=ev.br;continue;}
    pts=pts.concat(ptsRange(ct,cx,endX));
    const e=ENDS[ct]&&ENDS[ct][dir>0?'e':'w'];if(!e)break;ct=e[0];cx=endX;
  }
  return pts;
}
function mkPath(pts){
  const p=[];pts.forEach(q=>{const l=p[p.length-1];if(l&&Math.abs(l.x-q.x)<1e-4&&Math.abs(l.z-q.z)<1e-4)return;p.push({x:q.x,z:q.z,t:q.t});});
  if(p.length===1)p.push({x:p[0].x+0.01,z:p[0].z,t:p[0].t});
  const cum=[0];for(let i=1;i<p.length;i++)cum.push(cum[i-1]+Math.hypot(p[i].x-p[i-1].x,p[i].z-p[i-1].z));
  return{p:p,cum:cum,len:cum[cum.length-1]};
}
function pathAt(P,s){
  s=clamp(s,0,P.len);let lo=0,hi=P.cum.length-1;
  while(hi-lo>1){const m=(lo+hi)>>1;if(P.cum[m]<=s)lo=m;else hi=m;}
  const a=P.p[lo],b=P.p[hi],L=(P.cum[hi]-P.cum[lo])||1,k=(s-P.cum[lo])/L;
  return{x:a.x+(b.x-a.x)*k,z:a.z+(b.z-a.z)*k,tx:(b.x-a.x)/L,tz:(b.z-a.z)/L,t:b.t};
}
function sOfX(P,x,t){
  for(let i=1;i<P.p.length;i++){const a=P.p[i-1],b=P.p[i];if(b.t!==t||a.x===b.x)continue;
    if((x-a.x)*(x-b.x)<=0){const k=(x-a.x)/(b.x-a.x);return P.cum[i-1]+(P.cum[i]-P.cum[i-1])*k;}}
  return null;
}
function subPts(P,s0,s1){
  const out=[],A=pathAt(P,s0);out.push({x:A.x,z:A.z,t:A.t});
  for(let i=0;i<P.p.length;i++){if(P.cum[i]>s0+1e-3&&P.cum[i]<s1-1e-3)out.push(P.p[i]);}
  const B=pathAt(P,s1);out.push({x:B.x,z:B.z,t:B.t});return out;
}

/* =====================================================================
   21. Simulation state, trains
   ===================================================================== */
const sim={t:0,speed:2,paused:false,auto:false};   // la jornada empieza a las 00:00
const stats={trains:0,onTime:0,paxIn:0,paxOut:0,lost:0,caused:0,ordOk:0,ordFail:0,incOk:0,incFail:0,telOk:0,telErr:0};
const ROUTES=[];
const TRAINS=[];
const ROUTE_MAT=new THREE.MeshBasicMaterial({color:0x56DB8A,transparent:true,opacity:0.62,depthWrite:false});
const fmtHM=t=>{t=Math.floor(t);return pad2(Math.floor(t/3600)%24)+':'+pad2(Math.floor(t/60)%60);};
const fmtHMS=t=>{t=Math.floor(t);return pad2(Math.floor(t/3600)%24)+':'+pad2(Math.floor(t/60)%60)+':'+pad2(t%60);};
function pad2(n){return(n<10?'0':'')+n;}
const T=(h,m,s)=>h*3600+m*60+(s||0);
const R470={LM:26.747,LR:26.670,W:2.90,HALF:1.45};
const R269={L:17.27,ZF:8.0,W:3.126,HALF:1.563,BOG:4.5,WB:2.8,RW:0.625,TOP:3.68,BOT:0.98}; /* 269: pivotes a 9,0 m (±4,5), caja ±8,0 */
const R252={L:20.48,ZF:9.86,ZE:10.0,W:3.00,HALF:1.50,BOG:5.25,WB:3.0,RW:0.625,TOP:4.04,BOT:0.70}; /* 252: pivotes a 10,5 m, testero en ±9,86, topes en ±10,24 */
/* Renfe 10000 coaches: per-car data (livery, class, door type, side-strip mapping, doors) — the module itself is further down */
const R10K={
  'A10x-10003':{l:'Estrella',c:'A',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.157],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'A10x-10029':{l:'Estrella',c:'A',k:'mi',P:[0.03865, 0.50003, 0.62, 3.158],N:[-0.03865, 0.49947, 0.621, 3.159],d:[[11.48, 12.39], [-12.41, -11.5]]},
  'AA-10016':{l:'Estrella',c:'A',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.157],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'AA-10027':{l:'Estrella',c:'A',k:'mi',P:[0.03865, 0.50003, 0.62, 3.158],N:[-0.03865, 0.49947, 0.621, 3.159],d:[[11.48, 12.39], [-12.41, -11.5]]},
  'B11x-10262':{l:'Estrella',c:'B',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'BB-10212':{l:'Estrella',c:'B',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'BB-10283':{l:'Estrella',c:'B',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'BBL-10615':{l:'Estrella',c:'Bc',k:'mi',P:[0.03766, 0.50019, 0.622, 3.157],N:[-0.03766, 0.50044, 0.623, 3.158],d:[[11.79, 12.7], [-12.7, -11.79]]},
  'BBR-10815':{l:'Estrella',c:'BR',k:'mi',P:[0.03764, 0.49982, 0.622, 3.163],N:[-0.03764, 0.50025, 0.623, 3.159],d:[[11.79, 12.7]]},
  'BR4x-10816':{l:'Estrella',c:'BR',k:'mi',P:[0.03764, 0.49982, 0.622, 3.163],N:[-0.03764, 0.50025, 0.623, 3.159],d:[[11.79, 12.7]]},
  'Bc10x-10602':{l:'Estrella',c:'Bc',k:'mi',P:[0.03766, 0.50019, 0.622, 3.157],N:[-0.03766, 0.50044, 0.623, 3.158],d:[[11.79, 12.7], [-12.7, -11.79]]},
  'Bz5x-10502':{l:'Estrella',c:'Bz',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'DDE-10409':{l:'Estrella',c:'D',k:'big',P:[0.03766, 0.50048, 0.623, 3.158],N:[-0.03766, 0.50015, 0.622, 3.157],d:[[-1.18, 1.56]]},
  'A10x-10019':{l:'GL',c:'A',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.157],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'A10x-10031':{l:'GL',c:'A',k:'mi',P:[0.03865, 0.50003, 0.62, 3.158],N:[-0.03865, 0.49947, 0.621, 3.159],d:[[11.48, 12.39], [-12.41, -11.5]]},
  'A8lv-10504':{l:'GL',c:'A8',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'B11x-10278':{l:'GL',c:'B',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'BR4x-10803':{l:'GL',c:'BR',k:'mi',P:[0.03764, 0.49982, 0.622, 3.163],N:[-0.03764, 0.50025, 0.623, 3.159],d:[[11.79, 12.7]]},
  'Bc10x-10612':{l:'GL',c:'Bc',k:'mi',P:[0.03766, 0.50019, 0.622, 3.157],N:[-0.03766, 0.50044, 0.623, 3.158],d:[[11.79, 12.7], [-12.7, -11.79]]},
  'A10x-10017':{l:'LR',c:'A',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.157],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'A10x-10032':{l:'LR',c:'A',k:'mi',P:[0.03865, 0.50003, 0.62, 3.158],N:[-0.03865, 0.49947, 0.621, 3.159],d:[[11.48, 12.39], [-12.41, -11.5]]},
  'A8lv-10505':{l:'LR',c:'A8',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'B11x-10261':{l:'LR',c:'B',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'BR4x-10809':{l:'LR',c:'BR',k:'mi',P:[0.03764, 0.49982, 0.622, 3.163],N:[-0.03764, 0.50025, 0.623, 3.159],d:[[11.79, 12.7]]},
  'Bc10x-10612LR':{l:'LR',c:'Bc',k:'mi',P:[0.03766, 0.50019, 0.622, 3.157],N:[-0.03766, 0.50044, 0.623, 3.158],d:[[11.79, 12.7], [-12.7, -11.79]]},
  'D10-10405':{l:'Paquexpres',c:'D',k:'big',P:[0.03766, 0.50048, 0.623, 3.158],N:[-0.03766, 0.50015, 0.622, 3.157],d:[[-1.18, 1.56]]},
  'D10-10412':{l:'Paquexpres',c:'D',k:'big',P:[0.03766, 0.50048, 0.623, 3.158],N:[-0.03766, 0.50015, 0.622, 3.157],d:[[-1.18, 1.56]]},
  'B11x-10217':{l:'PruebaPintura',c:'B',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]],d2:1},
  'B11x-10257':{l:'PruebaPintura',c:'B',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]],d2:1},
  'Bc10x-10609':{l:'PruebaPintura',c:'Bc',k:'mi',P:[0.03766, 0.50019, 0.622, 3.157],N:[-0.03766, 0.50044, 0.623, 3.158],d:[[11.79, 12.7], [-12.7, -11.79]]},
  'A10x-10020':{l:'RO',c:'A',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.157],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'A10x-10022':{l:'RO',c:'A',k:'mi',P:[0.03865, 0.50003, 0.62, 3.158],N:[-0.03865, 0.49947, 0.621, 3.159],d:[[11.48, 12.39], [-12.41, -11.5]]},
  'A8lv-10501':{l:'RO',c:'A8',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'BR4x-10807':{l:'RO',c:'BR',k:'mi',P:[0.03764, 0.49982, 0.622, 3.163],N:[-0.03764, 0.50025, 0.623, 3.159],d:[[11.79, 12.7]]},
  'B11x-10216':{l:'Transicion',c:'B',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]},
  'BR4x-10818':{l:'Transicion',c:'BR',k:'mi',P:[0.03764, 0.49982, 0.622, 3.163],N:[-0.03764, 0.50025, 0.623, 3.159],d:[[11.79, 12.7]]},
  'Bc10x-10607':{l:'Transicion',c:'Bc',k:'mi',P:[0.03766, 0.50019, 0.622, 3.157],N:[-0.03766, 0.50044, 0.623, 3.158],d:[[11.79, 12.7], [-12.7, -11.79]]},
  'Bz5x-10503':{l:'Transicion',c:'Bz',k:'fa',P:[0.03865, 0.50003, 0.618, 3.15],N:[-0.03865, 0.49947, 0.619, 3.158],d:[[11.44, 12.47], [-12.47, -11.44]]}};
const R10={L:26.4,ZE:13.05,SX:1.411,YS:0.948,YT:3.149,AW:2048,AH:1024,SH:392,
  SEC:[[1.411,3.149],[1.40,3.173],[1.35,3.277],[1.30,3.373],[1.25,3.432],[1.20,3.491],[1.10,3.594],[1.0,3.681],[0.9,3.748],[0.8,3.808],[0.7,3.858],[0.6,3.901],[0.5,3.936],[0.4,3.961],[0.3,3.982],[0.15,3.992],[0,4.001]],
  LIV:{Estrella:'Estrella',Transicion:'Transición',LR:'Largo Recorrido',GL:'Grandes Líneas',RO:'Renfe Operadora',PruebaPintura:'Prueba de pintura',Paquexpres:'Paquexpres'},
  CLS:{A:'1ª',A8:'1ª reclinable',B:'2ª',Bz:'2ª con guardería',Bc:'literas',BR:'cafetería',D:'furgón'}};
/* a night Estrella of the late 1990s: 252 or 269, literas, 2ª, cafetería and 1ª in the paint of the moment
   (mostly Largo Recorrido and Grandes Líneas, some still in Transición or Estrella), sometimes a van at the head;
   the cars of each class are drawn from the pack, so a train mixes liveries as the real ones did */
const R10K_BY=(()=>{const o={};Object.keys(R10K).forEach(k=>{const c=R10K[k];if(c.l==='RO'||c.l==='PruebaPintura')return;(o[c.c]=o[c.c]||[]).push(k);});return o;})();
function estrellaSpecs(num){
  let s=(num|0)+7919;s=Math.imul(s^(s>>>16),0x45d9f3b);s=Math.imul(s^(s>>>16),0x45d9f3b);s=(s^(s>>>16)^0x5EED)|0;
  const R=()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
  const W={GL:4,LR:4,Transicion:1.2,Estrella:1,Paquexpres:0.6};
  const pick=cls=>{const pool=R10K_BY[cls]||[];let tot=0;pool.forEach(k=>tot+=W[R10K[k].l]||0);let r=R()*tot;for(const k of pool){r-=W[R10K[k].l]||0;if(r<=0)return k;}return pool[0];};
  const L269=2*(R269.ZF+0.49),a=[R()<0.65?{k:'loco252',L:R252.L,cab:1,panto:1}:{k:'loco269',L:L269,cab:2,panto:1}];
  /* six coaches at most (179 m with the 252), so it still fits the 184 m of a main track if it has to wait */
  const x=R(),seq=x<0.35?['D','Bc','Bc','B','BR','A']:(x<0.7?['Bc','Bc','B','B','BR','A']:['Bc','Bc','Bc','B','BR','A']);
  seq.forEach(c=>a.push({k:'r10k',car:pick(c),L:R10.L,flip:R()<0.5?1:0}));
  return a;
}
/* a day train of Grandes Líneas: 252 and five or six 10000 coaches in GL paint: 1ª, cafetería and 2ª */
function diurnoSpecs(num){
  let s=(num|0)+4241;s=Math.imul(s^(s>>>16),0x45d9f3b);s=Math.imul(s^(s>>>16),0x45d9f3b);s=(s^(s>>>16)^0x5EED)|0;
  const R=()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
  const gl=cls=>{const pool=Object.keys(R10K).filter(k=>R10K[k].l==='GL'&&R10K[k].c===cls);return pool[Math.floor(R()*pool.length)];};
  const seq=R()<0.5?['A','BR','B','B','B']:['A','A8','BR','B','B','B'];
  return[{k:'loco252',L:R252.L,cab:1,panto:1}].concat(seq.map(c=>({k:'r10k',car:gl(c),L:R10.L,flip:R()<0.5?1:0})));
}
function comp10k(specs){
  const cars=specs.filter(x=>x.k==='r10k'),n={};cars.forEach(x=>{const c=R10.CLS[R10K[x.car].c];n[c]=(n[c]||0)+1;});
  const lv=[...new Set(cars.map(x=>R10.LIV[R10K[x.car].l]))];
  return 'Locomotora '+(specs[0].k==='loco252'?'252':'269')+' + '+cars.length+' coches serie 10000 ('+Object.keys(n).map(k=>n[k]+' '+k).join(', ')+') · librea '+lv.join(', ');
}

const TYPE={
  md:{label:'Regional',name:'Regional',vmax:140/3.6,a:0.6,b:0.65,seats:220,comp:'Unidad serie 470 (M+R+Rc) · librea Media Distancia'},
  alvia:{label:'Talgo',name:'Talgo III',vmax:160/3.6,a:0.45,b:0.55,seats:265,comp:'Locomotora 252 + rama Talgo III (manso, furgón, 9 coches y cola)'},
  estrella:{label:'Estrella',name:'Estrella (nocturno)',vmax:160/3.6,a:0.4,b:0.5,seats:400,comp:'Locomotora 252 o 269 + coches serie 10000'},
  merc:{label:'Merc.',name:'Mercancías',vmax:80/3.6,a:0.22,b:0.35,seats:0,comp:'Locomotora 269 o 319 + tolvas TT6, portacoches SEMAT y/o vagones cerrados JPD (80 km/h)'},
  diurno:{label:'Diurno',name:'Diurno (Grandes Líneas)',vmax:160/3.6,a:0.42,b:0.5,seats:380,comp:'Locomotora 252 + coches serie 10000 · librea Grandes Líneas'},
  ic:{label:'Intercity',name:'Intercity',vmax:160/3.6,a:0.55,b:0.6,seats:240,comp:'Unidad serie 448 (M+Ri+Rc) · librea Intercity'},
  socorro:{label:'Socorro',name:'Locomotora de socorro',vmax:100/3.6,a:0.5,b:0.6,seats:0,comp:'Locomotora 269 o 319 aislada'},
  trabajos:{label:'Trabajos',name:'Tren de trabajos',vmax:80/3.6,a:0.3,b:0.5,seats:0,comp:'Locomotora diésel, coche taller, plataforma con material y vagoneta de catenaria'}
};
let _ts=91;const trnd=()=>{_ts=(_ts*1664525+1013904223)>>>0;return _ts/4294967296;};
const rr2=(a,b)=>a+(b-a)*Math.random();
/* Day timetable at Santa Olalla, reconstructed for the late 1990s on the Burgos – Miranda section of Madrid – Hendaya
   (double track, 3 kV, automatic block): Talgos Madrid – Irún/Hendaya/Bilbao (252 + Talgo III), regionales
   Valladolid – Vitoria (470, they stop here), night Estrellas Madrid – Irún/Bilbao (252 or 269 + 10000 coaches)
   and freight round the clock, heaviest at night.
   dir +1 = towards Burgos (even numbers), -1 = towards Miranda (odd numbers).
   [type, number, dir, time at Santa Olalla, departure if it waits here]: a regional stops one minute; a freight
   with a departure time is booked to wait in a siding while a Talgo overtakes it. */
/* horario: horario de un día (en el archivo del nivel) */
const {TT_DAY,TT_TALGO,TT_ESTRELLA,TT_MERC,MD432}=NIVEL.horario();
function carSpecs(type,num){
  if(type==='trabajos')return TT_SPECS.map(o=>Object.assign({},o));
  if(type==='socorro')return(SOC[num]||[{k:'loco269',L:2*(R269.ZF+0.49),cab:2,panto:1}]).map(o=>Object.assign({},o));
  if(type==='md'&&MD432[num])return[{k:'r432',car:'M',lv:'reg',L:26.41,cab:1},{k:'r432',car:'Ri',lv:'reg',L:26.363,cab:0},{k:'r432',car:'Rc',lv:'reg',L:26.41,cab:-1}];
  if(type==='md')return[{k:'md',L:R470.LM,kind:'M',cab:1},{k:'md',L:R470.LR,kind:'R',cab:0},{k:'md',L:R470.LM,kind:'Rc',cab:-1}];
  if(type==='alvia'){/* 252 + Talgo III: manso, furgón, two 1st, cafetería, six 2nd and the tail car turned round */
    const LT={TG:13.528,TD:12.113,TBz:12.113,TA:11.0,TB:11.0,TC:11.0};/* pitches of the Talgo III cars (KIND3) */
    const t=(kind,flip)=>({k:'t3',kind:kind,L:LT[kind],flip:flip?1:0});
    return[{k:'loco252',L:R252.L,cab:1,panto:1},t('TG'),t('TD'),t('TA'),t('TA'),t('TC'),t('TB'),t('TB'),t('TB'),t('TB'),t('TB'),t('TB'),t('TBz',1)];}
  if(type==='estrella')return estrellaSpecs(num||0);
  if(type==='diurno')return diurnoSpecs(num||0);
  if(type==='ic')return[{k:'r448',car:'M',lv:'GL',L:26.14,cab:1},{k:'r448',car:'Ri',lv:'GL',L:26.71,cab:0},{k:'r448',car:'Rc',lv:'GL',L:26.67,cab:-1}];
  return mercSpecs(num||0);
}
/* freight consists, seeded by the train number (the same service always runs the same consist):
   block trains of cereal hoppers, SEMAT car carriers or JPD vans, or a mix in blocks; car carriers loaded,
   partly loaded or empty. Never longer than 152 m, so they fit in the sidings (vía 3, and vía 5 up to its buffer stop). */
const MERC_MAX=152.1,SEMAT_L=17.284,HOP_L=12.54,JPD_L=14.04,L319=19.50;
/* 319 units in the VAT package (taxi livery) */
const UNITS319=['319.224.2','319.225.9','319.228.3','319.239.0','319.247.3','319.331.5','319.335.9','319.403.2','319.406.5','319.407.3'];
/* what a car-carrier brings: new Peugeot 205s (built at Villaverde, Madrid) or Fiat Puntos, a batch of one model in one to three colours */
function semLoad(seed){const R=mulberry(seed|0),k=R()<0.6?'p205':'punto',n=1+Math.floor(R()*3),cs=[],
    C=k==='p205'?[0xEDEDEA,0xC21F1A,0x1E2F5A,0x1E2022,0xA9ADB0,0x2D5A3C,0x6E7F8F,0x8C1C2A]:[0xB3261E,0xEDEDEA,0x22355E,0x2F7A7E,0x3F6B4A,0xA9ADB0,0x1E2022,0xE0B21E];
  for(let i=0;i<n;i++)cs.push(C[Math.floor(R()*C.length)]);return{k:k,c:[0,1,2,3,4,5,6,7].map(()=>cs[Math.floor(R()*cs.length)])};}
function mercSpecs(num,force,loco){
  let s=num|0;s=Math.imul(s^(s>>>16),0x45d9f3b);s=Math.imul(s^(s>>>16),0x45d9f3b);s=(s^(s>>>16)^0x5EED)|0;/* mulberry32 */const R=()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};
  const L269=2*(R269.ZF+0.49);/* 269 model over its buffer heads (±8.49) */
  /* the train engine: a 269 or a 319, half and half */
  const lk=loco||(R()<0.5?'319':'269');
  const a=[lk==='319'?{k:'loco319',L:L319,cab:2,num:UNITS319[Math.floor(R()*UNITS319.length)]}:{k:'loco269',L:L269,cab:2,panto:1}];let len=a[0].L;const room=L=>len+L<=MERC_MAX;
  const livs=['gr','gr','ma','ma','am'],ld=R(),mode=(force&&force.load)||(ld<0.45?'full':(ld<0.7?'empty':'mixed'));
  const semat=()=>{let n=8;if(mode==='empty')n=0;else if(mode==='mixed'){const q=R();n=q<0.45?8:(q<0.7?0:2+Math.floor(R()*6));}
    const sl=[0,1,2,3,4,5,6,7];for(let i=7;i>0;i--){const j=Math.floor(R()*(i+1));const t=sl[i];sl[i]=sl[j];sl[j]=t;}
    const sp={k:'semat',L:SEMAT_L,liv:livs[Math.floor(R()*livs.length)],slots:sl.slice(0,n).sort((x,y)=>x-y),flip:R()<0.5?1:0};sp.ld=semLoad(num*13+a.length);return sp;};
  const push=sp=>{a.push(sp);len+=sp.L;};
  const jliv=()=>{const q=R();return q<0.45?'marron':(q<0.85?'verde':'rojo');};
  const jpd=()=>({k:'jpd',L:JPD_L,liv:jliv(),flip:R()<0.5?1:0});
  /* hoppers: a block runs loaded with coal or empty (in mixed trains each block decides) */
  const hopBlock=()=>{const ld=mode==='empty'?0:(mode==='full'?1:(R()<0.6?1:0));return()=>({k:'hopper',L:HOP_L,liv:R()<0.6?'rojo':'verde',load:ld,flip:R()<0.5?1:0});};
  const r=R(),kind=(force&&force.kind)||(r<0.28?'tolvas':(r<0.52?'semat':(r<0.74?'jpd':'mixto')));
  if(kind==='tolvas'){const n0=7+Math.floor(R()*4),n=force?99:n0,hb=hopBlock();for(let i=0;i<n&&room(HOP_L);i++)push(hb());}
  else if(kind==='semat'){const n0=5+Math.floor(R()*3),n=force?99:n0;for(let i=0;i<n&&room(SEMAT_L);i++)push(semat());}
  else if(kind==='jpd'){const n0=6+Math.floor(R()*4),n=force?99:n0;for(let i=0;i<n&&room(JPD_L);i++)push(jpd());}
  else{/* blocks of different kinds one after another */
    const KL=[HOP_L,SEMAT_L,JPD_L];let hb=null;const mk=t=>t===0?hb():(t===1?semat():jpd());
    let t=Math.floor(R()*3),prev=-1;const target=115+R()*37;
    for(let b=0;b<6&&len<target;b++){if(t===prev)t=(t+1)%3;
      if(!room(KL[t])){const alt=[0,1,2].filter(x=>x!==prev&&room(KL[x]));if(!alt.length)break;t=alt[0];}
      const n=1+Math.floor(R()*(t===1?3:4));if(t===0)hb=hopBlock();for(let i=0;i<n&&room(KL[t]);i++)push(mk(t));prev=t;t=Math.floor(R()*3);}}
  return a;
}
function compText(type,specs){
  if(type==='socorro')return specs[0].k==='loco319'?'Locomotora '+specs[0].num+' aislada':'Locomotora 269 aislada';
  if(type==='estrella'||type==='diurno')return comp10k(specs);
  if(type==='md'&&specs[0].k==='r432')return'Unidad serie 432 reformada (M+Ri+Rc) · librea Regionales';
  if(type!=='merc')return TYPE[type].comp;
  const hp=specs.filter(x=>x.k==='hopper'),h=hp.length,sm=specs.filter(x=>x.k==='semat'),parts=[];
  if(h){const hl=hp.filter(x=>x.load).length,he=h-hl;
    parts.push(h+(h>1?' tolvas TT6':' tolva TT6')+' ('+(he===0?(h>1?'cargadas':'cargada')+' de carbón':(hl===0?(h>1?'vacías':'vacía'):hl+' cargadas, '+he+' vacías'))+')');}
  const jp=specs.filter(x=>x.k==='jpd').length;if(jp)parts.push(jp+(jp>1?' vagones cerrados JPD':' vagón cerrado JPD'));
  if(sm.length){const f=sm.filter(x=>x.slots.length===8).length,e=sm.filter(x=>!x.slots.length).length,p=sm.length-f-e,cars=sm.reduce((n,x)=>n+x.slots.length,0);
    let st;if(f===sm.length)st='cargados';else if(e===sm.length)st='vacíos';
    else{const q=[];if(f)q.push(f+(f>1?' cargados':' cargado'));if(p)q.push(p+' a media carga');if(e)q.push(e+(e>1?' vacíos':' vacío'));st=q.join(', ');}
    const n205=sm.reduce((n,x)=>n+(x.ld&&x.ld.k==='p205'?x.slots.length:0),0),npt=cars-n205,q2=[];if(n205)q2.push(n205+' Peugeot 205');if(npt)q2.push(npt+' Fiat Punto');
    parts.push(sm.length+' portacoches SEMAT ('+st+(cars?' · '+q2.join(' y ')+' nuevos':'')+')');}
  const lo=specs[0]&&specs[0].k==='loco319'?specs[0].num.slice(0,7):'269';
  return 'Locomotora '+lo+' + '+parts.join(' + ');
}
function gapOf(type){return 0;}/* buffers touching: every vehicle length is measured over its buffer heads */
function lenOf(type,num){const s=carSpecs(type,num);return s.reduce((a,c)=>a+c.L,0)+(s.length-1)*gapOf(type);}
/* ---------------------------------------------------------------------
   The line beyond the board. Santa Olalla sits between Briviesca (Miranda side, ~10.8 km) and Quintanapalla
   (Burgos side, ~11.2 km); both run by the CTC, which sends trains first come first served but holds a freight
   back when a faster train would catch it before Santa Olalla. Automatic block (BAB): 2 km block sections, one
   train per section; a train stops at the signal of an occupied section. The last inbound section is the 2.4 km
   approach drawn on the board; the first outbound one starts at the exit signal (it shows stop while occupied).
   Punctuality is judged on arrival at the next station: delay there minus delay on leaving the previous one.
   --------------------------------------------------------------------- */
/* linea: estaciones colindantes y bloqueo (en el archivo del nivel) */
const {LINE}=NIVEL.linea();
const vEff=tr=>{let v=tr.ty.vmax;if(WX.fog>0.5)v=Math.min(v,(tr.svc.type==='merc'?60:100)/3.6);if(tr.vcap)v=Math.min(v,tr.vcap);return v;};   /* fog: drivers keep to what they can see */
const accEff=tr=>((tr.stall||(!tr.work&&!tr.diesel&&(sim.t<LINE.powerUntil||incNoPow(tr))))?0:tr.ty.a*(1-0.15*WX.wet));   /* (the work train is diesel) */   /* no traction without catenary voltage; wet rail costs adhesion */
function runT(ty,L,s0,s1){const v=ty.vmax;return(L/v+(s0?v/(2*ty.a):0)+(s1?v/(2*ty.b):0))*1.04;}
const hm=s=>{const p=s.split(':');return T(+p[0],+p[1]);};
/* the delay a train brings from the previous station. Renfe's own figures for 1999 (Informe Anual 2001, punctuality
   = arriving less than 10 minutes late): Regionales 96,6 %, Grandes Líneas 95,0 %; how the delays spread under those
   10 minutes is not published and is spread here by hand, as is the tail above them (10 to 30-40 minutes).
   Freight has no published figure: an estimate, much looser, as freight paths were in those years. */
function extDelay(type){const r=trnd(),u=trnd();
  if(type==='md')return r<0.60?u*60:r<0.85?60+u*180:r<0.966?240+u*360:600+Math.pow(u,1.6)*1200;
  if(type==='merc')return r<0.45?u*300:r<0.80?300+u*900:r<0.95?1200+u*1500:2700+u*2700;
  return r<0.50?u*60:r<0.78?60+u*240:r<0.95?300+u*300:600+Math.pow(u,1.6)*1800;}
function makeService(o){
  const ty=TYPE[o.type],stops=o.arr!==undefined,md=o.type==='md',S=LINE.side[o.dir];
  const tr={id:o.type+o.num+'_'+o.day,svc:o,ty:ty,dir:o.dir,stops:stops,md:md,label:(o.type==='merc'?'Mercancías':o.lab||ty.label)+' '+o.num,
    schedT:stops?o.dep:o.pass,ext:0,spawned:false,done:false,phase:'previsto',s:0,v:0,P:null,cars:[],len:lenOf(o.type,o.num),comp:compText(o.type,carSpecs(o.type,o.num)),gap:gapOf(o.type),
    routeIn:null,routeOut:null,stopTrack:null,stopX:null,stopS:null,served:false,boarded:0,alighted:0,alightN:0,alightLeft:0,paxPlan:[],
    doors:'closed',t0:0,sigs:[],div:[],blockedBy:null,hold:false,zone:'pre',p:0,lv:0};
  tr.ext=Math.round(extDelay(o.type));
  tr.entryTrack=o.dir>0?'v1':'v2';
  tr.entrySig=SIGNALS.find(s=>s.kind==='entrada'&&s.t===(o.dir>0?1:2)&&s.face===-o.dir);
  if(md){tr.alightN=3+Math.floor(trnd()*9);const n=5+Math.floor(trnd()*8);
    for(let i=0;i<n;i++){const late=trnd()<0.14;tr.paxPlan.push(o.dep+(late?Math.round(-40+trnd()*80):-Math.round(70+trnd()*640)));}
    tr.paxPlan.sort((a,b)=>a-b);}
  tr.tSOin=stops?o.arr:o.pass;
  tr.tPrev=tr.tSOin-runT(ty,S.Lin,md,stops);tr.tNext=tr.schedT+runT(ty,S.Lout,stops,md);tr.tReady=tr.tPrev+tr.ext;
  tr.ent='tr:'+tr.id;
  ent(tr.ent,{kind:'train',train:tr,name:tr.label,sub:o.from+' → '+o.to});
  ENT[tr.ent].anchor=()=>trainAnchor(tr);ENT[tr.ent].bbFn=()=>trainBB(tr);
  TRAINS.push(tr);return tr;
}
/* services of day d (0 = the first day of the shift); those already past at the start are left out */
function makeDay(d){const base=d*86400;
  TT_DAY.forEach(e=>{const[type,num,dir,t,dep,from,to,nombre,lab]=e,o={num:num,type:type,dir:dir,day:d};
    if(nombre)o.nombre=nombre;if(lab)o.lab=lab;
    if(type==='md'){o.arr=base+hm(t);o.dep=o.arr+60;o.from=from||(dir>0?'Vitoria-Gasteiz':'Valladolid');o.to=to||(dir>0?'Valladolid':'Vitoria-Gasteiz');}
    else if(from){if(dep){o.arr=base+hm(t);o.dep=base+hm(dep);o.apt=true;}else o.pass=base+hm(t);o.from=from;o.to=to;}
    else{if(dep){o.arr=base+hm(t);o.dep=base+hm(dep);o.apt=true;}else o.pass=base+hm(t);
      if(type==='alvia'){o.from=dir>0?TT_TALGO[num]:'Madrid-Chamartín';o.to=dir>0?'Madrid-Chamartín':TT_TALGO[num];}
      else if(type==='estrella'){o.from=dir>0?TT_ESTRELLA[num]:'Madrid-Chamartín';o.to=dir>0?'Madrid-Chamartín':TT_ESTRELLA[num];}
      else{const od=TT_MERC[(num>>1)%TT_MERC.length];o.from=dir>0?od[1]:od[0];o.to=dir>0?od[0]:od[1];}}
    if((o.arr!==undefined?o.arr:o.pass)<sim.t+60)return;
    makeService(o);});
  LINE.day=d;
  if(d===Math.floor(sim.t/86400))try{VEG_SEASON(monthOf(d),dayDate(d).getFullYear());}catch(e){}   // the next jornada's season comes at midnight (estacionCambia)
  if(GENTE_READY)gentePlanDay(d);   // var: still undefined while the first day is being made
}
makeDay(0);

/* train materials (clipped at the board edges so trains appear from the frame) */
function tmat(hex){const m=new THREE.MeshLambertMaterial({color:hex,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,hex);return m;}
const TM={white:tmat(0xF1F1EC),silver:tmat(0xD5D9DB),md:tmat(0x7A2F72),alvia:tmat(0x4A2F6B),dark:tmat(0x22272B),glass:tmat(0x2B3943),
  bogie:tmat(0x2A2A2A),roof:tmat(0xAEB3B6),loco:tmat(0x355A74),locoY:tmat(0xE3B32C),hopper:tmat(0xA38257),hopperD:tmat(0x6E5638),panto:tmat(0x3A3D40),red:tmat(0xB33A2E)};
const LIGHT_W=new THREE.MeshBasicMaterial({color:0xFFF6D8,clippingPlanes:CLIP});
const LIGHT_R=new THREE.MeshBasicMaterial({color:0xFF3020,clippingPlanes:CLIP});
const DOOR_C=0xBCC1C4,DOOR_O=0x1B1E21;
function tbox(g,mat,x,y,z,w,h,d){const m=new THREE.Mesh(GEO.box,mat);m.position.set(x,y+h/2,z);m.scale.set(w,h,d);m.castShadow=true;g.add(m);return m;}
/* ---------------------------------------------------------------------
   Renfe serie 470 · librea Media Distancia (modelo procedural fiel)
   Cotas: Vía Libre (ficha 440/470): M 26.747 m · R 26.670 m · ancho 2.900 ·
   bogies a 18.850 · empate 2.600/2.500 · ruedas 1.000/0.940 · piso 1.028.
   Decoración y testero: referencias Electrotren 470-129/135 y fotos de las
   470-025M / 134C (ventanas con marco naranja, franja morada, frontal naranja
   con máscara negra, faros redondos arriba, cajas grises y Scharfenberg).
   Todo se genera como listas de triángulos por material, y cada coche se
   funde en una malla por material (≈1.200 triángulos por coche).
   --------------------------------------------------------------------- */
/* half profile, bottom → apex: [halfwidth, height over rail] */
const PROF470=(function(){
  const h=[[1.30,0.55],[1.36,0.98],[1.45,1.05],[1.45,1.60],[1.45,2.20],[1.45,2.80],[1.45,3.25],[1.42,3.45],[1.33,3.60],[1.15,3.74],[0.86,3.85],[0.45,3.91],[0,3.93]];
  const n=h.length;
  const pts=[];for(let i=0;i<n;i++)pts.push([-h[i][0],h[i][1]]);for(let i=n-2;i>=0;i--)pts.push([h[i][0],h[i][1]]);
  const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  const tot=cum[cum.length-1];
  return{h:h,n:n,pts:pts,v:cum.map(c=>c/tot),tot:tot,top:3.93,yRoof:3.58};
})();
function v470(y,side){
  const P=PROF470,h=P.h;
  for(let i=1;i<P.n;i++){const a=h[i-1],b=h[i];
    if(y<=b[1]||i===P.n-1){const t=clamp((y-a[1])/((b[1]-a[1])||1),0,1);const v=lerp(P.v[i-1],P.v[i],t);return side<0?v:1-v;}}
  return 0.5;
}
/* ---- triangle-array helpers (pure JS, shared by game, preview and export) ---- */
function arrNew(){return{pos:[],uv:[],idx:[]};}
function arrPush(A,B){const o=A.pos.length/3;for(let i=0;i<B.pos.length;i++)A.pos.push(B.pos[i]);for(let i=0;i<B.uv.length;i++)A.uv.push(B.uv[i]);for(let i=0;i<B.idx.length;i++)A.idx.push(B.idx[i]+o);}
function loft(rings,prof){
  const A=arrNew(),n=rings[0].pts.length,P=prof||PROF470;
  rings.forEach(r=>{r.pts.forEach((p,j)=>{A.pos.push(p[0],p[1],p[2]);A.uv.push(r.u,P.v[j]);});});
  for(let i=0;i<rings.length-1;i++)for(let j=0;j<n-1;j++){const a=i*n+j,b=i*n+j+1,c=(i+1)*n+j+1,d=(i+1)*n+j;A.idx.push(a,c,b,a,d,c);}
  return A;
}
/* cap over a ring, in horizontal bands (left j ↔ right n-1-j). e=+1 faces +z */
function capBands(ring,e,uvFn){
  const A=arrNew(),n=ring.length,m=(n+1)/2;
  ring.forEach(p=>{A.pos.push(p[0],p[1],p[2]);const t=uvFn?uvFn(p):[0,0];A.uv.push(t[0],t[1]);});
  for(let j=0;j<m-1;j++){const L0=j,L1=j+1,R1=n-2-j,R0=n-1-j;
    if(L1===R1){if(e>0)A.idx.push(L0,R0,L1);else A.idx.push(L0,L1,R0);}
    else{if(e>0){A.idx.push(L0,R0,R1,L0,R1,L1);}else{A.idx.push(L0,R1,R0,L0,L1,R1);}}}
  return A;
}
function rot3(p,rx,ry,rz){let x=p[0],y=p[1],z=p[2];
  if(rz){const c=Math.cos(rz),s=Math.sin(rz);[x,y]=[x*c-y*s,x*s+y*c];}
  if(rx){const c=Math.cos(rx),s=Math.sin(rx);[y,z]=[y*c-z*s,y*s+z*c];}
  if(ry){const c=Math.cos(ry),s=Math.sin(ry);[x,z]=[x*c+z*s,-x*s+z*c];}
  return[x,y,z];}
function boxA(cx,y0,cz,w,h,d,rx,ry,rz){
  const A=arrNew();const hw=w/2,hd=d/2,cy=y0+h/2,hh=h/2;
  const V=[[-hw,-hh,-hd],[hw,-hh,-hd],[hw,hh,-hd],[-hw,hh,-hd],[-hw,-hh,hd],[hw,-hh,hd],[hw,hh,hd],[-hw,hh,hd]];
  const F=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]];
  V.forEach(v=>{const p=rot3(v,rx,ry,rz);A.pos.push(p[0]+cx,p[1]+cy,p[2]+cz);A.uv.push(0,0);});
  F.forEach(f=>{A.idx.push(f[0],f[1],f[2],f[0],f[2],f[3]);});
  return A;
}
function cylA(cx,cy,cz,r,h,n,rx,ry,rz){
  const A=arrNew(),seg=n||12;
  for(let i=0;i<seg;i++){const a=i/seg*TAU;const b=rot3([Math.cos(a)*r,-h/2,Math.sin(a)*r],rx,ry,rz),t=rot3([Math.cos(a)*r,h/2,Math.sin(a)*r],rx,ry,rz);
    A.pos.push(b[0]+cx,b[1]+cy,b[2]+cz,t[0]+cx,t[1]+cy,t[2]+cz);A.uv.push(0,0,0,0);}
  const cb=rot3([0,-h/2,0],rx,ry,rz),ct=rot3([0,h/2,0],rx,ry,rz);
  A.pos.push(cb[0]+cx,cb[1]+cy,cb[2]+cz,ct[0]+cx,ct[1]+cy,ct[2]+cz);A.uv.push(0,0,0,0);
  const B=seg*2,T=seg*2+1;
  for(let i=0;i<seg;i++){const j=(i+1)%seg;const b0=i*2,t0=i*2+1,b1=j*2,t1=j*2+1;
    A.idx.push(b0,b1,t1,b0,t1,t0);A.idx.push(B,b1,b0);A.idx.push(T,t0,t1);}
  return A;
}
function rodA(a,b,t){
  const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz)||1;const d=[dx/len,dy/len,dz/len];
  let u=Math.abs(d[1])<0.9?[0,1,0]:[1,0,0];
  let s=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]];const sl=Math.hypot(...s)||1;s=s.map(v=>v/sl);
  const n=[d[1]*s[2]-d[2]*s[1],d[2]*s[0]-d[0]*s[2],d[0]*s[1]-d[1]*s[0]];
  const A=arrNew(),h=t/2;const c=[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
  const V=[];[-1,1].forEach(k=>{[-1,1].forEach(i=>{[-1,1].forEach(j=>{V.push([c[0]+d[0]*k*len/2+s[0]*i*h+n[0]*j*h,c[1]+d[1]*k*len/2+s[1]*i*h+n[1]*j*h,c[2]+d[2]*k*len/2+s[2]*i*h+n[2]*j*h]);});});});
  V.forEach(v=>{A.pos.push(v[0],v[1],v[2]);A.uv.push(0,0);});
  // vertex order: k,i,j → index = (k+1)/2*4+(i+1)/2*2+(j+1)/2
  const Q=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
  Q.forEach(f=>{A.idx.push(f[0],f[1],f[2],f[0],f[2],f[3]);});
  return A;
}
function planeA(w,h){const A=arrNew();A.pos.push(-w/2,-h/2,0,w/2,-h/2,0,w/2,h/2,0,-w/2,h/2,0);A.uv.push(0,0,1,0,1,1,0,1);A.idx.push(0,1,2,0,2,3);return A;}
/* ---------------------------------------------------------------------
   Enganche Scharfenberg (cabeza tipo 10) · solo lo que asoma por el testero.
   Origen en el eje del enganche sobre el plano de acoplamiento; +z hacia fuera del
   tren, x a la derecha de quien lo mira de frente: cono a la izquierda y embudo a la
   derecha (girado 180° casa con otro igual). Placa frontal rectangular gris oscuro con el cono,
   el gancho y el embudo, las dos tomas de aire con su aro de latón y la varilla de
   centrado; encima la cabeza eléctrica con su tapa; detrás el cuerpo, el collarín y la caña, las mangueras y el
   tirador rojo de desacople. Caras planas con vértices propios (aristas vivas) salvo
   en el cono, el embudo, la caña y los tubos. Un solo mesh con color por vértice.
   --------------------------------------------------------------------- */
const SCH_C={galv:0x575B5F,galv2:0x474B4F,cone:0x3A3D40,hook:0x4C5054,cup:0x2E3133,deep:0x101011,brass:0xB48C3A,port:0x0D0E0F,body:0x3D4145,shank:0x33363A,
  elec:0x2A2C2F,lid:0x34373B,brk:0x464A4E,rod:0x2E3134,hose:0x222426,red:0xB5231C,zinc:0x70757A};
function scharfArr(len){
  const A={pos:[],col:[],idx:[]},L=len||0.75,C=SCH_C;
  const V=(p,c)=>{A.pos.push(p[0],p[1],p[2]);A.col.push(c);return A.pos.length/3-1;};
  /* every triangle is wound to look along n: no winding to get wrong */
  const tri=(a,b,c,n)=>{const p=a*3,q=b*3,r=c*3,P=A.pos,ux=P[q]-P[p],uy=P[q+1]-P[p+1],uz=P[q+2]-P[p+2],vx=P[r]-P[p],vy=P[r+1]-P[p+1],vz=P[r+2]-P[p+2];
    if((uy*vz-uz*vy)*n[0]+(uz*vx-ux*vz)*n[1]+(ux*vy-uy*vx)*n[2]>=0)A.idx.push(a,b,c);else A.idx.push(a,c,b);};
  const poly=(pts,c,n)=>{const I=pts.map(p=>V(p,c));for(let i=1;i<I.length-1;i++)tri(I[0],I[i],I[i+1],n);};
  const box=(x0,x1,y0,y1,z0,z1,c)=>{
    poly([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],c,[0,0,1]);poly([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]],c,[0,0,-1]);
    poly([[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]],c,[1,0,0]);poly([[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[x0,y0,z1]],c,[-1,0,0]);
    poly([[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],c,[0,1,0]);poly([[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]],c,[0,-1,0]);};
  const cen=R=>{const s=[0,0,0];R.forEach(p=>{s[0]+=p[0];s[1]+=p[1];s[2]+=p[2];});return[s[0]/R.length,s[1]/R.length,s[2]/R.length];};
  /* skin over closed rings. o.flat: one flat face per quad; o.hard: smooth around, creased between rings; o.inv: faces look inwards */
  const loft=(rings,c,o)=>{o=o||{};const n=rings[0].length,sg=o.inv?-1:1;let prev=null;
    for(let i=0;i<rings.length-1;i++){const R0=rings[i],R1=rings[i+1],k0=cen(R0),k1=cen(R1),ci=Array.isArray(c)?c[i]:c;
      const out=(j,j1)=>[sg*((R0[j][0]+R1[j1][0])/2-(k0[0]+k1[0])/2),sg*((R0[j][1]+R1[j1][1])/2-(k0[1]+k1[1])/2),sg*((R0[j][2]+R1[j1][2])/2-(k0[2]+k1[2])/2)];
      if(o.flat){for(let j=0;j<n;j++){const j1=(j+1)%n;poly([R0[j],R0[j1],R1[j1],R1[j]],ci,out(j,j1));}continue;}
      const a=(prev&&!o.hard&&!Array.isArray(c))?prev:R0.map(p=>V(p,ci)),b=R1.map(p=>V(p,ci));
      for(let j=0;j<n;j++){const j1=(j+1)%n,nn=out(j,j1);tri(a[j],a[j1],b[j1],nn);tri(a[j],b[j1],b[j],nn);}
      prev=b;}};
  const cap=(R,c,n)=>{const k=V(cen(R),c),I=R.map(p=>V(p,c));for(let j=0;j<I.length;j++)tri(k,I[j],I[(j+1)%I.length],n);};
  const circ=(cx,cy,z,r,n,ph)=>{const R=[];for(let j=0;j<n;j++){const a=(j+(ph||0))/n*TAU;R.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r,z]);}return R;};
  /* round bar or hose along a polyline */
  const spl=(P,k)=>{const o=[],g=i=>P[Math.max(0,Math.min(P.length-1,i))];for(let i=0;i<P.length-1;i++)for(let j=0;j<k;j++){const t=j/k,a=g(i-1),b=g(i),c=g(i+1),d=g(i+2);
      o.push([0,1,2].map(q=>0.5*(2*b[q]+(c[q]-a[q])*t+(2*a[q]-5*b[q]+4*c[q]-d[q])*t*t+(3*b[q]-a[q]-3*c[q]+d[q])*t*t*t)));}o.push(P[P.length-1]);return o;};
  const tube=(pts,r,n,c,ends)=>{const rings=[];let u=null;
    for(let i=0;i<pts.length;i++){const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)];let t=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];const tl=Math.hypot(t[0],t[1],t[2])||1;t=[t[0]/tl,t[1]/tl,t[2]/tl];
      if(!u)u=Math.abs(t[1])<0.9?[0,1,0]:[1,0,0];
      const d=u[0]*t[0]+u[1]*t[1]+u[2]*t[2];u=[u[0]-t[0]*d,u[1]-t[1]*d,u[2]-t[2]*d];const ul=Math.hypot(u[0],u[1],u[2])||1;u=[u[0]/ul,u[1]/ul,u[2]/ul];
      const w=[t[1]*u[2]-t[2]*u[1],t[2]*u[0]-t[0]*u[2],t[0]*u[1]-t[1]*u[0]],R=[];
      for(let j=0;j<n;j++){const an=j/n*TAU,cs=Math.cos(an)*r,sn=Math.sin(an)*r;R.push([pts[i][0]+u[0]*cs+w[0]*sn,pts[i][1]+u[1]*cs+w[1]*sn,pts[i][2]+u[2]*cs+w[2]*sn]);}
      rings.push(R);}
    loft(rings,c);
    if(ends!==false){const p=pts,m=p.length-1;cap(rings[0],c,[p[0][0]-p[1][0],p[0][1]-p[1][1],p[0][2]-p[1][2]]);cap(rings[m],c,[p[m][0]-p[m-1][0],p[m][1]-p[m-1][1],p[m][2]-p[m-1][2]]);}};
  /* prism along x from a convex (z,y) profile */
  const prismX=(prof,x0,x1,c)=>{const R0=prof.map(p=>[x0,p[1],p[0]]),R1=prof.map(p=>[x1,p[1],p[0]]);loft([R0,R1],c,{flat:true});poly(R0,c,[-1,0,0]);poly(R1,c,[1,0,0]);};

  /* --- face plate (plain rectangle) with the lug of the centring bar --- */
  const T=0.035,CX=0.15,RC=0.122,NC=14;
  const OUT=[[-0.31,0.20],[-0.31,-0.20],[0.025,-0.20],[0.025,-0.235],[0.115,-0.235],[0.115,-0.20],[0.31,-0.20],[0.31,0.20]];
  const HOLE=circ(CX,0,0,RC,NC).map(p=>[p[0],p[1]]);
  {const v2=p=>new THREE.Vector2(p[0],p[1]),F=THREE.ShapeUtils.triangulateShape(OUT.map(v2),[HOLE.slice().reverse().map(v2)]),all=OUT.concat(HOLE.slice().reverse());
    [[0,[0,0,1]],[-T,[0,0,-1]]].forEach(([z,n])=>{const I=all.map(p=>V([p[0],p[1],z],C.galv));F.forEach(f=>tri(I[f[0]],I[f[1]],I[f[2]],n));});
    OUT.forEach((p,i)=>{const q=OUT[(i+1)%OUT.length];poly([[p[0],p[1],0],[q[0],q[1],0],[q[0],q[1],-T],[p[0],p[1],-T]],C.galv,[q[1]-p[1],p[0]-q[0],0]);});}
  /* bolts */
  [[-0.272,0.162],[0.272,0.162],[0.272,-0.162],[-0.272,-0.162]].forEach(([x,y])=>{loft([circ(x,y,0,0.021,6),circ(x,y,0.012,0.021,6)],C.galv2,{flat:true});cap(circ(x,y,0.012,0.021,6),C.galv2,[0,0,1]);});
  /* --- funnel: a real hole through the plate --- */
  loft([circ(CX,0,0,RC,NC),circ(CX,0,-0.018,RC-0.014,NC),circ(CX,0,-0.15,0.07,NC)],[C.galv2,C.cup],{inv:true});cap(circ(CX,0,-0.15,0.07,NC),C.deep,[0,0,1]);
  /* --- cone, its blunt nose pulled towards the hook --- */
  {const N=12,cx=-0.15;loft([circ(cx,0,0,0.132,N),circ(cx,0,0.022,0.128,N),circ(cx+0.008,0,0.055,0.108,N),circ(cx+0.028,0,0.082,0.076,N),circ(cx+0.04,0,0.118,0.064,N),circ(cx+0.04,0,0.134,0.046,N)],C.cone);cap(circ(cx+0.04,0,0.134,0.046,N),C.cone,[0,0,1]);}
  /* hook plate between cone and funnel */
  box(-0.05,-0.008,-0.064,0.064,0,0.122,C.hook);box(-0.008,0.012,-0.05,0.05,0,0.10,C.hook);
  /* --- air ports: brass ring and dark seal --- */
  [[0.002,0.156],[-0.004,-0.156]].forEach(([x,y])=>{const N=8;loft([circ(x,y,0,0.034,N),circ(x,y,0.012,0.034,N)],C.brass);cap(circ(x,y,0.012,0.034,N),C.brass,[0,0,1]);
    loft([circ(x,y,0.012,0.022,N),circ(x,y,0.017,0.022,N)],C.port);cap(circ(x,y,0.017,0.022,N),C.port,[0,0,1]);});
  /* --- centring bar: out of the plate, then down and forward --- */
  tube([[0.07,-0.168,-0.03],[0.07,-0.168,0.09],[0.07,-0.176,0.115],[0.07,-0.20,0.138],[0.07,-0.385,0.30]],0.019,6,C.rod);
  /* --- body behind the plate, collar and shank --- */
  {const oct=(a,t,b,ch,z)=>[[a,-b+ch,z],[a,t-ch,z],[a-ch,t,z],[-a+ch,t,z],[-a,t-ch,z],[-a,-b+ch,z],[-a+ch,-b,z],[a-ch,-b,z]];
    loft([oct(0.25,0.17,0.15,0.05,-T),oct(0.20,0.155,0.135,0.06,-0.20),circ(0,0,-0.36,0.10,8,-0.5)],C.body,{flat:true});
    loft([circ(0,0,-0.39,0.128,8,-0.5),circ(0,0,-0.49,0.128,8,-0.5)],C.body,{flat:true});cap(circ(0,0,-0.39,0.128,8,-0.5),C.body,[0,0,1]);cap(circ(0,0,-0.49,0.128,8,-0.5),C.body,[0,0,-1]);
    [1,-1].forEach(s=>box(-0.035,0.035,s>0?0.12:-0.165,s>0?0.165:-0.12,-0.48,-0.40,C.body));
    loft([circ(0,0,-0.36,0.09,8,-0.5),circ(0,0,-L,0.09,8,-0.5)],C.shank);cap(circ(0,0,-L,0.09,8,-0.5),C.shank,[0,0,-1]);
    box(-0.09,0.09,-0.225,-0.15,-0.19,-T,C.galv2);}
  /* red uncoupling handle on the funnel side */
  {const x0=0.212,x1=0.226,t=0.014;box(x0,x1,-0.12,0.03,-0.30,-0.30+t,C.red);box(x0,x1,-0.12,0.03,-0.22-t,-0.22,C.red);box(x0,x1,0.03-t,0.03,-0.30,-0.22,C.red);box(x0,x1,-0.12,-0.12+t,-0.30,-0.22,C.red);
    box(0.17,x0,-0.055,-0.035,-0.268,-0.252,C.red);}
  /* --- electrical head: bracket, lid with the hazard signs, box behind, side arm --- */
  box(-0.22,0.22,0.20,0.235,-0.26,-0.02,C.brk);
  [-0.15,-0.02,0.12].forEach(x=>box(x-0.016,x+0.016,0.203,0.232,-0.02,0.004,C.zinc));
  prismX([[-0.15,0.235],[-0.012,0.235],[0,0.262],[0,0.335],[-0.022,0.385],[-0.065,0.412],[-0.15,0.418]],-0.30,0.285,C.lid);
  box(-0.27,0.255,0.245,0.405,-0.30,-0.15,C.elec);
  box(0.285,0.31,0.20,0.40,-0.10,-0.06,C.brk);box(0.22,0.31,0.20,0.225,-0.10,-0.06,C.brk);
  /* --- hoses back into the train: cable conduit of the electrical head and the two air hoses --- */
  tube(spl([[-0.20,0.33,-0.29],[-0.215,0.35,-0.40],[-0.25,0.33,-0.52],[-0.27,0.25,-0.64],[-0.25,0.14,-L]],2),0.028,6,C.hose,false);
  tube(spl([[-0.19,-0.05,-0.12],[-0.262,-0.10,-0.16],[-0.275,-0.21,-0.28],[-0.22,-0.25,-0.46],[-0.13,-0.20,-L]],2),0.022,5,C.hose,false);
  tube(spl([[0.19,-0.07,-0.13],[0.258,-0.12,-0.18],[0.262,-0.215,-0.34],[0.21,-0.235,-0.52],[0.15,-0.20,-L]],2),0.022,5,C.hose,false);
  return A;
}
const SCH={mat:null,geo:{}};
function scharfGeo(len){const L=Math.round((len||0.75)*20)/20;if(SCH.geo[L])return SCH.geo[L];const A=scharfArr(L),g=new THREE.BufferGeometry(),c=new THREE.Color(),col=new Float32Array(A.col.length*3);
  A.col.forEach((h,i)=>{c.setHex(h);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;});
  g.setAttribute('position',new THREE.Float32BufferAttribute(A.pos,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setIndex(A.idx);g.computeVertexNormals();
  g.userData.keep=true;g.userData.tris=A.idx.length/3;
  if(!SCH.mat){SCH.mat=new THREE.MeshLambertMaterial({vertexColors:true,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(SCH.mat,SCH_C.body);}
  return SCH.geo[L]=g;}
/* a coupler ready to hang on a nose: axis at (x,y), coupling plane at z, e=+1 looks to +z and e=-1 to -z; len = how far
   the shank and the hoses run back into the nose. The parts functions list theirs as [x,y,z,e,len] and the builders hang them */
function scharf(x,y,z,e,len){const m=new THREE.Mesh(scharfGeo(len),SCH.mat);m.position.set(x||0,y||0,z||0);if(e<0)m.rotation.y=PI;m.castShadow=true;m.receiveShadow=true;return m;}
function scharfHang(grp,list){(list||[]).forEach(q=>grp.add(scharf(q[0],q[1],q[2],q[3],q[4])));}
/* car layout (cab, if any, always at +z while building). Doors 7.9 m from each end,
   end bays with two windows, saloon with four (Electrotren/Renfe references) */
function layout470(kind,L){
  const half=L/2-0.225,front=L/2-0.10;
  const o={L:L,zb:-half,zf:kind==='R'?half:front,cab:kind!=='R',doors:[],win:[],cabWin:null,wedge:null,cabDoor:null};
  const dRear=-half+7.9;
  o.win.push([-half+0.6,-half+3.55],[-half+3.75,-half+6.85]);
  if(kind==='R'){const dFront=half-7.9;o.doors=[dRear,dFront];o.win.push([half-6.85,half-3.75],[half-3.55,half-0.6]);o.saloon=[dRear+0.95,dFront-0.95];}
  else{const dFront=front-7.9;o.doors=[dRear,dFront];o.win.push([front-6.85,front-5.05],[front-4.85,front-3.2]);o.saloon=[dRear+0.95,dFront-0.95];
    o.cabWin=[front-0.95,front-0.35];o.doorWin=[front-1.45,front-1.10];o.wedge={zTop:front-2.45,zBot:front-1.35};o.cabDoor=front-1.72;}
  return o;
}
/* nose: windscreen almost vertical, orange forehead sweeping back into the roof, rounded corners in plan */
function rake470(y){return y<=3.12?(y-1.95)*0.0437:0.0511+(y-3.12)*0.114;}
function cornerW470(y){return 1;}
/* front cap as a grid that follows the real face (flat centre, corners rounded in plan) */
function capGrid470(zf,uvFn){const A=arrNew(),h=PROF470.h,N=10,rows=[];
  h.forEach(l=>{const xm=l[0],y=l[1],row=[];for(let i=0;i<=N;i++){const x=-xm+2*xm*i/N;const z=zf-rake470(y)-corner470(x);row.push(A.pos.length/3);A.pos.push(x,y,z);const t=uvFn([x,y,z]);A.uv.push(t[0],t[1]);}rows.push(row);});
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<N;i++){const a=rows[j][i],b=rows[j][i+1],c=rows[j+1][i+1],d=rows[j+1][i];A.idx.push(a,b,c,a,c,d);}
  return A;}
function corner470(x){return 0;} /* square corners: the front face meets the sides at 90° */
function ring470(z,u,warp){return{u:u,pts:PROF470.pts.map(p=>[p[0],p[1],z-(warp?(rake470(p[1])+corner470(p[0])*cornerW470(p[1]))*warp:0)])};}
function pantoA(z0,top,folded,dy){
  const A=arrNew(),P=(B)=>arrPush(A,B);top=top||5.26;dy=dy||0; /* dy: roof height offset (base at 3.93 m by default) */
  [[-0.5,-0.55],[0.5,-0.55],[-0.5,0.55],[0.5,0.55]].forEach(q=>P(cylA(q[0],4.02+dy,z0+q[1],0.07,0.22,8)));
  P(boxA(0,4.12+dy,z0,1.25,0.06,1.4));
  if(folded){P(rodA([0,4.22+dy,z0+0.55],[0,4.40+dy,z0-0.95],0.07));P(rodA([0,4.40+dy,z0-0.95],[0,4.52+dy,z0+0.45],0.05));P(boxA(0,4.50+dy,z0+0.45,1.75,0.05,0.10));P(boxA(0,4.50+dy,z0+0.32,1.75,0.05,0.08));return A;}
  P(rodA([0,4.18+dy,z0+0.5],[0,top-0.4,z0-0.85],0.075));P(rodA([0,top-0.4,z0-0.85],[0,top,z0+0.35],0.05));P(rodA([0,4.18+dy,z0+0.25],[0,4.70+dy,z0-0.55],0.03));
  P(boxA(0,top-0.02,z0+0.35,1.75,0.05,0.10));P(boxA(0,top-0.02,z0+0.22,1.75,0.05,0.08));
  return A;
}
/* ---- parts for one car; cab always at +z; returns merged arrays per material ---- */
function parts470(kind,lead,open){
  const L=kind==='R'?R470.LR:R470.LM,LY=layout470(kind,L),Lb=LY.zf-LY.zb,sch=[];
  const M={};const add=(key,A)=>{if(!M[key])M[key]=arrNew();arrPush(M[key],A);};
  const u=z=>(z-LY.zb)/Lb;
  // body loft
  const rings=[ring470(LY.zb,0,0)];
  if(LY.cab){const zA=LY.zf-1.5,zB=LY.zf-0.7;rings.push(ring470(zA,u(zA),0),ring470(zB,u(zB),0.3),ring470(LY.zf,1,1));}
  else rings.push(ring470(LY.zf,1,0));
  add('side',loft(rings));
  // caps
  const rear=ring470(LY.zb,0,0).pts;add('dark',capBands(rear,-1));
  if(LY.cab){add('front',capGrid470(LY.zf,p=>[(p[0]+R470.HALF)/R470.W,(p[1]-0.55)/(PROF470.top-0.55)]));}
  else{const fr=ring470(LY.zf,1,0).pts;add('dark',capBands(fr,1));}
  // underframe and skirt equipment
  add('dark',boxA(0,0.82,(LY.zb+LY.zf)/2,2.55,0.24,Lb-1.2));
  const eq=kind==='M'?[[-6.4,2.6,0.42],[-3.2,2.0,0.36],[0.6,3.0,0.46],[4.2,1.6,0.34]]:(kind==='R'?[[-5.0,2.2,0.36],[-1.0,2.8,0.40],[3.8,1.8,0.32]]:[[-5.6,2.4,0.38],[-1.6,2.0,0.34],[3.4,2.6,0.42]]);
  eq.forEach(q=>add('grey',boxA(0,0.56-q[2],q[0],2.25,q[2],q[1])));
  // bogies (centres ±9.425, wheelbase 2.6 motor / 2.5 trailer)
  const motor=kind==='M';const wb=motor?2.6:2.5,rw=motor?0.5:0.47;
  [-9.425,9.425].forEach(zc=>{
    [-1.0,1.0].forEach(x=>{add('bogie',boxA(x,0.46,zc,0.16,0.34,3.35));add('bogie',boxA(x,0.80,zc,0.26,0.10,2.0));
      [-wb/2,wb/2].forEach(a=>{add('wheel',cylA(x*0.8,rw,zc+a,rw,0.13,14,0,0,PI/2));add('bogie',boxA(x,0.62,zc+a,0.30,0.30,0.36));add('bogie',cylA(x,0.95,zc+a,0.12,0.26,8));});});
    add('bogie',boxA(0,0.62,zc,2.1,0.22,0.6));add('bogie',boxA(0,0.42,zc-wb/2,1.4,0.08,0.08));add('bogie',boxA(0,0.42,zc+wb/2,1.4,0.08,0.08));
    if(motor)add('bogie',boxA(0,0.34,zc,1.2,0.48,1.1));
  });
  // roof: low vent strips on every car; on the motor car the long resistor grille and two pantographs
  add('roof2',boxA(0,3.86,0,1.1,0.08,Lb-6));
  if(motor){
    add('mesh',boxA(0,3.84,0.5,1.6,0.26,9.0));add('roof2',boxA(0,3.84,0.5,1.7,0.06,9.2));
    add('panto',pantoA(LY.zf-4.4,5.26,false));
    add('panto',pantoA(LY.zb+4.2,5.26,true));
    add('roof2',boxA(0,3.86,LY.zb+7.2,0.9,0.16,0.8));
  }else add('roof2',boxA(0,3.86,0,0.9,0.14,0.8));
  // gangway bellows at the rear (and at both ends of the trailer)
  add('bellows',boxA(0,1.12,LY.zb-0.18,1.35,2.15,0.36));
  if(!LY.cab)add('bellows',boxA(0,1.12,LY.zf+0.18,1.35,2.15,0.36));
  // cab end: head/tail lamps, lower lamp pairs, corner boxes, Scharfenberg coupler, wipers
  if(LY.cab){
    const zf=LY.zf;
    const fh=y=>zf-rake470(y);const tiltU=Math.atan(0.114),tiltL=Math.atan(0.0437);
    // twin round headlights on the forehead, housings sunk into the face
    [-0.15,0.15].forEach(x=>{add('dark',cylA(x,3.62,fh(3.62)-0.01,0.125,0.07,12,PI/2-tiltU,0,0));add(lead?'lightW':'lampOffW',cylA(x,3.62,fh(3.62)+0.03,0.10,0.03,12,PI/2-tiltU,0,0));});
    // red tail-lamp boxes at the top corners
    [-1,1].forEach(s=>{add('dark',boxA(s*1.02,3.45,fh(3.52)-0.015,0.30,0.14,0.07,-tiltU,0,0));
      [-0.07,0.07].forEach(dx=>add(lead?'lampOffR':'lightR',cylA(s*1.02+dx,3.52,fh(3.52)+0.03,0.032,0.03,8,PI/2-tiltU,0,0)));});
    // lower lamps in the black mask corners: white rectangle + small red
    [-1,1].forEach(s=>{add(lead?'lightW':'lampOffW',boxA(s*1.02,1.66,fh(1.72)-0.005,0.24,0.13,0.03));add(lead?'lampOffR':'lightR',cylA(s*0.78,1.72,fh(1.72)+0.005,0.04,0.03,8,PI/2,0,0));});
    // corner buffer housings (topes): front slab hugging the face, side slab behind it (no overlapping faces)
    [-1,1].forEach(s=>{add('grey',boxA(s*1.125,0.71,fh(1.0)+0.04,0.73,0.57,0.12));
      add('grey',boxA(s*(R470.HALF+0.02),0.71,fh(1.0)-0.195,0.04,0.57,0.35));
      add('dark',boxA(s*1.0,0.80,fh(1.0)+0.115,0.40,0.40,0.03));add('bogie',boxA(s*1.0,0.86,fh(1.0)+0.1375,0.28,0.28,0.015));});
    // Scharfenberg coupler (its own mesh, see scharf): coupling plane 0.70 m ahead of the face, axis at 0.81 m
    sch.push([0,0.81,fh(0.8)+0.70,1,0.9]);
    // wipers hanging from the mask top
    [-0.70,0.46].forEach(x=>add('dark',rodA([x,3.05,fh(3.05)+0.006],[x+0.30,2.05,fh(2.05)+0.006],0.03)));
    // cab side grab rails
    [-1,1].forEach(s=>add('grey',boxA(s*(R470.HALF+0.02),2.05,zf-1.62,0.03,1.4,0.03)));
  }
  // door leaves (separate meshes: animated)
  const doors=[];
  LY.doors.forEach(zc=>{[-1,1].forEach(s=>{[-1,1].forEach(k=>{doors.push({A:planeA(0.76,2.10),x:s*(R470.HALF+0.02),y:1.05+1.05,z:zc+k*0.39,side:s,slide:k,mirror:(s*k)<0});});});});
  return{M:M,doors:doors,layout:LY,L:L,sch:sch};
}
/* ---- livery: Renfe Media Distancia (white, orange-framed windows, purple stripe, orange cab) ---- */
const LIV={white:'#EEEDE8',orange:'#E8521F',orange2:'#C94314',purple:'#9A2A78',glass:'#2A2522',glass2:'#5A5048',glass3:'#3A322C',pillar:'#17171A',
  skirt:'#7E8488',skirt2:'#6B7175',roof:'#8F9599',roof2:'#7A8084',roofLine:'#5C6165',door:'#EBEAE5',frame:'#55595D',dark:'#1C2024',floor:'#8A8880',mask:'#101214'};
function paintCar470(c,W,H,kind,num){
  const L=kind==='R'?R470.LR:R470.LM,LY=layout470(kind,L),Lb=LY.zf-LY.zb;
  const X=z=>(z-LY.zb)/Lb*W,Y=(y,s)=>(1-v470(y,s))*H;
  const rect=(y0,y1,z0,z1,col)=>{c.fillStyle=col;[-1,1].forEach(s=>{const ya=Y(y0,s),yb=Y(y1,s);c.fillRect(X(z0),Math.min(ya,yb),Math.max(1,X(z1)-X(z0)),Math.abs(yb-ya)+0.7);});};
  const poly=(pts,col)=>{c.fillStyle=col;[-1,1].forEach(s=>{c.beginPath();pts.forEach((p,i)=>{const x=X(p[0]),y=Y(p[1],s);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.fill();});};
  c.fillStyle=LIV.white;c.fillRect(0,0,W,H);
  // roof: grey with a darker cantrail line and panel joints
  const r0=Y(PROF470.yRoof,-1),r1=Y(PROF470.yRoof,1);
  c.fillStyle=LIV.roof;c.fillRect(0,Math.min(r0,r1),W,Math.abs(r1-r0));
  c.fillStyle=LIV.roof2;c.fillRect(0,Y(3.88,-1),W,Y(3.88,1)-Y(3.88,-1));
  rect(3.50,3.60,LY.zb,LY.zf,LIV.roofLine);
  c.fillStyle='rgba(0,0,0,.10)';for(let z=LY.zb+1.5;z<LY.zf;z+=1.5)c.fillRect(X(z),Math.min(r0,r1),1.2,Math.abs(r1-r0));
  // grey skirt and white lower body
  rect(0.55,1.05,LY.zb,LY.zf,LIV.skirt);rect(0.98,1.05,LY.zb,LY.zf,LIV.skirt2);
  // purple stripe, interrupted at the doors
  const segs=[];let s0=LY.zb;LY.doors.slice().sort((a,b)=>a-b).forEach(z=>{segs.push([s0,z-0.84]);s0=z+0.84;});segs.push([s0,LY.zf]);
  segs.forEach(sg=>rect(1.50,1.63,sg[0],sg[1],LIV.purple));
  // window band with orange frame
  const band=(z0,z1)=>{rect(1.90,3.03,z0-0.08,z1+0.08,LIV.orange);rect(1.98,2.95,z0,z1,LIV.glass);rect(2.60,2.95,z0,z1,LIV.glass2);rect(2.45,2.60,z0,z1,LIV.glass3);};
  const pill=(z)=>rect(1.98,2.95,z-0.07,z+0.07,LIV.pillar);
  const S=LY.saloon;band(S[0],S[1]);for(let k=1;k<4;k++)pill(S[0]+(S[1]-S[0])*k/4);
  LY.win.forEach(w=>band(w[0],w[1]));
  // doorways (dark interior when the leaves slide open) + frames
  LY.doors.forEach(zc=>{rect(1.05,3.16,zc-0.80,zc+0.80,'#3E4448');rect(2.98,3.16,zc-0.80,zc+0.80,'#6A7074');rect(1.12,1.40,zc-0.80,zc+0.80,'#33383B');rect(1.05,1.12,zc-0.76,zc+0.76,LIV.floor);
    rect(1.0,3.22,zc-0.86,zc-0.80,LIV.frame);rect(1.0,3.22,zc+0.80,zc+0.86,LIV.frame);rect(3.16,3.22,zc-0.86,zc+0.86,LIV.frame);});
  if(LY.cab){
    const w=LY.wedge;
    // orange cab: forehead over the roof, side wedge with a curved trailing edge
    c.fillStyle=LIV.orange;c.fillRect(X(LY.zf-1.05),Math.min(r0,r1),W-X(LY.zf-1.05),Math.abs(r1-r0));
    const pts=[[w.zTop,3.60],[LY.zf+0.6,3.60],[LY.zf+0.6,0.55],[w.zBot,0.55],[w.zBot,1.05]];
    for(let i=1;i<=5;i++){const t=i/6;const yy=lerp(1.05,3.60,t);const zz=lerp(w.zBot,w.zTop,Math.pow(t,0.7));pts.push([zz,yy]);}
    poly(pts,LIV.orange);
    rect(0.55,1.05,w.zBot-0.4,LY.zf+0.6,LIV.skirt);
    // cab door line and the cab side window with its sliding pane
    rect(1.05,3.16,LY.cabDoor-0.02,LY.cabDoor+0.02,'rgba(0,0,0,.30)');
    rect(1.92,3.01,LY.cabWin[0]-0.05,LY.cabWin[1]+0.05,LIV.mask);rect(1.98,2.95,LY.cabWin[0],LY.cabWin[1],LIV.glass);rect(2.60,2.95,LY.cabWin[0],LY.cabWin[1],LIV.glass2);
    rect(2.12,2.58,LY.cabWin[0]+0.10,LY.cabWin[1]-0.05,LIV.orange);rect(2.12,2.16,LY.cabWin[0]+0.10,LY.cabWin[1]-0.05,LIV.orange2);
    rect(1.92,3.01,LY.doorWin[0]-0.04,LY.doorWin[1]+0.04,LIV.mask);rect(1.98,2.95,LY.doorWin[0],LY.doorWin[1],LIV.glass);rect(2.60,2.95,LY.doorWin[0],LY.doorWin[1],LIV.glass2);
    c.font='700 '+Math.round(H*0.034)+'px "Barlow Condensed","Arial Narrow",sans-serif';c.fillStyle='#FFFFFF';c.textBaseline='middle';
    [-1,1].forEach(s=>{c.save();c.translate(X(LY.zf-0.72),Y(3.27,s));if(s>0)c.scale(-1,-1);c.textAlign='center';c.fillText(num,0,0);c.restore();});
  }
  // UIC number near the ends, reading correctly on each side
  c.font='500 '+Math.round(H*0.017)+'px "IBM Plex Mono",monospace';c.fillStyle='#3F4448';c.textBaseline='middle';
  const uic='9-470-'+num.replace(/[MRC]$/,'')+'-8';
  [-1,1].forEach(s=>{c.save();c.translate(X(LY.zb+1.6),Y(1.25,s));if(s>0)c.scale(-1,-1);c.textAlign='center';c.fillText(uic,0,0);c.restore();});
}
function paintFront470(c,W,H,num,dest){
  const U=x=>(x+R470.HALF)/R470.W*W,V=y=>(1-(y-0.55)/(PROF470.top-0.55))*H;
  c.fillStyle=LIV.orange;c.fillRect(0,0,W,H);
  // lower panel (off-white, dirtied) under the orange stripe
  c.fillStyle='#D6D6D0';c.fillRect(0,V(1.38),W,H-V(1.38));
  c.fillStyle='#8F9398';c.fillRect(0,V(0.62),W,H-V(0.62));
  c.fillStyle='rgba(0,0,0,.12)';c.fillRect(0,V(1.38),W,V(1.25)-V(1.38));
  c.fillStyle=LIV.orange2;c.fillRect(0,V(1.40),W,V(1.38)-V(1.40));
  // recess above the coupler
  c.fillStyle=LIV.mask;c.fillRect(U(-0.14),V(1.36),U(0.14)-U(-0.14),V(1.08)-V(1.36));
  // black mask, almost edge to edge, from the forehead down to the orange stripe
  c.fillStyle=LIV.mask;c.beginPath();const mx0=U(-1.41),mx1=U(1.41),my0=V(3.12),my1=V(1.55);
  if(c.roundRect)c.roundRect(mx0,my0,mx1-mx0,my1-my0,[16,16,3,3]);else c.rect(mx0,my0,mx1-mx0,my1-my0);c.fill();
  // two tall windscreen panes with a central pillar
  const g=c.createLinearGradient(0,V(3.06),0,V(1.95));g.addColorStop(0,'#8797A4');g.addColorStop(0.3,'#55646F');g.addColorStop(1,'#1C2328');
  [[-1.31,-0.07],[0.07,1.31]].forEach(p=>{c.fillStyle=g;c.beginPath();const x0=U(p[0]),x1=U(p[1]),y0=V(3.06),y1=V(1.95);
    if(c.roundRect)c.roundRect(x0,y0,x1-x0,y1-y0,[10,10,3,3]);else c.rect(x0,y0,x1-x0,y1-y0);c.fill();});
  c.fillStyle='rgba(255,255,255,.14)';c.fillRect(U(-1.22),V(3.0),U(-0.3)-U(-1.22),5);c.fillRect(U(0.3),V(3.0),U(1.22)-U(0.3),5);
  // destination display (left) and unit number (right) on the forehead
  c.fillStyle=LIV.mask;c.fillRect(U(-1.14),V(3.38),U(-0.24)-U(-1.14),V(3.20)-V(3.38));
  c.fillStyle='#F3A52E';c.font='600 '+Math.round(H*0.03)+'px "IBM Plex Mono",monospace';c.textAlign='center';c.textBaseline='middle';
  c.fillText((dest||'').toUpperCase().slice(0,11),U(-0.69),V(3.29));
  c.fillStyle='#FFFFFF';c.font='700 '+Math.round(H*0.058)+'px "Barlow Condensed","Arial Narrow",sans-serif';c.fillText(num,U(0.70),V(3.29));
  // panel joints
  c.fillStyle='rgba(0,0,0,.16)';c.fillRect(0,V(3.135),W,2);c.fillRect(0,V(1.555),W,2);
}
function paintDoor470(c,W,H,mirror){
  const Vy=y=>(1-(y-1.0)/2.10)*H;
  c.fillStyle=LIV.door;c.fillRect(0,0,W,H);
  const wx=mirror?W*0.52:W*0.14;
  c.fillStyle=LIV.mask;c.fillRect(wx-2,Vy(3.02)-2,W*0.34+4,Vy(1.95)-Vy(3.02)+4);
  c.fillStyle=LIV.glass;c.fillRect(wx,Vy(3.0),W*0.34,Vy(1.97)-Vy(3.0));
  c.fillStyle=LIV.glass2;c.fillRect(wx,Vy(3.0),W*0.34,Vy(2.62)-Vy(3.0));
  c.fillStyle=LIV.frame;c.fillRect(mirror?W-3:0,0,3,H);c.fillRect(0,0,W,3);c.fillRect(0,H-3,W,3);
  c.fillStyle='rgba(0,0,0,.18)';c.fillRect(0,Vy(1.12),W,Vy(1.0)-Vy(1.12));
  c.fillStyle='rgba(0,0,0,.35)';c.fillRect(mirror?0:W-2,0,2,H);
}
/* ---- textures and materials (shared per kind; the front one per train) ---- */
const TEX470={};
function tex470(){
  if(TEX470.ready)return TEX470;
  const nums={M:'129M',R:'129R',Rc:'135C'};
  ['M','R','Rc'].forEach(k=>{TEX470[k]=canvasTex(2048,512,(c,w,h)=>paintCar470(c,w,h,k,nums[k]));TEX470[k].anisotropy=8;});
  TEX470.door=canvasTex(64,160,(c,w,h)=>paintDoor470(c,w,h,false));TEX470.doorM=canvasTex(64,160,(c,w,h)=>paintDoor470(c,w,h,true));
  const mk=(t,hex)=>{const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,hex||0xEEEDE8);return m;};
  TEX470.mat={M:mk(TEX470.M),R:mk(TEX470.R),Rc:mk(TEX470.Rc),door:mk(TEX470.door),doorM:mk(TEX470.doorM)};
  /* cab side windows (the end ones of the unit) stay dark: only the saloons light up */
  const cab470=k=>(c,W,H)=>{const LY=layout470(k,k==='R'?R470.LR:R470.LM),Lb=LY.zf-LY.zb,X=z=>(z-LY.zb)/Lb*W,Y=(y,s)=>(1-v470(y,s))*H;if(!LY.cab)return;
    c.fillStyle='#000';[LY.cabWin,LY.doorWin].forEach(w=>[-1,1].forEach(s=>{const ya=Y(1.85,s),yb=Y(3.10,s);c.fillRect(X(w[0]-0.12),Math.min(ya,yb),X(w[1]+0.12)-X(w[0]-0.12),Math.abs(yb-ya));}));};
  /* the vestibule behind each doorway is lit too: hidden by the leaves when shut, it glows when they slide open */
  const way470=k=>(c,W,H)=>{const LY=layout470(k,k==='R'?R470.LR:R470.LM),Lb=LY.zf-LY.zb,X=z=>(z-LY.zb)/Lb*W,Y=(y,s)=>(1-v470(y,s))*H;
    LY.doors.forEach(zc=>[-1,1].forEach(s=>{const ya=Y(3.16,s),yb=Y(1.05,s),gr=c.createLinearGradient(0,ya,0,yb);
      gr.addColorStop(0,'rgb(255,236,204)');gr.addColorStop(0.5,'rgb(200,184,158)');gr.addColorStop(1,'rgb(120,110,94)');
      c.fillStyle=gr;c.fillRect(X(zc-0.80),Math.min(ya,yb),X(zc+0.80)-X(zc-0.80),Math.abs(yb-ya));}));};
  ['M','R','Rc'].forEach(k=>litSaloon(TEX470.mat[k],TEX470[k],[LIV.glass,LIV.glass2,LIV.glass3],(c,W,H)=>{cab470(k)(c,W,H);way470(k)(c,W,H);}));
  ['door','doorM'].forEach(k=>litSaloon(TEX470.mat[k],TEX470[k],[LIV.glass,LIV.glass2]));
  TEX470.solid={dark:tmat(0x1E2226),grey:tmat(0x7A8084),bogie:tmat(0x4A4F53),wheel:tmat(0x3A3C3E),roof2:tmat(0x737A7E),mesh:tmat(0x4E5356),panto:tmat(0x4B4F53),
    bellows:tmat(0x3A3E42),hose:tmat(0xC2482A),lampOffW:tmat(0xD8D8D2),lampOffR:tmat(0x6A1E1A)};
  TEX470.solid.lightW=new THREE.MeshBasicMaterial({color:0xFFF7DC,clippingPlanes:CLIP});MAT_HEX.set(TEX470.solid.lightW,0xFFF7DC);
  TEX470.solid.lightR=new THREE.MeshBasicMaterial({color:0xFF2E1F,clippingPlanes:CLIP});MAT_HEX.set(TEX470.solid.lightR,0xFF2E1F);
  TEX470.ready=true;return TEX470;
}
function frontMat470(num,dest){
  const t=canvasTex(512,512,(c,w,h)=>paintFront470(c,w,h,num,dest));t.anisotropy=4;
  const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,0xE8521F);return m;
}
function geoFromArrays(A){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(A.pos,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(A.uv,2));
  g.setIndex(A.idx);g.computeVertexNormals();return g;
}
/* ---- three.js car: outer group (placed by the sim) → inner group (cab orientation) ---- */
function build470(tr,sp,lead){
  const T=tex470(),P=parts470(sp.kind,lead,false);
  const g=new THREE.Group(),inner=new THREE.Group();if(sp.cab<0)inner.rotation.y=PI;g.add(inner);
  const body=[];
  Object.keys(P.M).forEach(key=>{
    let mat;if(key==='side')mat=T.mat[sp.kind];else if(key==='front')mat=(tr.frontMats||(tr.frontMats={}))[sp.kind]||(tr.frontMats[sp.kind]=frontMat470(sp.kind==='M'?'129M':'135C',tr.svc.to));else mat=T.solid[key];
    const m=new THREE.Mesh(geoFromArrays(P.M[key]),mat);m.castShadow=key!=='lightW'&&key!=='lightR';m.receiveShadow=true;inner.add(m);
    if(key==='side'||key==='front'){m.userData.ent=tr.ent;body.push(m);}
  });
  scharfHang(inner,P.sch);
  const leaves=[];
  P.doors.forEach(d=>{const m=new THREE.Mesh(geoFromArrays(d.A),d.mirror?T.mat.doorM:T.mat.door);m.position.set(d.x,d.y,d.z);m.rotation.y=d.side>0?PI/2:-PI/2;m.castShadow=true;inner.add(m);
    m.userData.door={x0:d.x,z0:d.z,side:d.side,slide:d.slide,open:0,t:0};leaves.push(m);});
  const doorZ=P.layout.doors.map(z=>sp.cab<0?-z:z);
  const pools=[];P.layout.doors.forEach(zc=>[-1,1].forEach(s=>{const mat=NIGHT.pool.clone();mat.opacity=0;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(2.1,2.6),mat);m.rotation.x=-PI/2;m.position.set(s*(R470.HALF+1.05),0.565,zc);m.renderOrder=2;m.visible=false;inner.add(m);
    pools.push({m:m,lv:leaves.filter(l=>l.userData.door.side===s&&Math.abs(l.userData.door.z0-zc)<0.6)});}));
  return{g:g,inner:inner,L:sp.L,body:body,doorZ:doorZ,leaves:leaves,pools:pools,kind:sp.kind};
}
function animDoors470(c,dt){
  c.leaves.forEach(m=>{const d=m.userData.door;const k=1-Math.exp(-dt*3.2);d.t+=(d.open-d.t)*k;
    m.position.z=d.z0+d.slide*0.74*d.t;m.position.x=d.x0+d.side*0.05*d.t;});
  if(c.pools)c.pools.forEach(p=>{const t=p.lv.length?p.lv.reduce((a,l)=>a+l.userData.door.t,0)/p.lv.length:0,o=0.6*NIGHT.N*t;
    p.m.material.opacity=o;p.m.visible=o>0.01;});
}
/* ---------------------------------------------------------------------
   Renfe serie 269 · librea amarilla y gris (modelo procedural fiel)
   Cotas: longitud entre topes 17,270 m · ancho 3,126 · altura de caja 3,68
   (4,26 con pantógrafos plegados) · ruedas 1,250 · B'B' monomotor
   bi-reductor (80/140 km/h) · 88 t · 3.100 kW. Distancia entre pivotes
   ≈ 9,0 m y empate ≈ 2,8 m (estimados sobre fotos; la ficha no los da).
   Testero (fotos 269-408 / 216 / 104): dos lunas con junta de goma, faro
   doble en el techo, cuatro focos redondos (blancos fuera, rojos dentro),
   toma de calefacción y manguera colgada, topes redondos, gancho con husillo,
   mangueras de freno y cuñas quitapiedras. Esquinas de caja redondeadas en
   planta sobre una traviesa de topes recta.
   --------------------------------------------------------------------- */
const PROF269=(function(){
  const h=[[1.40,0.98],[1.48,1.18],[1.563,1.28],[1.563,1.95],[1.563,2.60],[1.563,3.10],[1.563,3.32],[1.53,3.46],[1.44,3.56],[1.28,3.63],[1.02,3.665],[0.55,3.675],[0,3.68]];
  const n=h.length;
  const pts=[];for(let i=0;i<n;i++)pts.push([-h[i][0],h[i][1]]);for(let i=n-2;i>=0;i--)pts.push([h[i][0],h[i][1]]);
  const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  const tot=cum[cum.length-1];
  return{h:h,n:n,pts:pts,v:cum.map(c=>c/tot),tot:tot,top:3.68};
})();
/* texture v for any half profile (0 at the left bottom, 0.5 at the apex, 1 at the right bottom) */
function vProf(P,y,side){
  const h=P.h;
  for(let i=1;i<P.n;i++){const a=h[i-1],b=h[i];
    if(y<=b[1]||i===P.n-1){const t=clamp((y-a[1])/((b[1]-a[1])||1),0,1);const v=lerp(P.v[i-1],P.v[i],t);return side<0?v:1-v;}}
  return 0.5;
}
/* forehead: vertical face up to the windscreen top, then a rounded sweep into the roof */
function rake269(y){return y<=3.42?0:0.36*Math.pow((y-3.42)/0.26,1.6);}
/* plan-view corner (r = 0.38 m) on the body only; the headstock below 1.27 m stays square */
function corner269(x,y){if(y<1.27)return 0;const r=0.38,d=Math.abs(x)-(R269.HALF-r);return d<=0?0:r-Math.sqrt(Math.max(0,r*r-d*d));}
function faceZ269(x,y){return R269.ZF-corner269(x,y)-rake269(y);}
function ring269(z,u){return{u:u,pts:PROF269.pts.map(p=>[p[0],p[1],z])};}
function ringEnd269(e,u){return{u:u,pts:PROF269.pts.map(p=>[p[0],p[1],e*faceZ269(p[0],p[1])])};}
/* end cap as a grid: columns denser near the sides so the rounded corner reads as a curve */
const CAPF269=[-1,-0.985,-0.94,-0.86,-0.75,-0.55,-0.3,0,0.3,0.55,0.75,0.86,0.94,0.985,1];
function capGrid269(e,uvFn){const A=arrNew(),h=PROF269.h,F=CAPF269,N=F.length-1,rows=[];
  h.forEach(l=>{const xm=l[0],y=l[1],row=[];F.forEach(f=>{const x=xm*f,z=e*faceZ269(x,y);row.push(A.pos.length/3);A.pos.push(x,y,z);const t=uvFn([x,y,z]);A.uv.push(t[0],t[1]);});rows.push(row);});
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<N;i++){const a=rows[j][i],b=rows[j][i+1],c=rows[j+1][i+1],d=rows[j+1][i];
    if(e>0)A.idx.push(a,b,c,a,c,d);else A.idx.push(a,c,b,a,d,c);}
  return A;}
/* ---- parts for the locomotive; +z is the leading end (white lamps), -z the trailing one (red) ---- */
function parts269(){
  const ZF=R269.ZF,HALF=R269.HALF,zb=-ZF,Lb=2*ZF;
  const M={};const add=(key,A)=>{if(!M[key])M[key]=arrNew();arrPush(M[key],A);};
  const u=z=>(z-zb)/Lb;
  // body loft: straight between the two end rings, which already carry the corner and forehead setbacks
  add('side',loft([ringEnd269(-1,0),ring269(zb+0.75,u(zb+0.75)),ring269(ZF-0.75,u(ZF-0.75)),ringEnd269(1,1)],PROF269));
  add('front',capGrid269(1,p=>[(p[0]+HALF)/R269.W,(p[1]-R269.BOT)/(R269.TOP-R269.BOT)]));
  add('front',capGrid269(-1,p=>[(HALF-p[0])/R269.W,(p[1]-R269.BOT)/(R269.TOP-R269.BOT)]));
  // underframe: closing plate, main equipment box between the bogies, battery/step boxes near the ends
  add('dark',boxA(0,0.90,0,2.76,0.09,Lb-0.2));
  add('grey',boxA(0,0.45,0,2.40,0.50,4.6));add('dark',boxA(0,0.40,0,2.30,0.06,4.4));
  [-1,1].forEach(e=>{[-1,1].forEach(s=>{add('grey',boxA(s*0.95,0.62,e*7.1,0.5,0.34,0.9));});});
  // bogies: Mitsubishi monomotor B, wheelbase 2.8, wheels 1.250
  [-R269.BOG,R269.BOG].forEach(zc=>{const a0=R269.WB/2;
    [-1,1].forEach(s=>{add('bogie',boxA(s*1.08,0.52,zc,0.18,0.36,3.9));add('bogie',boxA(s*1.08,0.88,zc,0.30,0.10,2.4));add('bogie',boxA(s*1.08,0.30,zc,0.14,0.10,3.3));
      [-a0,a0].forEach(a=>{add('wheel',cylA(s*0.80,R269.RW,zc+a,R269.RW,0.14,16,0,0,PI/2));add('bogie',boxA(s*1.08,0.45,zc+a,0.36,0.40,0.42));add('bogie',cylA(s*1.08,0.98,zc+a,0.13,0.22,8));});
      [-1,1].forEach(k=>add('bogie',boxA(s*0.95,0.70,zc+k*2.05,0.26,0.30,0.22)));});
    [-a0,a0].forEach(a=>add('bogie',cylA(0,R269.RW,zc+a,0.08,1.6,6,0,0,PI/2)));
    add('bogie',boxA(0,0.42,zc,2.0,0.55,1.3));add('bogie',boxA(0,0.95,zc,2.3,0.14,0.5));
  });
  // roof: rheostat grille box, auxiliary box, insulators, roof cable, two pantographs (rear one raised)
  add('mesh',boxA(0,3.68,-2.2,1.4,0.34,2.2));add('roof2',boxA(0,3.68,-2.2,1.5,0.06,2.3));
  add('roof2',boxA(0,3.68,1.6,1.0,0.16,1.6));
  [-3.9,3.9].forEach(z=>[-0.5,0.5].forEach(x=>add('dark',cylA(x,3.76,z,0.06,0.16,8))));
  add('dark',rodA([0.62,3.76,-4.0],[0.62,3.76,4.0],0.035));
  add('panto',pantoA(5.0,5.26,true,-0.25));
  add('panto',pantoA(-5.0,5.26,false,-0.25));
  // both ends
  [1,-1].forEach(e=>{const lead=e>0;
    const fz=(x,y)=>faceZ269(x,y);
    // twin headlamp housing on the roof front
    add('yellow',boxA(0,3.60,e*(ZF-0.30),0.70,0.36,0.46));add('dark',boxA(0,3.96,e*(ZF-0.26),0.74,0.03,0.54));
    [-0.17,0.17].forEach(x=>{add('dark',cylA(x,3.79,e*(ZF-0.06),0.12,0.04,12,PI/2,0,0));add(lead?'lightW':'lampOffW',cylA(x,3.79,e*(ZF-0.035),0.095,0.03,12,PI/2,0,0));});
    // four round lamps: white outer pair, red inner pair
    [-0.92,0.92].forEach(x=>{add('grey',cylA(x,1.76,e*(fz(x,1.76)-0.03),0.15,0.07,12,PI/2,0,0));add(lead?'lightW':'lampOffW',cylA(x,1.76,e*(fz(x,1.76)+0.025),0.115,0.03,12,PI/2,0,0));});
    [-0.46,0.46].forEach(x=>{add('grey',cylA(x,1.76,e*(fz(x,1.76)-0.03),0.15,0.07,12,PI/2,0,0));add(lead?'lampOffR':'lightR',cylA(x,1.76,e*(fz(x,1.76)+0.025),0.115,0.03,12,PI/2,0,0));});
    // amber marker lamps at the corners under the windscreens
    [-1.33,1.33].forEach(x=>{add('dark',boxA(x,2.66,e*(fz(x,2.72)-0.01),0.16,0.12,0.06));add('lampAmb',boxA(x,2.68,e*(fz(x,2.72)+0.03),0.12,0.08,0.02));});
    // train-heating socket (right) and the cable hanging from its hook (left)
    add('dark',cylA(e*0.85,2.12,e*(fz(0.85,2.12)+0.02),0.14,0.09,12,PI/2,0,0));add('grey',cylA(e*0.85,2.12,e*(fz(0.85,2.12)+0.07),0.10,0.02,12,PI/2,0,0));
    add('dark',boxA(e*-1.27,2.48,e*(fz(-1.27,2.48)+0.03),0.10,0.10,0.08));
    const cab=[[-1.27,2.48],[-1.31,2.10],[-1.16,1.72],[-0.88,1.70],[-0.64,1.94]];
    for(let i=0;i<cab.length-1;i++)add('cable',rodA([e*cab[i][0],cab[i][1],e*(fz(cab[i][0],cab[i][1])+0.06)],[e*cab[i+1][0],cab[i+1][1],e*(fz(cab[i+1][0],cab[i+1][1])+0.06)],0.045));
    add('dark',cylA(e*-0.62,2.00,e*(fz(-0.62,2.00)+0.06),0.05,0.10,8,PI/2,0,0));
    // wipers pivoting at the outer top corner of each pane
    [-1,1].forEach(s=>add('dark',rodA([s*1.12,3.40,e*(fz(s*1.12,3.40)+0.008)],[s*0.82,2.90,e*(fz(s*0.82,2.90)+0.008)],0.03)));
    // buffers: base plate on the headstock, sleeve, round head
    [-0.875,0.875].forEach(x=>{add('grey',boxA(x,0.80,e*ZF,0.48,0.50,0.06));add('dark',cylA(x,1.05,e*(ZF+0.22),0.13,0.44,10,PI/2,0,0));add('bogie',cylA(x,1.05,e*(ZF+0.465),0.225,0.05,14,PI/2,0,0));});
    // hook with the screw coupling hanging, brake hoses
    add('dark',boxA(0,0.95,e*(ZF+0.18),0.16,0.22,0.36));add('dark',boxA(0,0.90,e*(ZF+0.42),0.30,0.12,0.12));
    add('dark',rodA([0,1.02,e*(ZF+0.30)],[0,0.58,e*(ZF+0.26)],0.05));add('dark',boxA(0,0.52,e*(ZF+0.26),0.22,0.08,0.08));
    [-1,1].forEach(s=>{add('hose',rodA([s*0.34,1.00,e*(ZF+0.04)],[s*0.42,0.62,e*(ZF+0.28)],0.04));add('dark',boxA(s*0.42,0.52,e*(ZF+0.28),0.09,0.12,0.09));});
    // stone-guard wedges (angled back towards the sides) and the central plate
    [-1,1].forEach(s=>add('grey',boxA(s*0.92,0.38,e*(ZF-0.02),1.05,0.56,0.06,0,e*s*0.42,0)));
    add('dark',boxA(0,0.36,e*(ZF-0.10),0.46,0.40,0.05));
    // corner steps, yellow corner handrails, cab door handles
    [-1,1].forEach(s=>{add('grey',boxA(s*1.33,0.52,e*(ZF-0.28),0.40,0.04,0.28));add('grey',boxA(s*1.33,0.78,e*(ZF-0.28),0.40,0.04,0.28));
      add('yellow',rodA([s*(HALF+0.035),1.50,e*(ZF-0.50)],[s*(HALF+0.035),3.20,e*(ZF-0.50)],0.035));
      add('dark',boxA(s*(HALF+0.02),2.0,e*(ZF-2.33),0.03,0.16,0.05));});
  });
  return{M:M,L:R269.L};
}
/* ---- livery: Renfe yellow and grey ("taxi"), yellow cabs and roof band over a grey body; same yellow and charcoal as the 252 ---- */
const LIV269={yellow:'#EFC501',grey:'#2C2C2E',frame:'#7E8588',roof:'#8E9497',glass:'#262B30',glass2:'#55606A',rubber:'#141618',louvre:'#1C1D1F',louvre2:'#3E4144',white:'#F2F2EE',beam:'#7A8185',num:'#1A1A1A'};
const NUM269={big:'269',small:'104',uic:'269-104-6'};
function paintCar269(c,W,H){
  const P=PROF269,zf=R269.ZF,zb=-zf,Lb=2*zf;
  const X=z=>(z-zb)/Lb*W,Y=(y,s)=>(1-vProf(P,y,s))*H;
  const kx=(W/Lb)/(H/(2*P.tot)); /* text: pre-stretch so it reads undistorted on the model */
  const rect=(y0,y1,z0,z1,col)=>{c.fillStyle=col;[-1,1].forEach(s=>{const ya=Y(y0,s),yb=Y(y1,s);c.fillRect(X(z0),Math.min(ya,yb),Math.max(1,X(z1)-X(z0)),Math.abs(yb-ya)+0.7);});};
  c.fillStyle=LIV269.grey;c.fillRect(0,0,W,H);
  rect(0.98,1.28,zb,zf,LIV269.frame);rect(1.26,1.29,zb,zf,'rgba(0,0,0,.35)');
  rect(3.22,3.66,zb,zf,LIV269.yellow);rect(3.655,3.68,zb+3.45,zf-3.45,LIV269.roof);
  rect(3.21,3.235,zb+3.45,zf-3.45,'rgba(0,0,0,.18)');
  c.fillStyle='rgba(0,0,0,.10)';for(let z=zb+2;z<zf-1;z+=2)rect(3.655,3.68,z-0.012,z+0.012,'rgba(0,0,0,.10)');
  [[zf-3.45,zf+0.5],[zb-0.5,zb+3.45]].forEach(r=>rect(1.28,3.68,r[0],r[1],LIV269.yellow));
  [1,-1].forEach(e=>{
    const span=(d0,d1)=>e>0?[zf-d1,zf-d0]:[zb+d0,zb+d1];
    let w=span(0.85,1.65);rect(2.70,3.33,w[0]-0.05,w[1]+0.05,LIV269.rubber);rect(2.76,3.27,w[0],w[1],LIV269.glass);rect(3.05,3.27,w[0],w[1],LIV269.glass2);
    rect(2.76,3.27,(w[0]+w[1])/2-0.02,(w[0]+w[1])/2+0.02,LIV269.rubber);
    w=span(2.27,3.15);rect(1.30,3.30,w[0]-0.015,w[0]+0.015,'rgba(0,0,0,.40)');rect(1.30,3.30,w[1]-0.015,w[1]+0.015,'rgba(0,0,0,.40)');rect(3.28,3.31,w[0],w[1],'rgba(0,0,0,.40)');rect(1.30,1.33,w[0],w[1],'rgba(0,0,0,.40)');
    const dw=span(2.37,3.05);rect(2.45,3.24,dw[0]-0.04,dw[1]+0.04,LIV269.rubber);rect(2.50,3.19,dw[0],dw[1],LIV269.glass);rect(2.90,3.19,dw[0],dw[1],LIV269.glass2);
    w=span(3.70,4.25);rect(2.42,3.08,w[0]-0.04,w[1]+0.04,LIV269.rubber);rect(2.47,3.03,w[0],w[1],LIV269.glass);rect(2.80,3.03,w[0],w[1],LIV269.glass2);
  });
  [-3.0,-1.5,0,1.5,3.0].forEach(zc=>{rect(2.12,3.14,zc-0.55,zc+0.55,LIV269.louvre);for(let y=2.17;y<3.10;y+=0.09)rect(y,y+0.035,zc-0.52,zc+0.52,LIV269.louvre2);});
  rect(1.99,2.015,zb+3.45,zf-3.45,'rgba(0,0,0,.22)');
  // series number '269' exactly as the 252's: same lettering (Barlow 700 fitted to a 2.34 × 1.04 m box), same colour,
  // baseline 1.45 m, starting 0.76 m after the cab back near cab 2 on the left side and near cab 1 on the right; UIC number near the middle
  [-1,1].forEach(s=>{const py=H/(2*P.tot);
    const z0=s<0?-(zf-3.45-0.76):(zf-3.45-0.76),z1=z0-s*2.34,zs=Math.min(z0,z1);
    c.textBaseline='alphabetic';c.font='700 200px "Barlow",system-ui,sans-serif';const m=c.measureText(NUM269.big),tw=m.width,cap=m.actualBoundingBoxAscent||140;
    const wpx=Math.abs(X(z1)-X(z0)),hpx=Math.abs(Y(1.45,s)-Y(2.49,s));
    c.save();c.translate(X(s<0?zs:zs+2.34),Y(1.45,s));c.scale(s>0?-1:1,s>0?-1:1);c.scale(wpx/tw,hpx/cap);
    c.fillStyle='#DEDEDC';c.textAlign='left';c.textBaseline='alphabetic';c.fillText(NUM269.big,0,0);c.restore();
    c.textBaseline='middle';
    c.save();c.translate(X(s<0?zf-7.4:zb+7.4),Y(1.55,s));c.scale(s>0?-kx:kx,s>0?-1:1);c.fillStyle=LIV269.white;
    c.font='500 '+Math.round(py*0.15)+'px "IBM Plex Mono",monospace';c.textAlign='center';c.fillText(NUM269.uic,0,0);c.restore();});
}
function paintFront269(c,W,H){
  const U=x=>(x+R269.HALF)/R269.W*W,V=y=>(1-(y-R269.BOT)/(R269.TOP-R269.BOT))*H;
  c.fillStyle=LIV269.yellow;c.fillRect(0,0,W,H);
  // headstock (light grey) with a dark shadow line under the body
  c.fillStyle=LIV269.beam;c.fillRect(0,V(1.42),W,H-V(1.42));
  c.fillStyle='#2A2E31';c.fillRect(0,V(1.47),W,V(1.40)-V(1.47));
  // two windscreens with rubber seals and a central pillar
  const g=c.createLinearGradient(0,V(3.435),0,V(2.845));g.addColorStop(0,'#7E8E9B');g.addColorStop(0.35,'#4C5962');g.addColorStop(1,'#1E252A');
  [[-1.27,-0.14],[0.14,1.27]].forEach(p=>{
    c.fillStyle=LIV269.rubber;c.beginPath();const x0=U(p[0]-0.045),x1=U(p[1]+0.045),y0=V(3.48),y1=V(2.80);if(c.roundRect)c.roundRect(x0,y0,x1-x0,y1-y0,14);else c.rect(x0,y0,x1-x0,y1-y0);c.fill();
    c.fillStyle=g;c.beginPath();const gx0=U(p[0]),gx1=U(p[1]),gy0=V(3.435),gy1=V(2.845);if(c.roundRect)c.roundRect(gx0,gy0,gx1-gx0,gy1-gy0,10);else c.rect(gx0,gy0,gx1-gx0,gy1-gy0);c.fill();
    c.fillStyle='rgba(255,255,255,.12)';c.fillRect(gx0+6,gy0+4,gx1-gx0-12,4);});
  // running number between the inner lamps
  c.save();c.translate(U(0),V(1.58));c.scale((W/R269.W)/(H/(R269.TOP-R269.BOT)),1);
  c.fillStyle=LIV269.num;c.font='600 '+Math.round(H*0.045)+'px "Barlow",system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(NUM269.uic,0,0);c.restore();
  // panel joints
  c.fillStyle='rgba(0,0,0,.14)';c.fillRect(0,V(2.32),W,2);c.fillRect(0,V(3.52),W,2);
}
/* ---- textures and materials (shared by every 269) ---- */
const TEX269={};
function tex269(){
  if(TEX269.ready)return TEX269;
  const base=tex470();
  TEX269.car=canvasTex(2048,512,(c,w,h)=>paintCar269(c,w,h));TEX269.car.anisotropy=8;
  TEX269.front=canvasTex(512,512,(c,w,h)=>paintFront269(c,w,h));TEX269.front.anisotropy=4;
  const mk=(t,hex)=>{const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,hex);return m;};
  TEX269.side=mk(TEX269.car,0x2C2C2E);TEX269.frontMat=mk(TEX269.front,0xEFC501);
  TEX269.solid=Object.assign({},base.solid,{yellow:tmat(0xEFC501),cable:tmat(0x15171A)});
  TEX269.solid.lampAmb=new THREE.MeshBasicMaterial({color:0xF2A33A,clippingPlanes:CLIP});MAT_HEX.set(TEX269.solid.lampAmb,0xF2A33A);
  TEX269.ready=true;return TEX269;
}
function build269(tr,sp){
  const T=tex269(),P=parts269();
  const g=new THREE.Group(),body=[];
  Object.keys(P.M).forEach(key=>{const mat=key==='side'?T.side:(key==='front'?T.frontMat:T.solid[key]);
    const m=new THREE.Mesh(geoFromArrays(P.M[key]),mat);m.castShadow=!/^light/.test(key);m.receiveShadow=true;g.add(m);
    if(key==='side'||key==='front'){m.userData.ent=tr.ent;body.push(m);}});
  return{g:g,L:sp.L,body:body};
}
/* ---------------------------------------------------------------------
   Renfe serie 252 · librea amarilla y gris "taxi" · low poly sacada del modelo LM3D (Trainz)
   La forma está medida sobre la malla del modelo por ray-casting: siete secciones de caja
   (centro, trasera de cabina con el escalón del techo, cabina) y la superficie del testero en
   una rejilla de 16 filas × 15 columnas. Lunas, puerta, rejillas, números y equipos de techo
   se han leído de sus alzados ortogonales. Ancho llevado a los 3,00 m de la ficha (el modelo
   mide 3,35): SX252 escala todas las x medidas. Bogies de la ficha: pivotes a 10,50 m, empate
   3,00, ruedas 1,250. Se omiten los logotipos de Renfe.
   --------------------------------------------------------------------- */
const SX252=3.00/3.348;
/* front half, model units (x unscaled); the rear end is the same turned round (z → -z) */
const T252={
  rings:[
    {z:0,p:[[1.674,0.88],[1.674,1.3],[1.664,2],[1.645,2.6],[1.63,3],[1.614,3.15],[1.5,3.291],[1.45,3.373],[1.4,3.44],[1.3,3.607],[1.2,3.734],[1.1,3.738],[0.9,3.742],[0.6,3.746],[0.3,3.75],[0,3.754]]},
    {z:6.55,p:[[1.674,0.88],[1.674,1.3],[1.664,2],[1.645,2.6],[1.63,3],[1.614,3.15],[1.5,3.291],[1.45,3.373],[1.4,3.44],[1.3,3.607],[1.2,3.734],[1.1,3.738],[0.9,3.742],[0.6,3.746],[0.3,3.75],[0,3.754]]},
    {z:7.04,p:[[1.658,0.86],[1.658,1.3],[1.625,2],[1.601,2.6],[1.585,3],[1.587,3.15],[1.5,3.291],[1.45,3.373],[1.4,3.44],[1.3,3.607],[1.2,3.734],[1.1,3.738],[0.9,3.742],[0.6,3.746],[0.3,3.75],[0,3.754]]},
    {z:7.1,p:[[1.64,0.85],[1.64,1.3],[1.58,2],[1.575,2.6],[1.559,3],[1.567,3.15],[1.5,3.261],[1.45,3.339],[1.4,3.42],[1.3,3.59],[1.2,3.73],[1.1,3.781],[0.9,3.873],[0.6,3.965],[0.3,3.994],[0,4.037]]},
    {z:7.6,p:[[1.64,0.78],[1.64,1.3],[1.58,2],[1.575,2.6],[1.559,3],[1.567,3.15],[1.5,3.261],[1.45,3.339],[1.4,3.42],[1.3,3.59],[1.2,3.73],[1.1,3.781],[0.9,3.873],[0.6,3.965],[0.3,3.994],[0,4.037]]},
    {z:8.3,p:[[1.62,0.72],[1.62,1.3],[1.609,2],[1.547,2.6],[1.52,3],[1.534,3.15],[1.5,3.212],[1.45,3.294],[1.4,3.376],[1.3,3.536],[1.2,3.698],[1.1,3.763],[0.9,3.861],[0.6,3.934],[0.3,3.944],[0,3.951]]},
    {z:8.9,p:[[1.581,0.7],[1.581,1.3],[1.571,2],[1.532,2.6],[1.508,3],[1.494,3.15],[1.494,3.154],[1.45,3.226],[1.4,3.305],[1.3,3.449],[1.2,3.581],[1.1,3.702],[0.9,3.788],[0.6,3.847],[0.3,3.855],[0,3.859]]}],
  end:[9.307,9.307,9.097,9.059,8.991,8.961,8.958,8.945,8.927,8.919,8.911,8.905,8.902,8.9,8.902,8.9],
  cap:[
    [9.307,9.42,9.553,9.638,9.701,9.737,9.765,9.777,9.765,9.737,9.701,9.638,9.553,9.42,9.307],
    [9.307,9.42,9.553,9.638,9.701,9.737,9.765,9.777,9.765,9.737,9.701,9.638,9.553,9.42,9.307],
    [9.034,9.49,9.627,9.714,9.778,9.815,9.843,9.855,9.843,9.815,9.778,9.714,9.627,9.49,9.097],
    [9.054,9.256,9.378,9.458,9.52,9.541,9.566,9.598,9.566,9.541,9.52,9.458,9.378,9.256,9.059],
    [8.963,9.082,9.202,9.281,9.343,9.372,9.398,9.421,9.398,9.372,9.343,9.281,9.202,9.082,8.991],
    [8.96,9.031,9.142,9.217,9.277,9.308,9.336,9.355,9.336,9.308,9.277,9.217,9.142,9.031,8.961],
    [8.956,9.028,9.14,9.215,9.276,9.306,9.334,9.353,9.334,9.306,9.276,9.215,9.14,9.029,8.958],
    [8.945,9.01,9.112,9.184,9.244,9.289,9.315,9.323,9.315,9.289,9.244,9.184,9.112,9.01,8.945],
    [8.927,8.989,9.081,9.15,9.21,9.242,9.27,9.281,9.27,9.242,9.21,9.15,9.081,8.989,8.927],
    [8.919,8.959,9.031,9.093,9.15,9.179,9.206,9.206,9.206,9.179,9.15,9.093,9.031,8.959,8.919],
    [8.911,8.941,8.993,9.048,9.093,9.123,9.148,9.16,9.148,9.123,9.093,9.048,8.993,8.941,8.911],
    [8.905,8.92,8.96,9.007,9.043,9.072,9.096,9.106,9.096,9.072,9.043,9.007,8.96,8.92,8.905],
    [8.902,8.911,8.937,8.97,8.986,9.013,9.033,9.041,9.033,9.013,8.986,8.97,8.937,8.911,8.902],
    [8.9,8.9,8.905,8.913,8.924,8.937,8.949,8.953,8.949,8.937,8.924,8.913,8.905,8.9,8.9],
    [8.902,8.902,8.903,8.905,8.908,8.913,8.916,8.916,8.916,8.913,8.908,8.905,8.903,8.902,8.902],
    [8.9,8.9,8.9,8.9,8.9,8.9,8.9,8.9,8.9,8.9,8.9,8.9,8.9,8.9,8.9]]};
const CAPF252=[-1,-0.985,-0.94,-0.86,-0.75,-0.55,-0.3,0,0.3,0.55,0.75,0.86,0.94,0.985,1];
/* lower edge of the yellow cab side: one straight line from the cab back (0.88, level with the hood) to the face
   plane (z 9.307, 0.76); under it the black stone-guard skirt, flush with the side */
const FACEBOT252=0.76,CABZ252=6.55;
function bot252(z){z=Math.abs(z);if(z<=CABZ252)return 0.88;return 0.88-(0.88-FACEBOT252)*clamp((z-CABZ252)/(9.307-CABZ252),0,1);}
/* straight sides: the cab walls carry on the hood walls (the 3-6 cm inset the probes found at the cab back
   came off the hood grille frames), then close in smoothly towards the nose as the model does */
(function(){const H=T252.rings[0].p,TP=[[7.04,0],[7.1,0],[7.6,0.012],[8.3,0.045],[8.9,0.093]];
  const tap=z=>{for(let i=1;i<TP.length;i++)if(z<=TP[i][0])return TP[i-1][1]+(TP[i][1]-TP[i-1][1])*(z-TP[i-1][0])/(TP[i][0]-TP[i-1][0]);return TP[TP.length-1][1];};
  T252.rings.forEach(r=>{if(r.z<7.0)return;const d=tap(r.z);for(let k=1;k<=5;k++)r.p[k][0]=H[k][0]-d;r.p[0][0]=r.p[1][0];r.p[0][1]=bot252(r.z);});})();
const LAST252=T252.rings[T252.rings.length-1].p;
/* texture v along the contour (left bottom 0 → apex 0.5 → right bottom 1), from the centre section */
const PV252=(function(){const p=T252.rings[0].p,pts=[];for(let k=0;k<16;k++)pts.push([-p[k][0]*SX252,p[k][1]]);for(let k=14;k>=0;k--)pts.push([p[k][0]*SX252,p[k][1]]);
  const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));return cum.map(c=>c/cum[cum.length-1]);})();
/* at the faces the bottom edge rises to the headstock (1.16 m): below it the nose is open (coupler, buffers, plough) */
const YH252=1.16;
function ring252(p,zf,face){const y=k=>face&&k===0?FACEBOT252:p[k][1],pts=[];for(let k=0;k<16;k++)pts.push([-p[k][0]*SX252,y(k),zf(k)]);for(let k=14;k>=0;k--)pts.push([p[k][0]*SX252,y(k),zf(k)]);return pts;}
function rings252(){const R=T252.rings,F=[];
  F.push(ring252(LAST252,k=>-T252.end[k],true));
  for(let i=R.length-1;i>=1;i--)F.push(ring252(R[i].p,()=>-R[i].z));
  for(let i=0;i<R.length;i++)F.push(ring252(R[i].p,()=>R[i].z));
  F.push(ring252(LAST252,k=>T252.end[k],true));return F;}
/* body: one loft from face to face; u follows the real z of every vertex, so the livery is painted in metres */
function body252(){const A=arrNew(),F=rings252(),n=F[0].length,ZE=R252.ZE;
  F.forEach(r=>r.forEach((p,j)=>{A.pos.push(p[0],p[1],p[2]);A.uv.push((p[2]+ZE)/(2*ZE),PV252[j]);}));
  for(let i=0;i<F.length-1;i++)for(let j=0;j<n-1;j++){const a=i*n+j,b=i*n+j+1,c=(i+1)*n+j+1,d=(i+1)*n+j;A.idx.push(a,c,b,a,d,c);}
  return A;}
/* nose: the measured face grid (rows = contour points of the last section, columns across) */
function cap252(e){const A=arrNew(),rows=[];
  LAST252.forEach((l,j)=>{const xm=l[0]*SX252,y=j?l[1]:YH252,row=[];
    CAPF252.forEach((f,i)=>{const x=xm*f;row.push(A.pos.length/3);A.pos.push(x,y,e*T252.cap[j][i]);A.uv.push(((e>0?x:-x)+R252.HALF)/R252.W,(y-R252.BOT)/(R252.TOP-R252.BOT));});rows.push(row);});
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<CAPF252.length-1;i++){const a=rows[j][i],b=rows[j][i+1],c=rows[j+1][i+1],d=rows[j+1][i];
    if(e>0)A.idx.push(a,b,c,a,c,d);else A.idx.push(a,c,b,a,d,c);}
  return A;}
/* z of the face grid at (x,y), so lamps and handles sit on the mesh */
function surf252(x,y){const p=LAST252,F=CAPF252;let j=0;while(j<p.length-2&&y>p[j+1][1])j++;
  const rowZ=k=>{const xm=p[k][0]*SX252;if(xm<1e-6)return T252.cap[k][7];const f=clamp(x/xm,-1,1);let i=0;while(i<F.length-2&&f>F[i+1])i++;
    return lerp(T252.cap[k][i],T252.cap[k][i+1],(f-F[i])/(F[i+1]-F[i]));};
  return lerp(rowZ(j),rowZ(j+1),clamp((y-p[j][1])/((p[j+1][1]-p[j][1])||1),0,1));}
/* ---- parts; +z is the leading end (cab 1) ---- */
function parts252(){
  const HALF=R252.HALF,ZF=R252.ZF,X=x=>x*SX252;
  const M={};const add=(key,A)=>{if(!M[key])M[key]=arrNew();arrPush(M[key],A);};
  add('side',body252());add('front',cap252(1));add('front',cap252(-1));
  // close the shell: floor under the body, the cheek plate under the lamp band and the underside of the face's bottom row
  {const F=rings252(),n=F[0].length,U=arrNew();
    for(let i=0;i<F.length-1;i++){const a=F[i],b=F[i+1];quadN(U,[a[0],a[n-1],b[n-1],b[0]],null,[0,-1,0]);}
    [-1,1].forEach(e=>{const ze=e*T252.end[0],xm=LAST252[0][0]*SX252;
      quadN(U,[[-xm,FACEBOT252,ze],[xm,FACEBOT252,ze],[xm,YH252,ze],[-xm,YH252,ze]],null,[0,0,e]);
      const row=CAPF252.map((f,i)=>[xm*f,YH252,e*T252.cap[0][i]]);polyN(U,row,[0,-1,0]);});
    add('dark',U);}
  // underframe: the big equipment box between the bogies
  add('dark',boxA(0,0.11,0,X(2.9),0.78,6.4));add('dark',boxA(0,0.80,0,X(3.2),0.08,14.0));
  // headstock under each nose: closes the space between the face, the stone guard and the coupler, flush with the guard box
  [-1,1].forEach(e=>add('dark',boxA(0,0.70,e*9.58,X(3.04),0.47,0.56)));
  // bogies: Bo'Bo', pivots ±5.25, wheelbase 3.0, wheels 1.250
  [-R252.BOG,R252.BOG].forEach(zc=>{const a0=R252.WB/2;
    [-1,1].forEach(s=>{add('bogie',boxA(s*1.10,0.50,zc,0.20,0.38,4.2));add('bogie',boxA(s*1.10,0.88,zc,0.32,0.10,2.6));add('bogie',boxA(s*1.10,0.30,zc,0.14,0.10,3.5));
      [-a0,a0].forEach(a=>{add('wheel',cylA(s*0.80,R252.RW,zc+a,R252.RW,0.14,16,0,0,PI/2));add('bogie',boxA(s*1.10,0.44,zc+a,0.38,0.42,0.44));add('bogie',cylA(s*1.10,0.98,zc+a,0.16,0.26,8));});
      [-0.7,0.7].forEach(k=>add('bogie',cylA(s*1.05,0.95,zc+k,0.17,0.30,8)));});
    [-a0,a0].forEach(a=>add('bogie',cylA(0,R252.RW,zc+a,0.08,1.6,6,0,0,PI/2)));
    add('bogie',boxA(0,0.40,zc,2.0,0.56,1.4));
  });
  // roof: insulator line with its red cable from pantograph to pantograph, main breaker, two pantographs in their wells (rear raised)
  const ins=[[-3.54,-0.52],[-2.48,-0.04],[-1.50,-0.04],[-0.46,-0.04],[0.28,-0.04],[1.29,-0.04],[2.36,-0.04],[3.52,0.56]];
  ins.forEach(p=>{add('insul',cylA(X(p[1]),3.74,p[0],0.085,0.30,8));add('grey',cylA(X(p[1]),3.74,p[0],0.13,0.03,8));});
  const cab=[[-4.53,-0.55],[-3.54,-0.52],[-2.48,-0.04],[2.36,-0.04],[3.52,0.56],[4.52,0.56]];
  for(let i=0;i<cab.length-1;i++)add('cable',rodA([X(cab[i][1]),4.07,cab[i][0]],[X(cab[i+1][1]),4.07,cab[i+1][0]],0.025));
  add('grey',cylA(X(-0.43),3.74,1.84,0.24,0.06,12));add('insul',cylA(X(-0.43),3.78,1.84,0.12,0.30,10));add('cable',rodA([X(-0.04),4.07,1.84],[X(-0.43),4.08,1.84],0.025));
  add('panto',pantoA(5.30,5.26,true,-0.30));
  add('panto',pantoA(-5.30,5.26,false,-0.30));
  // both ends
  [1,-1].forEach(e=>{const lead=e>0,fz=(x,y)=>surf252(x,y);
    // horn box sunk in the cab roof
    add('yellow',boxA(0,3.80,e*7.44,X(0.50),0.22,0.52));
    // lamps: white headlights outside, red markers inside, in the black lamp band; top lamp above the windscreen
    [-1,1].forEach(s=>{const xw=s*X(0.99),xr=s*X(0.806);
      add(lead?'lightW':'lampOffW',cylA(xw,1.534,e*(fz(xw,1.534)+0.02),0.09,0.02,12,PI/2,0,0));
      add(lead?'lampOffR':'lightR',cylA(xr,1.534,e*(fz(xr,1.534)+0.02),0.06,0.02,10,PI/2,0,0));});
    [-0.09,0.09].forEach(x=>add(lead?'lightW':'lampOffW',cylA(x,3.435,e*(fz(x,3.435)+0.015),0.07,0.02,10,PI/2,0,0)));
    // yellow grab handles beside the logo, wipers
    [-1,1].forEach(s=>{const x=s*X(0.75);add('yellow',boxA(x,2.20,e*(fz(x,2.24)+0.025),0.30,0.06,0.05));
      add('dark',rodA([s*X(0.98),2.46,e*(fz(s*X(0.98),2.46)+0.015)],[s*X(0.60),3.12,e*(fz(s*X(0.60),3.12)+0.015)],0.025));});
    // headstock, rectangular buffers, hook and screw coupling, hoses
    add('dark',boxA(0,1.16,e*(ZF-0.06),X(3.02),0.12,0.14));
    [-1,1].forEach(s=>{const x=s*X(1.19);add('dark',cylA(x,0.93,e*(ZF+0.14),0.13,0.40,10,PI/2,0,0));add('buf',boxA(x,0.71,e*(ZF+0.36),X(0.79),0.44,0.06));});
    add('dark',boxA(0,0.80,e*(ZF+0.18),0.16,0.22,0.36));add('dark',boxA(0,0.75,e*(ZF+0.42),0.30,0.12,0.12));
    add('dark',rodA([0,0.87,e*(ZF+0.30)],[0,0.45,e*(ZF+0.26)],0.05));add('dark',boxA(0,0.40,e*(ZF+0.26),0.22,0.08,0.08));
    [-1,1].forEach(s=>{add('hose',rodA([s*0.34,0.88,e*(ZF+0.04)],[s*0.42,0.50,e*(ZF+0.28)],0.04));add('dark',boxA(s*0.42,0.40,e*(ZF+0.28),0.09,0.12,0.09));});
    // black skirt under the cab and the snowplough in front of it
    // black skirt under the cab nose: flush with the body side below its straight lower edge, down to the stone guard
    {const S=arrNew(),R0=T252.rings,z0=7.85,z1=T252.end[0],yb=0.18,
      xs=z=>{let i=0;while(i<R0.length-2&&z>R0[i+1].z)i++;const a=R0[i],b=R0[i+1],t=clamp((z-a.z)/(b.z-a.z),0,1);return lerp(a.p[0][0],b.p[0][0],t)*SX252;},
      zs=[z0,8.3,8.9,z1];
      for(let i=0;i<zs.length-1;i++){const a=zs[i],b=zs[i+1];
        [-1,1].forEach(s=>quadN(S,[[s*xs(a),yb,e*a],[s*xs(b),yb,e*b],[s*xs(b),bot252(b),e*b],[s*xs(a),bot252(a),e*a]],null,[s,0,0]));
        quadN(S,[[-xs(a),yb,e*a],[xs(a),yb,e*a],[xs(b),yb,e*b],[-xs(b),yb,e*b]],null,[0,-1,0]);}
      quadN(S,[[-xs(z0),yb,e*z0],[xs(z0),yb,e*z0],[xs(z0),bot252(z0),e*z0],[-xs(z0),bot252(z0),e*z0]],null,[0,0,-e]);
      quadN(S,[[-xs(z1),yb,e*z1],[xs(z1),yb,e*z1],[xs(z1),FACEBOT252,e*z1],[-xs(z1),FACEBOT252,e*z1]],null,[0,0,e]);
      add('dark',S);}
    [-1,1].forEach(s=>add('dark',boxA(s*X(0.80),0.04,e*9.72,X(1.55),0.66,0.06,0,e*s*0.38,0)));
    add('dark',boxA(0,0.04,e*9.92,0.60,0.50,0.06));
    // door handrails and the ladder under each door
    [-1,1].forEach(s=>{[[6.75,1.66],[7.86,1.62]].forEach(([z,w])=>add('grey',rodA([s*(X(w)+0.03),1.12,e*z],[s*(X(w)+0.03),2.80,e*z],0.025)));
      [7.08,7.47].forEach(z=>add('grey',boxA(s*(HALF-0.02),0.20,e*z,0.04,0.62,0.04)));
      [0.27,0.52].forEach(y=>add('grey',boxA(s*(HALF-0.02),y,e*7.275,0.05,0.03,0.43)));});
  });
  return{M:M,L:R252.L};
}
/* ---- livery: yellow cabs and stripe, charcoal body, white running number (colours of the LM3D textures) ---- */
const LIV252={yellow:'#EFC501',yellow2:'#C9A400',grey:'#2C2C2E',line:'#18181A',grille:'#202022',grille2:'#141416',roof:'#2E2E30',well:'#0F0F10',
  glass:'#0A2235',glass2:'#2F4A5E',rubber:'#121214',white:'#DEDEDC',head:'#0A0A0A',band:'#19191A',lamp:'#2C3A48',orange:'#E59A00',blue:'#1C3F94'};
const NUM252={big:'252',small:'021',uic:'252-021-1'};
function paintCar252(c,W,H){
  const ZE=R252.ZE,X=z=>(z+ZE)/(2*ZE)*W,P=PV252;
  const HY=[0.88,1.3,2.0,2.6,3.0,3.15,3.291,3.373,3.44,3.607,3.734],HYc=[0.70,1.3,2.0,2.6,3.0,3.15,3.291,3.373,3.44,3.607,3.734],RX=[1.2,1.1,0.9,0.6,0.3,0];
  const vj=j=>{const i=Math.min(29,Math.floor(j));return lerp(P[i],P[i+1],j-i);};
  const jy=(y,tab)=>{for(let i=1;i<tab.length;i++)if(y<=tab[i]||i===tab.length-1)return i-1+clamp((y-tab[i-1])/(tab[i]-tab[i-1]),0,1);return 0;};
  const jx=x=>{x=Math.abs(x);for(let i=1;i<RX.length;i++)if(x>=RX[i]||i===RX.length-1)return 10+i-1+clamp((RX[i-1]-x)/(RX[i-1]-RX[i]),0,1);return 10;};
  /* screen y of height y (or of roof x when roof=true) on side s; cab=true uses the cab section (skirt down to 0.70) */
  const Y=(y,s,o)=>{o=o||{};const j=o.roof?jx(y):jy(y,o.cab?HYc:HY);const v=vj(j);return (1-(s<0?v:1-v))*H;};
  const poly=(pts,col,s,o)=>{c.fillStyle=col;c.beginPath();pts.forEach((p,i)=>{const x=X(p[0]),y=Y(p[1],s,o);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.fill();};
  const rect=(z0,z1,y0,y1,col,s,o)=>poly([[z0,y0],[z1,y0],[z1,y1],[z0,y1]],col,s,o);
  const both=f=>[-1,1].forEach(s=>f(s));
  c.fillStyle=LIV252.grey;c.fillRect(0,0,W,H);
  both(s=>{
    // roof (by x): charcoal with the pantograph wells and the two roof grilles; yellow over the cabs
    rect(-7.04,7.04,1.2,0,LIV252.roof,s,{roof:1});
    [-1,1].forEach(e=>rect(e*4.11,e*6.54,0.95,0,LIV252.well,s,{roof:1}));
    const hz=s>0?[-3.85,-2.81]:[2.80,3.84],hx=s>0?[0.39,1.08]:[0.18,0.89];
    rect(hz[0],hz[1],hx[1],hx[0],LIV252.grille2,s,{roof:1});for(let z=hz[0]+0.04;z<hz[1];z+=0.08)rect(z,z+0.03,hx[1]-0.03,hx[0]+0.03,LIV252.grille,s,{roof:1});
    [-1,1].forEach(e=>rect(e*7.04,e*10.2,1.2,0,LIV252.yellow,s,{roof:1}));
    // yellow stripe along the whole body under the grille band
    rect(-10.2,10.2,2.97,3.15,LIV252.yellow,s);
    // grille band on the roof slope: bays separated by thin posts; the bay over the transformer is darker and finer
    const bays=[-6.53,-5.25,-3.97,-2.65,-1.35,0.0,1.40,3.85,5.25,6.50].map(z=>s>0?-z:z).sort((a,b)=>a-b);
    for(let i=0;i<bays.length-1;i++){const z0=bays[i]+0.03,z1=bays[i+1]-0.03,dark=Math.abs((bays[i]+bays[i+1])/2-(s>0?-2.625:2.625))<0.2;
      rect(z0,z1,3.22,3.66,dark?LIV252.grille2:LIV252.grille,s);
      for(let y=3.24;y<3.64;y+=dark?0.025:0.045)rect(z0+0.02,z1-0.02,y,y+0.012,dark?'#0B0B0C':LIV252.grille2,s);}
    // panel line over the sill
    rect(-6.43,6.43,1.325,1.338,LIV252.line,s);
    // cabs: yellow from the cab back (diagonal through the grille band) to the nose, door, window, lamps on the door, step light, hatch
    [-1,1].forEach(e=>{const Z=z=>e*z;
      poly([[Z(6.43),0.6],[Z(10.2),0.6],[Z(10.2),3.734],[Z(7.04),3.734],[Z(6.88),3.5],[Z(6.43),3.15]],LIV252.yellow,s,{cab:1});
      const o={cab:1},ln=(z0,y0,z1,y1)=>poly([[Z(z0),y0],[Z(z1),y0],[Z(z1),y1],[Z(z0),y1]],'#A88A00',s,o);
      ln(6.935,1.32,6.97,3.08);ln(7.615,1.32,7.65,3.08);ln(6.935,3.055,7.65,3.09);ln(6.935,1.32,7.65,1.355);
      const disc=(zc,yc,r,col)=>{const pts=[];for(let i=0;i<14;i++){const a=i/14*2*PI;pts.push([Z(zc+Math.cos(a)*r),yc+Math.sin(a)*r]);}poly(pts,col,s,o);};
      [2.38,1.90].forEach(y=>{disc(7.50,y,0.12,LIV252.yellow2);disc(7.50,y,0.10,'#E8D9A0');poly([[Z(7.40),y-0.008],[Z(7.60),y-0.008],[Z(7.60),y+0.008],[Z(7.40),y+0.008]],LIV252.yellow2,s,o);});
      poly([[Z(8.11),2.51],[Z(8.76),2.51],[Z(8.54),3.10],[Z(8.11),3.10]],LIV252.rubber,s,o);
      poly([[Z(8.13),2.53],[Z(8.73),2.53],[Z(8.52),3.08],[Z(8.13),3.08]],LIV252.glass,s,o);
      poly([[Z(8.13),2.85],[Z(8.62),2.85],[Z(8.52),3.08],[Z(8.13),3.08]],LIV252.glass2,s,o);
      poly([[Z(7.04),1.07],[Z(7.58),1.07],[Z(7.58),1.21],[Z(7.04),1.21]],LIV252.yellow2,s,o);poly([[Z(7.07),1.09],[Z(7.55),1.09],[Z(7.55),1.19],[Z(7.07),1.19]],LIV252.orange,s,o);
      disc(8.46,0.99,0.11,LIV252.yellow2);disc(8.46,0.99,0.09,LIV252.yellow);
    });
  });
  // lettering: the series 252 alone (no unit number), starting near cab 2 on the left side and near cab 1 on the right (the loco turned round); UIC number and 200 sign under it
  const hpm=W/(2*R252.ZE),vpm=(Y(1.3,-1)-Y(2.0,-1))/0.7;/* px per metre along and across the side */
  const kx=hpm/vpm;
  both(s=>{
    const word=(str,zl,zr,yb,h,weight)=>{c.textBaseline='alphabetic';c.font=weight+' 200px "Barlow",system-ui,sans-serif';const m=c.measureText(str),tw=m.width,cap=m.actualBoundingBoxAscent||140;
      const zs=Math.min(zl,zr),wpx=Math.abs(X(zr)-X(zl)),hpx=Y(yb,s)-Y(yb+h,s);
      c.save();c.translate(X(s<0?zs:zs+Math.abs(zr-zl)),Y(yb,s));c.scale(s>0?-1:1,s>0?-1:1);c.scale(wpx/tw,Math.abs(hpx)/cap);c.fillStyle=LIV252.white;c.textAlign='left';c.textBaseline='alphabetic';c.fillText(str,0,0);c.restore();};
    const zr=z=>s<0?z:-z;
    word(NUM252.big,zr(-5.67),zr(-3.33),1.45,1.04,'700');
    word(NUM252.uic,zr(-0.45),zr(0.45),1.01,0.12,'500');
    // 200 km/h sign: white octagon outline with the figure
    const oz=zr(-2.83),cx=X(oz),cy=Y(1.07,s),r=0.12*hpm;c.strokeStyle=LIV252.white;c.lineWidth=2;c.beginPath();
    for(let i=0;i<8;i++){const a=PI/8+i*PI/4;const x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r*vpm/hpm;i?c.lineTo(x,y):c.moveTo(x,y);}c.closePath();c.stroke();
    word('200',oz-0.08,oz+0.08,1.03,0.08,'600');
    // cab numbers on the doors
    [[1,'1'],[-1,'2']].forEach(([e,t])=>{c.save();c.translate(X(e*7.29),Y(1.62,s,{cab:1}));c.scale(s>0?-kx:kx,s>0?-1:1);c.fillStyle=LIV252.blue;c.font='500 '+Math.round(vpm*0.16)+'px "Barlow",system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(t,0,0);c.restore();});
  });
}
function paintFront252(c,W,H){
  const U=x=>(x*SX252+R252.HALF)/R252.W*W,V=y=>(1-(y-R252.BOT)/(R252.TOP-R252.BOT))*H;
  const rr=(x0,y0,x1,y1,r,col)=>{c.fillStyle=col;c.beginPath();const a=U(x0),b=U(x1),t=V(y1),d=V(y0);if(c.roundRect)c.roundRect(a,t,b-a,d-t,r);else c.rect(a,t,b-a,d-t);c.fill();};
  c.fillStyle=LIV252.yellow;c.fillRect(0,0,W,H);
  // headstock in black under the yellow
  c.fillStyle=LIV252.head;c.fillRect(0,V(1.28),W,H-V(1.28));
  // lamp band: black with rounded ends, lamp glasses at the sides, number between them
  rr(-1.09,1.39,1.09,1.68,10,LIV252.band);
  rr(-1.07,1.42,-0.69,1.65,6,LIV252.lamp);rr(0.69,1.42,1.07,1.65,6,LIV252.lamp);
  c.save();c.translate(U(0),V(1.535));c.scale((W/R252.W)/(H/(R252.TOP-R252.BOT)),1);
  c.fillStyle=LIV252.white;c.font='600 '+Math.round(H*0.042)+'px "Barlow",system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(NUM252.uic,0,0);c.restore();
  // windscreen: black rim, two panes and the thin pillar
  rr(-1.08,2.38,1.08,3.27,12,LIV252.rubber);
  const g=c.createLinearGradient(0,V(3.24),0,V(2.41));g.addColorStop(0,'#5E6E79');g.addColorStop(0.4,'#34414A');g.addColorStop(1,'#151B20');
  [[-1.05,-0.025],[0.025,1.05]].forEach(p=>{c.fillStyle=g;c.beginPath();const a=U(p[0]),b=U(p[1]),t=V(3.24),d=V(2.41);if(c.roundRect)c.roundRect(a,t,b-a,d-t,9);else c.rect(a,t,b-a,d-t);c.fill();
    c.fillStyle='rgba(255,255,255,.10)';c.fillRect(a+5,t+4,b-a-10,3);});
  // top lamp box over the windscreen
  rr(-0.21,3.32,0.21,3.55,6,'#2A2C2E');
  // panel joint under the windscreen
  c.fillStyle='rgba(0,0,0,.14)';c.fillRect(0,V(2.31),W,2);
}
/* ---- textures and materials ---- */
const TEX252={};
function tex252(){
  if(TEX252.ready)return TEX252;
  const base=tex269();
  TEX252.car=canvasTex(2048,512,(c,w,h)=>paintCar252(c,w,h));TEX252.car.anisotropy=8;
  TEX252.front=canvasTex(512,512,(c,w,h)=>paintFront252(c,w,h));TEX252.front.anisotropy=4;
  const mk=(t,hex)=>{const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,hex);return m;};
  TEX252.side=mk(TEX252.car,0x2C2C2E);TEX252.frontMat=mk(TEX252.front,0xEFC501);
  TEX252.solid=Object.assign({},base.solid,{yellow:tmat(0xEFC501),insul:tmat(0x6E2620),cable:tmat(0x8E1B14),buf:tmat(0x3A3D50)});
  TEX252.ready=true;return TEX252;
}
function build252(tr,sp){
  const T=tex252(),P=parts252();
  const g=new THREE.Group(),body=[];
  Object.keys(P.M).forEach(key=>{const mat=key==='side'?T.side:(key==='front'?T.frontMat:T.solid[key]);
    const m=new THREE.Mesh(geoFromArrays(P.M[key]),mat);m.castShadow=!/^light/.test(key);m.receiveShadow=true;g.add(m);
    if(key==='side'||key==='front'){m.userData.ent=tr.ent;body.push(m);}});
  return{g:g,L:sp.L,body:body};
}
/* ---------------------------------------------------------------------
   Talgo III (rama E1) · acero inoxidable con banda granate · low poly
   Forma medida sobre la malla del Talgo III de VAT (Txus) para Trainz,
   uso privado: sección de caja (ancho 3,19, techo a 3,22, piso a 0,40)
   y la cabeza redondeada de los extremos (estaciones desde 5,30 m y la
   superficie de la cúpula en una rejilla de 13 × 13). Composición de la
   rama: manso TG1z (dos cabezas, 13,53 m) + furgón TD1 (12,11) + coches
   TA1, TC1 y TB1 de 11,00 m entre ejes + cola TBz1 (12,11) dada la vuelta.
   Un eje Talgo (rodal de ruedas independientes) en cada articulación y
   dos en el manso; los extremos llevan su propio eje a 3,47 m de la cúpula.
   Rótulos y números de la rama; se omite el logotipo de Talgo.
   --------------------------------------------------------------------- */
const T3={
  prof:[[1.512,0.4],[1.561,0.7],[1.596,1.3],[1.573,1.8],[1.545,2.4],[1.486,2.8],[1.4,2.915],[1.3,2.994],[1.2,3.042],[1,3.109],[0.8,3.151],[0.4,3.205],[0,3.219]],
  rings:[{z:5.3,p:[[1.512,0.4],[1.561,0.7],[1.596,1.3],[1.573,1.8],[1.545,2.4],[1.486,2.8],[1.4,2.915],[1.3,2.994],[1.2,3.042],[1,3.109],[0.8,3.151],[0.4,3.205],[0,3.219]]},{z:5.55,p:[[1.483,0.4],[1.536,0.7],[1.568,1.3],[1.545,1.8],[1.517,2.4],[1.456,2.8],[1.4,2.88],[1.3,2.971],[1.2,3.026],[1,3.096],[0.8,3.14],[0.4,3.182],[0,3.186]]},{z:5.8,p:[[1.397,0.4],[1.45,0.7],[1.49,1.3],[1.464,1.8],[1.433,2.4],[1.367,2.8],[1.367,2.804],[1.3,2.886],[1.2,2.968],[1,3.054],[0.8,3.103],[0.4,3.142],[0,3.146]]},{z:6,p:[[1.278,0.4],[1.335,0.7],[1.378,1.3],[1.35,1.8],[1.317,2.4],[1.243,2.8],[1.243,2.804],[1.243,2.808],[1.2,2.85],[1,2.989],[0.8,3.048],[0.4,3.094],[0,3.098]]}],
  end:[6.008,6.011,6.011,6.067,6.01,6.007,6.003,6,6.007,6.004,6.003,6.001,6],
  cap:[
    [6.008,6.052,6.146,6.291,6.399,6,6,6,6.36,6.292,6.146,6.052,6.008],
    [6.01,6.062,6.182,6.321,6.469,6,6,6,6.466,6.321,6.182,6.062,6.011],
    [6.01,6.069,6.192,6.342,6.499,6.566,6.53,6.566,6.5,6.342,6.192,6.068,6.011],
    [6.067,6.065,6.185,6.328,6.479,6.611,6.507,6.611,6.48,6.329,6.185,6.064,6.067],
    [6.009,6.059,6.17,6.311,6.455,6.508,6.487,6.508,6.455,6.312,6.17,6.058,6.01],
    [6.008,6.05,6.138,6.276,6.402,6.436,6.436,6.436,6.402,6.277,6.138,6.05,6.007],
    [6.004,6.046,6.135,6.273,6.4,6.433,6.433,6.433,6.399,6.274,6.134,6.046,6.003],
    [6,6.042,6.131,6.27,6.397,6.43,6.43,6.43,6.397,6.271,6.131,6.042,6],
    [6.007,6.069,6.129,6.259,6.374,6.403,6.403,6.403,6.373,6.258,6.129,6.069,6.007],
    [6.005,6.03,6.084,6.169,6.244,6.257,6.257,6.257,6.244,6.169,6.084,6.031,6.004],
    [6.003,6.019,6.048,6.095,6.131,6.134,6.134,6.134,6.131,6.095,6.048,6.019,6.003],
    [6.001,6.002,6.04,6.004,6.004,6.004,6.004,6.004,6.004,6.004,6.04,6.001,6.001],
    [6,6,6,6,6,6,6,6,6,6,6,6,6]]};
const R3={ZE:7.0,W:3.20,HALF:1.60,BOT:0.40,TOP:3.22,RW:0.44,LC:11.0,LE:12.113,LM:13.528};
const CAPF3=[-1,-0.97,-0.9,-0.75,-0.5,-0.25,0,0.25,0.5,0.75,0.9,0.97,1];
const LAST3=T3.rings[T3.rings.length-1].p;
const PV3=(function(){const p=T3.prof,pts=[];for(let k=0;k<13;k++)pts.push([-p[k][0],p[k][1]]);for(let k=11;k>=0;k--)pts.push([p[k][0],p[k][1]]);
  const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));return cum.map(c=>c/cum[cum.length-1]);})();
function ring3(p,zf){const pts=[];for(let k=0;k<13;k++)pts.push([-p[k][0],p[k][1],zf(k)]);for(let k=11;k>=0;k--)pts.push([p[k][0],p[k][1],zf(k)]);return pts;}
/* body loft from the rear end to the front end; a rounded end uses the measured head, a flat end the plain section */
function body3(rearRound,frontRound,zr,zf){
  const R=T3.rings,F=[],A=arrNew(),ZE=R3.ZE;
  if(rearRound){F.push(ring3(LAST3,k=>-T3.end[k]));for(let i=R.length-1;i>=0;i--)F.push(ring3(R[i].p,()=>-R[i].z));}
  else F.push(ring3(T3.prof,()=>zr));
  if(frontRound){for(let i=0;i<R.length;i++)F.push(ring3(R[i].p,()=>R[i].z));F.push(ring3(LAST3,k=>T3.end[k]));}
  else F.push(ring3(T3.prof,()=>zf));
  const n=F[0].length;
  F.forEach(r=>r.forEach((p,j)=>{A.pos.push(p[0],p[1],p[2]);A.uv.push((p[2]+ZE)/(2*ZE),PV3[j]);}));
  for(let i=0;i<F.length-1;i++)for(let j=0;j<n-1;j++){const a=i*n+j,b=i*n+j+1,c=(i+1)*n+j+1,d=(i+1)*n+j;A.idx.push(a,c,b,a,d,c);}
  return A;}
/* end surfaces: the measured dome (round) or a flat end wall at z (flat); planar uv seen from outside */
function cap3(e,round,z){const A=arrNew(),rows=[],src=round?LAST3:T3.prof;
  src.forEach((l,j)=>{const xm=l[0],y=l[1],row=[];CAPF3.forEach((f,i)=>{const x=xm*f;row.push(A.pos.length/3);A.pos.push(x,y,round?e*T3.cap[j][i]:z);
    A.uv.push(((e>0?x:-x)+R3.HALF)/R3.W,(y-R3.BOT)/(R3.TOP-R3.BOT));});rows.push(row);});
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<CAPF3.length-1;i++){const a=rows[j][i],b=rows[j][i+1],c=rows[j+1][i+1],d=rows[j+1][i];
    if(e>0)A.idx.push(a,b,c,a,c,d);else A.idx.push(a,c,b,a,d,c);}
  return A;}
function surf3(x,y){const p=LAST3,F=CAPF3;let j=0;while(j<p.length-2&&y>p[j+1][1])j++;
  const rowZ=k=>{const xm=p[k][0];if(xm<1e-6)return T3.cap[k][6];const f=clamp(x/xm,-1,1);let i=0;while(i<F.length-2&&f>F[i+1])i++;return lerp(T3.cap[k][i],T3.cap[k][i+1],(f-F[i])/(F[i+1]-F[i]));};
  return lerp(rowZ(j),rowZ(j+1),clamp((y-p[j][1])/((p[j+1][1]-p[j][1])||1),0,1));}
/* car kinds, in model coordinates (rounded head towards +z), with the offset that centres the car on its pitch */
const KIND3={
  TG:{L:R3.LM,c:0,rr:1,fr:1,axles:[-3.47,3.47],joint:0,num:'TG1z-1110004',nose:'M'},
  TD:{L:R3.LE,c:0.5565,rr:0,fr:1,axles:[3.47,-5.5],joint:1,num:'TD1-107016',nose:'E'},
  TBz:{L:R3.LE,c:0.5565,rr:0,fr:1,axles:[3.47],joint:0,num:'TBz1-108006',nose:'E'},
  TA:{L:R3.LC,c:0,rr:0,fr:0,axles:[-5.5],joint:1,num:'TA1-101042',cls:'1'},
  TB:{L:R3.LC,c:0,rr:0,fr:0,axles:[-5.5],joint:1,num:'TB1-102079',cls:'2'},
  TC:{L:R3.LC,c:0,rr:0,fr:0,axles:[-5.5],joint:1,num:'TC1-107016'}
};
function parts3(kind){
  const K=KIND3[kind],M={};const add=(key,A)=>{if(!M[key])M[key]=arrNew();arrPush(M[key],A);};
  add('side',body3(K.rr,K.fr,-5.30,5.30));
  [[1,K.fr],[-1,K.rr]].forEach(([e,round])=>add(round?'nose':'endw',cap3(e,round,e*5.30)));
  // articulation at the flat rear end: dark bellows and joint fairing up to the next car
  if(K.joint){add('dark',boxA(0,0.45,-5.5,2.96,2.45,0.42));add('dark',boxA(0,2.9,-5.5,1.6,0.22,0.42));}
  // Talgo running gear: independent wheels in a light frame
  K.axles.forEach(z=>{[-1,1].forEach(s=>{add('wheel',cylA(s*0.80,R3.RW,z,R3.RW,0.12,14,0,0,PI/2));add('bogie',boxA(s*1.02,0.18,z,0.22,0.58,0.95));});
    add('bogie',boxA(0,0.16,z,1.9,0.14,0.36));add('bogie',cylA(0,R3.RW,z,0.06,1.5,6,0,0,PI/2));});
  // underfloor: a shallow skirt box between the ends
  add('dark',boxA(0,0.30,K.c,2.6,0.12,K.L-1.6));
  // rounded heads: rubber pads, coupler, lamps
  [[1,K.fr],[-1,K.rr]].forEach(([e,round])=>{if(!round)return;
    [-1,1].forEach(s=>add('dark',boxA(s*1.085,0.82,e*(surf3(s*1.085,0.95)+0.04),0.71,0.25,0.10)));
    add('dark',boxA(0,0.30,e*6.35,0.36,0.30,0.70));add('dark',boxA(0,0.35,e*6.72,0.22,0.22,0.12));
    const tail=kind==='TBz',lit=(k)=>tail?'lightR':(k==='r'?'lampOffR':'lampOffW');
    if(K.nose==='E'){[-1,1].forEach(s=>[2.42,2.26].forEach(y=>add(lit('r'),cylA(s*0.835,y,e*(surf3(s*0.835,y)+0.015),0.055,0.03,10,PI/2,0,0))));}
    else{[-1,1].forEach(s=>{add('dark',boxA(s*0.70,2.29,e*(surf3(s*0.70,2.37)+0.01),0.52,0.17,0.06));
      add('lampAmb',cylA(s*0.86,2.375,e*(surf3(s*0.86,2.37)+0.045),0.06,0.02,10,PI/2,0,0));add('lampOffR',cylA(s*0.62,2.375,e*(surf3(s*0.62,2.37)+0.045),0.06,0.02,10,PI/2,0,0));});}
    add(tail?'lightR':'lampOffR',cylA(0.515,1.10,e*(surf3(0.515,1.1)+0.02),0.11,0.03,12,PI/2,0,0));
    add('lampOffW',cylA(-0.515,1.10,e*(surf3(-0.515,1.1)+0.02),0.11,0.03,12,PI/2,0,0));
  });
  // manso: equipment box on the roof and the small pantograph folded on it
  if(kind==='TG'){add('roofbox',boxA(0,3.19,0,1.2,0.33,3.45));add('panto',pantoA(3.6,4.4,true,-0.71));}
  return{M:M};
}
/* ---- livery: stainless steel with the burgundy window band ---- */
const LIV3={inox:'#8E8A87',inox2:'#9C9895',roof:'#ABA7A3',band:'#5C0A12',line:'#141012',flute:'rgba(0,0,0,.07)',glass:'#24282B',glass2:'#3C454B',frame:'#C2BFBC',white:'#F2F0EC',grille:'#2E3033',door:'#6E0E18'};
function paintT3(c,W,H,kind){
  const K=KIND3[kind],ZE=R3.ZE,X=z=>(z+ZE)/(2*ZE)*W,P=PV3,hpm=W/(2*ZE);
  const HY=[0.40,0.7,1.3,1.8,2.4,2.8,2.915],RX=[1.4,1.3,1.2,1.0,0.8,0.4,0];
  const vj=j=>{const i=Math.min(23,Math.floor(j));return lerp(P[i],P[i+1],j-i);};
  const jy=y=>{for(let i=1;i<HY.length;i++)if(y<=HY[i]||i===HY.length-1)return i-1+clamp((y-HY[i-1])/(HY[i]-HY[i-1]),0,1);return 0;};
  const jx=x=>{x=Math.abs(x);for(let i=1;i<RX.length;i++)if(x>=RX[i]||i===RX.length-1)return 6+i-1+clamp((RX[i-1]-x)/(RX[i-1]-RX[i]),0,1);return 6;};
  const Y=(y,s,roof)=>{const v=vj(roof?jx(y):jy(y));return (1-(s<0?v:1-v))*H;};
  const poly=(pts,col,s,roof)=>{c.fillStyle=col;c.beginPath();pts.forEach((p,i)=>{const x=X(p[0]),y=Y(p[1],s,roof);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.fill();};
  const rect=(z0,z1,y0,y1,col,s,roof)=>poly([[z0,y0],[z1,y0],[z1,y1],[z0,y1]],col,s,roof);
  const vpm=(Y(1.3,-1)-Y(1.8,-1))/0.5,kx=hpm/vpm;
  const rr=(z0,z1,y0,y1,r,col,s)=>{c.fillStyle=col;c.beginPath();const a=X(z0),b=X(z1),t=Math.min(Y(y0,s),Y(y1,s)),d=Math.max(Y(y0,s),Y(y1,s));
    if(c.roundRect)c.roundRect(a,t,b-a,d-t,r*hpm);else c.rect(a,t,b-a,d-t);c.fill();};
  const win=(z0,z1,y0,y1,s,bar)=>{rr(z0-0.04,z1+0.04,y0-0.04,y1+0.04,0.12,LIV3.frame,s);rr(z0,z1,y0,y1,0.09,LIV3.glass,s);rect(z0+0.04,z1-0.04,(y0+y1)/2+0.12,y1-0.03,LIV3.glass2,s);
    if(bar)rect(z0,z1,(y0+y1)/2-0.02,(y0+y1)/2+0.02,LIV3.frame,s);};
  const txt=(str,z,y,h,s,weight,align)=>{c.save();c.translate(X(z),Y(y,s));c.scale(s>0?-kx:kx,s>0?-1:1);c.fillStyle=LIV3.white;
    c.font=(weight||'600')+' '+Math.round(vpm*h)+'px "Barlow",system-ui,sans-serif';c.textAlign=align||'left';c.textBaseline='alphabetic';c.fillText(str,0,0);c.restore();};
  c.fillStyle=LIV3.inox;c.fillRect(0,0,W,H);
  [-1,1].forEach(s=>{
    rect(-ZE,ZE,2.21,2.915,LIV3.inox2,s);rect(-ZE,ZE,1.4,0,LIV3.roof,s,1);
    for(let y=0.44;y<1.25;y+=0.045)rect(-ZE,ZE,y,y+0.012,LIV3.flute,s);
    for(let y=2.25;y<2.9;y+=0.045)rect(-ZE,ZE,y,y+0.012,LIV3.flute,s);
    rect(-ZE,ZE,2.51,2.56,LIV3.line,s);
    rect(-ZE,ZE,1.25,1.31,LIV3.line,s);rect(-ZE,ZE,1.31,2.16,LIV3.band,s);rect(-ZE,ZE,2.16,2.21,LIV3.line,s);
    // car ends: the joint line at the flat ends
    if(!K.rr)rect(-5.31,-5.24,0.4,2.9,LIV3.line,s);if(!K.fr)rect(5.24,5.31,0.4,2.9,LIV3.line,s);
    if(K.fr)rect(5.27,5.32,0.4,2.9,'rgba(0,0,0,.35)',s);if(K.rr)rect(-5.32,-5.27,0.4,2.9,'rgba(0,0,0,.35)',s);
    const pdoor=(z0,z1)=>{rr(z0,z1,0.58,2.48,0.06,'#7F7C79',s);rr(z0+0.03,z1-0.03,0.61,2.45,0.05,LIV3.inox2,s);rect(z0,z1,1.31,2.16,LIV3.door,s);
      rr(z0+0.14,z1-0.14,1.62,2.28,0.06,LIV3.frame,s);rr(z0+0.17,z1-0.17,1.65,2.25,0.05,LIV3.glass,s);};
    if(kind==='TA'||kind==='TB'){
      pdoor(-4.72,-3.87);txt(K.cls==='1'?'1ª':'2ª',-5.17,1.45,0.62,s,'500');
      [[-3.47,-2.10],[-1.61,-0.24],[0.24,1.61],[2.09,3.46,1]].forEach(w=>win(w[0],w[1],1.40,2.07,s,w[2]));
      c.fillStyle=LIV3.frame;c.beginPath();c.ellipse(X(4.30),Y(1.75,s),0.23*hpm,0.23*vpm,0,0,2*PI);c.fill();c.fillStyle='#D8DCDD';c.beginPath();c.ellipse(X(4.30),Y(1.75,s),0.19*hpm,0.19*vpm,0,0,2*PI);c.fill();
      txt(K.num,4.62,1.40,0.09,s,'500');
    }else if(kind==='TC'){
      rect(-5.15,-4.25,1.36,2.11,'#4A0810',s);[-5.0,-4.6].forEach(z=>rect(z,z+0.3,1.85,1.89,LIV3.line,s));
      [[-4.60,-4.28],[-4.15,-3.83]].forEach(g=>{rect(g[0],g[1],0.60,1.24,LIV3.grille,s);for(let y=0.64;y<1.22;y+=0.05)rect(g[0]+0.03,g[1]-0.03,y,y+0.02,'#55585B',s);});
      [[-3.45,-2.09,1],[0.25,1.63],[2.10,3.48]].forEach(w=>win(w[0],w[1],1.40,2.07,s,w[2]));
      txt(K.num,4.62,1.40,0.09,s,'500');
    }else if(kind==='TBz'||kind==='TD'){
      if(kind==='TBz'){[[-4.44,-3.06,1],[-2.58,-1.20],[-0.73,0.65],[1.12,2.50]].forEach(w=>win(w[0],w[1],1.40,2.07,s,w[2]));
        rect(4.30,5.20,1.36,2.11,'#4A0810',s);[[4.36,4.68],[4.81,5.13]].forEach(g=>{rect(g[0],g[1],0.60,1.24,LIV3.grille,s);for(let y=0.64;y<1.22;y+=0.05)rect(g[0]+0.03,g[1]-0.03,y,y+0.02,'#55585B',s);});}
      else{[[-3.88,-3.12],[0.42,1.18],[1.62,2.38]].forEach(w=>win(w[0],w[1],1.42,2.05,s));
        rr(-1.73,-0.88,0.58,2.48,0.04,'#7F7C79',s);rr(-1.70,-0.91,0.61,2.45,0.03,LIV3.inox2,s);rect(-1.70,-0.91,1.31,2.16,LIV3.door,s);rect(-1.0,-0.96,1.5,1.9,LIV3.line,s);
        win(4.42,5.19,2.24,2.68,s);}
      txt(K.num,-5.17,1.40,0.09,s,'500');
    }else if(kind==='TG'){
      [[-5.17,-4.50],[4.50,5.17]].forEach(w=>win(w[0],w[1],2.24,2.66,s));
      [[-2.60,-1.95],[1.95,2.60]].forEach(g=>{rect(g[0],g[1],2.20,2.66,LIV3.line,s);rect(g[0]+0.04,g[1]-0.04,2.24,2.62,LIV3.grille,s);for(let y=2.27;y<2.6;y+=0.045)rect(g[0]+0.06,g[1]-0.06,y,y+0.018,'#55585B',s);});
      rr(-0.56,0.56,1.28,2.70,0.04,'#5A5754',s);rect(-0.53,0.53,1.31,2.16,LIV3.door,s);rect(-0.53,0.53,2.21,2.67,LIV3.inox2,s);rect(-0.01,0.01,1.28,2.70,LIV3.line,s);
      [-0.27,0.27].forEach(z=>rect(z-0.02,z+0.02,1.45,2.2,'#7A1E22',s));
      [-1,1].forEach(e=>{rect(e*4.15,e*4.18,0.5,1.0,LIV3.line,s);});
      txt(K.num,4.20,1.40,0.09,s,'500');
    }
  });
}
function paintNose3(c,W,H,kind){
  const U=x=>(x+R3.HALF)/R3.W*W,V=y=>(1-(y-R3.BOT)/(R3.TOP-R3.BOT))*H;
  const rr=(x0,y0,x1,y1,r,col)=>{c.fillStyle=col;c.beginPath();const a=U(x0),b=U(x1),t=V(y1),d=V(y0);if(c.roundRect)c.roundRect(a,t,b-a,d-t,r);else c.rect(a,t,b-a,d-t);c.fill();};
  c.fillStyle='#A29E9A';c.fillRect(0,0,W,H);
  c.fillStyle=LIV3.inox;c.fillRect(0,V(1.25),W,H-V(1.25));
  c.fillStyle=LIV3.line;c.fillRect(0,V(1.31),W,V(1.25)-V(1.31));c.fillRect(0,V(2.21),W,V(2.16)-V(2.21));c.fillRect(0,V(2.58),W,V(2.53)-V(2.58));
  c.fillStyle=LIV3.band;c.fillRect(0,V(2.16),W,V(1.31)-V(2.16));
  // dome ribs
  c.fillStyle='rgba(0,0,0,.18)';[-0.95,-0.6,0.6,0.95].forEach(x=>c.fillRect(U(x)-1,0,2,V(2.58)));
  // coupler recess
  rr(-0.42,0.40,0.42,0.80,4,'#1C1C1E');
  if(kind==='M'){
    rr(-0.32,1.27,0.32,2.70,6,'#5A5754');rr(-0.29,1.31,0.29,2.16,4,LIV3.door);rr(-0.29,2.21,0.29,2.66,4,LIV3.inox2);
    rr(-0.24,2.30,0.24,2.58,6,LIV3.frame);rr(-0.21,2.33,0.21,2.55,5,LIV3.glass);
  }else{
    rr(-0.31,1.27,0.31,2.52,6,'#5A5754');rr(-0.28,1.30,0.28,2.49,5,LIV3.door);
    c.fillStyle=LIV3.frame;c.beginPath();c.arc(U(0),V(2.21),0.24/R3.W*W,0,2*PI);c.fill();
    c.fillStyle=LIV3.glass;c.beginPath();c.arc(U(0),V(2.21),0.19/R3.W*W,0,2*PI);c.fill();
  }
}
/* ---- textures and materials (one side texture per kind, two nose textures) ---- */
const TEX3={};
function tex3(){
  if(TEX3.ready)return TEX3;
  const base=tex269();
  const mk=(t,hex)=>{const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,hex);return m;};
  TEX3.side={};Object.keys(KIND3).forEach(k=>{const t=canvasTex(2048,512,(c,w,h)=>paintT3(c,w,h,k));t.anisotropy=8;TEX3.side[k]=mk(t,0x8E8A87);TEX3['car_'+k]=t;litSaloon(TEX3.side[k],t,[LIV3.glass,LIV3.glass2]);});
  TEX3.nose={};['E','M'].forEach(k=>{const t=canvasTex(512,512,(c,w,h)=>paintNose3(c,w,h,k));t.anisotropy=4;TEX3.nose[k]=mk(t,0x9C9895);TEX3['nose_'+k]=t;});
  TEX3.solid=Object.assign({},base.solid,{endw:tmat(0x1A1A1C),roofbox:tmat(0xA29E9A)});
  TEX3.ready=true;return TEX3;
}
function buildT3(tr,sp){
  const K=KIND3[sp.kind],T=tex3(),P=parts3(sp.kind);
  const g=new THREE.Group(),inner=new THREE.Group(),body=[];g.add(inner);
  inner.position.z=sp.flip?K.c:-K.c;if(sp.flip)inner.rotation.y=PI;
  Object.keys(P.M).forEach(key=>{const mat=key==='side'?T.side[sp.kind]:(key==='nose'?T.nose[K.nose]:T.solid[key]);
    const m=new THREE.Mesh(geoFromArrays(P.M[key]),mat);m.castShadow=!/^light/.test(key);m.receiveShadow=true;inner.add(m);
    if(key==='side'||key==='nose'){m.userData.ent=tr.ent;body.push(m);}});
  return{g:g,L:sp.L,body:body};
}
/* ---------------------------------------------------------------------
   Portacoches SEMAT de dos ejes (Renfe Laeks) · low poly a partir del
   paquete VAT de Trainz (uso privado). Libreas amarillo (con pantallas de
   malla), gris y marrón; carga: Peugeot 205 o Fiat Punto nuevos en dos pisos (8 plazas).
   Cotas medidas en el modelo: topes ±8.642, ejes ±4.479, viga lateral con
   ventana central y ventanas extremas, piso bajo 0.99/1.16, piso alto 2.81.
   Se omite el rótulo "SEMAT" (marca).
   --------------------------------------------------------------------- */
const RS={L:17.284,AX:4.479,RW:0.46,FX:1.555,TH:0.05};
const SEM={
  TOP:[[0,2.83],[4.0,2.85],[5.5,2.89],[6.71,2.96]],
  BOT:[[0,0.68],[3.0,0.69],[3.5,0.81],[4.4,0.93],[8.2,0.95]],
  OPB:[[0,1.20],[3.0,1.22],[3.55,1.30],[4.2,1.40],[4.22,1.45]],
  OPT:[[0,2.41],[3.45,2.41],[3.9,2.2],[4.19,2.0],[4.22,1.95]],
  EOB:[[4.76,1.75],[5.45,1.33],[6.33,1.33]],
  EOT:[[4.76,2.40],[4.78,2.42],[5.05,2.46],[5.58,2.50],[6.33,2.52]],
  SOL:[[6.71,1.30],[7.3,1.23],[8.2,1.21]],
  UP:[[0,2.81],[6.2,2.84],[6.71,2.90],[8.25,2.94]],UPB:[[0,2.69],[6.71,2.72],[8.25,2.72]],
  LO:[[0,0.99],[3.5,0.99],[4.5,1.16],[8.2,1.16]],LOB:[[0,0.91],[3.5,0.91],[4.5,1.08],[8.2,1.08]],
  /* the 8 car places (Trainz attachment points): upper deck, then lower deck */
  SLOT:[[-6.2,2.839],[-2.059,2.813],[2.059,2.813],[6.2,2.839],[-6.082,1.163],[-2.059,0.988],[2.059,0.988],[6.082,1.163]]
};
/* side girder, z ≥ 0: [z0,z1,breaks,solid y-intervals] (keys of SEM or numbers) */
const SEMREG=[
  [[0,1.5,3.0,3.45,3.55,3.9,4.19,4.2,4.22],[['BOT','OPB'],['OPT','TOP']]],
  [[4.22,4.76],[['BOT','TOP']]],
  [[4.76,4.78,5.05,5.45,5.58,6.33],[['BOT','EOB'],['EOT','TOP']]],
  [[6.33,6.38],[['BOT','TOP']]],
  [[6.38,6.54],[['BOT',1.32],[2.56,'TOP']]],
  [[6.54,6.71],[['BOT','TOP']]],
  [[6.71,7.3,8.2],[['BOT','SOL']]]
];
const plS=(P,z)=>{for(let i=1;i<P.length;i++)if(z<=P[i][0]||i===P.length-1){const a=P[i-1],b=P[i];return a[1]+(b[1]-a[1])*clamp((z-a[0])/((b[0]-a[0])||1),0,1);}return P[0][1];};
const semY=(k,z)=>typeof k==='number'?k:plS(SEM[k],Math.abs(z));
/* quad with the winding fixed to face n */
function quadN(A,p,uv,n){const o=A.pos.length/3;p.forEach((q,i)=>{A.pos.push(q[0],q[1],q[2]);A.uv.push(uv?uv[i][0]:0,uv?uv[i][1]:0);});
  const d1=[p[2][0]-p[0][0],p[2][1]-p[0][1],p[2][2]-p[0][2]],d2=[p[3][0]-p[1][0],p[3][1]-p[1][1],p[3][2]-p[1][2]];
  const c=[d1[1]*d2[2]-d1[2]*d2[1],d1[2]*d2[0]-d1[0]*d2[2],d1[0]*d2[1]-d1[1]*d2[0]];
  if(c[0]*n[0]+c[1]*n[1]+c[2]*n[2]>=0)A.idx.push(o,o+1,o+2,o,o+2,o+3);else A.idx.push(o,o+2,o+1,o,o+3,o+2);}
/* convex polygon as a fan, facing n */
function polyN(A,p,n){const o=A.pos.length/3;p.forEach(q=>{A.pos.push(q[0],q[1],q[2]);A.uv.push(0,0);});
  for(let i=1;i<p.length-1;i++){const a=p[0],b=p[i],c=p[i+1];const e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],e2=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const x=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
    if(x[0]*n[0]+x[1]*n[1]+x[2]*n[2]>=0)A.idx.push(o,o+i,o+i+1);else A.idx.push(o,o+i+1,o+i);}}
/* deck slab along z between two profiles (symmetric in z) */
function deckS(A,TP,BP,hw,zmax){
  const zs=[...new Set(TP.concat(BP).map(p=>p[0]).filter(z=>z<zmax).concat([zmax]))].sort((a,b)=>a-b);
  const Z=zs.slice().reverse().map(z=>-z).concat(zs.filter(z=>z>0));
  const t=z=>plS(TP,Math.abs(z)),b=z=>plS(BP,Math.abs(z));
  for(let i=0;i<Z.length-1;i++){const a=Z[i],c=Z[i+1];
    quadN(A,[[-hw,t(a),a],[hw,t(a),a],[hw,t(c),c],[-hw,t(c),c]],null,[0,1,0]);
    quadN(A,[[-hw,b(a),a],[hw,b(a),a],[hw,b(c),c],[-hw,b(c),c]],null,[0,-1,0]);
    [-1,1].forEach(s=>quadN(A,[[s*hw,b(a),a],[s*hw,t(a),a],[s*hw,t(c),c],[s*hw,b(c),c]],null,[s,0,0]));}
  [-1,1].forEach(e=>{const z=e*zmax;quadN(A,[[-hw,b(z),z],[hw,b(z),z],[hw,t(z),z],[-hw,t(z),z]],null,[0,0,e]);});
}
function partsSemat(liv,slots){
  const M={};const add=(key,A)=>{if(!M[key])M[key]=arrNew();arrPush(M[key],A);};
  const S=arrNew(),I=arrNew(),U=v=>v/3.4;
  // side girders: outer face textured (u mirrored on the right so lettering reads), inner face plain
  [-1,1].forEach(s=>{const xo=s*RS.FX,xi=s*(RS.FX-RS.TH),uz=z=>(s<0?(z+9):(9-z))/18;
    SEMREG.forEach(([br,iv])=>{for(let i=0;i<br.length-1;i++)[1,-1].forEach(m=>{const za=m*br[i],zb=m*br[i+1];
      iv.forEach(([l,h])=>{const p=x=>[[x,semY(l,za),za],[x,semY(l,zb),zb],[x,semY(h,zb),zb],[x,semY(h,za),za]];
        quadN(S,p(xo),p(xo).map(q=>[uz(q[2]),U(q[1])]),[s,0,0]);quadN(I,p(xi),null,[-s,0,0]);
        // the thin top and end edges of the plate
      });});});
    // ladders in the gap beside the end posts
    [-1,1].forEach(e=>[1.63,1.95,2.26].forEach(y=>add('body',rodA([s*(RS.FX-0.02),y,e*6.38],[s*(RS.FX-0.02),y,e*6.54],0.03))));
  });
  add('side',S);add('body',I);
  // top edge of the girders (seen from above)
  const E=arrNew();[-1,1].forEach(s=>{const xs=[s*RS.FX,s*(RS.FX-RS.TH)];const zs=[-6.71,-5.5,-4,0,4,5.5,6.71];
    for(let i=0;i<zs.length-1;i++){const a=zs[i],b=zs[i+1];quadN(E,[[xs[0],semY('TOP',a),a],[xs[1],semY('TOP',a),a],[xs[1],semY('TOP',b),b],[xs[0],semY('TOP',b),b]],null,[0,1,0]);}});
  add('body',E);
  // decks
  const D=arrNew();deckS(D,SEM.UP,SEM.UPB,1.505,8.25);deckS(D,SEM.LO,SEM.LOB,1.45,8.2);add('deck',D);
  [-1,1].forEach(e=>add('body',boxA(0,2.92,e*8.22,3.0,0.21,0.06)));
  // headstocks, buffers and hooks
  [-1,1].forEach(e=>{add('body',boxA(0,0.80,e*8.20,3.06,0.42,0.16));
    [-1,1].forEach(s=>{add('buf',cylA(s*0.875,1.05,e*8.40,0.10,0.28,8,PI/2,0,0));add('buf',cylA(s*0.875,1.05,e*8.60,0.19,0.06,10,PI/2,0,0));});
    add('dark',boxA(0,0.93,e*8.42,0.12,0.12,0.36));});
  // two axles: wheels, axleboxes, leaf springs and W-irons
  [-1,1].forEach(e=>{const z=e*RS.AX;
    add('dark',cylA(0,RS.RW,z,0.07,1.62,6,0,0,PI/2));
    [-1,1].forEach(s=>{add('wheel',cylA(s*0.79,RS.RW,z,RS.RW,0.13,12,0,0,PI/2));
      add('dark',boxA(s*1.14,0.30,z,0.24,0.34,0.30));add('dark',boxA(s*1.14,0.64,z,0.13,0.15,1.9));
      [-1,1].forEach(k=>{add('dark',boxA(s*1.13,0.34,z+k*0.24,0.05,0.62,0.10));add('dark',rodA([s*1.14,0.74,z+k*0.95],[s*1.14,0.95,z+k*1.05],0.05));});});});
  // amarillo: mesh screens along the upper deck and over the side openings, railings
  if(LIVS[liv].screens){const W=arrNew(),q=(pts,n)=>quadN(W,pts,pts.map(p=>[p[2]/0.4,p[1]/0.4]),n);
    [-1,1].forEach(s=>{const x=s*1.53;
      q([[x,2.93,-6.6],[x,2.93,6.6],[x,3.64,6.6],[x,3.64,-6.6]],[s,0,0]);
      [-1,1].forEach(e=>{q([[x,2.96,e*6.78],[x,2.96,e*8.15],[x,3.64,e*8.15],[x,3.64,e*6.78]],[s,0,0]);
        const t=[[x,2.72,e*6.74],[x,1.32,e*6.74],[x,1.32,e*7.99]],o=W.pos.length/3;t.forEach(p=>{W.pos.push(...p);W.uv.push(p[2]/0.4,p[1]/0.4);});W.idx.push(o,o+1,o+2);
        add('body',rodA([x,2.72,e*6.74],[x,1.30,e*7.99],0.05));
        add('body',boxA(x,3.62,e*7.465,0.05,0.05,1.37));[6.78,8.15].forEach(z=>add('body',boxA(x,2.94,e*z,0.05,0.72,0.05)));});
      q([[s*1.49,1.20,-6.33],[s*1.49,1.20,6.33],[s*1.49,2.52,6.33],[s*1.49,2.52,-6.33]],[s,0,0]);
      add('body',boxA(x,3.62,0,0.05,0.05,13.2));
      for(let k=-4;k<=4;k++)add('body',boxA(x,2.86,k*1.65,0.05,0.78,0.05));});
    add('screen',W);}
  return{M:M};
}
/* ---- liveries ---- */
const LIVS={
  am:{name:'amarillo',hex:0x86620F,css:'#86620F',deck:0x7E5C10,ink:'#151515',num:'23 71 417 9 280-7',pma:'26025',screens:1},
  gr:{name:'gris',hex:0x1F1F1F,css:'#1F1F1F',deck:0x4A4548,ink:'#E4E4E0',num:'24 71 042 2 090-3',pma:'26031'},
  ma:{name:'marrón',hex:0x371719,css:'#371719',deck:0x463A3A,ink:'#E4E4E0',num:'24 71 042 2 090-3',pma:'26031'}
};
function paintSemat(c,W,H,liv){
  const L=LIVS[liv],X=z=>(z+9)/18*W,Y=y=>(1-y/3.4)*H,hpm=W/18,vpm=H/3.4,kx=hpm/vpm;
  c.fillStyle=L.css;c.fillRect(0,0,W,H);
  const g=c.createLinearGradient(0,Y(2.95),0,Y(0.65));g.addColorStop(0,'rgba(255,255,255,0.05)');g.addColorStop(1,'rgba(0,0,0,0.16)');c.fillStyle=g;c.fillRect(0,0,W,H);
  // rust and grime streaks
  c.fillStyle='rgba(60,30,10,0.10)';for(let z=-8.2;z<8.2;z+=0.37+((z*7.3)%0.3+0.3)%0.3){c.fillRect(X(z),Y(2.8),Math.max(1,hpm*0.03),Y(2.45)-Y(2.8));}
  const txt=(s,z,y,h,a,w)=>{c.save();c.translate(X(z),Y(y));c.scale(kx,1);c.fillStyle=L.ink;c.font=(w||'600')+' '+Math.max(6,Math.round(vpm*h))+'px "Barlow",system-ui,sans-serif';
    c.textAlign=a||'left';c.textBaseline='alphabetic';c.fillText(s,0,0);c.restore();};
  const box=(z0,z1,y0,y1)=>{c.strokeStyle=L.ink;c.lineWidth=1.5;c.strokeRect(X(z0),Y(y1),X(z1)-X(z0),Y(y0)-Y(y1));};
  txt(L.num,-6.32,1.16,0.075);txt('RIV RENFE'+(liv==='am'?'':'  Laeks'),-6.32,1.07,0.06);
  txt('ESTACIÓN DOMICILIARIA VILLAVERDE BAJO',-8.15,1.02,0.035,'left','500');
  box(-4.82,-4.28,1.02,1.22);txt('A B C',-4.55,1.14,0.055,'center');txt(liv==='am'?'27,0t':'24,0t',-4.55,1.05,0.055,'center');
  txt('17,44',-3.62,1.13,0.05,'center');c.fillStyle=L.ink;c.fillRect(X(-3.85),Y(1.10),X(-3.39)-X(-3.85),2);
  box(-3.05,-2.6,1.02,1.20);txt('17,050m',-2.83,1.13,0.04,'center');txt('22t',-2.83,1.05,0.045,'center');
  txt('PMA',-1.75,1.06,0.07);txt(L.pma,-1.38,1.06,0.07);
  if(liv==='am'){box(-0.76,-0.04,0.98,1.17);txt('TRANSPORTE DE',-0.40,1.09,0.05,'center');txt('AUTOMÓVILES',-0.40,1.01,0.05,'center');
    box(0.58,1.50,1.06,1.17);txt('Laeks 417 9 280-6',1.04,1.085,0.06,'center');txt('Regulador SAB DA2',0.30,0.98,0.045);}
  else{box(0.55,1.40,1.07,1.18);txt('RIV · 22 t',0.97,1.10,0.06,'center');txt('PESO MAX.  22',0.55,0.99,0.04);}
  txt('← 9,0 m →',2.75,1.04,0.045,'center');
  txt('E',3.80,2.58,0.10,'left','600');txt('E',7.35,1.05,0.08,'left','600');
  // edge lines of the plate
  c.fillStyle='rgba(0,0,0,0.25)';c.fillRect(0,Y(2.84),W,2);
}
const TEXS={};
function screenTex(){
  if(TEXS.screen)return TEXS.screen;
  const t=canvasTex(64,64,(c,w,h)=>{c.clearRect(0,0,w,h);c.fillStyle='#86620F';for(let i=0;i<w;i+=8){c.fillRect(i,0,2,h);c.fillRect(0,i,w,2);}c.fillRect(0,0,w,1);},true);
  const m=new THREE.MeshLambertMaterial({map:t,transparent:true,depthWrite:false,side:THREE.DoubleSide,clippingPlanes:CLIP});MAT_HEX.set(m,0x86620F);
  TEXS.screen=m;return m;
}
function texSemat(liv){
  if(TEXS[liv])return TEXS[liv];
  if(!TEXS.solid)TEXS.solid={dark:tmat(0x1B1B1B),wheel:tmat(0x2E2E2E),buf:tmat(0x2A2A2A),cbody:tmat(0xDDE2E4),cglass:tmat(0x2C3842),tyre:tmat(0x161616),
    chrome:tmat(0xA2A6A8),lampF:tmat(0xE6E2CF),lampR:tmat(0x9A2420)};
  const L=LIVS[liv],t=canvasTex(2048,512,(c,w,h)=>paintSemat(c,w,h,liv));t.anisotropy=8;
  const side=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(side,L.hex);
  TEXS[liv]={side:side,tex:t,solid:Object.assign({},TEXS.solid,{body:tmat(L.hex),deck:tmat(L.deck),screen:screenTex()})};
  return TEXS[liv];
}
/* the cars on the decks: copies of the model merged per material (one mesh per colour of paint), double-sided like the
   models, cut at the board edges like the rest of the train */
function semLoadMeshes(sp){const sl=sp.slots||[];if(!sl.length)return[];const ld=sp.ld||{k:'p205',c:sl.map(()=>0xEDEDEA)},G=vehGeo(ld.k),D=VEH[ld.k];
  TEXS.ldm=TEXS.ldm||{};const mat=(id,hex)=>TEXS.ldm[id]||(TEXS.ldm[id]=(()=>{const m=new THREE.MeshLambertMaterial({color:hex,clippingPlanes:CLIP,clipShadows:true,side:THREE.DoubleSide});MAT_HEX.set(m,hex);return m;})());
  const out=[],merge=(g,list)=>{const P=g.attributes.position.array,N=g.attributes.normal.array,pos=new Float32Array(P.length*list.length),nor=new Float32Array(N.length*list.length);
    list.forEach((i,j)=>{const p=SEM.SLOT[i];for(let q=0;q<P.length;q+=3){pos[j*P.length+q]=P[q];pos[j*P.length+q+1]=P[q+1]+p[1];pos[j*P.length+q+2]=P[q+2]+p[0];}nor.set(N,j*N.length);});
    const b=new THREE.BufferGeometry();b.setAttribute('position',new THREE.BufferAttribute(pos,3));b.setAttribute('normal',new THREE.BufferAttribute(nor,3));return b;};
  Object.keys(G).forEach(k=>{
    if(k==='paint'){const by={};sl.forEach((i,j)=>{const h=ld.c[i]!==undefined?ld.c[i]:ld.c[j%ld.c.length];(by[h]=by[h]||[]).push(i);});
      Object.keys(by).forEach(h=>{const m=new THREE.Mesh(merge(G[k],by[h]),mat('p'+h,+h));m.castShadow=true;m.receiveShadow=true;out.push(m);});}
    else{const m=new THREE.Mesh(merge(G[k],sl),mat(ld.k+k,D.cols[k]));m.castShadow=k!=='glass';m.receiveShadow=true;out.push(m);}});
  return out;}
function buildSemat(tr,sp){
  const T=texSemat(sp.liv),P=partsSemat(sp.liv,sp.slots);
  const g=new THREE.Group(),inner=new THREE.Group(),body=[];g.add(inner);if(sp.flip)inner.rotation.y=PI;
  Object.keys(P.M).forEach(key=>{const mat=key==='side'?T.side:T.solid[key];
    const m=new THREE.Mesh(geoFromArrays(P.M[key]),mat);m.castShadow=key!=='screen';m.receiveShadow=true;inner.add(m);
    if(key==='side'||key==='deck'){m.userData.ent=tr.ent;body.push(m);}});
  semLoadMeshes(sp).forEach(m=>inner.add(m));
  return{g:g,L:sp.L,body:body};
}
/* ---------------------------------------------------------------------
   Vagón cerrado JPD (Renfe Hbis, dos ejes, paredes correderas) · low poly
   a partir del paquete VAT de Trainz (Txus, Pasku & Jjlor; freeware, uso
   privado). Libreas marrón, verde y roja. Cotas medidas en el modelo:
   topes ±7.02, caja ±6.43 × ±1.385, techo 3.93, ejes ±4.00, ocho
   paños por costado con nervios a 1.80 y 2.60. Se omiten los logotipos
   (Renfe, Estrella Damm, Damm, TEM, Toro y Betolaza).
   --------------------------------------------------------------------- */
const RJ={L:14.04,ZE:6.43,HW:1.385,Y0:0.94,YS:3.33,AX:4.0,RW:0.44,
  ROOF:[[1.40,3.33],[1.36,3.40],[1.245,3.50],[1.105,3.60],[0.935,3.70],[0.71,3.80],[0.335,3.90],[0,3.93]],
  POSTS:[-6.38,-4.71,-3.15,-1.59,0,1.59,3.15,4.71,6.38]};
const JPDL={
  marron:{name:'marrón',hex:0x7F4238,css:'#7F4238',roof:0xD87665,ink:'#ECE6E0',red:0},
  verde:{name:'verde',hex:0x087A5A,css:'#087A5A',roof:0x20C897,ink:'#ECEFEA',red:0},
  rojo:{name:'rojo',hex:0xA80225,css:'#A80225',roof:0xF0284F,ink:'#F2ECEC',red:1}
};
function partsJPD(){
  const M={};const add=(key,A)=>{if(!M[key])M[key]=arrNew();arrPush(M[key],A);};
  const S=arrNew(),E=arrNew(),R=arrNew(),ZE=RJ.ZE,HW=RJ.HW;
  // sides: one textured panel each (u mirrored on the right so the lettering reads)
  [-1,1].forEach(s=>{const x=s*HW,u=z=>(s<0?(z+6.5):(6.5-z))/13,v=y=>(y-0.9)/2.5;
    const p=[[x,RJ.Y0,-ZE],[x,RJ.Y0,ZE],[x,RJ.YS,ZE],[x,RJ.YS,-ZE]];quadN(S,p,p.map(q=>[u(q[2]),v(q[1])]),[s,0,0]);
    // stakes and the two horizontal ribs in relief
    RJ.POSTS.forEach(z=>add('body',boxA(x+s*0.02,0.99,z,0.05,2.31,Math.abs(z)>6?0.10:(z===0?0.12:0.07))));
    [1.80,2.60].forEach(y=>add('body',boxA(x+s*0.02,y,0,0.05,0.06,12.8)));
    add('body',boxA(x+s*0.015,3.27,0,0.04,0.06,12.86));});
  // end walls up to the roof arc (planar uv, symmetric artwork)
  const prof=[[-HW,RJ.Y0],[HW,RJ.Y0]].concat(RJ.ROOF.map(p=>[Math.min(p[0],HW),p[1]]),RJ.ROOF.slice(0,-1).reverse().map(p=>[-Math.min(p[0],HW),p[1]]));
  [-1,1].forEach(e=>{const z=e*ZE,o=E.pos.length/3;prof.forEach(p=>{E.pos.push(p[0],p[1],z);E.uv.push((e>0?(1.4-p[0]):(p[0]+1.4))/2.8,(p[1]-0.9)/3.05);});
    for(let i=1;i<prof.length-1;i++){if(e>0)E.idx.push(o,o+i,o+i+1);else E.idx.push(o,o+i+1,o+i);}});
  // roof: arc lofted along the body with a slight overhang at the ends
  const arc=RJ.ROOF.map(p=>[p[0],p[1]]).concat(RJ.ROOF.slice(0,-1).reverse().map(p=>[-p[0],p[1]])).reverse();
  for(let i=0;i<arc.length-1;i++){const a=arc[i],b=arc[i+1],zr=ZE+0.04,n=[(a[0]+b[0])/2,(a[1]+b[1])/2-2.6,0];
    quadN(R,[[a[0],a[1],-zr],[b[0],b[1],-zr],[b[0],b[1],zr],[a[0],a[1],zr]],null,n);}
  add('side',S);add('endw',E);add('roof',R);
  // underframe: centre sill, headstocks, buffers, couplers
  add('dark',boxA(0,0.62,0,0.34,0.30,12.8));[-1,1].forEach(s=>add('dark',boxA(s*1.30,0.80,0,0.10,0.15,12.86)));
  [-1,1].forEach(e=>{add('body',boxA(0,0.80,e*6.49,2.80,0.32,0.12));
    [-1,1].forEach(s=>{add('dark',cylA(s*0.90,1.04,e*6.74,0.11,0.40,8,PI/2,0,0));add('buf',boxA(s*0.90,0.84,e*6.98,0.62,0.40,0.06));});
    add('dark',boxA(0,0.92,e*6.80,0.12,0.12,0.50));
    // corner steps
    [-1,1].forEach(s=>{const x=s*1.40,z0=e*6.13,z1=e*6.42;add('body',rodA([x,0.24,z0],[x,0.94,z0],0.04));add('body',rodA([x,0.24,z1],[x,0.94,z1],0.04));
      [0.28,0.58].forEach(y=>add('body',rodA([x,y,z0],[x,y,z1],0.04)));});});
  // queen-post truss under each solebar, brake cylinder, hand-brake wheel
  [-1,1].forEach(s=>{const x=s*1.22;[[[-3.42,0.92],[-2.80,0.43]],[[-2.80,0.43],[2.80,0.43]],[[2.80,0.43],[3.42,0.92]],[[-1.5,0.43],[-1.5,0.85]],[[1.5,0.43],[1.5,0.85]]]
    .forEach(([a,b])=>add('body',rodA([x,a[1],a[0]],[x,b[1],b[0]],0.06)));});
  add('dark',cylA(0.30,0.66,-1.30,0.21,1.25,10,PI/2,0,0));
  add('hwheel',cylA(-1.46,0.62,2.33,0.18,0.03,10,0,0,PI/2));add('dark',rodA([-1.40,0.62,2.33],[-1.20,0.62,2.33],0.04));
  // two axles: wheels, axleboxes, leaf springs, W-irons and hangers
  [-1,1].forEach(e=>{const z=e*RJ.AX;add('dark',cylA(0,RJ.RW,z,0.07,1.62,6,0,0,PI/2));
    [-1,1].forEach(s=>{add('wheel',cylA(s*0.79,RJ.RW,z,RJ.RW,0.13,12,0,0,PI/2));
      add('dark',boxA(s*1.13,0.28,z,0.24,0.32,0.30));add('dark',boxA(s*1.13,0.60,z,0.13,0.14,1.6));
      [-1,1].forEach(k=>{add('dark',boxA(s*1.12,0.30,z+k*0.24,0.05,0.62,0.10));add('dark',rodA([s*1.13,0.68,z+k*0.80],[s*1.13,0.93,z+k*0.92],0.05));});});});
  return{M:M};
}
function paintJPD(c,W,H,liv){
  const L=JPDL[liv],X=z=>(z+6.5)/13*W,Y=y=>(1-(y-0.9)/2.5)*H,hpm=W/13,vpm=H/2.5,kx=hpm/vpm;
  const rect=(z0,z1,y0,y1,col)=>{c.fillStyle=col;c.fillRect(X(z0),Y(y1),X(z1)-X(z0),Y(y0)-Y(y1));};
  c.fillStyle=L.css;c.fillRect(0,0,W,H);
  const g=c.createLinearGradient(0,Y(3.33),0,Y(0.94));g.addColorStop(0,'rgba(255,255,255,0.06)');g.addColorStop(0.7,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,0.18)');c.fillStyle=g;c.fillRect(0,0,W,H);
  // weathering: a few rust streaks and spots (fixed pattern)
  let sd=7;const rn=()=>{sd=(sd*16807)%2147483647;return sd/2147483647;};
  for(let i=0;i<26;i++){const z=-6.3+rn()*12.6,y=1.1+rn()*2.1;c.fillStyle='rgba(70,32,14,'+(0.18+rn()*0.25)+')';c.beginPath();c.ellipse(X(z),Y(y),2+rn()*4,2+rn()*3,0,0,2*PI);c.fill();
    c.fillStyle='rgba(70,32,14,0.10)';c.fillRect(X(z)-1,Y(y),2,rn()*vpm*0.35);}
  // ribs: lit top edge, dark shadow under; top rail and solebar
  [[2.60,0.06],[1.80,0.06]].forEach(([y,h])=>{rect(-6.43,6.43,y+h,y+h+0.012,'rgba(255,255,255,0.18)');rect(-6.43,6.43,y-0.05,y,'rgba(0,0,0,0.45)');});
  rect(-6.43,6.43,3.22,3.27,'rgba(0,0,0,0.5)');rect(-6.43,6.43,0.94,0.99,'rgba(0,0,0,0.35)');rect(-6.43,6.43,0.97,0.985,'rgba(255,255,255,0.18)');
  // shadow beside every stake (light from the left)
  RJ.POSTS.forEach(z=>{const w=Math.abs(z)>6?0.05:(z===0?0.06:0.035);rect(z+w,z+w+0.05,0.99,3.27,'rgba(0,0,0,0.30)');});
  // louvres in the upper end bays
  [[-6.0,-5.0],[5.0,6.0]].forEach(([a,b])=>{for(let y=2.72;y<3.0;y+=0.035)rect(a,b,y,y+0.015,'rgba(0,0,0,0.55)');});
  const txt=(s,z,y,h,a,w)=>{c.save();c.translate(X(z),Y(y));c.scale(kx,1);c.fillStyle=L.ink;c.font=(w||'500')+' '+Math.max(6,Math.round(vpm*h))+'px "Barlow",system-ui,sans-serif';
    c.textAlign=a||'left';c.textBaseline='alphabetic';c.fillText(s,0,0);c.restore();};
  const box=(z0,z1,y0,y1)=>{c.strokeStyle=L.ink;c.lineWidth=1.5;c.strokeRect(X(z0),Y(y1),X(z1)-X(z0),Y(y0)-Y(y1));};
  const num=(z,y0)=>{['41','71 RENFE','2250217-8','Hbis'].forEach((s,i)=>txt(s,z,y0-i*0.155,0.12));};
  const tara=(z,y)=>{['TARA','CARGA MÁX.','CAPACIDAD'].forEach((s,i)=>{txt(s,z,y-i*0.10,0.045);txt(['14400 kg','24000 kg','68 m³'][i],z+0.65,y-i*0.10,0.045);});};
  const abc=(z,y)=>{txt('A   B   C',z,y,0.06);txt('S 16  20  24',z,y-0.10,0.06);};
  const aten=(z,y)=>{['— ATENCIÓN —','EL VAGÓN DEBERÁ SER PRECINTADO SIEMPRE','CON LAS PUERTAS CERRADAS Y ENCLAVADAS'].forEach((s,i)=>txt(s,z,y-i*0.065,0.04,'center'));};
  if(!L.red){
    num(-4.65,2.42);
    rect(-5.85,-5.55,1.22,1.56,'#C9CCCE');for(let z=-5.82;z<-5.56;z+=0.05)rect(z,z+0.012,1.24,1.54,'#6E7275');rect(-5.25,-5.03,1.22,1.56,'#141414');
    txt('<·19m·>',-4.6,1.62,0.045);txt('m = 1   2 1,5 t/4   3 3 t/10   4 6 t/20',-4.65,1.45,0.04);txt('↔ 14,02 m',-3.95,1.22,0.045);
    tara(-2.85,1.50);abc(-1.15,1.42);aten(-0.05,2.20);
    box(3.20,3.85,2.04,2.18);txt('REVISIÓN',3.23,2.13,0.035);txt('F. REV. 22.03.94',3.23,2.07,0.035);
    c.fillStyle='#E0A21C';c.beginPath();c.moveTo(X(4.30),Y(2.24));c.lineTo(X(4.42),Y(2.12));c.lineTo(X(4.30),Y(2.00));c.lineTo(X(4.18),Y(2.12));c.closePath();c.fill();
    c.save();c.fillStyle=L.css;c.translate(X(4.30),Y(2.10));c.scale(kx,1);c.font='700 '+Math.round(vpm*0.05)+'px "Barlow",sans-serif';c.textAlign='center';c.fillText('100',0,0);c.restore();
    txt('St',5.90,2.03,0.10);
  }else{
    box(-4.65,-4.45,1.36,1.62);num(-4.30,1.66);
    rect(-5.67,-5.37,1.22,1.48,'rgba(0,0,0,0.25)');for(let z=-5.64;z<-5.38;z+=0.05)rect(z,z+0.012,1.24,1.46,'rgba(0,0,0,0.45)');
    txt('m = 1   2 1,5 t/4   3 3 t/10',-3.70,1.45,0.04);tara(-2.45,1.68);abc(-1.25,1.40);aten(0.30,1.62);
    txt('KE-GP',1.80,1.27,0.06);box(2.05,2.70,1.33,1.46);txt('F. REV. 22.03.94',2.08,1.38,0.035);txt('St',3.40,1.28,0.10);
  }
  txt('Hbis 41 71 225 0217-8',-3.95,1.00,0.04);
}
function paintJPDEnd(c,W,H,liv){
  const L=JPDL[liv],U=x=>(x+1.4)/2.8*W,V=y=>(1-(y-0.9)/3.05)*H;
  const rect=(x0,x1,y0,y1,col)=>{c.fillStyle=col;c.fillRect(U(x0),V(y1),U(x1)-U(x0),V(y0)-V(y1));};
  c.fillStyle=L.css;c.fillRect(0,0,W,H);
  const g=c.createLinearGradient(0,V(3.9),0,V(0.94));g.addColorStop(0,'rgba(255,255,255,0.05)');g.addColorStop(1,'rgba(0,0,0,0.2)');c.fillStyle=g;c.fillRect(0,0,W,H);
  [[-1.38,-1.28],[1.28,1.38],[-0.52,-0.40],[0.40,0.52]].forEach(([a,b])=>{rect(a,b,0.94,3.32,'rgba(0,0,0,0.22)');rect(a,a+0.02,0.94,3.32,'rgba(255,255,255,0.15)');});
  rect(-1.4,1.4,3.18,3.30,'rgba(0,0,0,0.25)');rect(-1.4,1.4,3.30,3.33,'rgba(255,255,255,0.15)');
  rect(-0.9,-0.15,3.62,3.65,'rgba(0,0,0,0.35)');rect(0.15,0.9,3.62,3.65,'rgba(0,0,0,0.35)');rect(-0.55,0.55,3.80,3.83,'rgba(0,0,0,0.35)');
  rect(0.50,0.56,2.05,2.40,'rgba(0,0,0,0.35)');
}
const TEXJ={};
function texJPD(liv){
  if(TEXJ[liv])return TEXJ[liv];
  const L=JPDL[liv],mk=(t,hex)=>{const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,hex);return m;};
  const ts=canvasTex(2048,512,(c,w,h)=>paintJPD(c,w,h,liv));ts.anisotropy=8;const te=canvasTex(256,256,(c,w,h)=>paintJPDEnd(c,w,h,liv));
  if(!TEXJ.shared)TEXJ.shared={dark:tmat(0x1B1B1B),wheel:tmat(0x2E2E2E),buf:tmat(0x2A2A2A),hwheel:tmat(0xB89A2A)};const base=TEXJ.shared;
  TEXJ[liv]={side:mk(ts,L.hex),tex:ts,solid:{endw:mk(te,L.hex),roof:tmat(L.roof),body:tmat(L.hex),dark:base.dark,wheel:base.wheel,buf:base.buf,hwheel:base.hwheel}};
  return TEXJ[liv];
}
let PJPD=null;
function buildJPD(tr,sp){
  const T=texJPD(sp.liv),P=PJPD||(PJPD=partsJPD());
  const g=new THREE.Group(),inner=new THREE.Group(),body=[];g.add(inner);if(sp.flip)inner.rotation.y=PI;
  Object.keys(P.M).forEach(key=>{const mat=key==='side'?T.side:T.solid[key];
    const m=new THREE.Mesh(geoFromArrays(P.M[key]),mat);m.castShadow=true;m.receiveShadow=true;inner.add(m);
    if(key==='side'||key==='roof'||key==='endw'){m.userData.ent=tr.ent;body.push(m);}});
  return{g:g,L:sp.L,body:body};
}
/* ---------------------------------------------------------------------
   Tolva TT6 (Renfe, tipo Fals, bogies Y25) · low poly a partir del
   paquete ES_Renfe_TT6 de SpainTrainzRutas para Train Simulator (uso
   privado). Cotas medidas en el modelo: topes ±6.27 (12.54 m), caja
   superior hasta 3.97 con hombros achaflanados y boca de ±0.88, testeros
   inclinados, puertas laterales de descarga hasta 2.45 con hueco central,
   pivotes de bogie a ±3.75 (7.5 m) y ejes a 2.0 m. Libreas roja y verde;
   carga de carbón o vacía. Se omiten los logotipos de Renfe.
   --------------------------------------------------------------------- */
const RT={L:12.54,PIV:3.75,AXB:1.0,RW:0.46,
  /* half cross-section of the upper hopper, bottom → top [x,y] */
  UP:[[1.41,2.45],[1.51,2.85],[1.51,3.15],[1.48,3.30],[1.37,3.50],[1.21,3.70],[0.95,3.97]],
  MOUTH:0.88,MZ:5.25,LOW:1.48,LZ:5.40,LY0:0.95,LY1:2.45,GAP:0.30};
/* end of the upper hopper at height y (sloping end walls) */
function tt6End(y){if(y>=3.8)return lerp(6.01,5.96,clamp((y-3.8)/0.17,0,1));if(y>=2.6)return lerp(5.32,6.01,(y-2.6)/1.2);return lerp(5.40,5.32,clamp((y-2.45)/0.15,0,1));}
const TT6L={
  rojo:{name:'roja',hex:0x5A1E17,css:'#5A1E17',inside:0x1E0806,bogie:0x2A100C,ink:'#E8DFD4'},
  verde:{name:'verde',hex:0x0A5C40,css:'#0A5C40',inside:0x0A1C15,bogie:0x1E2022,ink:'#E6E8E2'}
};
function partsTT6(load){
  const M={};const add=(key,A)=>{if(!M[key])M[key]=arrNew();arrPush(M[key],A);};
  const S=arrNew(),Bd=arrNew(),In=arrNew();
  const uvS=(s,z,y)=>[(s<0?(z+6.1):(6.1-z))/12.2,(y-0.9)/3.1];
  // upper hopper: longitudinal strips of the section, each running between the sloping ends
  [-1,1].forEach(s=>{for(let i=0;i<RT.UP.length-1;i++){const a=RT.UP[i],b=RT.UP[i+1],za=tt6End(a[1]),zb=tt6End(b[1]);
    const p=[[s*a[0],a[1],-za],[s*a[0],a[1],za],[s*b[0],b[1],zb],[s*b[0],b[1],-zb]];
    quadN(S,p,p.map(q=>uvS(s,q[2],q[1])),[s*(b[1]-a[1]),-(b[0]-a[0]),0]);}});
  // sloping end walls (planar), closed under the mouth rim
  const sec=[[-RT.UP[0][0],RT.UP[0][1]],[RT.UP[0][0],RT.UP[0][1]]].concat(RT.UP.slice(1).map(p=>[p[0],p[1]]),RT.UP.slice(1).reverse().map(p=>[-p[0],p[1]]));
  [-1,1].forEach(e=>{polyN(Bd,sec.map(p=>[p[0],p[1],e*tt6End(p[1])]),[0,0.5,e]);});
  // top: end decks and the narrow rims beside the mouth
  [-1,1].forEach(e=>{quadN(Bd,[[-0.95,3.97,e*RT.MZ],[0.95,3.97,e*RT.MZ],[0.95,3.97,e*5.96],[-0.95,3.97,e*5.96]],null,[0,1,0]);
    quadN(Bd,[[e*RT.MOUTH,3.97,-RT.MZ],[e*0.95,3.97,-RT.MZ],[e*0.95,3.97,RT.MZ],[e*RT.MOUTH,3.97,RT.MZ]],null,[0,1,0]);});
  // inside: walls under the mouth and a floor ridge at each compartment, central divider
  [-1,1].forEach(e=>{quadN(In,[[e*RT.MOUTH,3.97,-RT.MZ],[e*RT.MOUTH,3.97,RT.MZ],[e*RT.MOUTH,2.95,RT.MZ],[e*RT.MOUTH,2.95,-RT.MZ]],null,[-e,0,0]);
    quadN(In,[[-RT.MOUTH,3.97,e*RT.MZ],[RT.MOUTH,3.97,e*RT.MZ],[RT.MOUTH,2.95,e*RT.MZ],[-RT.MOUTH,2.95,e*RT.MZ]],null,[0,0,-e]);
    [[0.35,RT.MZ]].forEach(([z0,z1])=>{[-1,1].forEach(s=>quadN(In,[[0,3.10,e*z0],[0,3.10,e*z1],[s*RT.MOUTH,2.70,e*z1],[s*RT.MOUTH,2.70,e*z0]],null,[s*0.4,1,0]));});
    quadN(In,[[-RT.MOUTH,3.62,e*0.30],[RT.MOUTH,3.62,e*0.30],[RT.MOUTH,2.70,e*0.95],[-RT.MOUTH,2.70,e*0.95]],null,[0,0.5,e]);});
  quadN(Bd,[[-RT.MOUTH,3.62,-0.30],[RT.MOUTH,3.62,-0.30],[RT.MOUTH,3.62,0.30],[-RT.MOUTH,3.62,0.30]],null,[0,1,0]);
  // lower part: side discharge doors (gap in the middle), ends, the shadowed recess in the gap
  [-1,1].forEach(s=>{const x=s*RT.LOW;[[-RT.LZ,-RT.GAP],[RT.GAP,RT.LZ]].forEach(([z0,z1])=>{const p=[[x,RT.LY0,z0],[x,RT.LY0,z1],[x,RT.LY1,z1],[x,RT.LY1,z0]];quadN(S,p,p.map(q=>uvS(s,q[2],q[1])),[s,0,0]);});
    [-1,1].forEach(k=>quadN(Bd,[[x,RT.LY0,k*RT.GAP],[s*1.05,RT.LY0,k*RT.GAP],[s*1.05,RT.LY1,k*RT.GAP],[x,RT.LY1,k*RT.GAP]],null,[0,0,-k]));
    add('dark',boxA(s*1.05,RT.LY0,0,0.04,RT.LY1-RT.LY0,2*RT.GAP));
    quadN(Bd,[[x,RT.LY1,-RT.LZ],[s*1.41,RT.LY1,-RT.LZ],[s*1.41,RT.LY1,RT.LZ],[x,RT.LY1,RT.LZ]],null,[0,1,0]);});
  [-1,1].forEach(e=>quadN(Bd,[[-RT.LOW,RT.LY0,e*RT.LZ],[RT.LOW,RT.LY0,e*RT.LZ],[RT.LOW,RT.LY1,e*RT.LZ],[-RT.LOW,RT.LY1,e*RT.LZ]],null,[0,0,e]));
  add('side',S);add('body',Bd);add('inside',In);
  // underframe: solebars, end platforms, headstocks, buffers, couplers, ladders and handrails
  [-1,1].forEach(s=>add('dark',boxA(s*1.20,0.80,0,0.16,0.16,11.9)));
  [-1,1].forEach(e=>{add('dark',boxA(0,0.88,e*5.70,2.70,0.08,0.60));add('body',boxA(0,0.90,e*5.98,2.30,0.32,0.16));
    [-1,1].forEach(s=>{add('dark',cylA(s*0.875,1.06,e*6.12,0.11,0.30,8,PI/2,0,0));add('buf',cylA(s*0.875,1.06,e*6.245,0.21,0.05,12,PI/2,0,0));
      const x=s*1.42,z=e*5.62;add('body',rodA([x,0.55,z],[x,2.45,z],0.04));add('body',rodA([x,0.55,e*5.88],[x,1.95,e*5.88],0.04));
      [0.65,0.95,1.25,1.55,1.85].forEach(y=>add('body',rodA([x,y,z],[x,y,e*5.88],0.03)));});
    add('dark',boxA(0,0.96,e*6.10,0.12,0.12,0.40));});
  add('dark',boxA(0,0.40,0,1.2,0.50,1.6));
  // two Y25 bogies: side frames, bolster, axleboxes with springs, wheels and axles
  [-1,1].forEach(e=>{const zc=e*RT.PIV;add('bogie',boxA(0,0.52,zc,2.0,0.22,0.42));
    [-1,1].forEach(s=>{add('bogie',boxA(s*1.08,0.46,zc,0.14,0.30,2.4));add('bogie',boxA(s*1.08,0.36,zc,0.12,0.12,3.30));
      [-1,1].forEach(k=>{const z=zc+k*RT.AXB;add('bogie',boxA(s*1.10,0.30,z,0.22,0.34,0.32));add('bogie',cylA(s*1.10,0.76,z,0.10,0.22,8));});});
    [-1,1].forEach(k=>{const z=zc+k*RT.AXB;add('dark',cylA(0,RT.RW,z,0.07,1.62,6,0,0,PI/2));
      [-1,1].forEach(s=>add('wheel',cylA(s*0.79,RT.RW,z,RT.RW,0.13,12,0,0,PI/2)));});});
  // coal: a low heap in each compartment, a little above the rim
  if(load){const C=arrNew(),xs=[-RT.MOUTH,-0.44,0,0.44,RT.MOUTH];
    [-1,1].forEach(e=>{const zs=[0.32,1.2,2.8,4.3,RT.MZ].map(z=>e*z);
      const h=(x,z)=>{const fx=1-Math.abs(x)/RT.MOUTH,az=Math.abs(z),fz=Math.min(1,(az-0.32)/0.9,(RT.MZ-az)/0.9);return 3.86+0.17*Math.max(0,fx)*Math.max(0,fz)+0.03*Math.sin(az*3.1+x*5);};
      const o=C.pos.length/3;zs.forEach(z=>xs.forEach(x=>{C.pos.push(x,h(x,z),z);C.uv.push(x/0.6,z/0.6);}));
      for(let i=0;i<zs.length-1;i++)for(let j=0;j<xs.length-1;j++){const a=o+i*5+j,b=a+1,c=a+6,d=a+5;if(e>0)C.idx.push(a,b,c,a,c,d);else C.idx.push(a,c,b,a,d,c);}});
    add('coal',C);}
  return{M:M};
}
function paintTT6(c,W,H,liv){
  const L=TT6L[liv],X=z=>(z+6.1)/12.2*W,Y=y=>(1-(y-0.9)/3.1)*H,hpm=W/12.2,vpm=H/3.1,kx=hpm/vpm;
  const rect=(z0,z1,y0,y1,col)=>{c.fillStyle=col;c.fillRect(X(z0),Y(y1),X(z1)-X(z0),Y(y0)-Y(y1));};
  c.fillStyle=L.css;c.fillRect(0,0,W,H);
  // weathering: vertical streaks and grime towards the bottom
  let sd=11;const rn=()=>{sd=(sd*16807)%2147483647;return sd/2147483647;};
  for(let i=0;i<160;i++){const z=-6+rn()*12;c.fillStyle='rgba('+(rn()<0.5?'0,0,0':'255,255,255')+','+(0.012+rn()*0.03)+')';c.fillRect(X(z),Y(3.95),Math.max(1,rn()*hpm*0.08),Y(0.95)-Y(3.95));}
  const g=c.createLinearGradient(0,Y(2.45),0,Y(0.95));g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,0.20)');c.fillStyle=g;c.fillRect(0,Y(2.45),W,Y(0.95)-Y(2.45));
  // upper hopper: vertical stiffeners, the edge under the shoulders, the lower edge
  [-4.82,-3.57,-2.07,-0.82,0.78,2.08,3.58,4.83].forEach(z=>{rect(z-0.03,z+0.03,2.45,3.25,'rgba(0,0,0,0.35)');rect(z-0.03,z-0.01,2.45,3.25,'rgba(255,255,255,0.12)');});
  rect(-6.1,6.1,3.12,3.16,'rgba(0,0,0,0.25)');rect(-6.1,6.1,2.42,2.46,'rgba(0,0,0,0.45)');rect(-6.1,6.1,0.95,0.99,'rgba(0,0,0,0.4)');
  // door panels: edges of the two discharge doors
  [[-5.38,-0.32],[0.32,5.38]].forEach(([a,b])=>{c.strokeStyle='rgba(0,0,0,0.35)';c.lineWidth=2;c.strokeRect(X(a),Y(2.40),X(b)-X(a),Y(1.0)-Y(2.40));});
  const txt=(s,z,y,h,a,w,col)=>{c.save();c.translate(X(z),Y(y));c.scale(kx,1);c.fillStyle=col||L.ink;c.font=(w||'600')+' '+Math.max(6,Math.round(vpm*h))+'px "Barlow",system-ui,sans-serif';
    c.textAlign=a||'left';c.textBaseline='alphabetic';c.fillText(s,0,0);c.restore();};
  const box=(z0,z1,y0,y1)=>{c.strokeStyle=L.ink;c.lineWidth=1.5;c.strokeRect(X(z0),Y(y1),X(z1)-X(z0),Y(y0)-Y(y1));};
  ['32 RIV','71 RENFE','665 0 098-6','.Fals'].forEach((s,i)=>txt(s,-5.22,2.17-i*0.17,0.13));
  rect(-5.22,-4.82,1.10,1.52,'#D8DADB');for(let z=-5.19;z<-4.84;z+=0.05)rect(z,z+0.012,1.12,1.50,'#8A8E90');rect(-4.72,-4.32,1.10,1.52,'#2A2C2E');
  box(-4.13,-3.80,1.58,1.70);txt('70,0 m³',-3.96,1.61,0.06,'center');box(-4.13,-3.80,1.38,1.50);txt('R 75 m',-3.96,1.41,0.06,'center');
  box(-3.55,-3.05,1.58,1.70);txt('26500 kg',-3.30,1.61,0.06,'center');txt('53,5 t',-3.30,1.48,0.06,'center');
  box(-2.45,-1.67,1.27,1.43);txt('A  B  B  C',-2.06,1.37,0.05,'center');txt('S  37,9  47,2  55,2',-2.06,1.29,0.045,'center');
  txt('TT',-1.15,1.75,0.13);txt('fvce',-0.98,1.83,0.06);txt('202.210',-0.78,1.75,0.13);
  txt('↔ 12,54 m ↔',-1.35,1.22,0.045);txt('.Fals 32 71 665 0 098-6',0.35,1.04,0.045);
  txt('KE-GP',2.60,1.12,0.05);txt('REG DRV2A-600',2.60,1.03,0.05);box(2.40,3.30,1.28,1.38);txt('3 REV',2.45,1.30,0.05);txt('→ 7,5 m ←',3.60,1.04,0.045);
  box(4.15,5.00,1.77,2.12);['— ATENCIÓN —','PRECAUCIÓN EN LAS MANIOBRAS','COMPUERTAS CON APERTURA','Y CIERRE RÁPIDO'].forEach((s,i)=>txt(s,4.575,2.06-i*0.075,0.04,'center','500'));
  txt('E',4.20,1.62,0.10);
  rect(4.33,4.75,1.04,1.33,'#1D3C8C');txt('PARA ESPAÑA',4.35,1.28,0.035,'left','600','#F2F2F2');['TARA 26.500','CARGA 53.500','EJE 20.000'].forEach((s,i)=>txt(s,4.35,1.21-i*0.06,0.035,'left','600','#F2F2F2'));
}
const TEXT6={};
function texTT6(liv){
  if(TEXT6[liv])return TEXT6[liv];
  if(!TEXT6.shared){const ct=canvasTex(128,128,(c,w,h)=>{c.fillStyle='#1A1A1B';c.fillRect(0,0,w,h);let sd=5;const rn=()=>{sd=(sd*16807)%2147483647;return sd/2147483647;};
      for(let i=0;i<900;i++){const v=Math.floor(10+rn()*48);c.fillStyle='rgb('+v+','+v+','+(v+2)+')';c.fillRect(rn()*w,rn()*h,1+rn()*4,1+rn()*3);}},true);
    const coal=new THREE.MeshLambertMaterial({map:ct,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(coal,0x1A1A1B);
    TEXT6.shared={dark:tmat(0x1B1B1B),wheel:tmat(0x2E2E2E),buf:tmat(0x2A2A2A),coal:coal};}
  const L=TT6L[liv],t=canvasTex(2048,512,(c,w,h)=>paintTT6(c,w,h,liv));t.anisotropy=8;
  const side=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(side,L.hex);
  TEXT6[liv]={side:side,tex:t,solid:Object.assign({},TEXT6.shared,{body:tmat(L.hex),inside:tmat(L.inside),bogie:tmat(L.bogie)})};
  return TEXT6[liv];
}
const PTT6={};
function buildTT6(tr,sp){
  const T=texTT6(sp.liv||'rojo'),k=sp.load?1:0,P=PTT6[k]||(PTT6[k]=partsTT6(k));
  const g=new THREE.Group(),inner=new THREE.Group(),body=[];g.add(inner);if(sp.flip)inner.rotation.y=PI;
  Object.keys(P.M).forEach(key=>{const mat=key==='side'?T.side:T.solid[key];
    const m=new THREE.Mesh(geoFromArrays(P.M[key]),mat);m.castShadow=true;m.receiveShadow=true;inner.add(m);
    if(key==='side'||key==='body'){m.userData.ent=tr.ent;body.push(m);}});
  return{g:g,L:sp.L,body:body};
}
/* ---------------------------------------------------------------------
   Renfe serie 319 (319.2/.3/.4) · librea "taxi" · low poly a partir del
   paquete VAT de Trainz (Jjlor & Txus; uso privado). Forma medida por
   ray-casting sobre la malla: caja de sección constante con chaflanes en
   el techo, testeros con parabrisas inclinados, faldón negro y quitanieves.
   Ficha (Wikipedia): 19,50 m entre topes, 3,08 m de ancho (el modelo mide
   2,80: las x se escalan con SX319), ruedas de 1.067, Co'Co'. Pivotes de
   bogie del modelo a ±5,855; empate de bogie de 2 × 2,07 m (bogie GM tipo
   HT-C, aproximado). Mismos amarillo y gris que la 252 y la 269; se omiten
   los logotipos de Renfe.
   --------------------------------------------------------------------- */
const SX319=3.08/2.80;
const R319={L:19.50,ZE:9.45,HALF:1.54,W:3.08,BOG:5.855,AXS:2.07,RW:0.533,TOP:3.98,BOT:1.45,CAB:6.96,SK:1.12};
const PROF319=(function(){
  const h=[[1.54,1.45],[1.54,2.40],[1.54,3.45],[1.53,3.50],[1.44,3.60],[1.35,3.70],[1.25,3.80],[1.17,3.90],[1.10,3.95],[0.66,3.975],[0,3.98]];
  const n=h.length,pts=[];for(let i=0;i<n;i++)pts.push([-h[i][0],h[i][1]]);for(let i=n-2;i>=0;i--)pts.push([h[i][0],h[i][1]]);
  const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  const tot=cum[cum.length-1];return{h:h,n:n,pts:pts,v:cum.map(c=>c/tot),tot:tot,top:3.98};
})();
/* cab front: measured face z at the centreline, a 0.15 m plan-view corner */
const FZ319=[[1.45,9.30],[1.6,9.35],[2.0,9.41],[2.4,9.45],[2.8,9.45],[3.0,9.40],[3.2,9.34],[3.4,9.29],[3.6,9.23],[3.8,9.18],[3.95,9.10],[3.98,9.05]];
function faceZ319(x,y){const r=0.15,d=Math.abs(x)-(R319.HALF-r),c=d<=0?0:r-Math.sqrt(Math.max(0,r*r-d*d));return plS(FZ319,y)-c;}
function ring319(z,u){return{u:u,pts:PROF319.pts.map(p=>[p[0],p[1],z])};}
function ringEnd319(e,u){return{u:u,pts:PROF319.pts.map(p=>[p[0],p[1],e*faceZ319(p[0],p[1])])};}
const CAPF319=[-1,-0.97,-0.9,-0.75,-0.5,-0.25,0,0.25,0.5,0.75,0.9,0.97,1];
function capGrid319(e,uvFn){const A=arrNew(),h=PROF319.h,F=CAPF319,N=F.length-1,rows=[];
  h.forEach(l=>{const xm=l[0],y=l[1],row=[];F.forEach(f=>{const x=xm*f,z=e*faceZ319(x,y);row.push(A.pos.length/3);A.pos.push(x,y,z);const t=uvFn([x,y,z]);A.uv.push(t[0],t[1]);});rows.push(row);});
  for(let j=0;j<rows.length-1;j++)for(let i=0;i<N;i++){const a=rows[j][i],b=rows[j][i+1],c=rows[j+1][i+1],d=rows[j+1][i];
    if(e>0)A.idx.push(a,b,c,a,c,d);else A.idx.push(a,c,b,a,d,c);}
  return A;}
function parts319(){
  const ZE=R319.ZE,HALF=R319.HALF,M={};const add=(key,A)=>{if(!M[key])M[key]=arrNew();arrPush(M[key],A);};
  const u=z=>(z+ZE)/(2*ZE);
  add('side',loft([ringEnd319(-1,0),ring319(-ZE+0.6,u(-ZE+0.6)),ring319(ZE-0.6,u(ZE-0.6)),ringEnd319(1,1)],PROF319));
  add('front',capGrid319(1,p=>[(p[0]+HALF)/R319.W,(p[1]-R319.BOT)/(R319.TOP-R319.BOT)]));
  add('front',capGrid319(-1,p=>[(HALF-p[0])/R319.W,(p[1]-R319.BOT)/(R319.TOP-R319.BOT)]));
  // black skirt: full width under the cabs, recessed between them; frame sill
  [-1,1].forEach(e=>{const z1=9.17,z0=6.60;add('black',boxA(0,R319.SK,e*(z0+z1)/2,2*HALF,R319.BOT-R319.SK+0.01,z1-z0));});
  add('black',boxA(0,R319.SK,0,2*0.91,R319.BOT-R319.SK+0.01,13.3));add('black',boxA(0,0.98,0,2.26,0.15,13.3));
  // ends: snowplough with sloping side plates, buffer beam, buffers with square pads, hook and hoses
  const P=arrNew();
  [-1,1].forEach(e=>{[-1,1].forEach(s=>polyN(P,[[s*1.40,R319.SK,e*8.55],[s*1.40,R319.SK,e*9.30],[s*1.40,0.22,e*9.30],[s*1.40,0.22,e*9.02]],[s,0,0]));
    quadN(P,[[-1.40,0.22,e*9.30],[1.40,0.22,e*9.30],[1.40,R319.SK,e*9.30],[-1.40,R319.SK,e*9.30]],null,[0,0,e]);
    quadN(P,[[-1.40,0.22,e*9.02],[1.40,0.22,e*9.02],[1.40,0.22,e*9.30],[-1.40,0.22,e*9.30]],null,[0,-1,0]);
    add('black',boxA(0,0.76,e*9.37,2.90,0.36,0.14));
    [-0.93,0.93].forEach(x=>{add('dark',cylA(x,1.0,e*9.58,0.12,0.30,10,PI/2,0,0));add('black',boxA(x,0.81,e*9.725,0.70,0.38,0.05));});
    add('dark',boxA(0,0.88,e*9.55,0.16,0.20,0.36));
    [-1,1].forEach(s=>[0.28,0.42].forEach(x=>add('hose',rodA([s*x,0.95,e*9.40],[s*x,0.28,e*9.50],0.035))));
    // lamps: two round headlamps, red tail lamps over them, red marker low right; headlight box on the roof front
    const fz=(x,y)=>faceZ319(x,y),lead=e>0;
    [-1.05,1.05].forEach(x=>{add('grey',cylA(x,2.14,e*(fz(x,2.14)+0.01),0.13,0.06,12,PI/2,0,0));add(lead?'lightW':'lampOffW',cylA(x,2.14,e*(fz(x,2.14)+0.045),0.10,0.03,12,PI/2,0,0));
      add('dark',boxA(x,2.29,e*(fz(x,2.32)+0.02),0.16,0.09,0.04));add(lead?'lampOffR':'lightR',boxA(x,2.30,e*(fz(x,2.32)+0.045),0.08,0.06,0.02));});
    add(lead?'lampOffR':'lightR',cylA(e*0.66,1.49,e*(fz(0.66,1.6)-0.02),0.09,0.04,12,PI/2,0,0));
    add('yellow',boxA(0,3.62,e*(fz(0,3.8)-0.12),0.50,0.30,0.30));add('dark',boxA(0,3.70,e*(fz(0,3.8)+0.035),0.40,0.15,0.02));
    add(lead?'lightW':'lampOffW',boxA(0,3.71,e*(fz(0,3.8)+0.05),0.34,0.11,0.01));
    // wipers, horns, roof unit over the cab, corner and door handrails
    [-1,1].forEach(s=>add('dark',rodA([s*0.60,2.86,e*(fz(s*0.6,2.86)+0.02)],[s*0.82,3.36,e*(fz(s*0.82,3.36)+0.02)],0.025)));
    [0.55,0.75].forEach((x,i)=>add('grey',cylA(x,4.06,e*(8.85-i*0.1),0.09-0.03*i,0.30,8,PI/2,0,0)));
    add('yellow',boxA(0,3.97,e*8.17,1.34,0.22,1.15));[-0.25,0.25].forEach(x=>add('dark',boxA(x,4.191,e*8.17,0.42,0.005,0.90)));
    [-1,1].forEach(s=>{[7.22,7.82].forEach(z=>add('black',rodA([s*(HALF+0.03),1.40,e*z],[s*(HALF+0.03),3.10,e*z],0.035)));
      add('black',rodA([s*(HALF+0.03),1.70,e*9.05],[s*(HALF+0.03),2.95,e*9.05],0.035));});
  });
  add('black',P);
  // roof: cooling fan, hatch, radiator grille over the +z end
  add('grille',cylA(0,3.99,-4.80,0.78,0.04,20));add('dark',cylA(0,4.02,-4.80,0.36,0.03,14));
  add('dark',boxA(0,3.975,-2.20,0.95,0.04,1.10));add('dark',boxA(0,3.975,5.45,2.10,0.02,2.90));
  for(let z=4.1;z<6.85;z+=0.18)add('grille',boxA(0,3.995,z,2.0,0.01,0.05));
  // underframe: fuel tank, two air reservoirs, battery box
  add('black',boxA(0,0.30,1.35,2.30,0.72,2.95));[-2.75,-2.05].forEach(z=>add('dark',cylA(0,0.62,z,0.33,2.3,12,0,0,PI/2)));add('grey',boxA(0,0.55,-0.80,1.10,0.45,0.95));
  // Co'Co' bogies: side frames, three axles with axleboxes and coil springs, motors, bolster
  [-R319.BOG,R319.BOG].forEach(zc=>{[-1,1].forEach(s=>{add('bogie',boxA(s*1.12,0.48,zc,0.20,0.40,5.1));add('bogie',boxA(s*1.12,0.86,zc,0.26,0.10,4.6));
      [-1,0,1].forEach(k=>{const z=zc+k*R319.AXS;add('bogie',boxA(s*1.15,0.32,z,0.30,0.42,0.40));add('bogie',cylA(s*1.15,0.86,z,0.12,0.26,8));
        add('wheel',cylA(s*0.79,R319.RW,z,R319.RW,0.14,16,0,0,PI/2));});});
    [-1,0,1].forEach(k=>{const z=zc+k*R319.AXS;add('dark',cylA(0,R319.RW,z,0.08,1.6,6,0,0,PI/2));add('bogie',boxA(0,0.36,z+0.55*(k||1),1.1,0.55,0.55));});
    add('bogie',boxA(0,0.88,zc,2.3,0.14,0.6));});
  return{M:M,L:R319.L};
}
/* ---- livery: yellow cabs and roof band over a grey hood, black skirt (taxi, same tones as the 252/269) ---- */
const LIV319={yellow:'#EFC501',grey:'#2C2C2E',black:'#18191A',roof:'#2E3032',glass:'#262B30',glass2:'#55606A',rubber:'#141618',louvre:'#1C1D1F',louvre2:'#3E4144',frame:'#7C8285',white:'#DEDEDC',ochre:'#A07E1C'};
function paintCar319(c,W,H,num){
  const P=PROF319,ZE=R319.ZE,CAB=R319.CAB,X=z=>(z+ZE)/(2*ZE)*W,Y=(y,s)=>(1-vProf(P,y,s))*H;
  const kx=(W/(2*ZE))/(H/(2*P.tot));
  const rect=(y0,y1,z0,z1,col)=>{c.fillStyle=col;[-1,1].forEach(s=>{const ya=Y(y0,s),yb=Y(y1,s);c.fillRect(X(z0),Math.min(ya,yb),Math.max(1,X(z1)-X(z0)),Math.abs(yb-ya)+0.7);});};
  const poly=(pts,col)=>{c.fillStyle=col;[-1,1].forEach(s=>{c.beginPath();pts.forEach((p,i)=>{const x=X(p[0]),y=Y(p[1],s);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.fill();});};
  c.fillStyle=LIV319.grey;c.fillRect(0,0,W,H);
  rect(3.76,3.98,-CAB,CAB,LIV319.roof);rect(3.53,3.76,-ZE-0.5,ZE+0.5,LIV319.yellow);
  [[-ZE-0.5,-CAB],[CAB,ZE+0.5]].forEach(r=>rect(1.64,3.98,r[0],r[1],LIV319.yellow));
  rect(1.45,1.64,-ZE-0.5,ZE+0.5,LIV319.black);
  // hood: radiator louvres (-z), slatted grille (+z), top grille boxes, number panel and joints
  rect(1.81,3.21,-6.46,-3.81,LIV319.louvre);
  for(let i=0;i<6;i++)for(let j=0;j<4;j++){const z0=-6.40+i*0.44,y0=1.86+j*0.34;for(let y=y0;y<y0+0.30;y+=0.05)rect(y,y+0.022,z0,z0+0.38,LIV319.louvre2);}
  rect(1.81,2.81,4.04,6.96,LIV319.louvre);for(let z=4.08;z<6.92;z+=0.06)rect(1.84,2.78,z,z+0.025,LIV319.louvre2);
  rect(3.33,3.98,-6.46,-4.26,LIV319.frame);rect(3.38,3.93,-6.40,-4.32,LIV319.louvre);for(let z=-6.36;z<-4.34;z+=0.07)rect(3.40,3.91,z,z+0.03,LIV319.louvre2);
  [[1.63,1.66,-2.81,2.94],[3.41,3.44,-2.81,2.94]].forEach(r=>rect(r[0],r[1],r[2],r[3],'rgba(0,0,0,.35)'));
  [-2.81,2.94,3.98,-3.75].forEach(z=>rect(1.64,3.52,z-0.012,z+0.012,'rgba(0,0,0,.35)'));
  // cabs: side window with the sloping front edge, door and its outline
  [-1,1].forEach(e=>{const w=[[e*8.16,2.68],[e*8.16,3.36],[e*8.91,3.36],[e*9.16,2.80],[e*9.16,2.68]];
    poly(w.map(p=>[p[0]+(e>0?0.04:-0.04),p[1]]),LIV319.rubber);poly(w.map(p=>[p[0]-(e>0?0.0:0),p[1]]),LIV319.glass);
    rect(3.05,3.33,Math.min(e*8.16,e*8.86),Math.max(e*8.16,e*8.86),LIV319.glass2);rect(2.68,3.36,e*8.86-0.02,e*8.86+0.02,LIV319.rubber);
    const d0=Math.min(e*7.25,e*7.80),d1=Math.max(e*7.25,e*7.80);
    [[1.71,1.74,d0,d1],[3.23,3.26,d0,d1]].forEach(r=>rect(r[0],r[1],r[2],r[3],'rgba(0,0,0,.40)'));rect(1.71,3.26,d0-0.015,d0+0.015,'rgba(0,0,0,.40)');rect(1.71,3.26,d1-0.015,d1+0.015,'rgba(0,0,0,.40)');
    rect(2.30,2.40,e>0?d0+0.06:d1-0.10,e>0?d0+0.10:d1-0.06,'#3A3C3E');});
  // weathering on the hood
  c.fillStyle='rgba(255,255,255,.03)';for(let z=-6.9;z<6.9;z+=0.23)rect(1.66,3.52,z,z+0.08,'rgba(255,255,255,.025)');
  // running number: '319' big and the unit small (319.3 units carry '319.3' in ochre); UIC number under it
  const sub=num.charAt(4),big='319',small='',col=sub==='3'?LIV319.ochre:LIV319.white;/* only the series figure, as on the 252 and 269 */
  [-1,1].forEach(s=>{const fitBox=(str,z0,y0,wm,hm,fill)=>{c.textBaseline='alphabetic';c.font='700 200px "Barlow",system-ui,sans-serif';
      const m=c.measureText(str),tw=m.width,cap=m.actualBoundingBoxAscent||140,wpx=wm*W/(2*ZE),hpx=Math.abs(Y(y0,s)-Y(y0+hm,s));
      c.save();c.translate(X(s<0?z0:-z0),Y(y0,s));c.scale(s>0?-1:1,s>0?-1:1);c.scale(wpx/tw,hpx/cap);c.fillStyle=fill;c.textAlign='left';c.fillText(str,0,0);c.restore();};
    const bw=2.70;fitBox(big,-2.71,1.86,bw,1.35,col);if(small)fitBox(small,-2.71+bw+0.05,1.86,1.55,0.65,col);
    c.textBaseline='middle';c.save();c.translate(X(s<0?-0.74:0.74),Y(1.53,s));c.scale(s>0?-kx:kx,s>0?-1:1);c.fillStyle=LIV319.white;
    c.font='600 '+Math.round(H/(2*P.tot)*0.11)+'px "Barlow",sans-serif';c.textAlign='center';c.fillText(num,0,0);c.restore();});
}
function paintFront319(c,W,H,num){
  const U=x=>(x+R319.HALF)/R319.W*W,V=y=>(1-(y-R319.BOT)/(R319.TOP-R319.BOT))*H;
  c.fillStyle=LIV319.yellow;c.fillRect(0,0,W,H);
  c.fillStyle=LIV319.black;c.fillRect(0,V(1.64),W,H-V(1.64));
  // outline of the lower panel (handrail line) and the roof chamfer shading
  c.strokeStyle='rgba(0,0,0,.55)';c.lineWidth=3;c.beginPath();c.moveTo(U(-1.42),V(1.66));c.lineTo(U(-1.42),V(2.62));c.quadraticCurveTo(U(-1.42),V(2.72),U(-1.30),V(2.72));
  c.lineTo(U(1.30),V(2.72));c.quadraticCurveTo(U(1.42),V(2.72),U(1.42),V(2.62));c.lineTo(U(1.42),V(1.66));c.stroke();
  const g=c.createLinearGradient(0,V(3.44),0,V(2.79));g.addColorStop(0,'#7E8E9B');g.addColorStop(0.3,'#4C5962');g.addColorStop(1,'#1E252A');
  [[-1.42,-0.15],[0.15,1.42]].forEach(p=>{c.fillStyle=LIV319.rubber;c.beginPath();const x0=U(p[0]-0.04),x1=U(p[1]+0.04),y0=V(3.48),y1=V(2.75);
    if(c.roundRect)c.roundRect(x0,y0,x1-x0,y1-y0,12);else c.rect(x0,y0,x1-x0,y1-y0);c.fill();
    c.fillStyle=g;c.beginPath();const gx0=U(p[0]),gx1=U(p[1]),gy0=V(3.44),gy1=V(2.79);if(c.roundRect)c.roundRect(gx0,gy0,gx1-gx0,gy1-gy0,9);else c.rect(gx0,gy0,gx1-gx0,gy1-gy0);c.fill();
    c.fillStyle='rgba(255,255,255,.12)';c.fillRect(gx0+5,gy0+4,gx1-gx0-10,4);});
  c.save();c.translate(U(0),V(2.48));c.scale((W/R319.W)/(H/(R319.TOP-R319.BOT)),1);
  c.fillStyle='#141414';c.font='700 '+Math.round(H*0.065)+'px "Barlow",system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(num,0,0);c.restore();
  c.fillStyle='rgba(0,0,0,.14)';c.fillRect(0,V(3.52),W,2);
}
const TEX319={};
function tex319(num){
  if(TEX319[num])return TEX319[num];
  const base=tex470();
  if(!TEX319.solid){TEX319.solid=Object.assign({},base.solid,{yellow:tmat(0xEFC501),black:tmat(0x18191A),grille:tmat(0x5A5F62),hose:tmat(0x1A1A1A)});}
  const mk=(t,hex)=>{const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,hex);return m;};
  const car=canvasTex(2048,512,(c,w,h)=>paintCar319(c,w,h,num));car.anisotropy=8;const fr=canvasTex(512,512,(c,w,h)=>paintFront319(c,w,h,num));fr.anisotropy=4;
  TEX319[num]={side:mk(car,0x2C2C2E),front:mk(fr,0xEFC501),car:car,fr:fr};return TEX319[num];
}
let P319=null;
function build319(tr,sp){
  const num=sp.num||'319.228.3',T=tex319(num),S=TEX319.solid,P=P319||(P319=parts319());
  const g=new THREE.Group(),body=[];
  Object.keys(P.M).forEach(key=>{const mat=key==='side'?T.side:(key==='front'?T.front:S[key]);
    const m=new THREE.Mesh(geoFromArrays(P.M[key]),mat);m.castShadow=!/^light/.test(key);m.receiveShadow=true;g.add(m);
    if(key==='side'||key==='front'){m.userData.ent=tr.ent;body.push(m);}});
  return{g:g,L:sp.L,body:body};
}
/* ---------------------------------------------------------------------
   Coches Renfe serie 10000 (CAF, Macosa y Babcock & Wilcox, 1984) · paquete
   STR_Renfe10000_OR de SpainTrainzRutas para Open Rails (uso privado).
   38 coches en 7 libreas: Estrella, Transición, Largo Recorrido, Grandes
   Líneas, Renfe Operadora, Prueba de pintura y Paquexpres. Caja low poly con
   las cotas del modelo: caja ±13.05 × ±1.411, costado 0.95–3.15, techo hasta
   4.00, topes a ±13.20, bogies Gran Confort a ±9.5 con ejes a 2.45 m y ruedas
   de 0.965 m. Costados, testeros, techo y puertas llevan las texturas
   originales recortadas, sin logotipos (galleta, Largo Recorrido, Grandes
   Líneas, renfe, Intercity, Club, Paquexpres y la palabra RENFE).
   --------------------------------------------------------------------- */
/* R10K_IMG: material.js */
const r10uv=(col,row)=>[col/R10.AW,1-row/R10.AH];
function parts10k(car){
  const C=R10K[car],M={};const add=(k,A)=>{if(!M[k])M[k]=arrNew();arrPush(M[k],A);};
  const T=arrNew(),ZE=R10.ZE,SX=R10.SX,SEC=R10.SEC;
  // sides: game −x shows the model's + side strip (atlas rows 0..SH), game +x the − side strip (rows SH..2SH)
  [[-1,C.P,0],[1,C.N,R10.SH]].forEach(([s,m,r0])=>{const su=m[0],u0=m[1],y0=m[2],y1=m[3];
    const uv=(z,y)=>r10uv(clamp(su*z+u0,0,1)*R10.AW,r0+(y1-y)/(y1-y0)*R10.SH);
    const q=(za,zb,ya,yb,x)=>quadN(T,[[x,ya,za],[x,ya,zb],[x,yb,zb],[x,yb,za]],[uv(za,ya),uv(zb,ya),uv(zb,yb),uv(za,yb)],[s,0,0]);
    q(-ZE,ZE,R10.YS,R10.YT,s*SX);           // body side
    q(-7.9,7.9,0.62,R10.YS,s*1.30);       // underframe skirt between the bogies, painted with the lower rows of the strip
  });
  // roof: the arc of the section lofted end to end, with the planked roof of the livery
  const ring=SEC.map(p=>[-p[0],p[1]]).concat(SEC.slice(0,-1).reverse());
  const ruv=(x,z)=>r10uv(128+((0.019*z+0.387)-0.135)/0.51*512,784+((0.103*(-x)+0.694)-0.545)/0.30*240);
  for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1],n=[(a[0]+b[0])/2,(a[1]+b[1])/2-2.6,0];
    quadN(T,[[a[0],a[1],-ZE],[b[0],b[1],-ZE],[b[0],b[1],ZE],[a[0],a[1],ZE]],[ruv(a[0],-ZE),ruv(b[0],-ZE),ruv(b[0],ZE),ruv(a[0],ZE)],n);}
  // end walls (gangway, lamps, stripes) from the end view of the texture
  const euv=(x,y)=>r10uv((0.0383*(-x)+0.056)/0.112*128,784+((0.728-0.075*y)-0.437)/0.263*240);
  const wall=[[-SX,0.70],[SX,0.70]].concat(SEC.map(p=>[p[0],p[1]]),SEC.slice(0,-1).reverse().map(p=>[-p[0],p[1]]));
  [-1,1].forEach(e=>{const z=e*ZE,o=T.pos.length/3;wall.forEach(p=>{T.pos.push(p[0],p[1],z);const t=euv(p[0],p[1]);T.uv.push(t[0],t[1]);});
    for(let i=1;i<wall.length-1;i++){if(e>0)T.idx.push(o,o+i,o+i+1);else T.idx.push(o,o+i+1,o+i);}});
  // doors: plug doors (Faiveley), folding doors (Mielich) or the sliding door of the vans, just proud of the side
  C.d.forEach(([za,zb])=>[-1,1].forEach(s=>{const x=s*1.418;let col,cw,ya,yb,rt,rb;
    if(C.k==='big'){col=768;cw=512;ya=1.105;yb=2.906;}else if(C.k==='mi'){col=640;cw=128;ya=1.151;yb=3.002;}else{col=(C.d2&&s>0)?1280:640;cw=128;ya=0.741;yb=3.133;}
    const u=z=>col+(s<0?(z-za):(zb-z))/(zb-za)*cw;
    quadN(T,[[x,ya,za],[x,ya,zb],[x,yb,zb],[x,yb,za]],[r10uv(u(za),1023),r10uv(u(zb),1023),r10uv(u(zb),784),r10uv(u(za),784)],[s,0,0]);
    if(C.k!=='big')add('dark',boxA(s*1.36,0.60,(za+zb)/2,0.16,0.35,zb-za-0.1));}));   // step under the door
  add('tex',T);
  // ends: rubber gangway, headstock, buffers, coupling
  [-1,1].forEach(e=>{add('rubber',boxA(0,1.02,e*(ZE+0.07),1.05,2.30,0.14));add('dark',boxA(0,0.70,e*(ZE-0.03),2.78,0.44,0.12));
    [-1,1].forEach(s=>{add('dark',cylA(s*0.875,1.06,e*(ZE+0.05),0.12,0.16,10,PI/2,0,0));add('buf',cylA(s*0.875,1.06,e*(ZE+0.13),0.21,0.05,14,PI/2,0,0));});
    add('dark',boxA(0,0.88,e*(ZE+0.06),0.24,0.18,0.24));});
  // underframe equipment between the bogies
  add('dark',boxA(0,0.42,0,2.2,0.52,14.4));add('dark',cylA(0.62,0.66,2.6,0.27,2.6,10,PI/2,0,0));add('dark',boxA(-0.55,0.30,-3.2,0.9,0.5,2.4));
  // Gran Confort bogies: dropped-centre side frames, air springs, axleboxes, dampers
  [-9.5,9.5].forEach(zc=>{
    [-1,1].forEach(s=>{const x=s*1.02;
      [-1,1].forEach(k=>{add('bog',boxA(x,0.50,zc+k*1.25,0.22,0.30,0.95));add('bog',rodA([x,0.62,zc+k*0.82],[x,0.42,zc+k*0.52],0.2));
        add('bog',boxA(x,0.28,zc+k*1.225,0.27,0.38,0.36));add('dark',rodA([x+s*0.13,0.40,zc+k*0.95],[x+s*0.13,0.86,zc+k*0.55],0.07));});
      add('bog',boxA(x,0.30,zc,0.24,0.24,1.1));add('bog',cylA(x,0.86,zc,0.26,0.26,12));});
    add('bog',boxA(0,0.40,zc,1.9,0.22,0.44));
    [-1.225,1.225].forEach(dz=>{add('dark',cylA(0,0.4825,zc+dz,0.08,1.66,8,0,0,PI/2));
      [-1,1].forEach(s=>add('wheel',cylA(s*0.82,0.4825,zc+dz,0.4825,0.13,16,0,0,PI/2)));});});
  return{M:M};
}
const TEX10K={},P10K={};let SH10K=null;
/* the car's atlas (two side strips, end, roof, doors) decoded into a canvas; its window glass lights up at night */
function tex10k(car){
  if(TEX10K[car])return TEX10K[car];
  const cv=document.createElement('canvas');cv.width=R10.AW;cv.height=R10.AH;const x=cv.getContext('2d');x.fillStyle='#6A6C6E';x.fillRect(0,0,cv.width,cv.height);
  const t=new THREE.CanvasTexture(cv);t.encoding=THREE.sRGBEncoding;t.anisotropy=8;t.userData={c:cv};
  const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,0xD8D4CC);
  const T={mat:m,tex:t,n:0,free:0};TEX10K[car]=T;
  const img=new Image();img.onload=()=>{x.drawImage(img,0,0,cv.width,cv.height);t.needsUpdate=true;if(R10K[car].c!=='D')lit10k(m,cv);};img.src=R10K_IMG[car];
  return T;
}
function lit10k(m,cv){
  const w=cv.width/2,h=cv.height/2,mc=document.createElement('canvas');mc.width=w;mc.height=h;const mx=mc.getContext('2d');mx.drawImage(cv,0,0,w,h);
  try{const d=mx.getImageData(0,0,w,h),p=d.data,rows=R10.SH;   // both side strips: rows 0..2·SH at full size = 0..SH here
    // glass is the dark blue-grey of the windows, but only in the window band of each side strip (upper half): the
    // underframe below and the end doors (dark from top to bottom) share that colour and must stay dark
    const sh=rows/2,glass=i=>Math.abs(p[i]-24)+Math.abs(p[i+1]-33)+Math.abs(p[i+2]-40)<36,door=[new Uint8Array(w),new Uint8Array(w)];
    for(let k=0;k<2;k++)for(let x=0;x<w;x++){let n=0;for(let y=k*sh;y<(k+1)*sh;y++)if(glass((y*w+x)*4))n++;door[k][x]=n>0.6*sh?1:0;}
    for(let i=0;i<p.length;i+=4){const y=(i>>2)/w|0,x=(i>>2)%w,k=y<sh?0:1,yr=y-k*sh;
      const g=y<rows&&yr>=0.03*sh&&yr<0.47*sh&&!door[k][x]&&glass(i);p[i]=g?255:0;p[i+1]=g?236:0;p[i+2]=g?204:0;p[i+3]=255;}
    mx.putImageData(d,0,0);}catch(e){mx.fillStyle='#000';mx.fillRect(0,0,w,h);}
  const et=new THREE.CanvasTexture(mc);et.encoding=THREE.sRGBEncoding;m.emissive=new THREE.Color(0xFFD7A0);m.emissiveMap=et;m.emissiveIntensity=NIGHT.N*0.9;m.needsUpdate=true;NIGHT.winMats.push(m);
}
function build10k(tr,sp,last){
  const T=tex10k(sp.car),P=P10K[sp.car]||(P10K[sp.car]=parts10k(sp.car));T.n++;T.free=0;
  if(!SH10K)SH10K={dark:tmat(0x1C1D1F),bog:tmat(0x27292C),wheel:tmat(0x2E2E2E),buf:tmat(0x3C3C3C),rubber:tmat(0x151515)};
  const g=new THREE.Group(),inner=new THREE.Group(),body=[];g.add(inner);if(sp.flip)inner.rotation.y=PI;
  Object.keys(P.M).forEach(key=>{const m=new THREE.Mesh(geoFromArrays(P.M[key]),key==='tex'?T.mat:SH10K[key]);m.castShadow=true;m.receiveShadow=true;inner.add(m);
    if(key==='tex'){m.userData.ent=tr.ent;body.push(m);}});
  // red tail lamps on the last vehicle (rear = −z of the car as it runs)
  if(last){const lm=(TEX470.ready&&TEX470.solid.lightR)||LIGHT_R;[-1,1].forEach(s=>tbox(g,lm,s*1.03,1.26,-(R10.ZE+0.035),0.15,0.15,0.02));}
  return{g:g,L:sp.L,body:body,k10:sp.car};
}

function buildCar(tr,sp,i,n){const c=buildCar0(tr,sp,i,n);c.sk=sp.k;c.sp=sp;c.rev=!!sp.rev;nightFX(c,sp,i);return c;}
/* R432_IMG: material.js */
/* R432_MSK: material.js */
const R432_DOORS={"M_reg":[{"s":-1,"z0":-12.706,"z1":-11.89,"y0":1.295,"y1":2.913,"px":-1.321,"pz":-12.701,"op":1.5707,"c":500,"r":841,"w":62,"h":124},{"s":-1,"z0":4.428,"z1":5.242,"y0":1.272,"y1":2.891,"px":-1.404,"pz":5.243,"op":-1.5707,"c":564,"r":841,"w":62,"h":124},{"s":1,"z0":4.427,"z1":5.242,"y0":1.272,"y1":2.891,"px":1.401,"pz":5.238,"op":1.5707,"c":628,"r":841,"w":62,"h":123},{"s":1,"z0":-12.706,"z1":-11.89,"y0":1.295,"y1":2.913,"px":1.323,"pz":-12.701,"op":-1.5707,"c":692,"r":841,"w":62,"h":124}],"M_ic":[{"s":-1,"z0":-12.706,"z1":-11.89,"y0":1.295,"y1":2.913,"px":-1.321,"pz":-12.701,"op":1.5707,"c":500,"r":841,"w":62,"h":124},{"s":-1,"z0":4.428,"z1":5.242,"y0":1.272,"y1":2.891,"px":-1.404,"pz":5.243,"op":-1.5707,"c":564,"r":841,"w":62,"h":124},{"s":1,"z0":4.427,"z1":5.242,"y0":1.272,"y1":2.891,"px":1.401,"pz":5.238,"op":1.5707,"c":628,"r":841,"w":62,"h":123},{"s":1,"z0":-12.706,"z1":-11.89,"y0":1.295,"y1":2.913,"px":1.323,"pz":-12.701,"op":-1.5707,"c":692,"r":841,"w":62,"h":124}],"Ri_reg":[{"s":-1,"z0":-12.757,"z1":-11.941,"y0":1.295,"y1":2.913,"px":-1.321,"pz":-12.752,"op":1.5707,"c":500,"r":841,"w":62,"h":124},{"s":-1,"z0":11.911,"z1":12.727,"y0":1.272,"y1":2.891,"px":-1.328,"pz":12.727,"op":-1.5707,"c":564,"r":841,"w":62,"h":124},{"s":1,"z0":-12.757,"z1":-11.941,"y0":1.295,"y1":2.913,"px":1.324,"pz":-12.755,"op":-1.5707,"c":628,"r":841,"w":62,"h":124},{"s":1,"z0":11.911,"z1":12.727,"y0":1.273,"y1":2.891,"px":1.328,"pz":12.725,"op":1.5707,"c":692,"r":841,"w":62,"h":123}],"Ri_ic":[{"s":-1,"z0":-12.757,"z1":-11.941,"y0":1.295,"y1":2.913,"px":-1.321,"pz":-12.752,"op":1.5707,"c":500,"r":841,"w":62,"h":124},{"s":-1,"z0":11.911,"z1":12.727,"y0":1.272,"y1":2.891,"px":-1.328,"pz":12.727,"op":-1.5707,"c":564,"r":841,"w":62,"h":124},{"s":1,"z0":-12.757,"z1":-11.941,"y0":1.295,"y1":2.913,"px":1.324,"pz":-12.755,"op":-1.5707,"c":628,"r":841,"w":62,"h":124},{"s":1,"z0":11.911,"z1":12.727,"y0":1.273,"y1":2.891,"px":1.328,"pz":12.725,"op":1.5707,"c":692,"r":841,"w":62,"h":123}],"Rc_reg":[{"s":-1,"z0":-6.731,"z1":-5.917,"y0":1.295,"y1":2.913,"px":-1.407,"pz":-6.727,"op":1.5707,"c":500,"r":841,"w":63,"h":124},{"s":-1,"z0":9.038,"z1":9.852,"y0":1.272,"y1":2.891,"px":-1.404,"pz":9.853,"op":-1.5707,"c":565,"r":841,"w":62,"h":124},{"s":1,"z0":9.036,"z1":9.851,"y0":1.272,"y1":2.891,"px":1.401,"pz":9.847,"op":1.5707,"c":629,"r":841,"w":62,"h":123},{"s":1,"z0":-6.733,"z1":-5.919,"y0":1.295,"y1":2.913,"px":1.409,"pz":-6.729,"op":-1.5707,"c":693,"r":841,"w":63,"h":124}],"Rc_ic":[{"s":-1,"z0":-6.731,"z1":-5.917,"y0":1.295,"y1":2.913,"px":-1.407,"pz":-6.727,"op":1.5707,"c":500,"r":841,"w":63,"h":124},{"s":-1,"z0":9.038,"z1":9.852,"y0":1.272,"y1":2.891,"px":-1.404,"pz":9.853,"op":-1.5707,"c":565,"r":841,"w":62,"h":124},{"s":1,"z0":9.036,"z1":9.851,"y0":1.272,"y1":2.891,"px":1.401,"pz":9.847,"op":1.5707,"c":629,"r":841,"w":62,"h":123},{"s":1,"z0":-6.733,"z1":-5.919,"y0":1.295,"y1":2.913,"px":1.409,"pz":-6.729,"op":-1.5707,"c":693,"r":841,"w":63,"h":124}]};
/* ---------------------------------------------------------------------
   Renfe serie 432 reformada · unidad M + Ri + Rc (librea Regionales o Intercity)
   Modelo procedural de pocos polígonos, como la 470: sección de caja medida en la malla del
   paquete de Trainz (STR: R_E_N_F_E & TXUS, Kaur, Joxemai), con su aspecto horneado en un atlas
   por coche (costados, techo, testeros y hojas de puerta vistos en ortogonal sobre el modelo
   original) y una máscara de las ventanas que se encienden de noche. Sin los logotipos de marca.
   Bogies Schlieren y pantógrafo de brazo único procedurales; puertas abatibles con el giro de su
   animación original. El M lleva el pantógrafo del lado interior levantado.
   --------------------------------------------------------------------- */
const R432={S:76.4,W:2048,H:1152,
  car:{M:{L:26.41,zc:0.029,zb:-12.93,zf:12.85,cab:true,bog:[9.205,-9.212],pant:[[-9.416,1],[9.421,0]],
          lamps:{w:[[-0.976,1.434],[0.976,1.434],[-0.12,3.474],[0.118,3.474]],r:[[0.735,1.434],[-1.0,3.169],[1.0,3.169]],z:12.835}},
       Ri:{L:26.363,zc:0.005,zb:-12.93,zf:12.93,cab:false,bog:[9.248,-9.244],pant:[]},
       Rc:{L:26.41,zc:0.029,zb:-12.93,zf:12.85,cab:true,bog:[9.205,-9.212],pant:[],
          lamps:{w:[[-0.976,1.474],[0.976,1.474],[-0.12,3.801],[0.118,3.801]],r:[[0.696,1.474],[-1.0,3.169],[1.0,3.169]],z:12.832}}},
  PR:[[1.435,0.94],[1.435,3.0],[1.409,3.225],[1.26,3.52],[1.029,3.759],[0.819,3.898],[0.599,4.002],[0.30,4.07],[0,4.105]],
  LV:{reg:'Regionales',ic:'Intercity'},mat:{},parts:{}};
const uv432=(c,r)=>[c/R432.W,1-r/R432.H];
const col432=z=>(z+13.4)*R432.S;
/* body stations [z, side half-width, half-width at the shoulder, roof height], measured on the package's mesh:
   rounded cab noses (plan radius ~0.6 m, the roof falling to the windscreen), gangway ends with rounded corners,
   and on the M the pantograph wells (roof lowered to 3.70 m) at both ends */
function stations432(car){
  const R=4.105,S=[];const st=(z,hw,hu,t)=>S.push([z,hw,hu,t]);
  const gang=(e)=>{const p=[[12.93,1.31,1.16,4.05],[12.82,1.36,1.21,4.09],[12.70,1.40,1.24,4.10],[12.50,1.435,1.26,4.10]];return e<0?p.map(q=>[-q[0],q[1],q[2],q[3]]):p.slice().reverse();};
  const nose=(T)=>[[12.20,1.435,1.26,T],[12.40,1.40,1.24,T],[12.50,1.36,1.20,T-0.02],[12.60,1.29,1.12,T-0.04],[12.70,1.17,0.97,T-0.08],[12.78,1.08,0.74,T-0.16],[12.85,1.00,0.48,T-0.27]];
  gang(-1).forEach(q=>st(...q));
  if(car==='M'){st(-12.38,1.435,1.26,3.70);st(-8.72,1.435,1.26,3.70);st(-8.50,1.435,1.26,R);st(8.40,1.435,1.26,R);st(8.62,1.435,1.26,3.70);nose(3.72).forEach(q=>st(...q));}
  else if(car==='Rc'){nose(4.07).forEach(q=>st(...q));}
  else gang(1).forEach(q=>st(...q));
  return S;
}
function ring432(hw,hu,t){
  const up=[[1.409,3.225],[1.26,3.52],[1.029,3.759],[0.819,3.898],[0.599,4.002],[0.30,4.07],[0,4.105]];
  const half=[[hw,0.94],[hw,3.0]].concat(up.map(p=>[p[1]<3.4?p[0]*hw/1.435:p[0]*hu/1.26,3.0+(p[1]-3.0)*(t-3.0)/1.105]));
  return half.concat(half.slice(0,-1).reverse().map(p=>[-p[0],p[1]]));
}
function parts432(car){
  const C=R432.car[car],S=R432.S,T=arrNew(),M={},sch=[];Object.defineProperty(M,'sch',{value:sch});/* couplers: not a mesh key */const add=(k,A)=>{if(!M[k])M[k]=arrNew();arrPush(M[k],A);};
  const ST=stations432(car),RG=ST.map(s=>ring432(s[1],s[2],s[3]).map(p=>[p[0],p[1],s[0]]));
  const zb=ST[0][0],zf=ST[ST.length-1][0];
  /* each quad takes the view that faces it: costados (side views), techo (top view) or testero (end views) */
  const uvOf=(p,v,sd,e)=>v==='side'?uv432(col432(p[2]),(sd>0?0:306)+(4.25-p[1])*S):v==='roof'?uv432(col432(p[2]),612+(1.5-p[0])*S):uv432((e>0?0:245)+(p[0]+1.6)*S,841+(4.3-p[1])*S);
  for(let k=0;k<RG.length-1;k++){const A=RG[k],B=RG[k+1];
    for(let i=0;i<A.length-1;i++){const q=[A[i],B[i],B[i+1],A[i+1]];
      const d1=[q[2][0]-q[0][0],q[2][1]-q[0][1],q[2][2]-q[0][2]],d2=[q[3][0]-q[1][0],q[3][1]-q[1][1],q[3][2]-q[1][2]];
      let n=[d1[1]*d2[2]-d1[2]*d2[1],d1[2]*d2[0]-d1[0]*d2[2],d1[0]*d2[1]-d1[1]*d2[0]];const ln=Math.hypot(n[0],n[1],n[2]);if(ln<1e-9)continue;n=n.map(v=>v/ln);
      const cx=(q[0][0]+q[2][0])/2,cy=(q[0][1]+q[2][1])/2,cz=(q[0][2]+q[2][2])/2;
      if(n[0]*cx+n[1]*(cy-2.2)+n[2]*cz*0.02<0)n=n.map(v=>-v);
      const ax=Math.abs(n[0]),ay=Math.abs(n[1]),az=Math.abs(n[2]);
      const v=az>Math.max(ax,ay)?(Math.abs(cz)>11.9?'end':'roof'):(n[1]>0.55?'roof':'side');
      quadN(T,q,q.map(p=>uvOf(p,v,Math.sign(cx)||1,Math.sign(cz))),n);}}
  // end walls: the last ring closed, plus the headstock below it, from the end views
  [[RG[RG.length-1],1],[RG[0],-1]].forEach(([rg,e])=>{const z=rg[0][2],nose=C.cab&&e>0,pts=nose?rg.map(p=>[p[0],p[1]]):[[rg[0][0],0.30]].concat(rg.map(p=>[p[0],p[1]]),[[rg[rg.length-1][0],0.30]]);
    const o=T.pos.length/3;pts.forEach(p=>{T.pos.push(p[0],p[1],z);const t=uv432((e>0?0:245)+(p[0]+1.6)*S,841+(4.3-p[1])*S);T.uv.push(t[0],t[1]);});
    for(let i=1;i<pts.length-1;i++){if(e>0)T.idx.push(o,o+i,o+i+1);else T.idx.push(o,o+i+1,o+i);}});
  /* under the cab face (below 0.94 m) the nose is open, as on the real unit: the headstock set back under the face,
     the grey corner boxes, the Scharfenberg coupler (centre 0.89 m) with its electrical head and hoses, and the
     stone guard behind it */
  if(C.cab){const zF=zf-0.10;
    add('dark',boxA(0,0.55,zF-0.25,2.40,0.40,0.50));
    [-1,1].forEach(s=>{add('dark',boxA(s*1.0,0.60,zf-0.02,0.42,0.32,0.22));});
    sch.push([0,0.89,zf+0.65,1,0.9]);
    add('dark',boxA(0,0.16,zF-0.20,2.20,0.40,0.08));[-1,1].forEach(s=>add('dark',boxA(s*1.05,0.16,zF-0.40,0.08,0.40,0.40)));}
  // underframe: the equipment as seen from each side, painted on a closed box under the floor
  const bz=Math.min(...C.bog.map(Math.abs))-1.95;
  [1,-1].forEach(s=>{const x=s*1.25,r0=s>0?0:306,uvp=(y,z)=>uv432(col432(z),r0+(4.25-y)*S),za=-bz,zc=bz;
    quadN(T,[[x,0.26,za],[x,0.26,zc],[x,0.95,zc],[x,0.95,za]],[uvp(0.26,za),uvp(0.26,zc),uvp(0.95,zc),uvp(0.95,za)],[s,0,0]);});
  add('dark',boxA(0,0.26,0,2.5,0.70,2*bz));add('dark',boxA(0,0.80,(zb+zf)/2,2.7,0.15,zf-zb-0.3));
  // Schlieren bogies: wheelbase 2.6 m, wheels 920 mm, coil springs over the axleboxes
  C.bog.forEach(zc=>{
    [-1.0,1.0].forEach(x=>{add('bogie',boxA(x,0.50,zc,0.16,0.30,3.3));add('bogie',boxA(x,0.74,zc,0.24,0.10,1.9));
      [-1.3,1.3].forEach(a=>{add('wheel',cylA(x*0.79,0.46,zc+a,0.46,0.13,14,0,0,PI/2));add('bogie',boxA(x,0.48,zc+a,0.30,0.30,0.38));add('bogie',cylA(x,0.80,zc+a,0.11,0.30,8));});});
    add('bogie',boxA(0,0.62,zc,2.1,0.22,0.6));add('dark',cylA(0,0.46,zc-1.3,0.08,1.6,8,0,0,PI/2));add('dark',cylA(0,0.46,zc+1.3,0.08,1.6,8,0,0,PI/2));
    if(car==='M')add('bogie',boxA(0,0.36,zc,1.1,0.44,1.0));});
  // pantographs (M): on the floor of the wells (3.70 m), the inner one up to the 5.32 m contact wire
  C.pant.forEach(([z,up])=>add('panto',pantoA(z,5.26,!up,-0.23)));
  add('tex',T);
  return M;
}
function mat432(car,lv){
  const k=car+'_'+lv;if(R432.mat[k])return R432.mat[k];
  const ld=new THREE.TextureLoader(),t=ld.load(R432_IMG[k]),e=ld.load(R432_MSK[k]);t.encoding=THREE.sRGBEncoding;t.anisotropy=8;e.encoding=THREE.sRGBEncoding;
  const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});
  /* saloon lights at night: the window glass of the bake, the door glass and the vestibules */
  m.emissive=new THREE.Color(0xFFD7A0);m.emissiveMap=e;m.emissiveIntensity=NIGHT.N*0.9;NIGHT.winMats.push(m);MAT_HEX.set(m,0xDCDCD8);
  return R432.mat[k]=m;
}
function build432(tr,sp,i,n){
  const C=R432.car[sp.car],lv=sp.lv||'reg',P=R432.parts[sp.car]||(R432.parts[sp.car]=parts432(sp.car)),T=tex470(),mt=mat432(sp.car,lv);
  const g=new THREE.Group(),inner=new THREE.Group(),root=new THREE.Group();if(sp.cab<0)inner.rotation.y=PI;g.add(inner);inner.add(root);root.position.z=-C.zc;
  const body=[];
  Object.keys(P).forEach(key=>{const m=new THREE.Mesh(geoFromArrays(P[key]),key==='tex'?mt:T.solid[key]);m.castShadow=true;m.receiveShadow=true;root.add(m);
    if(key==='tex'){m.userData.ent=tr.ent;body.push(m);}});
  scharfHang(root,P.sch);
  // head and tail lamps where the package puts them: white lit on the leading cab, red on the trailing one
  if(C.lamps){const lead=sp.cab!==0&&i===0,tail=sp.cab!==0&&i===n-1;
    C.lamps.w.forEach(p=>{const m=new THREE.Mesh(new THREE.CircleGeometry(p[1]>3?0.07:0.085,12),lead?T.solid.lightW:T.solid.lampOffW);m.position.set(p[0],p[1],C.lamps.z+0.01);root.add(m);});
    C.lamps.r.forEach(p=>{const m=new THREE.Mesh(new THREE.CircleGeometry(0.06,10),tail?T.solid.lightR:T.solid.lampOffR);m.position.set(p[0],p[1],C.lamps.z+0.01);root.add(m);});}
  // door leaves: hinged at the package's pivots, swinging inwards when they open
  const leaves=[],S=R432.S;
  (R432_DOORS[sp.car+'_'+lv]||[]).forEach(d=>{const p=new THREE.Group(),x=d.s*1.442;p.position.set(x,0,d.pz);
    const A=arrNew(),a=d.z0-d.pz,b=d.z1-d.pz,u=(z)=>d.c+(z-d.z0)/(d.z1-d.z0)*d.w;
    const q=[[0,d.y0,a],[0,d.y0,b],[0,d.y1,b],[0,d.y1,a]],t=[uv432(u(d.z0),d.r+d.h),uv432(u(d.z1),d.r+d.h),uv432(u(d.z1),d.r),uv432(u(d.z0),d.r)];
    if(d.s>0)quadN(A,q,t,[1,0,0]);else quadN(A,[q[1],q[0],q[3],q[2]],[t[1],t[0],t[3],t[2]],[-1,0,0]);
    const m=new THREE.Mesh(geoFromArrays(A),mt);m.castShadow=true;p.add(m);root.add(p);p.userData.door={open:0,t:0,ang:d.op};leaves.push(p);});
  const doorZ=(R432_DOORS[sp.car+'_'+lv]||[]).filter(d=>d.s<0).map(d=>((d.z0+d.z1)/2-C.zc)*(sp.cab<0?-1:1));
  return{g:g,inner:inner,L:C.L,body:body,leaves:leaves,doorZ:doorZ,doorFn:animDoors432,kind:'432'};
}
function animDoors432(c,dt){
  c.leaves.forEach(p=>{const d=p.userData.door;const k=1-Math.exp(-dt*2.6);d.t+=(d.open-d.t)*k;p.rotation.y=d.ang*d.t;});
}
function specs432(lv,dir){
  const L=car=>R432.car[car].L;
  let s=[{k:'r432',car:'M',lv:lv,L:L('M'),cab:1},{k:'r432',car:'Ri',lv:lv,L:L('Ri'),cab:0},{k:'r432',car:'Rc',lv:lv,L:L('Rc'),cab:-1}];
  if(dir<0)s=s.slice().reverse().map(o=>Object.assign({},o,{cab:-o.cab}));
  return s;
}
/* ---------------------------------------------------------------------
   Renfe serie 448 · unidad M + Ri + Rc (librea Intercity de Grandes Líneas)
   Modelo procedural de pocos polígonos, como la 470 y la 432: sección de caja medida en la malla del
   paquete de MSTS «Renfe 448», pintada en limpio sobre un atlas por coche con la distribución del modelo
   original (ventanas y puertas medidas en sus costados), y una máscara de los cristales del salón que se
   encienden de noche. Sin los logotipos de marca del paquete. Puertas de cierre enrasado (van en el atlas, cerradas).
   Bogies y pantógrafos procedurales; el M lleva dos pantógrafos y circula con el del lado interior levantado.
   En el paquete el M tiene la cabina en +z y el Rc en −z; aquí cada coche se gira según la cabina que lleva delante.
   MSTS es de mano izquierda: su costado +x es aquí el −x (vistas sideP en −x, sideN en +x; techo y testeros espejados en x).
   --------------------------------------------------------------------- */
const R448={S:76.4,W:2048,H:1224,
  car:{M:{L:26.14,cabDir:1,bog:[9.13,-9.27],pant:[[7.9,0],[-10.0,1]],doors:[-12.22,4.98],
          lamps:{w:[[1.22,1.837,12.70],[-1.22,1.837,12.70],[-0.107,3.596,12.68],[0.117,3.596,12.68]],r:[[0.704,3.65,12.68],[-0.714,3.65,12.68]]}},
       Ri:{L:26.71,cabDir:0,bog:[9.38,-9.435],pant:[],doors:[-12.40,12.35]},
       Rc:{L:26.67,cabDir:-1,bog:[9.27,-9.13],pant:[],doors:[-10.96,6.68],
          lamps:{w:[[-1.13,1.837,-13.24],[1.13,1.837,-13.24],[0.107,3.596,-13.22],[-0.117,3.596,-13.22]],r:[[-0.704,3.64,-13.22],[0.714,3.64,-13.22]]}}},
  /* half section measured mid-car: [half-width, height]; the sides lean in below 0.9 m */
  PR:[[1.42,0.40],[1.49,0.90],[1.49,3.30],[1.47,3.40],[1.42,3.50],[1.37,3.70],[1.29,3.80],[1.19,3.90],[1.16,4.00],[1.03,4.10],[0.86,4.20],[0.52,4.29],[0,4.31]],
  LV:{GL:'Intercity'},mat:{},parts:{}};
const uv448=(c,r)=>[c/R448.W,1-r/R448.H];
const col448=z=>(z+13.4)*R448.S;
/* body stations [z, half-width, roof top, bottom of the skirt], measured on the package's mesh: gangway ends narrowing
   to 1.38 m, flat cab fronts (M at +12.66, Rc at −13.20) with the skirt raised to 0.77 m under the cab */
function stations448(car){
  const S=[],st=(z,hw,t,b)=>S.push([z,hw,t,b]);
  const gang=e=>{const p=[[13.15,1.38,4.29,0.40],[12.80,1.40,4.29,0.40],[12.20,1.43,4.30,0.40],[11.80,1.47,4.31,0.40],[11.40,1.49,4.31,0.40]];return e<0?p.map(q=>[-q[0],q[1],q[2],q[3]]):p.slice().reverse();};
  const cab=e=>{const p=[[11.40,1.49,4.31,0.40],[11.75,1.49,4.31,0.65],[12.20,1.48,4.30,0.77],[12.45,1.475,4.29,0.77],[12.66,1.46,4.22,0.77]];
    return e<0?p.map(q=>[-13.20+(12.66-q[0]),q[1],q[2],q[3]]).reverse():p;};
  if(car==='M'){[[-13.05,1.38,4.29,0.40]].concat(gang(-1).slice(1)).forEach(q=>st(...q));cab(1).forEach(q=>st(...q));}
  else if(car==='Rc'){cab(-1).forEach(q=>st(...q));gang(1).forEach(q=>st(...q));}
  else{gang(-1).forEach(q=>st(...q));gang(1).forEach(q=>st(...q));}
  return S;
}
function ring448(hw,t,b){
  const k=hw/1.49,half=R448.PR.map((p,i)=>[p[0]*k,i===0?b:(p[1]<=3.3?Math.max(p[1],b+0.05):3.3+(p[1]-3.3)*(t-3.3)/1.01)]);
  return half.concat(half.slice(0,-1).reverse().map(p=>[-p[0],p[1]]));
}
/* a railway wheel with some body: the tread (smooth), the flange on the inside, and on the outer face the machined rim,
   the dished web set back from it and the hub boss with the axle end. Axis along x; s is the side (+1 at +x) */
function wheelA(xc,cy,zc,r,w,s){const W=arrNew(),R=arrNew(),H=arrNew(),n=18;
  const ang=i=>i/n*TAU,P=(x,rr,a)=>[x,cy+Math.cos(a)*rr,zc+Math.sin(a)*rr];
  const xo=xc+s*w/2,xi=xc-s*w/2;
  const band=(A,x0,x1,r0,r1,dir)=>{const o=A.pos.length/3;for(let i=0;i<=n;i++){const a=ang(i),p=P(x0,r0,a),q=P(x1,r1,a);A.pos.push(...p,...q);A.uv.push(0,0,0,0);}
    for(let i=0;i<n;i++){const a=o+i*2,b=a+1,c=a+2,d=a+3;A.idx.push(a,c,b,b,c,d);}
    /* face them outwards from the axis or along x: fix the winding by the first triangle */
    const p0=A.pos.slice(o*3,o*3+3),p1=A.pos.slice((o+2)*3,(o+2)*3+3),p2=A.pos.slice((o+1)*3,(o+1)*3+3);
    const e1=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]],e2=[p2[0]-p0[0],p2[1]-p0[1],p2[2]-p0[2]],nn=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];
    const m=[(p0[0]+p1[0]+p2[0])/3-xc,(p0[1]+p1[1]+p2[1])/3-cy,(p0[2]+p1[2]+p2[2])/3-zc];
    const want=(x0===x1)?[dir,0,0]:[0,m[1]*dir,m[2]*dir];
    if(nn[0]*want[0]+nn[1]*want[1]+nn[2]*want[2]<0)for(let k=A.idx.length-n*6;k<A.idx.length;k+=3){const tmp=A.idx[k+1];A.idx[k+1]=A.idx[k+2];A.idx[k+2]=tmp;}};
  band(W,xi,xo,r,r,1);                                        // tread
  band(W,xi-s*0.025,xi,r+0.035,r+0.035,1);band(W,xi-s*0.025,xi-s*0.025,r+0.035,0.3*r,-s);band(W,xi,xi,r+0.035,r,s);   // flange
  band(R,xo,xo,r,0.80*r,s);                                   // machined rim
  band(W,xo,xo-s*0.035,0.80*r,0.80*r,-1);band(W,xo-s*0.035,xo-s*0.035,0.80*r,0.26*r,s);   // the dished web, set back
  band(H,xo-s*0.035,xo+s*0.035,0.26*r,0.26*r,1);band(H,xo+s*0.035,xo+s*0.035,0.26*r,0.12*r,s);band(H,xo+s*0.035,xo+s*0.05,0.12*r,0.12*r,1);band(H,xo+s*0.05,xo+s*0.05,0.12*r,0.001,s);
  return{W:W,R:R,H:H};}
/* open the skirt over the bogies (it comes down to 0.40 m elsewhere): the sides stop at 1.0 m there, so the bogie shows */
function cut448(ST,bogs){const lerpSt=(z)=>{for(let i=1;i<ST.length;i++){const a=ST[i-1],b=ST[i];if(z>=a[0]&&z<=b[0]){const k=(z-a[0])/((b[0]-a[0])||1);return[z,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k,a[3]];}}return null;};
  let S=ST.slice();bogs.forEach(zc=>{const add=[];[[-2.02,0.40],[-1.96,1.0],[1.96,1.0],[2.02,0.40]].forEach(([d,b])=>{const q=lerpSt(zc+d);if(q){q[3]=b;add.push(q);}});
    S=S.map(q=>Math.abs(q[0]-zc)<1.96?[q[0],q[1],q[2],1.0]:q).concat(add).sort((a,b)=>a[0]-b[0]);});return S;}
/* the ends have a texture of their own, at twice the detail (160 px/m): columns 0–512 the +z end, 512–1024 the −z end */
const E448={W:1024,H:704,S:160,SY:704/4.32};
const uvE448=(x,y,e)=>[((e>0?0:512)+(1.6-x)*E448.S)/E448.W,1-((4.5-y)*E448.SY)/E448.H];
function parts448(car){
  const C=R448.car[car],S=R448.S,T=arrNew(),TE=arrNew(),M={},sch=[];Object.defineProperty(M,'sch',{value:sch});/* couplers: not a mesh key */const add=(k,A)=>{if(!M[k])M[k]=arrNew();arrPush(M[k],A);};
  const ST=cut448(stations448(car),C.bog),RG=ST.map(s=>ring448(s[1],s[2],s[3]).map(p=>[p[0],p[1],s[0]]));
  const zb=ST[0][0],zf=ST[ST.length-1][0];
  const uvOf=(p,v,sd,e)=>v==='side'?uv448(col448(p[2]),(sd>0?325:0)+(4.5-p[1])*S):v==='roof'?uv448(col448(p[2]),650+(1.6+p[0])*S):uv448((e>0?0:245)+(1.6-p[0])*S,894+(4.5-p[1])*S);
  for(let k=0;k<RG.length-1;k++){const A=RG[k],B=RG[k+1];
    for(let i=0;i<A.length-1;i++){const q=[A[i],B[i],B[i+1],A[i+1]];
      const d1=[q[2][0]-q[0][0],q[2][1]-q[0][1],q[2][2]-q[0][2]],d2=[q[3][0]-q[1][0],q[3][1]-q[1][1],q[3][2]-q[1][2]];
      let n=[d1[1]*d2[2]-d1[2]*d2[1],d1[2]*d2[0]-d1[0]*d2[2],d1[0]*d2[1]-d1[1]*d2[0]];const ln=Math.hypot(n[0],n[1],n[2]);if(ln<1e-9)continue;n=n.map(v=>v/ln);
      const cx=(q[0][0]+q[2][0])/2,cy=(q[0][1]+q[2][1])/2,cz=(q[0][2]+q[2][2])/2;
      if(n[0]*cx+n[1]*(cy-2.2)+n[2]*cz*0.02<0)n=n.map(v=>-v);
      const ax=Math.abs(n[0]),ay=Math.abs(n[1]),az=Math.abs(n[2]);
      const v=az>Math.max(ax,ay)?(Math.abs(cz)>11.9?'end':'roof'):(n[1]>0.55?'roof':'side');
      if(v==='end')quadN(TE,q,q.map(p=>uvE448(p[0],p[1],Math.sign(cz))),n);else quadN(T,q,q.map(p=>uvOf(p,v,Math.sign(cx)||1,Math.sign(cz))),n);}}
  // end walls: the last ring closed, from the end views
  [[RG[RG.length-1],1],[RG[0],-1]].forEach(([rg,e])=>{const z=rg[0][2],o=TE.pos.length/3;
    rg.forEach(p=>{TE.pos.push(p[0],p[1],z);const t=uvE448(p[0],p[1],e);TE.uv.push(t[0],t[1]);});
    for(let i=1;i<rg.length-1;i++){if(e>0)TE.idx.push(o,o+i,o+i+1);else TE.idx.push(o,o+i+1,o+i);}});
  // floor under the skirt, gangway bellows, the automatic coupler and the fairing under the cab
  {const cuts=C.bog.map(zc=>[zc-2.0,zc+2.0]).sort((a,b)=>a[0]-b[0]);let z0=zb+0.1;
    cuts.forEach(([a,b])=>{if(a>z0)add('dark',boxA(0,0.36,(z0+a)/2,2.7,0.08,a-z0));z0=b;});if(zf-0.1>z0)add('dark',boxA(0,0.36,(z0+zf-0.1)/2,2.7,0.08,zf-0.1-z0));
    /* over each bogie: the underside of the body, and the cut ends of the skirt */
    C.bog.forEach(zc=>{add('dark',boxA(0,0.98,zc,2.92,0.06,3.96));[-1,1].forEach(s=>[-1,1].forEach(e=>add('dark',boxA(s*1.44,0.40,zc+e*1.99,0.10,0.62,0.06))));});}
  const L2=C.L/2;
  [[zf,1],[zb,-1]].forEach(([z,e])=>{const isCab=C.cabDir===e;
    if(isCab){sch.push([0,0.94,e*L2,e,L2-Math.abs(z)+0.35]);   // Scharfenberg coupler (its own mesh, see scharf): coupling plane at the half length
      /* the front skirt under the cab, from 0.40 m to the bottom of the front (the sides are cut away there): a plate
         painted from the front view, with the equipment box behind it */
      const yb=0.40,yt=ST.find(q=>q[0]===z)[3],hw=1.45,uvF=(x,y)=>uvE448(x,y,e),zf=z+e*0.004;
      quadN(TE,[[-hw,yb,zf],[hw,yb,zf],[hw,yt,zf],[-hw,yt,zf]],[uvF(-hw,yb),uvF(hw,yb),uvF(hw,yt),uvF(-hw,yt)],[0,0,e]);
      add('dark',boxA(0,yb,z-e*0.35,2.86,yt-yb+0.02,0.70));}
    else{const d=L2-Math.abs(z)+0.06;add('dark',boxA(0,1.215,z+e*d/2,1.78,2.175,d));}});
  // bogies: wheelbase 2.57 m, wheels 960 mm. Outside frames, dropped between the axles, with the coil springs over the
  // round axlebox covers; the bolster on its air springs, yaw dampers, the brake discs on the axles, the traction motors
  C.bog.forEach(zc=>{
    [-1.0,1.0].forEach(s=>{const x=s*1.08;
      [-1.285,1.285].forEach(a=>{const w=wheelA(s*0.79,0.48,zc+a,0.48,0.13,s);add('wheel',w.W);add('rim',w.R);add('dark',w.H);
        add('bogie',boxA(x,0.30,zc+a,0.26,0.34,0.40));add('dark',cylA(x+s*0.10,0.48,zc+a,0.15,0.10,14,0,0,PI/2));add('bogie',cylA(x+s*0.16,0.48,zc+a,0.11,0.04,14,0,0,PI/2));
        add('spring',cylA(x,0.74,zc+a,0.12,0.22,10));add('bogie',boxA(x,0.84,zc+a,0.30,0.06,0.34));
        add('bogie',boxA(x,0.66,zc+a*0.62,0.18,0.24,0.62));add('bogie',rodA([x,0.80,zc+a*0.40],[x,0.55,zc+a*0.08],0.16));});
      add('bogie',boxA(x,0.42,zc,0.18,0.26,1.10));add('bogie',boxA(x,0.36,zc,0.22,0.06,1.02));
      add('spring',cylA(x*0.86,0.86,zc,0.20,0.20,14));add('dark',rodA([x*1.02,0.70,zc-0.95],[x*1.02,0.86,zc+0.35],0.07));});
    add('bogie',boxA(0,0.56,zc,2.0,0.20,0.56));add('bogie',boxA(0,0.76,zc,2.3,0.12,0.42));
    [-1.285,1.285].forEach(a=>{add('dark',cylA(0,0.48,zc+a,0.075,1.5,8,0,0,PI/2));[-0.42,0.42].forEach(xd=>add('rim',cylA(xd,0.48,zc+a,0.30,0.045,16,0,0,PI/2)));});
    if(car!=='Ri')[-0.62,0.62].forEach(d=>add('dark',cylA(0.15,0.48,zc+d,0.27,0.80,12,0,0,PI/2)));});
  // pantographs (M): on the roof (4.29 m), the inner one up to the contact wire
  C.pant.forEach(([z,up])=>add('panto',pantoA(z,5.26,!up,0.17)));
  add('tex',T);add('tend',TE);
  return M;
}
const W448={"M":[[[-12.471,-11.973,"d"],[-11.266,-10.062,"b",1],[-9.552,-8.361,"b",0],[-7.837,-6.646,"b",0],[-6.096,-4.905,"b",0],[-4.369,-3.23,"b",0],[-2.732,-1.515,"b",0],[-1.005,0.213,"b",0],[0.736,1.953,"b",0],[2.503,3.72,"b",1],[4.754,5.226,"d"],[5.775,6.325,"s",2.432,3.165],[9.414,10.199,"s",2.668,3.165]],[[-12.497,-11.986,"d"],[-11.358,-10.141,"b",1],[-9.617,-8.413,"b",0],[-7.89,-6.685,"b",0],[-6.136,-4.918,"b",0],[-4.369,-3.23,"b",0],[-2.732,-1.502,"b",0],[-1.005,0.213,"b",0],[0.749,1.966,"b",0],[2.516,3.734,"b",1],[4.728,5.213,"d"],[5.775,6.325,"s",2.419,3.165],[9.427,10.199,"s",2.668,3.165]]],"Ri":[[[-12.693,-12.104,"d"],[-11.541,-10.808,"s",2.432,3.178],[-8.662,-7.458,"b",1],[-6.908,-5.704,"b",0],[-5.18,-4.028,"b",0],[-3.518,-2.353,"b",0],[-1.869,-0.704,"b",0],[-0.18,0.985,"b",0],[1.469,2.634,"b",0],[3.131,4.362,"b",0],[4.912,6.142,"b",0],[6.652,7.883,"b",0],[8.393,9.637,"b",1],[12.084,12.621,"d"]],[[-12.693,-12.091,"d"],[-11.541,-10.795,"s",2.432,3.152],[-8.649,-7.445,"b",1],[-6.895,-5.691,"b",0],[-5.167,-4.028,"b",0],[-3.518,-2.353,"b",0],[-1.869,-0.691,"b",0],[-0.18,0.985,"b",0],[1.469,2.634,"b",0],[3.145,4.375,"b",0],[4.925,6.155,"b",0],[6.665,7.896,"b",0],[8.406,9.637,"b",1],[12.071,12.621,"d"]]],"Rc":[[[-11.188,-10.73,"d"],[-10.088,-8.806,"b",1],[-8.23,-6.947,"b",0],[-6.384,-5.102,"b",0],[-4.565,-3.282,"b",0],[-2.759,-1.633,"b",0],[-1.109,0.055,"b",0],[0.579,1.744,"b",0],[2.241,3.406,"b",0],[3.904,5.069,"b",1],[5.448,6.142,"s",2.419,3.165],[6.43,6.927,"d"],[8.04,9.152,"b",1],[10.252,11.377,"b",0]],[[-11.201,-10.717,"d"],[-10.036,-8.819,"b",1],[-8.282,-7.065,"b",0],[-6.541,-5.337,"b",0],[-4.827,-3.623,"b",0],[-3.112,-1.973,"b",0],[-1.424,-0.206,"b",0],[0.343,1.561,"b",0],[2.097,3.302,"b",0],[3.838,5.055,"b",1],[5.435,6.129,"s",2.419,3.152],[6.404,6.901,"d"],[10.357,11.26,"b",0]]]};
/* the 448 painted clean, in the flat style of the set, on the atlas layout its uvs use (76.4 px/m): the Intercity
   livery of Grandes Líneas (white with the blue band, the cabs in dark blue with the yellow trim), the windows and doors
   where the package's model has them (W448, measured on its sides), roof equipment, the cab front and the gangway end */
const LIV448={body:'#E7E5DF',line:'#B9BBBE',blue:'#123F98',blue2:'#0D3079',roof:'#B6B9BD',roof2:'#9EA2A7',roof3:'#878B90',navy:'#232C3C',navy2:'#1A212D',
  yellow:'#F0C01E',glass:'#2B3440',glass2:'#4C5867',frame:'#C9CBCD',rubber:'#1E2124',under:'#2B2E31',under2:'#3A3E42',door:'#D6D6D2',amber:'#E8A21E'};
/* the cab side, measured from the nose: d = distance back from the nose */
const CAB448={M:{nose:12.66,start:11.30,dir:1,slT:-0.40,slB:0.05},Rc:{nose:-13.20,start:-11.45,dir:-1,slT:0,slB:0.45}};
function paint448(c,W,H,car){const S=R448.S,C=LIV448,X=z=>(z+13.4)*S;
  const rnd=(x,y,w,h,r,col)=>{c.fillStyle=col;c.beginPath();if(c.roundRect)c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h);c.fill();};
  c.fillStyle='#8E9094';c.fillRect(0,0,W,H);
  const cab=CAB448[car];
  /* --- the two sides: strip 0 is the −x side (left to right = −z to +z), strip 1 the +x side (seen from +x, mirrored) --- */
  [0,1].forEach(k=>{const r0=k*325,Y=y=>r0+(4.5-y)*S;
    const R=(z0,z1,y0,y1,col)=>{c.fillStyle=col;c.fillRect(X(Math.min(z0,z1)),Y(Math.max(y0,y1)),Math.abs(X(z1)-X(z0)),Math.abs(Y(y1)-Y(y0)));};
    const poly=(pts,col)=>{c.fillStyle=col;c.beginPath();pts.forEach((p,i)=>i?c.lineTo(X(p[0]),Y(p[1])):c.moveTo(X(p[0]),Y(p[1])));c.closePath();c.fill();};
    const txt=(s,z,y,px,col,font)=>{c.save();c.translate(X(z),Y(y));if(k===1)c.scale(-1,1);c.fillStyle=col;c.font=font.replace('PX',Math.round(px*S)+'px');c.textAlign='center';c.textBaseline='middle';c.fillText(s,0,0);c.restore();};
    c.save();c.beginPath();c.rect(0,r0,W,325);c.clip();
    // roof seen from the side, the body, the rub strip and the blue band, the skirt and the underframe
    R(-13.4,13.4,3.40,4.40,C.roof);R(-13.4,13.4,3.40,3.62,C.roof2);R(-13.4,13.4,3.38,3.41,C.roof3);R(-13.4,13.4,4.22,4.40,'#A7AAAE');
    R(-13.4,13.4,0.0,1.18,C.under);R(-13.4,13.4,0.40,0.47,C.under2);
    R(-13.4,13.4,1.18,3.38,C.body);R(-13.4,13.4,1.92,1.95,C.line);R(-13.4,13.4,1.28,1.73,C.blue);R(-13.4,13.4,1.28,1.32,C.blue2);
    // underframe equipment boxes between the bogies
    for(let z=-6.8;z<6.4;z+=1.62){R(z,z+1.42,0.55,1.08,C.under2);R(z+0.05,z+1.37,0.60,1.03,'#33373B');}
    // saloon windows (silver frame, rubber, glass with the upper pane lighter), small windows, door leaves
    (W448[car]||[[],[]])[k].forEach(w=>{const z0=w[0],z1=w[1];
      if(w[2]==='d'){const zc=(z0+z1)/2,a=zc-0.40,b=zc+0.40;R(a,b,1.18,3.38,C.door);R(a,a+0.025,1.18,3.38,C.line);R(b-0.025,b,1.18,3.38,C.line);R(a,b,3.36,3.38,C.line);
        rnd(X(z0)-3,Y(3.20)-3,X(z1)-X(z0)+6,Y(2.18)-Y(3.20)+6,10,C.rubber);rnd(X(z0),Y(3.20),X(z1)-X(z0),Y(2.18)-Y(3.20),8,C.glass);
        c.fillStyle=C.glass2;c.fillRect(X(z0)+3,Y(3.20)+3,X(z1)-X(z0)-6,(Y(2.18)-Y(3.20))*0.3);return;}
      const y0=w[2]==='b'?2.236:w[3],y1=w[2]==='b'?3.06:w[4],x0=X(z0),x1=X(z1),ya=Y(y1),yb=Y(y0);
      rnd(x0-5,ya-5,x1-x0+10,yb-ya+10,11,C.frame);rnd(x0-2,ya-2,x1-x0+4,yb-ya+4,9,C.rubber);
      c.fillStyle=C.glass;c.fillRect(x0,ya,x1-x0,yb-ya);c.fillStyle=C.glass2;c.fillRect(x0,ya,x1-x0,(yb-ya)*0.32);
      if(w[3]===1){c.fillStyle=C.frame;c.fillRect(x0,Y(2.83)-2,x1-x0,4);}});
    /* the cab side, traced on the package's drawing and measured back from the nose (d): the body cut away in a slant
       under the cab, the dark blue cab with the louvres on its roof, the big side window with the mirror box, the yellow
       trim that frames the top lamp window and runs down and forward to the bumper stripe, and the front side window */
    if(cab){const e=cab.dir,Z=d=>cab.nose-e*d,P=(pts,col)=>poly(pts.map(p=>[Z(p[0]),p[1]]),col),Rd=(d0,d1,y0,y1,col)=>R(Z(d0),Z(d1),y0,y1,col);
      const far=-0.80;
      P([[1.72,4.40],[far,4.40],[far,0],[1.26,0],[1.26,1.18],[1.72,2.22]],C.navy);Rd(1.26,far,0,1.18,C.navy2);
      Rd(1.71,0.71,3.78,4.10,'#6F767F');for(let d=1.68;d>0.72;d-=0.045)Rd(d,d-0.018,3.80,4.08,'#3C424B');Rd(1.72,0.60,4.18,4.22,'#0F1216');
      const glass=(pts)=>{c.save();c.beginPath();pts.forEach((p,i)=>i?c.lineTo(X(Z(p[0])),Y(p[1])):c.moveTo(X(Z(p[0])),Y(p[1])));c.closePath();c.clip();
        const ys=pts.map(p=>p[1]),g=c.createLinearGradient(0,Y(Math.max(...ys)),0,Y(Math.min(...ys)));g.addColorStop(0,'#55626F');g.addColorStop(1,'#2C343F');c.fillStyle=g;c.fillRect(0,r0,W,325);c.restore();};
      Rd(1.72,1.66,2.36,3.31,'#101318');glass([[1.67,3.29],[0.79,3.29],[0.79,2.38],[1.67,2.38]]);
      Rd(1.09,0.75,2.34,2.72,'#0F1216');Rd(0.75,0.63,2.22,3.40,'#14181F');
      Rd(0.63,0.04,3.30,4.30,C.yellow);
      P([[0.63,3.30],[0.55,3.30],[0.55,2.42],[0.19,1.62],[0,1.62],[0,1.42],[0.26,1.42],[0.63,2.25]],C.yellow);
      glass([[0.53,3.27],[0.04,3.27],[0.04,2.10],[0.40,2.10],[0.53,2.38]]);
      if(car==='M'){R(9.25,10.35,1.18,3.38,C.body);R(9.25,9.27,1.18,3.38,'#55585B');R(10.33,10.35,1.18,3.38,'#55585B');R(9.25,10.35,3.36,3.38,'#55585B');R(8.30,9.10,2.03,2.07,'#55585B');}}
    // destination box on the band by the door, and the series mark
    const dz=car==='M'?3.11:car==='Rc'?-9.45:null;if(dz!==null){R(dz-0.60,dz+0.60,1.72,1.97,'#101214');R(dz-0.52,dz+0.52,1.78,1.91,'#2A2008');txt('INTERCITY',dz,1.845,0.11,C.amber,'600 PX "IBM Plex Mono",monospace');}
    txt('448',car==='Rc'?-6:-9.6,1.50,0.22,'#FFFFFF','700 PX "Barlow Condensed","Arial Narrow",sans-serif');
    c.restore();});
  /* --- the roof from above (rows 650–894): grey, darker eaves, the pantograph wells of the M, vents, the cab roof --- */
  {const Y=x=>650+(1.6+x)*S,R=(z0,z1,x0,x1,col)=>{c.fillStyle=col;c.fillRect(X(Math.min(z0,z1)),Y(Math.min(x0,x1)),Math.abs(X(z1)-X(z0)),Math.abs(Y(x1)-Y(x0)));};
    R(-13.4,13.4,-1.6,1.6,C.roof);R(-13.4,13.4,-1.6,-1.22,C.roof2);R(-13.4,13.4,1.22,1.6,C.roof2);R(-13.4,13.4,-0.012,0.012,C.roof3);
    for(let z=-12.6;z<12.8;z+=1.5)R(z,z+0.03,-1.2,1.2,'rgba(0,0,0,.07)');
    (R448.car[car].pant||[]).forEach(([z])=>{R(z-1.15,z+1.15,-0.85,0.85,C.roof3);R(z-1.08,z+1.08,-0.78,0.78,'#A2A6AB');});
    [-12.4,12.0].forEach(z=>{R(z-0.5,z+0.5,-1.15,-0.85,'#5E6266');R(z-0.5,z+0.5,0.85,1.15,'#5E6266');});
    if(cab){const e=cab.dir,Z=d=>cab.nose-e*d,far=e>0?13.4:-13.4;R(Z(1.72),far,-1.6,1.6,C.navy);R(Z(0.63),far,-1.45,1.45,C.yellow);
      [-1,1].forEach(s=>{R(Z(1.71),Z(0.71),s*1.12,s*1.40,'#6F767F');for(let d=1.68;d>0.72;d-=0.045)R(Z(d),Z(d-0.018),s*1.14,s*1.38,'#3C424B');});}}
}
/* the two ends of a 448 car, at 160 px/m, traced on the package's end views: the cab front (yellow roof dome, the lamp
   band, the yellow stripe, the windscreen in three lights with its wipers, the panel with the headlights, the yellow
   bumper stripe and the skirt with the coupler pocket) and the gangway end (white with the band, the grey roof dome,
   the hood and posts of the gangway and its two-leaf door). The +z end is seen mirrored in the texture. */
function paintEnd448(c,W,H,car){const C=LIV448,cab=CAB448[car],SX=E448.S,SY=E448.SY;
  c.fillStyle='#8E9094';c.fillRect(0,0,W,H);
  [[1,0],[-1,512]].forEach(([e,c0])=>{const X=x=>c0+(1.6-x)*SX,Y=y=>(4.5-y)*SY,mir=e>0;
    const R=(x0,x1,y0,y1,col)=>{c.fillStyle=col;const a=Math.min(X(x0),X(x1)),b=Math.max(X(x0),X(x1));c.fillRect(a,Y(Math.max(y0,y1)),b-a,Math.abs(Y(y1)-Y(y0)));};
    const RR=(x0,x1,y0,y1,r,col)=>{const a=Math.min(X(x0),X(x1)),b=Math.max(X(x0),X(x1));c.fillStyle=col;c.beginPath();if(c.roundRect)c.roundRect(a,Y(y1),b-a,Y(y0)-Y(y1),r*SX);else c.rect(a,Y(y1),b-a,Y(y0)-Y(y1));c.fill();};
    const line=(x0,y0,x1,y1,w,col)=>{c.strokeStyle=col;c.lineWidth=w*SX;c.lineCap='round';c.beginPath();c.moveTo(X(x0),Y(y0));c.lineTo(X(x1),Y(y1));c.stroke();};
    const glass=(x0,x1,y0,y1,top,bot)=>{const a=Math.min(X(x0),X(x1)),b=Math.max(X(x0),X(x1)),g=c.createLinearGradient(0,Y(y1),0,Y(y0));g.addColorStop(0,top);g.addColorStop(1,bot);c.fillStyle=g;c.fillRect(a,Y(y1),b-a,Y(y0)-Y(y1));};
    const dome=(col,y0)=>{c.fillStyle=col;c.beginPath();c.ellipse(X(0),Y(y0),1.34*SX,(4.32-y0)*SY,0,PI,TAU);c.lineTo(X(-1.6),Y(y0));c.lineTo(X(1.6),Y(y0));c.closePath();c.fill();};
    c.save();c.beginPath();c.rect(c0,0,512,H);c.clip();
    if(cab&&cab.dir===e){
      R(-1.6,1.6,0,4.6,C.navy);dome(C.yellow,3.80);
      c.fillStyle='rgba(0,0,0,.10)';c.beginPath();c.ellipse(X(0),Y(3.80),1.34*SX,0.05*SY,0,PI,TAU);c.fill();
      // the lamp band: the top headlight and the two marker lamps
      /* only the housings and sockets: the lamps themselves are the meshes of R448.car[car].lamps, which light up */
      const LP=R448.car[car].lamps,disc=(x,y,r,col)=>{c.fillStyle=col;c.beginPath();c.arc(X(x),Y(y),r*SX,0,TAU);c.fill();};
      RR(-0.25,0.25,3.50,3.70,0.08,'#151A22');
      LP.w.filter(p=>p[1]>3).forEach(p=>{disc(p[0],p[1],0.082,'#5E6670');disc(p[0],p[1],0.07,'#2A3038');});
      LP.r.forEach(p=>{RR(p[0]-0.13,p[0]+0.13,p[1]-0.09,p[1]+0.09,0.06,'#151A22');disc(p[0],p[1],0.072,'#5E6670');disc(p[0],p[1],0.06,'#2A3038');});
      R(-1.6,1.6,3.30,3.43,C.yellow);R(-1.6,1.6,3.27,3.30,C.navy2);
      // the windscreen: three lights with the navy pillars and frame, the glass lighter at the top, and the two wipers
      glass(-1.48,1.48,2.20,3.27,'#5A6774','#262E38');
      c.fillStyle='rgba(255,255,255,.06)';c.beginPath();c.moveTo(X(0.70),Y(3.27));c.lineTo(X(0.30),Y(3.27));c.lineTo(X(-0.25),Y(2.20));c.lineTo(X(0.15),Y(2.20));c.closePath();c.fill();
      [-1,1].forEach(s=>R(s*0.85,s*0.90,2.18,3.28,C.navy2));R(-1.6,1.6,2.16,2.21,C.navy2);
      [-1,1].forEach(s=>{line(s*0.62,2.44,s*0.63,2.92,0.022,'#0B0D10');line(s*0.615,2.66,s*0.46,2.22,0.026,'#0B0D10');c.fillStyle='#0B0D10';c.beginPath();c.arc(X(s*0.46),Y(2.22),0.025*SX,0,TAU);c.fill();});
      // the panel under the windscreen: the ribbed centre, the headlights, the number
      R(-0.87,0.87,1.74,2.14,'#283244');for(let y=1.77;y<2.12;y+=0.05)R(-0.85,0.85,y,y+0.018,'#1E2633');
      LP.w.filter(p=>p[1]<3).forEach(p=>{RR(p[0]-0.16,p[0]+0.16,p[1]-0.10,p[1]+0.10,0.03,'#151A22');disc(p[0],p[1],0.105,'#5E6670');disc(p[0],p[1],0.09,'#2A3038');});
      c.save();c.translate(X(-0.45*cab.dir),Y(1.93));if(mir)c.scale(-1,1);c.fillStyle='#E8ECF1';c.font='600 '+Math.round(0.11*SX)+'px "IBM Plex Mono",monospace';c.textAlign='center';c.textBaseline='middle';c.fillText('448',0,0);c.restore();
      // the yellow bumper stripe with its two tow points, and the skirt
      R(-1.6,1.6,1.47,1.70,C.yellow);[-1,1].forEach(s=>{R(s*0.61,s*0.75,1.49,1.63,'#C99A10');R(s*0.63,s*0.73,1.51,1.61,C.yellow);});
      R(-1.6,1.6,0.40,1.47,'#202838');R(-1.6,1.6,1.40,1.47,C.navy2);
      [-1,1].forEach(s=>{R(s*0.85,s*1.25,0.70,1.08,'#1A212D');R(s*0.36,s*0.56,0.85,1.15,'#12161C');});
      R(-0.32,0.32,0.70,1.20,'#0E1014');R(-0.30,0.30,1.07,1.12,'#5A616B');R(-0.12,0.12,0.80,0.98,'#22272E');
      R(-0.95,0.95,0.20,0.62,'#3E3C38');R(-0.95,0.95,0.58,0.62,'#2C2A27');R(-1.6,1.6,0,0.20,'#1A1E24');}
    else{
      R(-1.6,1.6,0,4.6,C.body);dome(C.roof,3.40);c.fillStyle='rgba(255,255,255,.18)';c.beginPath();c.ellipse(X(0),Y(3.95),0.9*SX,0.22*SY,0,0,TAU);c.fill();
      R(-1.6,1.6,3.38,3.42,C.roof3);
      [-1,1].forEach(s=>R(s*1.42,s*1.50,1.20,3.36,'#C9CCCF'));
      R(-1.6,1.6,1.28,1.73,C.blue);R(-1.6,1.6,1.28,1.31,C.blue2);R(-1.6,1.6,1.92,1.95,C.line);R(-1.6,1.6,0,1.18,C.under);R(-1.6,1.6,1.16,1.20,C.under2);
      // the gangway: its hood, the posts and the two-leaf door with its windows
      c.fillStyle='#34383C';c.beginPath();c.moveTo(X(-0.86),Y(3.40));c.lineTo(X(0.86),Y(3.40));c.lineTo(X(0.75),Y(3.21));c.lineTo(X(-0.75),Y(3.21));c.closePath();c.fill();
      [-1,1].forEach(s=>R(s*0.58,s*0.73,1.16,3.22,'#3A3E42'));
      R(-0.58,0.58,1.20,3.21,C.door);R(-0.008,0.008,1.20,3.21,'#9EA1A4');R(-0.58,0.58,1.20,1.24,'#A9ACAF');
      [-1,1].forEach(s=>{RR(s*0.06,s*0.29,2.20,3.15,0.11,'#0E1013');RR(s*0.08,s*0.12,2.40,3.05,0.02,'rgba(255,255,255,.18)');});
      [-0.55,-0.47,0.47,0.55].forEach(x=>R(x-0.02,x+0.02,0.30,1.18,'#16181A'));R(-0.70,0.70,0.24,0.32,'#16181A');}
    c.restore();});
}
function matEnd448(car){const k='end_'+car;if(R448.mat[k])return R448.mat[k];
  const t=canvasTex(E448.W,E448.H,(c,w,h)=>paintEnd448(c,w,h,car));t.anisotropy=8;
  const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,0xDCDCD8);return R448.mat[k]=m;}
function mat448(car,lv){
  const k=car+'_'+lv;if(R448.mat[k])return R448.mat[k];
  const t=canvasTex(2048,1224,(c,w,h)=>paint448(c,w,h,car)),e=new THREE.TextureLoader().load(R448_MSK[k]);t.anisotropy=8;e.encoding=THREE.sRGBEncoding;
  const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});
  m.emissive=new THREE.Color(0xFFE2B8);m.emissiveMap=e;m.emissiveIntensity=NIGHT.N*0.9;NIGHT.winMats.push(m);MAT_HEX.set(m,0xDCDCD8);
  return R448.mat[k]=m;
}
function build448(tr,sp,i,n){
  const C=R448.car[sp.car],lv=sp.lv||'GL',P=R448.parts[sp.car]||(R448.parts[sp.car]=parts448(sp.car)),T=tex470(),mt=mat448(sp.car,lv);
  const flip=sp.cab!==0&&sp.cab!==C.cabDir;
  const g=new THREE.Group(),inner=new THREE.Group(),root=new THREE.Group();if(flip)inner.rotation.y=PI;g.add(inner);inner.add(root);
  const body=[];
  if(!T.solid.rim){T.solid.rim=tmat(0x8A8D90);T.solid.spring=tmat(0x2B2E31);}
  Object.keys(P).forEach(key=>{const m=new THREE.Mesh(geoFromArrays(P[key]),key==='tex'?mt:key==='tend'?matEnd448(sp.car):T.solid[key]);m.castShadow=true;m.receiveShadow=true;root.add(m);
    if(key==='tex'||key==='tend'){m.userData.ent=tr.ent;body.push(m);}});
  scharfHang(root,P.sch);
  // head and tail lamps where the package puts them: white lit on the leading cab, red on the trailing one
  if(C.lamps){const lead=sp.cab!==0&&i===0,tail=sp.cab!==0&&i===n-1,ry=C.cabDir<0?PI:0;
    C.lamps.w.forEach(p=>{const m=new THREE.Mesh(new THREE.CircleGeometry(p[1]>3?0.07:0.09,12),lead?T.solid.lightW:T.solid.lampOffW);m.rotation.y=ry;m.position.set(p[0],p[1],p[2]+C.cabDir*0.01);root.add(m);});
    C.lamps.r.forEach(p=>{const m=new THREE.Mesh(new THREE.CircleGeometry(0.06,10),tail?T.solid.lightR:T.solid.lampOffR);m.rotation.y=ry;m.position.set(p[0],p[1],p[2]+C.cabDir*0.01);root.add(m);});}
  const doorZ=C.doors.map(z=>flip?-z:z);
  return{g:g,inner:inner,L:C.L,body:body,doorZ:doorZ,kind:'448'};
}
function specs448(lv,dir){
  const L=car=>R448.car[car].L;
  let s=[{k:'r448',car:'M',lv:lv,L:L('M'),cab:1},{k:'r448',car:'Ri',lv:lv,L:L('Ri'),cab:0},{k:'r448',car:'Rc',lv:lv,L:L('Rc'),cab:-1}];
  if(dir<0)s=s.slice().reverse().map(o=>Object.assign({},o,{cab:-o.cab}));
  return s;
}
function buildCar0(tr,sp,i,n){
  if(/^(loco311|ttci|ttbob|ttcast|ttloco|ttcar|ttplat|vagoneta)$/.test(sp.k))return buildTT(tr,sp,i,n);
  if(sp.k==='md'){const c=build470(tr,sp,i===0);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='loco269'){const c=build269(tr,sp);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='loco319'){const c=build319(tr,sp);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='loco252'){const c=build252(tr,sp);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='t3'){const c=buildT3(tr,sp);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='semat'){const c=buildSemat(tr,sp);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='jpd'){const c=buildJPD(tr,sp);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='hopper'){const c=buildTT6(tr,sp);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='r10k'){const c=build10k(tr,sp,i===n-1);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='r432'){const c=build432(tr,sp,i,n);c.body.forEach(m=>PICK.push(m));return c;}
  if(sp.k==='r448'){const c=build448(tr,sp,i,n);c.body.forEach(m=>PICK.push(m));return c;}
  const g=new THREE.Group(),L=sp.L,body=[];
  const B=(m,x,y,z,w,h,d)=>tbox(g,m,x,y,z,w,h,d);
  const cab=(e,mat,lights)=>{
    B(TM.dark,0,2.25,e*(L/2-0.5),2.72,1.1,0.95);
    B(mat,0,0.95,e*(L/2+0.32),2.6,1.45,0.64);
    if(lights){const lm=lights==='w'?LIGHT_W:LIGHT_R;B(lm,0.85,1.62,e*(L/2+0.65),0.38,0.18,0.03);B(lm,-0.85,1.62,e*(L/2+0.65),0.38,0.18,0.03);}
  };
  const panto=(z)=>{const m=new THREE.Mesh(geoFromArrays(pantoA(z,5.26)),TM.panto);m.castShadow=true;g.add(m);};
  if(sp.k==='md'){
    B(TM.bogie,0,0,L/2-3.6,2.3,0.8,3.0);B(TM.bogie,0,0,-(L/2-3.6),2.3,0.8,3.0);
    B(TM.dark,0,0.75,0,2.7,0.4,L-1.2);
    body.push(B(TM.white,0,1.05,0,2.92,2.9,L-0.2));
    B(TM.md,0,1.32,0,2.96,0.34,L-0.6);
    B(TM.glass,0,2.25,0,2.97,0.8,L-3.4);
    B(TM.roof,0,3.95,0,2.4,0.3,L-1.6);
    [L/2-5.4,-(L/2-5.4)].forEach(z=>{B(tr.doorA,1.48,1.12,z,0.05,2.3,1.3);B(tr.doorB,-1.48,1.12,z,0.05,2.3,1.3);});
    if(sp.cab)cab(sp.cab,TM.white,sp.cab>0?'w':'r');
    if(sp.panto)panto(0);
  }else if(sp.k==='tc'){
    B(TM.bogie,0,0,L/2-3.4,2.3,0.8,2.8);B(TM.bogie,0,0,-(L/2-3.4),2.3,0.8,2.8);
    body.push(B(TM.silver,0,0.95,0,2.94,3.15,L-0.4));
    B(TM.alvia,0,1.25,0,2.98,0.4,L-0.8);B(TM.dark,0,2.5,-1,2.98,0.9,L-7);
    const e=sp.cab;B(TM.silver,0,0.95,e*(L/2+0.9),2.5,2.2,1.8);B(TM.dark,0,2.55,e*(L/2-0.2),2.6,0.95,1.4);B(TM.alvia,0,1.05,e*(L/2+1.85),2.2,0.9,0.3);
    const lm=e>0?LIGHT_W:LIGHT_R;B(lm,0.8,1.5,e*(L/2+2.02),0.36,0.16,0.03);B(lm,-0.8,1.5,e*(L/2+2.02),0.36,0.16,0.03);
    if(sp.panto)panto(-3);
  }else if(sp.k==='loco'){
    B(TM.bogie,0,0,L/2-3.6,2.4,0.85,3.2);B(TM.bogie,0,0,-(L/2-3.6),2.4,0.85,3.2);
    B(TM.dark,0,0.8,0,2.8,0.4,L-0.6);
    body.push(B(TM.loco,0,1.2,0,2.95,2.95,L-1.6));
    B(TM.locoY,0,1.2,L/2-1.2,2.97,2.95,1.4);B(TM.locoY,0,1.2,-(L/2-1.2),2.97,2.95,1.4);
    B(TM.dark,0,1.8,0,2.97,0.9,L-6);B(TM.roof,0,4.15,0,2.3,0.25,L-3);
    cab(1,TM.locoY,'w');cab(-1,TM.locoY,null);
    panto(-4);
  }else{ // hopper
    B(TM.bogie,0,0,L/2-2.2,2.2,0.8,2.2);B(TM.bogie,0,0,-(L/2-2.2),2.2,0.8,2.2);
    B(TM.dark,0,0.8,0,2.6,0.35,L-0.4);
    B(TM.hopperD,0,1.0,0,2.3,1.1,L-1.6);
    body.push(B(TM.hopper,0,2.0,0,2.95,2.0,L-0.6));
    B(TM.hopperD,0,4.0,0,2.7,0.18,L-0.8);
  }
  body.forEach(m=>{m.userData.ent=tr.ent;PICK.push(m);});
  return{g:g,L:L,body:body};
}

/* =====================================================================
   22. Passengers
   ===================================================================== */
const MAXP=280,PS=1.12;
/* low-poly people. The body (gente3d.js) is a low-poly man (alicewithalex, CC BY 4.0) with his arms brought down and cut
   at the joints, so each piece moves on its own like the jointed figures of a diorama; of him are kept the head, the
   hands, the hair and what shows bare (the forearms in short sleeves, the legs under a skirt or shorts). The clothes are
   made here (GARB): each garment is a loft, rings of a rounded section from the hem up, looser than the body it covers, so
   a jumper hangs like a jumper and trousers fall straight onto the shoe, and nothing of the body pokes through. Men and
   women, from slim to stout; a jumper, a V-neck over a shirt, a shirt (tucked in with a belt or loose, the collar open
   or done up), short sleeves and shorts in summer, a jacket with the shirt and sometimes a tie, the farmer's blue
   overall; trousers narrow or wide, a skirt to the knee, long or pleated, a dress; from October to April an overcoat
   (with a scarf in its opening) or a padded jacket with its zip and hood; a backpack, or a handbag, a travel bag or a
   briefcase carried in the hand; hats, caps, headscarves and the hair as before; the very old stooped, some with a
   stick; teenagers smaller, with a child's head.
   One instanced mesh per piece, each person with their own clothes, colours, height and build. */
const PAXG=(function(){const D=window.GENTE3D,out={};
  const dec=(b,T)=>{const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return new T(u.buffer);};
  Object.keys(D.parts).forEach(k=>{if(/^(torso|hips|chaq|coat|skirt|shirt|bag|hood|shoe|hairS|head)/.test(k))return;   // the old clothes, replaced by GARB
    const P=dec(D.parts[k].p,Int16Array),C=dec(D.parts[k].c,Uint8Array),pos=new Float32Array(P.length),col=new Float32Array(P.length);
    for(let i=0;i<P.length;i++)pos[i]=P[i]*D.q;for(let i=0;i<C.length;i++){const v=C[i]/255;col[i*3]=v;col[i*3+1]=v;col[i*3+2]=v;}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeVertexNormals();out[k]=g;});
  return out;})();
/* the joints of the body (the man's; the woman's shoulders are narrower) */
const PJ=(function(){const L=window.GENTE3D.len;return{arm:L.arm,thigh:L.thigh,shin:L.shin,ankle:L.ankle,sh:L.sh,shF:L.shF,hip:L.hip,neck:L.neck,waist:L.spine[1]};})();
/* ---- the clothes. Vertex colour of a garment: r = shade, g = how much of the second colour, b = of the third (a shirt
   in the opening of a jacket, a tie, a belt, a zip), so one piece carries up to three colours of its wearer.
   The trunk garments are built four times with the same triangles (man, woman, and both stout) and blended per person
   (GARB_MAT): the sex, the build from slim to stout, and for the jumper whether it is tucked in. ---- */
const GARB=(function(){
  const sup=(a,e)=>{const c=Math.cos(a),s=Math.sin(a),q=2/e;return[Math.sign(c)*Math.pow(Math.abs(c),q),Math.sign(s)*Math.pow(Math.abs(s),q)];};
  const R=(y,rx,zF,zB,e,o)=>Object.assign({y:y,cx:0,cz:(zF+zB)/2,rx:rx,rz:(zF-zB)/2,e:e||2.4},o||{});     // a ring of the trunk: half width, front and back
  const Q=(y,cx,rx,rz,cz,o)=>Object.assign({y:y,cx:cx,cz:cz||0,rx:rx,rz:rz,e:2},o||{});                   // a ring of a limb
  const rp=(r,k,n)=>{const u=sup((k+0.5)/n*TAU,r.e);return[r.cx+r.rx*u[0],r.y,r.cz+r.rz*u[1]];};
  const at=(G,n,A)=>{for(let i=0;i<n;i++)G.c.push(A[0],A[1]||0,A[2]||0);};
  const quad=(G,a,b,c,d,A)=>{G.p.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2],a[0],a[1],a[2],c[0],c[1],c[2],d[0],d[1],d[2]);at(G,6,A);};
  const tri=(G,a,b,c,A)=>{G.p.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);at(G,3,A);};
  /* rings from the bottom up; the band above a ring takes that ring's colours (a: [shade, 2nd, 3rd]). front(ring, xf) gives
     the breakpoints across the flat front face (from -xf to xf) and what fills each column; pleat darkens every other face */
  function loft(G,rings,n,front,pleat){const fk=n/4-1;
    for(let i=0;i<rings.length-1;i++){const r0=rings[i],r1=rings[i+1],A=r0.a||[1,0,0];
      for(let k=0;k<n;k++){const a=rp(r0,k,n),b=rp(r0,(k+1)%n,n),c=rp(r1,(k+1)%n,n),d=rp(r1,k,n);
        if(front&&k===fk){const f0=front(r0,a[0]),f1=front(r1,d[0]);
          for(let j=0;j<f0.x.length-1;j++){const B=f0.a[j]||[1];quad(G,[f0.x[j+1],r0.y,a[2]],[f0.x[j],r0.y,a[2]],[f1.x[j],r1.y,d[2]],[f1.x[j+1],r1.y,d[2]],[B[0]*A[0],B[1]===undefined?A[1]:B[1],B[2]===undefined?A[2]:B[2]]);}
          continue;}
        quad(G,a,b,c,d,pleat&&r0.y<pleat&&k%2?[A[0]*0.86,A[1],A[2]]:A);}}}
  const fan=(G,r,n,yc,A,dx)=>{const c=[r.cx+(dx||0),yc,r.cz];for(let k=0;k<n;k++)tri(G,c,rp(r,k,n),rp(r,(k+1)%n,n),A);};
  const box=(G,x0,x1,y0,y1,z0,z1,A)=>{const v=(i,j,k)=>[i?x1:x0,j?y1:y0,k?z1:z0];
    [[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],[[1,0,0],[1,0,1],[1,1,1],[1,1,0]],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],[[0,1,0],[1,1,0],[1,1,1],[0,1,1]]]
      .forEach(q=>quad(G,v(...q[0]),v(...q[1]),v(...q[2]),v(...q[3]),A));};
  const NEW=()=>({p:[],c:[]});
  const geo=(G,ex)=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(G.p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(G.c,3));
    if(ex)for(const k in ex)g.setAttribute(k,new THREE.Float32BufferAttribute(ex[k],3));return g;};   // no normals: the cloth is shaded flat, face by face
  const mir=G=>{const p=G.p.slice();for(let i=0;i<p.length;i+=3)p[i]=-p[i];return{p:p,c:G.c};};
  const dif=(a,b)=>a.map((v,i)=>v-b[i]);
  /* the trunk of each build, as its clothes hang on it: where a jumper ends at the hip, and from the waist to the neck */
  const UM=[[1.405,.174,.098,-.140,2.5],[1.445,.132,.078,-.120,2.3],[1.475,.078,.058,-.094,2.1],[1.495,.063,.049,-.084,2.0]],
        UF=[[1.405,.152,.092,-.130,2.4],[1.445,.114,.074,-.112,2.3],[1.475,.071,.054,-.088,2.1],[1.495,.057,.045,-.077,2.0]];
  const BODY={
    M :{hip:[.90,.176,.120,-.146,2.5],up:[[1.05,.158,.112,-.118,2.5],[1.18,.172,.126,-.135,2.6],[1.28,.180,.134,-.150,2.7],[1.35,.186,.120,-.150,2.7]].concat(UM)},
    F :{hip:[.90,.180,.118,-.158,2.5],up:[[1.06,.146,.106,-.110,2.4],[1.17,.150,.128,-.122,2.5],[1.26,.158,.150,-.136,2.5],[1.35,.162,.112,-.140,2.6]].concat(UF)},
    MB:{hip:[.90,.196,.174,-.152,2.5],up:[[1.05,.186,.182,-.126,2.5],[1.18,.188,.166,-.140,2.6],[1.28,.190,.144,-.152,2.7],[1.35,.192,.124,-.152,2.7]].concat(UM)},
    FB:{hip:[.90,.200,.156,-.170,2.5],up:[[1.06,.172,.150,-.120,2.4],[1.17,.172,.156,-.128,2.5],[1.26,.174,.166,-.140,2.5],[1.35,.170,.118,-.142,2.6]].concat(UF)}};
  const T=(v,t,o,y)=>R(y===undefined?v[0]:y,v[1]+t,v[2]+t,v[3]-t,v[4],o),N=12;
  function shell(kind,B){const b=BODY[B],u=b.up,h=b.hip,G=NEW();let rings,front;
    if(kind==='jer'){   // jumper, shirt, T-shirt: a ribbed hem at the hip (or tucked in at the waist), the neck with its V, the placket down the front
      rings=[T(h,0,{a:[.84,0,0]},.895),T(h,0,null,.935)].concat(u.slice(0,6).map(v=>T(v,0)),[T(u[6],0,{a:[.86,1,0]}),T(u[7],0)]);
      front=(r,xf)=>{const y=r.y,pw=y<1.40?Math.min(.007,xf*.3):0,v=y<1.40?0:y<1.44?(y-1.405)*.75:.03-(y-1.445)*.2,w=Math.max(pw,Math.min(v,xf*.85));
        return{x:[-xf,-w,-pw,pw,w,xf],a:[null,[1,1,0],[1,0,1],[1,1,0],null]};};}
    else if(kind==='ame'||kind==='abr'){   // jacket and overcoat: open in a V with its lapels, the shirt (and tie) or the scarf in the opening
      const co=kind==='abr',t=co?.024:.014,vb=co?1.28:1.18,vk=co?.36:.23;
      rings=(co?[R(.50,h[1]+.05,h[2]+.045,h[3]-.045,2.8),R(.70,h[1]+.036,h[2]+.034,h[3]-.034,2.6),T(h,t)]:[R(.80,h[1]+t+.006,h[2]+t+.006,h[3]-t-.006,2.5),T(h,t)])
        .concat(u.slice(0,6).map(v=>T(v,t)),[T(u[6],t,{a:[.86,0,0]}),T(u[7],t)]);
      front=(r,xf)=>{const y=r.y,op=y<vb-.001,w=y<=vb?.003:Math.min((y-vb)*vk,xf*.8),lap=y<vb+.03?0:Math.max(0,Math.min(co?.03:.026,xf-w-.004)),tw=y<=vb?.003:co?0:Math.min(.011,w*.45);
        return{x:[-xf,-(w+lap),-w,-tw,tw,w,w+lap,xf],a:[null,[.8],[1,1,0],op?[.6]:[1,0,1],[1,1,0],[.8],null]};};}
    else{   // padded jacket: elastic at the waist, quilted bands, the zip, a collar that stands up to the chin
      const t=.03;
      rings=[R(.865,h[1]+.012,h[2]+.012,h[3]-.012,2.5,{a:[.8,0,0]}),R(.898,h[1]+.012,h[2]+.012,h[3]-.012,2.5),T(h,t+.008,null,.905),T(u[0],t,{a:[.93,0,0]}),T(u[1],t),T(u[2],t,{a:[.93,0,0]}),T(u[3],t),T(u[4],t,{a:[.95,0,0]}),T(u[5],t),
        R(1.475,u[6][1]+.02,u[6][2]+.022,u[6][3]-.02,2.1,{a:[.9,0,0]}),R(1.525,u[7][1]+.022,u[7][2]+.026,u[7][3]-.02,2.0)];
      front=(r,xf)=>({x:[-xf,-.006,.006,xf],a:[null,[1,0,1],null]});}
    loft(G,rings,N,front);const top=rings[rings.length-1];fan(G,top,N,top.y-.008,[.3,0,0]);return G;}
  const out={};
  ['jer','ame','abr','chq'].forEach(k=>{const m=shell(k,'M'),f=shell(k,'F'),ex={aF:dif(f.p,m.p),aDM:dif(shell(k,'MB').p,m.p),aDF:dif(shell(k,'FB').p,f.p)};
    out[k]=geo(m,ex);});
  /* the hood of the padded jacket, lying on the back */
  {const G=NEW(),r=[R(1.39,.075,-.13,-.19),R(1.44,.105,-.10,-.215),R(1.50,.100,-.095,-.205),R(1.535,.06,-.11,-.17)];loft(G,r,8);fan(G,r[0],8,1.385,[.9]);fan(G,r[3],8,1.545,[1]);out.hood=geo(G);}
  /* sleeves (from the shoulder; the left one, mirrored for the right): the upper one with its rounded shoulder, a short one,
     and the forearm with its cuff (2nd colour: the shirt under a jacket) */
  const L8=8,limb=(k,G)=>{out[k+'L']=geo(G);out[k+'R']=geo(mir(G));};
  {const up=[Q(.008,-.016,.060,.066),Q(.036,-.028,.040,.050)];
    let G=NEW(),r=[Q(-.272,-.010,.050,.053),Q(-.20,-.011,.055,.058),Q(-.06,-.013,.061,.066)].concat(up);loft(G,r,L8);fan(G,r[4],L8,.05,[1],-.008);limb('slv',G);
    G=NEW();r=[Q(-.145,-.012,.061,.065,0,{a:[.88,0,0]}),Q(-.125,-.012,.061,.065),Q(-.06,-.013,.061,.066)].concat(up);loft(G,r,L8);fan(G,r[4],L8,.05,[1],-.008);limb('sls',G);
    G=NEW();r=[Q(-.312,0,.040,.043,0,{a:[.86,1,0]}),Q(-.285,0,.041,.044),Q(-.20,0,.044,.047),Q(-.05,-.004,.049,.052),Q(.012,-.008,.047,.050)];loft(G,r,L8);fan(G,r[4],L8,.03,[1]);fan(G,r[0],L8,-.300,[.3,0,0]);limb('cuf',G);}
  /* trousers: the seat with its belt (2nd colour) and buckle (3rd), the thigh rounded at the knee, the leg down onto the shoe;
     and the leg of a pair of shorts */
  {let G=NEW(),r=[R(.755,.085,.034,-.094,2.2),R(.80,.142,.058,-.124,2.3),R(.86,.164,.076,-.138,2.4),R(.93,.158,.096,-.134,2.4),R(1.02,.130,.092,-.102,2.4,{a:[1,1,0]}),R(1.045,.128,.090,-.100,2.4)];
    loft(G,r,N,(q,xf)=>({x:[-xf,-.014,.014,xf],a:[null,q.y>1?[1,0,1]:null,null]}));fan(G,r[0],N,.74,[1]);out.pelv=geo(G);
    const hi=[Q(-.12,-.006,.080,.090),Q(-.02,-.008,.080,.094,-.004),Q(.04,-.006,.068,.080,-.005)];
    G=NEW();r=[Q(-.475,0,.055,.059,-.004),Q(-.4354,0,.060,.064),Q(-.30,-.002,.068,.074,.002)].concat(hi);loft(G,r,L8);fan(G,r[0],L8,-.49,[.9]);fan(G,r[5],L8,.06,[1]);limb('trs',G);
    G=NEW();r=[Q(-.392,0,.056,.064,.004),Q(-.20,0,.056,.060,-.006),Q(-.04,0,.060,.064,-.006),Q(.02,0,.054,.058,-.004)];loft(G,r,L8);fan(G,r[3],L8,.035,[1]);fan(G,r[0],L8,-.378,[.3,0,0]);limb('trc',G);
    G=NEW();r=[Q(-.25,-.004,.088,.096,.008,{a:[.9,0,0]}),Q(-.23,-.004,.088,.096,.008),Q(-.12,-.008,.092,.102,.002),Q(-.02,-.010,.094,.106,-.004),Q(.04,-.008,.078,.090,-.005)];loft(G,r,L8);fan(G,r[4],L8,.06,[1]);limb('sho',G);}
  /* skirts: to the knee, long, and pleated */
  {const wb=[R(.93,.160,.100,-.136,2.4,{a:[.9,0,0]}),R(1.04,.130,.092,-.102,2.4)];
    let G=NEW();loft(G,[R(.47,.222,.165,-.195,2.3),R(.80,.190,.124,-.160,2.4)].concat(wb),N);out.skA=geo(G);
    G=NEW();loft(G,[R(.30,.205,.150,-.182,2.3),R(.80,.186,.120,-.158,2.4)].concat(wb),N);out.skL=geo(G);
    G=NEW();loft(G,[R(.50,.250,.190,-.215,2.2),R(.84,.180,.114,-.150,2.4)].concat(wb),16,null,.9);out.skP=geo(G);}
  /* what is carried in the hand, hanging from its handles (the origin is the grip): a handbag, a travel bag, a briefcase */
  {const strap=(G,z0,z1,y,w)=>{quad(G,[-w,y,z0],[w,y,z0],[w,-.012,z0*.2],[-w,-.012,z0*.2],[.7]);quad(G,[-w,-.012,z0*.2],[w,-.012,z0*.2],[w,-.012,z1*.2],[-w,-.012,z1*.2],[.7]);quad(G,[-w,-.012,z1*.2],[w,-.012,z1*.2],[w,y,z1],[-w,y,z1],[.7]);};
    let G=NEW();box(G,-.042,.042,-.33,-.22,-.135,.135,[1]);box(G,-.045,.045,-.22,-.16,-.138,.138,[.82]);box(G,-.048,-.045,-.21,-.185,-.02,.02,[1,0,1]);strap(G,-.075,.075,-.16,.012);out.bagH=geo(G);
    G=NEW();const r=[R(-.40,.075,.20,-.20,3.6),R(-.375,.10,.225,-.225,3.6),R(-.27,.108,.232,-.232,3.6,{a:[1,1,0]}),R(-.24,.108,.232,-.232,3.6),R(-.165,.085,.222,-.222,3.6),R(-.15,.03,.20,-.20,3.6)];
    loft(G,r,N);fan(G,r[0],N,-.405,[.85]);fan(G,r[5],N,-.148,[.8,0,1]);strap(G,-.09,.09,-.16,.014);out.bagT=geo(G);
    G=NEW();box(G,-.042,.042,-.43,-.13,-.20,.20,[1]);box(G,-.045,.045,-.165,-.13,-.203,.203,[.8]);box(G,-.047,-.042,-.20,-.17,-.03,.03,[1,0,1]);strap(G,-.05,.05,-.13,.012);out.bagC=geo(G);}
  /* a shoe (from the ankle): the upper over a sole of the 2nd colour, the toe low and rounded, the heel counter up to the ankle */
  {const O=[[-.052,0,-.014],[-.046,.030,-.012],[-.008,.042,-.006],[.07,.047,-.044],[.14,.045,-.058],[.186,.031,-.067],[.206,0,-.076]],G=NEW(),ys=-.098,yt=-.080,rdg=[0,0,.004,.014,.010,.004,0];
    const sd=(sg,o)=>{for(let j=0;j<O.length-1;j++){const a=O[j],b=O[j+1],ax=sg*a[1],bx=sg*b[1];
      quad(G,[ax*1.06,ys,a[0]*1.03],[bx*1.06,ys,b[0]*1.03],[bx*1.06,yt,b[0]*1.03],[ax*1.06,yt,a[0]*1.03],[1,1,0]);          // the edge of the sole
      quad(G,[ax,yt,a[0]],[bx,yt,b[0]],[bx,b[2],b[0]],[ax,a[2],a[0]],[o,0,0]);                                              // the side of the upper
      quad(G,[ax,a[2],a[0]],[bx,b[2],b[0]],[0,b[2]+rdg[j+1],b[0]],[0,a[2]+rdg[j],a[0]],[j<2?.5:1,0,0]);                     // over the foot (dark where the leg goes in)
      quad(G,[ax*1.06,ys,a[0]*1.03],[bx*1.06,ys,b[0]*1.03],[0,ys,b[0]*1.03],[0,ys,a[0]*1.03],[.8,1,0]);}};
    sd(1,1);sd(-1,.92);out.zapL=geo(G);out.zapR=geo(mir(G));}
  /* the head: rings from the chin to the crown, 24 columns round it (closer together across the face), built as a face is
     drawn: the brow ridge over the sockets, almond eyes with the iris, the nose with its bridge, wings and underside, the
     lips meeting at the corners of the mouth, cheekbones, the jaw down to the chin, ears, the neck. The cranium keeps the
     size of the old head, so the hair and the hats sit on it as they did. Second vertex colour = what the face is there
     (0 skin, .15 where a beard grows, .3 a moustache, .45 lips, .6 iris, .75 the white of the eye, .9 eyebrow).
     Built four times like the trunk (he, she, and both stout), and once more without ears (under hair that covers them) */
  {const TH=[0,5,10,16,24,30,42,60,80,100,125,152,180];
    // the rings, from the bottom: under the chin, chin, under the lower lip, the line of the mouth, top of the upper lip, where a
    // moustache ends, base of the nose, its tip, cheek, under the eye, over it, under the eyebrow, over it, forehead, hairline, crown
    const Y=[1.515,1.530,1.549,1.559,1.567,1.577,1.586,1.600,1.626,1.639,1.650,1.661,1.672,1.700,1.735,1.758],
      CHB=0,CHN=1,LPB=2,MTH=3,LPT=4,MST=5,NSB=6,NST=7,CHK=8,EYB=9,EYT=10,BRB=11,BRT=12,FOR=13,NR=16;
    const RM=[[.090,.088,.082,.070,.062,.056,.052,.052,.052,.056,.064,.070,.074],
      [.104,.103,.098,.088,.079,.070,.060,.056,.055,.058,.068,.074,.077],
      [.108,.107,.104,.098,.092,.085,.071,.062,.059,.061,.070,.076,.080],
      [.107,.107,.105,.101,.097,.091,.077,.066,.061,.063,.070,.078,.081],
      [.110,.109,.106,.102,.099,.095,.083,.069,.064,.065,.070,.080,.083],
      [.112,.110,.105,.102,.100,.097,.086,.071,.069,.070,.076,.081,.084],
      [.117,.113,.104,.102,.101,.099,.089,.074,.074,.076,.082,.083,.086],
      [.127,.120,.106,.102,.101,.100,.094,.078,.076,.078,.085,.089,.089],
      [.112,.104,.098,.099,.100,.100,.099,.083,.079,.080,.088,.099,.100],
      [.107,.101,.095,.096,.097,.096,.098,.083,.080,.081,.089,.101,.102],
      [.103,.100,.095,.096,.097,.096,.097,.084,.079,.081,.090,.102,.104],
      [.106,.106,.106,.107,.107,.105,.098,.084,.079,.080,.090,.103,.105],
      [.105,.105,.105,.106,.106,.104,.098,.083,.079,.079,.090,.102,.105],
      [.098,.098,.097,.097,.096,.094,.090,.082,.079,.080,.089,.100,.103],
      [.087,.087,.086,.086,.086,.084,.080,.073,.070,.070,.079,.092,.095],
      [.064,.064,.063,.063,.063,.062,.059,.054,.050,.050,.059,.072,.077]];
    // where a vertex leaves its ring: the corners of the eyes and the round of the iris, the ends and the arch of the eyebrow,
    // the bow of the lip and the corners of the mouth, the droop of a moustache, the nose
    const DY={};DY[EYB]={2:.003,3:-.0012,4:-.0012,5:.0025};DY[EYT]={2:-.003,3:.0012,4:.0012,5:-.003};DY[BRB]={2:-.001,3:.001,4:.002,5:.001,6:-.002};DY[BRT]={2:-.004,3:-.003,4:-.002,5:-.006};
    DY[LPT]={0:-.0015,1:.0005,3:-.006};DY[LPB]={3:.008};DY[MST]={3:-.008};DY[NST]={0:-.002,2:-.004};DY[NSB]={0:.002,2:.002};
    const EAR={};EAR[NST]=[.002,.008];EAR[CHK]=[.004,.017];EAR[EYB]=[.004,.018];EAR[EYT]=[.004,.017];EAR[BRB]=[.002,.010];
    const V=(i,j,B,ear)=>{const f=B[0]==='F',big=B.length>1,ja=Math.abs(j);let r=RM[i][ja],y=Y[i]+(DY[i]&&DY[i][ja]||0);
      if(ear&&EAR[i]&&(ja===8||ja===9))r+=EAR[i][ja-8];
      if(f){r*=0.945;if(i<=LPT&&ja>=4&&ja<=9)r*=0.955;if(i<=CHN&&ja<=3){r-=0.005;y+=0.004;}if((i===NSB||i===NST)&&ja<=1)r-=0.005;if((i===BRB||i===BRT)&&ja<=5)r-=0.002;   // she: smaller, a finer jaw, chin, nose and brow
        if(i===LPT&&ja<=2)y+=0.001;if(i===LPB&&ja<=2)y-=0.001;if(i===BRT&&ja>=2&&ja<=5)y-=0.003;if(i===EYT&&(ja===3||ja===4))y+=0.0015;}
      if(big){if(i<=NST&&ja>=3&&ja<=9)r+=0.004+0.005*(1-i/NST);if(i<=CHN&&ja<=3)r+=0.004;if(i===CHB)y-=0.005;}                                                      // stout: fuller cheeks and jowls, a second chin
      const th=TH[ja]*PI/180*(j<0?-1:1);return[r*Math.sin(th),y,r*Math.cos(th)];};
    // what each cell of the face is, and its shade (i: the ring under it; c: its column, from the middle of the face). A cell
    // may be cut along its diagonal: BEARD marks the ones where only the lower outer half is beard, so its edge runs down the
    // cheek from the ear to the corner of the mouth
    const SK=[1,0,0],BD=[1,.15,0];
    const A=(i,c)=>{if(i===BRB&&c>=2&&c<=4)return[.95,.9,0];
      if(i===EYB&&c>=2&&c<=4)return[c===3?1:.9,c===3?.6:.75,0];
      if(i===EYT&&c>=2&&c<=4)return[.84,0,0];if(i===CHK&&c>=2&&c<=4)return[.95,0,0];
      if(i===MTH&&c<=2)return[.9,.45,0];if(i===LPB&&c<=2)return[1,.45,0];
      if(i===LPT&&c<=2)return[c===0?.97:1,.3,0];
      if(i===NSB&&c<=1)return[c===0?.72:.84,0,0];if(i>=NST&&i<=EYB&&c===1)return[.94,0,0];
      if(i<=LPB&&c<=7)return[i<=CHN?.96:1,.15,0];
      if((i===MTH&&c>=3&&c<=6)||(i===LPT&&c>=4&&c<=6)||(i===MST&&c>=5&&c<=6)||(i===NSB&&c>=6&&c<=7)||(i>=NST&&i<=EYB&&c===7))return BD;
      if(i>=NST&&i<=EYT&&c===8)return[.86,0,0];if(i>=NST&&i<=EYT&&c===9)return[.76,0,0];
      return[i>=FOR?1.02:1,0,0];};
    const HALF=(i,c)=>(i===LPT&&c===3)||(i===MST&&c===4)||(i===NSB&&c===5)||(i===NST&&c===6);
    const head=(B,ear)=>{const G=NEW(),f=B[0]==='F',big=B.length>1;
      for(let i=0;i<NR-1;i++)for(let j=-12;j<12;j++){const c=Math.min(Math.abs(j),Math.abs(j+1)),j0=j<0?j+1:j,j1=j<0?j:j+1,   // (mirrored, so both sides of the face are cut alike)
          a=V(i,j0,B,ear),b=V(i,j1,B,ear),d=V(i+1,j1,B,ear),e=V(i+1,j0,B,ear),at2=A(i,c);
        tri(G,a,b,d,HALF(i,c)?BD:at2);tri(G,a,d,e,at2);}
      for(let j=-12;j<12;j++){tri(G,[0,1.772,-.004],V(NR-1,j,B,ear),V(NR-1,j+1,B,ear),[1.03]);tri(G,[0,1.509,.008],V(0,j,B,ear),V(0,j+1,B,ear),[.8,Math.min(Math.abs(j),Math.abs(j+1))<=6?.15:0,0]);}
      const k=(f?0.88:1)*(big?1.14:1),nk=[R(1.435,.066*k,.064*k,-.088*k,2,{a:[.95,0,0]}),R(1.47,.055*k,.040*k,-.076*k,2,{a:[.9,0,0]}),R(1.50,.052*k,.038*k,-.072*k,2,{a:[.82,0,0]}),R(1.54,.050*k,.036*k,-.068*k,2)];
      loft(G,nk,10);return G;};
    const m=head('M',1),fm=head('F',1);
    out.cab=geo(m,{aF:dif(fm.p,m.p),aDM:dif(head('MB',1).p,m.p),aDF:dif(head('FB',1).p,fm.p),aEar:dif(head('M',0).p,m.p)});
    /* the hair left round the back of a bald head, or showing under a beret or a cap: over the ears and round the back down
       to the nape, lying on the head (plain hair material) */
    const G=NEW(),H=(i,j)=>{const v=V(i,j,'M',0),k=1+0.004/Math.hypot(v[0],v[2]);return[v[0]*k,v[1],v[2]*k];};
    for(let i=MTH;i<BRT;i++)for(let j=-12;j<12;j++){const c=Math.min(Math.abs(j),Math.abs(j+1));if(i<NSB?c>=11:c>=10||(c>=8&&i>=BRB)||(c===9&&i===EYT)){const q=i%2?.94:1;quad(G,H(i,j),H(i,j+1),H(i+1,j+1),H(i+1,j),[q,q,q]);}}
    const g=geo(G);g.computeVertexNormals();out.hairS=g;}
  return out;})();
const GARB_PLAIN={hairS:1};
Object.assign(PAXG,GARB);
/* the material of the clothes: the three colours of each person, the blend of builds, and the cloth giving way to the body
   underneath: below the waist it hangs plumb when the trunk leans, and the skirt of a coat, a jacket or a skirt follows the
   stride, each half going with its own leg, the front with the knee and the back with the calf */
function garbMat(def){const m=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:THREE.DoubleSide,flatShading:true});m.defines=Object.assign({},def);
  m.onBeforeCompile=function(s){
    s.vertexShader='attribute vec3 aC2;attribute vec3 aC3;\n#ifdef G_MORPH\nattribute vec3 aF;attribute vec3 aDM;attribute vec3 aDF;\n#endif\n#if defined(G_MORPH)||defined(G_FLARE)\nattribute vec4 aBld;\n#endif\n#ifdef G_FLARE\nattribute vec4 aStr;\n#endif\n#ifdef G_HEAD\nattribute vec3 aEar;\n#endif\n'+
      s.vertexShader.replace('#include <color_vertex>','#ifdef G_HEAD\n{float fid=color.g;vec3 fc=instanceColor;\nif(fid>0.82)fc=aC2;else if(fid>0.67)fc=vec3(0.60,0.58,0.54);else if(fid>0.52)fc=vec3(0.028,0.016,0.010);else if(fid>0.37)fc=aC3;\nelse if(fid>0.22)fc=mix(fc,aC2,step(0.5,aBld.w));else if(fid>0.07)fc=mix(fc,aC2,step(1.5,aBld.w));\nvColor=fc*color.r;}\n#else\nvColor=mix(mix(instanceColor,aC2,color.g),aC3,color.b)*color.r;\n#endif')
        .replace('#include <begin_vertex>','vec3 transformed=vec3(position);\n#ifdef G_MORPH\ntransformed+=aF*aBld.x+mix(aDM,aDF,aBld.x)*aBld.y;\n#endif\n#ifdef G_HEAD\ntransformed+=aEar*aBld.z;\n#endif\n#ifdef G_TUCK\n{float tk=aBld.w*step(transformed.y,0.99);transformed=mix(transformed,vec3(transformed.x*0.84,1.034+(transformed.y-0.895)*0.15,(transformed.z+0.013)*0.80-0.003),tk);}\n#endif\n#ifdef G_FLARE\n{float gq=max(0.0,0.9-transformed.y),gz=smoothstep(-0.07,0.03,transformed.z);\ntransformed.z+=aBld.z*max(0.0,1.0107-transformed.y)+gq*mix(mix(aStr.w,aStr.z,gz),mix(aStr.y,aStr.x,gz),smoothstep(-0.03,0.03,transformed.x));}\n#endif');};
  m.customProgramCacheKey=function(){return'garb'+Object.keys(def).join('');};return m;}
const GSHELL=['jer','ame','abr','chq'],GSKIRT=['skA','skL','skP'],GBAG=['bagH','bagT','bagC'];
/* the pieces of a person that take one colour, by what colours them (the clothes take theirs in paxPaint) */
const PROLE={skin:['handL','handR','handLF','handRF','armL','armR','foreL','foreR','armLF','armRF','foreLF','foreRF'],bare:['legL','legR','shinL','shinR'],
  hair:['hair','hairM','hairF','hairL','hairT','hairP','hairS','bun'],hat:['hat'],cap:['cap'],scarf:['scarf'],cane:['cane'],bag:['pack']};
function paxCol(i,role,hex){_pc.setHex(hex);PROLE[role].forEach(k=>PAXP[k].setColorAt(i,_pc));}
const GDYN=[];
function paxColDone(){Object.values(PAXP).forEach(m=>{if(m.instanceColor)m.instanceColor.needsUpdate=true;const a=m.geometry.attributes;if(a.aC2){a.aC2.needsUpdate=true;a.aC3.needsUpdate=true;}});}
const PAXP={};
Object.keys(PAXG).forEach(k=>{
  const g=PAXG[k],garb=!!GARB[k]&&!GARB_PLAIN[k],shell=GSHELL.indexOf(k)>=0,flare=shell||GSKIRT.indexOf(k)>=0,cab=k==='cab';
  const mat=garb?garbMat(cab?{G_MORPH:'',G_HEAD:''}:shell?(k==='jer'?{G_MORPH:'',G_TUCK:'',G_FLARE:''}:{G_MORPH:'',G_FLARE:''}):flare?{G_FLARE:''}:{}):new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:THREE.DoubleSide});
  const m=new THREE.InstancedMesh(g,mat,MAXP);
  if(!garb)m.material.onBeforeCompile=function(){};m.frustumCulled=false;m.castShadow=!/^(hairL|hairS|bun|hand|hood|cane|cuf|sls|bag|zap)/.test(k);
  if(garb){m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(MAXP*3),3);g.setAttribute('aC2',new THREE.InstancedBufferAttribute(new Float32Array(MAXP*3),3));g.setAttribute('aC3',new THREE.InstancedBufferAttribute(new Float32Array(MAXP*3),3));}
  if(flare||cab){(cab?['aBld']:['aBld','aStr']).forEach(n=>{const a=new THREE.InstancedBufferAttribute(new Float32Array(MAXP*4),4);a.setUsage(THREE.DynamicDrawUsage);g.setAttribute(n,a);GDYN.push(a);});}
  if(m.instanceMatrix.setUsage)m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(m);PAXP[k]=m;});
/* the three colours of a garment of one person */
function garbCol(k,i,c1,c2,c3){const m=PAXP[k],a=m.geometry.attributes;_pc.setHex(c1);m.setColorAt(i,_pc);_pc.setHex(c2===undefined?c1:c2);a.aC2.setXYZ(i,_pc.r,_pc.g,_pc.b);_pc.setHex(c3===undefined?c1:c3);a.aC3.setXYZ(i,_pc.r,_pc.g,_pc.b);}
const PCOL=[0x34506B,0xA2463A,0x4A6B4E,0xD8CBB0,0x6A5A8A,0x2E3A42,0xC88B5E,0x7E8C93,0xB98F3E,0x5C3F36,0x8FA7B8,0x9E3B5A,0xE2E0DA,0x3D5A80,0x6E2E2E,0x8C9A5B];
const LCOL=[0x2F3E5C,0x24272B,0x4C5258,0x3A4F6E,0xB8A98A,0x5A4636,0x2D3B33,0x1F2A44,0x6B6F74];
const SKIN=[0xE8BE98,0xD9A57E,0xBE8461,0x8F5B3E,0xF1CDAE,0xE0B08A];
const HAIR=[0x1E1A17,0x3A2A1E,0x5A3E28,0x8A6A43,0xC9A86A,0x9A9590,0x2A211B,0x6E4A2E];
const SHOE=[0x1C1C1C,0x3A2A1E,0x50433A,0xE6E6E2,0x2A2E34];
const BAG=[0x2C3E50,0x7A3B2E,0x3F4B3A,0x1E1E1E,0x8A6A43,0x6A3A5A];
const paxMonth=()=>monthOf(Math.floor(sim.t/86400));
const COATC=[0x2A2426,0x5C4A3A,0x3A3F4A,0x24272B,0x6B5A48,0x2E3A42],CHAQC=[0x3A4F6E,0xA2463A,0x2D5A3C,0x24272B,0x5A6E7A,0x8C1C2A,0xB98F3E],
  CAPC=[0x2E4A7A,0x3A3A3A,0x6B5A3A,0x8A2A22,0x4A5A3A],SCARFC=[0x24272B,0x3A2E3A,0x2F2A26,0x4A3A5A],
  SHIRTC=[0xE6E2D8,0xD8E0E8,0xEDE6D2,0xC9D3DC],TIEC=[0x6E2E2E,0x2F3E5C,0x3A4F3A,0x4A4A52,0x7A5A2A],MUFC=[0x8C1C2A,0xB8A98A,0x3D5A80,0x5A6E4A,0xC9C3B8,0x6A5A8A,0x9A5A2A],
  BELTC=[0x2A211B,0x1E1E1E,0x5A3E28,0x3A2A1E],GREYH=[0xBDB8B0,0x9A9590,0xD8D4CC,0x7A746E,0xC9C3B8];
/* how someone dresses, from what their look already says (so the people of an old save keep their looks): the build, what
   they wear under the coat, whether the shirt is tucked in, which skirt, what they carry */
function paxStyle(L){if(L._s)return L._s;
  const s0=(L.h*7919.13+L.w*10472.9+(L.f?0.37:0))%1,r=k=>{const s=Math.sin((s0*997+k)*12.9898+k*78.233)*43758.5453;return s-Math.floor(s);};
  const c=L.c||{},crew=c.sl!==undefined,old=!!(L.stoop||L.cane||L.bun||L.hs==='perm'||L.head==='hat'||L.head==='scarf'||GREYH.indexOf(c.hair)>=0),
    yng=!old&&!!(L.kid||L.hood||L.hs==='quiff'||L.hs==='tail'||L.pack),mono=crew?c.top===c.sl:c.top!==undefined&&c.top===c.leg,q=r(3);
  const top=crew||mono?'jumper':L.jacket?'ame':L.f?(q<0.34?'jumper':q<0.62?'shirt':q<0.8?'vneck':'tee'):(q<0.3?'jumper':q<0.62?'shirt':q<0.78?'vneck':'tee');
  const S={r:r,old:old,yng:yng,crew:crew,mono:mono,top:top,
    b:L.kid?-0.3:L.big?0.6+0.5*r(1):-0.25+0.55*r(1),legw:(L.big?1.07:0.95)+0.13*r(2),
    tie:!L.f&&!!L.jacket&&r(5)<(old?0.5:0.3),open:r(6)<0.45,
    tuck:top==='shirt'?r(4)<(L.f?0.4:old?0.9:0.6):top==='tee'&&r(4)<0.2,
    sk:L.skirt?(old?(r(7)<0.55?'L':'A'):r(7)<0.3?'P':'A'):null,dress:!!L.skirt&&!L.jacket&&r(8)<0.3,
    bagk:L.f?(r(9)<0.6?'H':'T'):L.jacket?(r(9)<0.7?'C':'T'):'T',
    beard:L.f||L.kid?0:old?(r(20)<0.24?1:r(20)<0.31?2:0):yng?(r(20)<0.08?2:0):(r(20)<0.13?1:r(20)<0.21?2:0)};   // a moustache (1) or a beard (2)
  Object.defineProperty(L,'_s',{value:S,enumerable:false,writable:true,configurable:true});return S;}
/* dress one person for today: which pieces they wear (p.st, read by posePax) and the colours of each */
function paxPaint(p){const L=p.look,i=p.i,S=paxStyle(L),c=Object.assign({},PAXB[i]?PAXB[i].c:null,L.c),m=paxMonth(),r=S.r,warm=m>=4&&m<=8;
  const outer=p.wear==='coat'?'abr':p.wear==='chaq'?'chq':null,shell=outer||(S.top==='ame'?'ame':'jer');
  const short=!outer&&warm&&!S.crew&&!S.mono&&(S.top==='tee'||(S.top==='shirt'&&r(10)<(S.old?0.45:0.75)));
  const shorts=!L.skirt&&m>=5&&m<=8&&!S.crew&&!S.mono&&!S.old&&!L.jacket&&(L.kid?r(11)<0.7:S.yng&&r(11)<0.3);
  const st=p.st={shell:shell,short:short,shorts:shorts,sk:L.skirt&&!S.crew?(shell==='abr'&&S.sk==='P'?'A':S.sk):null,skw:shell==='abr'?0.93:1,b:S.b,legw:S.legw,tuck:shell==='jer'&&S.tuck?1:0,bag:L.bag?S.bagk:null,
    thick:shell==='abr'?1.14:shell==='chq'?1.22:shell==='ame'?1.06:1,back:shell==='abr'?0.024:shell==='chq'?0.03:shell==='ame'?0.014:0,
    rz:0.03+Math.max(0,S.b)*0.07+(outer?0.05:0)+(L.skirt?0.02:0),hd:(L.kid?1.13:1)*(0.965+0.08*r(18)),hx:0.97+0.07*r(19)};   // and no two heads the same size
  const dk=(h,k)=>{_pc.setHex(h).multiplyScalar(k);return _pc.getHex();},pick=(a,k)=>a[Math.floor(r(k)*a.length)];
  const top=c.top,shirt=c.shirt!==undefined&&c.shirt!==top?c.shirt:pick(SHIRTC,15),skin=c.skin,leg=c.leg;
  let c1=top,c2=top,c3=top,sl=top,cuff=top;
  if(shell==='abr'){c1=sl=cuff=c.outer;c2=r(12)<0.45?pick(MUFC,16):S.top==='jumper'?top:shirt;c3=c2;}
  else if(shell==='chq'){c1=sl=c.outer;cuff=dk(c1,0.8);c2=c1;c3=r(12)<0.5?0x2A2C30:dk(c1,0.7);}
  else if(shell==='ame'){c2=cuff=shirt;c3=S.tie?pick(TIEC,16):c2;}
  else if(S.crew){sl=cuff=c.sl;c2=c.sl;c3=dk(top,0.85);}
  else if(S.mono){c3=dk(top,0.8);}
  else if(S.top==='shirt'){c2=S.open?skin:top;c3=dk(top,0.86);}
  else if(S.top==='vneck'){c2=L.f&&r(13)<0.5?skin:shirt;}
  else if(S.top==='tee'){c2=r(13)<0.5?dk(top,0.8):top;}
  garbCol(shell,i,c1,c2,c3);['slvL','slvR','slsL','slsR'].forEach(k=>garbCol(k,i,sl));['cufL','cufR'].forEach(k=>garbCol(k,i,sl,cuff));
  ['trsL','trsR','trcL','trcR','shoL','shoR'].forEach(k=>garbCol(k,i,leg));garbCol('pelv',i,leg,S.crew||S.mono?leg:pick(BELTC,17),0xB8A878);
  if(st.sk)garbCol('sk'+st.sk,i,S.dress&&!outer?top:leg,S.dress&&!outer?top:leg);
  garbCol('hood',i,c.outer||top);const bg=c.bag!==undefined?c.bag:0x2C3E50;GBAG.forEach(k=>garbCol(k,i,bg,dk(bg,0.7),0xB8A878));
  {const hs=hairStyle(L),hc=c.hair,lum=((hc>>16&255)*0.3+(hc>>8&255)*0.59+(hc&255)*0.11)/255,lip=L.f?(L.kid?0.25:S.old?0.35:0.3+0.3*r(21)):0.28;   // the face: eyebrows a little darker than fair hair, lips, ears, beard
    _pc.setHex(skin).lerp(_pk.setHex(L.f?0xA04048:0x9A5850),lip);const lipc=_pc.getHex();
    garbCol('cab',i,skin,dk(hc,lum>0.5?0.62:lum>0.3?0.8:1),lipc);
    PAXP.cab.geometry.attributes.aBld.setXYZW(i,L.f?1:0,clamp(S.b,-0.3,1.1),L.head==='scarf'||(L.f&&(hs==='bob'||hs==='long'||hs==='perm'))?1:0,S.beard);}
  paxCol(i,'skin',skin);paxCol(i,'bare',L.skirt?(c.tights!==undefined&&c.tights!==leg?c.tights:skin):skin);paxCol(i,'hair',c.hair);paxCol(i,'hat',0x1E2026);{const zs=c.shoe,sole=zs===0xE6E6E2?0xD0CEC6:dk(zs,0.55);garbCol('zapL',i,zs,sole);garbCol('zapR',i,zs,sole);}paxCol(i,'bag',bg);
  paxCol(i,'cap',c.cap||0x3A3A3A);paxCol(i,'scarf',c.scarf||0x24272B);paxCol(i,'cane',0x5A3E28);paxColDone();return st;}
/* what someone wears on top today: the overcoat or the padded jacket from November to February, and most still in October,
   March and April (this is Burgos) */
function wearOuter(p,L){const m=paxMonth(),k=m>=10||m<=1?1:m===9||m===2||m===3?0.75:0;p.wear=L.outer&&paxStyle(L).r(14)<k?L.outer:null;paxPaint(p);}
const PAX=[],PAXB=[];const _pd=new THREE.Object3D(),_pc=new THREE.Color(),_pk=new THREE.Color(),_pm=new THREE.Matrix4(),_pl=new THREE.Matrix4(),_pe=new THREE.Euler(),_pz=new THREE.Matrix4().makeScale(0,0,0);
/* each slot of the pool has its own anonymous look and clothes (given back to it when the railway staff leave it) */
function paxBase(i){const r=(k)=>{const s=Math.sin((i+1)*12.9898+k*78.233)*43758.5453;return s-Math.floor(s);};
  const f=r(10)<0.5,old=r(11)<0.25;
  const look={h:(f?0.92:0.98)+r(1)*0.09,w:0.94+r(2)*0.14,f:f,long:f&&!old&&r(3)<0.55,pack:r(4)<0.18,bag:r(4)>=0.18&&r(4)<0.36,
    skirt:f&&r(12)<(old?0.7:0.25),bald:!f&&r(14)<(old?0.5:0.12),bun:f&&old&&r(15)<0.4,jacket:r(16)<(old?0.7:0.3),
    big:r(18)<(old?0.3:0.15),head:!f&&old?(r(13)<0.5?'hat':r(13)<0.65?'cap':null):f&&old&&r(13)<0.3?'scarf':null,
    outer:old?'coat':r(19)<0.5?'coat':'chaq',hood:!old&&r(20)<0.35,stoop:old&&r(21)<0.25,cane:old&&r(21)<0.2,kid:!old&&r(22)<0.06};
  if(look.kid){look.h*=0.88;look.pack=true;look.bag=false;}if(look.head==='scarf')look.bun=false;
  look.hs=f?(look.long?(r(25)<0.3?'tail':'long'):look.bun?'bun':old?(r(26)<0.7?'perm':'bob'):'bob'):look.bald?'bald':(r(26)<0.25?'quiff':'short');
  const top=PCOL[i%PCOL.length],leg=LCOL[Math.floor(r(5)*LCOL.length)];
  look.c={top:top,leg:leg,skin:SKIN[Math.floor(r(6)*SKIN.length)],hair:old&&r(27)<0.7?GREYH[Math.floor(r(7)*GREYH.length)]:HAIR[Math.floor(r(7)*HAIR.length)],shoe:SHOE[Math.floor(r(8)*SHOE.length)],bag:BAG[Math.floor(r(9)*BAG.length)],
    shirt:look.jacket?SHIRTC[Math.floor(r(17)*4)]:top,tights:look.skirt?(old?0x3A3533:0xC9A58A):leg,cap:CAPC[Math.floor(r(23)*CAPC.length)],scarf:SCARFC[Math.floor(r(24)*SCARFC.length)],
    outer:look.outer==='coat'?COATC[Math.floor(r(25)*COATC.length)]:CHAQC[Math.floor(r(25)*CHAQC.length)]};
  PAXB[i]=look;PAX[i].look=look;wearOuter(PAX[i],look);}
for(let i=0;i<MAXP;i++){PAX.push({on:false,i:i});paxBase(i);Object.values(PAXP).forEach(m=>m.setMatrixAt(i,_pz));}
paxColDone();
/* pose one person. Walking follows the human gait cycle: the hip swings about 20° forward and 15° back; the knee bends a
   little as the heel takes the weight and about 60° in the swing, so the foot clears the ground; the ankle keeps the foot
   nearly flat; the pelvis drops as the knees bend and shifts over the standing leg; the shoulders turn against the hips and
   the arms swing opposite the legs with the elbows bent, more on the forward swing (the hand that carries a bag hardly
   swings, and the bag hangs plumb from it). Standing: knees and elbows slightly bent and a slow shift of weight. Turns and
   the change between walking and standing are eased. */
const _pP=new THREE.Matrix4(),_pU=new THREE.Matrix4(),_pH=new THREE.Matrix4(),_pT=new THREE.Matrix4(),_pS=new THREE.Matrix4(),_pF=new THREE.Matrix4(),_pA=new THREE.Matrix4(),_pX=new THREE.Matrix4(),_pq=new THREE.Vector3(),_pw=new THREE.Vector3();
function _pivot(m,px,py,pz,ax,ay,az){m.makeRotationFromEuler(_pe.set(ax,ay,az,'YXZ'));const e=m.elements;   // rotation about the point (px,py,pz)
  m.setPosition(px-(e[0]*px+e[4]*py+e[8]*pz),py-(e[1]*px+e[5]*py+e[9]*pz),pz-(e[2]*px+e[6]*py+e[10]*pz));return m;}
const _wide=(m,sx,sz)=>_pX.copy(m).scale(_pq.set(sx,1,sz));   // a piece made wider about its own axis
/* the hairstyle of a look (looks saved before there were styles get one from what they had) */
function hairStyle(L){if(L.hs)return L.hs;
  return L.f?(L.long?'long':L.bun?'bun':'bob'):(L.bald?'bald':'short');}
function posePax(p,moving,dt){
  const L=p.look,s=PS*L.h,st=p.st||paxPaint(p),i=p.i;
  if(p.hv===undefined)p.hv=p.hd;{let dh=p.hd-p.hv;dh=Math.atan2(Math.sin(dh),Math.cos(dh));p.hv+=dh*Math.min(1,dt*9);}
  p.wk=clamp((p.wk||0)+(moving?4:-3)*dt,0,1);
  // at work (the railway staff): bent over the rail, knees bent (calzar or clear an aguja), or reaching up to a box (a
  // signal, the crossing's lights); eased in and out like the walk
  p.tb=clamp((p.tb||0)+(!moving&&p.task==='bend'?2:-3)*dt,0,1);p.tr=clamp((p.tr||0)+(!moving&&p.task==='reach'?2:-3)*dt,0,1);
  const tb=p.tb,trc=p.tr,wm=Math.sin(p.ph*2.3);
  const k=p.wk,a=clamp((p.sp-0.75)/0.6,0.55,1)*k,ph=p.ph,idle=(1-k)*Math.sin(ph*0.25)*0.035*(1-tb);
  const leg=(f,sg)=>{const fm=((f%TAU)+TAU)%TAU,c=Math.cos(f+0.25);
    const hip=(0.05+0.33*Math.sin(f))*a+sg*idle+tb*(0.85+sg*0.12);
    const knee=0.05+tb*(1.45+sg*0.2)+(1-k)*sg*Math.max(0,-Math.sin(ph*0.25))*0.06+((c>0?0.95*Math.pow(c,1.6):0)+(fm>PI/2&&fm<PI?0.24*Math.sin(2*(fm-PI/2)):0))*a;
    const t=-hip,sh=t+knee;return{t:t,k:knee,h:hip,an:-sh*0.75,e:PJ.thigh*Math.cos(t)+PJ.shin*Math.cos(sh)+PJ.ankle};};
  const lL=leg(ph,1),lR=leg(ph+PI,-1),drop=Math.max(lL.e,lR.e)-PJ.hip[1];
  _pd.position.set(p.x,p.y+drop*s,p.z);_pd.rotation.set(0,p.hv,0);_pd.scale.set(PS*L.w,s,PS*L.w);_pd.updateMatrix();
  _pl.makeTranslation(-0.022*Math.cos(ph)*a,0,0);_pP.multiplyMatrices(_pd.matrix,_pl);   // pelvis over the standing leg
  const yaw=0.08*Math.sin(ph)*a,lean=0.035*k+0.015+(L.stoop?0.17:0)+tb*0.55+trc*0.04;   // the very old walk bent forward
  _pU.multiplyMatrices(_pP,_pivot(_pl,0,PJ.waist,0,lean,yaw,0));                          // upper body: leans and turns at the waist
  _pH.multiplyMatrices(_pU,_pivot(_pl,0,PJ.neck[1],PJ.neck[2],-lean*0.6,-yaw*0.8,0));       // the head keeps looking ahead
  const put=(k2,m)=>PAXP[k2].setMatrixAt(i,m);
  const sc=L.head==='scarf',F=L.f?'F':'',cov=L.head==='hat'||L.hat||L.head==='cap',bw=Math.max(0,st.b);
  // how far each leg carries the cloth at a depth q below the hip: at the knee and, for what hangs lower, at the calf
  const reach=(g,q)=>{const c=PJ.thigh*Math.cos(g.h),zk=PJ.thigh*Math.sin(g.h);if(q<=c)return[q*Math.tan(g.h)/q,q*Math.tan(g.h)/q];
    const zh=(zk+(q-c)*Math.tan(g.h-g.k))/q,k1=zk/c;return[clamp(Math.max(zh,k1),-1.3,1.6),clamp(Math.min(zh,k1),-1.3,1.6)];};
  const cloth=(key,q,ln,q2)=>{const A=PAXP[key].geometry.attributes,l=reach(lL,q),r2=reach(lR,q);
    if(q2){const a2=reach(lL,q2),b2=reach(lR,q2);l[0]=Math.max(l[0],a2[0]);l[1]=Math.min(l[1],a2[1]);r2[0]=Math.max(r2[0],b2[0]);r2[1]=Math.min(r2[1],b2[1]);}   // over a skirt, at least as much as the skirt
    A.aBld.setXYZW(i,L.f?1:0,st.b,ln,st.tuck);A.aStr.setXYZW(i,l[0],l[1],r2[0],r2[1]);};
  // the trunk: the garment on top, hanging plumb below the waist
  const sh=st.shell;GSHELL.forEach(k2=>put(k2,k2===sh?_pU:_pz));cloth(sh,sh==='abr'?0.4:0.1,Math.tan(lean),st.sk?(st.sk==='L'?0.6:0.42):0);
  put('hood',sh==='chq'&&L.hood?_pU:_pz);
  _pl.makeTranslation(0,1.47,0);_pl.multiply(_pS.makeScale(st.hd*st.hx,st.hd,st.hd));_pl.multiply(_pT.makeTranslation(0,-1.47,0));_pH.multiply(_pl);   // the size of the head (a child's is bigger for the body)
  put('cab',_pH);
  // his: short back and sides, or the longer styled hair; under a beret or a cap, or bald, only the crown round the back.
  // hers: a bob with a fringe, long and loose, a ponytail, a bun, or the older women's permanent
  const hs=hairStyle(L);
  put('hair',!L.f&&hs==='quiff'&&!cov?_pH:_pz);put('hairM',!L.f&&hs==='short'&&!cov?_pH:_pz);put('hairS',!L.f&&(hs==='bald'||cov)&&!sc?_pH:_pz);
  put('hairF',L.f&&hs==='bob'&&!sc?_pH:_pz);{const hl=st.back?_wide(_pH,1,1+st.back*4):_pH;put('hairL',L.f&&hs==='long'&&!sc?hl:_pz);put('hairT',L.f&&hs==='tail'&&!sc?hl:_pz);}   // long hair falls over the coat, not through it
  put('bun',L.f&&hs==='bun'&&!sc?_pH:_pz);put('hairP',L.f&&hs==='perm'&&!sc?_pH:_pz);
  put('hat',L.head==='hat'||L.hat?_pH:_pz);put('cap',L.head==='cap'?_pH:_pz);put('scarf',sc?_pH:_pz);
  if(L.pack){_pl.makeTranslation(0,0,-st.back-0.03*bw);put('pack',_pX.multiplyMatrices(_pU,_pl));}else put('pack',_pz);
  // from the waist down: trousers (or shorts over bare legs), or a skirt over bare legs or tights
  const HP=PJ.hip,sk=st.sk,hw=(L.f?1.05:1)*(1+0.14*st.b),lw=st.legw*(L.f?0.96:1);
  put('pelv',sk?_pz:_wide(_pP,hw,hw));GSKIRT.forEach(k2=>put(k2,sk&&k2==='sk'+sk?_wide(_pP,hw*st.skw,hw*st.skw):_pz));
  if(sk)cloth("sk"+sk,sk==="L"?0.6:0.42,0);
  [['L',HP[0],lL],['R',-HP[0],lR]].forEach(([e,x,g])=>{
    _pl.makeRotationX(g.t);_pl.setPosition(x,HP[1],HP[2]);_pT.multiplyMatrices(_pP,_pl);
    _pl.makeRotationX(g.k);_pl.setPosition(0,-PJ.thigh,0);_pS.multiplyMatrices(_pT,_pl);
    _pl.makeRotationX(g.an);_pl.setPosition(0,-PJ.shin,0);_pF.multiplyMatrices(_pS,_pl);
    const bare=sk||st.shorts;
    put('leg'+e,bare?_pT:_pz);put('shin'+e,bare?_pS:_pz);put('sho'+e,st.shorts?_wide(_pT,lw,lw):_pz);
    put('trs'+e,bare?_pz:_wide(_pT,lw,lw));put('trc'+e,bare?_pz:_wide(_pS,lw,lw));put('zap'+e,_pF);});
  const SH=L.f?PJ.shF:PJ.sh,aw=st.thick*(L.f?0.9:1)*(1+0.1*bw);
  const sx=SH[0]*0.94;   // the shoulders of the body are an athlete's: under clothes, a little narrower
  [['L',sx,ph,st.rz],['R',-sx,ph+PI,-st.rz]].forEach(([e,x,f,rz])=>{const sf=Math.sin(f),wo=e==='R'?wm:-wm,ca=e==='L'&&st.bag?0.3:1;
    const sw=0.32*sf*a*ca+(1-k)*0.03-tb*(0.8+0.16*wo)-trc*(1.5+0.12*wo),elb=0.10+(0.12+0.32*Math.max(0,-sf))*a*ca+tb*0.3+trc*0.45;
    _pl.makeRotationFromEuler(_pe.set(sw,0,rz,'XYZ'));_pl.setPosition(x,SH[1],SH[2]);_pA.multiplyMatrices(_pU,_pl);
    _pl.makeRotationX(-elb);_pl.setPosition(0,-PJ.arm,0);_pF.multiplyMatrices(_pA,_pl);
    const o=F?'':'F',sv=st.short;
    put('slv'+e,sv?_pz:_wide(_pA,aw,aw));put('cuf'+e,sv?_pz:_wide(_pF,aw,aw));put('sls'+e,sv?_wide(_pA,aw,aw):_pz);
    put('arm'+e+F,sv?_pA:_pz);put('fore'+e+F,sv?_pF:_pz);put('hand'+e+F,_pF);put('arm'+e+o,_pz);put('fore'+e+o,_pz);put('hand'+e+o,_pz);
    if(e==='R')put('cane',L.cane?_pF:_pz);
    else{const bk=st.bag?'bag'+st.bag:null;
      if(bk){_pq.set(0.03,-0.41,0.012).applyMatrix4(_pF);_pl.makeRotationY(p.hv);_pl.scale(_pw.set(s,s,s));_pl.setPosition(_pq);}
      GBAG.forEach(k2=>put(k2,k2===bk?_pl:_pz));}});
}
/* only the slots up to the last one in use are drawn */
function paxDirty(){let hi=-1;for(const p of PAX)if(p.on)hi=p.i;Object.values(PAXP).forEach(m=>{m.instanceMatrix.needsUpdate=true;m.count=hi+1;});GDYN.forEach(a=>{a.needsUpdate=true;});}
function walkY(x,z){
  const ramp=x<=72?PH:(x>=80?0.8:lerp(PH,0.8,(x-72)/8));
  if(x<-80&&x>-82.3&&z>=-10.3&&z<=-8.7)return PH*clamp((x+82.1)/2.1,0,1);   // the escalerilla at the Miranda end of andén 1
  if(x>=-80&&x<=80&&z>=-10.75&&z<=-1.72)return ramp;
  if(x>=-80&&x<=80&&z>=6.02&&z<=11.98)return ramp;
  if(x>80&&x<=83.6&&z>-1.9&&z<6.2)return 0.8;
  if(x>=-18&&x<=15&&z>=-20.4&&z<=-10)return PH;
  if(z>-21.7&&z<-20&&x>-8&&x<-4)return 0.9;
  return Math.max(groundH(x,z),bedH(x,z),deckH(x,z));
}
/* the track bed, which stands above the ground: on the sleepers (1,3 m either side of the centre line), the top of the
   ballast to 1,75 m, and its slope down to the ground at 2,45 m */
function bedH(x,z){if(z<-2.6||z>20.8)return 0;let h=0;
  for(const k in TRACKS){const tz=zAt(TRACKS[k].pts,x);if(tz===null)continue;const d=Math.abs(z-tz);if(d>=2.45)continue;
    h=Math.max(h,d<=1.3?0.61:d<=1.75?0.45:0.45*(2.45-d)/0.7);if(h>=0.61)break;}
  return h;}
/* andenesPaso: zonas de andén y caminos de los viajeros por la estación (en el archivo del nivel) */
const {zoneOf,pathTo,platZone,spotFor}=NIVEL.andenesPaso();
function newPax(x,z,state){
  const p=PAX.find(q=>!q.on);if(!p)return null;
  Object.assign(p,{on:true,crew:null,task:null,x:x,z:z,y:walkY(x,z),wp:[],wi:0,sp:1.1+Math.random()*0.4,state:state,train:null,ph:Math.random()*6,hd:0,hv:undefined,wk:0,door:null,pid:null,leg:null,carReg:null,_out:0});wearOuter(p,p.look);
  return p;
}
function hidePax(p){p.on=false;if(p.crew){p.crew=null;p.task=null;p.tb=0;p.tr=0;paxBase(p.i);paxColDone();}if(p.pid!=null){const P=GENTE[p.pid];if(P&&P.px===p)P.px=null;}Object.values(PAXP).forEach(m=>m.setMatrixAt(p.i,_pz));paxDirty();}
function nextSameDir(tr){let best=null;TRAINS.forEach(o=>{if(o===tr||!o.md||o.dir!==tr.dir||o.served||o.done)return;if(o.svc.dep>tr.svc.dep&&(!best||o.svc.dep<best.svc.dep))best=o;});return best;}
function sendWaiting(p,tr){p.train=tr;p.state='come';const s=spotFor(tr);pathTo(p,s.x,s.z);}
/* someone who has lost their regional waits for the next one only if it leaves within the hour and a quarter;
   with the next one hours away they go home (the vecinos walk back, the comarca people return to their car) */
const MISS_WAIT=75*60;
function nextWait(tr){const n=nextSameDir(tr);return n&&tSched(n)-Math.max(sim.t,tSched(tr))<=MISS_WAIT?n:null;}
function missedTrain(p,tr,count){if(count&&!p.lostOnce){p.lostOnce=1;stats.lost++;}const n=nextWait(tr);
  if(n){sendWaiting(p,n);return n;}p.state='leave';pathTo(p,0,0,true);p.rb=rebook(p,tr);return null;}
/* someone with a name who has gone home after losing the regional comes back for the next one in that direction,
   if there is one later that day: the same trip, a few minutes before it leaves (by car if they came by car) */
function rebook(p,tr){const P=p.pid!=null&&GENTE[p.pid];if(!P||!P.leg||P.leg.act!=='up')return null;
  let n=null;TRAINS.forEach(o=>{if(o===tr||!o.md||o.dir!==tr.dir||o.served||o.done||o.svc.day!==tr.svc.day||o.svc.dep<sim.t+30*60)return;if(!n||o.svc.dep<n.svc.dep)n=o;});
  if(!n||!n.paxPlan)return null;
  const leg=Object.assign({},P.leg,{num:n.svc.num,dir:n.dir,dep:n.svc.dep,hh:fmtHM(n.svc.arr)});
  n.paxPlan.push({t:n.svc.dep-(P.old?12:7)*60-(P.walk||0),pid:P.id,leg:leg});n.paxPlan.sort((a,b)=>a.t-b.t);P.plan.push(leg);P.retry=leg;return n;}
function retargetPax(tr){PAX.forEach(p=>{if(p.on&&p.train===tr&&(p.state==='wait'||p.state==='come')&&zoneOf(p.x,p.z)!=='X'){p.state='come';const s=spotFor(tr);pathTo(p,s.x,s.z);}});}
function stepPlans(){
  salaRemind();
  // nobody waits for a regional that has already gone (or left the board some other way)
  PAX.forEach(p=>{if(p.on&&p.train&&(p.state==='wait'||p.state==='come')&&(p.train.done||(p.train.served&&p.train.phase!=='retroceso')))missedTrain(p,p.train,!p.train.oos&&p.train.served);});
  if(TRAF.ready)TRAINS.forEach(tr=>{if(!tr.md)return;
    if(tr.paxPlan.length)tr.paxPlan.slice().forEach(e=>{const P=GENTE[e.pid];if(!P||P.kind!=='comarca'||tr.paxPlan.indexOf(e)<0)return;
      const S=roadPath(COMARCA_EDGE[P.from]||'E','ST');if(sim.t<e.t-(S.L/11+30))return;
      tr.paxPlan.splice(tr.paxPlan.indexOf(e),1);if(tr.served||tr.done)return;carToTrain(e,tr);});
    // the family sets off to fetch whoever comes back on this train without a car at the station
    if(tr.alightQ&&tr.alightQ.length&&!tr.done&&tr.svc.arr-sim.t<roadPath('E','ST').L/11+120)tr.alightQ.forEach(e=>{if(e.pk)return;const P=GENTE[e.pid];
      if(!P||P.kind!=='comarca')return;e.pk=1;const c=P.carId&&TRAF.cars.find(o=>o.id===P.carId);if(c)return;
      const k=carForReturn(P);if(k)k.until=Math.max(k.until,tr.svc.arr+45*60);});});
  TRAINS.forEach(tr=>{
    if(!tr.md||!tr.paxPlan.length)return;
    while(tr.paxPlan.length&&tr.paxPlan[0].t<=sim.t){
      const e=tr.paxPlan.shift();let target=tr;
      if(tr.served||tr.done||tr.oos){target=nextWait(tr);if(!tr.oos)stats.lost++;if(!target)continue;}
      gSpawnUp(e,target);
    }
  });
}
let crossBlocked=false;
function computeCrossing(){
  crossBlocked=false;
  for(const R of ROUTES){if(R.passed)continue;for(const sc of R.secs){if((sc.t==='v1'||sc.t==='v2')&&sc.a<83.5&&sc.b>79.5){crossBlocked=true;return;}}}
  for(const tr of TRAINS){if(!tr.spawned||tr.done||tr.sCross===null||tr.sCross===undefined)continue;
    const c=tr.sCross;
    if(tr.s>c-3&&tr.s-tr.len<c+3){crossBlocked=true;return;}
    // a train in sight: within 380 m, or within 20 s at its speed (a Talgo or an Intercity at 160 km/h is 880 m away)
    if(tr.s<c&&c-tr.s<Math.max(380,tr.v*20)&&(tr.v>0.3||tr.phase==='despachando')){crossBlocked=true;return;}}
}
function stepPax(dt){
  for(const p of PAX){
    if(!p.on)continue;
    let moving=false;
    if(p.wi<p.wp.length){
      const w=p.wp[p.wi];
      if(!(w.gate&&crossBlocked)&&!(p.crew&&w.trk&&crewHold(p,w))){
        const dx=w.x-p.x,dz=w.z-p.z,d=Math.hypot(dx,dz);
        if(d<0.22){p.wi++;if(p.wi>=p.wp.length){arrive(p);if(!p.on)continue;}}
        else{const st=Math.min(d,p.sp*dt);p.x+=dx/d*st;p.z+=dz/d*st;p.hd=Math.atan2(dx,dz);moving=true;}
      }
    }else if(p.state==='wait'){
      const tr=p.train;
      if(tr&&tr.phase==='puertas'&&tr.boardOpen&&zoneOf(p.x,p.z)===platZone(tr)&&tr.doorPts&&tr.doorPts.length){
        let best=null,bd=1e9;tr.doorPts.forEach(d=>{const k=Math.hypot(d.x-p.x,d.z-p.z);if(k<bd){bd=k;best=d;}});
        p.state='board';p.door=best;p.wp=[{x:best.x,z:best.z+best.side*1.2},{x:best.x,z:best.z}];p.wi=0;
      }else if(tr&&tr.stopTrack&&zoneOf(p.x,p.z)!==platZone(tr)&&zoneOf(p.x,p.z)!=='X'){sendWaiting(p,tr);}
    }
    p.y=walkY(p.x,p.z);
    p.ph+=moving?dt*TAU*p.sp/(1.3*PS*p.look.h):dt;
    posePax(p,moving,dt);
  }
  paxDirty();
}
function arrive(p){
  if(p.crew)return;
  if(p.state==='leave'){if(!p._out){stats.paxOut++;p._out=1;}
    if(p.carReg&&regBoard(p))return;
    if(p.pid!=null&&GENTE[p.pid].kind==='comarca'&&carBoard(p))return;
    if(p.pid!=null)gHome(p);hidePax(p);return;}
  if(p.state==='board'){const tr=p.train;
    if(tr&&tr.phase==='puertas'){tr.boarded++;stats.paxIn++;if(p.pid!=null)gHome(p);hidePax(p);return;}
    p.state='wait';const s=spotFor(tr);pathTo(p,s.x,s.z);return;}
  p.state='wait';
}
function spawnLeaver(d,tr){
  const p=gSpawnDown(d,tr);if(!p)return;
  pathTo(p,0,0,true);p.wp.unshift({x:d.x+rr2(-1.5,1.5),z:d.z+d.side*rr2(1.4,2.6)});
}


/* =====================================================================
   22b. La gente: vecinos de Santa Olalla, sus visitas y viajeros de la comarca
   Censo real: 40 empadronados en 1999 (16 hombres y 24 mujeres, INE). De las 33 casas del pueblo, 23 están
   habitadas todo el año, 7 son segunda residencia de familias del pueblo emigradas (Bilbao, Vitoria, Burgos,
   Madrid) y 3 están cerradas. El resto de viajeros llegan en coche de los pueblos de alrededor (Quintanavides,
   Galbarros, Santa María del Invierno, Monasterio de Rodilla, Caborredondo, Castil de Peones y Prádanos de Bureba).
   Cada persona tiene casa, edad, oficio y costumbres, y se genera siempre igual: los habituales se repiten.
   Regionales que paran (horario del nivel): hacia Burgos 08:19, 09:12, 18:08, 18:50; hacia Briviesca y Miranda
   11:59, 14:09, 17:55, 21:43.
   ===================================================================== */
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const GR=mulberry(1999),gpick=(a,R)=>a[Math.floor((R||GR)()*a.length)],grr=(a,b,R)=>a+(b-a)*(R||GR)();
const DIAS=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'],MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const gen=a=>a<32?'yng':a<62?'mid':'old';
const nombre=(sx,age,R)=>gpick(NOM[sx][gen(age)],R);
const routeLen=r=>{let s=0;for(let i=1;i<r.length;i++)s+=Math.hypot(r[i].x-r[i-1].x,r[i].z-r[i-1].z);return s;};
function mkLook(P,R){const f=P.sx==='M',old=P.age>=65,yng=P.age<32,r=()=>R();
  const top=P.luto&&r()<0.75?0x24272B:old?gpick([0x3A3F4A,0x5C4A3A,0x6B6A64,0x2E3A42,0x7A5A48,0x4A4F5C,0x8A7F6A,0x34506B,0x5A3A3E],R)
    :yng?gpick([0xA2463A,0x3D5A80,0x4A6B4E,0xD8CBB0,0x9E3B5A,0xE2E0DA,0x6A5A8A,0xB98F3E,0x2E3A42,0x8FA7B8,0xC88B5E],R):gpick(PCOL,R);
  const hair=old?gpick([0xBDB8B0,0x9A9590,0xD8D4CC,0x7A746E,0xC9C3B8],R):P.age>50&&r()<0.5?gpick([0x9A9590,0x7A746E],R):gpick([0x1E1A17,0x3A2A1E,0x5A3E28,0x8A6A43,0xC9A86A,0x2A211B,0x6E4A2E],R);
  const leg=P.luto?0x1F2023:old?gpick([0x2F3E5C,0x24272B,0x4C5258,0x5A4636,0x3A3A3A],R):gpick(LCOL,R);
  const stu=P.rut&&P.rut.k!=='trabajo',wk=P.rut&&P.rut.k==='trabajo';
  const pack=stu?r()<0.85:yng?r()<0.35:r()<0.04,bag=!pack&&(f&&old?r()<0.6:wk?r()<0.4:r()<0.12);
  const L={h:(f?grr(0.92,1.0,R):grr(0.98,1.08,R))-(P.age>=75?0.03:0),w:grr(0.94,1.08,R)+(P.age>=55?0.04:0),long:f?r()<(yng?0.7:old?0.12:0.45):r()<0.03,pack:pack,bag:bag,
    c:{top:top,leg:leg,skin:gpick(SKIN,R),hair:hair,shoe:gpick(SHOE,R),bag:gpick(BAG,R)}};
  const q=k=>{const s=Math.sin((P.id+1)*91.7+k*37.13)*43758.5453;return s-Math.floor(s);};
  const farm=/gricult|ganad/i.test(titleJob(P));
  L.f=f;L.skirt=f&&q(1)<(P.luto?0.95:old?0.75:P.age>=40?0.35:0.15);L.bald=!f&&P.age>=45&&q(3)<(old?0.5:0.3);
  L.bun=f&&old&&!L.long&&q(4)<0.4;L.jacket=!farm&&q(5)<(old||wk?0.7:0.25);L.big=q(7)<(P.age>=40?0.3:0.08);
  L.head=farm?(q(2)<0.7?'cap':null):!f&&old?(q(2)<0.5?'hat':q(2)<0.7?'cap':null):f&&old&&!L.long&&q(2)<0.35?'scarf':null;
  if(L.head==='scarf')L.bun=false;
  // the hair: she, long and loose or in a ponytail (more the young), a bob, a bun, the permanent of the older ones;
  // he, short back and sides, or the longer styled hair of the young, or going bald
  L.hs=f?(L.long?(q(17)<(yng?0.4:0.25)?'tail':'long'):L.bun?'bun':old?(q(18)<0.7?'perm':'bob'):P.age>=45?(q(18)<0.35?'perm':'bob'):'bob')
    :L.bald?'bald':yng?(q(18)<0.45?'quiff':'short'):(q(18)<0.12?'quiff':'short');
  L.outer=old?'coat':yng?(q(8)<0.7?'chaq':'coat'):(q(8)<0.5?'coat':'chaq');L.hood=yng&&q(9)<0.6;
  L.stoop=P.age>=78&&q(10)<0.6;L.cane=P.age>=75&&q(11)<0.45;L.kid=P.age<16;if(L.kid)L.h*=0.88;
  if(farm){L.c.top=0x2E4A7A;L.c.leg=0x2E4A7A;}                       // the blue work overall
  L.c.outer=P.luto?0x1F2023:L.outer==='coat'?COATC[Math.floor(q(12)*COATC.length)]:CHAQC[Math.floor(q(12)*CHAQC.length)];
  L.c.cap=CAPC[Math.floor(q(13)*CAPC.length)];L.c.scarf=P.luto?0x1F2023:SCARFC[Math.floor(q(13)*SCARFC.length)];
  L.c.shirt=L.jacket?[0xE6E2D8,0xD8E0E8,0xEDE6D2,0xC9D3DC][Math.floor(q(6)*4)]:L.c.top;L.c.tights=L.skirt?(old||P.luto?0x3A3533:0xC9A58A):L.c.leg;
  return L;}
function persona(o,R){R=R||GR;const P=Object.assign({id:GENTE.length,a1:gpick(APE,R),a2:gpick(APE,R),home:null,base:null,rut:null,job:null,rel:'',seen:0,last:null,st:'casa',px:null,leg:null,plan:[],pend:[],away:0,free:0},o);
  if(!P.n)P.n=nombre(P.sx,P.age,R);
  P.full=P.n+' '+P.a1+' '+P.a2;P.old=P.age>=65;
  P.sp=P.age>=75?grr(0.82,1.0,R):P.age>=62?grr(0.95,1.15,R):P.age<30?grr(1.3,1.55,R):grr(1.15,1.42,R);
  P.look=mkLook(P,R);GENTE.push(P);return P;}
const GENTE=[];
const titleJob=(P)=>P.job||(P.age>=65?(P.sx==='M'?'Jubilada':'Jubilado'):P.age<18?'Estudiante':P.kind==='comarca'&&P.age>=40&&P.sx==='H'?'Agricultor':P.sx==='M'&&P.age>=40?'Ama de casa':'—');
/* nombres: nombres y apellidos de la zona y pueblos de la comarca (en el archivo del nivel) */
const {NOM,APE,COMARCA}=NIVEL.nombres();
/* gente: calles, trabajos y censo de vecinos (en el archivo del nivel) */
const {houseRoute,CARPT}=NIVEL.gente();
function pSub(P){const a='';
  if(P.kind==='vecino')return a+HOUSES[P.home].addr;
  if(P.kind==='segunda')return a+'de '+P.city+' · casa en '+HOUSES[P.home].addr;
  if(P.kind==='visita')return a+'de '+P.city+' · '+P.rel.charAt(0).toLowerCase()+P.rel.slice(1);
  return a+'de '+P.from;}
/* what you have seen of each person is remembered between sessions (only in this browser) */
const GSEEN_K=NIVEL.clave+'-gente-1';let gSave=0;
function gSeen(P){P.seen++;P.last=sim.t;P.lastTxt=null;gSave=1;}
function gPersist(){return;gSave=0;try{const o={};GENTE.forEach(P=>{if(P.seen)o[P.id]=[P.seen,P.last!==null?fechaHM(P.last):P.lastTxt,P.full];});localStorage.setItem(GSEEN_K,JSON.stringify(o));}catch(e){}}
const fechaDia=d=>{const x=dayDate(d);return DIAS[x.getDay()]+' '+x.getDate()+' de '+MESES[x.getMonth()];};
function fechaHM(t){return'el '+fechaDia(Math.floor(t/86400))+' a las '+fmtHM(t);}
function cuando(t){const d=Math.floor(t/86400),n=Math.floor(sim.t/86400);return(d===n?'hoy':'el '+fechaDia(d))+' a las '+fmtHM(t);}

/* ---- carrera: la hoja de servicio de cada jornada, el expediente y los ascensos ----
   Escalafón del Grupo de Personal de Movimiento de Renfe (Normativa laboral, BOE 26-8-1993, art. 54). Se entra como
   Factor de Circulación de Entrada; el ascenso a Factor de Segunda pedía dos años de permanencia efectiva: aquí, cuatro
   jornadas en la categoría (un año, una por estación) con buena nota y sin faltas graves en las dos últimas. Anotaciones
   del día: felicitaciones (F), faltas leves (L) y faltas graves (G, las que afectan a la seguridad de la circulación).
   Mientras no haya otra estación a la que ir, el primer ascenso es el único: después se espera destino. */
const CATS=['Factor de Circulación de Entrada','Factor de Circulación de Segunda','Factor de Circulación de Primera','Jefe de Estación','Inspector Principal de Movimiento','Jefe de Servicio de Movimiento'];
const ASC={n:4,media:7,limpias:2,max:1};
const CAR={d:0,cat:0,desde:0,hojas:[],an:[],inc:[],espera:false};
function carRestore(S){const d=Math.floor(sim.t/86400);Object.assign(CAR,{d:d,cat:0,desde:0,hojas:[],an:[],inc:[],espera:false});   // older saves: the career starts today
  if(S){Object.assign(CAR,JSON.parse(JSON.stringify(S)));CAR.d=d;}}
function anota(k,x){if(GAME.demo)return;CAR.an.push({t:sim.t,k:k,x:x});uiDirty=true;lastTurno='';
  if(k==='G')setTimeout(()=>toast('Falta grave anotada en tu hoja de servicio'),3000);}
const nota1=n=>n.toFixed(1).replace('.',',');
function hojaNota(st,an){const m=Math.round(st.caused/60),c=k=>an.filter(a=>a.k===k).length,L=c('L'),G=c('G'),F=c('F'),des=[];
  if(m)des.push(['Retraso imputable, '+m+'′',-Math.min(4,0.1*m)]);
  if(st.lost)des.push(['Viajeros en tierra, '+st.lost,-Math.min(1,0.1*st.lost)]);
  if(L)des.push([L+(L>1?' faltas leves':' falta leve'),-0.5*L]);
  if(G)des.push([G+(G>1?' faltas graves':' falta grave'),-2*G]);
  if(F)des.push([F+(F>1?' felicitaciones':' felicitación'),0.5*F]);
  return{n:Math.round(clamp(10+des.reduce((a,q)=>a+q[1],0),0,10)*10)/10,des:des};}
const media=H=>H.length?H.reduce((a,h)=>a+h.nota,0)/H.length:null;
/* closes jornada d: felicitations of the day, the mark, and whether it brings the promotion */
function hojaCierra(d){const st=Object.assign({},stats),end=(d+1)*86400-60,an=CAR.an.slice();
  if(st.trains>=10&&st.onTime===st.trains)an.push({t:end,k:'F',x:'Los '+st.trains+' trenes de la jornada, sin retraso imputable a la estación'});
  if(CAR.inc.length>=2&&CAR.inc.every(i=>i.ok))an.push({t:end,k:'F',x:'Las '+CAR.inc.length+' incidencias de la jornada, resueltas sin fallos'});
  const N=hojaNota(st,an),h={d:d,date:dayDate(d).getTime(),cat:CAR.cat,st:st,an:an,inc:CAR.inc.slice(),nota:N.n,des:N.des,res:null};
  const mine=CAR.hojas.slice(CAR.desde).concat([h]),w=mine.slice(-ASC.n),med=media(w);
  if(CAR.espera)h.res={k:'espera'};
  else if(mine.length<ASC.n)h.res={k:'sigue',n:mine.length,m:media(mine)};
  else{const gr=mine.slice(-ASC.limpias).some(x=>x.an.some(a=>a.k==='G'));
    if(med>=ASC.media&&!gr){CAR.cat++;CAR.desde=CAR.hojas.length+1;h.res={k:'asc',cat:CAR.cat,m:med};if(CAR.cat>=ASC.max)CAR.espera=true;}
    else h.res={k:'no',m:med,gr:gr};}
  CAR.hojas.push(h);return h;}
/* the season of the new jornada: vegetation, the month's climate (weather drawn again at once), clothes and sun follow by themselves */
function estacionCambia(d){const m=monthOf(d);try{VEG_SEASON(m,dayDate(d).getFullYear());}catch(e){}
  WX.m=m;WX.P=climProb(m);WX.next=0;wxNote();wxShown='';wxRows();}
function jornadaFin(dn){
  while(CAR.d<dn){hojaCierra(CAR.d);CAR.d++;Object.keys(stats).forEach(k=>{stats[k]=0;});CAR.an=[];CAR.inc=[];}
  estacionCambia(dn);lastTurno='';uiDirty=true;
  if(GAME.on&&!GAME.over&&!GAME.demo)hojaShow(CAR.hojas[CAR.hojas.length-1],true);}
const fechaAnio=d=>fechaDia(d)+' de '+dayDate(d).getFullYear();
function hojaRes(h){const r=h.res,m=r.m!=null?nota1(r.m):'—';
  if(r.k==='asc')return'<b>Ascenso.</b> Pasas a <b>'+CATS[r.cat]+'</b>, con una media de '+m+' en tus cuatro últimas jornadas.'+(r.cat>=ASC.max?' Seguirás en '+esc(NIVEL.nombreLargo)+' hasta que haya destino en una estación mayor.':'');
  if(r.k==='sigue')return'Jornada '+r.n+' de '+ASC.n+' en la categoría · media '+m+'. El ascenso se decide al cerrar la cuarta: hace falta una media de '+nota1(ASC.media)+' o más y ninguna falta grave en las dos últimas.';
  if(r.k==='no')return'<b>Sin ascenso por ahora:</b> '+(r.m<ASC.media?'media de '+m+' en las cuatro últimas jornadas (hace falta '+nota1(ASC.media)+')':'')+(r.m<ASC.media&&r.gr?' y ':'')+(r.gr?'falta grave en las dos últimas jornadas':'')+'. Se vuelve a valorar al cerrar la próxima.';
  return CATS[h.cat]+', pendiente de destino en una estación mayor.';}
function hojaHTML(h,fin){
  const st=h.st,p=st.trains?Math.round(100*st.onTime/st.trains)+' %':'—',dt=new Date(h.date),nOrd=st.ordOk+st.ordFail,nInc=h.inc.length;
  const r=(a,b)=>'<div class="hj-r"><span>'+a+'</span><b>'+b+'</b></div>';
  const grp=(k,tit)=>{const L=h.an.filter(a=>a.k===k);return L.length?'<div class="hj-s">'+tit+'</div>'+L.map(a=>'<div class="hj-a '+k+'"><span>'+fmtHM(a.t)+'</span><i>'+esc(a.x)+'</i></div>').join(''):'';};
  const inc=nInc?'<div class="hj-s">Incidencias</div>'+h.inc.map(i=>'<div class="hj-a '+(i.ok?'':'L')+'"><span>'+fmtHM(i.t)+'</span><i>'+(i.ok?'✓ ':'✗ ')+esc(i.x)+'</i></div>').join(''):'';
  const nx=h.d+1;
  return'<div class="mhd"><b>Hoja de servicio</b><span class="gt">Jornada '+(CAR.hojas.indexOf(h)+1)+' · '+ESTACION(dt.getMonth())+'</span></div>'+
    '<div class="hoja"><div class="hj-h"><span>Estación de '+esc(NIVEL.nombreLargo)+'</span><span>'+esc(fechaAnio(h.d))+'</span></div>'+
    '<div class="hj-ag">'+esc(CATS[h.cat])+' · turno de 00:00 a 24:00</div>'+
    '<div class="hj-g">'+r('Trenes',st.trains)+r('Puntuales',p)+r('Retraso imputable',Math.round(st.caused/60)+'′')+r('Viajeros',st.paxIn+st.paxOut)+
      r('En tierra',st.lost)+r('Órdenes CTC',nOrd?st.ordOk+'/'+nOrd:'—')+r('Incidencias',nInc?h.inc.filter(i=>i.ok).length+'/'+nInc:'—')+r('Telefonemas',st.telOk+(st.telErr?' · '+st.telErr+' ✗':''))+'</div>'+
    grp('F','Felicitaciones')+grp('G','Faltas graves')+grp('L','Faltas leves')+inc+
    (h.an.length||nInc?'':'<div class="hj-s">Anotaciones</div><div class="hj-a"><i>Ninguna. Jornada sin novedad.</i></div>')+
    '<div class="hj-n"><b>'+nota1(h.nota)+'</b><div><small>Nota de la jornada</small>'+(h.des.length?h.des.map(q=>'<small>'+esc(q[0])+' · '+(q[1]>0?'+':'−')+nota1(Math.abs(q[1]))+'</small>').join(''):'<small>Sin descuentos</small>')+'</div></div></div>'+
    '<p class="hj-res">'+hojaRes(h)+'</p>'+
    (fin?'<p class="mnote" style="margin:6px 2px 0">Siguiente jornada: <b style="color:var(--ink)">'+ESTACION(monthOf(nx))+', '+esc(fechaAnio(nx))+'</b>, desde las 00:00.</p>'+
      '<div class="gd-a"><button class="btn" data-d="save">Guardar partida</button><button class="btn primary" data-d="x">Empezar la jornada</button></div>'
     :'<div class="gd-a"><button class="btn primary" data-d="x">Cerrar</button></div>');}
function hojaShow(h,fin){dlgOpen(hojaHTML(h,fin));}
/* in the Turno page: category, progress and what has been noted so far today, and the closed jornadas */
function hojaTurno(){const d=Math.floor(sim.t/86400),mine=CAR.hojas.slice(CAR.desde),m=media(mine.slice(-ASC.n));
  const prog=CAR.espera?'Ascendido · pendiente de destino':'Ascenso: '+Math.min(mine.length,ASC.n)+' de '+ASC.n+' jornadas en la categoría'+(m!=null?' · media '+nota1(m):'');
  const tag={F:['FELIC.','ok'],L:['LEVE','warn'],G:['GRAVE','stop']};
  return'<div class="sect">Hoja de servicio<span class="r">Jornada '+(CAR.hojas.length+1)+' · '+ESTACION(monthOf(d))+'</span></div>'+
    '<div class="hj-t"><b>'+esc(CATS[CAR.cat])+'</b><small>'+esc(fechaAnio(d))+'</small><small>'+prog+'</small></div><div class="log">'+
    (CAR.an.length?CAR.an.slice().reverse().map(a=>'<div class="lrow hj-l"><span class="tbadge" style="background:var(--'+tag[a.k][1]+')'+(a.k==='L'?';color:#1A1A1A':'')+'">'+tag[a.k][0]+'</span><span class="m">'+esc(a.x)+'</span><span class="n" style="color:var(--ink-3)">'+fmtHM(a.t)+'</span></div>').join('')
      :'<p class="tempty">Sin anotaciones en esta jornada. Las faltas y felicitaciones irán apareciendo aquí.</p>')+'</div>'+
    (CAR.hojas.length?'<div class="sect">Jornadas anteriores</div><div class="log">'+CAR.hojas.map((h,i)=>{const dt=new Date(h.date),c=k=>h.an.filter(a=>a.k===k).length,L=c('L'),G=c('G');
      return'<div class="lrow pz" data-hoja="'+i+'"><span class="m"><b>Jornada '+(i+1)+'</b> · '+ESTACION(dt.getMonth())+' '+dt.getFullYear()+'<br><small>'+(G?G+' grave'+(G>1?'s':'')+' · ':'')+(L?L+' leve'+(L>1?'s':''):'sin faltas leves')+(h.res&&h.res.k==='asc'?' · ascenso':'')+'</small></span><span class="n" style="color:var(--'+(h.nota>=ASC.media?'ok':h.nota>=5?'warn':'stop')+')">'+nota1(h.nota)+'</span></div>';}).reverse().join('')+'</div>':'');}

/* ---- motivos de los viajes de vez en cuando ---- */
/* viajes: motivos de viaje, sentidos y trenes de cada ciudad (en el archivo del nivel) */
const {MOTIVO,desdeSO,llegaDe,vaA,segLlega,segVuelve,TGT}=NIVEL.viajes();
function gentePlanDay(d){
  const R=mulberry(DATE0.getFullYear()*1000+DATE0.getMonth()*40+DATE0.getDate()*7+d*7919),dw=dowOf(d),mo=monthOf(d),lab=dw>=1&&dw<=5,verano=mo===6||mo===7;
  const MD={};TRAINS.forEach(t=>{if(t.md&&t.svc.day===d){MD[t.svc.num]=t;t.paxPlan=[];t.alightQ=[];}});
  const live=n=>MD[n]&&MD[n].svc.dep>sim.t+60;
  const lead=P=>{if(R()<(P.rut?0.04:0.1))return grr(-0.6,0.5,R)*60;return(P.rut?grr(2,7,R):P.old?grr(8,18,R):grr(3,12,R))*60;};
  const up=(P,n,o)=>{if(!live(n))return false;const t=MD[n];const leg=Object.assign({act:'up',num:n,dir:t.dir,dep:t.svc.dep,hh:fmtHM(t.svc.arr)},o);
    t.paxPlan.push({t:t.svc.dep-lead(P)-P.walk,pid:P.id,leg:leg});P.plan.push(leg);return true;};
  const down=(P,n,o)=>{if(!MD[n])return false;const t=MD[n];const leg=Object.assign({act:'down',num:n,dir:t.dir,dep:t.svc.dep,hh:fmtHM(t.svc.arr)},o);
    t.alightQ.push({pid:P.id,leg:leg});P.plan.push(leg);return true;};
  const later=(nums,after,R)=>nums.filter(n=>MD[n]&&MD[n].svc.dep>=after);
  const hm=n=>MD[n]?fmtHM(MD[n].svc.arr):'';
  GENTE.forEach(P=>{P.plan=P.plan.filter(l=>l.dep>=d*86400-86400);
    P.pend=P.pend.filter(l=>{if(l.day!==d||l.upLeg)return true;down(P,l.num,l.leg);return false;});});
  GENTE.forEach(P=>{
    const r=P.rut;
    if(r&&(r.k==='trabajo'||r.k==='estudios')){if(!lab||(r.k==='estudios'&&(verano||mo===8&&dayDate(d).getDate()<25))||(mo===7&&R()<0.6)||R()<0.04)return;
      const ida=r.k==='trabajo'?'Va a trabajar':'Va a clase',vu=r.k==='trabajo'?'Vuelve de trabajar en '+r.dest:'Vuelve de clase';
      if(up(P,r.up,{dest:r.dest,why:ida+' ('+P.job.replace(/^Trabaja en |^Estudia en /,'')+')',back:'Vuelve en el '+r.down+' de las '+hm(r.down),hab:1}))down(P,r.down,{dest:r.dest,why:vu,hab:1});return;}
    if(r&&r.k==='semanal'){if(verano)return;if(dw===1)up(P,r.up,{dest:r.dest,why:'Se va a '+NIVEL.piso+' a pasar la semana en el piso de estudiantes',back:'Vuelve el viernes en el tren de las '+(TT_DAY.find(e=>e[1]===r.down)||[])[3],hab:1});
      if(dw===5)down(P,r.down,{dest:r.dest,why:'Vuelve a casa a pasar el fin de semana',hab:1});return;}
    if(P.kind==='visita'&&(dw===6||dw===0)&&!(P.vday>=d-5)&&R()<0.22){const n1=later(llegaDe(P.city),0)[0];if(!n1)return;
      const h=HOUSES[P.base],quien=P.parents.map(i=>GENTE[i].n).join(' y ');
      const back=later(vaA(P.city),MD[n1].svc.dep+4*3600,R);const n2=back.length?back[Math.floor(R()*back.length)]:null;
      down(P,n1,{dest:P.city,why:'Viene a ver a '+(P.parents.length>1?'sus padres, ':'su '+(GENTE[P.parents[0]].sx==='M'?'madre, ':'padre, '))+quien+' ('+h.addr+')',vis:1});
      if(n2)up(P,n2,{dest:P.city,why:'Vuelve a su casa de '+P.city+' después de ver a '+quien,back:''});
      P.vday=d;return;}
  });
  // segunda residencia: algunos fines de semana (viernes a domingo) y temporadas en verano; la familia viaja junta
  const fams={};GENTE.forEach(P=>{if(P.kind==='segunda')(fams[P.fam]=fams[P.fam]||[]).push(P);});
  Object.keys(fams).forEach(f=>{const F=fams[f],P0=F[0],h=HOUSES[P0.home];if(F.some(P=>P.away>d*86400))return;
    let stay=0;if(dw===5&&R()<0.28)stay=2;else if(verano&&!P0.here&&R()<0.1)stay=Math.round(grr(7,20,R));if(!stay)return;
    const n1=later(segLlega(P0.city),0);if(!n1.length)return;const a=n1[Math.floor(R()*n1.length)];
    const back=segVuelve(P0.city),nb=back[Math.floor(R()*back.length)],dd=d+stay;
    F.forEach(P=>{down(P,a,{dest:P.city,why:stay===2?'Llega de '+P.city+' a pasar el fin de semana en su casa ('+h.addr+')':'Llega de '+P.city+' a pasar una temporada en el pueblo',fam:1});
      P.pend.push({day:dd,num:nb,leg:null,upLeg:1});P.away=(dd+1)*86400;P.here=1;});});
  GENTE.forEach(P=>{P.pend.filter(l=>l.upLeg&&l.day===d).forEach(l=>{if(up(P,l.num,{dest:P.city,why:'Vuelve a '+P.city+' después de unos días en el pueblo',back:''}))P.here=0;});
    P.pend=P.pend.filter(l=>!(l.upLeg&&l.day===d));});
  // de vez en cuando: hasta completar lo que suele subir en cada MD (5 a 12 viajeros)
  const pool=GENTE.filter(P=>(P.kind==='comarca'||P.kind==='vecino')&&!P.rut&&P.age>=16);
  Object.keys(MD).map(Number).sort((a,b)=>MD[a].svc.dep-MD[b].svc.dep).forEach(n=>{
    const t=MD[n];if(!live(n))return;const T=TGT[n]||[4,8],target=T[0]+Math.floor(R()*(T[1]-T[0]+1)),used=new Map();let have=t.paxPlan.length,guard=0;
    while(have<target&&guard++<60){
      const P=pool[Math.floor(R()*pool.length)];if(P.kind==='vecino'&&R()<0.5)continue;   // the village is small: its people travel, but not every day
      if(P.free>t.svc.dep||P.plan.some(l=>l.dep>=t.svc.dep-3*3600&&l.dep<=t.svc.dep+6*3600))continue;
      const ms=MOTIVO.filter(m=>m.dir===t.dir&&m.ups.indexOf(n)>=0&&P.age>=m.age[0]&&P.age<=m.age[1]);if(!ms.length)continue;
      const wf=x=>x.w/(1+2*(used.get(x)||0));let m=ms[0],tw=ms.reduce((s,x)=>s+wf(x),0)*R();for(const x of ms){tw-=wf(x);if(tw<=0){m=x;break;}}used.set(m,(used.get(m)||0)+1);
      let n2=null,dd=d;
      if(m.multi){dd=d+Math.round(grr(m.multi[0],m.multi[1],R));n2=m.downs[Math.floor(R()*m.downs.length)];}
      else{const c=later(m.downs,t.svc.dep+2.5*3600,R);if(c.length)n2=c[Math.floor(R()*c.length)];else{dd=d+1;n2=m.downs[0];}}
      const backTxt=dd===d?'Vuelve en el tren de las '+hm(n2):dd===d+1?'Vuelve mañana':'Vuelve el '+DIAS[dowOf(dd)];
      if(!up(P,n,{dest:m.dest,why:m.why,back:backTxt}))break;
      if(dd===d)down(P,n2,{dest:m.dest,why:m.back});else P.pend.push({day:dd,num:n2,leg:{dest:m.dest,why:m.back}});
      P.free=(dd+2)*86400;have++;}
  });
  Object.values(MD).forEach(t=>{t.paxPlan.sort((a,b)=>a.t-b.t);t.alightN=t.alightQ.length;});
}
/* at the start some people are away: weekly students, families with a second home, a few on a trip */
(function(){const dw=dowOf(0);GENTE.forEach(P=>{
  if(P.kind==='visita'||P.kind==='segunda'){P.st='fuera';P.loc=P.city;}
  if(P.rut&&P.rut.k==='semanal'&&dw>=2&&dw<=5){P.st='fuera';P.loc=NIVEL.piso;}
  if(!P.rut&&P.kind!=='visita'&&P.kind!=='segunda'&&P.age>=50&&GR()<0.05){const m=gpick(MOTIVO.filter(x=>x.multi));P.st='fuera';P.loc=m.dest;P.pend.push({day:Math.floor(GR()*3),num:m.downs[Math.floor(GR()*m.downs.length)],leg:{dest:m.dest,why:m.back}});}});})();

/* ---- en la maqueta ---- */
function dress(p,P){p.look=P.look;p.sp=P.sp;p.pid=P.id;P.px=p;wearOuter(p,P.look);}
/* someone leaves home (or a car) for the station */
function gSpawnUp(e,tr,atPlatform,at){const P=GENTE[e.pid];let p;
  if(atPlatform){const s=spotFor(null);p=newPax(s.x,s.z,'wait');}
  else if(P.base!=null){const D=HOUSES[P.base].door;p=newPax(D.x,D.z,'come');}
  else{const c=at||CARPT();p=newPax(c.x,c.z,'come');}
  if(!p)return null;dress(p,P);p.leg=e.leg;P.leg=e.leg;p.train=tr;P.st='va';gSeen(P);
  if(!atPlatform){const s=spotFor(tr);if(P.base!=null)pathFromHome(p,P.base,s.x,s.z);else pathTo(p,s.x,s.z);}
  return p;}
function pathFromHome(p,h,tx,tz){const r=houseRoute(h),L=r[r.length-1],sx=p.x,sz=p.z;p.x=L.x;p.z=L.z;pathTo(p,tx,tz);p.x=sx;p.z=sz;
  let w=p.wp;if(HOUSES[h].st==='camino')w=w.filter((q,i)=>!(i<3&&q.z<=L.z+1));p.wp=r.slice(1).concat(w);p.wi=0;}
/* on the way out of the station: home, the house they are visiting, or the car that picks them up */
function homeward(p,w){const P=GENTE[p.pid];const k=w.findIndex(q=>q.x===-3&&q.z===-36);
  const head=k>=0?w.slice(0,k+1):(p.z>-37?w.concat([{x:-3,z:-36}]):w);
  if(P.base==null){const m=carMeet(P);return head.concat([{x:m.x,z:m.z}]);}
  const r=houseRoute(P.base).slice().reverse(),L=r[0];
  return head.concat([{x:-4,z:-48},{x:-6,z:-62}].filter(q=>q.z>L.z+1),r);}
function gSpawnDown(d,tr){const e=tr.alightQ&&tr.alightQ.shift();
  const p=newPax(d.x,d.z,'leave');if(!p)return null;
  if(e){const P=GENTE[e.pid];dress(p,P);p.leg=e.leg;P.leg=e.leg;P.st='llega';gSeen(P);}
  return p;}
function gHome(p){const P=GENTE[p.pid];if(!P)return;P.px=null;
  if(p.state==='board'||p.state==='tren'){P.st='tren';P.tr=p.train;P.loc=(P.leg&&P.leg.dest)||'';return;}
  if(P.leg&&P.leg.act==='up'){P.st='casa';return;}   // missed the train and went home
  P.st=P.kind==='visita'?'visita':'casa';P.loc='';}
function gStatus(P){const p=P.px&&P.px.on?P.px:null;
  if(p){if(p.state==='waitcar')return'Espera el coche que viene a recogerle';
    if(p.state==='leave')return P.leg&&P.leg.act==='up'?'Se vuelve a casa: ha perdido el tren'+(P.retry&&P.retry.dep>sim.t?' · volverá para el de las '+P.retry.hh:''):P.kind==='visita'?'Va a casa de su familia':P.base!=null?'Va a su casa':P.carId&&(TRAF.cars.find(o=>o.id===P.carId)||{}).role==='own'?'Va a su coche, en el aparcamiento':'Va al coche: le recogen';
    if(p.state==='come')return p.train?'Camino del andén · '+p.train.label+' de las '+fmtHM(p.train.svc.arr):'Camino del andén';
    return p.train?'En el andén · espera el '+p.train.label:'En el andén';}
  if(P.st==='coche'){const c=P.carId&&TRAF.cars.find(o=>o.id===P.carId);return c&&c.riders.some(r=>r.pid===P.id&&r.up)?'En coche, camino de la estación':'En coche, vuelve a '+P.from;}
  if(P.st==='tren'&&P.tr)return P.tr.done?'En '+(P.loc||P.tr.svc.to):'A bordo del '+P.tr.label;
  if(P.st==='fuera')return'En '+(P.loc||'otro sitio');
  if(P.st==='visita')return'De visita en el pueblo';
  if(P.kind==='segunda')return P.here?'En el pueblo, en su casa':'En '+P.city;
  return P.kind==='comarca'?'En '+P.from:'En casa';}
function gHabit(P){const r=P.rut;
  if(r){const hu=TT_DAY.find(e=>e[1]===r.up),hd=TT_DAY.find(e=>e[1]===r.down);
    if(r.k==='semanal')return'Sale los lunes en el tren de las '+hu[3]+' y vuelve los viernes en el de las '+hd[3];
    return'Laborables: sale en el tren de las '+hu[3]+' a '+r.dest+' y vuelve en el de las '+hd[3];}
  if(P.kind==='visita')return'Viene a ver a su familia algunos fines de semana';
  if(P.kind==='segunda')return'La familia viene algunos fines de semana y pasa temporadas en verano';
  return P.old?'Coge el tren de vez en cuando: médico, compras, la familia':'Viaja de vez en cuando';}
function gToday(P){const d=Math.floor(sim.t/86400),L=P.plan.filter(l=>Math.floor(l.dep/86400)===d).sort((a,b)=>a.dep-b.dep);
  if(!L.length)return'Hoy no tiene pensado coger el tren';
  return L.map(l=>(l.act==='up'?'Sube al ':'Baja del ')+'regional '+l.num+' de las '+l.hh+(l.act==='up'?' → '+l.dest:'')).join(' · ');}
function personRows(P){const rows=[['Nombre',P.full]];
  if(P.kind==='vecino')rows.push(['Vive en',HOUSES[P.home].addr+(', '+NIVEL.nombre)]);
  else if(P.kind==='segunda')rows.push(['Vive en',P.city+' · casa en '+HOUSES[P.home].addr+' (segunda residencia)']);
  else if(P.kind==='visita')rows.push(['Vive en',P.city],['Familia',P.rel+' · '+HOUSES[P.base].addr]);
  else{const v=carOf(P),VN={punto:'un Fiat Punto',p205:'un Peugeot 205',mb100:'una furgoneta Mercedes MB 100',alpina:'un Alpina B7 coupé',sec:'un Mercedes 560 SEC'};
    rows.push(['Vive en',P.from+(v?' · viene en su coche, '+VN[v.k]+', y lo deja en el aparcamiento':' · le traen y le recogen en coche')]);}
  if(P.rel&&P.kind!=='visita')rows.push(['Familia',P.rel]);
  rows.push(['Ocupación',titleJob(P)]);
  if(P.leg&&(P.st==='va'||P.st==='llega'||P.st==='tren')){rows.push(['Ahora',P.leg.why+(P.leg.act==='up'&&P.leg.dest&&P.leg.why.indexOf(P.leg.dest)<0?' · va a '+P.leg.dest:'')]);if(P.leg.back)rows.push(['Vuelta',P.leg.back]);}
  rows.push(['Hoy',gToday(P)],['De costumbre',gHabit(P)],
    ['La has visto',P.seen?(P.seen===1?'1 vez':P.seen+' veces')+(P.last!==null?' · la última, '+cuando(P.last):P.lastTxt?' · la última, '+P.lastTxt:''):'Nunca hasta hoy']);
  return rows;}
/* the traveller's profile: who they are, what they are doing now, their day and their habits */
function personHTML(P){
  const hex=n=>'#'+n.toString(16).padStart(6,'0'),c=P.look.c.top,lum=((c>>16&255)*0.3+(c>>8&255)*0.59+(c&255)*0.11)/255;
  const ini=(P.n.split(' ')[0][0]+P.a1.replace(/^del? /,'')[0]).toUpperCase();
  const tags=[P.kind==='vecino'?(P.sx==='M'?'Vecina':'Vecino')+(' de '+NIVEL.nombre):P.kind==='comarca'?'De '+P.from:P.kind==='segunda'?'Veranea en el pueblo':'De visita · vive en '+P.city];
  if(P.rut)tags.push(P.rut.k==='trabajo'?'Va a trabajar en tren':'Estudiante');
  const st=gStatus(P),moving=P.px&&P.px.on,trav=P.leg&&(P.st==='va'||P.st==='llega'||P.st==='tren');
  let h='<div class="pf"><div class="pf-id"><span class="pf-av" style="background:'+hex(c)+';color:'+(lum>0.55?'#14181C':'#F4F2EC')+'">'+esc(ini)+'</span>'+
    '<div class="pf-nm"><b>'+esc(P.full)+'</b><span>'+P.age+' años · '+esc(titleJob(P))+'</span><div class="pf-tags">'+tags.map(t=>'<i>'+esc(t)+'</i>').join('')+'</div></div></div>';
  h+='<div class="pf-now'+(moving?' on':'')+'"><small>Ahora</small><b>'+esc(st)+'</b>';
  if(trav){const L=P.leg;h+='<p>'+esc(L.why)+'</p><div class="pf-trip"><span class="pf-md">Regional '+L.num+'</span><span>'+(L.act==='up'?'sale '+L.hh+' → '+esc(L.dest):'llega '+L.hh+' desde '+esc(L.dest))+'</span></div>';
    if(L.back)h+='<div class="pf-back">'+esc(L.back)+'</div>';}
  h+='</div>';
  const d=Math.floor(sim.t/86400),Ls=P.plan.filter(l=>Math.floor(l.dep/86400)===d).sort((a,b)=>a.dep-b.dep);
  h+='<div class="pf-sec">Hoy</div>';
  if(Ls.length){const nx=Ls.find(l=>l.dep>sim.t);
    h+='<ol class="pf-tl">'+Ls.map(l=>'<li class="'+(l.dep<=sim.t?'done':l===nx?'next':'')+'"><time>'+l.hh+'</time><div><b>'+(l.act==='up'?'Sube al '+l.num+' → '+esc(l.dest):'Baja del '+l.num)+'</b><span>'+esc(l.why)+'</span></div></li>').join('')+'</ol>';}
  else h+='<p class="pf-none">Hoy no tiene pensado coger el tren.</p>';
  const casa=P.kind==='vecino'?[HOUSES[P.home].addr,(NIVEL.nombre)]:P.kind==='segunda'?[P.city,'Casa en '+HOUSES[P.home].addr]:P.kind==='visita'?[P.city,'Su familia: '+HOUSES[P.base].addr]:[P.from,'Viene en coche a la estación'];
  h+='<div class="pf-sec">Quién es</div><div class="pf-grid"><div><small>Vive en</small><b>'+esc(casa[0])+'</b><span>'+esc(casa[1])+'</span></div>'+
    '<div><small>Familia</small><b>'+esc(P.rel||'—')+'</b></div></div>';
  h+='<div class="pf-sec">Costumbres</div><p class="pf-habit">'+esc(gHabit(P))+'</p>';
  const lt=P.last!==null?cuando(P.last):P.lastTxt;
  h+='<div class="pf-seen"><b>'+P.seen+'</b><span>'+(P.seen===1?'vez visto en la estación':P.seen?'veces visto en la estación':'Aún no ha pasado por la estación')+(lt&&P.seen?'<br>La última, '+esc(lt):'')+'</span></div></div>';
  return h;}
function houseRows(i){const H=HOUSES[i],rows=[];
  if(H.use==='vecino'){const V=GENTE.filter(P=>P.home===i&&P.kind==='vecino');
    rows.push(['Viven',V.map(P=>P.n+' ('+P.age+')').join(', ')]);V.forEach(P=>rows.push([P.n,gStatus(P)]));
    const vis=GENTE.filter(P=>P.kind==='visita'&&P.base===i);if(vis.length)rows.push(['Les visitan',vis.map(P=>P.n+' ('+P.city+')').join(', ')]);}
  else if(H.use==='segunda'){const F=GENTE.filter(P=>P.home===i);
    rows.push(['Uso','Segunda residencia de la familia '+H.famName+' ('+H.city+')'],['Vienen','Algunos fines de semana y en verano'],['Ahora',F[0].here?'Abierta · '+F.map(P=>P.n).join(', '):'Cerrada']);}
  else rows.push(['Uso',H.why]);
  rows.push(['Plantas',String(H.floors)],[(NIVEL.nombre),NIVEL.censo+' · '+HOUSES.length+' casas']);
  return rows;}
HOUSES.forEach(H=>{const E=ENT['casa:'+H.i];if(E){E.name=H.addr;E.sub=H.use==='vecino'?'Vivienda':H.use==='segunda'?'Segunda residencia':'Casa cerrada';}});
/* house lights at night. A house lights up at dusk if someone is at home and goes dark when they go to bed:
   the old people first (23:00-1:30), the workers around midnight, the young and the weekenders later (up to 2:45).
   Between 2:30 and 4:30 only one or two houses stay lit (someone who can't sleep). From 4:45 the farmers and some
   old people get up, then the ones who catch the 08:14-08:19 regionals; after sunrise no one needs the light. */
const HL={night:null,res:[]};
function hlPlan(night){HL.night=night;
  const rh=(i,k)=>Math.abs(Math.sin(i*12.9898+k*78.233+night*37.719)*43758.5453)%1,rr=(i,k,a,b)=>a+(b-a)*rh(i,k);
  const occ=[];
  HOUSES.forEach((H,i)=>{const V=GENTE.filter(P=>P.home===i&&(P.kind==='vecino'||P.kind==='segunda'));HL.res[i]=V;H.lt=null;if(!V.length||!H.winM)return;
    const old=V.every(P=>P.age>=64),farm=V.some(P=>P.job==='Agricultor'),work=V.some(P=>P.rut&&P.rut.k!=='semanal'),young=V.some(P=>P.age<25);
    let bed,wake;   // hours, counted from noon (12 = midnight)
    if(V[0].kind==='segunda'){bed=rr(i,1,13,14.75);wake=rr(i,2,20.5,22);}
    else if(old){bed=rh(i,3)<0.3?rr(i,1,12.75,13.5):rr(i,1,11,12.75);wake=rh(i,4)<0.35?rr(i,2,16.75,18):rr(i,2,18,19.5);}
    else{bed=young?rr(i,1,12.5,14.5):rr(i,1,11.5,13);wake=farm?rr(i,2,16.75,17.5):work?rr(i,2,18.5,19.1):rr(i,2,18.5,19.5);}
    H.lt={bed:bed,wake:wake,th:rr(i,5,0.3,0.8)};if(V[0].kind==='vecino')occ.push(i);});
  // one or two who can't sleep keep a light on until the first risers
  const n=rh(0,6)<0.5?1:2;for(let k=0;k<n&&occ.length;k++){const j=Math.floor(rh(k,7)*occ.length),i=occ.splice(j,1)[0];HOUSES[i].lt.bed=HOUSES[i].lt.wake;}}
function houseLights(hl,N,ap){if(typeof GENTE_READY==='undefined'||!GENTE_READY)return;
  const night=Math.floor((sim.t-43200)/86400);if(HL.night!==night)hlPlan(night);
  const tt=((hl-12)%24+24)%24;
  HOUSES.forEach((H,i)=>{if(!H.winM)return;const L=H.lt;
    const on=!!L&&N>L.th&&(tt<L.bed||tt>=L.wake)&&HL.res[i].some(P=>P.st==='casa');
    H.lit=ap(H.lit,on?1:0,3);H.winM.emissiveIntensity=0.85*H.lit;});}
var GENTE_READY=true;gentePlanDay(LINE.day);
/* =====================================================================
   22c. Tráfico: los coches de la comarca y los que pasan por la carretera
   Red: la carretera de Monasterio de Rodilla (borde este) es la Calle Real y sigue hacia el paso a nivel; antes de él
   sale la carretera de Quintanavides (borde oeste) y, pasado el paso a nivel, la de Santa María del Invierno (borde
   sur); por el norte, el camino de Galbarros baja por la Calle de la Iglesia. Del cruce de la Calle Real sale el camino
   de la estación. Se circula por la derecha; en los cruces tiene preferencia la Calle Real y la carretera del paso a
   nivel, y quien gira a la izquierda cede al que viene de frente. Ante el paso a nivel se para con las barreras
   bajadas o un tren cerca, y se cede el paso a la gente que cruza.
   ===================================================================== */
const TRAF={cars:[],seq:0,next:0,paths:{},pend:[]};
const VLEN={punto:3.76,mb100:4.68,alpina:4.62,p205:3.70,sec:4.91};
/* road pieces (centre lines) with lane offset o (to the right of the way of travel) and speed limit v (m/s) per stretch */
/* carreteras: red de carreteras, cruces y salidas de la comarca (en el archivo del nivel) */
const {RP,JN,COMARCA_EDGE}=NIVEL.carreteras();
function pieceChain(from,to){   // from/to: an edge letter or 'ST' (the station mouth)
  const toJ0=e=>e==='E'?[['E',1]]:e==='N'?[['N',1]]:e==='W'?[['W',1],['P',1]]:[['S',1],['P',1]];
  const rev=a=>a.slice().reverse().map(([k,s])=>[k,-s]);
  if(from==='ST')return rev([['C',1]]).concat(rev(toJ0(to)));
  if(to==='ST')return toJ0(from).concat([['C',1]]);
  if((from==='W'&&to==='S')||(from==='S'&&to==='W'))return from==='W'?[['W',1],['S',-1]]:[['S',1],['W',-1]];
  return toJ0(from).concat(rev(toJ0(to)));
}
/* path sampling: fillet the corners, resample every metre, lane offset to the right, speed limit from the curve */
function filletPts(P,r){const out=[P[0]];
  for(let i=1;i<P.length-1;i++){const A=P[i-1],B=P[i],C=P[i+1];const ax=A.x-B.x,az=A.z-B.z,cx=C.x-B.x,cz=C.z-B.z,la=Math.hypot(ax,az),lc=Math.hypot(cx,cz);
    if(la<1e-6||lc<1e-6){out.push(B);continue;}const ux=ax/la,uz=az/la,wx=cx/lc,wz=cz/lc,cosA=clamp(ux*wx+uz*wz,-1,1),ang=Math.acos(cosA);
    if(ang>PI-0.05){out.push(B);continue;}const R=B.r!==undefined?B.r:r,t=Math.min(R/Math.tan(ang/2),la*0.48,lc*0.48);
    const a={x:B.x+ux*t,z:B.z+uz*t},c={x:B.x+wx*t,z:B.z+wz*t};
    for(let k=0;k<=8;k++){const s=k/8,q=1-s,ot=k>4;out.push(Object.assign({},B,{x:q*q*a.x+2*q*s*B.x+s*s*c.x,z:q*q*a.z+2*q*s*B.z+s*s*c.z,
      o:ot&&B.o2!==undefined?B.o2:B.o,v:ot&&B.v2!==undefined?B.v2:B.v,pc:ot&&B.pc2?B.pc2:B.pc}));}}
  out.push(P[P.length-1]);return out;}
function samplePath(raw,opt){opt=opt||{};
  const F=filletPts(raw,opt.r||7),S=[];let acc=0;
  for(let i=1;i<F.length;i++){const a=F[i-1],b=F[i],L=Math.hypot(b.x-a.x,b.z-a.z);if(L<1e-6)continue;const n=Math.max(1,Math.ceil(L));
    for(let k=(S.length?1:0);k<=n;k++){const t=k/n;S.push({cx:a.x+(b.x-a.x)*t,cz:a.z+(b.z-a.z)*t,s:acc+L*t,o:b.o!==undefined?b.o:0,v:b.v!==undefined?b.v:8,pc:b.pc||'',hx:(b.x-a.x)/L,hz:(b.z-a.z)/L});}acc+=L;}
  // smooth the heading over the samples, then the lane offset, then the limit from the curvature
  for(let i=0;i<S.length;i++){const a=S[Math.max(0,i-1)],b=S[Math.min(S.length-1,i+1)],L=Math.hypot(b.cx-a.cx,b.cz-a.cz)||1;S[i].hx=(b.cx-a.cx)/L;S[i].hz=(b.cz-a.cz)/L;}
  for(let i=0;i<S.length;i++){const q=S[i];q.x=q.cx-q.hz*q.o;q.z=q.cz+q.hx*q.o;q.h=Math.atan2(q.hx,q.hz);}
  for(let i=0;i<S.length;i++){const a=S[Math.max(0,i-3)],b=S[Math.min(S.length-1,i+3)];let dh=b.h-a.h;dh=Math.atan2(Math.sin(dh),Math.cos(dh));const ds=Math.max(b.s-a.s,1e-3),k=Math.abs(dh)/ds;
    if(k>1e-4)S[i].v=Math.min(S[i].v,Math.sqrt(2.2/k));}
  S.L=S.length?S[S.length-1].s:0;return S;}
/* a route along road pieces, with the gates where the car may have to stop: level crossing and junctions */
function roadRaw(chain){const P=[];   // each point: the stretch that ends there (o,v,pc) and the one that starts there (o2,v2,pc2)
  const piece=([k,sg])=>{const R=RP[k];return{k:k,pts:sg>0?R.pts:R.pts.slice().reverse(),segs:sg>0?R.seg:R.seg.slice().reverse()};};
  const C=chain.map(piece);
  C.forEach((pc,ci)=>{pc.pts.forEach((p,i)=>{if(ci>0&&i===0)return;
    const inS=i>0?pc.segs[i-1]:pc.segs[0],last=i===pc.pts.length-1,nx=last&&C[ci+1],outS=last?(nx?nx.segs[0]:inS):pc.segs[i];
    P.push({x:p[0],z:p[1],o:inS.o,v:inS.v,pc:pc.k,o2:outS.o,v2:outS.v,pc2:last&&nx?nx.k:pc.k});});});
  return P;}
function routeGates(S,chain){const G=[];
  // level crossing: stop lines 8 m and 12 m either side of the tracks
  for(let i=1;i<S.length;i++){const a=S[i-1],b=S[i];if(Math.abs(b.cx-PN.x)>6)continue;
    if(a.cz<-8&&b.cz>=-8&&b.hz>0)G.push({s:b.s-2.4,k:'pn'});if(a.cz>12.2&&b.cz<=12.2&&b.hz<0)G.push({s:b.s-2.4,k:'pn'});}
  // junctions: who enters which way, and whether it must give way
  Object.keys(JN).forEach(jk=>{const J=JN[jk];let iin=-1,iout=-1;
    for(let i=0;i<S.length;i++){const d=Math.hypot(S[i].cx-J.x,S[i].cz-J.z);if(d<J.r&&iin<0)iin=i;if(iin>=0&&d>=J.r&&iout<0&&i>iin){iout=i;break;}}
    if(iin<1||iout<0)return;
    const pin=S[Math.max(0,iin-3)].pc,pout=S[Math.min(S.length-1,iout+3)].pc,pi=J.prio.indexOf(pin)>=0,po=J.prio.indexOf(pout)>=0;
    const a=S[Math.max(0,iin-2)],b=S[Math.min(S.length-1,iout+2)],cr=a.hx*b.hz-a.hz*b.hx;
    let k=null;if(!pi)k='stop';else if(!po&&cr<-0.3)k='left';
    if(k)G.push({s:S[iin].s-2.4,k:k,j:jk});});
  G.sort((a,b)=>a.s-b.s);return G;}
function roadPath(from,to){const key='r:'+from+'>'+to;if(TRAF.paths[key])return TRAF.paths[key];
  const ch=pieceChain(from,to),S=samplePath(roadRaw(ch),{r:9});S.gates=routeGates(S,ch);S.key=key;TRAF.paths[key]=S;return S;}
/* inside the station square: in from the mouth to a bay, back out of a bay and away, and the drop-off loop past the door */
/* plazaTrafico: entrada y parada de la plaza de la estación (en el archivo del nivel) */
const {SQP}=NIVEL.plazaTrafico();
function bayPath(i,out){const B=PARKING.bays[i],key=(out?'po:':'pi:')+i;if(TRAF.paths[key])return TRAF.paths[key];
  const zA=-30.4,zE=B.d>0?B.z-2.5:B.z+2.5;let S;
  if(!out){S=samplePath([{x:SQP.ent.x,z:SQP.ent.z,v:4},{x:-4.2,z:-33,v:4},{x:-0.5,z:-30.4,v:3.5,r:3.5},{x:B.x-4.6,z:zA,v:3},{x:B.x,z:zE,v:1.6,r:4},{x:B.x,z:B.z,v:1}],{r:4});}
  else{S=samplePath([{x:B.x,z:B.z,v:1.2},{x:B.x,z:zE,v:1.2},{x:B.x+3.4,z:-33.1,v:1.2,r:3.5}],{r:3.5});S.rev=true;}
  S.key=key;S.gates=[];TRAF.paths[key]=S;return S;}
function exitPath(fromBay){const key='px:'+(fromBay!=null?fromBay:'d');if(TRAF.paths[key])return TRAF.paths[key];
  let S;
  if(fromBay!=null){const B=PARKING.bays[fromBay];S=samplePath([{x:B.x+3.4,z:-33.1,v:2},{x:2,z:-33.1,v:4},{x:-1.5,z:-35.5,v:4,r:3.5},{x:SQP.ext.x,z:SQP.ext.z,v:5}],{r:3.5});}
  else S=samplePath([{x:SQP.stop.x,z:SQP.stop.z,v:3},{x:-1.5,z:-28.4,v:4},{x:-1.5,z:-33,v:4,r:3.5},{x:SQP.ext.x,z:SQP.ext.z,v:5}],{r:3.5});
  S.key=key;S.gates=[];TRAF.paths[key]=S;return S;}
function dropPath(){const key='pd';if(TRAF.paths[key])return TRAF.paths[key];
  const S=samplePath([{x:SQP.ent.x,z:SQP.ent.z,v:4},{x:-4.2,z:-37.6,v:4},{x:-19,z:-37.6,v:4,r:4},{x:-19,z:-28.4,v:3.5,r:4},{x:SQP.stop.x,z:SQP.stop.z,v:1.5}],{r:4});
  S.key=key;S.gates=[];TRAF.paths[key]=S;return S;}
/* ---- the vehicles ---- */
function makeVeh(kind,hex){if(!VEH[kind])kind='p205';const g=vehicle(kind,hex);   // (a car of a model no longer in the game, from an old saved game, comes back as a 205)
  // lights: two headlamps, two tail lamps and the beam on the road, lit at night while the engine runs
  const L=VLEN[kind]||4,lt=new THREE.Group();
  [-0.55,0.55].forEach(x=>{const w=new THREE.Sprite(TRAF.lw);w.position.set(x,0.62,L/2+0.05);w.scale.set(0.7,0.7,1);lt.add(w);
    const r=new THREE.Sprite(TRAF.lr);r.position.set(x,0.75,-L/2-0.05);r.scale.set(0.45,0.45,1);lt.add(r);});
  /* the beam: a strip laid on the road ahead, rows across it every couple of metres, bent along the car's own path and
     lying on the ground under it (carBeam). Canvas top row (v=1) at the nose; each row: its left and right edge */
  const Bm=NIGHT.BEAM,NB=12,bg=new THREE.BufferGeometry(),uv=new Float32Array((NB+1)*4),idx=[];
  for(let i=0;i<=NB;i++){uv.set([0,1-i/NB,1,1-i/NB],i*4);if(i<NB){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2);}}
  bg.setAttribute('position',new THREE.BufferAttribute(new Float32Array((NB+1)*6),3));bg.setAttribute('uv',new THREE.BufferAttribute(uv,2));bg.setIndex(idx);
  const b=new THREE.Mesh(bg,NIGHT.beam);b.frustumCulled=false;b.renderOrder=2;b.userData.hw=Bm.W*0.55/2;b.userData.len=Bm.L*0.42;b.userData.L=L;lt.add(b);
  g.add(lt);g.userData.lights=lt;g.userData.beam=b;return g;}
function disposeVeh(g){scene.remove(g);if(g.userData.own)g.traverse(o=>{if(o.isMesh&&o.geometry)o.geometry.dispose();});if(g.userData.paint)g.userData.paint.dispose();
  g.userData.lights.traverse(o=>{if(o.isMesh&&o.geometry)o.geometry.dispose();});}
const CAR_KINDS=[['punto',0.36],['p205',0.37],['mb100',0.22],['alpina',0.03],['sec',0.02]];
const CAR_COL={punto:[0xB3261E,0xEDEDEA,0x22355E,0x2F7A7E,0x3F6B4A,0xA9ADB0,0x1E2022,0xE0B21E,0x6E2A4E],mb100:[0xEDEDEA,0xEDEDEA,0xEDEDEA,0xD9CBA3,0x2F4E7A,0xA8261E,0x3F6B4A,0x9EA3A6],
  alpina:[0xA80000,0x1E2F5A,0xA9ADB0,0x1E2022,0x2E4A3A,0xEDEDEA],
  p205:[0xEDEDEA,0xC21F1A,0x1E2F5A,0x1E2022,0xA9ADB0,0x2D5A3C,0x6E7F8F,0x8C1C2A,0xE7DCC0],   // the 205's colours of the 90s
  sec:[0x302630,0xB4B6B8,0x9EA1A3,0x151617,0x1C2230,0x4A1C22,0x24304A,0xC9B99A]};             // the C126's: the model's own aubergine, the silvers, black, blue-black, almandine, nautical blue, champagne
function pickVeh(R){let r=R(),k='punto';for(const [kk,w] of CAR_KINDS){r-=w;if(r<=0){k=kk;break;}}const C=CAR_COL[k];return{k:k,hex:C[Math.floor(R()*C.length)]};}
/* each person of the comarca has their own car (or is brought by family); fixed per person, from their id */
function carOf(P){if(P.car!==undefined)return P.car;const R=mulberry(7700+P.id*131);
  const drives=P.age>=20&&P.age<=78&&R()<(P.age>70?0.45:0.8);P.car=drives?pickVeh(R):null;P.famCar=pickVeh(R);return P.car;}
function newCar(o){const c=Object.assign({id:++TRAF.seq,kind:'punto',hex:0xEDEDEA,legs:[],li:0,s:0,v:0,phase:'drive',riders:[],bay:null,wait:0,gp:0,role:'thru',owner:null,until:0},o);
  c.g=makeVeh(c.kind,c.hex);scene.add(c.g);TRAF.cars.push(c);carPlace(c);return c;}
function carPath(c){const L=c.legs[c.li];if(!L)return null;
  if(L.p==='road')return roadPath(L.a,L.b);if(L.p==='in')return bayPath(L.bay,false);if(L.p==='out')return bayPath(L.bay,true);
  if(L.p==='exit')return exitPath(L.bay);if(L.p==='crew')return crewPath(L.k);if(L.p==='drop')return dropPath();return null;}
function sIdx(S,s){let lo=0,hi=S.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(S[m].s<=s)lo=m;else hi=m;}return lo;}
function carAt(S,s){if(!S.length)return null;const i=Math.min(sIdx(S,s),Math.max(0,S.length-2)),a=S[i],b=S[Math.min(i+1,S.length-1)],t=clamp((s-a.s)/Math.max(b.s-a.s,1e-6),0,1);
  return{x:lerp(a.x,b.x,t),z:lerp(a.z,b.z,t),h:a.h+Math.atan2(Math.sin(b.h-a.h),Math.cos(b.h-a.h))*t,pc:a.pc};}
function carPlace(c){const S=carPath(c);if(!S){return;}const q=carAt(S,c.s);if(!q)return;
  c.x=q.x;c.z=q.z;c.h=S.rev?q.h+PI:q.h;c.pc=q.pc;
  // on the wheels: the height under the front and rear axles, and the car pitched between them (up the ramps of the crossing)
  const L=(VLEN[c.kind]||4)*0.32,fx=Math.sin(c.h)*L,fz=Math.cos(c.h)*L,yf=walkCarY(q.x+fx,q.z+fz),yb=walkCarY(q.x-fx,q.z-fz);
  c.g.rotation.order='YXZ';c.g.position.set(q.x,(yf+yb)/2,q.z);c.g.rotation.y=c.h;c.g.rotation.x=-Math.atan2(yf-yb,2*L);
  c.g.userData.lights.visible=c.phase!=='parked'&&c.phase!=='off';}
function walkCarY(x,z){return Math.max(groundH(x,z),deckH(x,z));}
/* ---- rules of the road ---- */
function carsNear(J,r){return TRAF.cars.filter(o=>o.x!==undefined&&Math.hypot(o.x-J.x,o.z-J.z)<r);}
function approaching(o,J,maxD){if(o.phase==='parked'||o.phase==='off')return false;const dx=J.x-o.x,dz=J.z-o.z,fx=Math.sin(o.h),fz=Math.cos(o.h),ahead=dx*fx+dz*fz,lat=Math.abs(-dx*fz+dz*fx);
  return ahead>-1&&ahead<maxD&&lat<9&&(o.v>0.5||ahead<14);}
function gateBlocked(c,g){
  if(g.k==='pn')return PN.down||PN.near||PN.anim<0.95;
  const J=JN[g.j];
  if(carsNear(J,J.r+0.5).some(o=>o!==c))return true;
  return TRAF.cars.some(o=>{if(o===c||J.prio.indexOf(o.pc)<0||!approaching(o,J,32))return false;
    if(g.k==='left'){const dot=Math.sin(o.h)*Math.sin(c.h)+Math.cos(o.h)*Math.cos(c.h);return dot<-0.5;}   // oncoming only
    return true;});}
function carStep(c,dt){
  if(c.phase==='parked'||c.phase==='off'){return;}
  if(c.phase==='stop'||c.phase==='waitbay'){c.v=0;c.wait+=dt;carBoardCheck(c);return;}
  const S=carPath(c);if(!S){carEnd(c);return;}
  const rev=!!S.rev,fx=Math.sin(c.h),fz=Math.cos(c.h),dirx=rev?-fx:fx,dirz=rev?-fz:fz;
  const a=1.8,b=3.2,lim=[];let vcap=rev?1.3:99;
  // the road ahead: the speed it allows within braking distance, and the end of the leg
  for(let d=0;d<=60;d+=2){if(c.s+d>=S.L)break;lim.push([d,S[sIdx(S,c.s+d)].v]);}
  const leg=c.legs[c.li],endStop=leg.end!=='go';
  if(endStop)lim.push([S.L-c.s,0]);
  // backing out of a bay: only when nobody is moving in the aisle close by
  if(leg.p==='out'&&c.s<0.5){const B=PARKING.bays[leg.bay];
    const inBay=o=>o.bay!=null&&(o.phase==='parked'||o.phase==='waitbay'),waitOut=o=>o.legs[o.li]&&o.legs[o.li].p==='out'&&o.s<0.5&&o.phase==='drive';
    if(TRAF.cars.some(o=>o!==c&&o.x!==undefined&&!inBay(o)&&(!waitOut(o)||o.id<c.id)&&Math.hypot(o.x-B.x,o.z+31.75)<11)){c.v=0;return;}}
  // gates
  (S.gates||[]).forEach(g=>{if(g.s<c.s-0.5)return;const d=g.s-c.s;if(d>45)return;if(gateBlocked(c,g)){lim.push([Math.max(0,d-0.3),0]);c.gp=Math.max(c.gp,0);}});
  // what stands on the stretch I am about to drive over (my own lane, curves and turns included): cars and people
  const half=(VLEN[c.kind]||4)/2,look=[];for(let d=0;d<=40;d+=1){if(c.s+d>S.L)break;const q=S[sIdx(S,c.s+d)];look.push([d,q]);}
  if(!endStop&&c.legs[c.li+1]){const N2=(()=>{const li=c.li;c.li++;const p=carPath(c);c.li=li;return p;})(),off=S.L-c.s;
    if(N2)for(let d=0;off+d<=40;d+=1){if(d>N2.L)break;const q=N2[sIdx(N2,d)];look.push([off+d,q]);lim.push([off+d,q.v]);}}
  TRAF.cars.forEach(o=>{if(o===c||o.x===undefined)return;if(o.bay!=null&&(o.phase==='parked'||o.phase==='waitbay'))return;   // cars in their bays are off the lanes
    const oh=(VLEN[o.kind]||4)/2;
    if(o.id>c.id&&Math.hypot(o.x-c.x,o.z-c.z)<half+oh)return;   // overlapping (two arriving at once): the later one gives way
    for(const [d,q] of look){if(Math.abs(o.x-q.x)>2.6||Math.abs(o.z-q.z)>2.6)continue;
      // the other car's body is a segment along its heading: is the path point within reach of it?
      const fx=Math.sin(o.h),fz=Math.cos(o.h),rx=q.x-o.x,rz=q.z-o.z,along=clamp(rx*fx+rz*fz,-oh,oh),ex=rx-fx*along,ez=rz-fz*along;
      if(ex*ex+ez*ez<1.25*1.25){const sp=Math.max(0,o.v*(fx*q.hx+fz*q.hz)*(o.legs[o.li]&&TRAF.paths&&carPath(o)&&carPath(o).rev?-1:1));
        lim.push([Math.max(0,d-half-2.0),sp]);break;}}});
  PAX.forEach(p=>{if(!p.on)return;if(Math.abs(p.x-c.x)>45||Math.abs(p.z-c.z)>45)return;
    for(const [d,q] of look){if(d>half+12)break;const dx=p.x-q.x,dz=p.z-q.z;if(dx*dx+dz*dz<1.15*1.15){
      const walk=p.wi<p.wp.length,al=Math.abs(Math.sin(p.hd)*q.hx+Math.cos(p.hd)*q.hz);
      lim.push([Math.max(0,d-half-1.4),walk&&al>0.75?1.8:0]);break;}}});
  let vt=vcap;lim.forEach(([d,v])=>{vt=Math.min(vt,Math.sqrt(v*v+2*b*Math.max(0,d)));});
  if(S.length)vt=Math.min(vt,S[sIdx(S,c.s)].v);
  c.v=c.v<vt?Math.min(vt,c.v+a*dt):Math.max(vt,c.v-b*2.2*dt);
  c.s+=c.v*dt;
  if(c.s>=S.L-0.05){c.s=S.L;carPlace(c);carEnd(c);return;}
  carPlace(c);}
/* end of a leg: drive on, park, stop at the door, or leave the board */
function carEnd(c){const L=c.legs[c.li];
  if(L&&L.p==='out'&&PARKING.bays[L.bay].occ===c.id)PARKING.bays[L.bay].occ=0;   // out of the bay: free for the next one
  if(L&&L.end==='go'&&c.li<c.legs.length-1){c.li++;c.s=0;carPlace(c);return;}
  if(L&&L.end==='park'){c.phase='parked';c.v=0;carPlace(c);carUnload(c);if(c.role==='pick'){c.phase='waitbay';}return;}
  if(L&&L.end==='stop'){c.phase='stop';c.v=0;c.wait=0;carUnload(c);return;}
  carRemove(c);}
function carRemove(c){const i=TRAF.cars.indexOf(c);if(i>=0)TRAF.cars.splice(i,1);if(c.bay!=null&&PARKING.bays[c.bay].occ===c.id)PARKING.bays[c.bay].occ=0;disposeVeh(c.g);
  c.riders.forEach(r=>{const P=GENTE[r.pid];if(P&&P.carId===c.id){P.carId=null;if(r.home){P.st=P.kind==='visita'?'visita':'casa';P.loc='';}}});}
/* people get out at the car door and walk to the platform */
function carDoor(c,side){const L=VLEN[c.kind]||4,fx=Math.sin(c.h),fz=Math.cos(c.h),rx=-fz,rz=fx;return{x:c.x+rx*side*1.35+fx*L*0.08,z:c.z+rz*side*1.35+fz*L*0.08};}
function carUnload(c){const out=c.riders.filter(r=>r.up&&!r.out);
  out.forEach((r,k)=>{r.out=1;const P=GENTE[r.pid];let tr=TRAINS.find(t=>t.id===r.tr);if(!P||!tr)return;
    if(tr.served||tr.done||tr.oos){const n=nextWait(tr);if(!tr.oos)stats.lost++;if(!n)return;tr=n;}
    const d=carDoor(c,k===0&&c.role==='own'?-1:1);gSpawnUp(r.e,tr,false,d);P.carId=c.role==='own'?c.id:null;});
  if(c.role==='own'||c.role==='drop'||c.role==='thru')c.riders=c.riders.filter(r=>!r.up);
  if(c.phase==='stop'&&c.role!=='pick'&&c.role!=='crew'){c.wait=0;c.leaveAt=sim.t+4;}}
/* who is waiting by this car, and when it can go */
function carBoardCheck(c){
  if(c.role==='pick'){const all=c.riders.length&&c.riders.every(r=>r.in);if(all||sim.t>c.until)carGo(c);return;}
  if(c.leaveAt&&sim.t>=c.leaveAt){c.leaveAt=0;carGo(c);}}
function carGo(c){const home=c.home||'E';
  if(c.bay!=null){c.legs=[{p:'out',bay:c.bay,end:'go'},{p:'exit',bay:c.bay,end:'go'},{p:'road',a:'ST',b:home,end:'off'}];c.bay=null;}
  else c.legs=[{p:'exit',bay:null,end:'go'},{p:'road',a:'ST',b:home,end:'off'}];
  c.li=0;c.s=0;c.phase='drive';c.v=0;carPlace(c);
  c.riders.forEach(r=>{const P=GENTE[r.pid];if(P&&r.in){P.st='coche';P.carId=c.id;}});}
function freeBay(keep){const fr=PARKING.bays.map((B,i)=>i).filter(i=>!PARKING.bays[i].occ);if(fr.length<=(keep||0))return null;
  // nearest to the station door first, as people do
  fr.sort((a,b)=>Math.hypot(PARKING.bays[a].x+6,PARKING.bays[a].z+22)-Math.hypot(PARKING.bays[b].x+6,PARKING.bays[b].z+22));return fr[0];}
/* comarca: a car brings them to their train (they drive and park, or someone drops them off) */
function carToTrain(e,tr){const P=GENTE[e.pid],from=COMARCA_EDGE[P.from]||'E',own=carOf(P);
  // others from the same village for the same train ride along
  const riders=[{pid:P.id,e:e,tr:tr.id,up:1}];
  tr.paxPlan=tr.paxPlan.filter(x=>{const Q=GENTE[x.pid];if(Q&&Q!==P&&Q.kind==='comarca'&&Q.from===P.from&&Math.abs(x.t-e.t)<300&&riders.length<4){riders.push({pid:Q.id,e:x,tr:tr.id,up:1});return false;}return true;});
  let bay=own?freeBay(3):null;const v=own||P.famCar;   // the last three places are left for those who come to fetch somebody
  const c=newCar({kind:v.k,hex:v.hex,home:from,role:bay!=null?'own':'drop',owner:P.id,riders:riders,bay:bay,
    legs:[{p:'road',a:from,b:'ST',end:'go'},bay!=null?{p:'in',bay:bay,end:'park'}:{p:'drop',end:'stop'}]});
  if(bay!=null)PARKING.bays[bay].occ=c.id;
  riders.forEach(r=>{const Q=GENTE[r.pid];Q.st='coche';Q.carId=c.id;Q.leg=r.e.leg;});
  return c;}
/* the trip back: their own car in the car park, or someone from home comes to pick them up */
function carForReturn(P){const c=P.carId&&TRAF.cars.find(o=>o.id===P.carId);if(c)return c;
  // a pick-up already on its way for somebody from the same village arriving on the same train
  const pk=TRAF.cars.find(o=>o.role==='pick'&&o.riders.some(r=>r.pid===P.id));if(pk)return pk;
  carOf(P);const from=COMARCA_EDGE[P.from]||'E',v=P.famCar,bay=freeBay(0);
  // nowhere to wait in the car park: they will come as soon as a place is free
  if(bay==null){if(!TRAF.pend.some(q=>q.pid===P.id))TRAF.pend.push({pid:P.id,until:sim.t+45*60});return null;}
  TRAF.pend=TRAF.pend.filter(q=>q.pid!==P.id);
  const c2=newCar({kind:v.k,hex:v.hex,home:from,role:'pick',riders:[{pid:P.id}],bay:bay,until:sim.t+45*60,legs:[{p:'road',a:from,b:'ST',end:'go'},{p:'in',bay:bay,end:'park'}]});
  PARKING.bays[bay].occ=c2.id;P.carId=c2.id;return c2;}
/* where to walk to get into the car: its door if it is there, else the kerb by the station door */
function carMeet(P){const c=carForReturn(P),ready=c&&(c.phase==='parked'||c.phase==='waitbay'||c.phase==='stop');
  if(ready)return Object.assign(carDoor(c,c.role==='own'?-1:1),{c:c});
  return{x:SQP.stop.x+0.2,z:SQP.stop.z+2.2,c:c};}
/* a passenger reaches the car: in they get */
function carBoard(p){const P=GENTE[p.pid];if(!P||!P.carId)return false;const c=TRAF.cars.find(o=>o.id===P.carId);if(!c)return false;
  const ready=c.phase==='parked'||c.phase==='waitbay'||c.phase==='stop';
  if(!ready||Math.hypot(c.x-p.x,c.z-p.z)>4.5){p.state='waitcar';p.wp=[];p.wi=0;return true;}
  let r=c.riders.find(q=>q.pid===P.id);if(!r){r={pid:P.id};c.riders.push(r);}r.in=1;r.home=1;r.up=0;
  hidePax(p);P.st='coche';
  if(c.role==='own'){carGo(c);}
  else if(c.role==='pick'&&c.riders.every(q=>q.in))carGo(c);
  return true;}
/* people who wait for a car that has not come yet walk to it once it is parked or stopped */
function stepWaitCar(){PAX.forEach(p=>{if(!p.on||p.state!=='waitcar'||p.pid==null)return;const P=GENTE[p.pid],c=P&&TRAF.cars.find(o=>o.id===P.carId);
  if(!c){if(TRAF.pend.some(q=>q.pid===p.pid))return;p.state='leave';p.wp=[{x:-6,z:-62},{x:-6,z:-88}];p.wi=0;return;}
  const ready=c.phase==='parked'||c.phase==='waitbay'||c.phase==='stop';if(!ready)return;
  const m=carMeet(P);if(Math.hypot(m.x-p.x,m.z-p.z)<1.2){carBoard(Object.assign(p,{state:'leave'}));return;}
  p.state='leave';p.wp=[{x:m.x,z:m.z}];p.wi=0;});}
/* traffic that only passes through, and the cars of the regulars who left them in the morning */
function trafficTick(){
  if(sim.t<TRAF.next)return;const hr=(sim.t/3600)%24,day=hr>=6.5&&hr<22.5,R=Math.random;
  TRAF.next=sim.t+(day?60+R()*360:300+R()*1800);
  if(TRAF.cars.filter(c=>c.role==='thru').length>=4)return;
  const E=['E','W','S','N'],w=[0.42,0.24,0.24,0.10],pick=()=>{let r=R();for(let i=0;i<4;i++){r-=w[i];if(r<=0)return E[i];}return'E';};
  let a=pick(),b=pick(),g=0;while(b===a&&g++<10)b=pick();if(a===b)return;
  if((a==='N'||b==='N')&&R()<0.6)return;   // the track to Galbarros sees little traffic
  const v=pickVeh(R);newCar({kind:v.k,hex:v.hex,role:'thru',legs:[{p:'road',a:a,b:b,end:'off'}]});}
function carsStep(gdt){if(!TRAF.ready)return;
  // fetch those who were left waiting for a free place, as soon as there is one
  if(TRAF.pend.length){TRAF.pend=TRAF.pend.filter(q=>sim.t<q.until);const q=TRAF.pend[0];if(q&&freeBay(0)!=null){TRAF.pend.shift();carForReturn(GENTE[q.pid]);}}
  const n=Math.max(1,Math.ceil(gdt/0.2)),h=gdt/n;
  for(let k=0;k<n;k++)TRAF.cars.slice().forEach(c=>carStep(c,h));
  trafficTick();stepWaitCar();
  // regulars' cars: their owners come back on an evening train and drive off
  TRAF.cars.forEach(c=>{if(c.role==='reg'&&c.phase==='parked'&&c.until&&sim.t>=c.until){c.until=0;const B=PARKING.bays[c.bay];
    const p=newPax(-6,-21,'leave');if(!p)return;const d=carDoor(c,-1);p.wp=[{x:-6,z:-23},{x:B.x-2,z:-31.8},{x:d.x,z:d.z}];p.wi=0;p.carReg=c.id;}});
  const N=NIGHT.N||0;TRAF.lw.opacity=0.95*N;TRAF.lr.opacity=0.85*N;
  if(NIGHT.beam.opacity>0.005)TRAF.cars.forEach(carBeam);}
/* the headlight beam of a car, on the road it is about to drive: before, it was a rigid sheet stuck out ahead of the
   car, so on every bend it swept across the fields and the houses (and on the ramps of the crossing it rose into the
   air). Now each row of the strip sits on the car's path that far ahead, square to the path there, on the ground; past
   the end of its leg it runs straight on. On a tight bend the strip narrows so it does not fold over itself */
function carBeam(c){const B=c.g.userData.beam;if(!B||c.x===undefined||!c.g.userData.lights.visible)return;const S=carPath(c);if(!S||!S.length)return;
  const sg=S.rev?-1:1,U=B.userData,A=B.geometry.attributes.position,a=A.array,NB=A.count/2-1;
  const gx=c.g.position.x,gy=c.g.position.y,gz=c.g.position.z,ch=Math.cos(c.h),sh=Math.sin(c.h),p=c.g.rotation.x,cp=Math.cos(p),sp=Math.sin(p);
  let ph=null;
  for(let i=0;i<=NB;i++){const d=U.L/2+U.len*i/NB,s=c.s+sg*d,e=clamp(s,0,S.L),q=carAt(S,e),hn=S.rev?q.h+PI:q.h,o=Math.abs(s-e);
    const x=q.x+Math.sin(hn)*o,z=q.z+Math.cos(hn)*o,y=walkCarY(x,z)+0.1;
    let hw=U.hw;if(ph!==null){const dh=Math.abs(Math.atan2(Math.sin(hn-ph),Math.cos(hn-ph)));if(dh>1e-3)hw=Math.min(hw,0.85*(U.len/NB)/dh);}ph=hn;
    const cx=Math.cos(hn)*hw,cz=-Math.sin(hn)*hw;
    [[x+cx,z+cz],[x-cx,z-cz]].forEach(([X,Z],k)=>{const dx=X-gx,dy=y-gy,dz=Z-gz,lx=dx*ch-dz*sh,lz=dx*sh+dz*ch,j=(i*2+k)*3;
      a[j]=lx;a[j+1]=dy*cp+lz*sp;a[j+2]=-dy*sp+lz*cp;});}
  A.needsUpdate=true;}
/* one of those regulars reaches the car */
function regBoard(p){const c=TRAF.cars.find(o=>o.id===p.carReg);p.carReg=null;if(!c)return false;hidePax(p);carGo(c);return true;}
function trafficInit(){
  TRAF.lw=NIGHT.glowW.clone();TRAF.lr=NIGHT.glowR.clone();TRAF.lw.opacity=0;TRAF.lr.opacity=0;
  // the cars of people who went to work by train this morning
  const R=mulberry(1971),n=4+Math.floor(R()*3),idx=PARKING.bays.map((b,i)=>i).sort(()=>R()-0.5).slice(0,n);
  idx.forEach((i,k)=>{const v=k===0?{k:'alpina',hex:0x1E2F5A}:pickVeh(R);const c=newCar({kind:v.k,hex:v.hex,role:'reg',bay:i,phase:'parked',home:['E','W','S','E'][k%4],
    legs:[{p:'in',bay:i,end:'park'}],until:(Math.floor(sim.t/86400)*86400)+(17.5+R()*3.5)*3600});c.s=bayPath(i,false).L;carPlace(c);PARKING.bays[i].occ=c.id;});
  TRAF.ready=true;}

trafficInit();

/* =====================================================================
   22c. El personal en el campo. El agente de circulación sale del gabinete a calzar una aguja sin comprobación (las dos
   de una diagonal, una tras otra) o a limpiar la que no tiene calentador cuando se hiela; las brigadas de Vía y Obras
   llegan en su furgoneta a reparar agujas, señales y el paso a nivel, y el agente de infraestructura que manda el Puesto
   de Mando guarda el paso a nivel. Van por el paseo de la vía, no pisan una vía con un tren a la vista y, si viene uno
   se apartan a un sitio despejado hasta que pasa.
   ===================================================================== */
const {CESS,GAB,PNV,PNS,crewRoute}=NIVEL.personal();
const CREW={seq:0,jobs:[]};
const VAN={k:'mb100',hex:0xEDEDEA};   // the Vía y Obras van: a white MB100
const CREWC={circ:{top:0xE8701E,sl:0x22304A,leg:0x22304A,cap:0x1E283C},    // navy uniform and gorra under the orange vest
  infra:{top:0xD9BC4E,sl:0xD9BC4E,leg:0xD9BC4E,cap:null},                  // Vía y Obras in the 90s: the yellow buzo, bareheaded
  infraB:{top:0x3D5786,sl:0x3D5786,leg:0x3D5786,cap:null}};                 // (and now and then one in the blue one)
function crewLook(who,seed){const R=mulberry(seed),C=CREWC[who==='infra'&&R()<0.22?'infraB':who];
  return{h:grr(0.98,1.07,R),w:grr(0.98,1.1,R),f:false,long:false,pack:false,bag:false,skirt:false,bald:R()<0.3,bun:false,jacket:false,big:R()<0.25,
    head:C.cap?'cap':null,outer:null,hood:false,stoop:false,cane:false,kid:false,
    c:{top:C.top,sl:C.sl,leg:C.leg,skin:gpick(SKIN,R),hair:gpick([0x1E1A17,0x3A2A1E,0x5A3E28,0x9A9590,0x2A211B],R),shoe:0x1C1C1C,cap:C.cap}};}
function crewDress(p){p.wear=p.crew==='pastor'?'coat':null;paxPaint(p);}
/* how far a point is from the nearest track centre line */
function trackClear(x,z){let d=1e9;for(const k in TRACKS)d=Math.min(d,distPoly(x,z,TRACKS[k].pts));return d;}
/* the nearest place clear of every track (3.7 m from the centre lines: outside the gauge of a passing train, not by a
   catenary mast) on the ground, without crossing another track to get there */
function crewSafe(T){let best=null,bd=1e9;
  for(let dx=-10;dx<=10;dx+=1)for(let dz=-8;dz<=8;dz+=0.25){const x=T.x+dx,z=T.z+dz;
    if(zoneOf(x,z)!=="OUT"||trackClear(x,z)<3.7)continue;
    let n=0;for(const k in TRACKS){const tz=zAt(TRACKS[k].pts,x);if(tz!==null&&(tz-T.z)*(tz-z)<0&&Math.abs(tz-T.z)>1.6)n++;}
    const c=Math.hypot(dx,dz)+n*8;if(c<bd){bd=c;best={x:x,z:z};}}
  return best||{x:T.x,z:CESS};}
/* where they work: at the tip of each blade of a switch, on the side away from the branch; at the foot of a signal,
   away from its track (the second of the pair a step back) */
function swSpots(S){return S.legs.map(L=>{const tz=TZ[L.t],bz=zAt(TRACKS[L.br].pts,L.x+L.dir*8),sd=bz!==null&&bz>tz?-1:1;
  return{x:L.x+L.dir*1.4,z:tz+sd*1.05,hd:sd>0?PI:0,pose:'bend'};});}
function pairSpots(A){if(A.length>=2)return A.slice(0,2);const a=A[0],dx=a.x>0?-2:2;return[a,Object.assign({},a,{x:a.x+dx})];}
function sigSpots(S){const tz=zOn('v'+S.t,S.x),aw=S.sz>tz?1:-1,a={x:S.x+0.55,z:S.sz+aw*0.75},b={x:S.x-1.3,z:S.sz+aw*1.4};
  a.hd=Math.atan2(S.x-a.x,S.sz-a.z);a.pose=S.low?'bend':'reach';b.hd=Math.atan2(S.x-b.x,S.sz-b.z);b.pose='stand';return[a,b];}
/* a train on the point or coming to it: what the lookout sees, some 14 seconds ahead at its speed (a stopped train
   only where it stands) */
function crewDanger(x,z){
  for(const t of TRAINS){if(!t.spawned||t.done||!t.P)continue;const v=Math.abs(t.v||0),A=v>0.3?25+v*14:3;
    const hx=pathAt(t.P,t.s).x,tx=pathAt(t.P,t.s-t.len).x;if(x<Math.min(hx,tx)-A-5||x>Math.max(hx,tx)+A+5)continue;
    for(let s=t.s-t.len-A;s<=t.s+A;s+=3){const q=pathAt(t.P,s);if(Math.abs(q.x-x)<3.2&&Math.abs(q.z-z)<3)return true;}}
  return false;}
/* before stepping onto a track (a waypoint marked trk): wait while it is not clear; once on it, get across */
function crewHold(p,w){if(trackClear(p.x,p.z)<2.4)return false;
  if(p.hcT!=null&&p.hcW===p.wi&&sim.t-p.hcT<0.5&&sim.t>=p.hcT)return p.hc;
  const d=Math.hypot(w.x-p.x,w.z-p.z),n=Math.max(1,Math.ceil(d));let h=false;
  for(let i=1;i<=n&&!h;i++){const x=p.x+(w.x-p.x)*i/n,z=p.z+(w.z-p.z)*i/n;if(trackClear(x,z)<2.8&&crewDanger(x,z))h=true;}
  p.hc=h;p.hcT=sim.t;p.hcW=p.wi;return h;}
function crewWp(p,list){let px=p.x,pz=p.z;
  p.wp=list.map(q=>{const w={x:q.x,z:q.z},d=Math.hypot(w.x-px,w.z-pz),n=Math.max(1,Math.ceil(d/0.5));
    for(let i=1;i<=n;i++)if(trackClear(px+(w.x-px)*i/n,pz+(w.z-pz)*i/n)<1.9){w.trk=1;break;}
    px=w.x;pz=w.z;return w;});p.wi=0;p.hcT=null;}
const crewLen=(a,w)=>{let L=0,x=a.x,z=a.z;w.forEach(q=>{L+=Math.hypot(q.x-x,q.z-z);x=q.x;z=q.z;});return L;};
/* a job: who goes (circ: the agente de circulación; infra: Vía y Obras), from where (gab, park, pn, or auto: the
   level-crossing verge for what lies on the Miranda side, the station car park for the rest), to which spots, to be
   there by tArr and until when (null: until the incident is over or the job is released) */
function crewSend(o){const j=Object.assign({id:++CREW.seq,inc:null,k:'',who:'infra',base:'park',n:1,spots:[],seq:false,st:'wait',pax:[],car:null,slot:null,
    until:null,tHere:null,rel:false,virt:false,msg:'',ist:''},o);
  if(j.base==='auto')j.base=j.spots[0].x<-100?'pn':'park';
  j.safe=j.spots.map(sp=>trackClear(sp.x,sp.z)<3.7?crewSafe(sp):{x:sp.x,z:sp.z});
  const b0=j.base==='pn'?'pnA':j.base,st=b0==='gab'?GAB:b0==='park'?{x:15,z:-33}:PNV.A.lead[0];
  let walk=crewLen(st,crewRoute(b0,j.spots[0],j.safe[0]))/1.25+10;
  if(j.seq)for(let i=1;i<j.spots.length;i++)walk+=Math.hypot(j.spots[i].x-j.spots[i-1].x,j.spots[i].z-j.spots[i-1].z)/1.25+60;
  j.tGo=Math.max(sim.t,(j.tArr!=null?j.tArr:sim.t)-walk-(j.base==='gab'?0:75));
  CREW.jobs.push(j);return j;}
function crewIce(S){const j=CREW.jobs.find(o=>o.k==='hielo'&&o.sw===S.id);if(j){j.until=Math.max(j.until||0,S.frozenUntil);return;}
  crewSend({k:'hielo',sw:S.id,who:'circ',base:'gab',n:1,spots:swSpots(S),seq:true,until:S.frozenUntil});}
function crewOf(inc,k){return CREW.jobs.find(j=>j.inc===inc.id&&j.k===k);}
/* has the crew been at work long enough (or, if something kept them, has the time run out) */
function crewOk(inc,k,need,deadline){const j=crewOf(inc,k);if(!j||j.virt)return true;
  if(j.tHere!=null&&sim.t-j.tHere>=need)return true;return sim.t>=deadline;}
function crewDone(inc,k){const j=crewOf(inc,k);if(j)j.rel=true;}
function crewLaunch(j){
  if(j.base==='gab'){crewSpawn(j,null);return;}
  if(j.base==='pn'){const sl=['A','B'].find(s=>!CREW.jobs.some(o=>o!==j&&o.slot===s)&&!TRAF.cars.some(c=>c.legs.some(L=>L.p==='crew'&&L.k.charAt(0)===s)));
    if(sl){j.slot=sl;j.base='pn'+sl;const c=newCar({kind:VAN.k,hex:VAN.hex,role:'crew',home:PNV[sl].to,legs:[{p:'crew',k:sl+':in',end:'park'}]});j.car=c.id;j.st='drive';return;}
    j.base='park';}
  const bay=freeBay(1),c=newCar({kind:VAN.k,hex:VAN.hex,role:'crew',home:'E',bay:bay,
    legs:[{p:'road',a:'E',b:'ST',end:'go'},bay!=null?{p:'in',bay:bay,end:'park'}:{p:'drop',end:'stop'}]});
  if(bay!=null)PARKING.bays[bay].occ=c.id;j.car=c.id;j.st='drive';}
function crewSpawn(j,c){j.st='walk';j.pax=[];
  for(let k=0;k<j.n;k++){const st=c?carDoor(c,k%2?1:-1):{x:GAB.x,z:GAB.z};const p=newPax(st.x,st.z,'crew');if(!p)break;
    Object.assign(p,{crew:j.id,task:null,tb:0,tr:0,here:null,si:0,hs:null,out:1,home:{x:st.x,z:st.z},look:crewLook(j.who,j.id*31+k*7),sp:1.22+0.12*k});crewDress(p);
    const sp=j.spots[j.seq?0:k%j.spots.length],sf=j.safe[j.seq?0:k%j.safe.length];p.route=crewRoute(j.base,sp,sf);crewWp(p,p.route);j.pax.push(p.i);}
  if(!j.pax.length)j.virt=true;}
function crewBack(j,P){j.st='back';
  P.forEach(p=>{p.task=null;const r=p.route||[];const back=(p.out&&p.wi<p.wp.length?r.slice(0,p.wi):r.slice(0,-1)).reverse();
    back.push(p.home);crewWp(p,back);});}
function crewVanGo(j,c){if(j.slot){c.legs=[{p:'crew',k:j.slot+':out',end:'off'}];c.li=0;c.s=0;c.v=0;c.phase='drive';carPlace(c);}else carGo(c);}
function crewDrop(j){j.pax.forEach(i=>{const p=PAX[i];if(p&&p.on&&p.crew===j.id)hidePax(p);});const i=CREW.jobs.indexOf(j);if(i>=0)CREW.jobs.splice(i,1);}
function crewStep(){if(!CREW.jobs.length)return;
  CREW.jobs.slice().forEach(j=>{
    const inc=j.inc!=null?INC.list.find(i=>i.id===j.inc):null;
    if((j.inc!=null&&(!inc||inc.done))||(j.until!=null&&sim.t>=j.until))j.rel=true;
    if(j.st==='wait'){if(j.rel){crewDrop(j);return;}if(sim.t>=j.tGo)crewLaunch(j);return;}
    if(j.st==='drive'){const c=TRAF.cars.find(o=>o.id===j.car);
      if(!c){if(j.rel)crewDrop(j);else{j.base='gab';crewSpawn(j,null);}return;}   // (the van is gone: they walk from the station)
      if(c.phase==='parked'||c.phase==='stop'){if(j.rel){crewVanGo(j,c);crewDrop(j);}else crewSpawn(j,c);}return;}
    const P=j.pax.map(i=>PAX[i]).filter(p=>p&&p.on&&p.crew===j.id);
    if(j.st!=='back'&&(j.rel||!P.length))crewBack(j,P);
    if(j.st==='back'){P.forEach(p=>{if(p.wi>=p.wp.length)hidePax(p);});
      if(P.every(p=>!p.on)){const c=j.car!=null&&TRAF.cars.find(o=>o.id===j.car);if(c)crewVanGo(j,c);crewDrop(j);}return;}
    P.forEach((p,k)=>{
      const n=j.seq?(p.si||0):j.pax.indexOf(p.i)%j.spots.length,sp=j.spots[n],sf=j.safe[n];
      if(p.wi<p.wp.length){p.task=null;return;}   // on the way
      p.out=0;
      const open=sp.x!==sf.x||sp.z!==sf.z;let dg=false;
      if(open){if(p.dgT==null||sim.t-p.dgT>=0.4||sim.t<p.dgT){p.dg=crewDanger(sp.x,sp.z);p.dgT=sim.t;}dg=p.dg;}
      const atSp=Math.hypot(p.x-sp.x,p.z-sp.z)<0.35;
      if(dg){p.task=null;if(Math.hypot(p.x-sf.x,p.z-sf.z)>=0.35)crewWp(p,[sf]);else p.hd=Math.atan2(sp.x-p.x,sp.z-p.z);return;}
      if(!atSp){crewWp(p,[sp]);return;}
      p.hd=sp.hd;p.task=sp.pose;if(p.hs==null)p.hs=sim.t;
      if(j.seq&&n<j.spots.length-1){if(sim.t-p.hs>=45){p.si=n+1;p.hs=null;p.task=null;crewWp(p,[j.spots[n+1]]);}return;}
      if(p.here==null)p.here=sim.t;});
    if(j.tHere==null&&P.length&&P.every(p=>p.here!=null)){j.tHere=sim.t;j.st='work';if(j.msg)toast(j.msg);if(inc&&j.ist)inc.st=j.ist;}
  });}
/* the van's ways to and from the verge by the level crossing: the road, then off it to the verge, and back onto it */
function crewPath(key){const K='cw:'+key;if(TRAF.paths[K])return TRAF.paths[K];
  const sl=key.split(':')[0],io=key.split(':')[1],V=PNV[sl],R=roadPath(V.from,V.to),pt=q=>({x:q.x,z:q.z,o:0,v:q.v,pc:q.pc});let raw;
  if(io==='in'){let i=R.findIndex(q=>V.stop(q.cz));if(i<2)i=2;raw=R.slice(0,i).filter((q,k)=>k%3===0).map(pt);const pc=R[i].pc;
    V.pull.forEach((q,k)=>raw.push({x:q.x,z:q.z,o:0,v:k<V.pull.length-1?3:1,pc:pc}));}
  else{const i=Math.max(0,R.findIndex(q=>V.merge(q.cz))),e=V.pull[V.pull.length-1];const e0=V.pull[V.pull.length-2],ux=e.x-e0.x,uz=e.z-e0.z,ul=Math.hypot(ux,uz)||1;   // straight on out of the verge, then onto the road
    raw=[{x:e.x,z:e.z,o:0,v:1.5,pc:R[i].pc},{x:e.x+ux/ul*1.6,z:e.z+uz/ul*1.6,o:0,v:2,pc:R[i].pc}];
    raw=raw.concat(R.slice(i).filter((q,k)=>k%3===0).map(pt));raw.push(pt(R[R.length-1]));}
  const S=samplePath(raw,{r:5});S.gates=routeGates(S);S.key=K;TRAF.paths[K]=S;return S;}

/* =====================================================================
   23. Interlocking: establish, cancel, release routes
   ===================================================================== */
function bodyPts(o){const out=[];if(!o.P)return out;for(let d=0;d<=o.len;d+=6)out.push(pathAt(o.P,o.s-d));return out;}
function bodyOn(o,secs){for(const q of bodyPts(o)){for(const sc of secs){if(q.t===sc.t&&q.x>=sc.a-1&&q.x<=sc.b+1)return true;}}return false;}
let SW_SKIP=null;   // the train itself, when its body is known to be clear of the points (tren de trabajos, aguja 7)
function switchOccupied(u){const S=SW_BY[u];
  for(const o of TRAINS){if(!o.spawned||o.done||o===SW_SKIP)continue;for(const q of bodyPts(o)){for(const L of S.legs){if(Math.abs(q.x-L.x)<16&&(q.t==='v'+L.t||q.t===L.br))return true;}}}
  return false;}
function conflicts(res,tr){
  for(const R of ROUTES){if(R.tr===tr)continue;
    for(const a of R.secs)for(const b of res.secs){if(a.t===b.t&&a.a<b.b-0.5&&a.b>b.a+0.5)return'Incompatible con el itinerario de '+R.tr.label;}
    for(const u in res.req){if(R.req[u]&&R.req[u]!==res.req[u])return SW_BY[u].name+' enclavado por '+R.tr.label;}}
  for(const o of TRAINS){if(o===tr||!o.spawned||o.done)continue;if(bodyOn(o,res.secs))return'Vía ocupada por '+o.label;}
  for(const u in res.req){const want=res.req[u]==='R';if(SW_BY[u].reverse!==want&&switchOccupied(u))return SW_BY[u].name+' ocupada por un tren';}
  for(const u in res.req){const S=SW_BY[u],want=res.req[u]==='R';if(S.reverse!==want&&S.frozenUntil>sim.t)return S.name+' helada: no comprueba ('+(S.cal===false?'sin calentador':'calefactor')+', '+Math.ceil((S.frozenUntil-sim.t)/60)+'′)';}
  for(const u in res.req){const S=SW_BY[u];if(!S.nc)continue;const want=res.req[u]==='R';
    if(S.lockPos==null)return S.name+' sin comprobación: hay que calzarla y acerrojarla';if(S.lockPos!==want)return S.name+' calzada en '+(S.lockPos?'invertida':'normal');}
  return null;
}
/* an entry route is released once the tail clears the switches on the way in; a switch the train will be standing on
   when it stops at the end of the itinerary (the aguja 7, in vía 3) does not count: occupation protects it */
function releaseXOf(res,dir,kind,len){
  const xs=[],end=dir>0?Math.max(...res.secs.map(sc=>sc.b)):Math.min(...res.secs.map(sc=>sc.a));
  for(const u in res.req){SW_BY[u].legs.forEach(L=>{const t='v'+L.t,d=(end-L.x)*dir;if(kind==='in'&&len&&d>=0&&d<len+5)return;if(res.secs.some(sc=>sc.t===t&&L.x>=sc.a-0.1&&L.x<=sc.b+0.1))xs.push(L.x);});}
  if(!xs.length){const l=res.secs[res.secs.length-1];return dir>0?l.b:l.a;}
  return dir>0?Math.max.apply(null,xs):Math.min.apply(null,xs);
}
function dedupe(pts){const o=[];pts.forEach(q=>{const l=o[o.length-1];if(l&&Math.hypot(l[0]-q.x,l[1]-q.z)<0.05)return;o.push([q.x,q.z]);});return o;}
function setSwitchVis(S){S.legs.forEach(L=>{L.mStraight.visible=!S.reverse;L.mBranch.visible=S.reverse;});}
function establish(tr,res,kind,sig){
  for(const u in res.req){const S=SW_BY[u];S.reverse=(res.req[u]==='R');setSwitchVis(S);}
  const R={tr:tr,kind:kind,sig:sig,req:res.req,secs:res.secs,pts:res.pts,passed:false,releaseX:releaseXOf(res,tr.dir,kind,tr.len)};
  const pp=dedupe(res.pts);if(pp.length>1){R.mesh=ribbon(frames(pp),0.75,0.9,ROUTE_MAT);R.mesh.renderOrder=3;scene.add(R.mesh);}
  ROUTES.push(R);if(kind==='in')tr.routeIn=R;else if(kind==='out')tr.routeOut=R;else tr.routeRet=R;
  if(kind==='out'&&sig&&tr.spawned&&tr.P){const gs=sOfX(tr.P,sig.x,'v'+sig.t);if(gs!==null&&gs<tr.s-0.5)R.passed=true;}
  refreshAspects();repathAll();
  return R;
}
function dropRoute(R){const i=ROUTES.indexOf(R);if(i>=0)ROUTES.splice(i,1);if(R.mesh){scene.remove(R.mesh);R.mesh.geometry.dispose();R.mesh=null;}}
function releaseRoute(R){dropRoute(R);R.released=true;refreshAspects();}
function canCancel(R){
  if(R.passed)return false;const tr=R.tr;if(!tr.spawned)return true;
  const gs=sOfX(tr.P,R.sig.x,'v'+R.sig.t);if(gs===null)return true;
  if(gs<tr.s)return false;if(tr.v<0.3)return true;   // stopped in front of it (waiting at a red signal): it can always be closed
  return(gs-tr.s)>tr.v*tr.v/(2*tr.ty.b)+25;
}
function cancelRoute(R){
  const tr=R.tr;dropRoute(R);
  if(tr.routeIn===R){tr.routeIn=null;tr.stopTrack=null;tr.stopX=null;tr.stopSig=null;retargetPax(tr);}
  if(tr.routeOut===R){tr.routeOut=null;
    /* a departure that never got its signal: the train stays at the platform or in the siding, ready to be sent again */
    if(tr.phase==='despachando'||tr.phase==='saliendo'){tr.phase=(tr.svc.type==='md'&&!tr.oos&&!tr.towed&&PLAT[tr.stopTrack])?'listo':'apartado';tr.served=false;uiDirty=true;}}
  refreshAspects();repathAll();
}
const INNER={intermedia:1,retroceso:1};
/* the other exit signals an exit itinerary runs over after its own (from the vía 5: the S2/5 and then the S2/3) */
const outAlso=R=>SIGNALS.filter(S=>S!==R.sig&&S.kind==='salida'&&S.face===-R.tr.dir&&R.secs.some(sc=>sc.t==='v'+S.t&&S.x>sc.a+0.5&&S.x<sc.b-0.5));
/* the signal that protects a point of an itinerary (a switch without comprobación): the last one before it, in the
   direction of the train, among the itinerary's own signal and the intermediate ones it runs over (a retroceso signal
   only repeats the entry, it protects nothing) */
function protSig(R,p){if(!R.sig||!p)return null;const d=R.tr.dir,cov=S=>R.secs.some(sc=>sc.t==='v'+S.t&&S.x>sc.a+0.5&&S.x<sc.b-0.5);
  let best=null;[R.sig].concat(SIGNALS.filter(S=>S!==R.sig&&S.kind!=='retroceso'&&S.face===-d&&cov(S))).forEach(S=>{if((p.x-S.x)*d>0&&(!best||S.x*d>best.x*d))best=S;});
  return best||R.sig;}
/* does incident i keep intermediate/retroceso signal S of itinerary R at stop? A point incident only at the signal that
   protects the point (a retroceso signal goes with the entry it repeats); any other only the way it always did */
function incAtInner(R,S,i){if(i.done||i.k==='sg')return false;
  if(i.point){const p=i.point(R);if(!p)return false;const P=protSig(R,p);return P===S||(S.kind==='retroceso'&&P===R.sig);}
  return!!(R.incBs&&R.incBs.indexOf(i)>=0);}
const unprovenAt=(R,S)=>INC.list.some(i=>incAtInner(R,S,i));
const unproven=R=>!!(R.incBs&&R.incBs.some(i=>!i.done&&i.k!=='sg'));   // the itinerary itself has no comprobación (not just a faulty signal)
/* the itinerary of a train that runs over an intermediate or retroceso signal */
const innerRoute=(tr,S)=>[tr.routeIn,tr.routeOut].find(R=>R&&R.secs.some(sc=>sc.t==='v'+S.t&&S.x>sc.a+0.5&&S.x<sc.b-0.5));
function refreshAspects(){
  SIGNALS.forEach(s=>{s._a='parada';});
  ROUTES.forEach(R=>{if(R.passed||R.kind!=='out')return;R.incBs=incRouteBlocks(R);R.sig._a=(blkFor(R)||R.incBs.length)?'parada':'libre';});
  /* an exit itinerary that starts further back (from the S2/5, or from an intermediate signal) runs over another exit
     signal of the same direction: it shows what the itinerary's own signal shows, until the train has passed it. If the
     first did not open and was passed with an authorisation (rbAuth), the second does not open either: the same
     authorisation covers both */
  ROUTES.forEach(R=>{if(R.kind!=='out'||R.released)return;const t=R.tr;
    outAlso(R).forEach(S=>{const g=t.sigs&&t.sigs.find(q=>q.sig===S);if(g&&g.passed)return;S._a=R.passed?(R.rbAuth?'parada':'libre'):R.sig._a;});});
  ROUTES.forEach(R=>{if(R.passed||R.kind!=='in')return;R.incBs=incRouteBlocks(R);
    const nx=ROUTES.find(o=>o!==R&&o.tr===R.tr&&o.kind==='out'&&!o.passed);R.sig._a=R.incBs.length?'parada':R.rebase?'rebase':(nx&&nx.sig._a==='libre'?'libre':'anuncio');});
  /* a backing-out move: its signal and those it passes on the way open while it lasts */
  ROUTES.forEach(R=>{if(R.kind!=='ret')return;R.incBs=incRouteBlocks(R);const a=R.incBs.length?'parada':'libre';R.sig._a=a;
    SIGNALS.forEach(S=>{if(S.face===R.tr.dir&&R.secs.some(sc=>sc.t==='v'+S.t&&S.x>sc.a+0.5&&S.x<sc.b-0.5))S._a=a;});});
  /* an intermediate signal (or a retroceso signal acting as entry indicator) opens with the itinerary that runs over it and
     stays open until the train has passed it; with an itinerary without comprobación it stays at stop, like the entry */
  SIGNALS.forEach(S=>{if(!INNER[S.kind])return;
    TRAINS.forEach(t=>{if(t.done||S.face!==-t.dir)return;[t.routeIn,t.routeOut].forEach(R=>{if(!R||!R.secs.some(sc=>sc.t==='v'+S.t&&S.x>sc.a+0.5&&S.x<sc.b-0.5))return;
      const sS=t.P?sOfX(t.P,S.x,'v'+S.t):null;if(t.spawned&&t.P&&(sS===null||t.s>sS))return;   // already past it, or no longer running over it
      if(unprovenAt(R,S)){S._a='parada';return;}
      if(R.kind==='in'){const nx=t.routeOut&&!t.routeOut.released&&!t.routeOut.passed;S._a=nx&&t.routeOut.sig._a==='libre'?'libre':'anuncio';}else S._a='libre';});});});
  /* a retroceso signal does not show green or yellow: with the entry open it tells the way, general or desviada */
  SIGNALS.forEach(S=>{if(S.kind!=='retroceso'||S._a==='parada')return;S._a='general';
    ROUTES.forEach(R=>{if(!R.secs.some(sc=>sc.t==='v'+S.t&&S.x>sc.a+0.5&&S.x<sc.b-0.5))return;
      if(R.tr.dir!==-S.face)return;
      if(R.kind==='in'&&!R.passed&&R.sig._a==='parada'){S._a='parada';return;}   // it repeats the entry: at stop while the entry is
      // (once the train has gone past the entry it keeps the indication until the train passes it, like an intermediate)
      if(S._a!=='parada'&&Object.keys(R.req).some(u=>R.req[u]==='R'))S._a='desviada';});});
  /* a maniobra of the tren de trabajos or of its 311 that has to pass a signal head-on: rebase autorizado, until it is past */
  ROUTES.forEach(R=>{const t=R.tr;if(R.kind!=='man'||!(t.ttRod||(t.work&&t.shunt))||!t.P)return;
    SIGNALS.forEach(S=>{if(S.face!==-t.dir||!R.secs.some(sc=>sc.t==='v'+S.t&&S.x>sc.a-0.5&&S.x<sc.b+0.5))return;
      const sS=sOfX(t.P,S.x,'v'+S.t);if(sS!==null?sS>t.s-0.5:(S.x-pathAt(t.P,t.s).x)*t.dir>0)S._a='rebase';});});
  SIGNALS.forEach(s=>{if(s.aspect!==s._a)setAspect(s,s._a);});
  esqDirty=true;
}
function planIn(tr,t,S){return search(tr.entryTrack,tr.entrySig.x,tr.dir,S?{kind:'sig',t:t,x:S.x}:{kind:'stop',t:t},{});}
/* an intermediate signal on track t facing this direction (the S2/3A): a train can be received up to it, leaving the
   switch beyond it free (the aguja 7, for the vía 5). Useful length: from the exit signal behind to it */
const innerStopSig=(t,dir)=>SIGNALS.find(S=>S.kind==='intermedia'&&'v'+S.t===t&&S.face===-dir);
const luTo=(t,S)=>{const b=salidaOf(+t[1],S.face);return b?Math.round(Math.abs(S.x-b.x)):LU[t];};
/* a train standing with its head beyond the exit signal of its track (a convoy coupled there): the signal it cannot see */
function exitPassed(tr){if(!tr.spawned||!tr.P||!tr.stopTrack)return null;const S=salidaOf(+tr.stopTrack[1],tr.dir);if(!S)return null;
  const gs=sOfX(tr.P,S.x,'v'+S.t);return gs!==null&&gs<tr.s-0.5?S:null;}
function planOut(tr,fromTrack){const sig=salidaOf(+fromTrack[1],tr.dir);if(!sig)return null;
  /* stopped short of an intermediate signal: the exit itinerary starts there and opens it too */
  let from=(tr.stopSig&&tr.stopTrack===fromTrack&&!tr.retro)?tr.stopSig.x-tr.dir:sig.x;
  if(tr.spawned&&tr.P&&!tr.retro){const h=pathAt(tr.P,tr.s);if(h.t===fromTrack&&(h.x-sig.x)*tr.dir>0)from=h.x;}   // already past it (a convoy coupled beyond the signal)
  const res=search(fromTrack,from,tr.dir,{kind:'exit',t:exitTrackOf(tr)},{});if(res)res.sig=sig;return res;}
function checkIn(tr,t,needLen,S){
  const res=planIn(tr,t,S);if(!res)return{exists:false};
  // a route for a train behind another one that has none yet would be taken by the one in front
  const ord=o=>o.spawned?(o.phase==='aprox'?3e6:-1):o.zone==='in'?1e6+o.p:o.zone==='pre'?0:-1,k=ord(tr);
  const ahead=TRAINS.find(o=>o!==tr&&!o.done&&o.dir===tr.dir&&!o.routeIn&&o.entrySig===tr.entrySig&&ord(o)>k);
  if(ahead)return{exists:true,ok:false,msg:'Delante viene el '+ahead.label+': dale antes itinerario a él'};
  const lu=S?luTo(t,S):LU[t];
  if(needLen&&tr.len>lu+0.1)return{exists:true,ok:false,msg:'No cabe: '+Math.round(tr.len)+' m y la vía '+vn(t)+' tiene '+lu+' m útiles'+(S?' hasta la '+S.id:'')};
  const c=conflicts(res,tr);return{exists:true,ok:!c,msg:c||'',res:res};
}
/* leaving a dead-end track: back out to RETRO.to until the switch is clear, then out by that track's exit signal */
function planRetro(tr){const RT=RETRO[tr.stopTrack];if(!RT||!tr.P)return null;const h=pathAt(tr.P,tr.s);
  const res=search(tr.stopTrack,h.x,-tr.dir,{kind:'at',x:clamp(RT.x-tr.dir*(tr.len+10),-RT.max,RT.max)},{});if(!res)return null;
  res.sig=SIGNALS.find(S=>S.id===RT.sig);res.retro=RT;return res;}
function checkOut(tr,fromTrack){
  if(RETRO[fromTrack]&&TOPE[fromTrack]&&TOPE[fromTrack].dir===tr.dir){const rt=planRetro(tr),RT=RETRO[fromTrack];
    if(!rt)return{ok:false,msg:'No hay recorrido para el retroceso a la vía '+vn(RT.to)};
    const c1=conflicts(rt,tr);if(c1)return{ok:false,msg:'Retroceso: '+c1};
    const o=checkOut(tr,RT.to);if(!o.ok)return o;
    /* between where the backing-out move ends and the exit signal it runs over the track with no itinerary of its own:
       it must be clear (a train stopped there short of the S2/3A, say) */
    const xs=o.res.sig.x,mid={req:{},secs:[mkSec(RT.to,Math.min(RT.x,xs),Math.max(RT.x,xs))]},c2=conflicts(mid,tr);
    if(c2)return{ok:false,msg:'Vía '+vn(RT.to)+' hasta la '+o.res.sig.id+': '+c2.charAt(0).toLowerCase()+c2.slice(1)};
    o.res.ret=rt;return o;}
  const res=planOut(tr,fromTrack);if(!res){const xt=exitTrackOf(tr);return{ok:false,msg:'Desde la vía '+vn(fromTrack)+' no hay itinerario de salida a la '+viaN(xt==='v1'?1:-1)+' hacia '+LINE.side[tr.dir].next};}const c=conflicts(res,tr);
  /* a train whose head is already past the exit signal (a convoy coupled beyond it) does not see it: the section ahead must be clear */
  if(!c&&tr.spawned&&tr.P){const gs=sOfX(tr.P,res.sig.x,'v'+res.sig.t);if(gs!==null&&gs<tr.s-0.5){const b=blkFor({kind:'out',tr:tr,secs:res.secs,sig:res.sig});
    if(b&&b!==tr)return{ok:false,msg:'Cantón hasta '+LINE.side[tr.dir].next+' ocupado'+(b.label?' por '+b.label:''),res:res};}}
  return{ok:!c,msg:c||'',res:res};}

/* =====================================================================
   24. Train movement and stops
   ===================================================================== */
function afterPath(tr){
  const P=tr.P;
  tr.sigs=[];SIGNALS.forEach(sg=>{if(sg.face!==-tr.dir)return;const s=sOfX(P,sg.x,'v'+sg.t);if(s!==null)tr.sigs.push({sig:sg,s:s,passed:s<tr.s-0.1});});
  tr.sigs.sort((a,b)=>a.s-b.s);
  tr.div=[];let cur=null;
  for(let i=1;i<P.p.length;i++){const d=!!DIV[P.p[i].t];if(d&&!cur){cur=[P.cum[i-1],P.cum[i]];tr.div.push(cur);}else if(d&&cur){cur[1]=P.cum[i];}else cur=null;}
  tr.stopS=(tr.stopTrack&&tr.stopX!==null)?sOfX(P,tr.stopX,tr.stopTrack):null;
  tr.sCross=sOfX(P,81.5,'v1');if(tr.sCross===null)tr.sCross=sOfX(P,81.5,'v2');
}
function repath(tr,force){
  if(!tr.P||(tr.phase==='retroceso'&&!force))return;   // backing out: it runs on its own path
  const h=pathAt(tr.P,tr.s),back=Math.max(0,tr.s-tr.len-40);
  const trail=subPts(tr.P,back,tr.s);
  const P=mkPath(trail.concat(walkCurrent(h.t,h.x,tr.dir)));
  tr.s=Math.min(P.len,tr.s-back);tr.P=P;afterPath(tr);
}
function repathAll(){TRAINS.forEach(t=>{if(t.spawned&&!t.done)repath(t);});esqDirty=true;}
/* the vehicles of a train, front first: from the timetable, or the ones it carries after a coupling (socorro) */
function trainSpecs(tr){if(tr.specsOv)return tr.specsOv.map(o=>Object.assign({},o));
  let specs=carSpecs(tr.svc.type,tr.svc.num);if((tr.svc.type==='md'||tr.svc.type==='ic')&&tr.dir<0)specs=specs.slice().reverse().map(o=>Object.assign({},o,{cab:-o.cab}));return specs;}
function spawnTrain(tr){
  tr.doorA=tmat(DOOR_C);tr.doorB=tmat(DOOR_C);
  trainSpecs(tr).forEach((sp,i,a)=>{const c=buildCar(tr,sp,i,a.length);scene.add(c.g);tr.cars.push(c);});
  tr.P=mkPath(walkCurrent(tr.entryTrack,tr.dir>0?-OFF:OFF,tr.dir));
  tr.s=tr.len+1;tr.v=Math.min(tr.lv||vEff(tr),vEff(tr));tr.spawned=true;tr.phase='aprox';tr.zone='vis';
  afterPath(tr);placeCars(tr);
  toast(tr.label+' se aproxima por vía '+vn(tr.entryTrack)+' · lado '+(tr.dir>0?NIVEL.lado.o:NIVEL.lado.e));
}
function placeCars(tr){
  let off=0;if(tr.jolt&&sim.t-tr.jolt.t0>4)tr.jolt=null;
  tr.cars.forEach((c,j)=>{const cs=tr.s-off-c.L/2+(tr.jolt?joltOff(tr,j):0);const f=pathAt(tr.P,cs+c.L/2-3),r=pathAt(tr.P,cs-c.L/2+3);
    c.g.position.set((f.x+r.x)/2,0.78,(f.z+r.z)/2);c.g.rotation.y=Math.atan2(f.x-r.x,f.z-r.z)+(c.rev?PI:0);off+=c.L+tr.gap;});
}
/* the knock of a coupling: the cars struck are shoved away from the one coming (a wave that runs down them and dies out
   in a second or two, the couplers taking it back), and the one coming rebounds a little */
function joltOff(tr,j){const J=tr.jolt,t=sim.t-J.t0;
  if(j<J.j0||j>J.j1)return t<0.6?-J.sg*0.035*Math.exp(-t/0.2)*Math.sin(PI*t/0.22):0;
  const k=J.sg<0?j-J.j0:J.j1-j,u=t-0.11*k;if(u<=0)return 0;
  return J.sg*0.15*Math.pow(0.8,k)*Math.exp(-u/0.42)*Math.sin(PI*u/0.3);}
function setJolt(tr,j0,j1,sg){tr.jolt={t0:sim.t,j0:j0,j1:j1,sg:sg};}
/* a train or locomotive going to couple, and the train it goes to */
function cplTgt(tr){if(tr.phase!=='entrando')return null;let T=null;
  if(tr.acople&&tr.rescue&&(tr.acople.stage==='go'||tr.acople.stage==='man'))T=trById(tr.rescue.T);else if(tr.ttRod&&tr.ttRod.mv==='cpl')T=trById(tr.ttRod.T);
  return T&&T.spawned&&!T.done&&T.P?T:null;}
function cplS(tr,T){let best=null;[pathAt(T.P,T.s),pathAt(T.P,Math.max(0,T.s-T.len))].forEach(e=>{const s=sOfX(tr.P,e.x,e.t);if(s!==null&&s>tr.s-0.5&&(best===null||s<best))best=s;});return best;}
function trainAnchor(tr){if(!tr.spawned||tr.done)return null;const h=pathAt(tr.P,tr.s-Math.min(30,tr.len/2));if(h.x<X0+2||h.x>X1-2)return null;return[h.x,5.2,h.z];}
function trainBB(tr){
  if(!tr.spawned||tr.done)return null;let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
  tr.cars.forEach(c=>{const p=c.g.position;if(p.x<X0-10||p.x>X1+10)return;x0=Math.min(x0,p.x-c.L/2);x1=Math.max(x1,p.x+c.L/2);z0=Math.min(z0,p.z-1.6);z1=Math.max(z1,p.z+1.6);});
  if(x0>x1)return null;return[Math.max(X0,x0),0.8,z0,Math.min(X1,x1),5,z1];
}
function score(tr,at){tr.soDelay=at-tr.schedT;}
const _wp=new THREE.Vector3();
function openDoors(tr){
  const side=tr.stopTrack==='v2'?1:-1;tr.doorPts=[];
  const ry=tr.cars[0].g.rotation.y,useA=(-Math.sin(ry))*side>0;
  (useA?tr.doorA:tr.doorB).color.setHex(DOOR_O);
  tr.cars.forEach(c=>{if(!c.leaves)return;c.g.updateMatrixWorld(true);c.leaves.forEach(m=>{m.getWorldPosition(_wp);const faces=(_wp.z-c.g.position.z)>0?1:-1;m.userData.door.open=(faces===side)?1:0;});});
  tr.cars.forEach(c=>{const r=c.g.rotation.y,ax=Math.sin(r),az=Math.cos(r);
    (c.doorZ||[c.L/2-5.4,-(c.L/2-5.4)]).forEach(o=>{tr.doorPts.push({x:c.g.position.x+ax*o,z:c.g.position.z+az*o+side*1.85,side:side});});});
  if(tr.alightQ){tr.alightQ=tr.alightQ.filter(e=>{const P=GENTE[e.pid];return P.st!=='casa'&&P.st!=='visita'&&!(P.px&&P.px.on);});tr.alightN=tr.alightQ.length;}
  tr.doors='open';tr.alightLeft=tr.alightN;tr.alightTimer=0.8;tr.boardOpen=false;
}
function closeDoors(tr){
  tr.doorA.color.setHex(DOOR_C);tr.doorB.color.setHex(DOOR_C);tr.doors='closed';tr.boardOpen=false;
  tr.cars.forEach(c=>{if(c.leaves)c.leaves.forEach(m=>{m.userData.door.open=0;});});
  PAX.forEach(p=>{if(p.on&&p.train===tr&&p.state==='board'){p.state='come';const s=spotFor(tr);pathTo(p,s.x,s.z);}});
}
function leaveBehind(tr){
  let n=0,w=0,nx=null,rb=0,rn=null;
  PAX.forEach(p=>{if(p.on&&p.train===tr&&p.state!=='leave'){n++;const k=missedTrain(p,tr,true);if(k){w++;nx=k;}else if(p.rb){rb++;rn=p.rb;}}});
  if(n>0)toast(n+(n===1?' viajero se ha quedado':' viajeros se han quedado')+' en tierra · '+tr.label+
    (w?' · '+(w===n?'':w+' ')+'esperan al '+nx.svc.num+' de las '+fmtHM(tSched(nx)):'')+(n-w?' · '+(w?(n-w)+' ':'')+(n-w===1?'se vuelve':'se vuelven')+' a casa'+(rb?' ('+(rb===n-w?'':rb+' ')+(rb===1?'volverá':'volverán')+' para el de las '+fmtHM(rn.svc.arr)+')':''):''));
}
/* a 10000 livery is 2048×1024 (≈11 MB on the graphics card): let it go 90 s after the last car wearing it has left */
function rel10k(c){const T=c.k10&&TEX10K[c.k10];if(!T)return;T.n=Math.max(0,T.n-1);if(!T.n)T.free=performance.now()+90000;}
function sweep10k(now){Object.keys(TEX10K).forEach(k=>{const T=TEX10K[k];if(T.n||!T.free||now<T.free)return;
  T.tex.dispose();if(T.mat.emissiveMap)T.mat.emissiveMap.dispose();T.mat.dispose();const i=NIGHT.winMats.indexOf(T.mat);if(i>=0)NIGHT.winMats.splice(i,1);
  delete TEX10K[k];});}
function despawn(tr){
  tr.cars.forEach(c=>{rel10k(c);scene.remove(c.g);c.g.traverse(o=>{if(o.isMesh&&o.geometry&&!o.geometry.userData.keep)o.geometry.dispose();});if(c.pools)c.pools.forEach(p=>p.m.material.dispose());c.body.forEach(m=>{const i=PICK.indexOf(m);if(i>=0)PICK.splice(i,1);});});
  if(tr.frontMats){Object.values(tr.frontMats).forEach(m=>{if(m.map)m.map.dispose();m.dispose();});tr.frontMats=null;}
  tr.cars=[];tr.done=true;tr.phase='fin';
  if(tr.zone==='vis'){if(pathAt(tr.P,tr.s).t!==normTrack(tr.dir))tr.alt=sideOf(tr.dir,'out');else if(tr.alt)tr.alt=null;   // left by the other track
    tr.zone='out';tr.p=tr.dir*pathAt(tr.P,tr.s).x;tr.lv=tr.v;}
  ROUTES.slice().forEach(R=>{if(R.tr===tr)releaseRoute(R);});
  if(tr.work){tr.done=false;tr.spawned=false;tr.work.st='out';tr.routeIn=tr.routeOut=null;uiDirty=true;}   // the work train goes on along the line
  if(selId===tr.ent)select(null);
}
/* backing out of a dead-end track at 10 km/h at most (marcha de maniobras), then 20 s to change the direction of travel */
function startRetro(tr,rt){
  /* the path is rebuilt from the far end of the backing move to the buffer stop, so the train can run back along it */
  const h=pathAt(tr.P,tr.s),pts=rt.pts.slice().reverse().concat(walkCurrent(h.t,h.x,tr.dir));
  establish(tr,rt,'ret',rt.sig);
  const P=mkPath(pts);tr.P=P;tr.s=sOfX(P,h.x,h.t);if(tr.s===null)tr.s=P.len;afterPath(tr);
  const sw=Object.keys(rt.req).find(u=>SW_BY[u].legs.some(L=>L.br===tr.stopTrack));
  tr.retro={st:'mov',sT:sOfX(P,rt.retro.x,rt.retro.to),u:sw,t0:sim.t};tr.phase='retroceso';tr.v=0;tr.served=true;uiDirty=true;
}
function stepRetro(tr,dt){const r=tr.retro;
  if(r.st==='mov'){const d=tr.s-r.sT,vt=Math.min(10/3.6,Math.sqrt(Math.max(0,2*0.25*d)));
    if(tr.v<vt)tr.v=Math.min(vt,tr.v+0.2*dt);else tr.v=Math.max(vt,tr.v-0.5*dt);
    tr.s-=tr.v*dt;if(tr.s<=r.sT+0.05){tr.s=r.sT;tr.v=0;r.st='fin';r.t0=sim.t;
      const R=tr.routeRet;tr.routeRet=null;if(R)releaseRoute(R);
      const W=SW_BY[r.u];if(W&&W.reverse&&W.lockPos==null&&!ROUTES.some(o=>o.req[r.u]==='R')){W.reverse=false;setSwitchVis(W);}
      tr.stopX=null;repath(tr,true);refreshAspects();esqDirty=true;uiDirty=true;}}
  else if(r.st==='fin'&&sim.t-r.t0>=20){tr.retro=null;tr.phase='despachando';tr.t0=sim.t;uiDirty=true;}
  placeCars(tr);
}
/* ---- nothing ever runs into anything ----
   What a train has ahead on the board: the nearest point of another train's body that its own path runs into
   (centre lines closer than 1.4 m: it fouls the track). Under marcha a la vista (rebase, maniobras, socorro, fog)
   the driver stops short of it (25 m) and tells the station; with a clear signal the ASFA / the driver brakes
   in emergency, the train stops a few metres short and the responsable de circulación is dismissed. */
function socPair(a,b){return!!((a.rescue&&a.rescue.T===b.id)||(b.rescue&&b.rescue.T===a.id)||(a.ttRod&&a.ttRod.T===b.id)||(b.ttRod&&b.ttRod.T===a.id));}
function sightRun(tr){return!!((tr.mvR&&!tr.mvR.released)||tr.acople||tr.rescue||WX.fog>0.5||(tr.rbOk&&Object.keys(tr.rbOk).length)||(tr.rb&&Object.keys(tr.rb).length)||tr.mtOk);}
function obsAhead(tr,look){
  const B=[];TRAINS.forEach(o=>{if(o===tr||!o.spawned||o.done||o.zone!=='vis'||!o.P||socPair(tr,o))return;
    const b=subPts(o.P,Math.max(0,o.s-o.len),o.s);let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;b.forEach(q=>{x0=Math.min(x0,q.x);x1=Math.max(x1,q.x);z0=Math.min(z0,q.z);z1=Math.max(z1,q.z);});
    B.push({o:o,b:b,x0:x0-2,x1:x1+2,z0:z0-2,z1:z1+2});});
  if(!B.length)return null;
  const s1=Math.min(tr.P.len,tr.s+look);
  for(let s=tr.s+1;s<=s1;s+=2){const q=pathAt(tr.P,s);
    for(const K of B){if(q.x<K.x0||q.x>K.x1||q.z<K.z0||q.z>K.z1)continue;const b=K.b;
      for(let i=1;i<b.length;i++){const a=b[i-1],c=b[i],dx=c.x-a.x,dz=c.z-a.z,L2=dx*dx+dz*dz||1,k=clamp(((q.x-a.x)*dx+(q.z-a.z)*dz)/L2,0,1);
        if(Math.hypot(a.x+dx*k-q.x,a.z+dz*k-q.z)<1.4)return{s:s,o:K.o};}}}
  return null;}
function obsReport(tr){const O=tr.obs&&tr.obs.o;if(!O||tr.obsMsg===O.id||tr.rescue||tr.acople)return;tr.obsMsg=O.id;
  const gap=Math.max(5,Math.round((tr.obs.s-tr.s)/5)*5),v=vn(pathAt(tr.P,tr.s).t);
  telLog('in','Maquinista del '+tr.svc.num,'—','Detenido ante material parado en la vía '+v+', a unos '+gap+' metros. Es el '+O.svc.num+'. Espero instrucciones.');
  toast('Maquinista del '+tr.svc.num+': detenido ante el '+O.svc.num+' en la vía '+v+' · espera instrucciones');}
function gameOver(tr,O){if(GAME.over)return;GAME.over=true;const gap=Math.max(1,Math.round(tr.obs?tr.obs.s-tr.s:3)),v=vn(pathAt(tr.P,tr.s).t);
  telLog('in','Maquinista del '+tr.svc.num,'—','Frenado de urgencia: detenido a '+gap+' metros del '+(O?O.svc.num:'material')+', que ocupaba la vía '+v+'.');
  const st=stats,pct=st.trains?Math.round(100*st.onTime/st.trains):100;
  dlgOpen('<div class="mhd"><b>Te han despedido</b><span class="gt">'+esc(fechaDia(Math.floor(sim.t/86400)))+' · '+fmtHM(sim.t)+'</span></div>'+
    '<p class="mnote" style="margin:4px 0 10px;font-size:14px;color:var(--ink)">El '+esc(tr.label)+' ha tenido que frenar de urgencia y se ha detenido a '+gap+' metros del '+esc(O?O.label:'material')+', que ocupaba la vía '+v+'. No ha llegado a tocarlo, pero le habías dado paso hacia una vía ocupada.</p>'+
    '<p class="mnote" style="margin:0 0 12px">Renfe abre una investigación y te aparta del servicio con efecto inmediato. La partida termina aquí.</p>'+
    '<p class="mnote" style="margin:0 0 4px">'+st.trains+' trenes despachados · '+pct+' % puntuales · '+(st.paxIn+st.paxOut)+' viajeros</p>'+
    '<div class="gd-a"><button class="btn primary" data-d="quit">Volver al menú</button></div>');
  sim.paused=true;GAME.dlgPaused=false;document.getElementById('pause').setAttribute('aria-pressed','true');}
function stepTrain(tr,dt){
  if(tr.phase==='retroceso'&&tr.retro){stepRetro(tr,dt);return;}
  let lim=tr.P.len-2,by=null;
  for(const g of tr.sigs){if(g.passed)continue;const rbA=g.sig.aspect==='rebase'&&!(tr.rbOk&&tr.rbOk[g.sig.id]);
    if((g.sig.aspect==='parada'&&!mayPass(tr,g.sig))||rbA){
      if((tr.shunt||tr.ttRod)&&tr.phase==='entrando'&&tr.stopS!==null&&!tr.served&&tr.stopS<g.s-1)break;   // a maniobra may stop right up to the signal
      if(g.s-7<lim){lim=g.s-7;by=g.sig;}break;}}
  const CT=cplTgt(tr);if(CT){const cs=cplS(tr,CT);if(cs!==null)tr.stopS=cs;}   // coupling: the stop is the contact
  let atStop=false;
  if(tr.stopS!==null&&!tr.served&&tr.stopS<=lim){lim=tr.stopS;by=null;atStop=true;}
  /* a level crossing without protection: the driver stops before it and crosses once he sees it safe (RGC art. 336) */
  if(PN.fault&&!PN.fault.guard&&tr.pnOK!==PN.fault.id){let sp=sOfX(tr.P,PN.x,'v1');if(sp===null)sp=sOfX(tr.P,PN.x,'v2');
    if(sp!==null&&sp-14>tr.s-1&&sp-14<lim){lim=sp-14;by=null;atStop=false;tr.pnAt=sp-14;}else tr.pnAt=null;}
  tr.obsT=(tr.obsT||0)-dt;if(tr.obsT<=0){tr.obsT=0.25;tr.obs=obsAhead(tr,Math.min(450,Math.max(80,tr.v*tr.v/(2*tr.ty.b)+80)));}
  let emerg=false,obsLim=false;
  if(tr.obs&&!GAME.over){const O=tr.obs;
    if(sightRun(tr)){const st=O.s-25;if(st<lim){lim=Math.max(tr.s,st);by=null;atStop=false;obsLim=true;}}
    else if(O.s-8<lim&&O.s-tr.s-tr.v*tr.v/(2*tr.ty.b)<40){lim=Math.max(tr.s,O.s-6);by=null;atStop=false;emerg=true;}}
  if(!tr.obs)tr.obsMsg=null;
  let vt=vEff(tr);
  for(const iv of tr.div){if(iv[1]<tr.s-tr.len)continue;if(iv[0]<=tr.s){vt=Math.min(vt,V_DIV);continue;}vt=Math.min(vt,Math.sqrt(V_DIV*V_DIV+2*tr.ty.b*(iv[0]-tr.s)));break;}
  const dist=lim-tr.s;
  vt=Math.min(vt,Math.sqrt(Math.max(0,2*tr.ty.b*dist)));
  if(CT&&atStop){if(dist<12)vt=Math.min(vt,0.85);if(dist>0.03)vt=Math.max(vt,0.4);}   // the last metres at a walking pace, and it touches at ~1.5 km/h
  if(tr.mvR&&!tr.mvR.released)vt=Math.min(vt,30/3.6);   // marcha a la vista after an authorised rebase
  if(tr.acople)vt=Math.min(vt,socCap(tr));
  if(tr.shunt)vt=Math.min(vt,10/3.6);
  if(tr.ttRod)vt=Math.min(vt,30/3.6);
  if(tr.hold||tr.stall)vt=0;
  const acc=accEff(tr);
  if(tr.v<vt){if(acc>0)tr.v=Math.min(vt,tr.v+acc*dt);else tr.v=Math.max(0,tr.v-0.03*dt);}else tr.v=Math.max(vt,tr.v-tr.ty.b*2.6*dt);
  if(emerg){const d=Math.max(0.3,lim-tr.s),a=Math.max(1.4,tr.v*tr.v/(2*d));tr.v=Math.max(0,tr.v-a*dt);if(!tr.emerg)tr.emerg={o:tr.obs.o.id};}
  tr.s+=tr.v*dt;excuse(tr,dt,tr.v>1);
  const B=LINE.blk[tr.dir];if((B===FAULT_OCC||B===CUT_OCC||(B&&(B.inc||B.stall)))&&by&&by.kind==='salida'&&tr.v<0.5)tr.exc=(tr.exc||0)+dt;
  if(tr.s>=lim-0.25&&tr.v<0.9){tr.s=Math.min(Math.max(tr.s,lim-0.25),lim);if(lim-tr.s<0.3)tr.v=0;}
  if(tr.s>lim){tr.s=lim;tr.v=0;}
  tr.blockedBy=(by&&tr.v<0.3&&lim-tr.s<4)?by:null;
  if(tr.emerg&&tr.v===0&&!GAME.over){gameOver(tr,trById(tr.emerg.o));return;}
  if(obsLim&&tr.v===0&&lim-tr.s<1){tr.obsW=(tr.obsW||0)+dt;if(tr.obsW>3)obsReport(tr);}else tr.obsW=0;
  /* rebase autorizado (red and white): stopped in front of it, the driver goes on in marcha de maniobras (RGC art. 218) */
  if(by&&by.aspect==='rebase'&&tr.v===0&&lim-tr.s<1){tr.rbW=(tr.rbW||0)+dt;if(tr.rbW>=5){(tr.rbOk||(tr.rbOk={}))[by.id]=1;tr.rbW=0;}}
  if(tr.pnAt!=null&&tr.v===0&&Math.abs(tr.s-tr.pnAt)<1.5){tr.pnW=(tr.pnW||0)+dt;tr.exc=(tr.exc||0)+dt;if(tr.pnW>15){tr.pnOK=PN.fault.id;tr.pnW=0;tr.pnAt=null;}}
  incTrainExc(tr,dt);
  // signals passed by the head
  for(const g of tr.sigs){if(!g.passed&&tr.s>g.s){g.passed=true;
    const R=ROUTES.find(r=>r.tr===tr&&r.sig===g.sig&&!r.passed);
    if(R){if(R.kind==='out'&&g.sig.aspect==='parada')R.rbAuth=true;R.passed=true;refreshAspects();if(R.kind==='in')tr.phase=tr.stopTrack?'entrando':'pasando';incPassSig(tr,R);}   // (passed at stop: with an authorisation)
    else if(INNER[g.sig.kind]){if(tr.rb&&tr.rb[g.sig.id])delete tr.rb[g.sig.id];refreshAspects();}
    else if(g.sig.aspect==='rebase'&&(tr.ttRod||tr.work))refreshAspects();}}
  // route release once the tail clears the last switch
  if(ROUTES.length){const tx=pathAt(tr.P,tr.s-tr.len).x;
    ROUTES.slice().forEach(R=>{if(R.tr===tr&&R.passed&&(tx-R.releaseX)*tr.dir>3)releaseRoute(R);});}
  // stops
  if(atStop&&tr.v===0&&Math.abs(tr.s-tr.stopS)<0.6&&!tr.served&&tr.phase==='entrando'){
    tr.arrT=sim.t;if(tr.svc.type==='md'&&!tr.oos&&!tr.towed&&PLAT[tr.stopTrack]){tr.phase='parado';tr.t0=sim.t;}else{tr.phase='apartado';toast(tr.label+' apartado en vía '+vn(tr.stopTrack));}
    incOnStop(tr);if(tr.acople)socOnStop(tr);if(tr.ttRod)ttRodStop(tr);
  }
  if(tr.phase==='parado'&&sim.t-tr.t0>5){tr.phase='puertas';openDoors(tr);}
  if(tr.phase==='puertas'){
    if(tr.alightLeft>0){tr.alightTimer-=dt;if(tr.alightTimer<=0){tr.alightTimer=0.55+Math.random()*0.7;tr.alightLeft--;tr.alighted++;spawnLeaver(tr.doorPts[Math.floor(Math.random()*tr.doorPts.length)],tr);}}
    else if(!tr.boardOpen){tr.boardOpen=true;}
  }
  if(tr.phase==='cerrando'&&sim.t-tr.t0>4&&!tr.doorFault){tr.phase='listo';}
  if(tr.phase==='despachando'&&sim.t-tr.t0>4){tr.phase='saliendo';tr.served=true;tr.depT=sim.t;score(tr,sim.t);if(tr.svc.type==='md'&&!tr.towed)leaveBehind(tr);
    if(tr.rescInc){const i=INC.list.find(x=>x.id===tr.rescInc);tr.rescInc=null;if(i)incEnd(i,true);}}
  const h=pathAt(tr.P,tr.s);
  if(tr.phase==='pasando'&&!tr.passT&&h.x*tr.dir>=0){tr.passT=sim.t;score(tr,sim.t);}
  if(h.x*tr.dir>X1+tr.len+60){despawn(tr);return;}
  placeCars(tr);
}


/* ---- the line beyond the board: block sections, the CTC at the neighbouring stations, storm faults ---- */
const FAULT_OCC={label:'un fallo de circuito de vía'},CUT_OCC={label:'el corte por trabajos'};
const fAct=f=>sim.t>=(f.from||0)&&sim.t<f.until;
function ltvCap(dir,zone){let v=Infinity;for(const f of LINE.faults)if(f.kind==='ltv'&&f.dir===dir&&f.zone===zone&&fAct(f))v=Math.min(v,f.v);return v;}
const cantonIn=x=>Math.floor(x/LINE.C)*LINE.C;
const cantonOut=x=>x<LINE.OB1?0:LINE.OB1+Math.floor((x-LINE.OB1)/LINE.C)*LINE.C;
const PERM=f=>f.kind==='cv'||!f.kind;          // intermediate block signal held at stop by a track circuit
function permStep(t,h,lim){const f=faultLim.f;if(!f||!PERM(f)||!f.uid||t.lv>0.05||t.p<lim-2)return;
  t.pw=(t.pw||0)+h;if(t.pw>=20){t.rbF=t.rbF||{};t.rbF[f.uid]=1;t.pw=0;}}       // after the stop it goes on a la vista
function permCap(t,dir,zone){if(!t.rbF)return Infinity;for(const f of LINE.faults)if(PERM(f)&&f.uid&&t.rbF[f.uid]&&f.dir===dir&&f.zone===zone&&t.p>=f.a-30&&t.p<f.a+LINE.C)return 30/3.6;return Infinity;}
function faultLim(dir,zone,p,t){let lim=Infinity;faultLim.f=null;for(const f of LINE.faults)if(f.kind!=='ltv'&&f.dir===dir&&f.zone===zone&&fAct(f)&&f.a>p-1&&!(t&&t.rbF&&t.rbF[f.uid])&&f.a<lim){lim=f.a;faultLim.f=f;}return lim;}
/* time lost to the weather or to faults is not charged to the player: running under the fog limit, without
   catenary voltage, held by a lightning fault or by a frozen switch */
function excuse(t,h,moving){const vm=t.ty.vmax,ve=vEff(t);
  if(moving&&ve<vm)t.exc=(t.exc||0)+h*(1-ve/vm);if(sim.t<LINE.powerUntil&&moving)t.exc=(t.exc||0)+h;}
function kinLine(t,lim,h,cap){const b=t.ty.b,a=accEff(t),vt=Math.min(vEff(t),cap||Infinity,Math.sqrt(Math.max(0,2*b*(lim-t.p))));
  if(t.lv<vt){t.lv=a>0?Math.min(vt,t.lv+a*h):Math.max(0,t.lv-0.03*h);}else t.lv=Math.max(vt,t.lv-b*1.5*h);
  t.p+=t.lv*h;if(t.p>lim){t.p=lim;t.lv=0;}}
/* who holds the first outbound section (from the exit signal to 2.3 km out) */
function blockOcc(dir){
  for(const t of TRAINS){if(t.dir!==dir)continue;
    if(t.zone==='out'&&!t.alt&&t.p-t.len<LINE.OB1)return t;
    if(t.zone==='vis'&&t.routeOut&&t.routeOut.passed&&!wrongExit(t.routeOut))return t;}
  {const s=sideOf(dir,'out'),o=TRAINS.find(t=>{const L=t.dir===-dir&&lineAt(t);return L&&L.alt===s&&L.zone==='in';});if(o)return o;}   // one coming the other way on it (also one already at the entry)
  const f=LINE.faults.find(f=>f.kind!=='ltv'&&f.dir===dir&&f.zone==='out'&&f.a===0&&fAct(f));if(!f)return null;
  if(f.inc){if(!f.occ)f.occ={label:f.inc.title.split(' · ')[0].toLowerCase(),inc:f.inc};return f.occ;}return f.kind==='corte'?CUT_OCC:FAULT_OCC;
}
function etaSO(tr){const S=LINE.side[tr.dir];
  if(tr.zone==='in')return(S.Lin-tr.p)/Math.max(vEff(tr)*0.92,1);
  return Math.max(0,tr.tReady-sim.t)+runT(tr.ty,S.Lin,tr.md,tr.stops);}
function arriveNext(t){
  const S=LINE.side[t.dir],d=sim.t-t.tNext,caused=Math.max(0,Math.min(d,Math.max(0,d-(t.entryDelay||0)-(t.exc||0))+(t.chg||0)));
  t.zone='end';t.tEnd=sim.t;t.finalDelay=d;t.caused=caused;if(t.noScore){uiDirty=true;return;}stats.trains++;if(caused<=60)stats.onTime++;stats.caused+=caused;uiDirty=true;
  if(caused>=600)anota('L','Retraso de '+Math.round(caused/60)+'′ al '+t.svc.num+' imputable a la estación');
  if(caused>=120)toast(t.label+' llega a '+S.next+' con +'+Math.round(d/60)+'′ · '+Math.round(caused/60)+'′ generados en tu tramo');
  incArrive(t);
}
function stormEvent(){
  const dir=Math.random()<0.5?1:-1,S=LINE.side[dir];
  if(Math.random()<0.6){
    const zone=Math.random()<0.5?'in':'out',top=zone==='in'?S.Lin-OFF:S.Lout;
    const opts=[];if(zone==='in'){for(let a=0;a<top-200;a+=LINE.C)opts.push(a);}else{opts.push(0);for(let a=LINE.OB1;a<top-200;a+=LINE.C)opts.push(a);}
    const a=opts[Math.floor(Math.random()*opts.length)],dur=(6+Math.random()*8)*60;
    LINE.faults.push({dir:dir,zone:zone,a:a,until:sim.t+dur,uid:'w'+Math.floor(Math.random()*1e9)});
    toast(('⚡ Rayo: fallo de circuito de vía entre '+NIVEL.nombre+' y ')+(zone==='in'?S.prev:S.next)+' · la señal de bloqueo queda en parada unos '+Math.round(dur/60)+'′ (los trenes paran y siguen a la vista)');
  }else{const dur=(2+Math.random()*4)*60;LINE.powerUntil=Math.max(LINE.powerUntil,sim.t+dur);
    toast('⚡ Falta de tensión en la catenaria · los trenes se quedan sin tracción unos '+Math.round(dur/60)+'′');}
  uiDirty=true;
}
function lineStep(h){
  let changed=false;
  if(WX.storm>0.5&&Math.random()<h*WX.storm/(20*60))stormEvent();
  LINE.faults=LINE.faults.filter(f=>sim.t<f.until);
  [1,-1].forEach(dir=>{
    const S=LINE.side[dir],Hp=S.Lin-OFF;
    const inq=TRAINS.filter(t=>t.dir===dir&&t.zone==='in').sort((a,b)=>b.p-a.p);
    /* previous station (CTC): first come first served once the first section is clear, the faster train first,
       and a slower passenger train is held there if a faster one due soon would catch it before Santa Olalla. Freights
       are not held: the overtaking is done at Santa Olalla, which has the sidings, and it is the player's job */
    /* BAB: the habitual track, or the other one if that is closed; never against a train coming the other way or a
       route already set from Santa Olalla onto that track (art. 402) */
    const sIn=sideOf(dir,'in'),useAlt=closedTrack(sIn,dir,true)&&!closedTrack(sIn,-dir,true),lastT=inq.filter(t=>!!t.alt===useAlt).pop();
    const opp=useAlt?(onTrack(sIn,-dir).some(t=>t.dir===-dir)||ROUTES.some(R=>!R.passed&&R.kind==='out'&&R.tr.dir===-dir&&!wrongExit(R)))
                    :(onTrack(sIn,dir).some(t=>t.dir===-dir)||ROUTES.some(R=>!R.passed&&R.kind==='out'&&R.tr.dir===-dir&&wrongExit(R)));
    TRAINS.forEach(t=>{if(t.dir===dir&&t.zone==='pre')setEntry(t,useAlt?normTrack(-dir):normTrack(dir));});
    if(!opp&&(!lastT||lastT.p-lastT.len>=LINE.C)&&(useAlt||faultLim(dir,'in',-1)>=LINE.C)){
      const ready=TRAINS.filter(t=>t.dir===dir&&t.zone==='pre'&&sim.t>=t.tReady&&!(t.rescue&&t.rescue.mode==='lineBack'));
      if(ready.length){ready.sort((a,b)=>b.ty.vmax-a.ty.vmax||a.tReady-b.tReady);const c=ready[0];
        const faster=!c.svc.apt&&c.svc.type!=='merc'&&TRAINS.find(t=>t.dir===dir&&t.zone==='pre'&&t!==c&&t.ty.vmax>c.ty.vmax+3&&t.tReady>sim.t&&t.tReady<sim.t+S.Lin/c.ty.vmax-S.Lin/t.ty.vmax+180);
        if(!faster&&incGateIn(dir,c)){if(useAlt)c.alt=sIn;c.zone='in';c.p=0;c.lv=c.md?0:vEff(c);c.tEnter=sim.t;c.entryDelay=Math.max(0,sim.t-c.tPrev);inq.push(c);uiDirty=true;}}}
    socLineEnter(dir,inq);
    /* inbound sections; the last one is the approach on the board */
    let visBusy=TRAINS.some(o=>o.zone==='vis'&&o.dir===dir&&o.phase==='aprox');
    inq.forEach((t,i)=>{
      if(t.work){ttLine(t,h);return;}
      if(t.rescue&&t.rescue.mode==='lineBack'){socLineBack(t,h);return;}
      let lim=visBusy?Hp:Infinity,behind=null;
      if(i>0){const L=inq.slice(0,i).reverse().find(o=>!!o.alt===!!t.alt);if(L&&L.zone==='in'){lim=Math.min(Hp,cantonIn(L.p-L.len));behind=L;}}   // the one in front on the same track
      const fi=t.alt?Infinity:faultLim(dir,'in',t.p,t);if(fi<lim){lim=fi;behind=null;const F=faultLim.f;permStep(t,h,fi);if(!(F&&F.inc&&overdue(F.inc,t)))t.exc=(t.exc||0)+h*(1-t.lv/vEff(t));}
      if(t.stall)lim=Math.min(lim,Math.max(t.p,t.stallP||0));
      else if(behind&&(behind.stall||behind.vcapBy)&&t.lv<vEff(t)*0.9)t.exc=(t.exc||0)+h*(1-t.lv/vEff(t));
      const ci=Math.min(t.alt?Infinity:Math.min(ltvCap(dir,'in'),permCap(t,dir,'in')),incCap(t));kinLine(t,lim,h,ci);excuse(t,h,true);incExc(t,h);if(ci<vEff(t))t.exc=(t.exc||0)+h*(1-ci/vEff(t));
      if(t.p>=Hp-0.01&&!visBusy&&!ttRodHold(t)){spawnTrain(t);visBusy=true;uiDirty=true;}
    });
    /* outbound sections to the next station; regionals stop there */
    const outq=TRAINS.filter(t=>t.dir===dir&&t.zone==='out').sort((a,b)=>b.p-a.p);
    outq.forEach((t,i)=>{
      if(t.work){ttLine(t,h);return;}
      if(t.rescue&&t.rescue.mode==='lineFront'){socLineFront(t,h);return;}
      let lim=t.md?S.Lout:Infinity,behind=null;
      if(i>0){const L=outq.slice(0,i).reverse().find(o=>!!o.alt===!!t.alt);const cs=L?cantonOut(L.p-L.len):0;if(cs>0&&cs<lim){lim=cs;behind=L;}}
      const fo=t.alt?Infinity:faultLim(dir,'out',t.p,t);if(fo<lim){lim=fo;behind=null;const F=faultLim.f;permStep(t,h,fo);if(!(F&&F.inc&&overdue(F.inc,t)))t.exc=(t.exc||0)+h*(1-t.lv/vEff(t));}
      if(t.stall)lim=Math.min(lim,Math.max(t.p,t.stallP||0));
      else if(behind&&(behind.stall||behind.vcapBy)&&t.lv<vEff(t)*0.9)t.exc=(t.exc||0)+h*(1-t.lv/vEff(t));
      const co=Math.min(t.alt?Infinity:Math.min(ltvCap(dir,'out'),permCap(t,dir,'out')),incCap(t));kinLine(t,lim,h,co);excuse(t,h,true);incExc(t,h);if(co<vEff(t))t.exc=(t.exc||0)+h*(1-co/vEff(t));
      if(t.p>=S.Lout-0.5)arriveNext(t);
    });
    const b=blockOcc(dir);if(b!==LINE.blk[dir]){LINE.blk[dir]=b;changed=true;}
  });
  if(changed)refreshAspects();
}
/* the next day's timetable a few hours ahead; finished trains are dropped after an hour */
function lineDay(){
  {const dn=Math.floor(sim.t/86400);if(dn>CAR.d)jornadaFin(dn);}   // midnight: the jornada closes with its hoja de servicio
  if(sim.t>(LINE.day+1)*86400-3*3600)makeDay(LINE.day+1);
  for(let i=TRAINS.length-1;i>=0;i--){const t=TRAINS[i];if(t.zone==='end'&&sim.t-t.tEnd>3600&&selId!==t.ent&&hoverId!==t.ent){delete ENT[t.ent];TRAINS.splice(i,1);}}
}
/* snow: a switch that has to move may not lock (frozen points) until its heater frees it */
function freezeCheck(res,tr){
  if(!res||WX.acc<0.35)return false;
  for(const u in res.req){const S=SW_BY[u],want=res.req[u]==='R';
    const nc=S.cal===false;   // without a point heater it freezes more easily and someone has to clear it by hand
    if(S.reverse!==want&&Math.random()<(nc?0.6:0.3)*WX.acc){S.frozenUntil=sim.t+(nc?12+Math.random()*13:3+Math.random()*6)*60;if(tr)tr.exc=(tr.exc||0)+(S.frozenUntil-sim.t);
      if(nc)crewIce(S);
      toast('❄ '+S.name+' no comprueba: aguja helada · '+(nc?'sin calentador, un agente la limpia a mano':'calefactor en marcha')+' ('+Math.ceil((S.frozenUntil-sim.t)/60)+'′)');uiDirty=true;return true;}}
  return false;
}


/* ---------------------------------------------------------------------
   Puesto de Mando (CTC): orders and notices to the station
   - overtakes: a freight about to leave the previous station, or already on its way, that a faster train would catch
     before the next station
     → order to put it in vía 3 or 4 (met when the fast train passes first, failed if the freight leaves ahead)
   - platform changes for two regionals a day (works on a platform), 25 min ahead → order to receive it on vía 3
   - late passenger trains leaving the previous station (notice)
   - planned works: a 12–20 min closure of one exit section, announced 15 min ahead, and a 30 km/h
     temporary speed limit on one section (notices; the time they cost is not charged to the player)
   --------------------------------------------------------------------- */
const CTC={msgs:[],seq:0,unread:0,tab:'tr',next:0,seen:{},plan:{},planned:{},ev:[]};
let ctcDirty=true;
const trById=id=>TRAINS.find(t=>t.id===id);
function ctcPost(m){autoPing();m.id=++CTC.seq;m.t=sim.t;m.state=m.order?'pending':'info';CTC.msgs.unshift(m);if(CTC.msgs.length>60)CTC.msgs.length=60;
  if(CTC.tab!=='ctc')CTC.unread++;toast('CTC · '+m.short);ctcDirty=true;uiDirty=true;}
function ctcResolve(m,ok,note){m.state=ok?'ok':'fail';m.note=note||'';if(ok)stats.ordOk++;else{stats.ordFail++;anota('L','Orden del Puesto de Mando no cumplida: '+m.short);toast('CTC · orden no cumplida: '+m.short);}ctcDirty=true;uiDirty=true;}
function passedSO(t){return t.zone==='out'||t.zone==='end'||(t.zone==='vis'&&(t.phase==='pasando'||t.phase==='saliendo')&&t.dir*pathAt(t.P,t.s).x>95);}
/* when a train will leave Santa Olalla if nobody holds it (regionals keep their departure time) */
function tLeave(t){const a=sim.t+etaSO(t);return t.md?Math.max(t.svc.dep,a+60):a;}
function ctcPlanDay(d){
  CTC.planned[d]=1;const base=d*86400,rnd=(a,b)=>a+(b-a)*Math.random(),hm=t=>fmtHM(t);
  // two regionals received on another track
  const mds=TRAINS.filter(t=>t.md&&t.svc.day===d&&t.zone==='pre');for(let k=0;k<2&&mds.length;k++){const t=mds.splice(Math.floor(Math.random()*mds.length),1)[0];CTC.plan[t.id]='v3';}
  // a works closure of one exit section and a temporary speed limit, in the daytime
  const dir=Math.random()<0.5?1:-1,S=LINE.side[dir],from=base+rnd(10,17.5)*3600,until=from+rnd(12,20)*60;
  if(from>sim.t+20*60)CTC.ev.push({at:from-15*60,post:{kind:'aviso',short:'corte hacia '+S.next+' a las '+hm(from),
    text:'Intervalo de corte de tensión por trabajos de catenaria en la '+viaN(dir)+(' entre '+NIVEL.nombre+' y ')+S.next+' de '+hm(from)+' a '+hm(until)+' (RGC art. 341). Mantengan la circulación hacia '+S.next+' por la '+viaN(-dir)+'.'},
    fault:{dir:dir,zone:'out',a:0,from:from,until:until,kind:'corte'}},{at:until,post:{kind:'aviso',short:'fin del corte hacia '+S.next,text:'Terminados los trabajos en la '+viaN(dir)+': restablecida la tensión hacia '+S.next+'.'}});
  const d2=Math.random()<0.5?1:-1,z2=Math.random()<0.5?'in':'out',S2=LINE.side[d2],f2=base+rnd(9,19)*3600,u2=f2+rnd(20,40)*60;
  if(f2>sim.t+10*60)CTC.ev.push({at:f2,post:{kind:'aviso',short:'limitación a 30 km/h',
    text:('Limitación temporal de velocidad a 30 km/h entre '+NIVEL.nombre+' y ')+(z2==='out'?S2.next:S2.prev)+' para los trenes '+(d2>0?'pares':'impares')+' hasta las '+hm(u2)+' (trabajos de vía).'},
    fault:{dir:d2,zone:z2,from:f2,until:u2,kind:'ltv',v:30/3.6}});
}
function ctcStep(){
  if(sim.t<CTC.next)return;CTC.next=sim.t+15;
  const d=Math.floor(sim.t/86400);[d,d+1].forEach(k=>{if(!CTC.planned[k]&&TRAINS.some(t=>t.svc.day===k))ctcPlanDay(k);});
  CTC.ev=CTC.ev.filter(e=>{if(sim.t<e.at)return true;if(e.fault){LINE.faults.push(e.fault);if(e.fault.kind==='ltv'&&e.fault.zone==='out')incLTV(e.fault,'trabajos de vía');}if(e.post)ctcPost(Object.assign({},e.post));return false;});
  const SD=LINE.side;
  TRAINS.forEach(t=>{
    if(t.svc.type!=='merc'&&!t.work&&t.zone==='in'&&!CTC.seen['late'+t.id]&&(t.entryDelay||0)>=180){CTC.seen['late'+t.id]=1;
      ctcPost({kind:'aviso',tr:[t.id],short:t.label+' viene con +'+Math.round(t.entryDelay/60)+'′',
        text:'El '+t.label+' ('+t.svc.from+' → '+t.svc.to+') ha salido de '+SD[t.dir].prev+' con '+Math.round(t.entryDelay/60)+' minutos de retraso.'});}
    if(t.md&&(t.zone==='pre'||t.zone==='in')&&etaSO(t)<25*60&&CTC.plan[t.id]&&!CTC.seen['pl'+t.id]){CTC.seen['pl'+t.id]=1;const q=CTC.plan[t.id];
      /* not when that track is already spoken for: a freight to be stepped aside, a train out of order or one in it */
      if(CTC.msgs.some(m=>m.state==='pending'&&m.type==='ov'&&trById(m.s)&&trById(m.s).dir===t.dir)||TRAINS.some(o=>o!==t&&!o.done&&(o.stopTrack===q||((o.mustStop||o.oos)&&o.dir===t.dir)))){delete CTC.plan[t.id];return;}
      ctcPost({kind:'orden',order:true,type:'pl',tr:[t.id],s:t.id,req:q,deadline:sim.t+etaSO(t),short:'recibe el '+t.svc.num+' por vía '+vn(q),
        text:(t.dir>0?'Obras en el andén '+PLAT[normTrack(1)]:'Trabajos en la vía '+vn(normTrack(-1))+' junto al andén')+': recibe el '+t.label+' por vía '+vn(q)+' (andén central).'});}
  });
  [1,-1].forEach(dir=>{const S=SD[dir];
    TRAINS.filter(s=>s.dir===dir&&s.svc.type==='merc'&&(s.zone==='in'||(s.zone==='pre'&&sim.t>=s.tReady-180))&&!CTC.seen['ov'+s.id]&&!(s.routeIn&&(s.stopTrack==='v3'||s.stopTrack==='v5'))).forEach(s=>{
      const tS=sim.t+etaSO(s),sArr=tS+S.Lout/vEff(s);
      const c=TRAINS.filter(o=>o.dir===dir&&o.svc.type!=='merc'&&o.svc.type!=='socorro'&&!o.work&&!o.towed&&(o.zone==='pre'||o.zone==='in')).map(o=>({o:o,tf:tLeave(o)})).filter(x=>x.tf>tS-30).sort((a,b)=>a.tf-b.tf)[0];
      if(!c||c.tf+S.Lout/vEff(c.o)>=sArr+90)return;
      CTC.seen['ov'+s.id]=1;
      const thru=s.routeIn&&!s.stopTrack&&!s.routeIn.passed;
      const lateF=Math.round(Math.max(0,c.tf-tSched(c.o))/60);
      ctcPost({kind:'orden',order:true,type:'ov',tr:[s.id,c.o.id],s:s.id,f:c.o.id,deadline:c.tf,tS:tS,short:'aparta el '+s.svc.num+' para el '+c.o.svc.num,
        text:'Aparta el '+s.label+' en '+apTxt(s)+' y da paso al '+c.o.label+(lateF>=3&&!s.svc.apt?', que viene con +'+lateF+'′':'')+(s.svc.apt?' (adelantamiento previsto en horario)':'')+'. Si sale delante, el '+c.o.svc.num+' le alcanzaría antes de '+S.next+'.'+(thru?' Anula antes su itinerario de paso.':'')});
      /* an earlier order to receive the fast train in vía 3 can no longer be kept: it is withdrawn */
      CTC.msgs.filter(m=>m.state==='pending'&&m.type==='pl'&&m.s===c.o.id).forEach(m=>{m.state='info';delete CTC.plan[c.o.id];
        ctcPost({kind:'aviso',tr:[c.o.id],short:'sin efecto: '+c.o.svc.num+' por vía '+vn(m.req),text:'Queda sin efecto la orden de recibir el '+c.o.label+' por vía '+vn(m.req)+': esa vía es para apartar el '+s.label+'. Recíbelo por su vía.'});});});});
  /* the reverse: a freight booked to wait in the siding for a fast train that now comes so late that the freight can
     leave first and be at the next station well before it would be caught: the Puesto de Mando changes the order */
  [1,-1].forEach(dir=>{const S=SD[dir];
    TRAINS.filter(s=>s.dir===dir&&s.svc.type==='merc'&&s.svc.apt&&s.phase==='apartado'&&!s.stall&&!s.routeOut&&!CTC.seen['sx'+s.id]&&sim.t<s.svc.dep-120&&!ovFor(s)).forEach(s=>{
      const f=TRAINS.filter(o=>o.dir===dir&&o.svc.type!=='merc'&&o.svc.type!=='socorro'&&!o.work&&!o.towed&&!passedSO(o)&&tSched(o)>=s.svc.arr-60&&tSched(o)<=s.svc.dep+300).sort((a,b)=>tSched(a)-tSched(b))[0];
      if(!f)return;const tf=tLeave(f),late=tf-tSched(f);if(late<5*60)return;
      const sArr=sim.t+90+S.Lout/vEff(s),fArr=tf+S.Lout/vEff(f);if(fArr<sArr+180)return;
      CTC.seen['sx'+s.id]=1;const lm=Math.round(late/60);
      ctcPost({kind:'orden',order:true,type:'sx',tr:[s.id,f.id],s:s.id,f:f.id,deadline:sim.t+8*60,short:'da salida ya al '+s.svc.num+' (el '+f.svc.num+' viene con +'+lm+'′)',
        text:'El '+f.label+' viene con '+lm+' minutos de retraso: no esperes al adelantamiento. Da salida ya al '+s.label+'; llegará a '+S.next+' antes de que lo alcance.'});});});
  CTC.msgs.forEach(m=>{if(m.state!=='pending')return;
    if(m.type==='sx'){const s=trById(m.s),f=trById(m.f);if(!s||!f){m.state='info';return;}
      if(s.routeOut&&!passedSO(f))ctcResolve(m,true,'');
      else if(passedSO(f)||sim.t>m.deadline)ctcResolve(m,false,'El '+s.svc.num+' sigue apartado.');return;}
    if(m.type==='ov'){const s=trById(m.s),f=trById(m.f);if(!s||!f){m.state='info';return;}
      if(passedSO(s)&&!passedSO(f))ctcResolve(m,false,'El '+s.svc.num+' ha salido delante del '+f.svc.num+'.');
      else if(passedSO(f)){ctcResolve(m,true,'Ya ha pasado el '+f.svc.num+': el '+s.svc.num+' puede salir detrás.');
        if(!s.svc.apt)s.exc=(s.exc||0)+Math.max(0,sim.t-m.tS)+150;}}   // the wait the CTC ordered is not the player's delay
    else if(m.type==='pl'){const t=trById(m.s);if(!t){m.state='info';return;}
      if(t.routeIn)ctcResolve(m,t.stopTrack===m.req,t.stopTrack===m.req?'':'Lo has recibido por vía '+vn(t.stopTrack)+'.');
      else if(passedSO(t))ctcResolve(m,false,'');}});
}


/* =====================================================================
   24b. Incidencias
   Catálogo del CGO filtrado para una estación pequeña de vía doble con bloqueo automático. Unas piden una
   decisión, otras una solución (mandar a alguien a hacer algo) y otras telefonemas reglamentarios con las
   estaciones colaterales, los maquinistas o el telemando de energía. El tiempo que cuestan no se carga al
   jugador, salvo el que tarda en atender lo que le toca (más de 90 s con un telefonema o una solución pendientes).
   ===================================================================== */
var INC={list:[],hist:[],seq:0,needs:[],nseq:0,next:0,tick:0,auto:true,mean:110*60,chain:[],chainAt:0,chainGap:180,chainTry:0,
  tel:[],telN:0,ai:[],dq:[],dOpen:null,dPause:false,ref:false};
const irnd=(a,b)=>a+(b-a)*Math.random(),ipick=a=>a[Math.floor(Math.random()*a.length)];
/* tramos: nombres de las estaciones colindantes (en el archivo del nivel) */
const {SIDES}=NIVEL.tramos();
const sideOf=(dir,zone)=>((dir>0)===(zone==='in'))?'B':'Q';
/* tramosTxt: nombres de los trayectos y vías por sentido (en el archivo del nivel) */
const {trayN,viaN}=NIVEL.tramosTxt();
const kmF=m=>(m/1000).toFixed(1).replace('.',',');
const trL=t=>(t.svc.type==='merc'?'mercancías':t.svc.lab||({md:'regional',alvia:'Talgo',estrella:'Estrella',diurno:'Diurno',ic:'Intercity'})[t.svc.type]||'tren')+' '+t.svc.num;
const dOf=s=>({dIn:s==='B'?1:-1,dOut:s==='B'?-1:1});
const ucf=s=>s.charAt(0).toUpperCase()+s.slice(1);
/* ---- vía doble banalizada (BAB). RGC art. 149: two independent single tracks, vía I and vía II, each one worked in
   both directions whatever the parity of the train, with signals for both directions; art. 402: with a section
   blocked in one direction more trains may follow in that direction, and the direction can only be reversed with the
   section free of trains. Each direction has its habitual track here (I towards Burgos, II towards Miranda); the
   other one is used when the habitual one is closed or when the player sends a train out by it. A train running on
   the other track carries t.alt = the side of the section. ---- */
const normTrack=d=>d>0?'v1':'v2';
const tSched=t=>t.svc.dep!==undefined?t.svc.dep:t.svc.pass;
const CLOSE={cat:1,fu:1,arr:1,corte:1,ob:1};      // what closes a track (an intermediate block signal at stop does not)
/* the trains on the line track that direction g uses habitually, on side s (in either direction) */
/* where a train is on the line for block purposes. On the board, the approach before the entry signal is still the inbound
   section, and a train with its exit itinerary is already on the outbound one, on the track that itinerary takes: a train
   standing at the entry, or one leaving, holds that track against anything coming the other way */
function lineAt(t){if(t.done)return null;if(t.zone==='in'||t.zone==='out')return{zone:t.zone,alt:t.alt||null};if(t.zone!=='vis')return null;
  if(t.phase==='aprox'&&!(t.routeIn&&t.routeIn.passed))return{zone:'in',alt:t.alt||null};
  const R=t.routeOut;if(R&&(!R.released||R.passed))return{zone:'out',alt:wrongExit(R)?sideOf(t.dir,'out'):null};return null;}
function onTrack(s,g){const zg=sideOf(g,'in')===s?'in':'out';
  return TRAINS.filter(t=>{const L=lineAt(t);if(!L)return false;return(t.dir===g&&!L.alt&&L.zone===zg)||(L.alt===s&&t.dir===-g);});}
function closedTrack(s,g,nb){const zg=sideOf(g,'in')===s?'in':'out';   // nb: as the neighbour knows it (an incident once it has been told)
  return LINE.faults.some(f=>CLOSE[f.kind]&&f.dir===g&&f.zone===zg&&fAct(f)&&(!nb||!f.inc||f.inc.retd))||onTrack(s,g).some(t=>t.stall||t.oos);}
/* the line track a train will leave Santa Olalla by: the one the player chose, else the habitual one unless it is closed */
function exitTrackOf(tr){if(tr.exitT)return tr.exitT;const s=sideOf(tr.dir,'out');return closedTrack(s,tr.dir)&&!closedTrack(s,-tr.dir)?normTrack(-tr.dir):normTrack(tr.dir);}
function wrongExit(R){if(!R||R.kind!=='out')return false;const l=R.secs[R.secs.length-1];return!!l&&l.t!==normTrack(R.tr.dir);}
/* who keeps the exit signal at stop: on the habitual track the block of that direction; on the other one, a train
   coming the other way (the direction cannot be reversed), one ahead in the first section, or the track closed */
function blkFor(R){if(!wrongExit(R))return LINE.blk[R.tr.dir];const d=R.tr.dir,s=sideOf(d,'out'),on=onTrack(s,-d),tgt=R.tr.rescue&&R.tr.rescue.T;
  /* the socorro going to fetch a train stranded on that track: the stranded train does not close it for it */
  const zg=sideOf(-d,'in')===s?'in':'out',closed=tgt?(LINE.faults.some(f=>CLOSE[f.kind]&&f.dir===-d&&f.zone===zg&&fAct(f))||on.some(t=>(t.stall||t.oos)&&t.id!==tgt)):closedTrack(s,-d);
  return on.find(t=>t.dir===-d&&t.id!==tgt)||on.find(t=>t.dir===d&&t.zone==='out'&&t.p-t.len<LINE.OB1)||(closed?CUT_OCC:null);}
function setEntry(t,tk){if(t.entryTrack===tk)return;if(t.routeIn&&!t.routeIn.passed)cancelRoute(t.routeIn);if(t.routeOut&&!t.routeOut.passed)cancelRoute(t.routeOut);
  t.entryTrack=tk;t.entrySig=SIGNALS.find(x=>x.kind==='entrada'&&x.t===+tk[1]&&x.face===-t.dir);uiDirty=true;}

/* ---- telefonemas: tipos, destinatario y texto reglamentario ---- */
/* ---- telefonemas y notificaciones, con el texto del Reglamento General de Circulación (RGC, edición actualizada a
   2003) donde lo fija. Numbered ones: BT 6, 7, 13 (arts. 426, 428); BT supletorio 15–17 (431) y 20, 22 (434);
   rebase (277); notificaciones al maquinista (304, 241, 335, 433). Where the RGC asks for a telefonema but leaves its
   wording open (avisos de anormalidad, interceptación, corte de tensión) the text says what the article asks to say.
   Line tracks: vía I and vía II (BAB). ---- */
const TK={
  bte:{n:'Establecimiento del BT supletorio (15)',f:'g'},
  btc:{n:'Conformidad con el establecimiento del BT (16/17)',f:'g'},
  btn:{n:'Notificación: circulará con BT',f:'t'},
  pv:{n:'Petición de vía (6)',f:'t'},
  cv:{n:'Concesión de vía (7)',f:'t'},
  al:{n:'Aviso de llegada (13)',f:'t'},
  bts:{n:'Restablecimiento del BA (20)',f:'g'},
  rb:{n:'Autorización de rebase de una señal que ordena parada',f:'tg'},
  mt:{n:'MT 1 · Marche el tren',f:'t'},
  pr:{n:'Notificación al maquinista',f:'tg'},
  av:{n:'Aviso de anormalidad en una señal',f:'g'},
  lv:{n:'Comunicación de limitación temporal de velocidad',f:'g'},
  pm:{n:'Comunicación al Puesto de Mando',f:'t'},
  ret:{n:'Interceptación de la vía',f:'g'},
  ct:{n:'Petición de corte urgente de tensión',f:'g'},
  rt:{n:'Petición de restablecimiento de tensión',f:'g'}};
/* a line track: 'via:<side>:<1|2>' (1 = the one habitual towards +x, 2 = towards -x; its name comes from the level) */
const viaG=(s,n)=>'via:'+s+':'+n,viaOf=d=>d>0?1:2,viaNm=n=>viaN(n===1?1:-1);
function tgLabel(g){if(!g)return'';const p=g.split(':');
  if(p[0]==='sig'){const S=SIGNALS.find(x=>x.id===p[1]);return'señal '+(S?({entrada:'de entrada ',salida:'de salida ',intermedia:'intermedia ',retroceso:'de retroceso '})[S.kind]:'')+p[1];}
  if(p[0]==='tray')return'trayecto '+trayN(p[1]);
  if(p[0]==='via')return viaNm(+p[2])+' del trayecto '+trayN(p[1]);
  if(p[0]==='sb'){const d=+p[1],z=p[2],a=+p[3],S=LINE.side[d];return'señal de bloqueo a '+kmF(z==='in'?S.Lin-a:a)+(' km de '+NIVEL.nombre+' (')+viaN(d)+', '+trayN(sideOf(d,z))+')';}
  if(p[0]==='mot'){const i=INC.list.find(x=>x.id===+p[1]);return i?i.mot:'motivo';}
  return g;}
const sideG=g=>{const p=(g||'').split(':');return p[0]==='tray'||p[0]==='via'?p[1]:null;};
function telTo(k,tr,g){
  if(k==='pv')return tr?LINE.side[tr.dir].next:'…';
  if(k==='cv'||k==='al')return tr?LINE.side[tr.dir].prev:'…';
  if(k==='rb'||k==='pr'||k==='btn'||k==='mt')return tr?'Maquinista del '+tr.svc.num:'…';
  if(k==='pm')return'Puesto de Mando';
  if(k==='ct'||k==='rt')return'Telemando de energía ('+NIVEL.telemando+')';
  if(k==='av'){const S=g&&SIGNALS.find(x=>'sig:'+x.id===g);return S?(S.side==='Miranda'?LINE.side['1'].prev:LINE.side['1'].next)+' y Puesto de Mando':'Colateral y Puesto de Mando';}
  if(k==='bte'||k==='btc'||k==='bts'){const s=sideG(g);return s?SIDES[s]:'…';}
  const s=sideG(g);return s?SIDES[s]+' y Puesto de Mando':'…';}
/* conditions of a rebase (arts. 277, 278, 335): exit signals in BA always with marcha a la vista, and in BAB the line
   track (405.2, 410.2); an entry signal, marcha de maniobras to the stopping place or marcha a la vista to the next
   signal; and the notification of the level crossing if it is without protection */
function rbCond(tr,S){if(!tr||!S)return'…';let c;
  if(S.kind==='salida'){const x=exitTrackOf(tr);c='marcha a la vista, por la '+viaN(x==='v1'?1:-1);}
  else if(tr.acople&&tr.rescue){const T=trById(tr.rescue.T);c='marcha de maniobras hasta el tren '+(T?T.svc.num:'detenido')+', en la vía '+vn(tr.stopTrack);}
  else c=tr.stopTrack?'marcha de maniobras hasta el punto de estacionamiento':'marcha a la vista hasta la señal siguiente';
  if(PN.fault&&!PN.fault.guard&&(S.side===NIVEL.pnLado))c+='. '+NIVEL.pnTxt+' sin protección';
  return c;}
/* the incident behind a telefonema that is waiting for the player */
const needInc=(k,tr,g)=>{const n=INC.needs.find(x=>x.tel===k&&(!x.tr||!tr||x.tr===tr.id)&&(!x.g||!g||x.g===g));return n?n.inc:null;};
function telText(k,tr,g){const n=tr?tr.svc.num:'…',G=g?tgLabel(g):'…',I=needInc(k,tr,g);
  const mi=g&&g.indexOf('mot:')===0?INC.list.find(x=>'mot:'+x.id===g):null;
  const vp=(g||'').split(':'),vNm=vp[0]==='via'?viaNm(+vp[2]):'vía …',C=SIDES[sideG(g)]||'…';
  switch(k){
    case'bte':{const L=I&&I.lastTr&&trById(I.lastTr);return'Se establece el BT por la '+vNm+'. Último tren fue el '+(L?L.svc.num+' expedido a las '+fmtHM(L.depT||L.passT||L.tEnd||sim.t):'… expedido a las …')+'.';}
    case'btc':{const m=I&&I.inRun&&trById(I.inRun),L=I&&I.inLast&&trById(I.inLast);
      return'Conforme con el establecimiento del BT por la '+vNm+'. '+(m?'Tren '+m.svc.num+' en marcha':L?'Llegó tren '+L.svc.num+' a las '+fmtHM(L.arrT||L.passT||L.tEnter):'Llegó tren … a las …')+'.';}
    case'btn':return'Circulará con BT entre '+NIVEL.nombre+' y '+(tr?LINE.side[tr.dir].next:'…')+'. No funciona el BA. Por la '+(tr?viaN(exitTrackOf(tr)==='v1'?1:-1):'vía …')+'.';
    case'bts':return'Se restablece el BA por la '+vNm+'.';
    case'pv':return'¿Puedo expedir tren '+n+' a las '+(tr?fmtHM(Math.max(sim.t+60,tSched(tr))):'…')+'?';
    case'cv':return'Expida tren '+n+'.';
    case'al':return'Llegó tren '+n+'.';
    case'mt':return'Marche el tren '+n+' de vía '+(tr&&tr.stopTrack?vn(tr.stopTrack):'…')+'.';   // LNM Renfe 2.1.6.2.7, telefonema MT 1 by radiotelefonía
    case'rb':{const S=g&&SIGNALS.find(x=>'sig:'+x.id===g);const al=S&&tr&&tr.routeOut&&tr.routeOut.sig===S?outAlso(tr.routeOut):[];
      return'Autorizo al Maquinista del tren '+n+' para rebasar la '+(S?tgLabel(g):'señal …')+al.map(q=>' y la '+q.id).join('')+(' de '+NIVEL.nombre+' con ')+rbCond(tr,S)+'.';}
    case'pr':return mi?mi.motTx:'…';
    case'av':{const S=g&&SIGNALS.find(x=>'sig:'+x.id===g),A=I||INC.list.find(x=>x.sig===S);
      return S?('La '+tgLabel(g)+' de '+NIVEL.nombre+' '+(A&&A.lamp?'se encuentra apagada':'presenta avería en la apertura: ordena parada con el itinerario establecido')+(S.kind==='salida'?'. Los trenes saldrán por ella con autorización de rebase, al amparo del BA':'')+'.'):'La señal … presenta …';}
    case'lv':return I&&I.lvTx?I.lvTx:'Limitación temporal de velocidad …';
    case'pm':return I&&I.pmTx?I.pmTx:'…';
    case'ret':return(vp[0]==='via'?'Interceptada la '+vNm+' del trayecto '+trayN(vp[1]):'Interceptadas las vías I y II del trayecto '+(vp[1]?trayN(vp[1]):'…'))+(I&&I.why?' por '+I.why:'')+'. Suspendida la circulación por '+(vp[0]==='via'?'ella':'ellas')+'; no expidan trenes hasta nuevo aviso.';
    case'ct':return'Solicito corte urgente de tensión en '+(vp[0]==='via'?'la '+vNm+' del trayecto '+trayN(vp[1]):'las vías I y II del trayecto '+(vp[1]?trayN(vp[1]):'…'))+(I&&I.why?'. Motivo: '+I.why:'')+'.';
    case'rt':return'Corregida la causa y sin riesgo, solicito el restablecimiento de la tensión en '+(vp[0]==='via'?'la '+vNm+' del trayecto '+trayN(vp[1]):'las vías I y II del trayecto '+(vp[1]?trayN(vp[1]):'…'))+'.';}
  return'';}
function telLog(io,who,k,text,res){if(io==='in')autoPing();const e={n:++INC.telN,t:sim.t,io:io,who:who,k:k,text:text,res:res||''};INC.tel.unshift(e);if(INC.tel.length>80)INC.tel.length=80;uiDirty=true;return e;}
/* messages from the neighbours, the power control or the crews; what follows is a named handler of the incident (so a saved game can resume it) */
function aiSay(delay,who,k,text,inc,h,a){INC.ai.push({at:sim.t+delay,who:who,k:k,text:text,inc:inc||null,h:h||null,a:a===undefined?null:a});}
function aiRun(m){if(m.text){telLog('in',m.who,m.k,m.text);toast('☎ '+m.who+': '+m.text);}
  if(m.h&&m.inc&&!m.inc.done&&m.inc.H&&m.inc.H[m.h])m.inc.H[m.h](m.a);}

/* ---- lo que espera del jugador: telefonemas y soluciones ---- */
function needAdd(inc,o){const key=[o.k,o.tel||'',o.tr||'',o.g||'',o.tag||''].join('|');
  const ex=INC.needs.find(n=>n.inc===inc&&n.key===key);if(ex)return ex;
  const n=Object.assign({id:++INC.nseq,inc:inc,key:key,t0:sim.t},o);INC.needs.push(n);uiDirty=true;return n;}
function needDrop(n){const i=INC.needs.indexOf(n);if(i>=0)INC.needs.splice(i,1);uiDirty=true;}
function needDone(n){needDrop(n);const f=n.on&&n.inc.H&&n.inc.H[n.on];if(f)f(n);INC.ref=true;}
function overdue(inc,tr){return INC.needs.some(n=>n.inc===inc&&sim.t-n.t0>(n.grace||90)&&(!tr||!n.tr||n.tr===tr.id));}
function telSend(k,trId,g){
  if(!TK[k]){toast('Elige el tipo de telefonema');return false;}
  const f=TK[k].f,tr=trId?trById(trId):null;
  if(f.indexOf('t')>=0&&!tr){toast('Indica el tren');return false;}
  if(f.indexOf('g')>=0&&!g){toast('Indica la señal, el trayecto o el motivo');return false;}
  const text=telText(k,tr,g),who=telTo(k,tr,g);
  const n=INC.needs.find(x=>x.k==='tel'&&x.tel===k&&(!x.tr||x.tr===trId)&&(!x.g||x.g===g));
  if(!n){telLog('out',who,k,text,'err');stats.telErr++;anota('L','Telefonema sin efecto: '+TK[k].n+(tr?' al '+tr.svc.num:''));toast('Telefonema sin efecto: no corresponde a ninguna situación pendiente');return false;}
  const bad=n.valid&&n.inc.H[n.valid]&&n.inc.H[n.valid](n);
  if(bad){telLog('out',who,k,text,'err');stats.telErr++;n.inc.fail=true;n.inc.note=bad;n.inc.fl=1;anota('L','Telefonema erróneo: '+bad);toast('✗ '+bad);return false;}
  telLog('out',who,k,text,'ok');stats.telOk++;toast('☎ Telefonema nº '+INC.telN+' cursado · '+TK[k].n);needDone(n);return true;}
function solDo(n,j){const b=n.btns&&n.btns[j];if(!b)return;const f=n.inc.H&&n.inc.H[b.h];if(!f||f(b.a)!==false)needDone(n);}

/* ---- decisiones: un cuadro en la maqueta que pausa la simulación ---- */
const incM=document.getElementById('incm');
function decide(inc,d){d.inc=inc;INC.dq.push(d);uiDirty=true;showDec();}
function showDec(){
  if(INC.dOpen||!INC.dq.length)return;const d=INC.dq.shift();INC.dOpen=d;
  if(!sim.paused){sim.paused=true;INC.dPause=true;document.getElementById('pause').setAttribute('aria-pressed','true');}
  document.getElementById('incm-h').textContent=fmtHM(sim.t);document.getElementById('incm-t').textContent=d.title;
  document.getElementById('incm-x').textContent=d.text;
  document.getElementById('incm-o').innerHTML=d.opts.map((o,i)=>'<button class="iopt" data-i="'+i+'"><b>'+esc(o.l)+'</b>'+(o.sub?'<span>'+esc(o.sub)+'</span>':'')+'</button>').join('');
  incM.hidden=false;uiDirty=true;
}
function closeDec(){INC.dOpen=null;incM.hidden=true;
  if(INC.dPause&&!INC.dq.length){sim.paused=false;INC.dPause=false;document.getElementById('pause').setAttribute('aria-pressed','false');}uiDirty=true;}
function chooseDec(i){const d=INC.dOpen;if(!d)return;const o=d.opts[i];closeDec();const f=o&&d.inc.H&&d.inc.H[o.h];if(f&&!d.inc.done)f(o.a);INC.ref=true;uiDirty=true;showDec();}
incM.addEventListener('click',e=>{const b=e.target.closest('[data-i]');if(b)chooseDec(+b.getAttribute('data-i'));});

/* ---- ciclo de vida ---- */
function incNew(k,o){autoPing(6);const inc=Object.assign({id:++INC.seq,k:k,t0:sim.t,done:false,fail:false,st:'',sev:'warn'},o);
  INC.list.push(inc);incSetup(inc);INC.ref=true;uiDirty=true;toast('⚠ '+inc.title);return inc;}
/* behaviour (closures and named handlers) is rebuilt from the incident's own fields: new ones and loaded ones alike */
const NH={
  rb:n=>{const t=trById(n.tr);if(t){t.rb=t.rb||{};t.rb[n.sig]=1;}},
  rbF:n=>{const t=trById(n.tr);if(t){t.rbF=t.rbF||{};t.rbF[n.uid]=1;}},
  notif:n=>{const t=trById(n.tr);if(t){t.notif=t.notif||{};t.notif[n.inc.id]=1;}}};
function incSetup(inc){const T=IT[inc.k];inc.H=Object.assign({},NH);if(T&&T.setup)T.setup(inc);}
function incEnd(inc,ok,note){
  if(!inc||inc.done)return;inc.done=true;
  LINE.faults=LINE.faults.filter(f=>f.inc!==inc);
  TRAINS.forEach(t=>{['stall','oos','mustStop','doorFault'].forEach(f=>{if(t[f]===inc)t[f]=null;});
    if(t.holdBy===inc){t.holdBy=null;t.holdUntil=0;}if(t.vcapBy===inc){t.vcapBy=null;t.vcap=0;}});
  if(inc.clean)inc.clean();
  INC.needs=INC.needs.filter(n=>n.inc!==inc);INC.dq=INC.dq.filter(d=>d.inc!==inc);if(INC.dOpen&&INC.dOpen.inc===inc){closeDec();showDec();}
  INC.list=INC.list.filter(x=>x!==inc);
  if(ok!==null){ok=!!ok&&!inc.fail;if(ok)stats.incOk++;else stats.incFail++;
    {const nt=ok?'':(note||inc.note||'');CAR.inc.push({t:sim.t,x:inc.title,ok:ok,note:nt});if(!ok&&!inc.fg&&!inc.fl)anota('L',inc.title+(nt?': '+nt:''));}
    INC.hist.unshift({t:sim.t,t0:inc.t0,title:inc.title,ok:ok,note:note||inc.note||''});if(INC.hist.length>12)INC.hist.length=12;
    toast((ok?'✓ Incidencia resuelta · ':'✗ Incidencia cerrada con fallos · ')+inc.title);}
  refreshAspects();esqDirty=true;uiDirty=true;
}

/* ---- trenes afectados ---- */
function stallTrain(t,inc){t.stall=inc;t.stallP=(t.p||0)+(t.lv||0)*(t.lv||0)/(2*t.ty.b);}
function holdTrain(t,inc,dur,why){t.holdBy=inc;t.holdUntil=sim.t+dur;t.holdWhy=why;uiDirty=true;}
function stoppedSO(t){return t.spawned&&!t.done&&t.v<0.3&&['parado','puertas','cerrando','listo','apartado'].indexOf(t.phase)>=0;}
function incTransfer(t){if(!t.md)return;PAX.forEach(p=>{if(p.on&&p.train===t&&p.state!=='leave')missedTrain(p,t,false);});}
/* retener un tren en Santa Olalla: ya, si está parado en la estación, o en cuanto pare */
function holdSO(inc,t,o){inc.hold=o;inc.st=o.why;if(!t.md)t.mustStop=inc;if(stoppedSO(t))holdTrain(t,inc,o.dur||Math.max(60,o.until-sim.t),o.why);}
function incHoldWhy(tr){
  if(!INC)return'';
  if(tr.stall)return'Averiado: no puede moverse';
  if(tr.oos)return'Fuera de servicio: espera la locomotora de socorro';
  if(tr.holdUntil>sim.t)return tr.holdWhy+' · faltan '+Math.ceil((tr.holdUntil-sim.t)/60)+'′';
  if(INC.needs.some(n=>n.tel==='asfa'&&n.tr===tr.id))return'Falta el telefonema para circular con el equipo anulado';
  if(tr.doorFault&&tr.phase==='cerrando')return'Puerta sin comprobación de cierre';
  return'';}

/* ---- enganches con el enclavamiento, el bloqueo y la línea ---- */
function incRouteBlocks(R){return INC?INC.list.filter(i=>!i.done&&i.blockRoute&&i.blockRoute(R)):[];}
function mayPass(tr,S){
  {const Ro=tr.routeOut;if(Ro&&Ro.passed&&Ro.rbAuth&&!Ro.released&&outAlso(Ro).indexOf(S)>=0)return true;}   // the second exit signal of an itinerary whose first was passed with an authorisation
  if(tr.work&&S.kind==='salida'&&tr.rb&&tr.rb[S.id]&&tr.routeOut&&tr.routeOut.sig===S)return true;
  if(tr.work&&tr.shunt&&tr.routeRet&&tr.routeRet.secs.some(sc=>sc.t==='v'+S.t&&S.x>sc.a-0.5&&S.x<sc.b+0.5))return true;   // maniobra
  if(INNER[S.kind]){const R=innerRoute(tr,S);return!!(R&&unprovenAt(R,S)&&tr.rb&&tr.rb[S.id]&&INC.list.every(i=>!i.authPt||!incAtInner(R,S,i)||i.authPt(R)));}
  const R=ROUTES.find(r=>r.tr===tr&&r.sig===S&&!r.passed);if(!R||!R.incBs||!R.incBs.length)return false;
  const BK=blkFor(R);if(R.kind==='out'&&BK&&BK!==tr)return false;
  return R.incBs.every(i=>i.auth&&i.auth(tr,R));}
function incPassSig(tr,R){
  if(R.incBs&&R.incBs.length){if(R.incBs.some(i=>i.mv))tr.mvR=R;if(tr.rb)delete tr.rb[R.sig.id];}
  INC.list.slice().forEach(i=>{if(!i.done&&i.onPass)i.onPass(tr,R);});
  if(R.kind==='out'&&tr.mustStop&&!tr.arrT){const i=tr.mustStop;i.fail=true;i.note='El '+tr.svc.num+(' ha salido de '+NIVEL.nombre+' sin detenerse.');i.fg=1;anota('G',i.note);toast('✗ '+i.note);tr.mustStop=null;}
}
function incOnStop(tr){INC.list.slice().forEach(i=>{if(i.done)return;
  if(i.hold&&i.tr===tr.id&&!tr.holdBy)holdTrain(tr,i,i.hold.dur||Math.max(60,i.hold.until-sim.t),i.hold.why);
  if(i.onStop)i.onStop(tr);});}
function incArrive(t){INC.list.slice().forEach(i=>{if(!i.done&&i.onArrive)i.onArrive(t);});}
function incGateIn(dir,c){for(const i of INC.list)if(!i.done&&i.gateIn&&!i.gateIn(dir,c))return false;return true;}
function incNoPow(t){if(!INC||(t.zone!=='in'&&t.zone!=='out'))return null;const x=t.alt?{dir:-t.dir,zone:t.zone==='in'?'out':'in'}:t;   // on the other track: that one's wire
  for(const i of INC.list)if(!i.done&&i.noPow&&i.noPow(x))return i;return null;}
function incCap(t){let v=Infinity;for(const i of INC.list)if(!i.done&&i.cap)v=Math.min(v,i.cap(t));return v;}
/* the time an incident costs a train is not the player's, unless something the player has to do is overdue */
function incExc(t,h){const i=t.stall||incNoPow(t);if(i&&!overdue(i))t.exc=(t.exc||0)+h;}
function incTrainExc(tr,dt){
  if(tr.stall||tr.oos||tr.holdUntil>sim.t||tr.doorFault){if(!(tr.stall&&overdue(tr.stall)))tr.exc=(tr.exc||0)+dt;return;}
  if(tr.blockedBy){const R=ROUTES.find(r=>r.tr===tr&&r.sig===tr.blockedBy&&!r.passed);
    if(R&&R.incBs&&R.incBs.length&&!R.incBs.some(i=>overdue(i,tr)))tr.exc=(tr.exc||0)+dt;}
  if(tr.mvR&&!tr.mvR.released&&tr.v<vEff(tr))tr.exc=(tr.exc||0)+dt*0.5;
}

/* trains stopped in front of a signal an incident keeps at stop: they need a telefonema to pass it */
function sigNeeds(inc,tk,g,why,valid){
  TRAINS.forEach(tr=>{const S=tr.blockedBy;if(!S||tr.done)return;const R=INNER[S.kind]?innerRoute(tr,S):ROUTES.find(r=>r.tr===tr&&r.sig===S&&!r.passed);
    if(tr.stopSig===S)return;   // left short of it on purpose
    if(!R||(INNER[S.kind]?!incAtInner(R,S,inc):(!R.incBs||R.incBs.indexOf(inc)<0))||(tr.rb&&tr.rb[S.id]))return;
    needAdd(inc,{k:'tel',tel:tk,tr:tr.id,g:g||('sig:'+S.id),sig:S.id,txt:'El '+trL(tr)+' está detenido ante la señal '+S.id+' en parada: '+why+'.',on:'rb',valid:valid||undefined});});
  INC.needs.filter(n=>{if(n.inc!==inc||n.tel!==tk||!n.tr)return false;const t=trById(n.tr);return!t||!t.blockedBy;}).forEach(needDrop);
}
/* precaution orders: every train leaving towards the affected section has to get one before it goes */
function notifyStep(inc){const d=inc.dir,s=sideOf(d,'out');
  TRAINS.forEach(t=>{if(t.dir!==d||t.done||t.zone==='end'||(t.notif&&t.notif[inc.id]))return;
    if(!((t.spawned&&!passedSO(t))||(t.zone==='in'&&etaSO(t)<8*60)))return;
    needAdd(inc,{k:'tel',tel:'pr',tr:t.id,g:'mot:'+inc.id,txt:'El '+trL(t)+' saldrá hacia '+SIDES[s]+': '+inc.mot.charAt(0).toLowerCase()+inc.mot.slice(1)+'.',on:'notif'});});
  INC.needs.filter(n=>{if(n.inc!==inc||!n.tr)return false;const t=trById(n.tr);return!t||passedSO(t);}).forEach(needDrop);}
function notifyPass(inc){return(tr,R)=>{
  if(R.kind!=='out'||tr.dir!==inc.dir||(tr.notif&&tr.notif[inc.id]))return;
  inc.fail=true;stats.telErr++;inc.note='El '+tr.svc.num+' salió sin la orden de precaución.';inc.fg=1;anota('G',inc.note+' ('+inc.mot+')');
  toast('✗ El '+tr.svc.num+' ha salido sin la orden de precaución ('+inc.mot+')');INC.needs.filter(n=>n.inc===inc&&n.tr===tr.id).forEach(needDrop);};}

/* ---- el motor: incidencias al azar, la cola de pruebas y los avisos de las colaterales ---- */
function incStep(h){
  ttStep();
  if(INC.ai.length&&INC.ai.some(a=>sim.t>=a.at)){const due=INC.ai.filter(a=>sim.t>=a.at);INC.ai=INC.ai.filter(a=>sim.t<a.at);due.forEach(aiRun);}
  INC.list.slice().forEach(i=>{if(i.done)return;
    const t=i.tr?trById(i.tr):null;
    if(i.tr&&(!t||t.zone==='end')){incEnd(i,true);return;}
    if(i.hold&&i.hold.end!==false&&t&&t.holdBy===i&&sim.t>=t.holdUntil){incEnd(i,true);return;}
    if(i.step)i.step(h);});
  // a train held at the previous station because the player has not answered is the player's delay
  INC.needs.forEach(n=>{if(n.tr&&sim.t-n.t0>90){const t=trById(n.tr);if(t&&t.zone==='pre')t.chg=(t.chg||0)+h;}});
  if(INC.ref){INC.ref=false;refreshAspects();}
  if(sim.t>=INC.tick){INC.tick=sim.t+5;incGen();chainStep();}
}
function incGen(){
  if(!INC.next){INC.next=sim.t+irnd(25,50)*60;return;}
  if(!INC.auto||sim.t<INC.next)return;
  INC.next=sim.t+Math.max(30*60,-Math.log(1-Math.random())*INC_MEAN);
  if(INC.list.length>=2)return;
  const ks=Object.keys(IT).filter(k=>IT[k].can()),ws=ks.map(k=>IT[k].w*(IT[k].wf?IT[k].wf():1));
  let r=Math.random()*ws.reduce((a,b)=>a+b,0);for(let i=0;i<ks.length;i++){r-=ws[i];if(r<=0){IT[ks[i]].go();return;}}
}
function chainStep(){
  if(!INC.chain.length||sim.t<INC.chainAt)return;
  if(INC.chainGap===0&&INC.list.length)return;
  // the first one that can happen now; the ones that need a particular train wait for it (up to 3 h)
  const W=INC.chainWait||(INC.chainWait={});
  const j=INC.chain.findIndex(k=>IT[k].can());
  if(j>=0){const k=INC.chain.splice(j,1)[0];delete W[k];IT[k].go();INC.chainAt=sim.t+(INC.chainGap||20);}
  else{INC.chainAt=sim.t+30;INC.chain=INC.chain.filter(k=>{if(!W[k])W[k]=sim.t;if(sim.t-W[k]<3*3600)return true;delete W[k];
    toast('Cola de incidencias: se salta «'+IT[k].n+'», no ha habido ocasión');return false;});}
  if(typeof devIncNote==='function')devIncNote();
}


/* ---- catálogo ----
   go() elige y crea la incidencia (campos sencillos: lado, vía, tren, plazos); setup(inc) le pone el comportamiento
   y los manejadores con nombre (inc.H) a partir de esos campos, de modo que una partida guardada la recupera igual. */
const IT={};
/* about eight a day, day and night (mean gap 2 h 50, never closer than 30 min); the night ones are those that make
   sense with no passengers about: the passenger ones need a regional at the platform */
const INC_MEAN=170*60;
/* the weather behind the faults: lightning brings down the block, track circuits, signals and the level crossing and
   can catch the catenary; frost or snow freeze the points, the crossing and the wire; rain gets into insulated joints */
function wxI(){const hr=hourNow(),snow=Math.max(WX.snow,clamp(WX.acc*2,0,1)),
    frost=AEMET_BU.T[WX.m]<7&&(hr<9||hr>20)&&WX.cover<0.6&&WX.rain<0.1?1:0;
  return{st:WX.storm,rain:WX.rain,snow:snow,frost:frost,ice:Math.max(snow,frost),fog:WX.fog,hr:hr};}
const lineTrain=(t,m)=>!t.work&&((t.zone==='in'&&t.p>m&&t.p<LINE.side[t.dir].Lin-m-300)||(t.zone==='out'&&t.p>m&&t.p<LINE.side[t.dir].Lout-m));
function tfCands(){return TRAINS.filter(t=>!t.work&&!t.stall&&!t.oos&&!t.mustStop&&((t.zone==='in'&&t.p>600&&t.p<LINE.side[t.dir].Lin-900)||(t.spawned&&!t.done&&t.v<0.3&&['parado','puertas','listo','apartado'].indexOf(t.phase)>=0)));}
function puCands(){return TRAINS.filter(t=>t.md&&!busyTr(t)&&((t.spawned&&!t.done&&(t.phase==='parado'||t.phase==='puertas'))||soonSO(t,1,10)));}
function soonSO(t,a,b){return t.zone==='in'&&t.p>300&&etaSO(t)>a*60&&etaSO(t)<b*60;}
function busyTr(t){return INC.list.some(i=>i.tr===t.id)||t.stall||t.oos||t.mustStop||t.doorFault||t.holdBy;}
function asCands(){return TRAINS.filter(t=>!t.work&&!busyTr(t)&&((t.md&&t.spawned&&!t.done&&t.v<0.3&&['parado','puertas','listo'].indexOf(t.phase)>=0)||soonSO(t,3,15)));}
function viCands(){return TRAINS.filter(t=>t.md&&!busyTr(t)&&((t.spawned&&!t.done&&t.v<0.3&&(t.phase==='parado'||t.phase==='puertas'))||soonSO(t,2,12)));}
function mqCands(){return TRAINS.filter(t=>!t.work&&!busyTr(t)&&(soonSO(t,4,15)||(t.md&&t.spawned&&!t.done&&t.v<0.3&&(t.phase==='parado'||t.phase==='puertas'))));}
const T_=inc=>trById(inc.tr);
const faultOf=inc=>LINE.faults.find(f=>f.inc===inc);

/* Caída del bloqueo automático: BT supletorio en las dos vías del trayecto (RGC arts. 405.2, 431, 433, 434)
   - each track is established by the jefe who dispatched the last train onto it: Santa Olalla the one it uses towards
     the neighbour (telefonema 15, the neighbour answers 16 or 17), the neighbour the other one (Santa Olalla answers)
   - then one train at a time on each track: petición (6) / concesión (7) / aviso de llegada (13); the exit signals stay
     at stop and the trains leave on the jefe's order, each with the notification «Circulará con BT entre … y …. No
     funciona el BA. Por la vía …» (433, BAB)
   - once repaired, Santa Olalla restores each track with the 20 (the neighbour answers 22) after the aviso de llegada
     of the last train that ran on it in BT */
IT.ba={n:'Caída del bloqueo automático',w:5,wf:()=>1+4*wxI().st,can:()=>!INC.list.some(i=>i.k==='ba'),go(){
  const s=Math.random()<0.5?'B':'Q',D=dOf(s),C=SIDES[s],cause=WX.storm>0.5&&Math.random()<0.7?'la caída de un rayo junto al armario de bloqueo':ipick(['robo de cable de señalización','una avería en el cable de bloqueo','una descarga en el armario de bloqueo']);
  const vO=viaOf(D.dOut),vI=viaOf(D.dIn);
  let L=null;TRAINS.forEach(t=>{if(t.dir!==D.dOut||t.alt||(t.zone!=='out'&&t.zone!=='end'))return;if(!L||(t.depT||t.passT||0)>(L.depT||L.passT||0))L=t;});
  const inc=incNew('ba',{s:s,dIn:D.dIn,dOut:D.dOut,vO:vO,vI:vI,sev:'stop',title:'Caída del bloqueo automático · '+trayN(s),lastTr:L?L.id:null,
    desc:('Ha caído el bloqueo automático entre '+NIVEL.nombre+' y ')+C+' por '+cause+': las salidas hacia '+C+' no abren y las señales intermedias quedan en parada. Se establece el BT supletorio en las dos vías del trayecto (RGC arts. 405.2 y 431): la '+viaNm(vO)+' la estableces tú, que expediste por ella el último tren (telefonema 15); la '+viaNm(vI)+' la establece '+C+' y tú das la conformidad (16 o 17). Después, un tren cada vez por cada vía, con petición y concesión de vía y aviso de llegada; los trenes salen con tu orden y la notificación «Circulará con BT…» (art. 433).',
    estO:false,estI:false,rep:sim.t+irnd(35,60)*60,repd:false,conc:{},asked:{},occ:null,occO:null,wait:[],granting:false,busy:{},rsO:false,rsI:false,rsNO:false,rsNI:false});
  inc.st='Sin bloqueo: no puede entrar ningún tren en el trayecto';
  needAdd(inc,{k:'tel',tel:'bte',g:viaG(s,vO),txt:'Sin bloqueo automático con '+C+': establece el BT supletorio por la '+viaNm(vO)+', la que usas para expedir hacia '+C+'.',on:'bte'});
  aiSay(irnd(60,150),null,null,null,inc,'nbEst');
  return inc;},
 setup(inc){const s=inc.s,C=SIDES[s],H=inc.H,VO=viaNm(inc.vO),VI=viaNm(inc.vI);
  inc.chip=()=>(inc.estO&&inc.estI?'BT supletorio':'Sin bloqueo')+' · '+trayN(s);
  inc.bt=inc.estO||inc.estI;
  inc.blockRoute=R=>R.kind==='out'&&R.tr.dir===inc.dOut;
  inc.auth=tr=>inc.estO&&!!inc.conc[tr.id]&&!!(tr.notif&&tr.notif[inc.id]);
  const freeOut=()=>!inc.occO&&!TRAINS.some(t=>t.dir===inc.dOut&&t.zone==='out');
  const freeIn=()=>!inc.occ&&!TRAINS.some(t=>t.dir===inc.dIn&&t.zone==='in');
  H.bte=()=>{inc.estO=true;inc.bt=true;inc.st='BT establecido por la '+VO;const L=inc.lastTr&&trById(inc.lastTr);
    aiSay(irnd(10,25),C,'btc','Conforme con el establecimiento del BT por la '+VO+'. '+(L&&L.zone==='out'?'Tren '+L.svc.num+' en marcha':L&&L.zone==='end'?'Llegó tren '+L.svc.num+' a las '+fmtHM(L.tEnd):'Llegó tren … a las …')+'.');};
  H.nbEst=()=>{if(inc.repd)return;let M=null;TRAINS.forEach(t=>{if(t.dir!==inc.dIn||t.alt||t.zone==='pre'||!t.tEnter)return;if(!M||t.tEnter>M.tEnter)M=t;});
    const m=TRAINS.find(t=>t.dir===inc.dIn&&t.zone==='in'&&!t.alt);let A=null;TRAINS.forEach(t=>{if(t.dir!==inc.dIn||t.alt||!t.spawned)return;const a=t.arrT||t.passT||t.tEnter||0;if(!A||a>(A.arrT||A.passT||A.tEnter||0))A=t;});
    inc.inRun=m?m.id:null;inc.inLast=A?A.id:null;
    aiSay(0,C,'bte','Se establece el BT por la '+VI+'. Último tren fue el '+(M?M.svc.num+' expedido a las '+fmtHM(M.tEnter):'… expedido a las …')+'.');
    needAdd(inc,{k:'tel',tel:'btc',g:viaG(s,inc.vI),on:'btc',txt:C+' establece el BT supletorio por la '+VI+': contesta con la conformidad (16 si llegó el último tren, 17 si está en marcha).'});};
  H.btc=()=>{inc.estI=true;inc.bt=true;inc.st=inc.estO?'BT supletorio en las dos vías':'BT establecido por la '+VI;};
  H.grant=()=>{
    while(inc.wait.length){const t=trById(inc.wait[0]);if(t&&!passedSO(t))break;inc.wait.shift();}
    if(inc.granting||!inc.wait.length)return;const id=inc.wait[0],t=trById(id);
    if(!freeOut()){if(!inc.busy[id]){inc.busy[id]=1;aiSay(irnd(15,30),C,'pv','Detenga tren '+t.svc.num+'.');}return;}
    inc.granting=true;aiSay(irnd(15,35),C,'cv','Expida tren '+t.svc.num+'.',inc,'granted',id);};
  H.granted=id=>{inc.granting=false;inc.wait.shift();inc.conc[id]=1;inc.occO=id;INC.ref=true;};
  H.askIn=id=>{const c=trById(id);if(c&&c.zone==='pre')needAdd(inc,{k:'tel',tel:'cv',tr:id,txt:C+' pide vía para el '+trL(c)+(' hacia '+NIVEL.nombre+' por la ')+VI+'.',valid:'cvBad',on:'cv'});};
  H.cvBad=()=>freeIn()?'':'Concediste vía con la '+VI+' ocupada: falta el aviso de llegada del tren anterior.';
  H.cv=n=>{inc.conc[n.tr]=1;};
  H.al=()=>{inc.occ=null;};
  H.alOut=id=>{if(inc.occO===id)inc.occO=null;H.grant();};
  H.pv=n=>{inc.asked[n.tr]=1;inc.wait.push(n.tr);H.grant();};
  H.bts=n=>{const v=+n.g.split(':')[2];if(v===inc.vO)inc.rsO=true;else inc.rsI=true;
    aiSay(irnd(8,20),C,'bts','Conforme con el restablecimiento del BA por la '+viaNm(v)+'.',inc,'btsOk');};
  H.btsOk=()=>{if(inc.rsO&&inc.rsI)incEnd(inc,true);};
  inc.gateIn=(dir,c)=>{if(dir!==inc.dIn)return true;if(!inc.estI)return false;
    if(inc.repd&&inc.rsNI&&!inc.conc[c.id])return false;   // repaired: the neighbour waits for the block to be restored
    if(inc.conc[c.id]){delete inc.conc[c.id];inc.occ=c.id;return true;}
    if(!freeIn())return false;
    if(!inc.asked[c.id]){inc.asked[c.id]=1;aiSay(irnd(5,15),C,'pv','¿Puedo expedir tren '+c.svc.num+' a las '+fmtHM(Math.max(sim.t+60,c.tReady||sim.t))+'?',inc,'askIn',c.id);}
    return false;};
  inc.onPass=(tr,R)=>{
    if(R.kind==='in'&&tr.dir===inc.dIn&&inc.occ===tr.id)needAdd(inc,{k:'tel',tel:'al',tr:tr.id,txt:'El '+trL(tr)+', que venía de '+C+(' en BT, ha llegado completo a '+NIVEL.nombre+' y está protegido por la señal de entrada.'),on:'al'});
    if(R.kind==='out'&&tr.dir===inc.dOut){delete inc.conc[tr.id];
      if(!(tr.notif&&tr.notif[inc.id])){inc.fail=true;stats.telErr++;inc.note='El '+tr.svc.num+' salió en BT sin la notificación al maquinista.';inc.fg=1;anota('G',inc.note);toast('✗ '+inc.note);}}};
  inc.onArrive=t=>{if(t.dir!==inc.dOut)return;
    if(inc.occO===t.id)aiSay(irnd(10,25),C,'al','Llegó tren '+t.svc.num+'.',inc,'alOut',t.id);
    else aiSay(0,null,null,null,inc,'grant');};
  inc.step=h=>{
    if(inc.estO)TRAINS.forEach(t=>{if(t.dir!==inc.dOut||!t.spawned||t.done||!t.routeOut||t.routeOut.passed)return;
      if(!inc.conc[t.id]&&!inc.asked[t.id])needAdd(inc,{k:'tel',tel:'pv',tr:t.id,txt:'El '+trL(t)+' tiene la salida hacia '+C+' establecida: pide vía a '+C+'.',on:'pv'});
      if(!(t.notif&&t.notif[inc.id]))needAdd(inc,{k:'tel',tel:'btn',tr:t.id,txt:'El '+trL(t)+' saldrá hacia '+C+' en BT: notifícale «Circulará con BT entre '+NIVEL.nombre+' y '+C+'. No funciona el BA. Por la '+VO+'».',on:'notif'});});
    INC.needs.filter(n=>{if(n.inc!==inc)return false;const t=n.tr&&trById(n.tr);
      return(n.tel==='cv'&&(!t||t.zone!=='pre'))||((n.tel==='pv'||n.tel==='btn')&&(!t||!t.routeOut||t.routeOut.passed));}).forEach(needDrop);
    if(!inc.repd&&sim.t>=inc.rep){inc.repd=true;
      if(!inc.estO&&!inc.estI){incEnd(inc,false,'Repararon el bloqueo sin que se llegara a establecer el BT supletorio: el trayecto estuvo parado.');return;}
      telLog('in','Mantenimiento','—',('Reparado el bloqueo automático entre '+NIVEL.nombre+' y ')+C+'. Puede restablecerlo en cada vía tras el aviso de llegada del último tren que circuló en BT.');
      toast('☎ Mantenimiento: reparado el bloqueo automático con '+C);inc.st='Reparado · restablece el BA en cada vía';}
    if(inc.repd){
      if(!inc.rsNO&&!inc.rsO&&(inc.estO?freeOut()&&!inc.wait.length&&!inc.granting&&!Object.keys(inc.conc).some(id=>{const t=trById(id);return t&&t.dir===inc.dOut;}):true)){
        inc.rsNO=true;if(!inc.estO)inc.rsO=true;else needAdd(inc,{k:'tel',tel:'bts',g:viaG(s,inc.vO),txt:'El BA funciona y ha llegado el último tren que salió en BT por la '+VO+': restablécelo (telefonema 20).',on:'bts'});}
      if(!inc.rsNI&&!inc.rsI&&freeIn()&&!INC.needs.some(n=>n.inc===inc&&(n.tel==='cv'||n.tel==='al'))){
        inc.rsNI=true;if(!inc.estI)inc.rsI=true;else needAdd(inc,{k:'tel',tel:'bts',g:viaG(s,inc.vI),txt:'Por la '+VI+' ya no hay ningún tren en BT: restablece el BA (telefonema 20).',on:'bts'});}
      if(inc.rsO&&inc.rsI&&!INC.needs.some(n=>n.inc===inc&&n.tel==='bts')&&!INC.ai.some(a=>a.inc===inc))incEnd(inc,true);}
  };}};

/* Falsa ocupación de un circuito de vía: en la estación o en un cantón del trayecto */
IT.cv={n:'Falsa ocupación de circuito de vía',w:6,wf:()=>{const x=wxI();return 1+3*x.st+0.8*x.rain;},can:()=>true,go(){
  const cause=WX.storm>0.5&&Math.random()<0.6?'una descarga de la tormenta':WX.rain>0.5&&Math.random()<0.5?'agua en una junta aislante':ipick(['óxido en el carril','una junta aislante en mal estado','robo de cable']);
  if(Math.random()<0.55){
    const free=Object.keys(LU).filter(x=>!INC.list.some(i=>i.c&&i.c.t===x));if(!free.length)return null;
    const tk=ipick(free);
    return incNew('cv',{c:{t:tk,a:-60,b:60},mv:true,sev:'warn',title:'Falsa ocupación · vía '+vn(tk),rep:sim.t+irnd(20,45)*60,
      desc:'El circuito de la vía '+vn(tk)+' marca ocupado sin que haya ningún tren ('+cause+'). Comprobado que está libre, puedes establecer itinerarios por ella, pero la señal no abrirá: cada tren necesita la autorización de rebase (RGC arts. 277 y 278), con marcha de maniobras hasta el punto de estacionamiento o marcha a la vista.'});}
  const dir=Math.random()<0.5?1:-1,zone=Math.random()<0.5?'in':'out',S=LINE.side[dir],L=zone==='in'?S.Lin:S.Lout;
  const a=ipick(cantons(dir,zone).map(c=>c[0]).filter(x=>x>0));
  const inc=incNew('cv',{dir:dir,zone:zone,a:a,sbg:'sb:'+dir+':'+zone+':'+a,sev:'warn',title:'Falsa ocupación · cantón a '+kmF(zone==='in'?L-a:a)+' km · '+trayN(sideOf(dir,zone)),rep:sim.t+irnd(20,45)*60,
    desc:'Un cantón de la '+viaN(dir)+' del trayecto '+trayN(sideOf(dir,zone))+' marca ocupado sin tren ('+cause+'). Su señal de bloqueo tiene placa P: los trenes se detienen ante ella y siguen en marcha a la vista hasta la señal siguiente (RGC art. 217). No hace falta autorización.'});
  LINE.faults.push({dir:dir,zone:zone,a:a,until:Infinity,kind:'cv',inc:inc,uid:'f'+inc.id});
  return inc;},
 setup(inc){
  if(inc.c){const c=inc.c;
    inc.blockRoute=R=>R.secs.some(sc=>sc.t===c.t&&sc.a<c.b&&sc.b>c.a);
    inc.auth=(tr,R)=>!!(tr.rb&&tr.rb[R.sig.id]);
    inc.step=h=>{sigNeeds(inc,'rb',null,'falsa ocupación de la vía '+vn(c.t));if(sim.t>=inc.rep)incEnd(inc,true);};
    inc.chip=()=>'Falsa ocupación · vía '+vn(c.t);return;}
  inc.step=h=>{if(sim.t>=inc.rep){telLog('in','Mantenimiento','—','Reparado el circuito de vía del cantón: '+inc.title.split(' · ').slice(1).join(' · ')+'.');incEnd(inc,true);}};
  inc.chip=()=>inc.title;}};

/* Falta de comprobación de agujas: calzar y acerrojar con candado, y pasar con rebase */
IT.ag={n:'Falta de comprobación de agujas',w:4,wf:()=>1+5*wxI().ice,can:()=>SWITCHES.some(S=>!S.nc&&!ROUTES.some(R=>R.req[S.id])),go(){
  const S=ipick(SWITCHES.filter(x=>!x.nc&&!ROUTES.some(R=>R.req[x.id])));
  const cause=WX.acc>0.2?'nieve en las agujas':wxI().frost?'el cambio helado':ipick(['un cerrojo desajustado','una piedra entre aguja y contraaguja','una avería del motor de accionamiento']);
  const inc=incNew('ag',{sw:S.id,mv:true,sev:'stop',title:'Sin comprobación · '+S.name,rep:sim.t+irnd(40,70)*60,
    desc:S.name+' no da comprobación de posición ('+cause+'). No se puede mover ni enclavar desde el puesto: hay que mandar al agente a calzarla y acerrojarla con candado en la posición que necesites. Después, los trenes que pasan por ella lo hacen con autorización de rebase y en marcha a la vista.'});
  S.nc=inc;S.lockPos=null;esqDirty=true;
  needAdd(inc,{k:'sol',txt:S.name+' sin comprobación. ¿En qué posición la calzas?',btns:[{l:'Calzar en normal',h:'lock',a:false},{l:'Calzar en invertida',h:'lock',a:true}]});
  crewSend({inc:inc.id,k:'repara',who:'infra',base:'auto',n:2,spots:pairSpots(swSpots(S)),tArr:inc.rep-irnd(14,20)*60,msg:'🔧 Vía y Obras ya trabaja en la '+S.name.toLowerCase()});
  return inc;},
 setup(inc){const S=SW_BY[inc.sw];
  inc.point=R=>{if(R.req[S.id]===undefined)return null;const L=S.legs.find(L=>R.secs.some(sc=>sc.t==='v'+L.t&&L.x>=sc.a-0.1&&L.x<=sc.b+0.1));return L?{x:L.x,t:'v'+L.t}:null;};
  inc.blockRoute=R=>{if(R.req[S.id]===undefined)return false;const P=protSig(R,inc.point(R));return!P||P===R.sig;};   // later signals open: the one before the switch stops the train
  inc.authPt=R=>S.lockPos===(R.req[S.id]==='R');
  inc.auth=(tr,R)=>S.lockPos===(R.req[S.id]==='R')&&!!(tr.rb&&tr.rb[R.sig.id]);
  inc.H.lock=pos=>{const R=ROUTES.find(r=>r.req[S.id]&&(r.req[S.id]==='R')!==pos);
    if(R){toast('Anula antes el itinerario de '+R.tr.label+': necesita la aguja en la otra posición');return false;}
    if(S.reverse!==pos&&switchOccupied(S.id)){toast(S.name+' ocupada por un tren');return false;}
    inc.lockAt=sim.t+irnd(6,10)*60;inc.lockTo=pos;inc.st='El agente va a calzarla en '+(pos?'invertida':'normal')+' · llega a las '+fmtHM(inc.lockAt);
    const sp=swSpots(S);crewSend({inc:inc.id,k:'calzar',who:'circ',base:'gab',n:1,spots:sp,seq:true,tArr:inc.lockAt-50,ist:'El agente está calzando la '+S.name.toLowerCase()+' en '+(pos?'invertida':'normal')});
    return true;};
  inc.step=h=>{
    if(inc.lockAt&&sim.t>=inc.lockAt&&crewOk(inc,'calzar',45,inc.lockAt+240)){inc.lockAt=0;crewDone(inc,'calzar');S.reverse=inc.lockTo;setSwitchVis(S);S.lockPos=inc.lockTo;repathAll();INC.ref=true;
      inc.st='Calzada y acerrojada en '+(S.lockPos?'invertida':'normal');toast(S.name+' calzada y acerrojada en '+(S.lockPos?'invertida':'normal'));}
    if(S.lockPos!=null)sigNeeds(inc,'rb',null,S.name+' calzada, sin comprobación');
    if(sim.t>=inc.rep&&!inc.lockAt&&crewOk(inc,'repara',300,inc.rep+600)){telLog('in','Mantenimiento','—','Reparada la '+S.name.toLowerCase()+': vuelve a dar comprobación.');incEnd(inc,true);}};
  inc.clean=()=>{S.nc=null;S.lockPos=null;esqDirty=true;};
  inc.chip=()=>inc.title+(S.lockPos!=null?' · calzada':'');}};

/* Señal que no abre o con la lámpara de rojo fundida */
IT.sg={n:'Señal que no abre',w:4,wf:()=>1+3*wxI().st,can:()=>SIGNALS.some(x=>!x.aux&&!INC.list.some(i=>i.sig===x)),go(){
  const S=ipick(SIGNALS.filter(x=>!x.aux&&!INC.list.some(i=>i.sig===x))),lamp=Math.random()<(WX.storm>0.5?0.2:0.5);
  const inc=incNew('sg',{sig:S,lamp:lamp,mv:true,sev:'warn',title:'Señal '+S.id+(lamp?' · apagada':' · avería en la apertura'),rep:sim.t+(lamp?irnd(15,30):irnd(25,50))*60,
    desc:(lamp?'La señal '+S.id+' se ha quedado apagada (lámpara de rojo fundida): para los maquinistas vale como parada y el enclavamiento no la deja abrir hasta que la cambien. Hay que comunicarlo a la colateral y al Puesto de Mando (RGC art. 274.3).'
      :'La señal '+S.id+' no abre aunque el itinerario esté establecido ('+(WX.storm>0.5?'un rayo ha dañado su cable':'robo de cable')+'): avería en la apertura (RGC art. 274.1).')+
      ' Los trenes la rebasan con autorización (arts. 277 y 278)'+(S.kind==='salida'?'; al ser de salida en BAB, solo después de informar a la colateral por telefonema, y la autorización indica la vía del trayecto (art. 405.2).':'.')});
  if(lamp||S.kind==='salida')needAdd(inc,{k:'tel',tel:'av',g:'sig:'+S.id,on:'av',txt:'Señal '+S.id+(lamp?' apagada':' con avería en la apertura')+': comunícalo a la colateral y al Puesto de Mando.'});
  crewSend({inc:inc.id,k:'repara',who:'infra',base:'auto',n:2,spots:sigSpots(S),tArr:inc.rep-Math.round(Math.min(12*60,(inc.rep-sim.t)*0.55)),msg:'🔧 Vía y Obras ya trabaja en la señal '+S.id});
  return inc;},
 setup(inc){const S=inc.sig,H=inc.H;
  inc.blockRoute=R=>R.sig===S;inc.auth=(tr,R)=>!!(tr.rb&&tr.rb[S.id]);
  H.av=()=>{inc.avd=true;};
  H.avBad=()=>inc.avd?'':'Antes de autorizar el rebase de la señal de salida tienes que informar a la colateral (RGC art. 405.2).';
  inc.step=h=>{sigNeeds(inc,'rb',null,inc.lamp?'señal apagada':'avería en la apertura',S.kind==='salida'?'avBad':null);
    if(sim.t>=inc.rep&&crewOk(inc,'repara',240,inc.rep+600)){telLog('in','Mantenimiento','—','Reparada la señal '+S.id+'.');incEnd(inc,true);}};
  inc.chip=()=>inc.title;}};

/* Avería del paso a nivel: orden de precaución a cada tren, o un agente que lo guarde a mano */
IT.pn={n:'Avería del paso a nivel',w:4,wf:()=>{const x=wxI();return 1+3*x.st+1.5*x.ice;},can:()=>!PN.fault,go(){
  const inc=incNew('pn',{mv:true,sev:'stop',guard:false,title:'Avería del paso a nivel · lado '+NIVEL.pnLado,rep:sim.t+irnd(50,80)*60,
    desc:'Las semibarreras del paso a nivel del lado '+NIVEL.pnLado+' no bajan y no dan comprobación'+(WX.storm>0.5?' desde que cayó un rayo cerca':wxI().ice?' (el mecanismo se ha helado)':'')+'. Las señales que lo protegen ('+NIVEL.pnSenales+') no abren: cada tren necesita la autorización de rebase con la notificación «'+NIVEL.pnTxt+' sin protección» (RGC arts. 278 y 335), y el maquinista se detiene ante el paso a nivel antes de cruzarlo (art. 336). El Puesto de Mando puede mandar un agente de infraestructura que cierre las semibarreras a mano (art. 337).'});
  PN.fault=inc;
  needAdd(inc,{k:'sol',txt:'Paso a nivel sin protección.',btns:[{l:'Pedir al Puesto de Mando un agente para el paso a nivel',h:'guard'}]});
  crewSend({inc:inc.id,k:'repara',who:'infra',base:'pn',n:2,spots:[PNS.repN,PNS.repS],tArr:inc.rep-irnd(15,22)*60,msg:'🔧 Vía y Obras ya trabaja en el paso a nivel'});
  return inc;},
 setup(inc){
  inc.blockRoute=R=>!inc.guard&&R.secs.some(sc=>(sc.t==='v1'||sc.t==='v2')&&sc.a<=PN.x+2&&sc.b>=PN.x-2);
  inc.auth=(tr,R)=>!!(tr.rb&&tr.rb[R.sig.id]);
  inc.H.guard=()=>{inc.gAt=sim.t+irnd(10,15)*60;inc.st='Agente de infraestructura en camino · llega a las '+fmtHM(inc.gAt);
    crewSend({inc:inc.id,k:'guarda',who:'infra',base:'pn',n:1,spots:[PNS.guarda],tArr:inc.gAt-20});
    telLog('out','Puesto de Mando','—',NIVEL.pnTxt+' sin protección: semibarreras sin comprobación. Ruego envíen un agente de infraestructura.','ok');return true;};
  inc.step=h=>{
    if(inc.gAt&&!inc.guard&&sim.t>=inc.gAt&&crewOk(inc,'guarda',10,inc.gAt+300)){inc.guard=true;INC.ref=true;inc.st='Semibarreras cerradas a mano por un agente';toast('El agente ya guarda el paso a nivel: las señales vuelven a abrir');
      INC.needs.filter(n=>n.inc===inc).forEach(needDrop);}
    if(!inc.guard)sigNeeds(inc,'rb',null,'el paso a nivel no comprueba');
    if(sim.t>=inc.rep&&crewOk(inc,'repara',300,inc.rep+600)){telLog('in','Mantenimiento','—','Reparado el paso a nivel del lado '+NIVEL.pnLado+'.');incEnd(inc,true);}};
  inc.clean=()=>{PN.fault=null;};
  inc.chip=()=>(inc.guard?'PN guardado a mano · lado ':'PN sin protección · lado ')+NIVEL.pnLado;}};

/* Limitación temporal de velocidad: orden de precaución a cada tren que sale hacia ella */
function incLTV(f,why,urg){const s=sideOf(f.dir,f.zone),v=Math.round(f.v*3.6),V=viaN(f.dir);
  const inc=incNew('ltv',{f:f,dir:f.dir,sev:'warn',title:'LTV '+v+' km/h · '+trayN(s)+' · '+V,mot:'LTV a '+v+' km/h · '+V+' hacia '+SIDES[s],
    motTx:'Limitación temporal de velocidad a '+v+' km/h en la '+V+' del trayecto '+trayN(s)+' ('+why+').'+(urg?' No existen señales de limitación de velocidad.':''),
    lvTx:'Limitación temporal de velocidad a '+v+' km/h en la '+V+' del trayecto '+trayN(s)+', por '+why+', comunicada por el agente de infraestructura hasta las '+fmtHM(f.until)+'. No hay señales de limitación instaladas.',
    desc:'Limitación temporal de velocidad a '+v+' km/h en la '+V+' del trayecto '+trayN(s)+' ('+why+') hasta las '+fmtHM(f.until)+'. '+(urg?'La comunica el agente de infraestructura y no hay señales instaladas: telefonema a la colateral y al Puesto de Mando, y ningún tren sale hacia '+SIDES[s]+' sin la notificación (RGC art. 241).':'Cada tren que salga hacia '+SIDES[s]+' necesita la notificación.')});
  if(urg)needAdd(inc,{k:'tel',tel:'lv',g:viaG(s,viaOf(f.dir)),on:'lvOk',txt:'El agente de infraestructura comunica una limitación de '+v+' km/h en la '+V+' hacia '+SIDES[s]+': transmítela a '+SIDES[s]+' y al Puesto de Mando.'});
  return inc;}
IT.ltv={n:'Limitación temporal de velocidad urgente',w:4,wf:()=>1+1.5*wxI().rain,can:()=>true,go(){
  const dir=Math.random()<0.5?1:-1,hot=WX.m>=5&&WX.m<=8;
  const why=ipick(hot?['riesgo de garrote por el calor','un bache en la vía']:['un bache en la vía','traviesas en mal estado','trabajos urgentes de vía']);
  const f={dir:dir,zone:'out',from:sim.t,until:sim.t+irnd(40,90)*60,kind:'ltv',v:30/3.6};LINE.faults.push(f);
  const inc=incLTV(f,why,true);f.inc=inc;return inc;},
 setup(inc){inc.H.lvOk=()=>{inc.lvd=true;};inc.onPass=notifyPass(inc);inc.step=h=>{notifyStep(inc);if(sim.t>=inc.f.until)incEnd(inc,true);};inc.chip=()=>inc.title;}};

/* Animales en la vía: marcha a la vista en el trayecto */
IT.an={n:'Animales en la vía',w:5,wf:()=>{const x=wxI();return((x.hr>=6&&x.hr<9)||(x.hr>=18&&x.hr<22)?1.6:1)*(1+0.3*x.fog);},can:()=>!INC.list.some(i=>i.k==='an'),go(){
  const s=Math.random()<0.5?'B':'Q',D=dOf(s),what=ipick(['un rebaño de ovejas','vacas sueltas de una explotación cercana','corzos','un caballo suelto']);
  const until=sim.t+irnd(20,45)*60;
  const inc=incNew('an',{s:s,dir:D.dOut,until:until,sev:'warn',title:'Animales en la vía · '+trayN(s),mot:'Animales en la vía hacia '+SIDES[s],
    motTx:('Circulará con marcha a la vista entre '+NIVEL.nombre+' y ')+SIDES[s]+': hay '+what+' en la vía.',
    desc:'Un maquinista avisa de '+what+(' en la vía entre '+NIVEL.nombre+' y ')+SIDES[s]+'. La Guardia Civil va a retirarlos. Mientras, marcha a la vista en el trayecto, indicando al maquinista el motivo (RGC art. 141): cada tren que salga hacia '+SIDES[s]+' necesita la notificación ('+SIDES[s]+' notifica a los que vienen).'});
  LINE.faults.push({dir:D.dOut,zone:'out',from:sim.t,until:until,kind:'ltv',v:30/3.6,inc:inc},{dir:D.dIn,zone:'in',from:sim.t,until:until,kind:'ltv',v:30/3.6,inc:inc});
  return inc;},
 setup(inc){inc.onPass=notifyPass(inc);
  inc.step=h=>{notifyStep(inc);if(sim.t>=inc.until){telLog('in','Guardia Civil','—',('Retirados los animales de la vía entre '+NIVEL.nombre+' y ')+SIDES[inc.s]+'.');incEnd(inc,true);}};
  inc.chip=()=>inc.title;}};

/* corte y restablecimiento de tensión, común a catenaria, incendio y arrollamiento */
function tensionH(inc,cutTxt,workTxt){const H=inc.H;
  H.ct=()=>{inc.st='Esperando la confirmación del corte';aiSay(irnd(30,60),'Telemando de energía','ct',cutTxt,inc,'cut');};
  H.cut=()=>{inc.cut=true;if(workTxt){inc.rep=sim.t+irnd(workTxt[0],workTxt[1])*60;inc.st=workTxt[2]+' hasta las '+fmtHM(inc.rep)+' aprox.';}};
  H.rt=()=>{aiSay(irnd(20,40),'Telemando de energía','rt',('Tensión restablecida entre '+NIVEL.nombre+' y ')+SIDES[inc.s]+'.',inc,'endOk');};
  H.endOk=()=>incEnd(inc,true);
  H.ret=()=>{inc.retd=true;aiSay(irnd(10,25),SIDES[inc.s]+' y Puesto de Mando','ret','Enterados. No expedimos trenes por '+(inc.k==='cat'?'esa vía':'el trayecto')+'.');};}
const bothTracks=(inc,x)=>{const D=dOf(inc.s);return(x.dir===D.dIn&&x.zone==='in')||(x.dir===D.dOut&&x.zone==='out');};

/* Enganchón o caída de catenaria: corte de tensión, brigada y restablecimiento */
IT.cat={n:'Enganchón de catenaria',w:6,wf:()=>{const x=wxI();return 1+2.5*x.st+3*x.ice;},can:()=>!INC.list.some(i=>i.k==='cat'),go(o){
  const cand=TRAINS.filter(t=>!busyTr(t)&&lineTrain(t,400));
  let t=cand.length?ipick(cand):null,dir,zone,pos;if(o&&o.dir){t=null;dir=o.dir;zone=o.zone;const S0=LINE.side[dir];pos=irnd(1500,(zone==='in'?S0.Lin:S0.Lout)-1500);}
  else if(t){dir=t.dir;zone=t.zone;pos=t.p;}else{dir=Math.random()<0.5?1:-1;zone=Math.random()<0.5?'in':'out';const S=LINE.side[dir];pos=irnd(1500,(zone==='in'?S.Lin:S.Lout)-1500);}
  const s=sideOf(dir,zone),S=LINE.side[dir],km=kmF(zone==='in'?S.Lin-pos:pos),C=SIDES[s],V=viaN(dir);
  const inc=incNew('cat',{dir:dir,zone:zone,s:s,tr:t?t.id:null,pos:pos,km:km,v2:true,sev:'stop',title:(t?'Enganchón':'Catenaria caída')+' · '+trayN(s)+' · '+V,
    desc:(t?'El pantógrafo del '+trL(t)+' ha enganchado la catenaria a '+km+(' km de '+NIVEL.nombre+' y ha arrancado el hilo de contacto; el tren está parado en el trayecto'):'Ha disparado la subestación: catenaria caída en la '+V+' a '+km+(' km de '+NIVEL.nombre))+
      '. No hay tensión en la '+V+(' entre '+NIVEL.nombre+' y ')+C+'. La brigada no empieza hasta que el telemando de energía corte la tensión; al terminar, hay que pedir que la restablezcan.'});
  if(t)stallTrain(t,inc);inc.why=t?'enganchón del pantógrafo del tren '+t.svc.num:'catenaria caída';
  LINE.faults.push({dir:dir,zone:zone,a:0,until:Infinity,kind:'cat',inc:inc});
  inc.st='La brigada espera el corte de tensión';
  needAdd(inc,{k:'tel',tel:'ret',g:viaG(s,viaOf(dir)),on:'ret',txt:'La '+V+(' entre '+NIVEL.nombre+' y ')+C+' queda interceptada: comunícalo a '+C+' y al Puesto de Mando para que no expidan trenes por ella (RGC arts. 327 y 341.3). Los demás irán por la otra vía.'});
  needAdd(inc,{k:'tel',tel:'ct',g:viaG(s,viaOf(dir)),txt:'Catenaria dañada en la '+V+(' entre '+NIVEL.nombre+' y ')+C+': la brigada espera el corte de tensión (RGC art. 326).',on:'ct'});
  ttDecide(inc);   // the brigade: by the work train of the vía 5, or by road
  return inc;},
 setup(inc){const s=inc.s,C=SIDES[s],V=viaN(inc.dir);
  inc.noPow=x=>x.dir===inc.dir&&x.zone===inc.zone;
  if(inc.v2){ttH(inc);
    tensionH(inc,'Efectuado el corte de tensión en la '+V+(' entre '+NIVEL.nombre+' y ')+C+'. Puede autorizar los trabajos.',null);
    inc.step=h=>{
      if(!inc.rep&&inc.cut&&(inc.ttm?ttOnSite(inc):(inc.road&&sim.t>=inc.roadAt))){inc.rep=sim.t+Math.round(inc.ttm?irnd(30,50):irnd(40,65))*60;
        inc.st=(inc.ttm?'La brigada trabaja desde la vagoneta':'La brigada trabaja')+' hasta las '+fmtHM(inc.rep)+' aprox.';
        telLog('in','Brigada de catenaria','—','Empezamos a reparar la catenaria en el km '+inc.km+' de la '+V+'.');uiDirty=true;}
      else if(!inc.rep&&inc.ttm&&ttOnSite(inc)&&!inc.cut)inc.st='El tren de trabajos ha llegado · la brigada espera el corte de tensión';
      else if(!inc.rep&&inc.road&&sim.t>=inc.roadAt&&!inc.cut)inc.st='La brigada ha llegado · espera el corte de tensión';
      if(inc.rep&&!inc.fin&&sim.t>=inc.rep){
        if(inc.ttm&&!inc.ttRet){inc.ttRet=true;const t=ttOf(inc);if(t)t.work.go=true;inc.st='Reparado · el tren de trabajos vuelve: recíbelo en '+NIVEL.nombre;}
        if(!inc.ttm||ttBack(inc)){inc.fin=true;
          telLog('in','Brigada de catenaria','—','Terminada la reparación'+(inc.ttm?', y el tren de trabajos ya está en '+NIVEL.nombre:' y retirado el personal de la vía')+'. Puede pedir que restablezcan la tensión.');toast('☎ Brigada de catenaria: reparación terminada');
          inc.st='Reparado · pide que restablezcan la tensión';
          needAdd(inc,{k:'tel',tel:'rt',g:viaG(s,viaOf(inc.dir)),txt:'La brigada ha terminado en la '+V+(' entre '+NIVEL.nombre+' y ')+C+'.',on:'rt'});}}};
    inc.chip=()=>inc.title;return;}
  tensionH(inc,'Efectuado el corte de tensión en la '+V+(' entre '+NIVEL.nombre+' y ')+C+'. Puede autorizar los trabajos.',[35,60,'Corte efectuado · la brigada trabaja']);
  inc.step=h=>{if(inc.cut&&!inc.fin&&sim.t>=inc.rep){inc.fin=true;
    telLog('in','Brigada de catenaria','—','Terminada la reparación y retirado el personal de la vía. Puede pedir que restablezcan la tensión.');toast('☎ Brigada de catenaria: reparación terminada');
    inc.st='Reparado · pide que restablezcan la tensión';
    needAdd(inc,{k:'tel',tel:'rt',g:viaG(s,viaOf(inc.dir)),txt:'La brigada ha terminado en la '+V+(' entre '+NIVEL.nombre+' y ')+C+'.',on:'rt'});}};
  inc.chip=()=>inc.title;}};

/* Avería en la vía o en la señalización del trayecto: la vía queda interceptada (los trenes van por la otra) hasta que la
   brigada la repara; va con el tren de trabajos de la vía 5 o por carretera. Una avería de vía queda después con una
   limitación de velocidad mientras la reparación es provisional (carril embridado, vía recién recalzada) */
IT.ob={n:'Avería en la vía o la señalización del trayecto',w:3,
 wf:()=>{const x=wxI();return 1+2*x.ice+1.5*x.st+(WX.m>=5&&WX.m<=7&&x.hr>=13&&x.hr<=19?1.5:0);},can:()=>!INC.list.some(i=>i.k==='ob'),go(){
  const x=wxI(),hot=WX.m>=5&&WX.m<=7&&x.hr>=12&&x.hr<=20,C0=[['via','una rotura de carril',1+3*x.ice],['via','un descuadre de la vía, con varias traviesas partidas',0.6],
    ['sen','el cable de señalización cortado a pie de vía (robo de cobre)',1],['sen',x.st>0.5?'una señal de bloqueo derribada por el viento':'una señal de bloqueo derribada',0.5+1.5*x.st]];
  if(hot)C0.push(['via','un garrote: el carril se ha deformado con el calor',2.5]);
  let r=Math.random()*C0.reduce((a,c)=>a+c[2],0),c=C0[0];for(const q of C0){r-=q[2];if(r<=0){c=q;break;}}
  const dir=Math.random()<0.5?1:-1,zone=Math.random()<0.5?'in':'out',S=LINE.side[dir],L=zone==='in'?S.Lin:S.Lout,pos=irnd(1500,L-1500);
  const s=sideOf(dir,zone),V=viaN(dir),Cn=SIDES[s],km=kmF(zone==='in'?L-pos:pos),via=c[0]==='via';
  const inc=incNew('ob',{dir:dir,zone:zone,s:s,pos:pos,km:km,kind:c[0],cause:c[1],v2:true,sev:'stop',title:(via?'Avería de vía':'Avería de señalización')+' · '+trayN(s)+' · '+V,
    desc:(via?'El maquinista de un tren que acaba de pasar comunica un golpe fuerte en la '+V:'El CTC pierde la indicación de un cantón de la '+V)+' a '+km+(' km de '+NIVEL.nombre+', hacia ')+Cn+': '+c[1]+'. La vía queda interceptada hasta que la '+(via?'brigada de Vía y Obras':'brigada de Instalaciones de Seguridad')+' la repare; los trenes irán por la otra.'});
  LINE.faults.push({dir:dir,zone:zone,a:0,until:Infinity,kind:'ob',inc:inc});
  inc.st='Vía interceptada';inc.why=c[1];
  needAdd(inc,{k:'tel',tel:'ret',g:viaG(s,viaOf(dir)),on:'ret',txt:'La '+V+(' entre '+NIVEL.nombre+' y ')+Cn+' queda interceptada por '+c[1]+': comunícalo a '+Cn+' y al Puesto de Mando para que no expidan trenes por ella (RGC arts. 327 y 341.3).'});
  ttDecide(inc);
  return inc;},
 setup(inc){const s=inc.s,C=SIDES[s],V=viaN(inc.dir),via=inc.kind==='via',who=via?'Brigada de Vía y Obras':'Brigada de Instalaciones de Seguridad';ttH(inc);
  inc.H.ret=()=>{inc.retd=true;aiSay(irnd(10,25),C+' y Puesto de Mando','ret','Enterados. No expedimos trenes por esa vía.');};
  inc.step=h=>{
    if(!inc.rep&&(inc.ttm?ttOnSite(inc):(inc.road&&sim.t>=inc.roadAt))){inc.rep=sim.t+Math.round((via?irnd(45,75):irnd(30,50))*(inc.ttm?1:1.3))*60;
      inc.st=who+' trabajando'+(inc.ttm?' con el tren de trabajos':'')+' hasta las '+fmtHM(inc.rep)+' aprox.';
      telLog('in',who,'—','Empezamos en el km '+inc.km+' de la '+V+'.');uiDirty=true;}
    if(inc.rep&&!inc.fin&&sim.t>=inc.rep){
      if(inc.ttm&&!inc.ttRet){inc.ttRet=true;const t=ttOf(inc);if(t)t.work.go=true;inc.st='Reparado · el tren de trabajos vuelve: recíbelo en '+NIVEL.nombre;}
      if(!inc.ttm||ttBack(inc)){inc.fin=true;
        telLog('in',who,'—',(via?'Reparada la vía de forma provisional: queda limitada a 30 km/h unas horas':'Reparada la señalización')+'. Retirado el personal'+(inc.ttm?' y el tren de trabajos en '+NIVEL.nombre:'')+'. La vía puede quedar expedita.');
        toast('☎ '+who+': terminado');inc.st='Reparado · da la vía por expedita';
        needAdd(inc,{k:'sol',tag:'exp',txt:'La '+V+(' entre '+NIVEL.nombre+' y ')+C+' está reparada y sin nadie en ella: comunica a '+C+' y al Puesto de Mando que queda expedita'+(via?' (con limitación a 30 km/h)':'')+'.',btns:[{l:'Dar la vía por expedita',h:'expd'}]});}}};
  inc.H.expd=()=>{telLog('out',C+' y Puesto de Mando','—','Queda expedita la '+V+(' entre '+NIVEL.nombre+' y ')+C+(via?', con limitación temporal de velocidad a 30 km/h':'')+'.','ok');
    const f=via?{dir:inc.dir,zone:inc.zone,a:0,from:sim.t,until:sim.t+Math.round(irnd(120,240))*60,kind:'ltv',v:30/3.6}:null;
    incEnd(inc,true);if(f){LINE.faults.push(f);if(f.zone==='out')incLTV(f,'reparación provisional de la vía');}};
  inc.chip=()=>inc.title;}};

/* Incendio de vegetación junto a la vía (sobre todo en verano) */
IT.fu={n:'Incendio de vegetación',w:3,wf:()=>(WX.m>=5&&WX.m<=8?1:0.1)*(1-0.9*WX.rain),can:()=>!INC.list.some(i=>i.k==='fu'||i.k==='ar'),go(){
  const s=Math.random()<0.5?'B':'Q',D=dOf(s),C=SIDES[s],km=kmF(irnd(2000,8000));
  const inc=incNew('fu',{s:s,sev:'stop',title:'Incendio de vegetación · '+trayN(s),
    desc:'Arde el talud junto a la vía a '+km+(' km de '+NIVEL.nombre+', hacia ')+C+'. Los bomberos piden cerrar el trayecto y cortar la tensión para trabajar con agua; cuando lo apaguen habrá que restablecerla.'});
  LINE.faults.push({dir:D.dIn,zone:'in',a:0,until:Infinity,kind:'fu',inc:inc},{dir:D.dOut,zone:'out',a:0,until:Infinity,kind:'fu',inc:inc});
  inc.st='Bomberos en camino';inc.why='incendio de vegetación junto a la vía, a petición de los bomberos';
  needAdd(inc,{k:'tel',tel:'ret',g:'tray:'+s,txt:'Incendio junto a la vía hacia '+C+': los bomberos no pueden acercarse con trenes circulando.',on:'ret'});
  needAdd(inc,{k:'tel',tel:'ct',g:'tray:'+s,txt:('Los bomberos necesitan la catenaria sin tensión entre '+NIVEL.nombre+' y ')+C+' para echar agua.',on:'ct'});
  return inc;},
 setup(inc){const s=inc.s,C=SIDES[s];
  inc.noPow=x=>inc.cut&&bothTracks(inc,x);
  tensionH(inc,('Efectuado el corte de tensión entre '+NIVEL.nombre+' y ')+C+', ambas vías.',[30,60,'Bomberos trabajando']);
  inc.step=h=>{if(inc.cut&&!inc.fin&&sim.t>=inc.rep){inc.fin=true;
    telLog('in','Bomberos','—','Incendio extinguido. Retirados de la vía.');toast('☎ Bomberos: incendio extinguido');inc.st='Extinguido · pide que restablezcan la tensión';
    needAdd(inc,{k:'tel',tel:'rt',g:'tray:'+s,txt:('Los bomberos han terminado entre '+NIVEL.nombre+' y ')+C+'.',on:'rt'});}};
  inc.chip=()=>inc.title;}};

/* Arrollamiento: emergencias, cierre del trayecto (también la vía contigua) y corte de tensión */
IT.ar={n:'Arrollamiento',w:2,wf:()=>1+0.5*WX.fog,can:()=>!INC.list.some(i=>i.k==='fu'||i.k==='ar')&&TRAINS.some(t=>!busyTr(t)&&lineTrain(t,500)),go(){
  const t=ipick(TRAINS.filter(x=>!busyTr(x)&&lineTrain(x,500))),s=sideOf(t.dir,t.zone),D=dOf(s),S=LINE.side[t.dir],C=SIDES[s];
  const km=kmF(t.zone==='in'?S.Lin-t.p:t.p);
  const inc=incNew('ar',{tr:t.id,s:s,km:km,sev:'stop',title:'Arrollamiento · '+trayN(s),
    desc:'El '+trL(t)+' ha arrollado a una persona a '+km+(' km de '+NIVEL.nombre+' y está detenido. Hay que avisar a emergencias y a la Guardia Civil, cerrar el trayecto (también la vía contigua) y cortar la tensión mientras trabajan. La circulación se reanuda cuando el juez autorice el levantamiento.')});
  stallTrain(t,inc);inc.why='arrollamiento de una persona por el tren '+t.svc.num;
  LINE.faults.push({dir:D.dIn,zone:'in',a:0,until:Infinity,kind:'arr',inc:inc},{dir:D.dOut,zone:'out',a:0,until:Infinity,kind:'arr',inc:inc});
  needAdd(inc,{k:'sol',txt:'Persona arrollada por el '+trL(t)+'.',btns:[{l:'Avisar al 112 y a la Guardia Civil',h:'call'}]});
  needAdd(inc,{k:'tel',tel:'ret',g:'tray:'+s,txt:'Hay personal de emergencias junto a las dos vías hacia '+C+'.',on:'ret'});
  needAdd(inc,{k:'tel',tel:'ct',g:'tray:'+s,txt:'Para retirar a la víctima tienen que trabajar bajo la catenaria.',on:'ct'});
  return inc;},
 setup(inc){const s=inc.s,C=SIDES[s];
  inc.noPow=x=>inc.cut&&bothTracks(inc,x);
  tensionH(inc,('Efectuado el corte de tensión entre '+NIVEL.nombre+' y ')+C+', ambas vías.',null);
  inc.H.call=()=>{const t=T_(inc);inc.called=true;inc.rep=sim.t+irnd(50,90)*60;
    inc.st='Emergencias y Guardia Civil en camino · diligencias hasta las '+fmtHM(inc.rep)+' aprox.';
    telLog('out','112 · Guardia Civil','—','Arrollamiento de una persona por el tren '+(t?t.svc.num:'')+' a '+inc.km+(' km de '+NIVEL.nombre+', trayecto ')+trayN(s)+'.','ok');return true;};
  inc.step=h=>{if(inc.called&&inc.cut&&!inc.fin&&sim.t>=inc.rep){inc.fin=true;
    telLog('in','Guardia Civil','—','Terminadas las diligencias: el juez autoriza el levantamiento. Pueden reanudar la circulación.');toast('☎ Guardia Civil: terminadas las diligencias');
    inc.st='Levantamiento hecho · pide que restablezcan la tensión';
    needAdd(inc,{k:'tel',tel:'rt',g:'tray:'+s,txt:('Retirado el personal de emergencias entre '+NIVEL.nombre+' y ')+C+'.',on:'rt'});}};
  inc.chip=()=>inc.title;}};

/* Avería de tracción o de freno: decisión */
IT.tf={n:'Avería de tracción o freno',w:9,wf:()=>1+0.6*wxI().ice,can:()=>tfCands().length>0,go(){
  const t=ipick(tfCands()),line=t.zone==='in',what=ipick(['una avería de tracción','un freno agarrotado en un bogie','una pérdida de aire en la tubería de freno']);
  const inc=incNew('tf',{tr:t.id,sev:'stop',title:'Avería · '+trL(t),
    desc:'El maquinista del '+trL(t)+' comunica '+what+(line?' a '+kmF(LINE.side[t.dir].Lin-t.p)+(' km de '+NIVEL.nombre+'. El tren se ha quedado parado en el trayecto y ocupa el cantón.'):'. El tren no puede moverse de la vía '+vn(t.stopTrack||t.entryTrack)+'.')});
  stallTrain(t,inc);
  inc.H.decide(true);
  return inc;},
 setup(inc){const H=inc.H;
  H.decide=rearm=>{const t=T_(inc);if(!t)return;const line=t.zone==='in',O=[];
    if(rearm)O.push({l:'Que el maquinista intente rearmar',sub:'Parado 4–10′. Si no lo consigue, habrá que decidir otra vez.',h:'rearm'});
    if(line)O.push({l:('Que avance por sus medios hasta '+NIVEL.nombre+' y apartarlo allí'),sub:'Si el vehículo motor lo permite (RGC art. 553), a 30 km/h hasta la estación. Recíbelo en '+apTxt(t)+': queda fuera de servicio y una locomotora de socorro de Miranda vendrá a por él.',h:'slow'});
    O.push({l:line?'Pedir una locomotora de socorro':'Retirarlo del servicio y pedir socorro',
      sub:'Sale de Miranda de Ebro una 269 o una 319 como tren 91000 (unos 45′ hasta aquí). '+(line?(t.dir>0?'Irá por detrás y se lo llevará de vuelta a '+LINE.side[t.dir].prev+'.':'Pasará por '+NIVEL.nombre+' y saldrá a su encuentro por la vía en que está: tendrás que darle la salida por esa vía.'):
        ('Tendrás que meterla hasta él'+(TOPE[t.stopTrack]?' (en topera: entra en vía 3 y retrocede)':'')+' y darle la salida al conjunto.'+(t.md?' Los viajeros pasan al siguiente tren.':''))),h:'rescue'});
    decide(inc,{title:inc.title,text:inc.desc,opts:O});};
  H.rearm=()=>{inc.rearmAt=sim.t+irnd(4,10)*60;inc.st='El maquinista intenta rearmar';};
  H.slow=()=>{const t=T_(inc);inc.goAt=sim.t+120;t.vcap=30/3.6;t.vcapBy=inc;t.mustStop=inc;t.oos=inc;incTransfer(t);inc.park=true;inc.st=('En marcha reducida hacia '+NIVEL.nombre+' · apártalo en '+apTxt(t));};
  H.rescue=()=>{const t=T_(inc),line=t.zone==='in';
    if(line){const S=LINE.side[t.dir];telLog('in','Maquinista del '+t.svc.num,'68','Tren '+t.svc.num+' detenido en el km '+kmF(S.Lin-t.p)+' de la '+viaN(t.dir)+' entre '+S.prev+' y '+NIVEL.nombre+', por avería. Solicito socorro.');
      telLog('in','Puesto de Mando','—','Enterado. Pedimos la locomotora de socorro a Miranda de Ebro.');}
    if(!line){t.oos=inc;incTransfer(t);if(t.phase==='puertas')closeDoors(t);if(['parado','puertas','cerrando','listo'].indexOf(t.phase)>=0)t.phase='apartado';}
    const L=requestSocorro(inc,t,line?(t.dir>0?'lineBack':'lineFront'):'station');
    inc.st='Socorro '+L.svc.num+' en camino desde Miranda · por '+LINE.side[1].prev+' hacia las '+fmtHM(L.tReady);};
  inc.H.mt=n=>{const L=trById(n.tr);if(L)L.mtOk=true;};
  inc.step=h=>{const t=T_(inc);
    {const L=inc.soc&&trById(inc.soc);   // the convoy left with its head beyond the exit signal: «marche el tren»
      if(L&&L.socDone&&!L.mtOk&&(L.phase==='apartado'||L.phase==='listo')){const S=exitPassed(L);
        if(S)needAdd(inc,{k:'tel',tel:'mt',tr:L.id,txt:'El '+trL(L)+' tiene la cabeza rebasada la señal de salida '+S.id+' y no la ve: para salir necesita el telefonema MT 1 de «Marche el tren».',on:'mt'});}}
    if(!t)return;
    if(inc.rearmAt&&sim.t>=inc.rearmAt){inc.rearmAt=0;
      if(Math.random()<0.65){t.stall=null;toast('El '+t.svc.num+' ha rearmado y sigue');incEnd(inc,true);}
      else{inc.st='No ha conseguido rearmar';toast('El '+t.svc.num+' no consigue rearmar');H.decide(false);}return;}
    if(inc.goAt&&sim.t>=inc.goAt){inc.goAt=0;t.stall=null;}
    if(inc.park&&!inc.resAt&&!inc.soc&&t.spawned&&t.arrT&&t.v<0.1){stallTrain(t,inc);const L=requestSocorro(inc,t,'station');inc.st='Apartado fuera de servicio · socorro '+L.svc.num+' en camino desde Miranda';}
    if(inc.resAt&&sim.t>=inc.resAt){inc.resAt=0;t.stall=null;t.oos=null;t.mustStop=null;t.vcap=80/3.6;t.vcapBy=null;
      toast('Ha llegado la locomotora de socorro: el '+t.svc.num+' sigue remolcado a 80 km/h');incEnd(inc,true);}};}};

/* =====================================================================
   Socorro. Siempre sale de Miranda de Ebro (la estación cercana con locomotora disponible): una 269 o una 319 aislada,
   como tren especial de la serie 91000 (par hacia Burgos). Según dónde esté el tren averiado:
   · en la estación (vías 1, 2 o 3): entra desde Miranda por la vía libre que lleve a él y se acopla por el lado Miranda;
     el conjunto sale hacia Miranda con el número impar siguiente, sin maniobra;
   · en la vía 5 (en topera, solo se llega por el lado Burgos): entra en la vía 3 hasta la S2/3, retrocede por la aguja 7
     a 10 km/h y se acopla por el lado Burgos; el conjunto sale por la S2/5 hacia Burgos;
   · en el trayecto Briviesca – Santa Olalla: va por detrás, por la misma vía, en marcha a la vista, se acopla por la cola
     y se lo lleva de vuelta a Briviesca;
   · en el trayecto Santa Olalla – Quintanapalla: pasa por Santa Olalla y sale a su encuentro por la vía en la que está;
     se acopla en cabeza y el tren sigue remolcado hacia Santa Olalla y Miranda.
   En la vía ocupada por el tren averiado se entra con rebase autorizado en la señal de entrada (rojo y blanco, RGC art. 218):
   el maquinista para ante ella y sigue en marcha de maniobras (30 km/h como máximo tirando, art. 141) hasta el tren,
   a 10 km/h los últimos 40 m. No hace falta telefonema. La R que repite la entrada indica general o desviada.
   --------------------------------------------------------------------- */
const SOC={};
function socNum(){let m=90998;TRAINS.forEach(t=>{if(t.svc.type==='socorro')m=Math.max(m,t.svc.num&~1);});return m+2;}
function requestSocorro(inc,T,mode){
  const num=socNum(),lk=Math.random()<0.5?'319':'269';
  const loco=lk==='319'?{k:'loco319',L:L319,cab:2,num:UNITS319[Math.floor(Math.random()*UNITS319.length)]}:{k:'loco269',L:2*(R269.ZF+0.49),cab:2,panto:1};
  SOC[num]=[loco];
  const S=LINE.side[1],ready=sim.t+Math.round(irnd(12,20))*60+42000/(90/3.6);   // dispatched at Miranda, then 42 km to Briviesca
  const tSO=ready+runT(TYPE.socorro,S.Lin,false,mode==='station');
  const o={num:num,type:'socorro',dir:1,day:LINE.day,from:'Miranda de Ebro',to:mode==='station'?NIVEL.nombre:(mode==='lineBack'?S.prev:'el '+T.svc.num),lab:'Socorro'};
  if(mode==='station'){o.arr=tSO;o.dep=tSO;}else o.pass=tSO;
  const L=makeService(o);L.ext=0;L.tReady=ready;L.specsOv=[Object.assign({},loco)];L.len=loco.L;L.noScore=true;
  L.comp=(lk==='319'?'Locomotora '+loco.num:'Locomotora 269')+' aislada, de Miranda de Ebro';
  L.rescue={T:T.id,inc:inc.id,mode:mode};
  if(mode==='lineBack')L.alt=T.alt||null;
  if(mode==='lineFront')L.exitT=T.alt?normTrack(1):normTrack(-1);   // out by the track the train is on (against its direction)
  const ln=lk==='319'?loco.num:'269';
  telLog('in','Puesto de Mando','—','Sale de Miranda de Ebro la locomotora '+ln+' como tren '+num+' para socorrer al '+T.svc.num+
    (mode==='station'?(', apartado en '+NIVEL.nombre+'.'):mode==='lineBack'?(': irá por detrás, por la '+viaN(1)+', y lo llevará de vuelta a '+S.prev+'.'):
     (': pasará por '+NIVEL.nombre+' y saldrá a su encuentro por la vía en que está detenido.'))+' Por '+S.prev+' hacia las '+fmtHM(ready)+'.');
  if(mode==='station'){ROUTES.filter(R=>R.tr===T).forEach(releaseRoute);T.routeIn=T.routeOut=null;}
  else ROUTES.filter(R=>R.tr===T&&!R.passed).forEach(R=>{if(ROUTES.includes(R))cancelRoute(R);});   // it will not reach Santa Olalla on its own   // it will not move: its occupation protects it
  inc.soc=L.id;uiDirty=true;return L;
}
const socInc=L=>INC.list.find(i=>i.id===(L.rescue&&L.rescue.inc));
/* the stranded train's two ends on the board */
function socEnds(T){const a=pathAt(T.P,T.s),b=pathAt(T.P,T.s-T.len);return{X:a.t,w:Math.min(a.x,b.x),e:Math.max(a.x,b.x)};}
function socPlan(L){const T=trById(L.rescue.T);if(!T||T.done||!T.spawned)return{ok:false,msg:'El tren averiado no está en la estación'};
  const E=socEnds(T);
  if(TOPE[E.X]){const c=checkIn(L,RETRO[E.X]?RETRO[E.X].to:'v3',false);if(!c.exists)return{ok:false,msg:'No hay itinerario a la vía 3'};c.v5=true;c.E=E;return c;}
  const res=search(L.entryTrack,L.entrySig.x,L.dir,{kind:'sig',t:E.X,x:E.w-3},{});
  if(!res)return{ok:false,msg:'Desde la vía '+vn(L.entryTrack)+' no hay itinerario hasta el '+T.svc.num};
  const c=conflicts(res,L);return{ok:!c,msg:c||'',res:res,E:E};}
function socActions(L){const A=[],T=trById(L.rescue.T);if(!T||T.done)return A;
  const st=L.acople&&L.acople.stage;
  if(!st&&!L.routeIn&&(L.zone==='in'||L.spawned)&&(!L.spawned||L.phase==='aprox')){const c=socPlan(L);   // once it has left Briviesca: before, a train could get in front of it
    A.push(c.v5?{act:'soc',label:'A vía 3, para retroceder a la vía 5',primary:true,dis:!c.ok,title:c.ok?'Entra hasta la S2/3; luego retrocede por la aguja 7 hasta el '+T.svc.num+' (en topera)':c.msg}
               :{act:'soc',label:'Acoplarse al '+T.svc.num+(c.E?' · vía '+vn(c.E.X):''),primary:true,dis:!c.ok,title:c.ok?'Itinerario a la vía ocupada: la entrada da rebase autorizado (rojo y blanco); para ante ella y sigue en marcha de maniobras hasta el '+T.svc.num+' · se acopla por el lado '+NIVEL.lado.o:c.msg});}
  if(st==='v5wait'&&L.phase==='apartado'){const c=socPlanMan(L);
    A.push({act:'socman',label:'Retroceder a la vía 5 y acoplar',primary:true,dis:!c.ok,title:c.ok?'Por la aguja 7 a 10 km/h hasta el '+T.svc.num:c.msg});}
  return A;}
function socGo(L){const c=socPlan(L);if(!c.ok){toast(c.msg);return;}if(freezeCheck(c.res,L))return;const T=trById(L.rescue.T);
  if(c.v5){L.stopTrack=RETRO[c.E.X]?RETRO[c.E.X].to:'v3';L.stopX=stopOf(L.stopTrack,L.dir);L.acople={stage:'v5in'};}
  else{L.stopTrack=c.E.X;L.stopX=c.E.w-1.5;L.acople={stage:'go'};}
  const Rin=establish(L,c.res,'in',L.entrySig);if(!c.v5){Rin.rebase=true;refreshAspects();}   // into the occupied track: rebase autorizado
  toast(L.label+(c.v5?' → vía 3 (luego retroceso a la vía 5)':' → vía '+vn(c.E.X)+' ocupada · '+L.entrySig.id+' en rebase autorizado'));}
function socPlanMan(L){const T=trById(L.rescue.T);if(!T||T.done)return{ok:false,msg:'—'};const E=socEnds(T),xw=pathAt(L.P,L.s-L.len).x;
  const res=search(L.stopTrack,xw,-L.dir,{kind:'sig',t:E.X,x:E.e+3},{});if(!res)return{ok:false,msg:'No hay recorrido hasta la vía 5'};
  const own=ROUTES.filter(R=>R.tr===L),c=conflicts(res,L);return{ok:!c,msg:c||'',res:res,E:E};}
/* turn a train round where it stands: the same cars, running the other way */
/* a locomotive with a cab at each end (269, 319) just runs the other way; other vehicles keep their orientation */
const socRev=(c,turn)=>c.sp.cab===2?false:(turn?!c.rev:c.rev);
function socDispose(cars){cars.forEach(c=>{rel10k(c);scene.remove(c.g);c.g.traverse(o=>{if(o.isMesh&&o.geometry&&!o.geometry.userData.keep)o.geometry.dispose();});
    if(c.pools)c.pools.forEach(p=>p.m.material.dispose());c.body.forEach(m=>{const i=PICK.indexOf(m);if(i>=0)PICK.splice(i,1);});});}
function socRebuild(tr){socDispose(tr.cars);
  tr.cars=[];trainSpecs(tr).forEach((sp,i,a)=>{const c=buildCar(tr,sp,i,a.length);scene.add(c.g);tr.cars.push(c);});placeCars(tr);}
function socTurn(tr){const body=subPts(tr.P,Math.max(0,tr.s-tr.len-2),tr.s).reverse(),P=mkPath(body);
  tr.specsOv=tr.cars.slice().reverse().map(c=>Object.assign({},c.sp,{rev:socRev(c,true)}));
  tr.dir=-tr.dir;tr.P=P;tr.s=P.len;tr.v=0;afterPath(tr);socRebuild(tr);}
function socMan(L){const c=socPlanMan(L);if(!c.ok){toast(c.msg);return;}if(freezeCheck(c.res,L))return;
  ROUTES.filter(R=>R.tr===L).forEach(releaseRoute);L.routeIn=null;L.routeOut=null;
  socTurn(L);L.stopTrack=c.E.X;L.stopX=c.E.e+1.5;L.served=false;L.phase='entrando';L.acople.stage='man';
  establish(L,c.res,'man',null);placeCars(L);
  toast(L.label+' · retroceso a la vía '+vn(c.E.X)+' (10 km/h) hasta el '+trById(L.rescue.T).svc.num);}
/* speed when going to couple: 30 km/h (marcha a la vista) from the entry signal, 10 km/h in the last 40 m; maniobra at 10 */
function socCap(tr){const b=tr.ty.b,v1=10/3.6,v3=30/3.6;let v=Infinity;
  if(tr.acople.stage==='man')v=v1;
  else if(tr.acople.stage==='go'){const g=tr.sigs.find(q=>q.sig===tr.entrySig);if(g&&tr.s<g.s)v=Math.sqrt(v3*v3+2*b*(g.s-tr.s));else v=v3;}
  if(tr.stopS!==null&&tr.acople.stage!=='v5in'){const d=tr.stopS-40-tr.s;v=Math.min(v,d>0?Math.sqrt(v1*v1+2*b*d):v1);}
  return v;}
function socOnStop(L){const st=L.acople.stage,i=socInc(L),T=trById(L.rescue.T);
  if(st==='v5in'){L.acople.stage='v5wait';toast(L.label+' en vía 3: dale el retroceso a la vía 5');if(i)i.st='Locomotora en vía 3 · falta el retroceso hasta el '+T.svc.num;uiDirty=true;return;}
  if(st==='go'||st==='man')socCouple(L);}
/* the coupling: the locomotive takes the stranded train's cars and the convoy runs the other way from the one it came */
function socCouple(L){const T=trById(L.rescue.T),inc=socInc(L);if(!T||T.done){L.acople=null;return;}
  if(T.work){ttCouple(L,T);return;}
  ROUTES.filter(R=>R.tr===L||R.tr===T).forEach(releaseRoute);L.routeIn=L.routeOut=L.routeRet=null;
  const cd=-L.dir,hL=pathAt(L.P,L.s),hT=pathAt(T.P,T.s);
  const tCars=(Math.abs(hT.x-hL.x)<Math.abs(pathAt(T.P,T.s-T.len).x-hL.x))?T.cars.slice():T.cars.slice().reverse();   // from the end the loco is at
  const specs=L.cars.map(c=>Object.assign({},c.sp,{rev:socRev(c,true)})).concat(tCars.map(c=>Object.assign({},c.sp,{rev:T.dir!==cd?!c.rev:c.rev})));
  let tb=subPts(T.P,Math.max(0,T.s-T.len-2),T.s);if(T.dir!==cd)tb.reverse();
  let lb=subPts(L.P,Math.max(0,L.s-L.len),L.s);lb.reverse();
  const P=mkPath(tb.concat(lb));
  socDispose(T.cars);T.cars=[];if(T.frontMats){Object.values(T.frontMats).forEach(m=>{if(m.map)m.map.dispose();m.dispose();});T.frontMats=null;}
  L.specsOv=specs;L.len=specs.reduce((a,o)=>a+o.L,0);L.dir=cd;L.P=P;L.s=P.len;L.v=0;L.gap=0;
  const n0=L.svc.num;L.svc=Object.assign({},L.svc,{num:cd<0?n0+1:n0,dir:cd,from:NIVEL.nombre,to:cd<0?'Miranda de Ebro':'Burgos-Rosa de Lima',lab:'Socorro'});
  L.label='Socorro '+L.svc.num+' · con el '+T.svc.num;L.comp=L.comp.replace(' aislada, de Miranda de Ebro','')+' + '+T.comp+' (remolcado)';
  ENT[L.ent].name=L.label;ENT[L.ent].sub=L.svc.from+' → '+L.svc.to;
  L.stopTrack=socEnds(L).X;L.stopX=null;L.stopSig=null;/* held where it is: stopX set below, once the path is built */L.served=false;L.phase='apartado';L.arrT=sim.t;L.acople=null;L.socDone=true;
  L.exitT=null;L.vcap=80/3.6;L.vcapBy=null;L.towed=true;L.rescInc=inc?inc.id:null;
  T.cars=[];T.done=true;T.zone='end';T.phase='fin';T.stall=null;T.oos=null;T.towedBy=L.id;
  afterPath(L);repath(L,true);L.stopX=pathAt(L.P,L.s).x;afterPath(L);socRebuild(L);setJolt(L,L.specsOv.length-tCars.length,L.specsOv.length-1,-1);refreshAspects();repathAll();/* it does not move until it is given the departure */
  if(selId===T.ent)select(L.ent);
  if(inc){inc.tr=L.id;inc.st='Acoplada · dale salida al '+L.svc.num+' hacia '+(cd<0?'Miranda':'Burgos');}   // the incident now follows the convoy, until it leaves
  telLog('in','Maquinista del '+n0,'68','Acoplado al '+T.svc.num+' en la vía '+vn(L.stopTrack)+'. Pruebas de freno hechas: listos para salir hacia '+(cd<0?'Miranda de Ebro':'Burgos')+' como '+L.svc.num+'.');
  toast(L.label+' · acoplado: listo para salir');uiDirty=true;esqDirty=true;
}
/* on the line beyond the board */
function socLineEnter(dir,inq){TRAINS.forEach(t=>{if(t.dir!==dir||t.zone!=='pre'||!t.rescue||t.rescue.mode!=='lineBack'||sim.t<t.tReady)return;
  const T=trById(t.rescue.T);if(!T||T.done||T.zone!=='in')return;t.zone='in';t.p=0;t.lv=0;t.alt=T.alt||null;t.tEnter=sim.t;inq.push(t);uiDirty=true;});}
function socLineBack(L,h){const T=trById(L.rescue.T),inc=socInc(L);
  if(!T||T.done||T.zone!=='in'){L.done=true;L.zone='end';return;}
  if(L.cpl){if(sim.t>=L.cpl){const S=LINE.side[L.dir];T.done=true;T.zone='end';T.stall=null;T.oos=null;L.done=true;L.zone='end';
      telLog('in','Puesto de Mando','—','El '+T.svc.num+' ha llegado remolcado a '+S.prev+'. Queda libre la '+viaN(L.dir)+' entre '+S.prev+' y '+NIVEL.nombre+'.');
      toast('Socorro · el '+T.svc.num+' ya está en '+S.prev+': vía libre');if(inc)incEnd(inc,true);uiDirty=true;}return;}
  const lim=T.p-T.len-4;kinLine(L,lim,h,lim-L.p<LINE.C?30/3.6:Infinity);
  if(L.p>=lim-0.5&&L.lv<0.1){const S=LINE.side[L.dir];L.cpl=sim.t+Math.round(irnd(8,14))*60+(T.p)/(40/3.6);   // coupling, brake test and back to Briviesca at 40 km/h
    telLog('in','Maquinista del '+L.svc.num,'68','Acoplado a la cola del '+T.svc.num+'. Regresamos a '+S.prev+' por la '+viaN(L.dir)+'.');
    if(inc)inc.st='Acoplada · lo remolca de vuelta a '+S.prev+' (hasta las '+fmtHM(L.cpl)+')';uiDirty=true;}}
function socLineFront(L,h){const T=trById(L.rescue.T),inc=socInc(L),ST=LINE.side[-L.dir],S=LINE.side[L.dir];
  if(!T||T.done||T.zone!=='in'){const lim=S.Lout;kinLine(L,lim,h);if(L.p>=lim-0.5)arriveNext(L);return;}
  const lim=Math.min(S.Lout,ST.Lin-T.p)-4;
  if(L.cpl){if(sim.t>=L.cpl){const loco=Object.assign({},L.specsOv[0]);
      T.specsOv=[loco].concat(trainSpecs(T));T.len+=loco.L;T.p=Math.min(T.p+loco.L,ST.Lin-OFF);T.stall=null;T.oos=null;T.vcap=80/3.6;T.vcapBy=null;T.towed=true;T.noScore=true;T.mustStop=null;
      T.label='Socorro '+(L.svc.num+1)+' · con el '+T.svc.num;T.comp=L.comp.replace(' aislada, de Miranda de Ebro','')+' + '+T.comp+' (remolcado)';ENT[T.ent].name=T.label;
      L.done=true;L.zone='end';
      telLog('in','Maquinista del '+L.svc.num,'68','Acoplado en cabeza del '+T.svc.num+'. Seguimos como '+(L.svc.num+1)+' hacia '+NIVEL.nombre+' y Miranda de Ebro, remolcado a 80 km/h.');
      toast('Socorro · el '+T.svc.num+' sigue remolcado hacia '+NIVEL.nombre);if(inc)incEnd(inc,true);uiDirty=true;}return;}
  kinLine(L,lim,h,lim-L.p<LINE.C?30/3.6:Infinity);
  if(L.p>=lim-0.5&&L.lv<0.1){L.cpl=sim.t+Math.round(irnd(8,14))*60;
    telLog('in','Maquinista del '+L.svc.num,'68','Llegado al '+T.svc.num+' en el km '+kmF(ST.Lin-T.p)+'. Acoplando.');if(inc)inc.st='La locomotora ha llegado al '+T.svc.num+': acoplando';uiDirty=true;}}
/* =====================================================================
   Tren de trabajos. Vive en la vía 5, junto a la topera: los dos coches taller de mediana intervención, la vagoneta
   plataforma con las bobinas de hilo de contacto y la vagoneta castillete, todo acoplado. Sirve a las brigadas de
   catenaria, de Vía y Obras y de Instalaciones de Seguridad cuando una avería deja interceptada una vía del trayecto.
   No tiene locomotora: si se elige mandarlo (la alternativa es que la brigada vaya por carretera, más tarde), sale de
   Miranda de Ebro la 311 como máquina aislada y el jugador:
   · la recibe en la vía 3 y la retrocede por la aguja 7 hasta el tren, en la vía 5, donde se acopla por el lado Burgos;
   · da salida al tren hacia el trayecto por la vía interceptada: la salida queda en parada y el maquinista necesita la
     autorización de rebase; va en marcha a la vista hasta el punto de la avería (hacia Miranda, la 311 va empujando);
   · cuando la brigada termina, vuelve a Santa Olalla por la misma vía y hay que recibirlo: desde el lado Burgos entra
     directamente en la vía 5; desde el lado Miranda se recibe en la vía 3 y retrocede por la aguja 7 hasta la vía 5;
   · ya en la vía 5, la 311 se desacopla y vuelve a Miranda: hay que darle la salida (retroceso a la vía 3). Si antes
     hace falta otra vez el tren de trabajos, se acopla allí mismo.
   Diésel: puede circular sin tensión en la catenaria. No cuenta para la puntualidad.
   ===================================================================== */
/* from the topera (head, the train facing it) to the open end, where the 311 couples */
const TT_SPECS=[{k:'ttcast',L:5.2},{k:'ttbob',L:5.2},{k:'ttci',car:2,L:21.49},{k:'ttci',car:1,L:21.49}];
const TT_LEN=TT_SPECS.reduce((a,o)=>a+o.L,0),TT_LOCO={k:'loco311',L:14.36,num:'311',liv:'or'};
const TT_COMP='Coches taller SSA-1009 y SSA-1012, vagoneta plataforma con bobinas y vagoneta castillete';
const ttTrain=()=>TRAINS.find(t=>t.work);
const ttIncOf=t=>t&&t.work&&t.work.inc?INC.list.find(i=>i.id===t.work.inc&&!i.done):null;
const ttOf=inc=>{const t=ttTrain();return t&&t.work.inc===inc.id?t:null;};
/* parked in the vía 5, ahead of the buffer stop, facing it */
function ttPark(tr,track,xHead){
  const P=mkPath(walkCurrent(track,tr.dir<0?59:-151,tr.dir));tr.P=P;let s=sOfX(P,xHead,track);if(s===null)s=P.len-2;tr.s=s;
  tr.doorA=tmat(DOOR_C);tr.doorB=tmat(DOOR_C);
  trainSpecs(tr).forEach((sp,i,a)=>{const c=buildCar(tr,sp,i,a.length);scene.add(c.g);tr.cars.push(c);});
  Object.assign(tr,{spawned:true,done:false,zone:'vis',phase:'apartado',stopTrack:track,stopX:xHead,served:false,arrT:sim.t,v:0,lv:0,routeIn:null,routeOut:null});
  afterPath(tr);placeCars(tr);}
function ttEnsure(){if(ttTrain())return;
  const tr=makeService({num:97001,type:'trabajos',dir:-1,day:LINE.day||0,from:NIVEL.nombre,to:NIVEL.nombre,lab:'Tren de trabajos',pass:Infinity});
  tr.label='Tren de trabajos';ENT[tr.ent].name=tr.label;ENT[tr.ent].sub='Infraestructura · vía 5';
  tr.work={st:'base'};tr.noScore=true;tr.stops=false;tr.comp=TT_COMP;tr.len=TT_LEN;
  ttPark(tr,'v5',stopOf('v5',-1));}
function ttIn5(){const t=ttTrain();return!!(t&&t.spawned&&!t.done&&t.stopTrack==='v5');}
/* free to go: parked, with no other job */
function ttFree(){const t=ttTrain();return t&&t.work.st==='base'&&t.spawned&&!t.done&&t.phase==='apartado'&&!t.routeOut&&!t.routeIn?t:null;}
function ttOnSite(inc){const t=ttOf(inc);return!!(t&&t.work.st==='site');}
/* back in the station: past its entry signal, or parked */
function ttBack(inc){const t=ttTrain();if(!t||t.work.inc!==inc.id)return true;const w=t.work;
  return w.st==='base'||(w.st==='rod'&&w.rod&&w.rod.k==='arr')||(w.st==='arr'&&t.spawned&&((t.routeIn&&t.routeIn.passed)||t.phase==='apartado'||t.phase==='entrando'));}
/* the decision, when an incident closes a track of the line */
function ttDecide(inc){const t=ttFree(),C=SIDES[inc.s],V=viaN(inc.dir),
    who=inc.k==='cat'?'La brigada de catenaria':inc.kind==='sen'?'La brigada de Instalaciones de Seguridad':'La brigada de Vía y Obras';
  if(!t){inc.road=true;inc.roadAt=sim.t+Math.round(irnd(45,75))*60;inc.st=who+' va por carretera · llega hacia las '+fmtHM(inc.roadAt);
    telLog('in',who.replace('La b','B'),'—','El tren de trabajos no está disponible: vamos por carretera. Llegaremos hacia las '+fmtHM(inc.roadAt)+'.');return;}
  decide(inc,{title:inc.title,text:inc.desc+' '+who+' pregunta cómo va hasta el km '+inc.km+'.',opts:[
    {l:'Expedir el tren de trabajos de la vía 5',sub:(t.work.loco||ttLocoHere()?'La 311 está en la vía 5 y se acopla enseguida. ':'Sale de Miranda la 311 (unos 45′ hasta aquí): recíbela en la vía 3 y retrocédela por la aguja 7 hasta el tren para acoplarla. ')+'Lleva a la brigada y el material hasta la avería por la '+V+', interceptada. '+((inc.zone==='out'?inc.dir:-inc.dir)<0?'Hacia '+SIDES[inc.s]+' la 311 no puede ir empujando: el tren sale a la vía 3 y la locomotora da la vuelta por la vía 1 para ponerse en cabeza (y lo mismo a la vuelta). ':'')+'Tendrás que darle la salida con autorización de rebase y recibirlo a la vuelta en la vía 5'+(sideOf(-1,'in')===inc.s?' (entra directo)':' (por la vía 3 y en retroceso)')+'. Repara antes.',h:'ttGo'},
    {l:'Que la brigada vaya por carretera',sub:'Llega en 45–75′ y tarda algo más en reparar. El tren de trabajos se queda en la vía 5.',h:'road'}]});}
/* the handlers every incident that can use it shares */
function ttH(inc){const H=inc.H;
  H.ttGo=()=>{const t=ttFree();if(!t){H.road();return;}
    const S=LINE.side[inc.dir],mdir=inc.zone==='out'?inc.dir:-inc.dir,pOut=inc.zone==='out'?inc.pos:S.Lin-inc.pos,T=inc.tr&&trById(inc.tr);
    let tgt=pOut-90;if(T&&inc.zone==='out')tgt-=T.len;tgt=clamp(tgt,900,LINE.side[mdir].Lout-400);
    t.work={st:'ready',inc:inc.id,fdir:inc.dir,fzone:inc.zone,s:inc.s,mdir:mdir,tgt:tgt,km:kmF(pOut),loco:!!t.work.loco,lnum:t.work.lnum};
    inc.ttm=true;inc.tt=t.id;
    if(t.work.loco)ttReadyNeed(t,inc);
    else{const L=ttLocoHere();if(L)ttCouple(L,t);else{t.work.st='call';ttCallLoco(inc,t);inc.st='La 311 viene de Miranda a por el tren de trabajos: recíbela en la vía 3 y retrocédela hasta él';}}
    uiDirty=true;};
  H.road=()=>{if(inc.road)return;inc.road=true;inc.ttm=false;inc.roadAt=sim.t+Math.round(irnd(45,75))*60;
    const t=ttOf(inc);if(t&&t.work.st==='ready'){t.work={st:'base',loco:t.work.loco,lnum:t.work.lnum,uncAt:sim.t+60};t.exitT=null;}
    INC.needs.filter(n=>n.inc===inc&&n.tag==='ttdep').forEach(needDrop);
    inc.st='La brigada va por carretera · llega hacia las '+fmtHM(inc.roadAt);uiDirty=true;};
  H.ttShow=()=>{const t=ttTrain();if(t){select(t.ent);doTrainAct(t,'focus');}return false;};}
/* the work of the day: get it going, its telefonemas, and home again */
function ttStep(){const t=ttTrain();if(!t)return;const w=t.work,inc=ttIncOf(t);
  if(w.st==='ready'&&!inc){t.work={st:'base',loco:w.loco,lnum:w.lnum,uncAt:sim.t+60};t.exitT=null;uiDirty=true;return;}
  if(w.st==='ready'&&inc&&t.routeOut)INC.needs.filter(n=>n.inc===inc&&n.tag==='ttdep').forEach(needDrop);
  /* stopped at the exit signal held at stop by the closed track: the rebase */
  if(inc&&t.spawned&&t.blockedBy&&t.blockedBy.kind==='salida'&&t.routeOut&&t.blockedBy===t.routeOut.sig&&!(t.rb&&t.rb[t.blockedBy.id])){const S=t.blockedBy;
    needAdd(inc,{k:'tel',tel:'rb',tr:t.id,g:'sig:'+S.id,sig:S.id,on:'rb',txt:'El tren de trabajos está detenido ante la '+S.id+' en parada: la '+viaN(w.fdir)+' hacia '+SIDES[w.s]+' está interceptada. Autoriza al maquinista a rebasarla'+outAlso(t.routeOut).map(q=>', y con ella la '+q.id+', que tampoco abrirá').join('')+'; irá en marcha a la vista hasta el km '+w.km+'.'});}
  /* the run-round of the 311 (ttRodOut): stopped in the vía 3, the loco is cut after a minute */
  if(w.st==='rod'&&w.rod){const r=w.rod;
    if(r.st==='out'&&t.phase==='apartado'&&t.stopTrack==='v3'&&t.v<0.05){ROUTES.filter(R=>R.tr===t).forEach(releaseRoute);t.routeRet=null;t.shunt=false;
      const W=SW_BY.A7;if(W&&W.reverse&&W.lockPos==null&&!ROUTES.some(o=>o.req.A7==='R')){W.reverse=false;setSwitchVis(W);repathAll();}
      r.st='cut';r.at=sim.t+60;telLog('in','Maquinista del tren de trabajos','68','Detenidos en la vía 3 ante la S2/3. Cortamos la 311 para pasarla a la otra cabeza.');uiDirty=true;}
    if(r.st==='cut'&&sim.t>=r.at&&t.v<0.05)ttRodCut(t);
    return;}
  /* received in the vía 3 from the Miranda side with the 311 at the tail: it stops short, so that with the 311 round at
     the Burgos end the whole train stands between the aguja 7 and the S2/3 */
  if(w.st==='arr'&&t.spawned&&t.dir>0&&t.stopTrack==='v3'&&!t.served&&t.routeIn&&ttLocoBack(t,1)){
    const X=TT_CLR+t.len-trainSpecs(t)[ttLocoI(t)].L;if(Math.abs((t.stopX||0)-X)>0.1){t.stopX=X;afterPath(t);}}
  /* back from the Miranda side, received in the vía 3 with the 311 at the tail: it has to go round to the Burgos end */
  if(w.st==='arr'&&t.spawned&&t.phase==='apartado'&&t.stopTrack==='v3'&&!t.shunt&&!t.routeOut&&!(t.routeIn&&!t.routeIn.passed)&&t.v<0.05&&ttLocoBack(t,1)){
    ROUTES.filter(R=>R.tr===t).forEach(releaseRoute);t.routeIn=null;
    w.st='rod';w.rod={k:'arr',st:'cut',at:sim.t+60};telLog('in','Maquinista del tren de trabajos','68','En la vía 3. Cortamos la 311 para llevarla al lado Burgos del tren y meterlo en la vía 5.');uiDirty=true;return;}
  /* home: parked in the vía 5 again */
  if(w.st==='arr'&&t.spawned&&t.phase==='apartado'&&t.stopTrack==='v5'){t.work={st:'base',loco:w.loco,lnum:w.lnum,uncAt:sim.t+120};t.shunt=false;t.exitT=null;t.rb={};t.rbOk=null;
    toast('Tren de trabajos estacionado en la vía 5');uiDirty=true;}
  /* back at its base with the 311: after a couple of minutes it uncouples and goes home to Miranda */
  if(t.work.st==='base'&&t.work.loco&&t.spawned&&!t.done&&t.phase==='apartado'&&t.stopTrack==='v5'&&!t.routeOut&&!(t.routeIn&&!t.routeIn.passed)&&t.v<0.05&&sim.t>=(t.work.uncAt||0))ttUncouple(t);
  if(w.st==='arr'&&t.shunt&&t.phase==='apartado'){t.shunt=false;if(w.home===1){w.home=0;const c=ttPlanHome(t);if(c.ok)ttHome(t);}}}
/* on the line */
function ttLine(t,h){const w=t.work,inc=ttIncOf(t);
  if(t.zone==='out'){
    if(w.st==='out'){const lim=w.tgt,cap=(lim-t.p<400?30:60)/3.6;kinLine(t,lim,h,cap);
      if(t.p>=lim-0.5&&t.lv<0.1){w.st='site';w.t0=sim.t;
        telLog('in','Maquinista del tren de trabajos','68','Llegados al km '+w.km+' de la '+viaN(w.fdir)+'. La brigada baja a trabajar.');
        toast('Tren de trabajos en el km '+w.km+' · la brigada empieza');if(inc&&inc.H.ttSite)inc.H.ttSite();uiDirty=true;}}
    else if(w.st==='site'&&(!inc||w.go))ttReturn(t);
    return;}
  if(t.zone==='in'){const S=LINE.side[t.dir],Hp=S.Lin-OFF,busy=TRAINS.some(o=>o.zone==='vis'&&o.dir===t.dir&&o.phase==='aprox'&&o!==t);
    kinLine(t,Hp,h,(Hp-t.p<400?30:60)/3.6);
    if(t.p>=Hp-0.01&&!busy){t.done=false;t.cars=[];t.served=false;t.stopTrack=null;t.stopX=null;t.stopSig=null;t.rb={};t.rbOk=null;spawnTrain(t);w.st='arr';uiDirty=true;}}}
/* the brigade has finished: back the other way on the same track */
function ttReturn(t){const w=t.work,nd=-t.dir,S2=LINE.side[nd];
  t.p=Math.max(0,S2.Lin-t.p);t.dir=nd;t.zone='in';t.lv=0;t.alt=nd===w.fdir?null:sideOf(nd,'in');t.exitT=null;t.routeIn=t.routeOut=null;
  t.specsOv=trainSpecs(t).reverse().map(o=>Object.assign(o,{rev:!o.rev}));   // the same vehicles, now running the other way
  t.entryTrack=null;setEntry(t,normTrack(w.fdir));w.st='back';
  telLog('in','Maquinista del tren de trabajos','68','Terminado. Regresamos a '+NIVEL.nombre+' por la '+viaN(w.fdir)+'.');toast('Tren de trabajos: regresa a '+NIVEL.nombre);uiDirty=true;}
/* received in the vía 3 from the Miranda side: back into the vía 5 by the aguja 7 */
function ttPlanHome(t){if(!t.spawned||t.phase!=='apartado'||!t.P)return{ok:false,msg:'—'};
  const xw=pathAt(t.P,t.s-t.len).x,res=search(t.stopTrack,xw,-t.dir,{kind:'sig',t:'v5',x:stopOf('v5',-1)},{});if(!res)return{ok:false,msg:'No hay recorrido hasta la vía 5'};
  SW_SKIP=t;const c=conflicts(res,t);SW_SKIP=null;return{ok:!c,msg:c||'',res:res};}
/* the vía 3 clear of the aguja 7 (where the vía 5 leaves it at x 60) from here on; with the tail there, the head of the
   whole train (68 m) stays short of where the vía 3 fouls the vía 1 at the aguja 5 */
const TT_CLR=62;
function ttClearA7(t){return t.dir>0&&pathAt(t.P,t.s-t.len).x<TT_CLR-0.5;}
function ttPlanFwd(t){const h=pathAt(t.P,t.s),X=TT_CLR+t.len,res=search(h.t,h.x,t.dir,{kind:'sig',t:'v3',x:X},{});if(!res)return{ok:false,msg:'No hay recorrido por la vía 3'};
  const c=conflicts(res,t);return{ok:!c,msg:c||'',res:res,X:X};}
function ttHome(t){
  if(ttClearA7(t)){const f=ttPlanFwd(t);if(!f.ok){toast(f.msg);return;}if(freezeCheck(f.res,t))return;
    ROUTES.filter(R=>R.tr===t).forEach(releaseRoute);t.routeIn=null;t.routeOut=null;
    t.rbOk={};t.stopTrack='v3';t.stopX=f.X;t.served=false;t.phase='entrando';t.shunt=true;t.work.home=1;establish(t,f.res,'man',null);afterPath(t);
    toast('Tren de trabajos · avanza por la vía 3 hasta dejar libre la aguja 7');return;}
  const c=ttPlanHome(t);if(!c.ok){toast(c.msg);return;}if(freezeCheck(c.res,t))return;
  ROUTES.filter(R=>R.tr===t).forEach(releaseRoute);t.routeIn=null;t.routeOut=null;
  socTurn(t);t.rbOk={};t.stopTrack='v5';t.stopX=stopOf('v5',-1);t.served=false;t.phase='entrando';t.shunt=true;t.work.home=2;
  establish(t,c.res,'man',null);placeCars(t);toast('Tren de trabajos · retroceso a la vía 5 (10 km/h)');}
/* give it the departure: turned round if it has to leave by the other end, out by the closed track */
function ttDep(t){const w=t.work;if(w.st!=='ready')return;const inc=ttIncOf(t);
  if(t.stopTrack==='v5'&&ttLocoBack(t,w.mdir)){ttRodOut(t);return;}
  if(inc&&!inc.retd){toast('Antes, comunica la interceptación de la '+viaN(w.fdir)+' (telefonema)');return;}
  if(t.dir!==w.mdir){socTurn(t);repath(t,true);const h=pathAt(t.P,t.s);t.stopX=h.x;t.stopTrack=h.t;afterPath(t);}
  t.exitT=normTrack(w.fdir);const c=checkOut(t,t.stopTrack);if(!c.ok){toast(c.msg);return;}if(freezeCheck(c.res,t))return;
  if(c.res.ret){if(freezeCheck(c.res.ret,t))return;startRetro(t,c.res.ret);establish(t,c.res,'out',c.res.sig);}
  else{establish(t,c.res,'out',c.res.sig);t.phase='despachando';t.t0=sim.t;}
  w.st='go';toast('Salida · tren de trabajos hacia '+SIDES[w.s]+' por la '+viaN(w.fdir));uiDirty=true;}
function ttActions(tr){const A=[],w=tr.work;
  if(!tr.spawned||tr.done)return A;
  if(tr.routeIn&&!tr.routeIn.passed&&!tr.routeIn.released){const ok=canCancel(tr.routeIn);A.push({act:'cancel',label:'Anular itinerario',dis:!ok,title:ok?'Cierra la señal '+tr.routeIn.sig.id:'Demasiado cerca de la señal para pararlo'});}
  if(tr.phase==='aprox'&&!tr.routeIn)(tr.dir<0?['v5','v3']:['v3']).forEach(t=>{const c=checkIn(tr,t,true);if(!c.exists)return;
    A.push({act:'in:'+t,label:t==='v5'?'Recibir en vía 5':'Recibir en vía 3'+(tr.dir>0?' (luego, retroceso a la vía 5)':''),primary:t===(tr.dir<0?'v5':'v3'),dis:!c.ok,title:c.ok?(t==='v5'?'Entra hasta la topera, a su sitio':'Para ante la salida de la vía 3'):c.msg});});
  if(tr.phase==='apartado'&&!tr.routeOut){
    if(w.st==='ready'&&tr.stopTrack==='v5'&&ttLocoBack(tr,w.mdir)){const c=ttPlanOut(tr);A.push({act:'ttdep',label:'Sacar a la vía 3 para poner la 311 en cabeza',primary:true,dis:!c.ok,
      title:c.ok?'Hacia '+SIDES[w.s]+' la 311 iría empujando: sale de la vía 5 hasta la S2/3, corta la locomotora y esta da la vuelta por la vía 1 (rebasa la E1 y luego la R4) para acoplarse en cabeza':c.msg});
      A.push({act:'ttroad',label:'Que la brigada vaya por carretera',title:'El tren de trabajos se queda en la vía 5'});}
    else if(w.st==='ready'){const inc=ttIncOf(tr);A.push({act:'ttdep',label:'Salida hacia '+SIDES[w.s]+' · '+viaN(w.fdir),primary:true,dis:!inc||!inc.retd,
      title:inc&&!inc.retd?'Antes, comunica la interceptación de la '+viaN(w.fdir):'Por la vía interceptada hasta el km '+w.km+'. La salida quedará en parada: autoriza el rebase'});
      A.push({act:'ttroad',label:'Que la brigada vaya por carretera',title:'El tren de trabajos se queda en la vía 5'});}
    if(tr.stopTrack!=='v5'&&w.st!=='rod'){const fw=ttClearA7(tr),c=fw?ttPlanFwd(tr):ttPlanHome(tr);A.push({act:'tthome',label:'Maniobra a la vía 5',primary:true,dis:!c.ok,
      title:c.ok?(fw?'Avanza por la vía 3 hasta dejar libre la aguja 7 y luego retrocede a la vía 5, a 10 km/h':'Retrocede por la aguja 7 hasta la topera, a 10 km/h'):c.msg});}}
  if(!(tr.routeIn&&!tr.routeIn.passed&&!tr.routeIn.released)&&tr.routeOut&&!tr.routeOut.passed&&!tr.routeOut.released&&tr.phase!=='retroceso'){const ok=canCancel(tr.routeOut);
    A.push({act:'cancelOut',label:'Anular salida',dis:!ok,title:ok?'Cierra la señal '+tr.routeOut.sig.id:'Demasiado cerca de la señal'});}
  return A;}
function ttStatus(tr){const w=tr.work,S=LINE.side[tr.dir];
  if(!tr.spawned){if(tr.zone==='out'){if(w.st==='site')return{txt:'Trabajando en el km '+w.km+' de la '+viaN(w.fdir),cls:'warn'};
      return{txt:'En marcha a la vista hacia el km '+w.km+' · '+kmF(Math.max(0,w.tgt-tr.p))+' km',cls:'run'};}
    if(tr.zone==='in')return{txt:'Regresa a '+NIVEL.nombre+' por la '+viaN(w.fdir)+' · a '+kmF(Math.max(0,S.Lin-tr.p))+' km',cls:'run'};
    return{txt:'',cls:''};}
  if(w.st==='rod'&&w.rod){const L=TRAINS.find(o=>o.ttRod&&o.ttRod.T===tr.id&&!o.done);
    if(tr.phase==='entrando')return{txt:'Sale de la vía 5 hasta la S2/3 (10 km/h)',cls:'run'};
    if(w.rod.st==='cut')return{txt:'En vía 3 · cortando la 311 para pasarla a la otra cabeza',cls:'warn'};
    return{txt:'En vía 3 · sin locomotora: la 311 da la vuelta para acoplarse '+(w.rod.k==='dep'?'en cabeza':'por el lado Burgos'),cls:'warn'};}
  if(tr.phase==='apartado'){if(w.st==='call')return{txt:'En vía 5 · espera a la 311, que viene de Miranda',cls:'warn'};
    if(w.st==='ready')return{txt:'Preparado en vía '+vn(tr.stopTrack)+' · dale salida hacia '+SIDES[w.s],cls:'warn'};
    if(tr.stopTrack!=='v5')return{txt:'En vía '+vn(tr.stopTrack)+' · falta el retroceso a la vía 5',cls:'warn'};
    return{txt:'Estacionado en vía 5',cls:'ok'};}
  return null;}
/* the 311: called from Miranda, received and coupled like a socorro (the socorro machinery does the moves) */
function ttLocoHere(){return TRAINS.find(o=>o.ttLoco&&o.spawned&&!o.done&&o.stopTrack==='v5'&&o.phase==='apartado'&&!o.routeOut&&!o.routeIn)||null;}
function ttCallLoco(inc,T){
  const num=socNum(),loco=pick311();SOC[num]=[loco];   // whichever 311 Miranda has free
  const S=LINE.side[1],ready=sim.t+Math.round(irnd(8,14))*60+42000/(90/3.6),tSO=ready+runT(TYPE.socorro,S.Lin,false,true);
  const L=makeService({num:num,type:'socorro',dir:1,day:LINE.day,from:'Miranda de Ebro',to:NIVEL.nombre,lab:'Máquina aislada',arr:tSO,dep:tSO});
  L.ext=0;L.tReady=ready;L.specsOv=[Object.assign({},loco)];L.len=loco.L;L.noScore=true;L.diesel=true;L.ttLoco=true;
  L.comp='Locomotora '+loco.num+' aislada, de Miranda de Ebro';L.rescue={T:T.id,inc:inc.id,mode:'station',tt:true};T.work.lnum=num;
  telLog('in','Puesto de Mando','—','Sale de Miranda de Ebro la locomotora '+loco.num+' como máquina aislada '+num+' para llevar el tren de trabajos de la vía 5 de '+NIVEL.nombre+'. Por '+S.prev+' hacia las '+fmtHM(ready)+'.');
  uiDirty=true;return L;}
function ttReadyNeed(t,inc){t.work.st='ready';
  inc.st='Tren de trabajos en la vía 5: dale salida hacia '+SIDES[inc.s]+' por la '+viaN(inc.dir);
  telLog('out','Maquinista del tren de trabajos','—','Prepare el tren de trabajos para salir hacia '+SIDES[inc.s]+' por la '+viaN(inc.dir)+', interceptada, hasta el km '+inc.km+'.','ok');
  needAdd(inc,{k:'sol',tag:'ttdep',txt:'El tren de trabajos espera en la vía 5. Dale salida hacia '+SIDES[inc.s]+' por la '+viaN(inc.dir)+(inc.retd?'':' (antes, comunica la interceptación de esa vía)')+': la salida quedará en parada y el maquinista necesitará la autorización de rebase.',btns:[{l:'Ver el tren de trabajos',h:'ttShow'}]});}
/* the 311 couples at the open end of the train (the vía 3 side): both face the topera */
function ttCouple(L,T){const w=T.work,inc=ttIncOf(T);
  ROUTES.filter(R=>R.tr===L||R.tr===T).forEach(releaseRoute);L.routeIn=L.routeOut=L.routeRet=null;T.routeIn=T.routeOut=null;
  if(L.dir!==T.dir)socTurn(L);
  const lc=L.cars[0],loco=Object.assign({},lc.sp,{rev:lc.rev});
  const P=mkPath(subPts(L.P,Math.max(0,L.s-L.len),L.s).concat(subPts(T.P,Math.max(0,T.s-T.len),T.s)));
  socDispose(L.cars);L.cars=[];L.done=true;L.zone='end';L.phase='fin';L.acople=null;L.socDone=true;
  T.specsOv=trainSpecs(T).concat([loco]);T.len=T.specsOv.reduce((a,o)=>a+o.L,0);T.P=P;T.s=P.len;T.v=0;T.gap=0;
  afterPath(T);repath(T,true);afterPath(T);socRebuild(T);setJolt(T,0,T.specsOv.length-2,1);refreshAspects();repathAll();
  w.loco=true;w.lnum=L.svc.num;T.comp='Locomotora '+(loco.num||'311')+' + '+TT_COMP;
  if(selId===L.ent)select(T.ent);
  telLog('in','Maquinista de la '+(loco.num||'311'),'68','Acoplados al tren de trabajos en la vía 5. Pruebas de freno hechas.');
  toast('La 311 se ha acoplado al tren de trabajos');
  if(inc&&w.st!=='base')ttReadyNeed(T,inc);else w.st='base';
  uiDirty=true;esqDirty=true;}
/* home again: the 311 uncouples and stays in the vía 5, ready to leave for Miranda (or to take the train again) */
function ttUncouple(T){const sp=trainSpecs(T),i=sp.findIndex(o=>o.k==='loco311'||o.k==='ttloco');
  if(i<0||T.dir>0||i!==sp.length-1){T.work.loco=false;return;}
  ROUTES.filter(R=>R.tr===T).forEach(releaseRoute);T.routeIn=T.routeOut=null;
  const loco=sp[i],tail=pathAt(T.P,T.s-T.len);
  T.specsOv=sp.slice(0,i);T.len=T.specsOv.reduce((a,o)=>a+o.L,0);socRebuild(T);T.work.loco=false;T.comp=TT_COMP;
  const num=(T.work.lnum||socNum())+1;SOC[num]=[Object.assign({},loco)];
  const L=makeService({num:num,type:'socorro',dir:-1,day:LINE.day,from:NIVEL.nombre,to:'Miranda de Ebro',lab:'Máquina aislada',arr:sim.t,dep:sim.t+300});
  L.ext=0;L.specsOv=[Object.assign({},loco)];L.len=loco.L;L.noScore=true;L.diesel=true;L.ttLoco=true;L.comp='Locomotora '+(loco.num||'311')+' aislada';
  ttPark(L,'v5',tail.x+0.4);
  telLog('in','Maquinista de la '+(loco.num||'311'),'68','Desacoplados del tren de trabajos. Volvemos a Miranda de Ebro como '+num+': cuando pueda, denos la salida (retroceso a la vía 3).');
  toast('La 311 se ha desacoplado: dale salida hacia Miranda');refreshAspects();uiDirty=true;esqDirty=true;}
/* ---------------------------------------------------------------------
   La 311 no va empujando el tren de trabajos: cuando le tocaría (salida hacia Briviesca, por la vía 5 en topera; o de
   vuelta de Briviesca, recibido en la vía 3), da la vuelta al tren por la vía 1:
   · salida: el tren sale de la vía 5 hasta la S2/3 y se corta la 311, que rebasa la E1 (por la aguja 5 a la vía 1),
     retrocede por la vía 1 hasta rebasar la R4 y entra por la aguja 6 en la vía 3 para acoplarse en cabeza;
   · llegada: se corta la 311, que rebasa la R4 (por la aguja 6), recorre la vía 1 hasta rebasar la E1 y entra por la
     aguja 5 en la vía 3 para acoplarse por el lado Burgos; luego el tren retrocede a la vía 5 como siempre.
   Cada movimiento lo ordena el jugador como maniobra (30 km/h; 10 km/h para acoplar). En la vía 3 el tren queda con la
   cola libre de la aguja 7 y la 311 ante la S2/3, que está ya en la curva hacia la aguja 5.
   --------------------------------------------------------------------- */
const ttLocoI=t=>trainSpecs(t).findIndex(o=>o.k==='loco311'||o.k==='ttloco');
/* would the 311 be at the back running towards md? */
function ttLocoBack(t,md){const sp=trainSpecs(t),i=ttLocoI(t);if(i<0||sp.length<2)return false;return i!==(t.dir===md?0:sp.length-1);}
const revSp=o=>Object.assign({},o,{rev:o.cab===2?false:!o.rev});
const sigById=id=>SIGNALS.find(S=>S.id===id);
function ttPlanOut(t){const tl=pathAt(t.P,t.s-t.len),X=TT_CLR+t.len,res=search(tl.t,tl.x,-t.dir,{kind:'sig',t:'v3',x:X},{});
  if(!res)return{ok:false,msg:'No hay recorrido de la vía 5 a la vía 3'};const c=conflicts(res,t);return{ok:!c,msg:c||'',res:res,X:X};}
function ttRodOut(t){const c=ttPlanOut(t);if(!c.ok){toast(c.msg);return;}if(freezeCheck(c.res,t))return;
  ROUTES.filter(R=>R.tr===t).forEach(releaseRoute);t.routeIn=t.routeOut=null;
  socTurn(t);t.rbOk={};t.stopTrack='v3';t.stopX=c.X;t.served=false;t.phase='entrando';t.shunt=true;t.exitT=null;
  t.work.st='rod';t.work.rod={k:'dep',st:'out'};establish(t,c.res,'man',null);placeCars(t);
  toast('Tren de trabajos · sale de la vía 5 hasta la S2/3 (10 km/h)');uiDirty=true;}
/* the 311 cut from the train: a train of its own, in maniobra */
function ttRodCut(T){const w=T.work,sp=trainSpecs(T),i=ttLocoI(T);if(i<0){w.st=w.rod.k==='dep'?'ready':'arr';delete w.rod;return;}
  const lo=sp[i],front=i===0;let pts,ld,lsp;
  if(front){pts=subPts(T.P,T.s-lo.L,T.s);ld=T.dir;lsp=Object.assign({},lo);T.specsOv=sp.slice(1);T.s-=lo.L;}
  else{pts=subPts(T.P,Math.max(0,T.s-T.len),T.s-T.len+lo.L).reverse();ld=-T.dir;lsp=revSp(lo);T.specsOv=sp.slice(0,-1);}
  T.len=T.specsOv.reduce((a,o)=>a+o.L,0);T.stopX=pathAt(T.P,T.s).x;afterPath(T);socRebuild(T);w.loco=false;T.comp=TT_COMP;
  const num=socNum();SOC[num]=[Object.assign({},lsp)];
  const L=makeService({num:num,type:'socorro',dir:ld,day:LINE.day,from:NIVEL.nombre,to:NIVEL.nombre,lab:'Maniobra',arr:sim.t,dep:sim.t});
  L.ext=0;L.specsOv=[lsp];L.len=lo.L;L.noScore=true;L.diesel=true;L.comp='Locomotora '+(lo.num||'311')+' del tren de trabajos';
  L.label='Locomotora '+(lo.num||'311')+' · maniobra';ENT[L.ent].name=L.label;ENT[L.ent].sub='Da la vuelta al tren de trabajos';
  L.ttRod={T:T.id,k:w.rod.k,seq:w.rod.k==='dep'?['E1','R4','cpl']:['R4','E1','cpl'],i:0,mv:null};w.lnum=num;
  L.doorA=tmat(DOOR_C);L.doorB=tmat(DOOR_C);L.P=mkPath(pts);L.s=L.P.len;
  trainSpecs(L).forEach((o,j,a)=>{const c=buildCar(L,o,j,a.length);scene.add(c.g);L.cars.push(c);});
  const h=pathAt(L.P,L.s);
  Object.assign(L,{spawned:true,done:false,zone:'vis',phase:'apartado',stopTrack:h.t,stopX:h.x,served:false,arrT:sim.t,v:0,lv:0,routeIn:null,routeOut:null});
  afterPath(L);repath(L,true);placeCars(L);w.rod.st='loco';
  telLog('in','Maquinista de la '+(lo.num||'311'),'68','Locomotora cortada. Pido maniobra para '+ttRodTxt(L.ttRod.seq[0])+'.');
  toast('La 311 está cortada: dale la maniobra para '+ttRodTxt(L.ttRod.seq[0]));refreshAspects();uiDirty=true;esqDirty=true;}
const ttRodTxt=k=>k==='E1'?'rebasar la E1':k==='R4'?'rebasar la R4':'acoplarse al tren de trabajos';
/* one move: beyond the E1 (vía 1, Burgos side), beyond the R4 (vía 1, short of the E4 and clear of the paso a nivel), or
   into the vía 3 up to the cars */
function ttRodPlan(L){const r=L.ttRod,T=trById(r.T),k=r.seq[r.i];if(!T||T.done||!k)return{ok:false,msg:'—'};
  let md,X,goal,trk;
  if(k==='E1'){md=1;X=sigById('E1').x+L.len+12;goal={kind:'at',x:X};trk='v2';}
  else if(k==='R4'){md=-1;X=sigById('E4').x-1.5;goal={kind:'at',x:X};trk='v2';}   // between the R4 and the E4 there is no room clear of the paso a nivel: the head just past the E4
  else{const a=pathAt(T.P,T.s).x,b=pathAt(T.P,T.s-T.len).x;md=r.k==='dep'?1:-1;X=md>0?Math.min(a,b)-0.6:Math.max(a,b)+0.6;goal={kind:'sig',t:'v3',x:X};trk='v3';}
  const st=L.dir===md?pathAt(L.P,L.s):pathAt(L.P,L.s-L.len),res=search(st.t,st.x,md,goal,{});
  if(!res)return{ok:false,msg:'No hay recorrido para '+ttRodTxt(k)};
  if(k!=='cpl'&&TRAINS.some(o=>o!==L&&o.spawned&&!o.done&&o.dir===-md&&o.phase==='aprox'&&o.entryTrack==='v2'))return{ok:false,msg:'Se aproxima un tren por la vía 1 desde '+(md>0?'Quintanapalla':'Briviesca')};
  /* to couple, the end of the cars is not in its way */
  const chk=k==='cpl'?{req:res.req,secs:res.secs.map(sc=>sc.t!==trk?sc:md>0?mkSec(sc.t,sc.a,Math.min(sc.b,X-2)):mkSec(sc.t,Math.max(sc.a,X+2),sc.b))}:res;
  const c=conflicts(chk,L);return{ok:!c,msg:c||'',res:res,X:X,md:md,trk:trk,k:k};}
function ttRodGo(L){const c=ttRodPlan(L);if(!c.ok){toast(c.msg);return;}if(freezeCheck(c.res,L))return;
  ROUTES.filter(R=>R.tr===L).forEach(releaseRoute);L.routeIn=L.routeOut=L.routeRet=null;
  if(L.dir!==c.md)socTurn(L);L.rbOk={};
  L.stopTrack=c.trk;L.stopX=c.X;L.served=false;L.phase='entrando';L.shunt=c.k==='cpl';L.ttRod.mv=c.k;
  establish(L,c.res,'man',null);afterPath(L);placeCars(L);
  toast(L.label+' · '+ttRodTxt(c.k)+(c.k==='cpl'?' (10 km/h)':' (30 km/h)'));uiDirty=true;}
function ttRodStop(L){const r=L.ttRod,k=r.mv;if(!k)return;r.mv=null;
  ROUTES.filter(R=>R.tr===L).forEach(releaseRoute);L.routeRet=null;L.shunt=false;r.i++;
  if(k==='cpl'){ttRodCouple(L);return;}
  const n=r.seq[r.i];telLog('in','Maquinista de la 311','68',(k==='E1'?'Rebasada la E1 por la vía 1':'Rebasada la R4 por la vía 1')+'. Pido maniobra para '+ttRodTxt(n)+'.');
  refreshAspects();uiDirty=true;}
/* coupled at the other end: the 311 heads the train, away from the cars */
function ttRodCouple(L){const r=L.ttRod,T=trById(r.T);if(!T||T.done)return;const w=T.work;
  ROUTES.filter(R=>R.tr===L||R.tr===T).forEach(releaseRoute);T.routeIn=T.routeOut=T.routeRet=null;
  const dd=-L.dir,lb=subPts(L.P,Math.max(0,L.s-L.len),L.s).reverse(),hT=pathAt(T.P,T.s),tT=pathAt(T.P,T.s-T.len),near=lb[0];
  let tb=subPts(T.P,Math.max(0,T.s-T.len),T.s);const headNear=Math.hypot(hT.x-near.x,hT.z-near.z)<Math.hypot(tT.x-near.x,tT.z-near.z);if(!headNear)tb.reverse();
  const loco=revSp(Object.assign({},L.cars[0].sp,{rev:L.cars[0].rev})),tsp=T.dir===dd?trainSpecs(T):trainSpecs(T).reverse().map(revSp);
  socDispose(L.cars);L.cars=[];L.done=true;L.zone='end';L.phase='fin';L.tEnd=sim.t;
  T.specsOv=[loco].concat(tsp);T.len=T.specsOv.reduce((a,o)=>a+o.L,0);T.dir=dd;T.P=mkPath(tb.concat(lb));T.s=T.P.len;T.v=0;T.gap=0;
  T.stopTrack='v3';T.stopX=null;afterPath(T);repath(T,true);T.stopX=pathAt(T.P,T.s).x;afterPath(T);socRebuild(T);setJolt(T,1,T.specsOv.length-1,-1);
  T.phase='apartado';T.served=false;T.shunt=false;w.loco=true;w.lnum=L.svc.num;T.comp='Locomotora '+(loco.num||'311')+' + '+TT_COMP;
  const inc=ttIncOf(T);
  if(w.rod&&w.rod.k==='dep'){w.st='ready';if(inc)inc.st='Tren de trabajos en la vía 3 con la 311 en cabeza: dale salida hacia '+SIDES[w.s]+' por la '+viaN(w.fdir);
    telLog('in','Maquinista del tren de trabajos','68','La 311 acoplada en cabeza en la vía 3. Pruebas de freno hechas: listos para salir hacia '+SIDES[w.s]+'.');toast('La 311 ya está en cabeza: dale salida');}
  else{w.st='arr';telLog('in','Maquinista del tren de trabajos','68','La 311 acoplada por el lado Burgos. Listos para retroceder a la vía 5.');toast('La 311 acoplada: dale la maniobra a la vía 5');}
  delete w.rod;if(selId===L.ent)select(T.ent);refreshAspects();repathAll();uiDirty=true;esqDirty=true;}
function ttRodActions(L){const A=[];if(L.done||!L.spawned||L.phase!=='apartado'||L.ttRod.mv)return A;
  const k=L.ttRod.seq[L.ttRod.i];if(!k)return A;const c=ttRodPlan(L);
  A.push({act:'ttrod',label:k==='E1'?'Maniobra: rebasar la E1 por la vía 1':k==='R4'?'Maniobra: rebasar la R4 por la vía 1':'Maniobra a la vía 3 y acoplar',primary:true,dis:!c.ok,
    title:c.ok?(k==='E1'?'Por la aguja 5 a la vía 1 y hasta pasada la E1':k==='R4'?'Por la vía 1 hasta pasada la R4, ante la E4':'Por la aguja '+(L.ttRod.k==='dep'?'6':'5')+' a la vía 3, hasta el tren de trabajos (10 km/h)'):c.msg});
  return A;}
function ttRodStatus(L){const k=L.ttRod.seq[L.ttRod.i];
  if(L.phase==='entrando')return{txt:'En maniobra · '+ttRodTxt(L.ttRod.mv||k),cls:'run'};
  if(L.phase==='apartado'&&k)return{txt:'Parada en vía '+vn(L.stopTrack)+' · espera la maniobra para '+ttRodTxt(k),cls:'warn'};return null;}
/* beyond the E1 the loco stands in the way of trains coming from Quintanapalla on the vía 1: they wait on the line */
function ttRodHold(t){if(t.entryTrack!=='v2')return false;const L=TRAINS.find(o=>o.ttRod&&o.spawned&&!o.done);if(!L)return false;
  const E=sigById(t.dir<0?'E1':'E4'),out=x=>(x-E.x)*t.dir<15;
  return bodyPts(L).some(q=>q.t==='v2'&&out(q.x))||!!(L.routeRet&&L.routeRet.secs.some(sc=>sc.t==='v2'&&out(t.dir<0?sc.b:sc.a)));}
/* saves from before the new models: the old consist (with its own loco) becomes the new one */
function ttMigrate(){TRAINS.forEach(t=>{if(!t.work)return;const sp=t.specsOv||[];
  if(sp.some(o=>o.k==='ttci'&&o.L!==RCI.L)){sp.forEach(o=>{if(o.k==='ttci')o.L=RCI.L;});t.len=sp.reduce((a,o)=>a+o.L,0);}
  if(sp.some(o=>/^(ttloco|ttcar|ttplat|vagoneta)$/.test(o.k))||(!t.specsOv&&Math.abs(t.len-TT_LEN)>0.5)){t.specsOv=null;t.len=TT_LEN;t.comp=TT_COMP;t.work.loco=false;}});}
/* ---------------------------------------------------------------------
   Los vehículos del tren de trabajos (paquetes de SpainTrainzRutas e Idefix, uso privado), low poly como el resto:
   · Renfe 311 (Henschel DHG 1200 BB), del paquete de MSTS «STR_Renfe311»: bastidor de ±1.41 hasta 1.49 m, capós de
     ±0.93 hasta 3.07 m, cabina de ±1.41 con el techo a 4.20 m, topes a −7.25/+7.10, bogies a −3.82/+3.74 con ejes a
     2.44 m y ruedas de 1.04 m. Costados, techo y testeros pintados en limpio sobre un atlas con la distribución del
     modelo original (puertas, rejillas, ventanas), sin la galleta de RENFE. Capó largo (radiador) hacia −z.
   · Coches taller de mediana intervención SSA-1009 y SSA-1012 (paquete de Trainz): caja de ±10.28 × ±1.47, costados,
     testeros y techo con las texturas originales, sin la palabra RENFE; el segundo, renumerado.
   · Vagoneta plataforma con dos bobinas de hilo de cobre en sus caballetes, y vagoneta castillete (RailWorks, Idefix):
     4.44 m, dos ejes, procedurales con las cotas de los modelos.
   --------------------------------------------------------------------- */
const R311={L:14.36,zc:-0.074,PPM:80,W:2048,H:1024,V1:4.34385,U0:7.35182,U0R:7.20440,U0F:1.61008,U0B:1.61232,T1:1.61008,
  BOG:[-3.82,3.74],AX:1.22,RW:0.52,HE:[-6.40,6.20],CAB:[-0.84,1.99],FE:[-6.66,6.51]};
const uv311=(c,r)=>[c/R311.W,1-r/R311.H];
/* the atlas: side from −x (rows 0–355), side from +x (355–710), roof (710–967), front from +z and rear from −z (columns 1164 and 1421) */
function uvf311(f,p){const P=R311.PPM,x=p[0],y=p[1],z=p[2];
  if(f==='-x')return uv311((z+R311.U0)*P,(R311.V1-y)*P);
  if(f==='+x')return uv311((R311.U0R-z)*P,355+(R311.V1-y)*P);
  if(f==='+y')return uv311((z+R311.U0)*P,710+(R311.T1-x)*P);
  if(f==='+z')return uv311(1164+(R311.U0F-x)*P,(R311.V1-y)*P);
  return uv311(1421+(x+R311.U0B)*P,(R311.V1-y)*P);}
const N311={'-x':[-1,0,0],'+x':[1,0,0],'+y':[0,1,0],'+z':[0,0,1],'-z':[0,0,-1]};
function box311(T,x0,x1,y0,y1,z0,z1,faces){
  const F={'-x':[[x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1]],'+x':[[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]],
    '+y':[[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],'+z':[[x1,y0,z1],[x0,y0,z1],[x0,y1,z1],[x1,y1,z1]],'-z':[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0]]};
  faces.split(' ').forEach(f=>quadN(T,F[f],F[f].map(p=>uvf311(f,p)),N311[f]));}
/* convex polygon as a fan, with the uv of a view */
function fanUV(T,pts,n,uvf){const o=T.pos.length/3;pts.forEach(p=>{T.pos.push(p[0],p[1],p[2]);const t=uvf(p);T.uv.push(t[0],t[1]);});
  for(let i=1;i<pts.length-1;i++){const a=pts[0],b=pts[i],c=pts[i+1],e1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],e2=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const x=[e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0]];if(x[0]*n[0]+x[1]*n[1]+x[2]*n[2]>=0)T.idx.push(o,o+i,o+i+1);else T.idx.push(o,o+i+1,o+i);}}
/* a flat disc (lamp lens) facing ±z, baked in place so the night glow finds it */
function discA(x,y,z,r,e){const A=arrNew(),n=10;A.pos.push(x,y,z);A.uv.push(0,0);
  for(let i=0;i<n;i++){const a=i/n*TAU;A.pos.push(x+Math.cos(a)*r,y+Math.sin(a)*r,z);A.uv.push(0,0);}
  for(let i=0;i<n;i++){const j=(i+1)%n;if(e>0)A.idx.push(0,1+i,1+j);else A.idx.push(0,1+j,1+i);}return A;}
function parts311(){
  const T=arrNew(),M={};const add=(k,A)=>{if(!M[k])M[k]=arrNew();arrPush(M[k],A);};
  const[fa,fb]=R311.FE,[ha,hb]=R311.HE,[ca,cb]=R311.CAB;
  box311(T,-1.41,1.41,1.27,1.49,fa,fb,'-x +x +y +z -z');                 // bastidor and walkways
  box311(T,-1.41,1.41,0.62,1.27,fa,fa+0.30,'-x +x -z');box311(T,-1.41,1.41,0.62,1.27,fb-0.30,fb,'-x +x +z');   // buffer beams
  box311(T,-0.93,0.93,1.49,3.07,ha,ca,'-x +x +y -z');                     // long hood (radiator end)
  box311(T,-0.93,0.93,1.49,3.07,cb,hb,'-x +x +y +z');                     // short hood
  box311(T,-1.15,1.15,0.36,1.27,-1.20,1.30,'-x +x');add('dark',boxA(0,0.38,0.05,2.2,0.88,2.44));   // fuel tank and reservoirs
  // the cab: its section lofted from the rear wall to the front, the walls closed with the end views, the brown roof over it
  const half=[[1.41,1.49],[1.41,3.40],[1.24,3.80],[0.85,4.10],[0,4.20]],ring=half.map(p=>[-p[0],p[1]]).concat(half.slice(0,-1).reverse());
  for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;let n=[b[1]-a[1],a[0]-b[0],0];if(n[0]*mx+n[1]*(my-2.6)<0)n=[-n[0],-n[1],0];
    const f=Math.abs(n[0])>Math.abs(n[1])*1.2?(n[0]<0?'-x':'+x'):'+y',q=[[a[0],a[1],ca],[b[0],b[1],ca],[b[0],b[1],cb],[a[0],a[1],cb]];
    quadN(T,q,q.map(p=>uvf311(f,p)),n);}
  fanUV(T,ring.map(p=>[p[0],p[1],cb]),[0,0,1],p=>uvf311('+z',p));fanUV(T,ring.map(p=>[p[0],p[1],ca]),[0,0,-1],p=>uvf311('-z',p));
  box311(T,-1.0,1.0,4.12,4.24,ca-0.02,cb+0.30,'-x +x +y +z -z');          // roof with the sun visor over the front windows
  add('tex',T);
  // bogies: outside frames, axleboxes with their springs, the cardan shafts' gearboxes
  R311.BOG.forEach(zc=>{[-1,1].forEach(s=>{add('bogie',boxA(s*1.10,0.36,zc,0.18,0.44,3.4));add('bogie',boxA(s*1.10,0.80,zc,0.24,0.10,1.4));
      [-1,1].forEach(k=>{const z=zc+k*R311.AX;add('wheel',cylA(s*0.80,R311.RW,z,R311.RW,0.13,16,0,0,PI/2));add('bogie',boxA(s*1.12,0.28,z,0.30,0.40,0.42));add('dark',cylA(s*1.12,0.86,z,0.11,0.32,8));});});
    [-1,1].forEach(k=>{add('dark',cylA(0,R311.RW,zc+k*R311.AX,0.08,1.6,8,0,0,PI/2));add('dark',boxA(0,0.28,zc+k*R311.AX*0.55,0.6,0.5,0.5));});
    add('bogie',boxA(0,0.64,zc,2.1,0.22,0.7));});
  // buffers, hooks and the stone guards
  [[fa,-1],[fb,1]].forEach(([z0,e])=>{[-1,1].forEach(s=>{add('dark',cylA(s*0.875,1.06,z0+e*0.26,0.11,0.52,10,PI/2,0,0));add('buf',cylA(s*0.875,1.06,z0+e*0.56,0.21,0.05,14,PI/2,0,0));});
    add('dark',boxA(0,0.92,z0+e*0.20,0.26,0.24,0.40));add('dark',boxA(0,0.22,z0-e*0.35,2.3,0.30,0.06));});
  return M;
}
let P311=null,MAT311={},MATCI=null;
/* the 311 painted clean, in the flat style of the set, on the same atlas layout the model's uvs use (sides, roof, ends at
   80 px/m): Renfe orange with the two cream stripes, the hood doors with their louvres where the model has them, the cab
   windows and door, the brown frame and buffer beams with the black and yellow chevrons, the walkways and the radiator fan */
/* two liveries, as in the package: the original Renfe orange (311-001) and the grey and red of the Unidad de Negocio de
   Cargas, with the big black «311» on the long hood (without the Cargas and Renfe emblems); generic, with no unit number */
const LIV311={
  or:{orange:'#E8741E',orange2:'#C95F14',cab:'#E8741E',cream:'#F3DFB4',brown:'#6A3A26',brown2:'#4E2A1C',walk:'#6C6E6B',walk2:'#5A5C59',
    joint:'rgba(70,30,6,.38)',slat:'rgba(60,24,4,.55)',slatL:'rgba(255,214,160,.35)',rubber:'#141618',glass:'#262B30',glass2:'#55606A',
    roof:'#5A3424',fan:'#3A3C3E',yellow:'#E9B21E',black:'#1C1C1C',num:'#3E220F',chev:true,hex:0xE0782A},
  cg:{orange:'#AEB9C1',orange2:'#8E99A1',cab:'#C5322B',cream:null,brown:'#56616B',brown2:'#3F4952',walk:'#6C6E6B',walk2:'#5A5C59',
    joint:'rgba(28,38,48,.34)',slat:'rgba(22,30,38,.55)',slatL:'rgba(255,255,255,.28)',rubber:'#141618',glass:'#262B30',glass2:'#55606A',
    roof:'#98A3AB',fan:'#3A3C3E',yellow:'#E9B21E',black:'#1C1C1C',num:'#F0B81E',big:'#161718',chev:false,hex:0xAEB9C1}};
/* a generic 311 in either livery: just «311», with no unit number */
const pick311=liv=>({k:'loco311',L:14.36,num:'311',liv:liv||(Math.random()<0.5?'or':'cg')});
const D311={
  louvH:[[-5.29,-5.04,0],[-4.69,-4.26,1],[-4.10,-3.73,1],[-3.66,-3.26,1],[-3.07,-2.69,1],[-2.63,-2.26,1],[-1.88,-1.60,0],[-0.97,-0.73,0],[5.04,5.52,1],[5.62,6.08,1]],
  louvV:[[-1.44,-1.16],[2.25,2.55],[2.67,3.12],[3.25,3.55],[3.66,3.96]],
  doors:[[-5.80,-4.94],[-4.76,-4.18],[-4.18,-3.62],[-3.72,-3.18],[-3.16,-2.62],[-2.62,-2.16],[-1.95,-1.10],[-1.10,-0.90],[2.18,2.61],[2.61,3.18],[3.18,3.60],[3.60,4.02],[4.96,5.56],[5.56,6.12]],
  win:[[-0.17,0.15,3.06,3.81],[0.31,0.65,3.06,3.81],[0.86,1.83,3.04,3.86]]};
function paint311(c,W,H,liv){const P=R311.PPM,C=LIV311[liv]||LIV311.or,D=D311,full='311';
  c.fillStyle=C.orange;c.fillRect(0,0,W,H);
  const rnd=(x,y,w,h,r,col)=>{c.fillStyle=col;c.beginPath();if(c.roundRect)c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h);c.fill();};
  /* --- the two sides: X(z) left to right as the viewer sees it, Y(y) from the top of the strip --- */
  [[z=>(z+R311.U0)*P,0],[z=>(R311.U0R-z)*P,355]].forEach(([X,r0])=>{const Y=y=>r0+(R311.V1-y)*P;
    const R=(z0,z1,y0,y1,col)=>{c.fillStyle=col;const a=Math.min(X(z0),X(z1)),b=Math.max(X(z0),X(z1));c.fillRect(a,Y(y1),b-a,Y(y0)-Y(y1));};
    c.save();c.beginPath();c.rect(0,r0,1164,355);c.clip();c.fillStyle=C.orange;c.fillRect(0,r0,1164,355);
    R(-7.4,7.4,4.10,4.40,C.roof);R(-7.4,7.4,4.10,4.13,C.brown2);                                   // cab roof and its visor
    R(-0.84,1.99,1.49,4.10,C.cab);                                                                  // the cab
    if(C.cream){R(-7.4,7.4,1.53,1.67,C.cream);R(-7.4,7.4,1.83,1.97,C.cream);}                        // the two cream stripes
    R(-7.4,7.4,1.49,1.53,C.orange2);R(-7.4,7.4,3.02,3.07,C.orange2);                                 // hood foot and rounded top edge
    // hood doors and their louvres
    D.doors.forEach(([a,b])=>{R(a,a+0.02,1.52,3.0,C.joint);R(b-0.02,b,1.52,3.0,C.joint);R(a,b,2.98,3.0,C.joint);});
    D.louvH.forEach(([a,b,up])=>[[1.60,2.04]].concat(up?[[2.44,2.87]]:[]).forEach(([y0,y1])=>{for(let y=y1-0.03;y>y0;y-=0.06){R(a,b,y-0.022,y,C.slat);R(a,b,y-0.03,y-0.022,C.slatL);}}));
    D.louvV.forEach(([a,b])=>[[1.60,2.06],[2.44,2.91]].forEach(([y0,y1])=>{for(let z=a+0.02;z<b;z+=0.055)R(z,z+0.025,y0,y1,C.slat);}));
    [-6.10,-5.62,2.40,4.55].forEach(z=>R(z-0.05,z+0.05,2.62,2.66,C.joint));                          // door handles
    // cab: windows in their rubber, the door with its handle, the grab rails and the number
    D.win.forEach(([z0,z1,y0,y1])=>{const a=Math.min(X(z0),X(z1)),b=Math.max(X(z0),X(z1));rnd(a-4,Y(y1)-4,b-a+8,Y(y0)-Y(y1)+8,9,C.rubber);
      c.fillStyle=C.glass;c.fillRect(a,Y(y1),b-a,Y(y0)-Y(y1));c.fillStyle=C.glass2;c.fillRect(a,Y(y1),b-a,(Y(y0)-Y(y1))*0.38);});
    R(0.18,0.20,1.95,3.92,C.joint);R(0.72,0.74,1.95,3.92,C.joint);R(0.18,0.74,3.90,3.92,C.joint);R(0.56,0.66,2.84,2.88,'#2A2A2A');
    R(0.12,0.14,1.56,3.60,'#3A3A3A');R(0.79,0.81,1.56,3.60,'#3A3A3A');R(-0.84,-0.80,1.49,4.10,C.joint);R(1.95,1.99,1.49,4.10,C.joint);
    R(0.20,0.72,1.90,1.99,'#2E2E2E');                                                               // the step into the cab
    c.fillStyle=C.num;c.font='700 '+Math.round(0.20*P)+'px "Barlow Condensed","Arial Narrow",sans-serif';c.textAlign='center';c.textBaseline='middle';
    c.fillText(full,X(1.30),Y(2.24));if(C.chev)R(0.98,1.62,2.13,2.145,C.num);
    if(C.big){/* the big series number on the long hood */
      const za=-6.05,xa=Math.min(X(za),X(-2.10));c.fillStyle=C.big;c.textAlign='left';c.textBaseline='alphabetic';
      c.font='800 '+Math.round(1.62*P)+'px "Barlow Condensed","Arial Narrow",sans-serif';c.fillText('311',X(-2.10)<X(za)?Math.max(X(za),X(-2.10))-c.measureText('311').width:xa,Y(1.56));c.textAlign='center';c.textBaseline='middle';}
    // frame, walkway edge and the deep buffer beams; the fuel tank below the cab
    R(-7.4,7.4,1.27,1.49,C.brown);R(-7.4,7.4,1.46,1.49,C.walk);R(-7.4,7.4,1.27,1.29,C.brown2);
    R(-6.70,-6.30,0.55,1.27,C.brown);R(6.15,6.55,0.55,1.27,C.brown);[-6.48,6.35].forEach(z=>{R(z-0.12,z+0.12,0.80,0.84,'#2A2A2A');R(z-0.12,z+0.12,1.05,1.09,'#2A2A2A');});
    R(-1.25,1.35,0.30,1.27,C.brown);R(-1.25,1.35,0.30,0.50,C.brown2);[-0.4,0.5].forEach(z=>R(z,z+0.02,0.5,1.27,C.joint));R(0.85,1.05,1.0,1.12,'#2A2A2A');
    c.fillStyle='#E8E2D0';c.font='500 '+Math.round(0.07*P)+'px "IBM Plex Mono",monospace';c.fillText('M.35',X(-5.2),Y(1.38));c.restore();});
  /* --- the roof (top view): hood tops, walkways in chequer plate, the brown cab roof, the radiator fan and the exhaust --- */
  {const X=z=>(z+R311.U0)*P,Y=x=>710+(R311.T1-x)*P;
    const R=(z0,z1,x0,x1,col)=>{c.fillStyle=col;c.fillRect(X(z0),Y(x1),X(z1)-X(z0),Y(x0)-Y(x1));};
    R(-7.4,7.4,-1.62,1.62,C.walk);
    c.fillStyle=C.walk2;for(let z=-7.3;z<7.3;z+=0.12)for(let x=-1.45;x<1.45;x+=0.12)if(((z*8+x*8)|0)%2===0)c.fillRect(X(z),Y(x),2,1);
    R(-6.42,-0.84,-0.93,0.93,C.orange);R(1.99,6.22,-0.93,0.93,C.orange);
    [[-0.93,-0.85],[0.85,0.93]].forEach(([a,b])=>{R(-6.42,-0.84,a,b,C.orange2);R(1.99,6.22,a,b,C.orange2);});
    [-4.85,-2.11,4.0].forEach(z=>R(z-0.015,z+0.015,-0.9,0.9,C.joint));
    R(-3.8,-3.0,-0.45,0.45,'rgba(0,0,0,.08)');R(4.6,5.3,-0.35,0.35,'rgba(0,0,0,.08)');
    c.fillStyle=C.fan;c.beginPath();c.arc(X(-5.62),Y(0),0.55*P,0,TAU);c.fill();c.strokeStyle='#5C5F61';c.lineWidth=2;
    for(let k=0;k<8;k++){const a=k/8*TAU;c.beginPath();c.moveTo(X(-5.62),Y(0));c.lineTo(X(-5.62)+Math.cos(a)*0.52*P,Y(0)+Math.sin(a)*0.52*P);c.stroke();}
    c.beginPath();c.arc(X(-5.62),Y(0),0.55*P,0,TAU);c.stroke();
    R(-0.86,2.32,-1.42,1.42,C.roof);R(-0.86,2.32,-1.42,-1.30,C.chev?C.brown2:C.cab);R(-0.86,2.32,1.30,1.42,C.chev?C.brown2:C.cab);
    c.fillStyle='#1A1A1A';c.beginPath();c.ellipse(X(-1.15),Y(0),0.16*P,0.11*P,0,0,TAU);c.fill();}
  /* --- the ends: X(x) as the atlas holds them (mirrored to the viewer, so the number is drawn mirrored) --- */
  [[x=>1164+(R311.U0F-x)*P,true],[x=>1421+(x+R311.U0B)*P,false]].forEach(([X,front])=>{const Y=y=>(R311.V1-y)*P;
    const R=(x0,x1,y0,y1,col)=>{c.fillStyle=col;const a=Math.min(X(x0),X(x1)),b=Math.max(X(x0),X(x1));c.fillRect(a,Y(y1),b-a,Y(y0)-Y(y1));};
    const x0=Math.min(X(-1.6),X(1.6));c.fillStyle=C.orange;c.fillRect(x0,0,3.2*P,355);
    R(-1.6,1.6,3.07,4.10,C.cab);R(-1.6,-0.93,1.49,3.07,C.cab);R(0.93,1.6,1.49,3.07,C.cab);R(-1.6,1.6,4.10,4.40,C.roof);
    if(C.cream){R(-1.6,1.6,1.53,1.67,C.cream);R(-1.6,1.6,1.83,1.97,C.cream);}R(-0.93,0.93,3.02,3.07,C.orange2);
    // the cab face over the hood: two windows each side of the centre pillar
    [[0.14,1.18],[-1.18,-0.14]].forEach(([a,b])=>{const u0=Math.min(X(a),X(b)),u1=Math.max(X(a),X(b));rnd(u0-4,Y(3.94)-4,u1-u0+8,Y(3.10)-Y(3.94)+8,10,C.rubber);
      c.fillStyle=C.glass;c.fillRect(u0,Y(3.94),u1-u0,Y(3.10)-Y(3.94));c.fillStyle=C.glass2;c.fillRect(u0,Y(3.94),u1-u0,(Y(3.10)-Y(3.94))*0.38);});
    // the hood end: two leaves with handles (front), or the radiator grille (rear, long hood)
    R(-0.93,-0.91,1.52,3.0,C.joint);R(0.91,0.93,1.52,3.0,C.joint);
    if(front){R(-0.01,0.01,2.0,2.96,C.joint);R(-0.85,0.85,2.94,2.96,C.joint);R(-0.85,-0.83,2.0,2.96,C.joint);R(0.83,0.85,2.0,2.96,C.joint);[-0.12,0.12].forEach(x=>R(x-0.03,x+0.03,2.42,2.58,'#2A2A2A'));}
    else{R(-0.56,0.56,1.72,2.94,C.orange2);for(let x=-0.52;x<0.52;x+=0.06)R(x,x+0.03,1.76,2.90,C.slat);}
    [[-0.78,1.66,0.12],[0.78,1.66,0.12],[0,2.92,0.10]].forEach(([x,y,r])=>{c.fillStyle='#2A2A2A';c.beginPath();c.arc(X(x),Y(y),r*P,0,TAU);c.fill();});
    c.save();c.translate(X(0),Y(2.24));c.scale(-1,1);c.fillStyle=C.num;c.font='700 '+Math.round(0.13*P)+'px "Barlow Condensed","Arial Narrow",sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(full,0,0);c.restore();
    // frame end: walkway lip, the black and yellow chevrons of the buffer beam, the brown below
    R(-1.6,1.6,0.40,1.49,C.brown);R(-1.45,1.45,1.38,1.49,C.walk);
    const yb=0.98,yt=1.36;if(C.chev){R(-1.41,1.41,yb,yt,C.yellow);c.save();c.beginPath();const ua=Math.min(X(-1.41),X(1.41)),ub=Math.max(X(-1.41),X(1.41));c.rect(ua,Y(yt),ub-ua,Y(yb)-Y(yt));c.clip();
    c.fillStyle=C.black;for(let u=ua-60;u<ub+60;u+=26){c.beginPath();c.moveTo(u,Y(yt));c.lineTo(u+13,Y(yt));c.lineTo(u+13+(u<(ua+ub)/2?-30:30),Y(yb));c.lineTo(u+(u<(ua+ub)/2?-30:30),Y(yb));c.fill();}c.restore();}
    [-0.875,0.875].forEach(x=>{c.fillStyle='#262626';c.beginPath();c.arc(X(x),Y(1.06),0.20*P,0,TAU);c.fill();});});
}
function mat311(liv){const k=liv||'or';if(MAT311[k])return MAT311[k];const t=canvasTex(2048,1024,(c,w,h)=>paint311(c,w,h,k));t.anisotropy=8;
  const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,(LIV311[liv]||LIV311.or).hex);return MAT311[k]=m;}
function build311(tr,sp,i,n){
  const P=P311||(P311=parts311()),TS=tex470().solid,mt=mat311(sp.liv||'or');
  const g=new THREE.Group(),root=new THREE.Group();root.position.z=-R311.zc;g.add(root);const body=[];
  if(!TTM)ttMats();const sol={dark:TS.dark,bogie:TTM.bog,wheel:TTM.wheel,buf:TTM.buf};
  Object.keys(P).forEach(key=>{const m=new THREE.Mesh(geoFromArrays(P[key]),key==='tex'?mt:sol[key]);m.castShadow=true;m.receiveShadow=true;root.add(m);
    if(key==='tex'){m.userData.ent=tr.ent;body.push(m);}});
  /* lamps on the hood ends: white lit ahead when it leads, red behind when it is last (ahead is +z unless turned) */
  const fw=sp.rev?-1:1,lead=i===0,tail=i===n-1,LW=arrNew(),LR=arrNew(),OW=arrNew(),OR=arrNew();
  [[R311.HE[1]+0.012,1],[R311.HE[0]-0.012,-1]].forEach(([z,e])=>{const ahead=e===fw;
    [[-0.78,1.66],[0.78,1.66],[0,2.92]].forEach(([x,y])=>arrPush(ahead&&lead?LW:OW,discA(x,y,z,0.085,e)));
    [[-0.78,1.66],[0.78,1.66]].forEach(([x,y])=>arrPush(!ahead&&tail?LR:OR,discA(x*1.18,y,z+e*0.002,0.06,e)));});
  [[LW,TS.lightW],[LR,TS.lightR],[OW,TS.lampOffW],[OR,TS.lampOffR]].forEach(([A,m])=>{if(A.idx.length)root.add(new THREE.Mesh(geoFromArrays(A),m));});
  return{g:g,L:sp.L,body:body};
}
/* coches taller: the atlas holds both sides of each car (171 rows each), then the end and the roof */
const RCI={ZE:10.28,HW:1.47,YB:1.20,YT:3.22,L:21.49,SH:171,SW:1720,AW:2048,AH:1024,BOG:7.4,
  RP:[[1.47,3.22],[1.40,3.50],[1.22,3.72],[0.90,3.89],[0.47,3.99],[0,4.03]]};
const uvci=(c,r)=>[c/RCI.AW,1-r/RCI.AH];
const PCI={};
function partsCI(car){
  const C=RCI,T=arrNew(),M={};const add=(k,A)=>{if(!M[k])M[k]=arrNew();arrPush(M[k],A);};
  const ZE=C.ZE,HW=C.HW,r0=(car===2?2:0)*C.SH;
  // sides: −x shows the first strip (left to right = −z to +z), +x the second (left to right = +z to −z)
  [[-1,r0],[1,r0+C.SH]].forEach(([s,rr])=>{const col=z=>(s<0?z+ZE:ZE-z)/(2*ZE)*C.SW,row=y=>rr+0.5+(C.YT-y)/(C.YT-C.YB)*(C.SH-1);
    const q=[[s*HW,C.YB,-ZE],[s*HW,C.YB,ZE],[s*HW,C.YT,ZE],[s*HW,C.YT,-ZE]];quadN(T,q,q.map(p=>uvci(col(p[2]),row(p[1]))),[s,0,0]);});
  // roof: the arc, its rusty sheet along the car
  const ring=C.RP.map(p=>[-p[0],p[1]]).concat(C.RP.slice(0,-1).reverse());let tot=0;const acc=[0];
  for(let i=1;i<ring.length;i++){tot+=Math.hypot(ring[i][0]-ring[i-1][0],ring[i][1]-ring[i-1][1]);acc.push(tot);}
  const ru=z=>280+(z+ZE)/(2*ZE)*1760,rv=i=>4*C.SH+0.5+acc[i]/tot*(C.SH-1);
  for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1];let n=[b[1]-a[1],a[0]-b[0],0];if(n[0]*(a[0]+b[0])+n[1]*((a[1]+b[1])-5)<0)n=[-n[0],-n[1],0];
    quadN(T,[[a[0],a[1],-ZE],[b[0],b[1],-ZE],[b[0],b[1],ZE],[a[0],a[1],ZE]],[uvci(ru(-ZE),rv(i)),uvci(ru(-ZE),rv(i+1)),uvci(ru(ZE),rv(i+1)),uvci(ru(ZE),rv(i))],n);}
  // end walls, from the end texture (the arc above the cant rail takes its top row)
  const wall=[[-HW,C.YB],[HW,C.YB]].concat(C.RP.map(p=>[p[0],p[1]]),C.RP.slice(0,-1).reverse().map(p=>[-p[0],p[1]]));
  [-1,1].forEach(e=>fanUV(T,wall.map(p=>[p[0],p[1],e*ZE]),[0,0,e],p=>uvci(0.5+(e>0?p[0]+HW:HW-p[0])/(2*HW)*267,4*C.SH+0.5+clamp((C.YT-p[1])/(C.YT-C.YB),0,1)*(C.SH-1))));
  add('tex',T);
  // solebar, underframe boxes, gangways, buffer beams, buffers, steps at the end doors
  add('dark',boxA(0,0.96,0,2.90,0.26,2*ZE-0.1));add('dark',boxA(0,0.50,0,2.1,0.46,10.6));add('dark',boxA(-0.7,0.40,-2.4,0.7,0.5,1.8));add('dark',cylA(0.75,0.68,2.2,0.24,2.4,10,PI/2,0,0));
  [-1,1].forEach(e=>{add('rubber',boxA(0,1.20,e*(ZE+0.22),1.0,2.05,0.44));   // the bellows reach the next car'sadd('dark',boxA(0,0.78,e*(ZE-0.02),2.78,0.44,0.12));
    [-1,1].forEach(s=>{add('dark',cylA(s*0.875,1.06,e*(ZE+0.22),0.11,0.40,10,PI/2,0,0));add('buf',cylA(s*0.875,1.06,e*(ZE+0.44),0.21,0.05,14,PI/2,0,0));
      add('dark',boxA(s*1.36,0.52,e*(ZE-0.75),0.26,0.44,0.7));});
    add('dark',boxA(0,0.90,e*(ZE+0.12),0.24,0.18,0.30));});
  // bogies: wheelbase 2.5 m, wheels 920 mm
  [-C.BOG,C.BOG].forEach(zc=>{[-1,1].forEach(s=>{const x=s*1.04;add('bog',boxA(x,0.40,zc,0.18,0.36,3.3));add('bog',boxA(x,0.74,zc,0.24,0.10,1.8));
      [-1.25,1.25].forEach(a=>{add('wheel',cylA(s*0.80,0.46,zc+a,0.46,0.13,14,0,0,PI/2));add('bog',boxA(x,0.36,zc+a,0.30,0.32,0.40));add('bog',cylA(x,0.80,zc+a,0.11,0.26,8));});});
    add('bog',boxA(0,0.58,zc,2.1,0.22,0.6));[-1.25,1.25].forEach(a=>add('dark',cylA(0,0.46,zc+a,0.08,1.6,8,0,0,PI/2)));});
  return M;
}
/* the coches taller painted clean, in the flat style of the rest of the set: the window layout of the package's
   sides (four big and four medium windows, a toilet window and an end door at each end), Renfe orange, rubber-framed
   windows with the dropping top pane, the titles and numbers of each car; then the end and the roof */
const LIVCI={orange:'#D96A2B',orange2:'#C25A22',line:'rgba(60,24,8,.30)',rubber:'#24262A',glass:LIV.glass,glass2:LIV.glass2,glass3:LIV.glass3,
  sash:'#9DA2A5',roof:'#8F9599',roof2:'#7A8084',roofLine:'#5C6165',gutter:'#6E7478',sole:'#2A2C2F',text:'#2B1A10'};
const CIWIN={A:{doors:[[30,112,53,94],[1608,1690,1631,1676]],win:[[125,190],[242,357],[429,544],[615,731],[802,917],[971,1077],[1110,1216],[1249,1354],[1387,1491],[1524,1588]],tit:300,num:860},
             B:{doors:[[22,104,44,90],[1602,1688,1625,1666]],win:[[132,196],[229,333],[366,471],[504,610],[643,749],[803,918],[989,1105],[1176,1291],[1363,1478],[1530,1595]],tit:420,num:860}};
function paintCISide(c,y0,L,num,uic){const H=RCI.SH,W=RCI.SW,C=LIVCI;
  const rr=(x,y,w,h,r,col)=>{c.fillStyle=col;c.beginPath();if(c.roundRect)c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h);c.fill();};
  c.fillStyle=C.orange;c.fillRect(0,y0,W+40,H);
  c.fillStyle=C.gutter;c.fillRect(0,y0,W+40,6);c.fillStyle=C.orange2;c.fillRect(0,y0+H-12,W+40,12);c.fillStyle=C.sole;c.fillRect(0,y0+H-3,W+40,3);
  c.fillStyle='rgba(60,24,8,.13)';for(let x=0;x<W;x+=86)c.fillRect(x,y0+6,1,H-18);
  /* windows: rubber frame, dark glass, the top pane a shade lighter behind its aluminium bar */
  const win=(a,b,top,bot)=>{rr(a,y0+top,b-a,bot-top,7,C.rubber);const ga=a+5,gb=b-5,gt=y0+top+5,gh=bot-top-10;
    c.fillStyle=C.glass;c.fillRect(ga,gt,gb-ga,gh);c.fillStyle=C.glass2;c.fillRect(ga,gt,gb-ga,gh*0.42);c.fillStyle=C.glass3;c.fillRect(ga,gt+gh*0.42,gb-ga,gh*0.12);
    c.fillStyle=C.sash;c.fillRect(ga,gt+gh*0.42-2,gb-ga,4);};
  L.win.forEach(([a,b],i)=>win(a,b,i===0||i===L.win.length-1?14:11,i===0||i===L.win.length-1?72:84));
  /* end doors: the leaf outlined, its window, the handle and the grab rails */
  L.doors.forEach(([a,b,wa,wb])=>{c.fillStyle='rgba(40,16,6,.55)';c.fillRect(a,y0+8,2,H-20);c.fillRect(b-2,y0+8,2,H-20);c.fillRect(a,y0+8,b-a,2);
    c.fillStyle=C.orange2;c.fillRect(a+2,y0+H-26,b-a-4,14);win(wa,wb,16,78);
    c.fillStyle='#B8BCBE';c.fillRect(wb+3,y0+92,8,3);c.fillStyle='#4A4D50';[a-6,b+3].forEach(x=>c.fillRect(x,y0+40,3,96));});
  c.fillStyle=C.text;c.textAlign='center';c.textBaseline='middle';
  c.font='700 13px "Barlow Condensed","Arial Narrow",sans-serif';c.fillText('TREN TALLER MEDIANA INTERVENCIÓN',L.tit,y0+108);c.fillText('MATERIAL REMOLCADO MIRANDA',L.tit,y0+123);
  c.font='500 12px "IBM Plex Mono",monospace';c.fillText(uic,L.num,y0+118);
  c.font='700 19px "Barlow Condensed","Arial Narrow",sans-serif';c.fillText(num,L.num,y0+140);}
function paintCI(c,W,H){const C=LIVCI,S=RCI.SH;
  c.fillStyle='#3A3C3E';c.fillRect(0,0,W,H);
  [[1,'SSA-1009','60 71 99-20 109-0'],[2,'SSA-1012','60 71 99-20 112-2']].forEach(([car,num,uic])=>{const r=(car===2?2:0)*S;
    paintCISide(c,r,CIWIN.A,num,uic);paintCISide(c,r+S,CIWIN.B,num,uic);});
  /* end wall (columns 0–268): orange, the gangway door, the lamp brackets and the buffer beam shadow */
  const y0=4*S;c.fillStyle=C.orange;c.fillRect(0,y0,280,S);c.fillStyle=C.orange2;c.fillRect(0,y0+S-14,280,14);
  c.fillStyle=C.rubber;c.fillRect(92,y0+4,84,S-20);c.fillStyle='#3A3E42';c.fillRect(98,y0+10,72,S-32);c.fillStyle=C.glass;c.fillRect(110,y0+22,48,36);c.fillStyle=C.glass2;c.fillRect(110,y0+22,48,14);
  c.fillStyle='#4A4D50';[[30,40],[226,40],[30,130],[226,130]].forEach(([x,y])=>c.fillRect(x,y0+y,14,10));
  c.fillStyle=C.line;c.fillRect(60,y0+6,1,S-20);c.fillRect(208,y0+6,1,S-20);
  /* roof (columns 280–2040): the arc from the −x cant rail over the top to +x, grey with darker eaves, joints and vents */
  c.fillStyle=C.roof;c.fillRect(280,y0,1768,S);c.fillStyle=C.roof2;c.fillRect(280,y0,1768,22);c.fillRect(280,y0+S-22,1768,22);
  c.fillStyle=C.roofLine;c.fillRect(280,y0+20,1768,2);c.fillRect(280,y0+S-22,1768,2);
  c.fillStyle='rgba(0,0,0,.10)';for(let x=280;x<2040;x+=86)c.fillRect(x,y0,1.5,S);
  c.fillStyle='#5E6468';for(let k=0;k<8;k++){const x=280+130+k*215;c.fillRect(x,y0+S/2-9,36,18);}
}
function matCI(){if(MATCI)return MATCI;const t=canvasTex(2048,1024,paintCI);t.anisotropy=8;
  MATCI=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(MATCI,0xD4743A);return MATCI;}
function buildCI(tr,sp,i,n){
  const car=sp.car===2?2:1,P=PCI[car]||(PCI[car]=partsCI(car)),TS=tex470().solid,mt=matCI();
  if(!TTM)ttMats();
  const g=new THREE.Group(),body=[],sol={dark:TS.dark,bog:TTM.bog,wheel:TTM.wheel,buf:TTM.buf,rubber:TTM.rubber};
  Object.keys(P).forEach(key=>{const m=new THREE.Mesh(geoFromArrays(P[key]),key==='tex'?mt:sol[key]);m.castShadow=true;m.receiveShadow=true;g.add(m);
    if(key==='tex'){m.userData.ent=tr.ent;body.push(m);}});
  ttTail(g,sp,i,n,RCI.ZE+0.02,1.30,1.03);
  return{g:g,L:sp.L,body:body};
}
/* red tail lamps on the last vehicle, at its rear end */
function ttTail(g,sp,i,n,z,y,x){if(i!==n-1)return;const e=sp.rev?1:-1,A=arrNew();[-1,1].forEach(s=>arrPush(A,discA(s*x,y,e*z,0.07,e)));g.add(new THREE.Mesh(geoFromArrays(A),tex470().solid.lightR));}
/* the two vagonetas: shared materials and small painted textures */
let TTM=null;
function ttMats(){
  const wood=canvasTex(128,128,(c,w,h)=>{c.fillStyle='#9C8A70';c.fillRect(0,0,w,h);
      const pl=['#B7A487','#A8957A','#BEAC90','#9F8B70','#B09C80'];for(let k=0;k<8;k++){c.fillStyle=pl[k%5];c.fillRect(0,k*16,w,16);c.fillStyle='rgba(60,44,28,.55)';c.fillRect(0,k*16,w,1.5);}
      c.fillStyle='rgba(70,52,34,.22)';for(let k=0;k<160;k++){const a=(k*97)%128,b=(k*53)%128;c.fillRect(a,b,3,1);}
      c.strokeStyle='#6A5640';c.lineWidth=4;c.beginPath();c.arc(64,64,61,0,TAU);c.stroke();
      c.fillStyle='#6E3A20';c.fillRect(54,54,20,20);c.fillStyle='#2A2420';c.beginPath();c.arc(64,64,5,0,TAU);c.fill();
      c.fillStyle='#74402A';[[64,26],[100,64],[64,102],[28,64]].forEach(([x,y])=>c.fillRect(x-5,y-5,10,10));
      c.fillStyle='#1E1A16';[[84,40],[46,90]].forEach(([x,y])=>{c.beginPath();c.arc(x,y,4,0,TAU);c.fill();});}),
    copper=canvasTex(32,64,(c,w,h)=>{for(let y=0;y<h;y+=2){const k=(y*37)%5;c.fillStyle=['#B5643A','#A55A32','#C27448','#9A5230','#B86A40'][k];c.fillRect(0,y,w,2);}
      c.fillStyle='rgba(40,20,10,.25)';for(let y=0;y<h;y+=8)c.fillRect(0,y,w,1);},true);
  copper.repeat.set(4,3);wood.anisotropy=4;
  const mk=(t,hex)=>{const m=new THREE.MeshLambertMaterial({map:t,clippingPlanes:CLIP,clipShadows:true});MAT_HEX.set(m,hex);return m;};
  TTM={black:tmat(0x1E1F21),deck:tmat(0x5E4632),yel:tmat(0xE2B024),red:tmat(0xA8382A),galv:tmat(0xB4B8BA),node:tmat(0x1A1A1A),
    basket:tmat(0x9A3E2E),cab:tmat(0xC6C3B8),cabD:tmat(0x8E8B82),wheel:tmat(0x2E2E2E),buf:tmat(0x3C3C3C),rubber:tmat(0x151515),
    bog:tmat(0x2C2F32),wood:mk(wood,0xA8957A),woodE:tmat(0x8C7A60),copper:mk(copper,0xB0623A),axle:tmat(0x55585A)};
}
function buildVag(tr,sp,i,n){
  if(!TTM)ttMats();
  const g=new THREE.Group(),M=TTM,body=[],L=sp.L,B=(m,x,y,z,w,h,d)=>tbox(g,m,x,y,z,w,h,d),R=(m,a,b,t)=>{const k=new THREE.Mesh(geoFromArrays(rodA(a,b,t)),m);k.castShadow=true;g.add(k);return k;};
  /* chassis: two axles at ±0.985 with 660 mm wheels, outside axleboxes on leaf springs, black frame, deck at 0.84 m,
     yellow and black buffer beams with the coupling, a lamp post at each corner */
  [-0.985,0.985].forEach(z=>{[-1,1].forEach(s=>{const w=new THREE.Mesh(GEO.cyl,M.wheel);w.scale.set(0.33,0.12,0.33);w.rotation.z=PI/2;w.position.set(s*0.80,0.33,z);w.castShadow=true;g.add(w);
      B(M.black,s*1.0,0.18,z,0.22,0.30,0.32);B(M.black,s*1.0,0.48,z,0.12,0.06,1.1);});
    B(M.axle,0,0.29,z,1.5,0.08,0.08);});
  [-1,1].forEach(s=>B(M.black,s*0.98,0.50,0,0.14,0.28,4.44));[-1.6,0,1.6].forEach(z=>B(M.black,0,0.52,z,1.9,0.22,0.12));
  body.push(B(M.deck,0,0.78,0,2.16,0.06,4.40));
  [-1,1].forEach(e=>{B(M.black,0,0.46,e*2.18,2.16,0.34,0.08);for(let k=0;k<6;k++)B(k%2?M.black:M.yel,-0.9+k*0.36,0.47,e*2.225,0.36,0.32,0.02);
    B(M.black,0,0.56,e*2.36,0.16,0.14,0.30);
    /* buffers at the standard height (1.06 m), on raised heads over the beam: the vehicles run buffer to buffer */
    [-1,1].forEach(s=>{B(M.black,s*0.875,0.62,e*2.21,0.36,0.62,0.10);const st=new THREE.Mesh(GEO.cyl,M.black);st.scale.set(0.10,0.30,0.10);st.rotation.x=PI/2;st.position.set(s*0.875,1.06,e*2.41);g.add(st);
      const hd=new THREE.Mesh(GEO.cyl,M.buf);hd.scale.set(0.19,0.05,0.19);hd.rotation.x=PI/2;hd.position.set(s*0.875,1.06,e*2.575);hd.castShadow=true;g.add(hd);});
    [-1,1].forEach(s=>{B(M.black,s*0.72,0.84,e*2.03,0.05,0.30,0.05);B(M.black,s*0.72,1.14,e*2.03,0.18,0.20,0.14);});});
  ttTail(g,sp,i,n,2.11,1.24,0.72);
  if(sp.k==='ttbob'){
    /* two drums of copper contact wire (1.40 m flanges, 0.73 m wide) on their red trestles, the axle across the cradle */
    [-0.9,0.9].forEach(z=>{const yc=0.84+0.79;
      [-1,1].forEach(s=>{const x=s*0.60;R(M.red,[x,0.86,z-0.58],[x,yc,z],0.08);R(M.red,[x,0.86,z+0.58],[x,yc,z],0.08);B(M.red,x,0.84,z,0.10,0.06,1.2);B(M.red,x,yc-0.06,z,0.14,0.12,0.16);});
      B(M.red,0,0.84,z-0.55,1.24,0.06,0.08);B(M.red,0,0.84,z+0.55,1.24,0.06,0.08);
      R(M.axle,[-0.70,yc,z],[0.70,yc,z],0.07);
      const core=new THREE.Mesh(new THREE.CylinderGeometry(0.56,0.56,0.62,18,1,true),M.copper);core.rotation.z=PI/2;core.position.set(0,yc,z);core.castShadow=true;g.add(core);
      [-1,1].forEach(s=>{const fl=new THREE.Mesh(GEO.cyl,M.woodE);fl.scale.set(0.70,0.05,0.70);fl.rotation.z=PI/2;fl.position.set(s*0.34,yc,z);fl.castShadow=true;g.add(fl);body.push(fl);
        const d=new THREE.Mesh(new THREE.CircleGeometry(0.70,20),M.wood);d.rotation.y=s*PI/2;d.position.set(s*0.366,yc,z);g.add(d);});});}
  else{
    /* the castillete: a galvanised lattice tower with black gusset nodes, the red working basket with its striped
       railing on top (3.35 m and 4.26 m), and the equipment cabinet at one end */
    const X=0.70,Z=1.0,ys=[0.84,1.68,2.52,3.35];
    [[-X,-Z],[X,-Z],[X,Z],[-X,Z]].forEach(([x,z])=>R(M.galv,[x,0.84,z],[x,3.35,z],0.10));
    const C=[[-X,-Z],[X,-Z],[X,Z],[-X,Z]];
    ys.forEach((y,k)=>{for(let j=0;j<4;j++){const a=C[j],b=C[(j+1)%4];R(M.galv,[a[0],y,a[1]],[b[0],y,b[1]],0.07);B(M.node,a[0],y-0.09,a[1],0.17,0.18,0.17);}
      if(k<3){const y2=ys[k+1];for(let j=0;j<4;j++){const a=C[j],b=C[(j+1)%4];R(M.galv,[a[0],y,a[1]],[b[0],y2,b[1]],0.05);R(M.galv,[b[0],y,b[1]],[a[0],y2,a[1]],0.05);
        B(M.node,(a[0]+b[0])/2,(y+y2)/2-0.07,(a[1]+b[1])/2,0.12,0.14,0.12);}}});
    B(M.black,0,0.84,0,1.62,0.10,2.14);
    body.push(B(M.basket,0,3.35,0,1.80,0.10,2.30));B(M.black,0,3.30,0,1.86,0.05,2.36);
    const px=[-0.88,0,0.88],pz=[-1.13,0,1.13];
    px.forEach(x=>pz.forEach(z=>{if(x===0&&z===0)return;B(M.galv,x,3.45,z,0.05,0.81,0.05);}));
    [[-0.88,0,0.06,2.30],[0.88,0,0.06,2.30],[0,-1.13,1.80,0.06],[0,1.13,1.80,0.06]].forEach(([x,z,w,d])=>{B(M.galv,x,3.82,z,w,0.05,d);
      const nn=6;for(let k=0;k<nn;k++){const f=(k+0.5)/nn-0.5;B(k%2?M.node:M.yel,x+(w>d?f*w:0),4.20,z+(w>d?0:f*d),w>d?w/nn:0.07,0.07,w>d?0.07:d/nn);}});
    body.push(B(M.cab,-0.58,0.84,1.86,0.86,2.04,0.60));B(M.cabD,-0.58,2.88,1.86,0.92,0.05,0.66);B(M.cabD,-0.58,1.85,2.165,0.02,0.9,0.02);B(M.cabD,-0.15,0.84,1.86,0.02,2.04,0.6);}
  body.forEach(m=>m.userData.ent=tr.ent);
  return{g:g,L:L,body:body};
}
function buildTT(tr,sp,i,n){
  const k={ttloco:'loco311',ttcar:'ttci',ttplat:'ttbob',vagoneta:'ttcast'}[sp.k]||sp.k;   // saves from before the new models
  const s=k===sp.k?sp:Object.assign({},sp,{k:k});
  const c=k==='loco311'?build311(tr,s,i,n):k==='ttci'?buildCI(tr,s,i,n):buildVag(tr,s,i,n);
  c.body.forEach(m=>{m.userData.ent=tr.ent;PICK.push(m);});return c;}

ttEnsure();

/* Avería de puertas de un MD: decisión cuando no cierran */
IT.pu={n:'Avería de puertas',w:6,can:()=>puCands().length>0,go(){
  const t=ipick(puCands());
  const inc=incNew('pu',{tr:t.id,coche:ipick(['M','R','Rc']),pu:ipick(['1','2','3','4']),sev:'warn',title:'Puertas · '+trL(t),desc:'Una puerta del '+trL(t)+' no cierra ni da comprobación de cierre. Con una puerta sin enclavar, el tren no puede arrancar.'});
  t.doorFault=inc;inc.st='Se verá al cerrar puertas';
  return inc;},
 setup(inc){const H=inc.H;
  H.ask=()=>{const t=T_(inc);if(inc.asked||!t)return;inc.asked=true;decide(inc,{title:inc.title,text:'El maquinista del '+trL(t)+' avisa: la puerta '+inc.pu+' del coche '+inc.coche+' no cierra y no tiene comprobación de cierre.',opts:[
    {l:'Reintentar el cierre',sub:'1′. Puede volver a fallar.',h:'retry'},
    {l:'Aislar y condenar la puerta',sub:'3–4′. El tren sigue con esa puerta fuera de servicio.',h:'condena'},
    {l:'Retirar la unidad del servicio',sub:'Los viajeros pasan al siguiente regional y la unidad sale vacía.',h:'retira'}]});};
  H.retry=()=>{inc.fixAt=sim.t+60;inc.pOk=0.45;inc.st='Reintentando el cierre';};
  H.condena=()=>{inc.fixAt=sim.t+irnd(3,4)*60;inc.pOk=1;inc.st='El maquinista condena la puerta';};
  H.retira=()=>{const t=T_(inc);inc.fail=true;inc.note='Por una puerta basta con aislarla y condenarla: retirar la unidad dejó a los viajeros esperando al siguiente tren.';
    incTransfer(t);t.oos=inc;inc.fixAt=sim.t+120;inc.pOk=1;inc.st='Retirada del servicio';};
  inc.step=h=>{const t=T_(inc);if(!t)return;if(t.phase==='cerrando'&&sim.t-t.t0>4&&!inc.asked)H.ask();
    if(inc.fixAt&&sim.t>=inc.fixAt){inc.fixAt=0;
      if(Math.random()<inc.pOk){t.doorFault=null;t.oos=null;toast('Puertas del '+t.svc.num+' cerradas y comprobadas');incEnd(inc,true);}
      else{inc.asked=false;inc.st='La puerta sigue sin cerrar';H.ask();}}};}};

/* Avería de ASFA o del hombre muerto: segundo agente (RCF 1.1.1.7: sin protección del tren, 120 km/h y dos personas en cabina) */
IT.as={n:'Avería de ASFA o del dispositivo de vigilancia',w:4,can:()=>asCands().length>0,go(){
  const t=ipick(asCands()),asfa=Math.random()<0.6,dev=asfa?'el equipo ASFA':'el dispositivo de vigilancia';
  const inc=incNew('as',{tr:t.id,asfa:asfa,dev:dev,sev:'warn',title:(asfa?'ASFA':'Dispositivo de vigilancia')+' inutilizado · '+trL(t),
    pmTx:'El maquinista del tren '+t.svc.num+' comunica que '+dev+' de su vehículo motor está inutilizado'+(asfa?'':' y viaja sin ayudante')+'.',
    desc:'El maquinista del '+trL(t)+' comunica que '+dev+' de su vehículo motor está inutilizado'+(t.zone==='in'?('; llegará a '+NIVEL.nombre+' en unos ')+Math.ceil(etaSO(t)/60)+'′':'')+'. Lo comunica a través del jefe de circulación de la primera estación: transmítelo al Puesto de Mando, que decide '+
      (asfa?'(RGC art. 262.6: sigue sin exceder de 140 km/h).':'(RGC art. 265.3: sin ayudante, sube al vehículo motor un agente habilitado).')});
  needAdd(inc,{k:'tel',tel:'pm',tr:t.id,on:'pm',txt:'El maquinista del '+trL(t)+' comunica que '+dev+' está inutilizado: transmítelo al Puesto de Mando.'});
  return inc;},
 setup(inc){const H=inc.H;
  H.pm=()=>{const t=T_(inc);if(!t)return;
    if(inc.asfa)aiSay(irnd(20,60),'Puesto de Mando','pm','Enterado. El tren '+t.svc.num+' continuará sin exceder de 140 km/h hasta rendir viaje; el vehículo irá después a la Base.',inc,'go140');
    else aiSay(irnd(20,60),'Puesto de Mando','pm','Enterado. Detenga el tren '+t.svc.num+(' en '+NIVEL.nombre+': sube al vehículo motor un agente habilitado que llega desde ')+NIVEL.relevo+'.'+(t.md?'':' Recíbalo en '+apTxt(t)+'.'),inc,'agente');};
  H.go140=()=>{const t=T_(inc);if(t){t.vcap=Math.min(t.vcap||Infinity,140/3.6);t.vcapBy=null;}incEnd(inc,true);};
  H.agente=()=>{inc.agAt=sim.t+irnd(25,40)*60;holdSO(inc,T_(inc),{until:inc.agAt,why:'Esperando al agente habilitado (art. 265)'});};}};

/* Viajero indispuesto en un MD: decisión según lo grave que esté */
IT.vi={n:'Viajero indispuesto',w:7,can:()=>viCands().length>0,go(){
  const t=ipick(viCands()),grave=Math.random()<0.4;
  const inc=incNew('vi',{tr:t.id,grave:grave,sev:'warn',title:'Viajero indispuesto · '+trL(t),
    desc:grave?'El interventor del '+trL(t)+' avisa: un viajero ha perdido el conocimiento y respira con dificultad.':'El interventor del '+trL(t)+' avisa: una viajera se ha mareado; está consciente, sentada y acompañada.'});
  decide(inc,{title:inc.title,text:inc.desc+(t.spawned?' El tren está en el andén.':(' El tren llega a '+NIVEL.nombre+' en unos ')+Math.ceil(etaSO(t)/60)+'′.'),opts:[
    {l:'Llamar al 112 y que el tren espere a la ambulancia',sub:'Retenido en el andén 15–25′.',h:'espera'},
    {l:('Bajarlo en '+NIVEL.nombre+' y que el tren siga'),sub:'El personal de la estación le atiende hasta que llegue el 112; el tren pierde 3–4′.',h:'baja'},
    {l:'Que siga hasta '+t.svc.to+' y le atiendan allí',sub:'Sin retraso.',h:'sigue'}]});
  return inc;},
 setup(inc){const H=inc.H;
  const call=()=>{const t=T_(inc);telLog('out','112','—','Viajero indispuesto en el tren '+t.svc.num+', '+(t.spawned?'detenido':'que llegará en unos minutos')+(' en la estación de '+NIVEL.nombre+'.'),'ok');};
  H.espera=()=>{call();holdSO(inc,T_(inc),{dur:irnd(15,25)*60,why:'Esperando a la ambulancia'});};
  H.baja=()=>{call();if(inc.grave){inc.fail=true;inc.note='A una persona inconsciente no se la mueve: el tren tenía que esperar a los sanitarios.';}holdSO(inc,T_(inc),{dur:irnd(3,4)*60,why:'Bajando al viajero'});};
  H.sigue=()=>{if(inc.grave)incEnd(inc,false,'Un viajero grave tiene que recibir asistencia en la primera estación.');else incEnd(inc,true);};}};

/* Maquinista indispuesto: relevo en la estación o seguir con el riesgo */
IT.mq={n:'Maquinista indispuesto',w:4,can:()=>mqCands().length>0,go(){
  const t=ipick(mqCands());
  const inc=incNew('mq',{tr:t.id,sev:'warn',title:'Maquinista indispuesto · '+trL(t),
    desc:'El maquinista del '+trL(t)+' comunica que se encuentra mal (mareo y sudor frío)'+(t.spawned?'.':('; llegará a '+NIVEL.nombre+' en unos ')+Math.ceil(etaSO(t)/60)+'′.')});
  decide(inc,{title:inc.title,text:inc.desc,opts:[
    {l:('Detenerlo en '+NIVEL.nombre+' y pedir relevo al Puesto de Mando'),sub:'El Puesto de Mando manda otro maquinista desde '+NIVEL.relevo+' (RGC art. 554); llega en 35–55′ y el tren ocupa la vía mientras.'+(t.md?'':' Recíbelo en '+apTxt(t)+'.'),h:'relevo'},
    {l:'Que siga si se ve capaz',sub:'Sin retraso, pero puede empeorar en el trayecto.',h:'sigue'}]});
  return inc;},
 setup(inc){const H=inc.H;
  H.relevo=()=>{inc.relAt=sim.t+irnd(35,55)*60;holdSO(inc,T_(inc),{until:inc.relAt,why:'Esperando al maquinista de relevo'});};
  H.sigue=()=>{inc.risk=true;inc.worseAt=sim.t+irnd(4,12)*60;inc.st='Sigue conduciendo';};
  inc.step=h=>{const t=T_(inc);if(!t)return;
    if(inc.risk&&sim.t>=inc.worseAt){inc.risk=false;
      if(Math.random()<0.4){inc.fail=true;inc.note='Lo prudente era relevarlo en la estación.';
        if(t.zone==='in'||t.zone==='out'){stallTrain(t,inc);inc.relAt=sim.t+irnd(45,70)*60;inc.inLine=true;inc.st='Parado en el trayecto · relevo a las '+fmtHM(inc.relAt);
          toast('El maquinista del '+t.svc.num+' ha tenido que detener el tren en el trayecto');}
        else if(t.spawned&&!passedSO(t))H.relevo();
        else incEnd(inc,false);}
      else incEnd(inc,true);return;}
    if(inc.inLine&&sim.t>=inc.relAt){t.stall=null;toast('Relevado el maquinista del '+t.svc.num);incEnd(inc,true);}};}};

/* Alarma indebida o viajero conflictivo en un MD */
IT.op={n:'Alarma o viajero conflictivo',w:7,can:()=>viCands().length>0,go(){
  const t=ipick(viCands());
  if(Math.random()<0.5){
    const inc=incNew('op',{tr:t.id,alarm:true,sev:'warn',title:'Alarma de emergencia · '+trL(t),
      desc:'Han accionado la alarma de emergencia de un coche del '+trL(t)+(t.zone==='in'?' y el tren se ha detenido en el trayecto.':' en el andén.')+' El interventor no ve a nadie herido: parece una alarma indebida.'});
    if(t.zone==='in')stallTrain(t,inc);
    decide(inc,{title:inc.title,text:inc.desc,opts:[
      {l:'Que el interventor revise el coche y rearme',sub:'3–5′.',h:'rearma'},
      {l:'Retener el tren y avisar a la Guardia Civil',sub:'20–30′ hasta que lleguen.',h:'gcAlarm'}]});
    return inc;}
  const agr=Math.random()<0.5;
  const inc=incNew('op',{tr:t.id,agr:agr,sev:'warn',title:'Viajero conflictivo · '+trL(t),
    desc:'El interventor del '+trL(t)+' avisa: un viajero sin billete se niega a bajar'+(agr?' y le ha empujado; está muy alterado.':' y protesta a voces, sin llegar a más.')});
  decide(inc,{title:inc.title,text:inc.desc,opts:[
    {l:('Avisar a la Guardia Civil y retener el tren en '+NIVEL.nombre),sub:'20–35′ en el andén hasta que lleguen.',h:'gc'},
    {l:('Que el interventor le haga bajar en '+NIVEL.nombre),sub:'4–6′ si colabora.',h:'baja'},
    {l:'Seguir y avisar a seguridad en destino',sub:'Sin retraso.',h:'sigue'}]});
  return inc;},
 setup(inc){const H=inc.H;
  const gc=()=>telLog('out','Guardia Civil','—',(inc.alarm?'Alarma de emergencia accionada':'Viajero conflictivo')+' en el tren '+T_(inc).svc.num+('. Se retiene en '+NIVEL.nombre+'.'),'ok');
  H.rearma=()=>{const t=T_(inc),d=irnd(3,5)*60;if(t.zone==='in'){inc.okAt=sim.t+d;inc.st='Revisando el coche';}else holdSO(inc,t,{dur:d,why:'Rearmando la alarma'});};
  H.gcAlarm=()=>{const t=T_(inc);gc();inc.note='Para una alarma indebida sin incidentes bastaba con rearmar.';if(t.zone==='in')inc.okAt=sim.t+180;holdSO(inc,t,{dur:irnd(20,30)*60,why:'Esperando a la Guardia Civil'});};
  H.gc=()=>{gc();holdSO(inc,T_(inc),{dur:irnd(20,35)*60,why:'Esperando a la Guardia Civil'});};
  H.baja=()=>{const t=T_(inc);
    if(inc.agr&&Math.random()<0.6){inc.fail=true;inc.note='Con un viajero agresivo hay que avisar a la Guardia Civil; al final hubo que llamarla igualmente.';gc();holdSO(inc,t,{dur:irnd(25,40)*60,why:'El viajero no colabora: esperando a la Guardia Civil'});}
    else holdSO(inc,t,{dur:irnd(4,6)*60,why:'Bajando al viajero'});};
  H.sigue=()=>{if(inc.agr)incEnd(inc,false,'Tras una agresión al interventor no se sigue: hay que avisar a la Guardia Civil en la primera estación.');else incEnd(inc,true);};
  inc.step=h=>{if(inc.okAt&&sim.t>=inc.okAt){inc.okAt=0;const t=T_(inc);if(t)t.stall=null;if(!inc.hold)incEnd(inc,true);}};}};

/* =====================================================================
   25. Player actions on trains
   ===================================================================== */
function blkNote(tr){const b=LINE.blk[tr.dir];return b&&b!==tr?' · cantón ocupado por '+b.label+': la señal abrirá cuando quede libre':'';}
function trainActions(tr){
  if(tr.work)return ttActions(tr);
  if(tr.ttRod)return ttRodActions(tr);
  const A=[];
  if(tr.rescue&&tr.rescue.mode==='station'&&!tr.socDone)return socActions(tr);
  if(tr.stall&&!tr.spawned&&INC.list.some(i=>i.soc&&i.tr===tr.id))return A;   // stranded on the line waiting for the socorro: no itinerary for it
  const pre=!tr.routeIn&&(!tr.spawned||tr.phase==='aprox');
  if(pre){
    if(tr.svc.type==='md'&&!tr.towed){(tr.dir>0?['v1','v2','v3']:['v2','v3']).concat(tr.mustStop||tr.oos?['v5']:[]).forEach(t=>{const c=checkIn(tr,t,true);if(c.exists)A.push({act:'in:'+t,label:'Vía '+vn(t),dis:!c.ok,title:c.ok?'Recibir en vía '+vn(t)+(PLAT[t]?' (andén '+PLAT[t]+')':' (sin andén)'):c.msg,primary:t===tr.entryTrack});});}
    else{const ci=checkIn(tr,tr.entryTrack,false),co=checkOut(tr,tr.entryTrack);
      A.push({act:'thru',label:'Paso directo · vía '+vn(tr.entryTrack),dis:!ci.ok||!co.ok,title:!ci.ok?ci.msg:(!co.ok?co.msg:'Abre entrada y salida por la vía general'+blkNote(tr)),primary:!tr.svc.apt&&!tr.mustStop});
      /* when it comes or leaves by the other line track it may have to cross to the other main track */
      if(tr.entryTrack!==normTrack(tr.dir)||exitTrackOf(tr)!==normTrack(tr.dir))['v1','v2'].forEach(t=>{if(t===tr.entryTrack)return;const a=checkIn(tr,t,false);if(!a.exists)return;const b=checkOut(tr,t);
        A.push({act:'thru:'+t,label:'Paso directo · vía '+vn(t),dis:!a.ok||!b.ok,title:!a.ok?a.msg:(!b.ok?b.msg:'Cruza por las diagonales y pasa por la vía '+vn(t)),primary:(ci.ok&&co.ok)?false:(a.ok&&b.ok&&!tr.svc.apt&&!tr.mustStop)});});
      if(tr.svc.type==='merc'||tr.mustStop)['v3','v5'].forEach(t=>{const c=checkIn(tr,t,true),IS=innerStopSig(t,tr.dir),sx=salidaOf(+t[1],tr.dir);
        if(c.exists)A.push({act:'in:'+t,label:'Apartar en vía '+vn(t)+(IS&&sx?' hasta la '+sx.id:''),dis:!c.ok,primary:(!!tr.svc.apt||!!tr.mustStop)&&t===(tr.mustStop&&tr.dir<0&&!ttIn5()?'v5':'v3'),
          title:c.ok?'Recibir y detener en vía '+vn(t)+(IS&&sx?' ante la '+sx.id+' (ocupa la '+IS.protects.toLowerCase()+')':'')+(RETRO[t]?' (en topera: saldrá en retroceso)':'')+(tr.svc.apt?' · apartado previsto, sale a las '+fmtHM(tr.svc.dep):''):c.msg});
        if(IS){const ci=checkIn(tr,t,true,IS);if(ci.exists)A.push({act:'in:'+t+'@'+IS.id,label:'Apartar en vía '+vn(t)+' hasta la '+IS.id,dis:!ci.ok,
          title:ci.ok?'Recibir y detener ante la '+IS.id+': deja libre la '+IS.protects.toLowerCase()+' · caben '+luTo(t,IS)+' m':ci.msg});}});}
  }
  if(tr.routeIn&&!tr.routeIn.passed&&!tr.routeIn.released){const ok=canCancel(tr.routeIn);A.push({act:'cancel',label:'Anular itinerario',dis:!ok,title:ok?'Cierra la señal '+tr.routeIn.sig.id:'Demasiado cerca de la señal para pararlo'});}
  /* held at an intermediate signal on its way into the siding (the S2/3A, for a switch without comprobación beyond it):
     if it fits, it can be left there, short of that switch, instead of sending it on */
  {const S=tr.blockedBy;if(S&&S.kind==='intermedia'&&tr.phase==='entrando'&&tr.stopTrack==='v'+S.t&&!tr.stopSig&&tr.v<0.1&&tr.svc.type!=='md'){const lu=luTo(tr.stopTrack,S);
    A.push({act:'stopHere',label:'Apartarlo aquí, ante la '+S.id,primary:true,dis:tr.len>lu+0.1,title:tr.len>lu+0.1?'No cabe: '+Math.round(tr.len)+' m y hasta la '+S.id+' hay '+lu+' m':'Queda apartado en la vía '+vn(tr.stopTrack)+' antes de la '+S.id+', sin pasar por la '+(S.protects||'aguja').toLowerCase()+((tr.oos||tr.mustStop)&&lu-tr.len<25?' · Ojo: el socorro, al acoplarse por detrás, quedará con la cabeza rebasada la señal de salida y necesitará el telefonema MT 1 de «Marche el tren» para salir':'')});}}
  if(!(tr.routeIn&&!tr.routeIn.passed&&!tr.routeIn.released)&&tr.spawned&&tr.routeOut&&!tr.routeOut.passed&&!tr.routeOut.released){const ok=canCancel(tr.routeOut);
    A.push({act:'cancelOut',label:'Anular salida',dis:!ok,title:ok?'Cierra la señal '+tr.routeOut.sig.id+' y libera el itinerario: el tren queda parado ante ella':'Demasiado cerca de la señal para pararlo'});}
  const hw=incHoldWhy(tr),held=tr.holdUntil>sim.t;
  if(tr.phase==='puertas')A.push({act:'close',label:'Cerrar puertas',primary:!held,dis:held,title:held?hw:'Pitido de cierre'});
  if(tr.phase==='listo'||tr.phase==='apartado'){const c=checkOut(tr,tr.stopTrack);
    const early=tr.md&&sim.t<tr.svc.dep-15;
    const xP=exitPassed(tr),mt=xP&&!tr.mtOk?'Tiene la cabeza rebasada la '+xP.id+' y no la ve: necesita antes el telefonema MT 1 de «Marche el tren»':null;
    A.push({act:'dep',label:c.res&&c.res.ret?'Retroceso y salida':'Dar salida',primary:!hw&&!mt,dis:!c.ok||!!hw||!!mt,title:mt||hw||(c.ok?(early?'Saldría antes de su hora ('+fmtHM(tr.svc.dep)+')':(c.res.ret?'Retrocede por la '+c.res.ret.sig.id+' hasta la vía '+vn(c.res.ret.retro.to)+' y sale por la '+c.res.sig.id:'Abre la señal de salida')+blkNote(tr)):c.msg)});
    if(tr.phase==='listo')A.push({act:'open',label:'Abrir puertas'});}
  /* BAB: by which line track it leaves for the next station */
  if(!tr.done&&!tr.stall&&!(tr.rescue&&tr.rescue.mode==='lineFront')&&!(tr.routeOut&&!tr.routeOut.released)&&!passedSO(tr)&&tr.zone!=='end'){const xt=exitTrackOf(tr),ot=xt==='v1'?'v2':'v1';
    A.push({act:'xt',seg:xt,next:LINE.side[tr.dir].next,label:'Salir por la '+viaN(ot==='v1'?1:-1),title:'Hacia '+LINE.side[tr.dir].next+' saldrá por la '+viaN(xt==='v1'?1:-1)+'. Las dos vías del trayecto admiten trenes en los dos sentidos (BAB).'});}
  if(tr.phase==='pasando'&&!tr.routeOut){const c=checkOut(tr,tr.thruT||tr.entryTrack);A.push({act:'exit',label:'Abrir salida',primary:true,dis:!c.ok,title:c.msg||'Itinerario de salida por la vía general'});}
  return A;
}
function doTrainAct(tr,act){
  if(act.indexOf('in:')===0){const q=act.slice(3).split('@'),t=q[0],S=q[1]?SIGNALS.find(x=>x.id===q[1]):null;const c=checkIn(tr,t,true,S);if(!c.ok){toast(c.msg||'No es posible');return;}
    if(freezeCheck(c.res,tr))return;
    tr.stopTrack=t;tr.stopSig=S;tr.stopX=S?S.x-tr.dir*10:(tr.svc.type==='md'&&PLAT[t])?tr.dir*72:stopOf(t,tr.dir);
    establish(tr,c.res,'in',tr.entrySig);retargetPax(tr);
    toast(tr.label+' → vía '+vn(t)+(S?' hasta la '+S.id:'')+' · señal '+tr.entrySig.id+' abierta');}
  else if(act==='thru'||act.indexOf('thru:')===0){const tk=act==='thru'?tr.entryTrack:act.slice(5);const ci=checkIn(tr,tk,false);if(!ci.ok){toast(ci.msg);return;}
    const co=checkOut(tr,tk);if(!co.ok){toast(co.msg);return;}
    if(freezeCheck(ci.res,tr)||freezeCheck(co.res,tr))return;
    tr.stopTrack=null;tr.stopX=null;tr.stopSig=null;if(tk!==tr.entryTrack)tr.thruT=tk;else if(tr.thruT)tr.thruT=null;establish(tr,ci.res,'in',tr.entrySig);establish(tr,co.res,'out',co.res.sig);
    toast(tr.label+' · paso directo por vía '+vn(tk));}
  else if(act==='ttdep')ttDep(tr);
  else if(act==='ttroad'){const i=ttIncOf(tr);if(i)i.H.road();}
  else if(act==='tthome')ttHome(tr);
  else if(act==='ttrod')ttRodGo(tr);
  else if(act==='soc')socGo(tr);
  else if(act==='socman')socMan(tr);
  else if(act==='xt'){const xt=exitTrackOf(tr);tr.exitT=xt==='v1'?'v2':'v1';uiDirty=true;toast(tr.label+(' saldrá de '+NIVEL.nombre+' por la ')+viaN(tr.exitT==='v1'?1:-1));}
  else if(act==='stopHere'){const S=tr.blockedBy;if(!S)return;tr.stopSig=S;tr.stopX=pathAt(tr.P,tr.s).x;afterPath(tr);
    INC.needs.filter(n=>n.tr===tr.id&&n.sig===S.id).forEach(needDrop);toast(tr.label+' apartado en vía '+vn(tr.stopTrack)+' ante la '+S.id);}
  else if(act==='cancelOut'){if(tr.routeOut&&canCancel(tr.routeOut)){const id=tr.routeOut.sig.id;cancelRoute(tr.routeOut);toast('Salida anulada · señal '+id+' cerrada');}}
  else if(act==='cancel'){if(tr.routeIn&&canCancel(tr.routeIn)){const id=tr.routeIn.sig.id;if(tr.routeOut&&!tr.routeOut.passed)cancelRoute(tr.routeOut);cancelRoute(tr.routeIn);toast('Itinerario anulado · señal '+id+' cerrada');}}
  else if(act==='close'){if(tr.phase==='puertas'&&!(tr.holdUntil>sim.t)){tr.phase='cerrando';tr.t0=sim.t;closeDoors(tr);toast('Cierre de puertas · '+tr.label);}}
  else if(act==='open'){if(tr.phase==='listo'){tr.phase='puertas';openDoors(tr);tr.alightLeft=0;}}
  else if(act==='dep'){const hw=incHoldWhy(tr);if(hw){toast(hw);return;}const c=checkOut(tr,tr.stopTrack);if(!c.ok){toast(c.msg);return;}if(freezeCheck(c.res,tr))return;
    if(c.res.ret){if(freezeCheck(c.res.ret,tr))return;startRetro(tr,c.res.ret);establish(tr,c.res,'out',c.res.sig);
      toast('Retroceso · '+tr.label+' · señal '+c.res.ret.sig.id+' → vía '+vn(c.res.ret.retro.to)+', luego salida por '+c.res.sig.id);}
    else{establish(tr,c.res,'out',c.res.sig);tr.phase='despachando';tr.t0=sim.t;toast('Salida · '+tr.label+' · señal '+c.res.sig.id);}}
  else if(act==='exit'){const c=checkOut(tr,tr.thruT||tr.entryTrack);if(!c.ok){toast(c.msg);return;}if(freezeCheck(c.res,tr))return;establish(tr,c.res,'out',c.res.sig);}
  else if(act==='focus'){const a=trainAnchor(tr);if(a)animTo({tx:a[0],tz:a[2],size:Math.min(cam.size,IS_PHONE?140:170)},0.7);}
  uiDirty=true;if(selId===tr.ent)renderInspector(true);
}
function delayInfo(tr){
  if(tr.work)return{txt:'servicio',cls:''};
  let d;
  if(tr.finalDelay!==undefined)d=tr.finalDelay;
  else if(tr.soDelay!==undefined)d=tr.soDelay;
  else if(!tr.spawned)d=Math.max(0,sim.t+etaSO(tr)-tr.tSOin);
  else d=Math.max(0,sim.t-tr.schedT,tr.entryDelay||0);
  const m=Math.round(d/60);
  if(m<=0)return{txt:'a su hora',cls:'ok'};
  return{txt:'+'+m+'′',cls:m>=4?'stop':'warn'};
}
function trStatus(tr){
  if(tr.work){const w=ttStatus(tr);if(w)return w;}
  if(tr.ttRod&&!tr.done){const w=ttRodStatus(tr);if(w)return w;}
  if(!tr.spawned){const S=LINE.side[tr.dir],m=Math.max(0,Math.ceil(etaSO(tr)/60)),km=((S.Lin-tr.p)/1000).toFixed(1).replace('.',',');
    if(tr.rescue&&(tr.zone==='in'||tr.zone==='out')){const T=trById(tr.rescue.T),n=T?T.svc.num:'';
      if(tr.cpl)return{txt:tr.rescue.mode==='lineBack'?'Acoplado al '+n+': lo remolca de vuelta a '+S.prev:'Acoplando al '+n,cls:'run'};
      if(tr.zone==='out')return{txt:'Por la vía del tren, en marcha a la vista hacia el '+n,cls:'run'};
      if(tr.rescue.mode==='lineBack')return{txt:'En marcha a la vista hacia la cola del '+n+' · a '+km+' km',cls:'run'};}
    if(tr.zone==='in'&&tr.lv<0.5)return{txt:(tr.stall?'Averiado':'Detenido')+' en el trayecto desde '+S.prev+' · a '+km+' km',cls:'stop'};
    let base=(tr.stops?'Llega':'Pasa')+' en '+m+'′';
    if(tr.zone==='in')base+=' · a '+km+' km, viene de '+S.prev;else if(sim.t>=tr.tReady)base+=' · retenido en '+S.prev;else base+=tr.rescue?' · en camino desde '+tr.svc.from+', por '+S.prev+' a las '+fmtHM(tr.tReady):' · sale de '+S.prev+' a las '+fmtHM(tr.tReady);
    if(tr.routeIn)return{txt:base+' · itinerario a vía '+vn(tr.stopTrack||tr.entryTrack),cls:'ok'};
    return{txt:base,cls:m<=3?'warn':''};}
  const iw=incHoldWhy(tr);if(iw&&tr.v<0.3)return{txt:iw,cls:'stop'};
  if(tr.blockedBy){const b=tr.blockedBy.kind==='salida'&&LINE.blk[tr.dir];return{txt:'Detenido ante la señal '+tr.blockedBy.id+(b&&b!==tr?' · cantón ocupado por '+b.label:''),cls:'stop'};}
  const vv=vn(tr.stopTrack||tr.entryTrack);
  switch(tr.phase){
    case'aprox':return tr.routeIn?{txt:'Aproximándose · entra por vía '+vv,cls:'run'}:{txt:'Aproximándose · sin itinerario',cls:'warn'};
    case'entrando':return{txt:'Entrando en vía '+vv,cls:'run'};
    case'pasando':return{txt:'Paso por vía '+vv+(tr.routeOut?'':' · salida cerrada'),cls:tr.routeOut?'run':'warn'};
    case'parado':return{txt:'Parando en vía '+vv,cls:'run'};
    case'puertas':return{txt:'Vía '+vv+' · bajan '+tr.alighted+'/'+tr.alightN+' · suben '+tr.boarded,cls:'ok'};
    case'cerrando':return{txt:'Cerrando puertas',cls:'warn'};
    case'listo':return{txt:'Puertas cerradas · listo para salir',cls:'ok'};
    case'apartado':return{txt:'Apartado en vía '+vv,cls:'ok'};
    case'retroceso':return{txt:tr.retro&&tr.retro.st==='fin'?'Cambiando el sentido de marcha':'Retroceso a vía '+vn((RETRO[tr.stopTrack]||{}).to||'v3')+' (10 km/h)',cls:'run'};
    case'despachando':return{txt:'Dando salida',cls:'run'};
    case'saliendo':return{txt:'Saliendo hacia '+tr.svc.to,cls:'run'};
  }
  return{txt:'',cls:''};
}
/* the train's buttons, and apart from them, on a line of its own, by which track of the line it leaves (BAB) */
function actsHTML(acts,pre,cls){
  const b=acts.filter(a=>!a.seg).map(a=>'<button class="btn'+(a.primary?' primary':'')+'" data-act="'+pre+a.act+'"'+(a.dis?' disabled':'')+' title="'+esc(a.title||'')+'">'+esc(a.label)+'</button>').join('');
  const x=acts.find(a=>a.seg);let h=b?'<div class="'+cls+'">'+b+'</div>':'';
  if(x){const cap=v=>v.charAt(0).toUpperCase()+v.slice(1);
    h+='<div class="xseg" title="'+esc(x.title||'')+'"><span>Salida hacia '+esc(x.next)+'</span><span class="segs">'+
      [['v2',-1],['v1',1]].map(([t,d])=>'<button class="seg'+(x.seg===t?' on':'')+'"'+(x.seg===t?' aria-pressed="true" disabled':' data-act="'+pre+'xt"')+'>'+cap(viaN(d))+'</button>').join('')+'</span></div>';}
  return h;}
function needsAction(tr){return trainActions(tr).some(a=>a.primary&&!a.dis);}

/* =====================================================================
   26. Inspector + list rendering
   ===================================================================== */
let uiDirty=true,lastInsp='';
function trackState(id){
  const occ=TRAINS.find(o=>o.spawned&&!o.done&&bodyPts(o).some(q=>q.t===id&&q.x>X0&&q.x<X1));
  if(occ)return['Ocupada · '+occ.label,'warn'];
  if(ROUTES.some(R=>R.secs.some(sc=>sc.t===id)))return['Itinerario establecido','ok'];
  return['Libre','ok'];
}
/* the passenger train that keeps the sala de viajeros open. By the timetable the station is closed for the night from
   the last passenger train that stops here until half an hour before the first one of the morning (the service day
   starts at 4:00); a late train that has not called yet keeps it open too */
const paxStop=t=>t.stops&&t.svc.type!=='merc'&&t.svc.type!=='socorro';
const PAX_SD=TT_DAY.filter(e=>e[0]!=='merc'&&(e[0]==='md'||e[4])).map(e=>((hm(e[3])-14400)%86400+86400)%86400).sort((a,b)=>a-b);
function salaNext(){let nx=null;TRAINS.forEach(t=>{if(!t.done&&paxStop(t)&&!passedSO(t)&&(!nx||tSO(t)<tSO(nx)))nx=t;});
  if(nx&&tSO(nx)-sim.t<=30*60)return nx;
  const sd=((sim.t%86400-14400)%86400+86400)%86400;
  const closed=!PAX_SD.length||sd>PAX_SD[PAX_SD.length-1]||sd<PAX_SD[0]-30*60;
  return closed?null:nx;}
/* with the sala dark, remind once when the first passenger train of the morning is half an hour away */
function salaRemind(){if(STN.sala)return;let nx=null;TRAINS.forEach(t=>{if(!t.done&&t.stops&&t.svc.type!=='merc'&&t.svc.type!=='socorro'&&!passedSO(t)&&(!nx||tSO(t)<tSO(nx)))nx=t;});
  if(nx&&tSO(nx)-sim.t<30*60&&STN.warned!==nx.id){STN.warned=nx.id;toast('La sala de viajeros sigue a oscuras y el '+trL(nx)+' para a las '+fmtHM(tSO(nx))+': enciende las luces desde el edificio de viajeros');}}
function stateChip(E){
  if(E.kind==='switch'){if(ROUTES.some(R=>R.req[E.sw.id]))return[(E.sw.reverse?'Invertida':'Normal')+' · enclavada','warn'];return E.sw.reverse?['Invertida','warn']:['Normal','ok'];}
  if(E.kind==='signal'){const a=E.sig.aspect;return a==='parada'?['Parada','stop']:a==='rebase'?['Rebase autorizado','warn']:(a==='libre'?['Vía libre','ok']:a==='general'?['A vía general','ok']:a==='desviada'?['A vía desviada','ok']:['Anuncio de parada','warn']);}
  if(E.kind==='crossing'&&E.id==='pn')return PN.down?['Barreras bajadas','warn']:['Barreras levantadas','ok'];
  if(E.kind==='person'){const P=E.person;return[gStatus(P),P.px&&P.px.on?'ok':''];}
  if(E.kind==='house'){const H=HOUSES[E.h];return H.use==='vecino'?['Habitada','ok']:H.use==='segunda'?(GENTE.find(P=>P.home===E.h).here?['Abierta','ok']:['Cerrada','']):['Cerrada',''];}
  if(E.kind==='track')return trackState(E.id);
  if(E.kind==='train'){const s=trStatus(E.train);return[delayInfo(E.train).txt,delayInfo(E.train).cls];}
  return null;
}
function renderInspector(force){
  const E=selId&&ENT[selId];
  if(!E){el.insp.hidden=true;lastInsp='';return;}
  let rows=E.rows.slice(),acts=[],actsH='';
  if(E.kind==='switch'){rows=[['Agujas',E.sw.legs.length>1?E.sw.num.replace('–',' y ')+' (acopladas)':E.sw.num],['Conecta',E.sw.connects],['P.K.',E.sw.pk||'—'],['Calentador',E.sw.cal===false?'No tiene':'Sí'],['Tipo','tg 0,11 · radio 190 m'],['Velocidad por desviada','30 km/h'],['Accionamiento','Motor eléctrico + cerrojo'],['Posición',E.sw.reverse?'Invertida (a desviada)':'Normal (directa)']];
    acts.push('<button class="btn primary" data-act="sw">'+(E.sw.reverse?'Mover a normal':'Mover a invertida')+'</button>');}
  if(E.kind==='signal'){rows=rows.concat([['Aspecto',(E.sig.kind==='retroceso'?{parada:'Parada (rojo, arriba a la izquierda)',general:'A vía general, sin pasar por los cambios (dos blancos a la derecha)',desviada:'A vía desviada (dos blancos abajo)'}:{parada:'Parada (rojo)',libre:'Vía libre (verde)',anuncio:'Anuncio de parada (amarillo)',rebase:'Rebase autorizado (rojo y blanco): parar y seguir en marcha de maniobras'})[E.sig.aspect]]]);
    const R=ROUTES.find(r=>r.sig===E.sig&&!r.passed);if(R){rows.push(['Itinerario',R.tr.label]);acts.push('<button class="btn primary" data-act="sigC"'+(canCancel(R)?'':' disabled')+'>Anular itinerario</button>');}}
  if(E.id==='pn'){rows=rows.concat([['Estado',PN.down?'Bajadas':'Levantadas']]);}
  if(E.id==='edificio'){rows.push(['Sala de viajeros',STN.sala?'Luces encendidas':'Luces apagadas']);
    const nx=salaNext();
    acts.push(STN.sala?'<button class="btn primary" data-act="sala"'+(nx?' disabled title="Aún tiene que parar el '+esc(trL(nx))+' a las '+fmtHM(tSO(nx))+'"':'')+'>Apagar las luces de la sala de viajeros</button>'
      :'<button class="btn primary" data-act="sala">Encender las luces de la sala de viajeros</button>');}
  if(E.kind==='train'&&E.train.work){const tr=E.train,w=tr.work,inc=ttIncOf(tr);
    rows=[['Servicio','Tren de trabajos de Infraestructura'],['Base','Vía 5 de '+NIVEL.nombre+', junto a la topera'],['Composición',tr.comp+' · '+Math.round(tr.len)+' m'],['Tracción',w.loco?'Locomotora diésel 311: circula sin tensión en la catenaria':'Sin locomotora: cuando hace falta viene la 311 de Miranda de Ebro'],['Estado',trStatus(tr).txt]];
    if(inc)rows.push(['Trabajo',inc.title]);if(tr.spawned&&!tr.done)rows.push(['Velocidad',Math.round(tr.v*3.6)+' km/h']);
    actsH=actsHTML(trainActions(tr),'tr:','acts');}
  else if(E.kind==='train'){const tr=E.train;const st=trStatus(tr),dl=delayInfo(tr);
    rows=[['Servicio',(tr.svc.lab?({'Regional':'Regional','R. Exprés':'Regional Exprés'})[tr.svc.lab]:tr.ty.name)+(tr.svc.nombre?' «'+tr.svc.nombre+'»':'')],['Recorrido',tr.svc.from+' → '+tr.svc.to],
      tr.stops?['Horario','llega '+fmtHM(tr.svc.arr)+' · sale '+fmtHM(tr.svc.dep)]:['Horario','pasa '+fmtHM(tr.svc.pass)+' sin parar'],
      ['Trayecto',LINE.side[tr.dir].prev+(' → '+NIVEL.nombre+' → ')+LINE.side[tr.dir].next],
      ['Retraso',dl.txt+((tr.entryDelay||0)>=60&&tr.finalDelay===undefined?' (salió con '+Math.round(tr.entryDelay/60)+'′)':'')],
      ['Composición',(tr.comp||tr.ty.comp)+' · '+Math.round(tr.len)+' m'],['Estado',st.txt]];
    if(tr.spawned&&!tr.done)rows.push(['Velocidad',Math.round(tr.v*3.6)+' km/h']);
    if(tr.svc.type==='md'){rows.push(['Viajeros','bajan '+tr.alighted+'/'+tr.alightN+' · suben '+tr.boarded]);
      const nm=a=>a.length?a.slice(0,3).join(', ')+(a.length>3?' y '+(a.length-3)+' más':''):'';
      const esp=PAX.filter(p=>p.on&&p.train===tr&&p.pid!=null&&p.state!=='leave').map(p=>GENTE[p.pid].n+' '+GENTE[p.pid].a1);
      const baj=(tr.alightQ||[]).map(e=>GENTE[e.pid].n+' '+GENTE[e.pid].a1);
      if(esp.length)rows.push(['Esperan',nm(esp)]);if(baj.length&&!tr.served)rows.push(['Bajarán',nm(baj)]);}
    actsH=actsHTML(trainActions(tr),'tr:','acts');}
  if(E.kind==='person'){const P=E.person;rows=personRows(P);if(P.base!=null)acts.push('<button class="btn" data-act="casa:'+P.base+'">'+(P.kind==='visita'?'Ver la casa de su familia':'Ver su casa')+'</button>');}
  if(E.kind==='house'){rows=houseRows(E.h);GENTE.filter(P=>P.base===E.h&&P.px&&P.px.on).forEach(P=>acts.push('<button class="btn" data-act="px:'+P.id+'">Ver a '+esc(P.n)+'</button>'));}
  if(E.kind==='train'&&E.train.spawned&&!E.train.done){const ok=cabOK(E.train);acts.push('<button class="btn" data-act="cab"'+(ok?'':' disabled')+' title="'+(ok?'La cámara va en el frontal del tren, a la altura del maquinista; arrastra para mirar alrededor':'Disponible mientras el tren está en la maqueta')+'">'+(CAB.on&&CAB.tr===E.train?'Salir de la cabina':'Vista desde cabina')+'</button>');}
  if(getA(E))acts.push('<button class="btn" data-act="focus">Centrar vista</button>');
  const ch=stateChip(E);
  const html=(E.kind==='person'?personHTML(E.person):'<dl class="kv">'+rows.map(r=>'<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>').join('')+'</dl>')+(acts.length?'<div class="acts">'+acts.join('')+'</div>':'')+actsH;
  const sig=E.name+'|'+(E.sub||'')+'|'+(ch?ch.join():'')+'|'+html;
  if(!force&&sig===lastInsp&&!el.insp.hidden)return;
  lastInsp=sig;el.insp.hidden=false;
  el.title.textContent=E.name;el.sub.textContent=E.sub||'';
  document.getElementById('i-ey').textContent=E.kind==='person'?({vecino:E.person.sx==='M'?'Vecina':'Vecino',segunda:'Veranea en el pueblo',visita:'De visita',comarca:'De la comarca'})[E.person.kind]:({train:'Circulación',switch:'Desvío',signal:'Señal',track:'Vía',crossing:'Paso a nivel',house:'Casa'})[E.kind]||'Selección';
  el.insp.classList.toggle('pers',E.kind==='person');
  if(ch&&E.kind!=='person'){el.chip.hidden=false;el.chip.className='chip '+ch[1];el.chip.innerHTML='<i></i>'+esc(ch[0]);}else el.chip.hidden=true;
  el.body.innerHTML=html;
}
function select(id,focus,src){
  selId=(id&&ENT[id])?id:null;
  if(UI.lay==='phone'){if(!selId)setInsp(false);else if(src!=='list'){setInsp(true);if(UI.sheet==='closed')setSheet('half');}}
  paint();renderInspector(true);uiDirty=true;lastBoard='';
  if(selId&&focus){const a=getA(ENT[selId]);if(a)animTo({tx:a[0],tz:a[2],size:Math.min(cam.size,IS_PHONE?150:190)},0.75);}
}
function toggleSwitch(id){
  const S=SW_BY[id];if(!S)return;
  if(S.nc){toast(S.name+' sin comprobación: no se puede mover desde el puesto');return;}
  const R=ROUTES.find(r=>r.req[id]);if(R){toast(S.name+' enclavado por el itinerario de '+R.tr.label);return;}
  if(switchOccupied(id)){toast(S.name+' ocupada por un tren');return;}
  S.reverse=!S.reverse;setSwitchVis(S);repathAll();esqDirty=true;if(selId===id)renderInspector(true);
  toast(S.name+(S.reverse?' → invertida (desviada)':' → normal (directa)'));
}
function signalClick(S){
  const R=ROUTES.find(r=>r.sig===S&&!r.passed);
  if(R){if(canCancel(R)){if(R.kind==='in'&&R.tr.routeOut&&!R.tr.routeOut.passed)cancelRoute(R.tr.routeOut);cancelRoute(R);toast('Itinerario anulado · señal '+S.id+' cerrada');}
    else toast('No se puede anular: el tren ya no puede parar antes de '+S.id);}
  else toast('La señal '+S.id+' se abre al dar itinerario a un tren');
  if(selId==='sig:'+S.id)renderInspector(true);
}
el.body.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b||b.disabled||!selId)return;const E=ENT[selId];const a=b.getAttribute('data-act');
  if(a==='sw')toggleSwitch(E.sw.id);
  else if(a==='sala'){if(STN.sala&&salaNext())return;STN.sala=!STN.sala;STN.warned=null;toast(STN.sala?'Luces de la sala de viajeros encendidas':'Luces de la sala de viajeros apagadas');lastInsp='';}
  else if(a==='sigC')signalClick(E.sig);
  else if(a.indexOf('tr:')===0)doTrainAct(E.train,a.slice(3));
  else if(a==='focus'){if(CAB.on)cabOff();const p=getA(E);if(p)animTo({tx:p[0],tz:p[2],size:Math.min(cam.size,IS_PHONE?150:180)},0.7);}
  else if(a==='cab'){if(CAB.on&&CAB.tr===E.train)cabOff();else cabOn(E.train);}
  else if(a.indexOf('casa:')===0||a.indexOf('px:')===0)select(a,true);
});
document.getElementById('i-close').addEventListener('click',()=>select(null));

/* track entities */
/* fichasVias: fichas de las vías para el inspector (en el archivo del nivel) */
NIVEL.fichasVias();
let tagId=null,hoverDirtyTag=false;
function labelHTML(id){const E=ENT[id];if(!E)return'';const ch=stateChip(E);return esc(E.name)+(ch?'<small>'+esc(ch[0])+'</small>':'');}
const _v=new THREE.Vector3();
function placeTag(){
  const id=hoverId;const a=id&&getA(ENT[id]);
  if(!a){el.tag.classList.remove('on');return;}
  _v.set(a[0],a[1]+(id===selId?5:1),a[2]).project(camera);
  if(_v.z>1||Math.abs(_v.x)>1.1||Math.abs(_v.y)>1.1){el.tag.classList.remove('on');return;}
  if(tagId!==id||hoverDirtyTag){el.tag.innerHTML=labelHTML(id);tagId=id;hoverDirtyTag=false;}
  el.tag.style.left=((_v.x+1)/2*VW())+'px';el.tag.style.top=((1-_v.y)/2*VH())+'px';
  el.tag.classList.add('on');
}
const TYPE_SH={md:'Regional',alvia:'Talgo',merc:'Mercancías',estrella:'Estrella',diurno:'Diurno',ic:'Intercity',socorro:'Socorro',trabajos:'Trabajos'};
const tSO=tr=>tr.stops?tr.svc.arr:tr.svc.pass;
function trNeeds(tr){return trainActions(tr).some(a=>a.primary&&!a.dis)||!!tr.blockedBy;}
function trainItem(tr){
  const st=trStatus(tr),dl=delayInfo(tr),acts=trainActions(tr);
  const time=tr.work?'vía 5':tr.stops?fmtHM(tr.svc.arr)+'–'+fmtHM(tr.svc.dep):'pasa '+fmtHM(tr.svc.pass);
  const need=acts.some(a=>a.primary&&!a.dis)||!!tr.blockedBy;
  const far=!tr.spawned&&tSO(tr)-sim.t>12*60;
  const ord=CTC.msgs.find(m=>m.state==='pending'&&m.tr&&m.tr.indexOf(tr.id)>=0);
  return '<article class="titem t-'+tr.svc.type+(need?' need':'')+(far?' far':'')+(selId===tr.ent?' sel':'')+'" data-tr="'+tr.id+'">'+
    '<div class="trow"><span class="tbadge '+tr.svc.type+'">'+(tr.svc.type==='merc'?'MERC':(tr.svc.lab||tr.ty.label).toUpperCase())+'</span><b>'+tr.svc.num+'</b>'+(ord?'<span class="tord" title="'+esc(ord.text)+'">CTC</span>':'')+'<span class="tdest">→ '+esc(tr.svc.to)+'</span><span class="ttime">'+time+'</span></div>'+
    '<div class="tstate"><i class="dot '+st.cls+'"></i><span>'+esc(st.txt)+'</span><span class="dl '+dl.cls+'">'+dl.txt+'</span></div>'+
    actsHTML(acts,'','tacts')+
    '</article>';
}
let lastList='';
const UI={page:'trenes',sheet:'half',inspOpen:false,lay:LAYQ()};
const setBadge=(id,n,cls)=>{const b=document.getElementById(id);if(!b)return;b.hidden=!n;if(n)b.textContent=String(n);if(cls!==undefined)b.className='badge'+(cls?' '+cls:'');};
function renderList(){
  const list=TRAINS.filter(t=>!t.done&&(t.spawned||t.rescue||t.work||tSO(t)-sim.t<28*60)).sort((a,b)=>tSO(a)-tSO(b)).slice(0,8);   // a dispatched socorro is listed from the moment it leaves Miranda
  const html=list.length?list.map(trainItem).join(''):'<p class="tempty">No hay trenes previstos en la próxima media hora.</p>';
  if(html!==lastList){lastList=html;el.tlist.innerHTML=html;}
  const active=TRAINS.filter(t=>t.spawned&&!t.done).length;
  el.trNext.textContent=active?(active===1?'1 tren en la estación':active+' trenes en la estación'):'Sin trenes en la estación';
  const need=list.filter(trNeeds).length;setBadge('tr-n',need);setBadge('tb-tr',need);
  if(UI.lay==='phone'&&UI.page==='trenes')document.getElementById('ptitle-s').textContent=el.trNext.textContent;
}

/* CTC: the Puesto de Mando's orders and notices, newest first */
const ctcEl=document.getElementById('ctclist');let lastCtc='';
function ctcVisible(){return UI.page==='ctc'&&(UI.lay!=='phone'||(UI.sheet!=='closed'&&!UI.inspOpen));}
function renderCTC(){
  CTC.tab=ctcVisible()?'ctc':'tr';if(CTC.tab==='ctc')CTC.unread=0;
  setBadge('ctc-n',CTC.unread,'blue');setBadge('tb-ctc',CTC.unread,'blue');
  const pend=CTC.msgs.filter(m=>m.state==='pending').length;
  const sum=pend?(pend===1?'1 orden pendiente':pend+' órdenes pendientes'):'Sin órdenes pendientes';
  document.getElementById('ctc-sum').textContent=sum;
  if(UI.lay==='phone'&&UI.page==='ctc')document.getElementById('ptitle-s').textContent=sum;
  if(UI.page!=='ctc')return;
  const html=CTC.msgs.length?CTC.msgs.map(m=>{const lab={pending:'ORDEN',ok:'CUMPLIDA',fail:'NO CUMPLIDA',info:'AVISO'}[m.state];
    const right=m.state==='pending'&&m.deadline?(m.deadline>sim.t?'plazo '+Math.ceil((m.deadline-sim.t)/60)+'′':'plazo vencido'):'';
    return '<article class="cmsg '+m.state+'" data-m="'+m.id+'"><div class="ch"><b>'+lab+'</b><span>'+fmtHM(m.t)+'</span><span>'+right+'</span></div><div class="ct">'+esc(m.text)+(m.note?' <em>'+esc(m.note)+'</em>':'')+'</div></article>';}).join('')
    :'<p class="tempty">Sin órdenes ni avisos del Puesto de Mando.</p>';
  if(html!==lastCtc){lastCtc=html;ctcEl.innerHTML=html;}
}

/* station board: the next three hours through Santa Olalla, like the monitor on the platform */
const boardEl=document.getElementById('board');let lastBoard='';
function boardState(tr){
  const dl=delayInfo(tr);
  if(tr.done||passedSO(tr))return{t:(tr.stops?'salió ':'pasó ')+(dl.cls==='ok'?'':dl.txt),c:'',past:1};
  if(tr.spawned){
    if(tr.blockedBy)return{t:'Detenido',c:'stop'};
    const P={aprox:['Llegando','run'],entrando:['Entrando','run'],pasando:['Pasando','run'],parado:['Parando','run'],puertas:['Embarque','ok'],cerrando:['Cierre','warn'],
      listo:['Listo','ok'],apartado:['Apartado','warn'],despachando:['Salida','run'],saliendo:['Saliendo','run']}[tr.phase]||['En estación','run'];
    return{t:P[0],c:P[1],now:1};}
  if(tr.zone==='pre'&&sim.t>=tr.tReady&&!tr.routeIn&&tr.zone!=='in')return{t:'Retenido',c:'warn'};
  if(tr.zone==='in'&&tr.lv<0.5)return{t:'Detenido',c:'stop'};
  return dl.cls==='ok'?{t:'A su hora',c:'ok'}:{t:dl.txt,c:dl.cls};
}
function renderBoard(){
  const rows=TRAINS.filter(t=>{const T=tSO(t);return T<=sim.t+3*3600&&(T>=sim.t-20*60||!passedSO(t));}).sort((a,b)=>tSO(a)-tSO(b)).slice(0,18);
  const html=rows.length?rows.map(tr=>{const s=boardState(tr);const v=(tr.routeIn||tr.spawned||tr.done)?(tr.stopTrack||tr.entryTrack||'')[1]||'':'';
    return '<div class="brow'+(s.past?' past':'')+(s.now?' now':'')+(selId===tr.ent?' sel':'')+'" data-tr="'+tr.id+'" title="'+esc(TYPE_SH[tr.svc.type]||'')+' '+tr.svc.num+' · '+esc(tr.svc.from)+' → '+esc(tr.svc.to)+'">'+
      '<span class="h">'+fmtHM(tSO(tr))+'</span><span class="n"><i class="'+tr.svc.type+'"></i>'+tr.svc.num+'</span>'+
      '<span class="d">'+esc(tr.svc.to)+(tr.stops?'':'<small>sin parada</small>')+'</span><span class="v">'+(v||'·')+'</span><span class="o '+s.c+'">'+esc(s.t)+'</span></div>';}).join('')
    :'<p class="tempty">Sin circulaciones en las próximas horas.</p>';
  if(html!==lastBoard){lastBoard=html;boardEl.innerHTML=html;}
}

/* shift: the score in tiles and the trains that reached the next station in the last hour */
const turnoEl=document.getElementById('turno');let lastTurno='';
function caras(){const K=GENTE.filter(P=>P.seen>0).sort((a,b)=>b.seen-a.seen||(b.last||0)-(a.last||0)).slice(0,10);
  return'<div class="sect">Caras conocidas<span class="r">'+GENTE.filter(P=>P.seen>0).length+' de '+GENTE.length+'</span></div><div class="log">'+
    (K.length?K.map(P=>'<div class="lrow pz" data-px="'+P.id+'"><span class="m"><b>'+esc(P.n+' '+P.a1)+'</b> · '+esc(P.kind==='comarca'?P.from:P.kind==='vecino'?HOUSES[P.home].addr:P.city)+
      '<br><small>'+esc(gStatus(P))+'</small></span><span class="n" style="color:var(--ink-3)" title="Veces que la has visto">'+P.seen+'×</span></div>').join('')
      :'<p class="tempty">Todavía no has visto a nadie. Pincha en un viajero para saber quién es.</p>')+'</div>';}
turnoEl.addEventListener('click',e=>{const hj=e.target.closest('[data-hoja]');if(hj){const h=CAR.hojas[+hj.getAttribute('data-hoja')];if(h)hojaShow(h,false);return;}
  const r=e.target.closest('[data-px]');if(!r)return;const P=GENTE[+r.getAttribute('data-px')];select('px:'+P.id,!!(P.px&&P.px.on));});
function renderTurno(){
  if(UI.page!=='turno')return;
  const p=stats.trains?Math.round(stats.onTime/stats.trains*100):null,pc=p===null?'':(p>=90?'ok':p>=75?'warn':'stop');
  const cm=Math.round(stats.caused/60),nOrd=stats.ordOk+stats.ordFail,pend=CTC.msgs.filter(m=>m.state==='pending').length;
  const onLine=TRAINS.filter(t=>t.zone==='in'||t.zone==='out'||(t.spawned&&!t.done)).length;
  const tile=(lab,val,cls,sub,extra,wide)=>'<div class="tile'+(wide?' wide':'')+'"><small>'+lab+'</small><b class="'+(cls||'')+'">'+val+'</b>'+(sub?'<span>'+sub+'</span>':'')+(extra||'')+'</div>';
  const log=TRAINS.filter(t=>t.zone==='end').sort((a,b)=>b.tEnd-a.tEnd).slice(0,10);
  const html='<div class="sect">Marcador de la jornada<span class="r">'+fmtHM(sim.t)+'</span></div><div class="tiles">'+
    tile('Puntualidad',p===null?'—':p+'%',pc,stats.trains?stats.onTime+' de '+stats.trains+' trenes sin retraso tuyo':'Aún no ha llegado ningún tren',p===null?'':'<div class="meter"><i style="width:'+p+'%;background:var(--'+pc+')"></i></div>',true)+
    tile('Retraso generado',cm+'′',cm>=15?'stop':cm>=5?'warn':'ok','en tu tramo')+
    tile('Órdenes CTC',nOrd?stats.ordOk+'/'+nOrd:'—',nOrd?(stats.ordFail?'warn':'ok'):'',pend?pend+' pendiente'+(pend>1?'s':''):'cumplidas')+
    tile('Viajeros',String(stats.paxIn+stats.paxOut),'','suben '+stats.paxIn+' · bajan '+stats.paxOut)+
    tile('En tierra',String(stats.lost),stats.lost?'stop':'ok','perdieron su tren')+
    tile('Incidencias',(stats.incOk+stats.incFail)?stats.incOk+'/'+(stats.incOk+stats.incFail):'—',(stats.incOk+stats.incFail)?(stats.incFail?'warn':'ok'):'',INC.list.length?INC.list.length+' en curso':(stats.incOk+stats.incFail)?'resueltas sin fallos / total':'ninguna todavía')+
    tile('Telefonemas',String(stats.telOk),stats.telErr?'warn':'',stats.telErr?stats.telErr+' sin efecto o erróneos':'cursados')+
    '</div>'+hojaTurno()+'<div class="sect">Últimas llegadas<span class="r">'+onLine+' en línea</span></div><div class="log">'+
    (log.length?log.map(t=>{const d=Math.round(t.finalDelay/60),c=Math.round(t.caused/60);
      return '<div class="lrow"><span class="tbadge '+t.svc.type+'">'+(t.svc.type==='merc'?'MERC':(t.svc.lab||t.ty.label).toUpperCase())+'</span><span class="m"><b>'+t.svc.num+'</b> → '+esc(LINE.side[t.dir].next)+' '+fmtHM(t.tEnd)+'</span>'+
        '<span class="n" style="color:var(--ink-3)">'+(d>0?'+'+d+'′':'0′')+'</span><span class="n" style="color:var(--'+(c>=2?'stop':c>=1?'warn':'ok')+')" title="Retraso generado en tu tramo">'+(c>0?'tú +'+c+'′':'✓')+'</span></div>';}).join('')
      :'<p class="tempty">Todavía no ha llegado ningún tren a '+esc(LINE.side['1'].prev)+' ni a '+esc(LINE.side['1'].next)+'.</p>')+'</div>'+caras();
  if(html!==lastTurno){lastTurno=html;turnoEl.innerHTML=html;}
}

/* line: block sections to Briviesca and Quintanapalla, both tracks, with faults, works and speed limits */
const linEl=document.getElementById('lin'),incEl=document.getElementById('incs');let lastLin='',lastInc='';
const LIN={a:118,b:430,c:650,d:962,y:{'1':27,'-1':45}};
function linX(dir,zone,p){const S=LINE.side[dir],L=zone==='in'?S.Lin:S.Lout,k=clamp(p/L,0,1);
  if(dir>0)return zone==='in'?lerp(LIN.a,LIN.b,k):lerp(LIN.c,LIN.d,k);
  return zone==='in'?lerp(LIN.d,LIN.c,k):lerp(LIN.b,LIN.a,k);}
function cantons(dir,zone){const S=LINE.side[dir],L=zone==='in'?S.Lin:S.Lout,c=[];
  if(zone==='in'){for(let a=0;a<L;a+=LINE.C)c.push([a,Math.min(L,a+LINE.C)]);}
  else{c.push([0,LINE.OB1]);for(let a=LINE.OB1;a<L;a+=LINE.C)c.push([a,Math.min(L,a+LINE.C)]);}
  if(c.length>1&&c[c.length-1][1]-c[c.length-1][0]<600){const l=c.pop();c[c.length-1][1]=l[1];}
  return c;}
function segName(dir,zone){const S=LINE.side[dir];return zone==='in'?S.prev+(' – '+NIVEL.nombre):(NIVEL.nombre+' – ')+S.next;}
function incidents(){
  const out=[];
  if(sim.t<LINE.powerUntil)out.push({c:'stop',t:'Sin tensión en catenaria · hasta '+fmtHM(LINE.powerUntil)});
  INC.list.forEach(i=>out.push({c:i.sev==='stop'?'stop':'warn',t:i.chip?i.chip():i.title}));
  LINE.faults.forEach(f=>{if(f.inc)return;const nm=segName(f.dir,f.zone)+' (sentido '+(f.dir>0?NIVEL.lado.e:NIVEL.lado.o)+')';
    if(!fAct(f)){if(f.kind==='corte'&&f.from>sim.t)out.push({c:'info',t:'Corte previsto '+fmtHM(f.from)+'–'+fmtHM(f.until)+' · '+nm});return;}
    if(f.kind==='corte')out.push({c:'stop',t:'Corte por obras · '+nm+' · hasta '+fmtHM(f.until)});
    else if(f.kind==='ltv')out.push({c:'warn',t:'Limitación '+Math.round(f.v*3.6)+' km/h · '+nm+' · hasta '+fmtHM(f.until)});
    else out.push({c:'stop',t:'Fallo de circuito de vía · '+nm+' · hasta '+fmtHM(f.until)});});
  if(WX.fog>0.5)out.push({c:'warn',t:'Niebla · marcha a la vista (100 km/h, mercancías 60)'});
  return out;
}
function renderLinea(){
  const s=['<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#5A1E1A"/><rect width="3" height="6" fill="#F0544A"/></pattern></defs>'];
  const sb=(x0,x1,nm,cls)=>'<rect class="st '+(cls||'')+'" x="'+x0+'" y="4" width="'+(x1-x0)+'" height="56" rx="5"/><text class="stn" x="'+((x0+x1)/2)+'" y="17" text-anchor="middle">'+nm+'</text>';
  s.push(sb(6,LIN.a-10,LINE.side['1'].prev),sb(LIN.b+8,LIN.c-8,(NIVEL.nombre),'so'),sb(LIN.d+10,1074,LINE.side['1'].next));
  const blq=s=>{const i=INC.list.find(x=>x.k==='ba'&&x.s===s);return i?(i.bt?'bloqueo telefónico':'sin bloqueo'):'bloqueo automático banalizado';};
  const kw=s=>blq(s)!=='bloqueo automático banalizado'?' kmw':'';
  s.push('<text class="km'+kw('B')+'" x="'+((LIN.a+LIN.b)/2)+'" y="8" text-anchor="middle">10,8 km · '+blq('B')+'</text><text class="km'+kw('Q')+'" x="'+((LIN.c+LIN.d)/2)+'" y="8" text-anchor="middle">11,2 km · '+blq('Q')+'</text>');
  const cap=x=>x.charAt(0).toUpperCase()+x.slice(1);
  s.push('<text class="arr" x="'+LIN.a+'" y="74">→ '+cap(viaN(1))+' · sentido '+NIVEL.lado.e+'</text><text class="arr" x="'+LIN.d+'" y="74" text-anchor="end">sentido '+NIVEL.lado.o+' · '+cap(viaN(-1))+' ←</text>');
  /* trains on the station board (approaching the entry signal, in the station or leaving): head position, squeezed so the station itself gets the middle of the box */
  {const B0=LIN.b+14,B1=LIN.c-14,m0=LIN.b+58,m1=LIN.c-58,X=2400,E=260;
   const bx=x=>x<-E?lerp(B0,m0,clamp((x+X)/(X-E),0,1)):x>E?lerp(m1,B1,clamp((x-E)/(X-E),0,1)):lerp(m0,m1,(x+E)/(2*E));
   [1,-1].forEach(dir=>{const y=LIN.y[dir];s.push('<line class="sl" x1="'+B0+'" y1="'+y+'" x2="'+B1+'" y2="'+y+'"/>');
     let lastX=null;TRAINS.filter(t=>t.dir===dir&&t.spawned&&!t.done&&t.zone==='vis'&&t.P).map(t=>({t:t,x:bx(pathAt(t.P,t.s).x)})).sort((a,b)=>dir*(b.x-a.x)).forEach(o=>{
       const t=o.t,x=o.x,crowd=lastX!==null&&Math.abs(lastX-x)<34;if(!crowd)lastX=x;
       s.push('<g data-tr="'+t.id+'"><path class="tm '+t.svc.type+'" d="M'+(x-dir*9).toFixed(1)+' '+(y-4.5)+'h'+(dir*5)+'l'+(dir*5)+' 4.5l'+(-dir*5)+' 4.5h'+(-dir*5)+'z"/>'+
         (crowd?'':'<text class="tn" x="'+x.toFixed(1)+'" y="'+(y+(dir>0?11:12))+'" text-anchor="middle">'+t.svc.num+'</text>')+'<title>'+esc(t.label)+' · '+NIVEL.nombre+(t.stopTrack?' · vía '+vn(t.stopTrack):'')+'</title></g>');});});}
  [1,-1].forEach(dir=>{const y=LIN.y[dir];
    ['in','out'].forEach(zone=>{
      const occ=TRAINS.filter(t=>t.dir===dir&&t.zone===zone&&!t.alt),L0=zone==='in'?LINE.side[dir].Lin:LINE.side[dir].Lout,
        ctv=TRAINS.filter(t=>t.alt&&t.dir===-dir&&t.zone===(zone==='in'?'out':'in'));   // the other direction, using this track
      cantons(dir,zone).forEach(c=>{const x0=linX(dir,zone,c[0]),x1=linX(dir,zone,c[1]);const xa=Math.min(x0,x1)+1.5,xb=Math.max(x0,x1)-1.5;
        const flt=LINE.faults.find(f=>f.kind!=='ltv'&&fAct(f)&&f.dir===dir&&f.zone===zone&&(f.a||0)>=c[0]-1&&(f.a||0)<c[1]-1);
        const busy=occ.some(t=>t.p>c[0]&&t.p-t.len<c[1])||ctv.some(t=>{const q=L0-t.p;return q<c[1]&&q+t.len>c[0];});
        s.push('<rect class="'+(flt?'cx':busy?'co':'cf')+'" x="'+xa.toFixed(1)+'" y="'+(y-3)+'" width="'+(xb-xa).toFixed(1)+'" height="6" rx="1.5"><title>'+(flt?(flt.inc?flt.inc.title:flt.kind==='corte'?'Corte por obras':'Fallo de circuito de vía'):busy?'Cantón ocupado':'Cantón libre')+'</title></rect>');});
      if(ltvCap(dir,zone)<Infinity){const x0=linX(dir,zone,0),x1=linX(dir,zone,9e9),yy=dir>0?y-8:y+8;
        s.push('<line class="ltv" x1="'+Math.min(x0,x1)+'" y1="'+yy+'" x2="'+Math.max(x0,x1)+'" y2="'+yy+'"/><text class="ltvt" x="'+((x0+x1)/2)+'" y="'+(dir>0?yy-3:yy+9)+'" text-anchor="middle">'+Math.round(ltvCap(dir,zone)*3.6)+'</text>');}
      let lastX=-1e9;occ.slice().sort((a,b)=>b.p-a.p).forEach(t=>{const x=linX(dir,zone,t.p),ty=dir>0?y-7:y+7;
        const crowd=Math.abs(lastX-x)<40;if(!crowd)lastX=x;
        s.push('<g data-tr="'+t.id+'"><path class="tm '+t.svc.type+'" d="M'+(x-dir*9).toFixed(1)+' '+(y-4.5)+'h'+(dir*5)+'l'+(dir*5)+' 4.5l'+(-dir*5)+' 4.5h'+(-dir*5)+'z"/>'+
          (crowd?'':'<text class="tn" x="'+x.toFixed(1)+'" y="'+(dir>0?ty-2:ty+8)+'" text-anchor="middle">'+t.svc.num+'</text>')+'<title>'+esc(t.label)+' · '+segName(dir,zone)+'</title></g>');});
      ctv.forEach(t=>{const x=linX(dir,zone,L0-t.p),d=-dir,ty=dir>0?y-7:y+7;
        s.push('<g data-tr="'+t.id+'"><path class="tm '+t.svc.type+'" d="M'+(x-d*9).toFixed(1)+' '+(y-4.5)+'h'+(d*5)+'l'+(d*5)+' 4.5l'+(-d*5)+' 4.5h'+(-d*5)+'z"/>'+
          '<text class="tn" x="'+x.toFixed(1)+'" y="'+(dir>0?ty-2:ty+8)+'" text-anchor="middle">'+t.svc.num+'</text><title>'+esc(t.label)+' · por la '+viaN(dir)+'</title></g>');});
    });
    /* trains held or waiting at the previous station */
    const S=LINE.side[dir],wait=TRAINS.filter(t=>t.dir===dir&&t.zone==='pre'&&t.tReady-sim.t<20*60).sort((a,b)=>a.tReady-b.tReady);
    /* up to three, one per line (the third becomes «+N más» when there are more) */
    if(wait.length){const x=dir>0?(6+LIN.a-10)/2:(LIN.d+10+1074)/2,n=wait.length>3?2:wait.length;
      wait.slice(0,n).forEach((w,k)=>{const held=sim.t>=w.tReady,y=31+k*11,tm=held?'ret.':fmtHM(w.tReady);
        s.push('<g data-tr="'+w.id+'"><text class="tw" x="'+x+'" y="'+y+'" text-anchor="middle">'+(dir>0?w.svc.num+' → <tspan class="km">'+tm+'</tspan>':'<tspan class="km">'+tm+'</tspan> ← '+w.svc.num)+'</text><title>'+esc(w.label)+(held?' retenido en ':' sale de ')+S.prev+(held?'':' a las '+fmtHM(w.tReady))+'</title></g>');});
      if(wait.length>3)s.push('<text class="km" x="'+x+'" y="'+(31+2*11)+'" text-anchor="middle">+'+(wait.length-2)+' más</text>');}
  });
  const html=s.join('');if(html!==lastLin){lastLin=html;linEl.innerHTML=html;}
  const inc=incidents();
  const ih=inc.length?inc.map(i=>'<span class="inc '+i.c+'"><i></i>'+esc(i.t)+'</span>').join(''):'<span class="inc ok"><i></i>Línea sin incidencias</span>';
  if(ih!==lastInc){lastInc=ih;incEl.innerHTML=ih;}
  setBadge('tb-vias',inc.filter(i=>i.c!=='info').length);
}
linEl.addEventListener('click',e=>{const g=e.target.closest('[data-tr]');if(!g)return;const t=trById(g.getAttribute('data-tr'));if(t)select(t.ent,t.spawned,'list');});
boardEl.addEventListener('click',e=>{const r=e.target.closest('[data-tr]');if(!r)return;const t=trById(r.getAttribute('data-tr'));if(t)select(t.ent,t.spawned,'list');});

/* incidents page: what is going on, what the player has to do, the telefonema form and the book */
const incListEl=document.getElementById('inclist'),libEl=document.getElementById('libro');let lastIncH='',lastLib='';
const tfK=document.getElementById('tf-k'),tfT=document.getElementById('tf-tr'),tfG=document.getElementById('tf-g'),tfP=document.getElementById('tf-p');
tfK.innerHTML='<option value="">— Elige el telefonema —</option>'+Object.keys(TK).map(k=>'<option value="'+k+'">'+TK[k].n+'</option>').join('');
function setOpts(sel,html){if(sel._h===html)return;const v=sel.value;sel.innerHTML=html;sel._h=html;if(Array.prototype.some.call(sel.options,o=>o.value===v))sel.value=v;}
function tfOpts(){
  const trs=TRAINS.filter(t=>!t.done&&t.zone!=='end'&&(t.spawned||t.work||t.zone==='in'||(t.zone==='pre'&&tSO(t)-sim.t<40*60))).sort((a,b)=>tSO(a)-tSO(b));
  setOpts(tfT,'<option value="">—</option>'+trs.map(t=>'<option value="'+t.id+'">'+esc(t.svc.num+' · '+(TYPE_SH[t.svc.type]||'')+' → '+t.svc.to)+'</option>').join(''));
  const sb=INC.list.filter(i=>i.sbg).map(i=>'<option value="'+i.sbg+'">'+esc(ucf(tgLabel(i.sbg)))+'</option>').join('');
  const mot=INC.list.filter(i=>i.mot).map(i=>'<option value="mot:'+i.id+'">'+esc(i.mot)+'</option>').join('');
  setOpts(tfG,'<option value="">—</option><optgroup label="Señales">'+SIGNALS.map(S=>'<option value="sig:'+S.id+'">Señal '+S.id+'</option>').join('')+sb+'</optgroup>'+
    '<optgroup label="Trayectos">'+['B','Q'].map(s=>'<option value="tray:'+s+'">Trayecto '+trayN(s)+'</option>').join('')+'</optgroup>'+
    '<optgroup label="Vías de los trayectos">'+['B','Q'].map(s=>[1,2].map(v=>'<option value="'+viaG(s,v)+'">'+esc(ucf(tgLabel(viaG(s,v))))+'</option>').join('')).join('')+'</optgroup>'+
    (mot?'<optgroup label="Motivos de precaución">'+mot+'</optgroup>':''));
}
function tfPrev(){const k=tfK.value,t=tfT.value?trById(tfT.value):null,g=tfG.value,f=k?TK[k].f:'tg';
  tfT.disabled=f.indexOf('t')<0;tfG.disabled=f.indexOf('g')<0;
  tfP.innerHTML=k?'<b>'+esc(TK[k].n)+'</b> · a '+esc(telTo(k,t,g))+'<br>«'+esc(telText(k,f.indexOf('t')>=0?t:null,f.indexOf('g')>=0?g:''))+'»'
    :'Elige el tipo de telefonema, el tren y la señal, el trayecto o el motivo. El texto reglamentario se completa solo.';}
[tfK,tfT,tfG].forEach(s=>s.addEventListener('change',tfPrev));
document.getElementById('tf-go').addEventListener('click',()=>{const k=tfK.value,f=k?TK[k].f:'';
  if(telSend(k,f.indexOf('t')>=0?tfT.value:'',f.indexOf('g')>=0?tfG.value:'')){tfK.value='';tfT.value='';tfG.value='';}tfPrev();lastIncH='';renderInc();});
incListEl.addEventListener('click',e=>{const b=e.target.closest('[data-n]');if(!b)return;const n=INC.needs.find(x=>x.id===+b.getAttribute('data-n'));if(!n)return;
  const a=b.getAttribute('data-a');
  if(a==='prep'){tfOpts();tfK.value='';tfT.value=n.tr||'';tfG.value=n.g||'';tfPrev();document.getElementById('telf').scrollIntoView({block:'nearest',behavior:'smooth'});tfK.focus();}
  else if(a[0]==='b'){solDo(n,+a.slice(1));lastIncH='';renderInc();}
  else if(a==='tr'){const t=trById(n.tr);if(t)select(t.ent,t.spawned,'list');}});
function renderInc(){
  const nP=INC.needs.length+(INC.dOpen?1:0)+INC.dq.length;setBadge('inc-n',nP);setBadge('tb-inc',nP);
  const sum=INC.list.length?(INC.list.length===1?'1 incidencia':INC.list.length+' incidencias')+(INC.needs.length?' · '+INC.needs.length+' pendiente'+(INC.needs.length>1?'s':''):''):'Sin incidencias';
  document.getElementById('inc-sum').textContent=sum;
  if(UI.lay==='phone'&&UI.page==='inc')document.getElementById('ptitle-s').textContent=sum;
  if(UI.page!=='inc')return;
  tfOpts();
  const card=i=>{const ns=INC.needs.filter(n=>n.inc===i);
    return'<article class="icard '+i.sev+'"><div class="ih"><b>'+esc(i.title)+'</b><span>'+fmtHM(i.t0)+'</span></div><p class="ix">'+esc(i.desc)+'</p>'+(i.st?'<p class="ist">'+esc(i.st)+'</p>':'')+
      ns.map(n=>'<div class="ineed'+(sim.t-n.t0>90?' late':'')+'"><span>'+esc(n.txt)+'</span><div class="ib">'+
        (n.k==='tel'?'<button class="btn" data-n="'+n.id+'" data-a="prep">Redactar telefonema</button>':n.btns.map((b,j)=>'<button class="btn primary" data-n="'+n.id+'" data-a="b'+j+'">'+esc(b.l)+'</button>').join(''))+
        (n.tr?'<button class="btn" data-n="'+n.id+'" data-a="tr">Ver tren</button>':'')+'</div></div>').join('')+'</article>';};
  const h=(INC.list.length?INC.list.map(card).join(''):'<p class="tempty">Sin incidencias en curso.</p>')+
    (INC.hist.length?'<div class="sect" style="padding-left:2px">Cerradas</div>'+INC.hist.slice(0,6).map(x=>'<div class="ihist '+(x.ok?'ok':'bad')+'"><i></i><span><b>'+esc(x.title)+'</b> · '+fmtHM(x.t0)+'–'+fmtHM(x.t)+(x.note?'<em>'+esc(x.note)+'</em>':'')+'</span></div>').join(''):'');
  if(h!==lastIncH){lastIncH=h;incListEl.innerHTML=h;}
  document.getElementById('tel-n').textContent=INC.telN?INC.telN+' anotados':'';
  const lb=INC.tel.length?INC.tel.slice(0,40).map(e=>'<div class="lib '+e.io+(e.res==='err'?' err':'')+'"><div class="lh"><b>Nº '+e.n+'</b><span>'+fmtHM(e.t)+'</span><span>'+(e.io==='out'?'→ ':'← ')+esc(e.who)+'</span>'+(e.res==='err'?'<span class="bad">sin efecto</span>':'')+'</div><div class="lt">'+esc(e.text)+'</div></div>').join('')
    :'<p class="tempty">Libro vacío.</p>';
  if(lb!==lastLib){lastLib=lb;libEl.innerHTML=lb;}
}
tfPrev();

/* pages, layout and the phone sheet */
const PTITLE={trenes:'Trenes',ctc:'Puesto de Mando',inc:'Incidencias',vias:'Vías y línea',tablero:'Tablero',turno:'Turno'};
const pagesEl=document.getElementById('pages'),sideR=document.getElementById('sideR'),pgTab=document.getElementById('pg-tablero');
function setPage(p){
  if(UI.lay!=='phone'&&p==='vias')p='trenes';
  if(UI.lay==='wide'&&p==='tablero')p='trenes';
  UI.page=p;
  pagesEl.querySelectorAll(':scope>.page').forEach(n=>n.classList.toggle('on',n.getAttribute('data-page')===p));
  document.querySelectorAll('#ptabs [data-page],#tabbar [data-page]').forEach(b=>b.setAttribute('aria-selected',String(b.getAttribute('data-page')===p)));
  document.getElementById('ptitle-t').textContent=PTITLE[p];document.getElementById('ptitle-s').textContent='';
  if(p==='vias')requestAnimationFrame(()=>{document.querySelectorAll('#mando .esq-wrap,#mando .lin-wrap').forEach(w=>{w.scrollLeft=(w.scrollWidth-w.clientWidth)/2;});});
  lastCtc='';lastList='';lastTurno='';lastIncH='';lastLib='';uiDirty=true;renderCTC();renderList();renderTurno();renderInc();
}
function setTab(t){setPage(t==='ctc'?'ctc':'trenes');}
function sheetPx(s){const H=window.innerHeight;return s==='full'?Math.max(200,stageEl.clientHeight-8):Math.round(H*0.42);}
function setSheet(s){UI.sheet=s;el.app.setAttribute('data-sheet',s);if(s!=='closed')el.trains.style.setProperty('--sheet-h',sheetPx(s)+'px');uiDirty=true;}
function setInsp(on){UI.inspOpen=on;el.app.setAttribute('data-insp',on?'1':'0');uiDirty=true;}
function layout(){
  const L=LAYQ();UI.lay=L;el.app.setAttribute('data-lay',L);
  const insp=el.insp;
  if(L==='wide'){sideR.appendChild(insp);sideR.appendChild(pgTab);el.app.insertBefore(el.mando,document.getElementById('tabbar'));}
  else if(L==='mid'){stageEl.appendChild(insp);pagesEl.appendChild(pgTab);el.app.insertBefore(el.mando,document.getElementById('tabbar'));}
  else{el.trains.appendChild(insp);pagesEl.appendChild(pgTab);pagesEl.appendChild(el.mando);}
  document.getElementById('tab-tab').hidden=L==='wide';
  setPage(UI.page);if(L==='phone')setSheet(UI.sheet);
  resize();
}
document.getElementById('ptabs').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)setPage(b.getAttribute('data-page'));});
document.getElementById('tabbar').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(!b)return;const p=b.getAttribute('data-page');
  if(UI.sheet==='closed'){setInsp(false);setPage(p);setSheet('half');}
  else if(p===UI.page&&!UI.inspOpen)setSheet('closed');
  else{setInsp(false);setPage(p);}});
document.getElementById('sheetX').addEventListener('click',()=>setSheet('closed'));
document.getElementById('mcoll').addEventListener('click',()=>{const c=el.mando.getAttribute('data-coll')==='1';el.mando.setAttribute('data-coll',c?'0':'1');});
(function(){let y0=0,h0=0,drag=false;const start=e=>{if(UI.lay!=='phone'||e.target.closest('button'))return;drag=true;y0=e.clientY;h0=el.trains.offsetHeight;el.trains.classList.add('drag');e.currentTarget.setPointerCapture(e.pointerId);};
  const move=e=>{if(!drag)return;const h=clamp(h0+(y0-e.clientY),60,sheetPx('full'));el.trains.style.setProperty('--sheet-h',h+'px');};
  const end=e=>{if(!drag)return;drag=false;el.trains.classList.remove('drag');const h=el.trains.offsetHeight,H=window.innerHeight;
    if(Math.abs(e.clientY-y0)<4){setSheet(UI.sheet==='full'?'half':'full');return;}
    setSheet(h<H*0.24?'closed':h<H*0.62?'half':'full');};
  ['grip','ptitle'].forEach(id=>{const n=document.getElementById(id);n.addEventListener('pointerdown',start);n.addEventListener('pointermove',move);n.addEventListener('pointerup',end);n.addEventListener('pointercancel',end);});})();
ctcEl.addEventListener('click',e=>{const it=e.target.closest('[data-m]');if(!it)return;const m=CTC.msgs.find(x=>x.id===+it.getAttribute('data-m'));
  const t=m&&m.tr&&trById(m.tr[0]);if(t)select(t.ent,t.spawned,'list');});
el.tlist.addEventListener('click',e=>{
  const it=e.target.closest('[data-tr]');if(!it)return;const tr=TRAINS.find(t=>t.id===it.getAttribute('data-tr'));if(!tr)return;
  const b=e.target.closest('[data-act]');
  if(b){if(!b.disabled)doTrainAct(tr,b.getAttribute('data-act'));return;}
  select(tr.ent,tr.spawned,'list');
});

/* =====================================================================
   27. Puesto de mando (track diagram)
   ===================================================================== */
const SX=x=>80+(x-EX0)/(EX1-EX0)*920;   // the diagram shows the station area
/* esquema: esquema de vías del puesto de mando (en el archivo del nivel) */
const {SY,esqPath,esqY,ESQ_BR}=NIVEL.esquema();
let esqDirty=true;
function buildEsq(){
  const s=[];
  NIVEL.esqFondo(s);   // the level draws its own background: labels, building, platforms, tracks and their numbers
  SWITCHES.forEach(S=>{
    S.legs.forEach((L,i)=>{const x=SX(L.x),y=SY[L.t];const b=ESQ_BR[S.id+':'+i];const dx=b[0]-x,dy=b[1]-y,len=Math.hypot(dx,dy);
      s.push('<line class="leg" id="lgS-'+S.id+'-'+i+'" x1="'+x+'" y1="'+y+'" x2="'+(x+L.dir*15)+'" y2="'+y+'"/>');
      s.push('<line class="leg" id="lgB-'+S.id+'-'+i+'" x1="'+x+'" y1="'+y+'" x2="'+(x+dx/len*17)+'" y2="'+(y+dy/len*17)+'"/>');});
    S.legs.forEach((L,i)=>{const x=SX(L.x),y=SY[L.t];
      s.push('<g class="swg" data-ent="'+S.id+'" data-sw="'+S.id+'"><circle class="swn" cx="'+x+'" cy="'+y+'" r="5.2"/></g>');
      const num=S.legs.length>1?S.num.split('–')[i]:S.num;
      s.push('<text class="swl" x="'+x+'" y="'+(L.t===1?y-10:y+16)+'" text-anchor="middle">'+num+'</text>');});
  });
  SIGNALS.forEach(S=>{const x=SX(S.x),y=SY[S.t];const up=(S.t===1||S.t===3)?-1:1;const yy=y+up*12,lf=(S.x<0)!==(S.lbl==='in');   // name on the outer side, or towards the centre
    s.push('<g class="sig parada" data-ent="sig:'+S.id+'" data-sig="'+S.id+'"><line class="mast" x1="'+x+'" y1="'+(y+up*4)+'" x2="'+x+'" y2="'+yy+'"/>'+
      (S.kind==='retroceso'?'<rect class="mono" x="'+(x-4.6)+'" y="'+(yy+up*3.5-4.6)+'" width="9.2" height="9.2" rx="1.5"/>'+
        MONO_L.map(([k,dz,dy])=>'<circle class="ml ml-'+k+'" cx="'+(x+dz*2.2)+'" cy="'+(yy+up*3.5-dy*2.2)+'" r="1.6"/>').join(''):
        '<circle class="lamp" cx="'+x+'" cy="'+(yy+up*3.5)+'" r="4.2"/>')+
      '<rect x="'+(x-9)+'" y="'+(yy+up*3.5-9)+'" width="18" height="18" fill="transparent"/>'+
      '<text class="sgl" x="'+(x+(lf?-6.5:6.5))+'" y="'+(S.t===3?y-4:yy+up*3.5+3)+'" text-anchor="'+(lf?'end':'start')+'">'+S.id+'</text></g>');});
  el.esq.innerHTML=s.join('');
}
function drawEsq(){
  SWITCHES.forEach(S=>{S.legs.forEach((L,i)=>{const a=document.getElementById('lgS-'+S.id+'-'+i),b=document.getElementById('lgB-'+S.id+'-'+i);
    if(a)a.classList.toggle('on',!S.reverse);if(b)b.classList.toggle('on',S.reverse);});});
  SIGNALS.forEach(S=>{const g=el.esq.querySelector('[data-sig="'+S.id+'"]');if(g){g.classList.remove('parada','libre','anuncio','general','desviada','rebase');g.classList.add(S.aspect);g.classList.toggle('fx',INC.list.some(i=>i.sig===S));}});
  SWITCHES.forEach(S=>{const g=el.esq.querySelector('[data-sw="'+S.id+'"]');if(g)g.classList.toggle('fx',!!S.nc);});
  const pnE=el.esq.querySelector('.pn');if(pnE)pnE.classList.toggle('fx',!!PN.fault&&!PN.fault.guard);
  const gr=document.getElementById('esqR');
  if(gr)gr.innerHTML=INC.list.filter(i=>i.c).map(i=>{const p=[];for(let x=i.c.a;x<=i.c.b;x+=10)p.push(SX(x).toFixed(1)+','+esqY(i.c.t,x).toFixed(1));return'<polyline class="cvf" points="'+p.join(' ')+'"/>';}).join('')+ROUTES.map(R=>{const pp=R.pts.filter(q=>q.x>=EX0&&q.x<=EX1);if(pp.length<2)return'';
    return'<polyline class="rt'+(R.passed?' passed':'')+'" points="'+pp.map(q=>SX(q.x).toFixed(1)+','+esqY(q.t,q.x).toFixed(1)).join(' ')+'"/>';}).join('');
  const gt=document.getElementById('esqT');
  if(gt){let h='';const ghost={};
    TRAINS.filter(t=>!t.spawned&&!t.done).forEach(t=>{const k=t.dir+(t.entryTrack||''),e=etaSO(t);if(e<=5*60&&(!ghost[k]||e<etaSO(ghost[k])))ghost[k]=t;});
    TRAINS.forEach(tr=>{
      if(tr.done)return;
      if(!tr.spawned){const eta=etaSO(tr);if(eta>5*60)return;const gk=tr.dir+(tr.entryTrack||'');if(ghost[gk]!==tr)return;
        const x=tr.dir>0?SX(EX0)-6:SX(EX1)+6,y=SY[tr.entryTrack==='v1'?1:2];
        h+='<text class="tl ghost" x="'+x+'" y="'+(y+3.5)+'" text-anchor="'+(tr.dir>0?'end':'start')+'">'+tr.svc.num+' '+Math.max(0,Math.ceil(eta/60))+'′</text>';return;}
      const pts=[];for(let d=0;d<=tr.len;d+=5){const q=pathAt(tr.P,tr.s-d);if(q.x<EX0||q.x>EX1)continue;pts.push(SX(q.x).toFixed(1)+','+esqY(q.t,q.x).toFixed(1));}
      const hp=pathAt(tr.P,tr.s);
      if(pts.length>=2){h+='<polyline class="tt '+tr.svc.type+'" points="'+pts.join(' ')+'"/>';}
      if(hp.x<EX0||hp.x>EX1){if(pts.length<2){const x=tr.dir>0?(hp.x<EX0?SX(EX0)-6:SX(EX1)+6):(hp.x>EX1?SX(EX1)+6:SX(EX0)-6);const y=SY[tr.entryTrack==='v1'?1:2];
          h+='<text class="tl" x="'+x+'" y="'+(y+3.5)+'" text-anchor="'+(x<500?'end':'start')+'">'+tr.svc.num+(hp.x*tr.dir<0?' ▸':'')+'</text>';}}
      else{const y=esqY(hp.t,hp.x);const above=(hp.t==='v1'||hp.t==='v3'||hp.t==='dw');
        h+='<text class="tl" x="'+SX(hp.x).toFixed(1)+'" y="'+(above?y-9:y+15).toFixed(1)+'" text-anchor="'+(tr.dir>0?'end':'start')+'">'+tr.svc.num+'</text>';}
    });gt.innerHTML=h;}
  esqDirty=false;
}
buildEsq();drawEsq();
el.esq.addEventListener('click',e=>{
  const sw=e.target.closest('[data-sw]');if(sw){const id=sw.getAttribute('data-sw');toggleSwitch(id);select(id,false);return;}
  const sg=e.target.closest('[data-sig]');if(sg){const S=SIGNALS.find(x=>x.id===sg.getAttribute('data-sig'));if(S){select('sig:'+S.id,false);signalClick(S);}return;}
  const t=e.target.closest('[data-ent]');if(t){select(t.getAttribute('data-ent'),true);}
});
el.esq.addEventListener('mousemove',e=>{const t=e.target.closest('[data-ent]');const id=t?t.getAttribute('data-ent'):null;if(id!==hoverId){hoverId=id;paint();}});
el.esq.addEventListener('mouseleave',()=>{hoverId=null;paint();});

/* =====================================================================
   28. Input
   ===================================================================== */
const ptrs=new Map();let mode=null,lastX=0,lastY=0,downX=0,downY=0,downT=0,pinchD=0,hoverDirty=false,mx=-1,my=-1;
/* touch. One finger turns the board sideways and tilts it up and down, as before, but calmer and locked to the
   direction the finger sets off in (sideways only turns, up and down only tilts; diagonally, both), so turning does
   not tilt it by accident. Two fingers move it (the board follows them), pinch to zoom and twist to turn.
   A tap selects; a double tap zooms in there (on a train, signal or building it also selects it and centres it);
   a two-finger tap zooms out. When one of two fingers lifts, the other does nothing until it lifts too.
   The mouse keeps its controls: drag to turn, right button or shift to move, wheel to zoom. */
const TCH={on:false,lastTap:0,tapX:0,tapY:0,g:null,two:0,moved:false,lt:0,ax:null};
function firstUse(){}
function twoState(){const a=[...ptrs.values()];return{d:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),ang:Math.atan2(a[1].y-a[0].y,a[1].x-a[0].x),cx:(a[0].x+a[1].x)/2,cy:(a[0].y+a[1].y)/2,ys:[a[0].y,a[1].y]};}
canvas.addEventListener('pointerdown',e=>{
  try{canvas.setPointerCapture(e.pointerId);}catch(_){}ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY});camAnim=null;
  TCH.on=e.pointerType==='touch'||e.pointerType==='pen';
  if(ptrs.size===1){mode=TCH.on?'torbit':((e.button===2||e.shiftKey)?'pan':'orbit');TCH.ax=null;lastX=downX=e.clientX;lastY=downY=e.clientY;downT=performance.now();TCH.moved=false;TCH.lt=downT;
    vel.theta=vel.elev=vel.px=vel.pz=0;}
  else if(ptrs.size===2){mode='pinch';const s=twoState();pinchD=s.d;lastX=s.cx;lastY=s.cy;TCH.g={ang:s.ang,ang0:s.ang,d0:s.d,cx0:s.cx,cy0:s.cy,ys:s.ys,lock:null,rot:false};TCH.two=performance.now();vel.px=vel.pz=0;}
});
canvas.addEventListener('pointermove',e=>{
  mx=e.clientX;my=e.clientY;hoverDirty=true;
  if(!ptrs.has(e.pointerId))return;const P=ptrs.get(e.pointerId);P.x=e.clientX;P.y=e.clientY;
  if(CAB.on){   // in the cab: one finger or the mouse looks round, two fingers zoom
    if(mode==='pinch'&&ptrs.size===2){const s=twoState();if(s.d>0&&pinchD>0)cabZoom(pinchD/s.d);pinchD=s.d;if(TCH.g&&Math.abs(s.d-TCH.g.d0)>14)TCH.g.lock='zoom';return;}
    if(mode==='orbit'||mode==='pan'||mode==='torbit'){
      if(mode==='torbit'&&!TCH.moved){if(Math.hypot(e.clientX-downX,e.clientY-downY)<9)return;TCH.moved=true;lastX=e.clientX;lastY=e.clientY;}
      cabLook(e.clientX-lastX,e.clientY-lastY);lastX=e.clientX;lastY=e.clientY;TCH.lt=performance.now();}
    return;}
  if(mode==='orbit'){const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;
    vel.theta=-dx*0.0055;vel.elev=dy*0.0035;cam.theta+=vel.theta;cam.elev+=vel.elev;}
  else if(mode==='pan'){const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;vel.px=0;vel.pz=0;panPx(dx,dy);}
  else if(mode==='torbit'){/* a little dead zone first, so a tap that wobbles does not move the board; then the axis */
    if(!TCH.moved){const ddx=e.clientX-downX,ddy=e.clientY-downY;if(Math.hypot(ddx,ddy)<9)return;
      TCH.moved=true;TCH.ax=Math.abs(ddx)>Math.abs(ddy)*1.4?'h':Math.abs(ddy)>Math.abs(ddx)*1.4?'v':'hv';lastX=e.clientX;lastY=e.clientY;}
    const dx=e.clientX-lastX,dy=e.clientY-lastY,now=performance.now();lastX=e.clientX;lastY=e.clientY;TCH.lt=now;
    if(TCH.ax!=='v'){vel.theta=-dx*0.0042;cam.theta+=vel.theta;}else vel.theta=0;
    if(TCH.ax!=='h'){cam.elev+=dy*0.0028;}vel.elev=0;}
  else if(mode==='pinch'&&ptrs.size===2){const s=twoState(),G=TCH.g;
    const dM=Math.hypot(s.cx-G.cx0,s.cy-G.cy0),dD=Math.abs(s.d-G.d0),dA=Math.abs(Math.atan2(Math.sin(s.ang-G.ang0),Math.cos(s.ang-G.ang0)));
    if(!G.lock&&(dM>14||dD>14||dA>0.12))G.lock='zoom';   // the fingers have really moved (not a two-finger tap)
    if(G.lock==='zoom'){
      if(s.d>0&&pinchD>0)zoomAt(s.cx,s.cy,pinchD/s.d);
      /* turn only once the twist is clear (about 10°), so a pinch does not also rotate the board */
      if(!G.rot&&dA>0.17)G.rot=true;
      if(G.rot){let da=Math.atan2(Math.sin(s.ang-G.ang),Math.cos(s.ang-G.ang));const gp=groundAt(s.cx,s.cy);cam.theta+=da;placeCam();
        if(gp){const g2=groundAt(s.cx,s.cy);if(g2){cam.target.x+=gp.x-g2.x;cam.target.z+=gp.z-g2.z;}}}
      panPx(s.cx-lastX,s.cy-lastY);vel.px=0;vel.pz=0;}
    pinchD=s.d;G.ang=s.ang;lastX=s.cx;lastY=s.cy;}
});
/* zoom in at a point of the screen (and, on a thing, select it and centre it) */
function tapZoom(px,py){if(CAB.on){CAB.yawTo=0;CAB.pitch=-0.03;return;}const id=pickAt(px,py),L=CAMLIM();
  if(id){select(id,false);const a=getA(ENT[id]);if(a){animTo({tx:a[0],tz:a[2],size:clamp(Math.min(cam.size*0.55,IS_PHONE?110:140),L.s0,L.s1)},0.6);return;}}
  const g=groundAt(px,py);if(g)animTo({tx:g.x,tz:g.z,size:clamp(cam.size*0.5,L.s0,L.s1)},0.5);}
function endPtr(e){
  const now=performance.now();
  if(ptrs.size===1&&mode==='orbit'){const dt=now-downT,dd=Math.hypot(e.clientX-downX,e.clientY-downY);
    if(dt<450&&dd<7){vel.theta=0;vel.elev=0;const id=pickAt(e.clientX,e.clientY);select(id,false);}}
  if(ptrs.size===1&&mode==='torbit'){
    if(!TCH.moved&&now-downT<400){vel.px=vel.pz=vel.theta=0;
      if(now-TCH.lastTap<330&&Math.hypot(e.clientX-TCH.tapX,e.clientY-TCH.tapY)<30){TCH.lastTap=0;tapZoom(e.clientX,e.clientY);}
      else{TCH.lastTap=now;TCH.tapX=e.clientX;TCH.tapY=e.clientY;const id=pickAt(e.clientX,e.clientY);select(id,false);}}
    else if(now-TCH.lt>70)vel.theta=0;                          // the finger stopped before lifting: no spin
    else vel.theta=clamp(vel.theta*0.6,-0.02,0.02);}
  /* a quick two-finger tap: zoom out */
  if(ptrs.size===2&&mode==='pinch'&&TCH.g&&!TCH.g.lock&&now-TCH.two<300&&!CAB.on){const s=twoState(),L=CAMLIM();TCH.g.lock='done';animTo({size:clamp(cam.size*1.8,L.s0,L.s1)},0.45);}
  ptrs.delete(e.pointerId);
  if(!ptrs.size)mode=null;
  else if(ptrs.size===1){const a=[...ptrs.values()][0];mode=TCH.on?'idle':'orbit';lastX=downX=a.x;lastY=downY=a.y;downT=0;TCH.moved=true;TCH.lt=now;vel.px=vel.pz=vel.theta=0;}
}
canvas.addEventListener('pointerup',endPtr);
canvas.addEventListener('pointercancel',e=>{ptrs.delete(e.pointerId);if(!ptrs.size)mode=null;});
canvas.addEventListener('pointerleave',()=>{mx=-1;if(hoverId){hoverId=null;paint();}});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('wheel',e=>{e.preventDefault();camAnim=null;if(CAB.on){cabZoom(Math.exp(e.deltaY*0.0011));return;}zoomAt(e.clientX,e.clientY,Math.exp(e.deltaY*0.0011));},{passive:false});
const _pv=new THREE.Vector3();
function pickPerson(px,py){const r=canvas.getBoundingClientRect(),W=r.width,Hh=r.height;let best=null,bd=1e9;
  for(const p of PAX){if(!p.on||p.pid==null)continue;
    _pv.set(p.x,p.y,p.z).project(camera);if(_pv.z>1)continue;const fx=r.left+(_pv.x+1)/2*W,fy=r.top+(1-_pv.y)/2*Hh;
    _pv.set(p.x,p.y+1.9,p.z).project(camera);const hy=r.top+(1-_pv.y)/2*Hh,hgt=Math.max(1,fy-hy),half=Math.max(7,hgt*0.32);
    if(px<fx-half||px>fx+half||py<hy-6||py>fy+5)continue;const dd=Math.abs(px-fx)+Math.abs(py-(fy+hy)/2)*0.5;if(dd<bd){bd=dd;best=p;}}
  return best?'px:'+best.pid:null;}
function pickAt(px,py){const pp=pickPerson(px,py);if(pp)return pp;ray.setFromCamera(toNdc(px,py),camera);const h=ray.intersectObjects(PICK,false);return h.length?h[0].object.userData.ent:null;}
function rotate(dir){if(CAB.on){CAB.yawTo=(CAB.yawTo!==null?CAB.yawTo:CAB.yaw)-dir*PI/2;return;}const base=camAnim?camAnim.to.theta:cam.theta;animTo({theta:base+dir*PI/2},0.6);}
document.getElementById('rotL').addEventListener('click',()=>rotate(-1));
document.getElementById('freeCam').addEventListener('click',()=>setFree(!FREE.on));
document.getElementById('rotR').addEventListener('click',()=>rotate(1));
document.getElementById('home').addEventListener('click',()=>{if(CAB.on)cabOff();setFree(false);const k=Math.round((cam.theta-HOME.theta)/TAU);animTo({theta:HOME.theta+k*TAU,elev:HOME.elev,size:HOME.size,tx:HOME.tx,tz:HOME.tz},0.8);});
const SPEEDS=[1,2,8,16,32,'auto'];
function setSpeed(v){sim.auto=v==='auto';if(sim.auto){AUTO.cur=AUTO.base;AUTO.calm=performance.now()+1500;sim.speed=AUTO.base;}else sim.speed=v;sim.paused=false;
  document.getElementById('speed').value=sim.auto?'auto':String(v);autoLabel(true);document.getElementById('pause').setAttribute('aria-pressed','false');}
/* Auto: time runs fast while nothing is going on and drops to ×2 when something needs the player or is worth watching:
   a train less than three minutes from the board with its itinerary still to give, a train moving on the board, a train stopped with something to do (a departure,
   only from a minute before its time), a decision or a telefonema pending, and for a few seconds after any notice
   (Puesto de Mando, a new incident, a telefonema received). It speeds up again, gently, a moment after it all calms down */
var AUTO={base:2,fast:120,ahead:180,calm:0,hold:0,cur:2,lab:''};   // var: notices can come while the level is being built
function autoPing(s){if(!AUTO)return;AUTO.hold=Math.max(AUTO.hold,performance.now()+(s||4)*1000);}
function autoTrain(tr){
  if(tr.done||tr.zone==='end'||tr.zone==='out')return false;
  if(!tr.spawned){if(tr.stall||tr.routeIn||etaSO(tr)>=AUTO.ahead)return false;   // still on the line: only while its itinerary is to be given
    return trainActions(tr).some(a=>!a.dis&&/^(in:|thru)/.test(a.act));}
  if(tr.v>0.2){const a=pathAt(tr.P,tr.s).x,b=pathAt(tr.P,Math.max(0,tr.s-tr.len)).x;   // moving: while it is on the board or about to come in (the track runs on beyond it)
    if(Math.max(a,b)>X0-150&&Math.min(a,b)<X1+150)return true;}
  const A=trainActions(tr).filter(a=>a.primary&&!a.dis);if(!A.length)return false;
  if(A.every(a=>a.act==='dep')&&tr.svc.dep!==undefined&&sim.t<tr.svc.dep-60)return false;   // waiting for its time
  return true;}
function autoBusy(){
  if(performance.now()<AUTO.hold||INC.dOpen||INC.dq.length)return true;
  if(INC.needs.some(n=>{const t=n.tr&&trById(n.tr);return!t||autoTrain(t);}))return true;
  return TRAINS.some(autoTrain);}
function autoStep(dt){const now=performance.now();
  if(autoBusy()){AUTO.calm=now+2500;AUTO.cur=AUTO.base;}
  else if(now>AUTO.calm)AUTO.cur=Math.min(AUTO.fast,AUTO.cur*Math.exp(dt*2.2));
  sim.speed=AUTO.cur;autoLabel();}
function autoLabel(force){const o=document.querySelector('#speed option[value="auto"]');if(!o)return;
  const t=sim.auto&&AUTO.cur>AUTO.base*1.5?'Auto »':'Auto';if(t!==AUTO.lab||force){AUTO.lab=t;o.textContent=t;}}
/* big steps of simulated time go in slices of at most a second (people and cars move once per slice); a slice that
   opens a dialog (a decision, the end of the jornada) stops the rest */
function opsRun(g){if(g<=1){opsStep(g);return;}let r=g;while(r>1e-6&&!sim.paused){const c=Math.min(1,r);opsStep(c);r-=c;}}
function togglePause(){if(GAME.over)return;sim.paused=!sim.paused;document.getElementById('pause').setAttribute('aria-pressed',sim.paused?'true':'false');toast(sim.paused?'Simulación en pausa':'Simulación en marcha');}
document.getElementById('speed').addEventListener('change',e=>{const v=e.target.value;setSpeed(v==='auto'?'auto':+v);e.target.blur();});
document.getElementById('pause').addEventListener('click',togglePause);
window.addEventListener('keydown',e=>{
  if(!document.getElementById('menu').hidden||!document.getElementById('gdlg').hidden)return;
  if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT'))return;
  const k=e.key.toLowerCase();
  if(k==='q')rotate(-1);else if(k==='e')rotate(1);else if(k==='r')document.getElementById('home').click();
  else if(k==='d')devToggle();else if(k==='m')sndSet(!SND.on);else if(k==='c')setFree(!FREE.on);else if(k==='escape'){if(CAB.on)cabOff();else select(null);}
  else if(k===' '){e.preventDefault();togglePause();}
  else if(k>='1'&&k<='6')setSpeed(SPEEDS[+k-1]);
});
window.addEventListener('resize',()=>{if(LAYQ()!==UI.lay)layout();else{resize();if(UI.lay==='phone'&&UI.sheet!=='closed')setSheet(UI.sheet);}});
if(window.ResizeObserver){let rw=0,rh=0;new ResizeObserver(()=>{const w=VW(),hh=VH();if(w!==rw||hh!==rh){rw=w;rh=hh;resize();}}).observe(stageEl);}

/* =====================================================================
   28b. Modo desarrollador: trenes de prueba a demanda (solo visuales)
   ===================================================================== */
const DEV={trains:[],n:0,opt:{m:'sem-full',t:'v3',d:1,o:'park',v:60,loco:''}};
/* the line through a track: v3 leaves v2 at ±152, v5 leaves v3 at 60 and ends at its buffer stop */
function devPath(t,len){
  const a=X0-len-30,b=X1+len+30;
  const chain=t==='v1'?[['v1',a,b]]:t==='v2'?[['v2',a,b]]:t==='v3'?[['v2',a,-152],['v3',-152,152],['v2',152,b]]:
    [['v5',TOPE.v5.x,60],['v3',60,152],['v2',152,b]];
  let pts=[];chain.forEach(c=>{pts=pts.concat(ptsRange(c[0],c[1],c[2]));});return pts;
}
function devSpecs(m,dir){
  const rnd=()=>Math.floor(Math.random()*1e6);
  const F={tolvas:{kind:'tolvas',load:'full'},'tolvas-v':{kind:'tolvas',load:'empty'},'sem-full':{kind:'semat',load:'full'},'sem-mixed':{kind:'semat',load:'mixed'},'sem-empty':{kind:'semat',load:'empty'},jpd:{kind:'jpd'},mixto:{kind:'mixto'}};
  if(m==='md'){let s=carSpecs('md');if(dir<0)s=s.slice().reverse().map(o=>Object.assign({},o,{cab:-o.cab}));return{type:'md',specs:s};}
  if(m==='alvia')return{type:'alvia',specs:carSpecs('alvia')};
  if(m==='estrella')return{type:'estrella',specs:estrellaSpecs(rnd())};
  if(m.startsWith('r432:'))return{type:'md',specs:specs432(m.slice(5),dir)};
  if(m.startsWith('r448:'))return{type:'ic',specs:specs448(m.slice(5),dir)};
  if(m.startsWith('r10k:')){const lv=m.slice(5);return{type:'estrella',specs:[{k:'loco252',L:R252.L,cab:1,panto:1}].concat(Object.keys(R10K).filter(k=>R10K[k].l===lv).map(k=>({k:'r10k',car:k,L:R10.L,flip:0})))};}
  const lo=DEV.opt.loco||undefined;
  if(m==='merc')return{type:'merc',specs:mercSpecs(rnd(),undefined,lo)};
  if(F[m]){let s;for(let k=0;k<40;k++){s=mercSpecs(rnd(),F[m],lo);if(m!=='mixto'||new Set(s.slice(1).map(x=>x.k)).size>=3)break;}return{type:'merc',specs:s};}
  if(m==='loco252')return{type:'alvia',specs:[{k:'loco252',L:R252.L,cab:1,panto:1}]};
  if(m==='loco269')return{type:'merc',specs:[{k:'loco269',L:R269.L,cab:2,panto:1}]};
  if(m.startsWith('loco311'))return{type:'merc',specs:[pick311(m.split(':')[1])]};
  if(m.startsWith('tt:')){const q=m.slice(3),one={ci1:{k:'ttci',car:1,L:RCI.L},ci2:{k:'ttci',car:2,L:RCI.L},bob:{k:'ttbob',L:5.2},cast:{k:'ttcast',L:5.2}}[q];
    const s=one?[one]:(q==='full'?[pick311()]:[]).concat(TT_SPECS.slice().reverse().map(o=>Object.assign({},o)));return{type:'merc',specs:s};}
  if(m==='loco319')return{type:'merc',specs:[{k:'loco319',L:R319.L,cab:2,num:UNITS319[Math.floor(Math.random()*UNITS319.length)]}]};
  if(m.startsWith('tt6-')){const q=m.split('-');return{type:'merc',specs:[{k:'hopper',L:HOP_L,liv:q[1],load:+q[2],flip:0}]};}
  if(m.startsWith('jpd-'))return{type:'merc',specs:[{k:'jpd',L:JPD_L,liv:m.slice(4),flip:0}]};
  if(m.startsWith('semat-')){const v=m.slice(6),e=v==='e';const L=e?['am','gr','ma'][Math.floor(Math.random()*3)]:v;
    return{type:'merc',specs:[{k:'semat',L:SEMAT_L,liv:L,slots:e?[]:[0,1,2,3,4,5,6,7],flip:0,ld:semLoad(Math.floor(Math.random()*1e6))}]};}
  return{type:'merc',specs:mercSpecs(rnd())};
}
function devRemove(d){
  d.cars.forEach(c=>{rel10k(c);scene.remove(c.g);c.g.traverse(o=>{if(o.isMesh&&o.geometry&&!o.geometry.userData.keep)o.geometry.dispose();});if(c.pools)c.pools.forEach(p=>p.m.material.dispose());});
  if(d.frontMats){Object.values(d.frontMats).forEach(m=>{if(m.map)m.map.dispose();m.dispose();});d.frontMats=null;}
  d.cars=[];const i=DEV.trains.indexOf(d);if(i>=0)DEV.trains.splice(i,1);
}
function devSpawn(){
  const o=DEV.opt,C=devSpecs(o.m,o.d),n=++DEV.n;
  DEV.trains.filter(x=>x.track===o.t).forEach(devRemove);
  const d={id:'dev'+n,ent:'dev:'+n,dev:true,dir:o.d,track:o.t,svc:{type:C.type,num:0,to:o.d>0?'Valladolid':'Vitoria-Gasteiz'},
    doorA:tmat(DOOR_C),doorB:tmat(DOOR_C),cars:[],gap:gapOf(C.type),run:o.o==='run',v:o.v/3.6};
  C.specs.forEach((sp,i,a)=>{const c=buildCar(d,sp,i,a.length);c.body.forEach(m=>{const k=PICK.indexOf(m);if(k>=0)PICK.splice(k,1);});scene.add(c.g);d.cars.push(c);});
  d.len=d.cars.reduce((s,c)=>s+c.L,0)+(d.cars.length-1)*d.gap;
  let pts=devPath(o.t,d.len);if(o.d<0)pts=pts.slice().reverse();d.P=mkPath(pts);
  const sH=sOfX(d.P,o.d*d.len/2,o.t);d.s0=d.len+1;d.s=d.run?d.s0:(sH!==null?sH:d.P.len/2+d.len/2);
  placeCars(d);DEV.trains.push(d);
  const nm=C.type==='merc'&&C.specs.length>1?compText('merc',C.specs):(o.m==='loco319'||o.m.startsWith('loco311'))?'Locomotora '+C.specs[0].num:document.querySelector('#dev-m option[value="'+o.m+'"]').textContent;
  toast('Prueba · '+nm+' · vía '+vn(o.t)+' · '+Math.round(d.len)+' m');
  if(!d.run)animTo({tx:0,tz:zOn(o.t,0),size:Math.min(cam.size,Math.max(IS_PHONE?120:150,d.len*1.15))},0.7);
  devNote();
}
function devStep(gdt){
  if(gdt<=0)return;
  DEV.trains.forEach(d=>{if(!d.run)return;d.s+=d.v*gdt;if(d.s>d.P.len-1)d.s=d.s0;placeCars(d);});
}
const devP=document.getElementById('devp'),devBtn=document.getElementById('devBtn');
function devNote(){const k=DEV.trains.length;document.getElementById('dev-clr').disabled=!k;
  document.getElementById('dev-clr').textContent=k?'Quitar '+(k===1?'el tren':'los '+k+' trenes'):'Quitar todos';}
function devToggle(on){on=on===undefined?devP.hidden:on;devP.hidden=!on;devBtn.setAttribute('aria-pressed',on?'true':'false');if(on)devNote();}
function devSeg(id,key,num){const g=document.getElementById(id);g.addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(!b)return;
  g.querySelectorAll('[data-v]').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));const v=b.getAttribute('data-v');DEV.opt[key]=num?+v:v;});}
devSeg('dev-t','t');devSeg('dev-l','loco');
document.getElementById('dev-h').addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(!b)return;document.querySelectorAll('#dev-h [data-v]').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));
  const v=b.getAttribute('data-v');DAY.over=v===''?null:+v;});devSeg('dev-d','d',1);devSeg('dev-o','o');
document.getElementById('dev-m').addEventListener('change',e=>{DEV.opt.m=e.target.value;});
document.getElementById('dev-v').addEventListener('change',e=>{DEV.opt.v=+e.target.value;});
document.getElementById('dev-go').addEventListener('click',()=>{devSpawn();if(UI.lay==='phone')devToggle(false);});
document.getElementById('dev-clr').addEventListener('click',()=>{DEV.trains.slice().forEach(devRemove);devNote();toast('Trenes de prueba retirados');});
document.getElementById('dev-x').addEventListener('click',()=>devToggle(false));
devBtn.addEventListener('click',()=>devToggle());
/* weather button and card: today's weather and the month's odds */
const WX_ICO={sol:'<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M5.4 18.6l1.7-1.7M16.9 7.1l1.7-1.7"/>',
  luna:'<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/>',
  nubes:'<path d="M7 18.5h10.4a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 18.5z"/>',
  niebla:'<path d="M4 9h16M6 13h12M4 17h16M8 21h8"/><path d="M8 5h8"/>',
  tormenta:'<path d="M7 13.5h10.4a3.8 3.8 0 0 0 .5-7.6 5.3 5.3 0 0 0-10.2 1.2A3.2 3.2 0 0 0 7 13.5z"/><path d="M12.5 13.5l-2.2 4h3.2l-2 4.3"/>',
  lluvia:'<path d="M7 14h10.4a3.8 3.8 0 0 0 .5-7.6 5.3 5.3 0 0 0-10.2 1.2A3.2 3.2 0 0 0 7 14z"/><path d="M8.6 17.2l-1.1 2.8M12.6 17.2l-1.1 2.8M16.6 17.2l-1.1 2.8"/>',
  nieve:'<path d="M7 14h10.4a3.8 3.8 0 0 0 .5-7.6 5.3 5.3 0 0 0-10.2 1.2A3.2 3.2 0 0 0 7 14z"/><path d="M8.5 18.2h.01M12 20.4h.01M15.5 18.2h.01M10.2 21.6h.01M13.8 17.6h.01" stroke-width="2.6"/>'};
let wxShown='';
function wxRows(){const P=pct100(WX.P),k=WX.over||WX.k;
  document.getElementById('wx-rows').innerHTML=WX_K.map(q=>'<div class="wrow'+(q===k?' on':'')+'"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+WX_ICO[q]+
    '</svg><span>'+WX_N[q]+'</span><span class="wbar"><i style="width:'+P[q]+'%"></i></span><b>'+P[q]+'%</b></div>').join('');}
function wxUI(){const k=WX.over||WX.k;if(k===wxShown)return;wxShown=k;wxRows();}
function wxNote(){document.getElementById('wx-note').textContent='Probabilidad de cada tipo de día en '+MES[WX.m]+' (AEMET, '+NIVEL.climaFuente+'). Resaltado, el tiempo de ahora.';}
wxNote();
document.getElementById('dev-w').addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(!b)return;document.querySelectorAll('#dev-w [data-v]').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));
  const v=b.getAttribute('data-v');if(!v&&WX.over)WX.k=WX.over;WX.over=v||null;wxShown='';wxUI();});


/* developer: the first jornada starts again at any time of the day, as if it had run since 00:00 with nobody at the controls.
   Weather and light stay as they are; trains already past are gone; each person's legs before that time are taken as done
   (away after an outward trip, home after coming back); the comarca people who drove to an earlier train have their car
   in the car park, the regulars' cars whose owners are already back have left, and whoever is due at the platform is there */
function devParkOwn(P){if(P.kind!=='comarca'||P.carId)return;const v=carOf(P);if(!v)return;const bay=freeBay(3);if(bay==null)return;
  const c=newCar({kind:v.k,hex:v.hex,home:COMARCA_EDGE[P.from]||'E',role:'own',owner:P.id,riders:[],bay:bay,phase:'parked',legs:[{p:'in',bay:bay,end:'park'}]});
  c.s=bayPath(bay,false).L;carPlace(c);PARKING.bays[bay].occ=c.id;P.carId=c.id;}
async function devGoTime(H){
  if(!GAME.on)await startNew();
  const wx=Object.assign({},WX),T0=H;
  snapRestore(GAME.fresh);Object.assign(WX,wx);WX.next=(Math.floor(T0/WX_BLOCK)+1)*WX_BLOCK;
  // trains that have already been and gone
  const gone=new Set();
  for(let i=TRAINS.length-1;i>=0;i--){const t=TRAINS[i];if((t.svc.arr!==undefined?t.svc.arr:t.svc.pass)<T0+60){gone.add(t.svc.num+'_'+t.svc.day);delete ENT[t.ent];TRAINS.splice(i,1);}}
  PAX.forEach(p=>{if(p.on&&p.train&&TRAINS.indexOf(p.train)<0)hidePax(p);});
  sim.t=T0;
  // the people: what they did on those trains
  GENTE.forEach(P=>{P.plan.filter(l=>gone.has(l.num+'_'+Math.floor(l.dep/86400))).sort((a,b)=>a.dep-b.dep).forEach(l=>{P.leg=l;P.tr=null;
      if(l.act==='up'){P.st='fuera';P.loc=l.dest;}else{P.st=P.kind==='visita'?'visita':'casa';P.loc='';}});
    if(P.st==='fuera'&&P.leg&&P.leg.act==='up')devParkOwn(P);});
  // the regulars who are already back have driven off
  TRAF.cars.slice().forEach(c=>{if(c.role==='reg'&&c.until&&c.until<=T0)carRemove(c);});
  TRAF.next=T0;TRAF.pend=[];INC.next=0;CTC.next=0;
  // whoever should be on the platform by now is there
  TRAINS.forEach(tr=>{if(!tr.md)return;while(tr.paxPlan.length&&tr.paxPlan[0].t<=sim.t){const e=tr.paxPlan.shift(),P=GENTE[e.pid];gSpawnUp(e,tr,true);if(P)devParkOwn(P);}});
  refreshAspects();computeCrossing();
  lastList='';lastCtc='';lastTurno='';lastIncH='';lastLib='';lastBoard='';esqDirty=true;uiDirty=true;paint();
  toast('Turno a las '+fmtHM(T0)+' · '+TRAINS.filter(t=>t.svc.day===0).length+' trenes por delante');}
document.getElementById('dev-hgo').addEventListener('click',()=>{const v=document.getElementById('dev-hh').value;if(!/^\d\d:\d\d$/.test(v))return;
  const H=hm(v);devGoTime(H);if(UI.lay==='phone')devToggle(false);});

/* developer: launch any incident now, or queue them (all, or one after another at will) to try them */
function devIncNote(){const n=document.getElementById('dev-in');if(!n)return;
  n.textContent='Activas: '+INC.list.length+' · en cola: '+INC.chain.length+(INC.chain.length?' (la siguiente, «'+IT[INC.chain[0]].n+'», '+(INC.chainGap===0&&INC.list.length?'cuando se cierren las activas':'en cuanto haya ocasión')+')':'')+
    '. Las que necesitan un tren concreto esperan en la cola a que lo haya.';}
(function(){const s=document.getElementById('dev-inc');
  s.innerHTML='<option value="*">Todas, una tras otra</option>'+Object.keys(IT).filter(k=>IT[k].w>0).map(k=>'<option value="'+k+'">'+IT[k].n+'</option>').join('');
  document.getElementById('dev-il').addEventListener('click',()=>{const k=s.value;
    if(k==='*'){const ks=Object.keys(IT).filter(x=>IT[x].can());if(!ks.length){toast('Ahora no hay ocasión para ninguna incidencia');return;}IT[ipick(ks)].go();}
    else if(!IT[k].can())toast('Ahora no hay ocasión para «'+IT[k].n+'» (falta un tren adecuado). Con Encadenar se lanza en cuanto la haya.');
    else IT[k].go();devIncNote();});
  document.getElementById('dev-ic').addEventListener('click',()=>{const k=s.value;INC.chain=INC.chain.concat(k==='*'?Object.keys(IT).filter(x=>IT[x].w>0):[k]);
    INC.chainAt=Math.min(INC.chainAt||sim.t,sim.t);INC.chainTry=0;devIncNote();toast('Cola de incidencias: '+INC.chain.length);});
  document.getElementById('dev-ig').addEventListener('change',e=>{INC.chainGap=+e.target.value;devIncNote();});
  devSeg('dev-ia','ia',1);document.getElementById('dev-ia').addEventListener('click',()=>{INC.auto=DEV.opt.ia!==0;});
  document.getElementById('dev-ix').addEventListener('click',()=>{INC.chain=[];INC.list.slice().forEach(i=>incEnd(i,null));devIncNote();toast('Incidencias cerradas y cola vacía');});
  devIncNote();})();

if(/[?&#]dev\b/.test(location.search+location.hash))devToggle(true);

/* =====================================================================
   29. Loop
   ===================================================================== */
let last=performance.now(),slowT=0,first=true,uiT=0,esqT=0,inspT=0,boardT=0,lastClk='';
function kpis(){
  const set=(id,t,c)=>{const n=document.getElementById(id);if(n.textContent!==t)n.textContent=t;n.className=c||'';};
  const p=stats.trains?Math.round(stats.onTime/stats.trains*100):null;set('st-punt',p===null?'—':p+'%',p===null?'':(p>=90?'ok':p>=75?'warn':'stop'));
  const cm=Math.round(stats.caused/60);set('st-caused',cm+'′',cm>=15?'stop':cm>=5?'warn':'');
  const n=stats.ordOk+stats.ordFail;set('st-ord',n?stats.ordOk+'/'+n:'—',n?(stats.ordFail?'warn':'ok'):'');
  set('st-pax',String(stats.paxIn+stats.paxOut));set('st-lost',String(stats.lost),stats.lost?'stop':'');
  const k=WX.over||WX.k,night=DAY.el<-4,ico=k==='sol'&&night?'luna':(k==='nubes'&&night?'nubes':k);
  if(ico!==kpis.ico){kpis.ico=ico;document.getElementById('wxIco').innerHTML=WX_ICO[ico];}
  const wt=(k==='sol'&&night?'Despejado':WX_N[k]);if(document.getElementById('wxTxt').textContent!==wt)document.getElementById('wxTxt').textContent=wt;
}
// passengers already waiting when the shift starts
TRAINS.forEach(tr=>{if(!tr.md)return;while(tr.paxPlan.length&&tr.paxPlan[0].t<=sim.t)gSpawnUp(tr.paxPlan.shift(),tr,true);});
/* level crossing: the barriers come down only for a train whose way runs over the crossing (main tracks I and II):
   while it is on it, while it runs towards it within 700 m (not when it is going to stop at the platform short of it),
   and, standing, once it has an itinerary set that takes it over (the announcement comes with the signal opening).
   A train backing towards it closes it in its last 150 m. Trains in the sidings, or standing with nothing set, leave
   it open: before, any train within 700 m kept it down, the work train in track 5 all day long */
function pnCloses(o){if(!o.spawned||o.done)return false;
  let sp=sOfX(o.P,PN.x,'v1');if(sp===null)sp=sOfX(o.P,PN.x,'v2');if(sp===null)return false;
  const h=o.s,t=o.s-o.len;if(sp<=h+8&&sp>=t-8)return true;   // on it
  if(o.phase==='retroceso')return sp<t&&t-sp<150;
  const d=sp-h;if(d<=0||d>700)return false;
  const set=R=>R&&!R.passed&&!R.released;
  if(o.v>0.5)return!(o.stopS!==null&&!o.served&&o.stopS<sp-5);
  return set(o.routeIn)||set(o.routeOut);}
function opsStep(gdt){
  if(gdt<=0||GAME.over)return;
  const n=Math.max(1,Math.ceil(gdt/0.1)),h=gdt/n;
  for(let k=0;k<n;k++){
    sim.t+=h;
    lineStep(h);ctcStep();incStep(h);
    TRAINS.forEach(tr=>{if(tr.spawned&&!tr.done)stepTrain(tr,h);});
  }
  TRAINS.forEach(tr=>{if(tr.spawned&&!tr.done)tr.cars.forEach(c=>{if(c.leaves)(c.doorFn||animDoors470)(c,gdt);});});
  lineDay();stepPlans();computeCrossing();crewStep();stepPax(gdt);carsStep(gdt);
  // level crossing: automatic by approach
  PN.down=TRAINS.some(pnCloses);PN.near=PN.down;
  if(PN.fault&&!PN.fault.guard)PN.down=false;   // broken: the barriers stay up
}
/* =====================================================================
   29. Sonido ambiente. Everything is synthesised with Web Audio while the game runs; there are no recordings.
   The listener floats over the camera target, higher the further out the view is zoomed (or sits at the free camera).
   Each source fades with distance (1/d past a reference distance), loses its highs with distance (air absorption) and
   is panned left or right as seen from the camera.
   Trains: rolling noise grows with speed and with how heavy the train is.
     · 252: three-phase traction, with tones that rise with speed.
     · 269: DC traction, with its loud ventilators and the motor growl.
     · 319: GM two-stroke V16 diesel that notches up and down, with the turbo whistle.
     · 470: chopper whine. 470 and 432: compressor at the platform, door hiss and the closing buzzer.
     · All trains: a clack for each axle over every frog and over the level crossing, brake squeal, the air release
       when stopping, and the horn when running through without a stop (as the rule book asked).
   Cars: engine by model (firing frequency from rpm and the number of cylinders, through the gears; the MB100 is a
   diesel), tyre noise louder on a wet road, doors and the starter.
   Weather: rain hiss and drops, thunder after each flash (delayed by its distance), wind with gusts.
   Country: sparrows by day, crickets on summer nights, the storks clattering on the church tower, the town-hall
   clock striking the hours, the level-crossing bell.
   ===================================================================== */
const SND={on:true,vol:0.7,ctx:null,L:{x:0,y:80,z:0,rx:1,rz:0},hr:null,lastFlash:0,gust:0.5,pnRing:0,pnNext:0,birdT:3,storkT:40,frogE:null,cars:new Map()};
try{if(localStorage.getItem('so.snd')==='0')SND.on=false;}catch(e){}
const sG=v=>{const g=SND.ctx.createGain();g.gain.value=v||0;return g;};
const sF=(type,f,Q)=>{const n=SND.ctx.createBiquadFilter();n.type=type;n.frequency.value=f;if(Q!==undefined)n.Q.value=Q;return n;};
const sO=(type,f)=>{const o=SND.ctx.createOscillator();o.type=type;o.frequency.value=f;o.start();return o;};
const sN=(buf,rate)=>{const s=SND.ctx.createBufferSource();s.buffer=buf;s.loop=true;if(rate)s.playbackRate.value=rate;s.start(0,Math.random()*2.5);return s;};
const sC=(...a)=>{for(let i=0;i<a.length-1;i++)a[i].connect(a[i+1]);return a[a.length-1];};
const sT=(p,v,tc)=>p.setTargetAtTime(v,SND.ctx.currentTime,tc||0.08);
/* a source in the world: input → air absorption → distance gain → pan → bus */
function sEmit(bus){const c=SND.ctx,i=sG(1),lp=sF('lowpass',18000,0.5),d=sG(0),p=c.createStereoPanner?c.createStereoPanner():null;
  sC(i,lp,d);if(p)sC(d,p,bus||SND.veh);else d.connect(bus||SND.veh);return{in:i,lp:lp,d:d,p:p,nodes:[]};}
function sPlace(e,x,y,z,ref,tc){const L=SND.L,dx=x-L.x,dy=y-L.y,dz=z-L.z,dist=Math.max(1,Math.hypot(dx,dy,dz));
  sT(e.d.gain,Math.min(1,(ref||10)/dist),tc||0.05);sT(e.lp.frequency,clamp(20000*Math.pow(35/dist,0.85),450,20000),0.1);
  if(e.p)sT(e.p.pan,clamp((dx*L.rx+dz*L.rz)/Math.max(dist,12),-1,1)*0.85,0.05);return dist;}
function sKill(e){if(!e)return;e.nodes.forEach(n=>{try{if(n.stop)n.stop();}catch(_){}try{n.disconnect();}catch(_){}});
  [e.in,e.lp,e.d,e.p].forEach(n=>{try{n&&n.disconnect();}catch(_){}});}
/* a one-shot at a point, released when done */
function sShot(x,y,z,ref,dur,bus){const e=sEmit(bus);sPlace(e,x,y,z,ref,0.001);setTimeout(()=>sKill(e),(dur+0.5)*1000);return e;}
function sBurst(dst,t,dur,f,Q,amp,buf){const c=SND.ctx,s=c.createBufferSource();s.buffer=buf||SND.white;const b=sF('bandpass',f,Q),g=sG(0);
  sC(s,b,g,dst);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(amp,t+0.002);g.gain.exponentialRampToValueAtTime(0.0005,t+dur);
  s.start(t,Math.random()*2.5);s.stop(t+dur+0.05);}
function sTone(dst,t,f,amp,dec,type){const o=SND.ctx.createOscillator();o.type=type||'sine';o.frequency.value=f;const g=sG(0);sC(o,g,dst);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(amp,t+0.004);g.gain.exponentialRampToValueAtTime(0.0003,t+dec);o.start(t);o.stop(t+dec+0.05);}

function sndInit(){if(SND.ctx)return;const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
  const c=new AC();SND.ctx=c;
  const comp=c.createDynamicsCompressor();comp.threshold.value=-12;comp.ratio.value=5;comp.attack.value=0.005;comp.release.value=0.3;
  SND.out=sG(SND.on?SND.vol:0);sC(comp,SND.out,c.destination);SND.mix=comp;SND.veh=sG(1);SND.veh.connect(comp);
  const sr=c.sampleRate,N=sr*3,mk=f=>{const b=c.createBuffer(1,N,sr);f(b.getChannelData(0));return b;};
  SND.white=mk(d=>{for(let i=0;i<N;i++)d[i]=Math.random()*2-1;});
  SND.pink=mk(d=>{let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;for(let i=0;i<N;i++){const w=Math.random()*2-1;b0=0.99886*b0+w*0.0555179;b1=0.99332*b1+w*0.0750759;
    b2=0.969*b2+w*0.153852;b3=0.8665*b3+w*0.3104856;b4=0.55*b4+w*0.5329522;b5=-0.7616*b5-w*0.016898;d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11;b6=w*0.115926;}});
  SND.brown=mk(d=>{let l=0;for(let i=0;i<N;i++){l=(l+0.02*(Math.random()*2-1))/1.02;d[i]=l*3.5;}const e=d[N-1]-d[0];for(let i=0;i<N;i++)d[i]-=e*i/N;});
  /* a chorus of field crickets: each one chirps three or four 12 ms pulses near 4.5 kHz, a few times a second */
  SND.cric=(()=>{const M=sr*4,b=c.createBuffer(2,M,sr);for(let ch=0;ch<2;ch++){const d=b.getChannelData(ch);
    for(let k=0;k<5;k++){const f=4300+Math.random()*600,per=0.32+Math.random()*0.3,a=0.25+Math.random()*0.75,np=3+(Math.random()<0.5?1:0);
      for(let t0=Math.random()*per;t0<4-0.2;t0+=per*(0.95+Math.random()*0.1))for(let p=0;p<np;p++){const s0=Math.floor((t0+p*0.026)*sr),L=Math.floor(0.012*sr);
        for(let j=0;j<L;j++){const e=Math.sin(PI*j/L);d[(s0+j)%M]+=a*e*e*Math.sin(TAU*f*j/sr);}}}
    for(let i=0;i<M;i++)d[i]*=0.3;}return b;})();
  // rain: a steady hiss from both sides, drops added on top
  SND.rain=sG(0);const rp=sF('highpass',450,0.5),rl=sF('lowpass',7000,0.5);sC(rp,rl,SND.rain,comp);
  [-0.75,0.75].forEach(pn=>{const s=sN(SND.pink),p=c.createStereoPanner?c.createStereoPanner():sG(1);if(p.pan)p.pan.value=pn;sC(s,p,rp);});
  SND.drop=sG(1);SND.drop.connect(comp);
  // wind: a band of brown noise wandering with the gusts, and a faint whistle
  SND.wind=sG(0);SND.wbp=sF('bandpass',320,0.7);sC(sN(SND.brown),SND.wbp,SND.wind,comp);
  SND.whis=sG(0);SND.wwh=sF('bandpass',900,6);sC(sN(SND.pink),SND.wwh,SND.whis,comp);
  // crickets
  SND.cg=sG(0);const cs=c.createBufferSource();cs.buffer=SND.cric;cs.loop=true;cs.start();sC(cs,SND.cg,comp);
  sndUI();}

/* listener */
function sndListener(){const L=SND.L;
  if(FREE.on){L.x=camera.position.x;L.y=camera.position.y;L.z=camera.position.z;}else{L.x=cam.target.x;L.z=cam.target.z;L.y=6+cam.size*0.42;}
  camera.updateMatrixWorld();const m=camera.matrixWorld.elements,n=Math.hypot(m[0],m[2])||1;L.rx=m[0]/n;L.rz=m[2]/n;}

/* ---- weather and country ---- */
function sThunder(km){SND.nThunder=(SND.nThunder||0)+1;const c=SND.ctx,t0=c.currentTime+km*1000/343,dur=3+km*0.8+Math.random()*3;
  const s=c.createBufferSource();s.buffer=SND.brown;s.loop=true;const lp=sF('lowpass',km<1.5?1400:km<3?800:550,0.7),g=sG(0),p=c.createStereoPanner?c.createStereoPanner():sG(1);
  if(p.pan)p.pan.value=Math.random()*1.4-0.7;sC(s,lp,g,p,SND.mix);
  const s2=c.createBufferSource();s2.buffer=SND.pink;s2.loop=true;const b2=sF('bandpass',km<2?500:320,0.8),g2=sG(0.5);sC(s2,b2,g2,g);s2.start(t0,Math.random()*2);s2.stop(t0+dur+0.1);
  const n=256,a=new Float32Array(n),B=[];const nb=3+Math.floor(Math.random()*5);for(let k=0;k<nb;k++)B.push([Math.random()*0.6*dur*(k?1:0),0.3+Math.random()*0.7,0.2+Math.random()*0.7]);
  for(let i=0;i<n;i++){const t=i/(n-1)*dur;let v=0;B.forEach(([bt,am,w])=>{if(t>=bt)v+=am*Math.exp(-(t-bt)/w)*(1-Math.exp(-(t-bt)/0.05));});
    a[i]=Math.min(1.4,v)*(2.4/(0.5+km))*Math.exp(-t/(dur*0.55));}a[n-1]=0;
  g.gain.setValueCurveAtTime(a,t0,dur);s.start(t0,Math.random()*2);s.stop(t0+dur+0.1);
  if(km<1.6)sBurst(SND.mix,t0,0.35,2500,0.4,0.5/(0.4+km));}
function sChirps(){const L=SND.L,a=Math.random()*TAU,r=10+Math.random()*(30+L.y*0.25),x=L.x+Math.cos(a)*r,z=L.z+Math.sin(a)*r;
  const n=2+Math.floor(Math.random()*5),e=sShot(x,4,z,6,n*0.2+0.3,SND.mix),c=SND.ctx;let t=c.currentTime+0.02;const f0=3200+Math.random()*1800;
  for(let k=0;k<n;k++){const o=c.createOscillator(),g=sG(0),f=f0*(0.92+Math.random()*0.16),d=0.05+Math.random()*0.05;o.type='sine';sC(o,g,e.in);
    o.frequency.setValueAtTime(f*0.85,t);o.frequency.linearRampToValueAtTime(f*1.22,t+0.014);o.frequency.exponentialRampToValueAtTime(f*0.78,t+d);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.09,t+0.008);g.gain.exponentialRampToValueAtTime(0.0005,t+d);o.start(t);o.stop(t+d+0.02);
    t+=d+0.06+Math.random()*0.12;}}
function sStorks(){const C=NIVEL.sonido.cigüeñas;if(!C)return;const e=sShot(C.x,C.y,C.z,10,4,SND.mix),c=SND.ctx;let t=c.currentTime+0.05,r=9;const n=24+Math.floor(Math.random()*16);
  for(let k=0;k<n;k++){sBurst(e.in,t,0.012,1500,1.2,0.35);sBurst(e.in,t+0.004,0.02,650,1.5,0.25);r=Math.min(17,r+0.5);t+=1/r*(0.9+Math.random()*0.2);}}
function sBell(dst,t,f0,amp){/* a cast bell: hum, prime, minor third, fifth, nominal and the upper partials, each dying away at its own pace */
  [[0.5,0.3,4.5],[1,0.5,3],[1.19,0.35,2.4],[1.5,0.22,2],[2,0.4,1.6],[2.52,0.14,1.1],[2.66,0.12,0.9],[3.01,0.09,0.7],[4.1,0.05,0.45]]
    .forEach(([r,a,d])=>sTone(dst,t,f0*r*(1+(Math.random()-0.5)*0.002),a*amp,d));
  sBurst(dst,t,0.03,3000,0.8,0.15*amp);}
function sClock(n){const A=NIVEL.sonido.reloj,e=sShot(A.x,A.y,A.z,30,n*2.4+5,SND.mix),t=SND.ctx.currentTime+0.1;for(let k=0;k<n;k++)sBell(e.in,t+k*2.4,587,0.5);}
function sPNding(){const e=sShot(PN.x,2,NIVEL.sonido.pnZ,14,0.6),t=SND.ctx.currentTime;sTone(e.in,t,1180,0.22,0.35);sTone(e.in,t,2950,0.08,0.18);sBurst(e.in,t,0.01,4000,1,0.1);}
function sndWeather(dt){const c=SND.ctx,hr=hourNow(),mo=WX.m,rain=WX.rain,dry=clamp(1-rain*1.6,0,1);
  sT(SND.rain.gain,0.5*Math.pow(rain,0.8),0.6);
  let nd=Math.random()<dt*45*rain?1+Math.floor(Math.random()*2*rain):0;   // drops on leaves, tiles and puddles
  while(nd-->0){const t=c.currentTime+Math.random()*dt,p=c.createStereoPanner?c.createStereoPanner():sG(1);if(p.pan)p.pan.value=Math.random()*1.6-0.8;p.connect(SND.drop);
    sBurst(p,t,0.012+Math.random()*0.02,1500+Math.random()*4500,2+Math.random()*3,0.04+Math.random()*0.12*rain);setTimeout(()=>p.disconnect(),400);}
  {const b=WX.bolt||0;if(SND.bolt===undefined)SND.bolt=b;if(b>SND.bolt)sThunder(0.5+Math.pow(Math.random(),1.6)*3.5);SND.bolt=b;}   // each bolt, heard a little after its flash
  SND.gust=clamp(SND.gust+(Math.random()-0.5)*dt*1.2+(0.5-SND.gust)*dt*0.05,0,1);
  const w=0.025+0.22*WX.storm+0.06*rain+0.05*WX.snow;sT(SND.wind.gain,w*(0.5+SND.gust),0.4);sT(SND.wbp.frequency,220+SND.gust*380,0.4);
  sT(SND.whis.gain,0.012*WX.storm*SND.gust,0.5);sT(SND.wwh.frequency,700+SND.gust*500,0.5);
  const day=hr>6.5&&hr<21?1:0,season=mo>=2&&mo<=8?1:0.35;
  SND.birdT-=dt;if(SND.birdT<=0){SND.birdT=1+Math.random()*5;if(day&&Math.random()<season*dry*(hr<10||hr>18?1:0.6))sChirps();}
  SND.storkT-=dt;if(SND.storkT<=0){SND.storkT=60+Math.random()*150;if(day&&mo>=1&&mo<=7&&dry>0.5)sStorks();}
  const night=hr>=21.5||hr<5.5,summer=mo>=5&&mo<=8;sT(SND.cg.gain,night&&summer?0.06*dry*clamp(30/SND.L.y,0.4,1):0,2);
  const h=Math.floor(sim.t/3600);if(SND.hr!==null&&h!==SND.hr&&!sim.paused&&sim.speed<=16){const hh=((h%24)+24)%24;if(NIVEL.sonido.reloj&&hh>=NIVEL.sonido.reloj.desde&&hh<=NIVEL.sonido.reloj.hasta)sClock(hh%12||12);}SND.hr=h;
  // level crossing: the bell rings while the barriers come down
  if(PN.down&&PN.anim>0.03)SND.pnRing=2;else SND.pnRing=Math.max(0,SND.pnRing-dt);
  if(SND.pnRing>0){SND.pnNext-=dt;if(SND.pnNext<=0){SND.pnNext=0.55;sPNding();}}}

/* ---- trains ---- */
const TSND={md:{roll:0.45,rum:0.35,sq:0.08},alvia:{roll:0.6,rum:0.4,sq:0.12},estrella:{roll:0.75,rum:0.6,sq:0.15},diurno:{roll:0.7,rum:0.55,sq:0.14},ic:{roll:0.5,rum:0.38,sq:0.09},socorro:{roll:0.35,rum:0.45,sq:0.1},trabajos:{roll:0.5,rum:0.7,sq:0.15},merc:{roll:0.95,rum:1,sq:0.28}};
const HORN={loco252:[370,466],loco269:[311,392],loco319:[277,349],loco311:[330,415],md:[523,659],r432:[440,554],r448:[466,587]};
const FROGS=[];SWITCHES.forEach(s=>s.legs.forEach(l=>FROGS.push({x:l.x,z:TZ[l.t],w:2.6})));FROGS.push({x:PN.x,z:NIVEL.sonido.pnZ,w:12});
function sHorn(x,z,k,long){const c=SND.ctx,f=HORN[k]||HORN.loco252,dur=long?1.4+Math.random()*0.8:0.5,e=sShot(x,4,z,60,dur+0.5),t=c.currentTime+0.02;
  const ws=c.createWaveShaper(),cv=new Float32Array(256);for(let i=0;i<256;i++){const x2=i/127.5-1;cv[i]=Math.tanh(2.2*x2);}ws.curve=cv;const g=sG(0);sC(ws,g,e.in);
  f.forEach((fr,i)=>{[0,4].forEach(dt=>{const o=c.createOscillator();o.type='sawtooth';o.frequency.value=fr+dt*0.6;const b=sF('bandpass',fr*2,0.9);sC(o,b,ws);o.start(t);o.stop(t+dur+0.3);});});
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.32,t+0.07);g.gain.setValueAtTime(0.32,t+dur);g.gain.exponentialRampToValueAtTime(0.0005,t+dur+0.2);}
function sTrainVoice(tr){const c=SND.ctx,P=TSND[tr.svc.type]||TSND.md,V={e:sEmit(),m:sEmit(),lv:tr.v,thr:0,rpm:315,doors:tr.doors,comp:0,horn:false,px:null};
  const add=(e,...n)=>{n.forEach(x=>e.nodes.push(x));};
  const rs=sN(SND.pink),rb=sF('bandpass',400,0.6);V.rg=sG(0);sC(rs,rb,V.rg,V.e.in);V.rb=rb;
  const bs=sN(SND.brown),bl=sF('lowpass',150,0.7);V.bg=sG(0);sC(bs,bl,V.bg,V.e.in);
  const so=sO('sine',3200+Math.random()*600),lfo=sO('sine',5+Math.random()*2),ld=sG(25);sC(lfo,ld,so.frequency);V.sg=sG(0);sC(so,V.sg,V.e.in);
  add(V.e,rs,rb,V.rg,bs,bl,V.bg,so,lfo,ld,V.sg);
  const L0=tr.cars.find(cc=>/^loco/.test(cc.sk))||tr.cars[0],k=L0.sk==='loco311'?'loco319':L0.sk;V.k=k;V.P=P;V.mc=L0;   // the 311 has the voice of a diesel like the 319's
  if(k==='loco252'){V.o1=sO('sawtooth',30);V.o2=sO('square',150);const b1=sF('lowpass',500,0.7),b2=sF('bandpass',400,4);V.g1=sG(0);V.g2=sG(0);
    sC(V.o1,b1,V.g1,V.m.in);sC(V.o2,b2,V.g2,V.m.in);V.b2=b2;add(V.m,V.o1,V.o2,b1,b2,V.g1,V.g2);}
  else if(k==='loco269'||k==='md'||k==='r432'||k==='r448'){V.o1=sO('sawtooth',25);const b1=sF('lowpass',350,0.7);V.g1=sG(0);sC(V.o1,b1,V.g1,V.m.in);add(V.m,V.o1,b1,V.g1);
    if(k==='md'){V.o2=sO('square',330);const b2=sF('bandpass',1150,3);V.g2=sG(0);sC(V.o2,b2,V.g2,V.m.in);add(V.m,V.o2,b2,V.g2);}}
  else if(k==='loco319'){V.o1=sO('sawtooth',84);V.dl=sF('lowpass',500,1.2);V.g1=sG(0);const am=sO('sine',5.2),ad=sG(0.3),mg=sG(0.7);
    sC(V.o1,V.dl,mg,V.g1,V.m.in);sC(am,ad,mg.gain);V.am=am;V.o2=sO('sine',2400);V.g2=sG(0);sC(V.o2,V.g2,V.m.in);add(V.m,V.o1,V.dl,V.g1,am,ad,mg,V.o2,V.g2);}
  // ventilators / auxiliaries
  const fs=sN(SND.pink),fb=sF('bandpass',k==='loco269'?620:k==='md'||k==='r432'||k==='r448'?950:800,0.9);V.fg=sG(0);sC(fs,fb,V.fg,V.m.in);add(V.m,fs,fb,V.fg);
  // compressor (units): a thudding pump
  if(k==='md'||k==='r432'||k==='r448'){const cs2=sN(SND.brown),cb=sF('lowpass',260,1),ca=sO('square',11),cd=sG(0.5),cm=sG(0.5);V.cg=sG(0);sC(cs2,cb,cm,V.cg,V.m.in);sC(ca,cd,cm.gain);add(V.m,cs2,cb,ca,cd,cm,V.cg);}
  return V;}
function sTrains(dt,sdt){const c=SND.ctx,L=SND.L,run=!sim.paused;
  TRAINS.forEach(tr=>{const alive=tr.spawned&&!tr.done&&tr.cars.length;let V=tr._snd;
    if(!alive){if(V){sKill(V.e);sKill(V.m);tr._snd=null;}return;}
    // the nearest car carries the rolling noise; the leading vehicle, the traction
    let best=null,bd=1e9;tr.cars.forEach(cc=>{const p=cc.g.position,d=Math.hypot(p.x-L.x,p.y-L.y,p.z-L.z);if(d<bd){bd=d;best=cc;}});
    if(bd>2600){if(V){sKill(V.e);sKill(V.m);tr._snd=null;}return;}
    if(V&&V.mc&&!tr.cars.includes(V.mc)){sKill(V.e);sKill(V.m);V=tr._snd=null;}   // rebuilt (a locomotive coupled or uncoupled): a new voice
    if(!V){V=tr._snd=sTrainVoice(tr);}
    const v=tr.v,P=V.P,acc=sdt>0?(v-V.lv)/sdt:0;V.lv=v;
    const tgt=acc>0.03?1:(v>1&&Math.abs(acc)<0.03?0.35:0);V.thr+=(tgt-V.thr)*Math.min(1,dt*1.5);const thr=V.thr;
    const bp=best.g.position,ln=tr.len;sPlace(V.e,bp.x,bp.y+1,bp.z,14+ln*0.08);
    const mp=(V.k==='md'||V.k==='r432'||V.k==='r448')?(tr.cars.find(cc=>cc.kind==='M')||tr.cars[0]).g.position:(V.mc&&tr.cars.includes(V.mc)?V.mc:tr.cars[0]).g.position;sPlace(V.m,mp.x,mp.y+2,mp.z,12);
    const kk=Math.min(1.6,Math.pow(v/30,1.4));sT(V.rg.gain,P.roll*kk*(0.6+Math.min(0.6,ln/250)));sT(V.rb.frequency,280+v*18);sT(V.bg.gain,P.rum*Math.min(1,v/12)*(0.5+Math.min(0.8,ln/200)));
    const dec=-acc,sq=v>0.3&&v<14&&dec>0.12?P.sq*Math.pow(1-v/14,0.6)*Math.min(1,dec/0.5)*(0.6+0.4*Math.random()):0;sT(V.sg.gain,sq,0.05);
    if(V.lv0>0.05&&v===0)sBurst(V.m.in,c.currentTime,1.3,3200,0.5,0.18);     // brakes applied: the air release
    V.lv0=v;
    const k=V.k;
    if(k==='loco252'){V.o1.frequency.value=20+v*4.2;sT(V.o2.frequency,140+v*16);sT(V.b2.frequency,(140+v*16)*2);sT(V.g1.gain,0.18*thr);sT(V.g2.gain,0.05*thr*(v<40?1:0.4));sT(V.fg.gain,0.03+0.05*thr);}
    else if(k==='loco269'){V.o1.frequency.value=22+v*3;sT(V.g1.gain,0.2*thr);sT(V.fg.gain,0.06+0.12*thr);}
    else if(k==='md'||k==='r432'||k==='r448'){V.o1.frequency.value=15+v*4;sT(V.g1.gain,0.12*thr);if(V.g2)sT(V.g2.gain,0.035*thr*(v<25?1:0.3));sT(V.fg.gain,0.03);
      if(V.lv1>0.05&&v===0)V.comp=25+Math.random()*15;V.lv1=v;V.comp=Math.max(0,V.comp-sdt);sT(V.cg.gain,V.comp>0?0.07:0,0.3);}
    else if(k==='loco319'){const rt=thr>0.6?904:thr>0.2?640:315;V.rpm+=(rt-V.rpm)*Math.min(1,dt*0.7);const r=V.rpm,f=r/60*16;
      V.o1.frequency.value=f;V.am.frequency.value=r/60;sT(V.dl.frequency,350+r*0.7);sT(V.g1.gain,0.22+0.3*(r-315)/589);sT(V.o2.frequency,1600+r*2.4);sT(V.g2.gain,0.012*(r-315)/589);sT(V.fg.gain,0.02+0.04*thr);}
    // horn when running through without a stop: once, some 650 m before the station
    if(run&&!tr.stops&&!V.horn){const hx=pathAt(tr.P,tr.s).x*tr.dir;if(hx<-600&&hx>-800&&v>8){V.horn=true;if(((tr.svc.num*7)%10)<8){const hp=tr.cars[0].g.position;sHorn(hp.x,hp.z,k,true);}}}
    // doors of the units
    if(V.doors!==tr.doors){const t=c.currentTime;if(tr.doors==='open'){sBurst(V.e.in,t,0.7,2200,0.6,0.12);}
      else{const e=V.e.in;[0,0.3,0.6].forEach(o=>sTone(e,t+o,1000,0.07,0.18,'square'));sBurst(e,t+1,0.6,2000,0.6,0.1);sBurst(e,t+1.5,0.08,300,1,0.25);}V.doors=tr.doors;}
    // frogs: a clack for each axle over each frog and over the crossing
    if(run&&v>0.2){let n=0;tr.cars.forEach(cc=>{const p=cc.g.position,r=cc.g.rotation.y,ax=Math.sin(r),az=Math.cos(r),Lh=cc.L/2;
      const offs=cc.sk==='t3'?[-Lh+0.6]:[Lh-3.0,Lh-5.4,-Lh+5.4,-Lh+3.0];
      if(cc._px!==undefined)FROGS.forEach((F,fi)=>{offs.forEach(o=>{const x1=p.x+ax*o,x0=cc._px+ax*o;if((x0-F.x)*(x1-F.x)<=0&&x0!==x1&&Math.abs(p.z+az*o-F.z)<F.w&&n<12){n++;
        const fe=FROG_E(fi,F),tt=c.currentTime+Math.max(0,Math.min(dt,dt*(F.x-x0)/(x1-x0)));sBurst(fe.in,tt,0.045,650+Math.min(900,v*14),1.1,0.18+Math.min(0.5,v/45));}});});
      cc._px=p.x;});}else tr.cars.forEach(cc=>{cc._px=cc.g.position.x;});
  });}
function FROG_E(i,F){if(!SND.frogE)SND.frogE=[];if(!SND.frogE[i])SND.frogE[i]=sEmit();sPlace(SND.frogE[i],F.x,0.5,F.z,8,0.001);return SND.frogE[i];}

/* ---- cars ---- */
const CSND={p205:{cyl:4,idle:850,amp:0.1},punto:{cyl:4,idle:800,amp:0.09},alpina:{cyl:6,idle:750,amp:0.12},sec:{cyl:8,idle:600,amp:0.12},mb100:{cyl:4,idle:750,amp:0.13,dsl:1}};
const GEAR=[0,4.5,9,13.5,19,27];
function sCarVoice(cr){const c=SND.ctx,P=CSND[cr.kind]||CSND.p205,V={e:sEmit(),P:P,lv:cr.v,rpm:P.idle,load:0,on:cr.phase!=='parked'&&cr.phase!=='off',ph:cr.phase,engAt:0};
  V.o1=sO('sawtooth',30);V.o2=sO('sawtooth',15);V.lp=sF('lowpass',500,1.5);V.eg=sG(0);const g2=sG(0.5);sC(V.o1,V.lp);sC(V.o2,g2,V.lp);sC(V.lp,V.eg,V.e.in);
  const ts=sN(SND.pink),tb=sF('bandpass',750,0.5);V.tg=sG(0);sC(ts,tb,V.tg,V.e.in);const ws=sN(SND.white),wh=sF('highpass',2800,0.7);V.wg=sG(0);sC(ws,wh,V.wg,V.e.in);
  V.e.nodes.push(V.o1,V.o2,V.lp,V.eg,g2,ts,tb,V.tg,ws,wh,V.wg);
  if(P.dsl){const ds=sN(SND.white),db=sF('bandpass',2600,1.2),dm=sG(0.5);V.dk=sO('square',30);const dd=sG(0.5);sC(V.dk,dd,dm.gain);V.dg=sG(0);sC(ds,db,dm,V.dg,V.e.in);V.e.nodes.push(ds,db,dm,V.dk,dd,V.dg);}
  return V;}
function sDoor(e,t){sBurst(e.in,t,0.09,180,1.2,0.35,SND.brown);sBurst(e.in,t,0.02,1400,1,0.12);}
function sStarter(e,t){const o=SND.ctx.createOscillator(),g=sG(0),a=SND.ctx.createOscillator(),ad=sG(0.5);o.type='sawtooth';o.frequency.value=170;a.frequency.value=9;sC(a,ad,g.gain);
  sC(o,sF('lowpass',900,1),g,e.in);g.gain.setValueAtTime(0.06,t);g.gain.setValueAtTime(0,t+0.9);o.start(t);a.start(t);o.stop(t+1);a.stop(t+1);}
function sCars(dt,sdt){const c=SND.ctx,L=SND.L,t=c.currentTime,live=new Set();
  const near=TRAF.cars.map(cr=>{const p=cr.g.position;return[cr,Math.hypot(p.x-L.x,p.y-L.y,p.z-L.z)];}).filter(a=>a[1]<220).sort((a,b)=>a[1]-b[1]).slice(0,6);
  near.forEach(([cr])=>{live.add(cr);let V=SND.cars.get(cr);if(!V){V=sCarVoice(cr);SND.cars.set(cr,V);}
    const P=V.P,v=cr.v||0,p=cr.g.position,run=cr.phase!=='parked'&&cr.phase!=='off';
    if(run&&!V.on){V.on=true;sDoor(V.e,t);sStarter(V.e,t+0.7);V.engAt=t+1.5;}           // the owner gets in and starts the engine
    if(!run&&V.on){V.on=false;sDoor(V.e,t+1.2);if(Math.random()<0.5)sDoor(V.e,t+1.9);}  // engine off, doors
    sPlace(V.e,p.x,p.y+0.5,p.z,6);
    const acc=sdt>0?(v-V.lv)/sdt:0;V.lv=v;V.load+=((acc>0.15?1:acc<-0.2?0:0.4)-V.load)*Math.min(1,dt*3);
    let gi=1;while(gi<GEAR.length-1&&v>GEAR[gi])gi++;const lo=GEAR[gi-1],hi=GEAR[gi],rt=v<0.3?P.idle:P.idle+300+2200*clamp((v-lo)/(hi-lo),0,1)*(0.85+0.3*V.load);
    V.rpm+=(rt-V.rpm)*Math.min(1,dt*6);const f=V.rpm/60*P.cyl/2,on=V.on&&t>=V.engAt&&!sim.paused;
    V.o1.frequency.value=f;V.o2.frequency.value=f/2;sT(V.lp.frequency,250+V.rpm*0.3+400*V.load);
    sT(V.eg.gain,on?P.amp*(0.4+0.6*V.load+0.25*V.rpm/4000):0,0.06);
    const vv=sim.paused?0:v;sT(V.tg.gain,0.06*Math.pow(vv/14,1.5)*(1+1.5*WX.wet));sT(V.wg.gain,0.05*WX.wet*Math.min(1,vv/10));
    if(V.dk){V.dk.frequency.value=f;sT(V.dg.gain,on?0.05*(0.5+V.load):0);}});
  SND.cars.forEach((V,cr)=>{if(!live.has(cr)||TRAF.cars.indexOf(cr)<0){sKill(V.e);SND.cars.delete(cr);}});}

function sndStep(dt){const c=SND.ctx;if(!c||c.state!=='running')return;
  const sdt=sim.paused?0:dt*sim.speed;sndListener();sT(SND.veh.gain,sim.paused?0:1,0.1);
  sndWeather(dt);sTrains(dt,sdt);if(TRAF.ready)sCars(dt,sdt);}
function sndSet(on){SND.on=on;try{localStorage.setItem('so.snd',on?'1':'0');}catch(e){}if(SND.ctx)sT(SND.out.gain,on?SND.vol:0,0.05);sndUI();toast(on?'Sonido activado':'Sonido desactivado');}
/* ---- banda sonora ----
   As in Minecraft: now and then one of the pieces, then long stretches with only the sound of the station, and
   another one when you least expect it. The piece depends on the hour: the mist and the first light at dawn, the
   day pieces, the nocturne when the village sleeps. Silences of 3 to 8 minutes; the first one a little sooner. */
const MUS={on:true,vol:0.34,el:null,next:0,last:null,err:0,
  T:{'bureba':'Bureba','primer-destino':'Primer destino','anden-dos':'Andén dos','via-libre':'Vía libre','niebla':'Niebla','ultima-luz':'La última luz'}};
try{if(localStorage.getItem('ttc.mus')==='0')MUS.on=false;}catch(e){}
function musPool(){const h=hourNow();
  if(h>=22||h<5)return['ultima-luz','niebla','anden-dos'];
  if(h<9.5)return['niebla','bureba','primer-destino'];
  if(h>=19)return['anden-dos','ultima-luz','bureba'];
  return['bureba','primer-destino','anden-dos','via-libre'];}
function musStep(dt){const now=performance.now()/1000,live=GAME.on&&!GAME.demo&&!GAME.over;
  if(!MUS.el){if(!live){MUS.next=0;return;}
    if(!MUS.next)MUS.next=now+25+Math.random()*50;
    if(now>=MUS.next&&MUS.on&&SND.on&&!document.hidden)musPlay(now);return;}
  const a=MUS.el,want=live&&MUS.on&&SND.on&&!document.hidden?MUS.vol:0;
  if(document.hidden&&!a.paused)a.pause();else if(!document.hidden&&a.paused&&!a.ended&&want>0)a.play().catch(()=>{});
  a.volume=Math.max(0,Math.min(1,a.volume+(want-a.volume)*Math.min(1,dt*(want>a.volume?0.8:1.6))));
  if(a.ended||(want===0&&a.volume<0.005&&!live)){a.pause();MUS.el=null;MUS.next=now+180+Math.random()*300;}}
function musPlay(now){const pool=musPool().filter(k=>k!==MUS.last);const k=pool[Math.floor(Math.random()*pool.length)];
  const a=new Audio('musica/'+k+'.mp3');a.volume=0;MUS.el=a;MUS.last=k;
  a.play().catch(()=>{MUS.el=null;MUS.next=now+30;});}
function musSet(on){MUS.on=on;try{localStorage.setItem('ttc.mus',on?'1':'0');}catch(e){}musUI();toast(on?'Música activada':'Música desactivada');}
function musUI(){const b=document.getElementById('musBtn');if(!b)return;
  b.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'+(MUS.on?'':'<path d="M3 3l18 18"/>')+'</svg>'+(MUS.on?'Música: activada':'Música: desactivada');}
function sndUI(){const b=document.getElementById('sndBtn');if(!b)return;
  b.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/>'+
    (SND.on?'<path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>':'<path d="M17 9.5l5 5M22 9.5l-5 5"/>')+'</svg>'+(SND.on?'Sonido: activado':'Sonido: desactivado');}
['pointerdown','keydown'].forEach(ev=>addEventListener(ev,()=>{try{sndInit();if(SND.ctx&&SND.ctx.state==='suspended'&&!document.hidden)SND.ctx.resume();}catch(e){}},{passive:true}));
document.addEventListener('visibilitychange',()=>{if(!SND.ctx)return;if(document.hidden)SND.ctx.suspend();else SND.ctx.resume();});
sndUI();musUI();

function frame(now){
  requestAnimationFrame(frame);const _t0=performance.now();
  let dt=(now-last)/1000;last=now;const rawDt=dt;if(dt>0.1)dt=0.1;if(!(dt>0))dt=0;   // a frame stamped before the last one would run time backwards (the lightning flash grew instead of fading)
  stepCam(dt);wxStep(dt,sim.paused?0:dt*sim.speed);updateDayNight(dt);
  if(sim.auto&&!sim.paused)autoStep(dt);
  opsRun(sim.paused?0:dt*sim.speed);devStep(sim.paused?0:dt*sim.speed);if(CAB.on)cabCam(dt);if(GAME.demo)demoTick(dt);
  if(NIVEL.tick)try{NIVEL.tick(dt);}catch(e){if(!NIVEL.tickErr){NIVEL.tickErr=1;console.warn('nivel',e);}}   // the level's own life: machinery, animals, smoke
  try{sndStep(dt);}catch(e){if(!SND.err){SND.err=1;console.warn('sonido',e);}}
  try{musStep(dt);}catch(e){if(!MUS.err){MUS.err=1;console.warn('música',e);}}
  const target=PN.down?0:1;PN.anim=damp(PN.anim,target,3.2,dt);
  barriers.forEach(b=>{b.rotation.z=b.userData.dir*1.35*PN.anim;});
  if(hoverDirty&&!mode&&mx>=0){hoverDirty=false;const id=pickAt(mx,my);if(id!==hoverId){hoverId=id;paint();canvas.style.cursor=id?'pointer':'grab';}}
  const mv=k=>k==='train'||k==='person',tsel=(selId&&ENT[selId]&&mv(ENT[selId].kind))||(hoverId&&ENT[hoverId]&&mv(ENT[hoverId].kind));
  if(tsel)paint();else if(selId)updatePin();
  placeTag();
  const ck=fmtHMS(sim.t);if(ck!==lastClk){lastClk=ck;el.clock.innerHTML=ck.slice(0,5)+'<small>'+ck.slice(5)+'</small>';}
  uiT-=dt;esqT-=dt;inspT-=dt;
  if(uiT<=0||uiDirty){uiT=0.25;uiDirty=false;renderList();renderCTC();wxUI();
    renderTurno();kpis();renderInc();gPersist();}
  if(boardT<=0){boardT=0.5;renderBoard();renderLinea();}boardT-=dt;
  if(esqT<=0||esqDirty){esqT=0.2;drawEsq();}
  if(inspT<=0&&selId){inspT=0.3;renderInspector(false);hoverDirtyTag=true;}
  if(toastT>0){toastT-=dt;if(toastT<=0)el.toast.classList.remove('on');}
  renderFrame();perfTick(now,_t0,rawDt);
  if(first){first=false;setTimeout(()=>bootEl.classList.add('gone'),250);}
  if(dt>0.026)slowT+=dt;else slowT=Math.max(0,slowT-dt*0.5);
  if(slowT>2.5){slowT=0;
    if(pixelCap>1){pixelCap=Math.max(1,pixelCap-0.5);resize();}}
}
layout();paint();renderList();
requestAnimationFrame(frame);
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{[plaqueTex,nameTex,blueTex].concat(window.FONT_TEX||[]).forEach(redraw);if(TEX470.ready)['M','R','Rc','door','doorM'].forEach(k=>redraw(TEX470[k]));});


/* =====================================================================
   30. La partida: instantánea completa del estado, guardar y cargar, menú principal
   Se guarda todo lo que cambia mientras se juega (trenes, itinerarios, agujas, viajeros, la gente del pueblo,
   incidencias con sus telefonemas y decisiones pendientes, órdenes del CTC, la línea y el tiempo). Lo que se
   construye al cargar la página (la maqueta, los modelos) no se guarda: se rehace a partir de esos datos.
   Las partidas van a tu cuenta (base de datos privada de la página) y además a este navegador.
   ===================================================================== */
var GAME={level:1,levelName:(NIVEL.nombreLargo),on:false,fresh:null,slots:6,store:null,uid:null};
const SKIP_TR={svc:1,ty:1,cars:1,doorA:1,doorB:1,frontMats:1};
function snapEncode(){
  const refs=new Map();
  TRAINS.forEach(t=>refs.set(t,{$t:t.id}));ROUTES.forEach((R,i)=>refs.set(R,{$r:i}));SIGNALS.forEach(S=>refs.set(S,{$s:S.id}));
  SWITCHES.forEach(S=>refs.set(S,{$w:S.id}));INC.list.forEach(i=>refs.set(i,{$i:i.id}));GENTE.forEach(P=>refs.set(P,{$g:P.id}));
  PAX.forEach(p=>refs.set(p,{$x:p.i}));LINE.faults.forEach((f,i)=>refs.set(f,{$f:i}));INC.needs.forEach(n=>refs.set(n,{$n:n.id}));
  refs.set(FAULT_OCC,{$c:'F'});refs.set(CUT_OCC,{$c:'C'});
  const seen=new Set();
  const enc=(v,root)=>{
    if(v===null||v===undefined)return v===null?null:undefined;
    const ty=typeof v;
    if(ty==='number')return isFinite(v)?v:{$num:String(v)};
    if(ty==='string'||ty==='boolean')return v;
    if(ty!=='object')return undefined;
    if(!root&&refs.has(v))return refs.get(v);
    if(v.isObject3D||v.isMaterial||v.isColor||v.isTexture||v.isBufferGeometry||v.isVector3||v.isMatrix4)return undefined;
    if(seen.has(v))return null;seen.add(v);
    let o;
    if(Array.isArray(v))o=v.map(x=>{const e=enc(x);return e===undefined?null:e;});
    else{o={};for(const k in v){if(!Object.prototype.hasOwnProperty.call(v,k))continue;const e=enc(v[k]);if(e!==undefined)o[k]=e;}}
    seen.delete(v);return o;};
  const rootOf=(v,skip)=>{const o={};for(const k in v){if(skip&&skip[k])continue;const e=enc(v[k]);if(e!==undefined)o[k]=e;}return o;};
  const dyn=['st','loc','leg','plan','pend','seen','last','lastTxt','away','free','here','vday','tr','px','carId'];
  return{v:2,level:GAME.level,date0:DATE0.getTime(),sim:{t:sim.t,speed:sim.speed,auto:!!sim.auto},stats:enc(stats,true),CAR:JSON.parse(JSON.stringify(CAR)),
    WX:rootOf(WX),LINE:{faults:LINE.faults.map(f=>rootOf(f)),powerUntil:LINE.powerUntil,day:LINE.day},
    SW:SWITCHES.map(S=>({id:S.id,reverse:S.reverse,frozenUntil:S.frozenUntil||0,nc:enc(S.nc),lockPos:S.lockPos===undefined?null:S.lockPos})),
    PN:{fault:enc(PN.fault)},STN:{sala:STN.sala},
    CTC:rootOf(CTC),
    TR:TRAINS.map(t=>({svc:enc(t.svc,true),f:rootOf(t,SKIP_TR)})),
    RT:ROUTES.map(R=>rootOf(R,{mesh:1})),
    INC:{list:INC.list.map(i=>rootOf(i,{H:1})),needs:INC.needs.map(n=>rootOf(n)),hist:enc(INC.hist,true),seq:INC.seq,nseq:INC.nseq,next:INC.next,tick:INC.tick,
      auto:INC.auto,mean:INC.mean,chain:INC.chain.slice(),chainAt:INC.chainAt,chainGap:INC.chainGap,chainWait:enc(INC.chainWait||{},true),tel:enc(INC.tel,true),telN:INC.telN,
      ai:enc(INC.ai,true),dq:enc((INC.dOpen?[INC.dOpen]:[]).concat(INC.dq),true)},
    PX:PAX.filter(p=>p.on).map(p=>rootOf(p)),CREW:{seq:CREW.seq,jobs:enc(CREW.jobs,true)},
    TRAF:{seq:TRAF.seq,next:TRAF.next,pend:enc(TRAF.pend,true),cars:TRAF.cars.map(c=>rootOf(c,{g:1})),bays:PARKING.bays.map(B=>B.occ||0)},
    G:GENTE.map(P=>{const o={};dyn.forEach(k=>{const e=enc(P[k]);if(e!==undefined)o[k]=e;});return o;})};
}
/* puts the saved state back: tear down what is running, rebuild the shells, resolve the references, rebuild the 3D */
function snapRestore(S){
  // tear down
  if(INC.dOpen)closeDec();
  ROUTES.slice().forEach(dropRoute);
  TRAINS.forEach(t=>{if(t.cars&&t.cars.length){t.cars.forEach(c=>{scene.remove(c.g);c.body.forEach(m=>{const i=PICK.indexOf(m);if(i>=0)PICK.splice(i,1);});});t.cars=[];}});
  if(typeof DEV!=='undefined')DEV.trains.slice().forEach(devRemove);
  PAX.forEach(p=>{if(p.on)hidePax(p);p.pid=null;});
  Object.keys(ENT).forEach(k=>{if(k.indexOf('tr:')===0)delete ENT[k];});
  TRAINS.length=0;select(null);
  // plain values
  DATE0.setTime(S.date0);sim.t=S.sim.t;sim.speed=S.sim.speed;sim.auto=!!S.sim.auto;if(sim.auto){sim.speed=AUTO.cur=AUTO.base;}
  // shells, so references can be resolved
  const TRm={},TRA=[],Rm=[],Im={},Fm=[],Nm={};
  S.TR.forEach(x=>{const tr=makeService(x.svc);TRm[tr.id]=tr;TRA.push(tr);});
  S.RT.forEach(()=>Rm.push({}));S.INC.list.forEach(x=>{Im[x.id]={};});S.LINE.faults.forEach(()=>Fm.push({}));S.INC.needs.forEach(x=>{Nm[x.id]={};});
  const SIGm={};SIGNALS.forEach(s=>{SIGm[s.id]=s;});
  const dec=v=>{
    if(v===null||typeof v!=='object')return v;
    if(Array.isArray(v))return v.map(dec);
    if(v.$num!==undefined)return Number(v.$num);
    if(v.$t!==undefined)return TRm[v.$t]||null;if(v.$r!==undefined)return Rm[v.$r]||null;if(v.$s!==undefined)return SIGm[v.$s]||null;
    if(v.$w!==undefined)return SW_BY[v.$w]||null;if(v.$i!==undefined)return Im[v.$i]||null;if(v.$g!==undefined)return GENTE[v.$g]||null;
    if(v.$x!==undefined)return PAX[v.$x]||null;if(v.$f!==undefined)return Fm[v.$f]||null;if(v.$n!==undefined)return Nm[v.$n]||null;
    if(v.$c!==undefined)return v.$c==='F'?FAULT_OCC:CUT_OCC;
    const o={};for(const k in v)o[k]=dec(v[k]);return o;};
  const fill=(dst,src)=>{for(const k in src)dst[k]=dec(src[k]);return dst;};
  Object.keys(stats).forEach(k=>{if(S.stats[k]!==undefined)stats[k]=S.stats[k];});
  fill(WX,S.WX);WX.P=climProb(WX.m);
  S.LINE.faults.forEach((x,i)=>fill(Fm[i],x));LINE.faults=Fm;LINE.powerUntil=S.LINE.powerUntil;LINE.day=S.LINE.day;{const d=Math.floor(sim.t/86400);try{VEG_SEASON(monthOf(d),dayDate(d).getFullYear());}catch(e){}WX.m=monthOf(d);WX.P=climProb(WX.m);wxNote();wxShown='';}
  carRestore(S.CAR);
  S.TR.forEach((x,i)=>{const tr=TRA[i];fill(tr,x.f);tr.cars=[];});
  S.RT.forEach((x,i)=>{const R=fill(Rm[i],x);if(R.tr&&R.secs&&R.req)R.releaseX=releaseXOf(R,R.tr.dir,R.kind,R.tr.len);/* recomputed: older saves kept a stale one */ROUTES.push(R);const pp=dedupe(R.pts||[]);if(pp.length>1){R.mesh=ribbon(frames(pp),0.75,0.9,ROUTE_MAT);R.mesh.renderOrder=3;scene.add(R.mesh);}});
  S.SW.forEach(x=>{const W=SW_BY[x.id];if(!W)return;W.reverse=x.reverse;W.frozenUntil=x.frozenUntil;W.nc=dec(x.nc);W.lockPos=x.lockPos;setSwitchVis(W);});
  // incidents: data back, behaviour rebuilt from it
  S.INC.list.forEach(x=>fill(Im[x.id],x));INC.list=S.INC.list.map(x=>Im[x.id]);INC.list.forEach(incSetup);
  S.INC.needs.forEach(x=>fill(Nm[x.id],x));INC.needs=S.INC.needs.map(x=>Nm[x.id]);
  ['seq','nseq','next','tick','auto','mean','chainAt','chainGap','telN'].forEach(k=>{INC[k]=S.INC[k];});
  INC.chain=S.INC.chain.slice();INC.chainWait=dec(S.INC.chainWait);INC.hist=dec(S.INC.hist);INC.tel=dec(S.INC.tel);INC.ai=dec(S.INC.ai);
  INC.dq=dec(S.INC.dq);INC.dOpen=null;INC.dPause=false;INC.ref=true;
  PN.fault=dec(S.PN.fault);STN.sala=!(S.STN&&S.STN.sala===false);STN.warned=null;
  Object.keys(S.CTC).forEach(k=>{CTC[k]=dec(S.CTC[k]);});ctcDirty=true;
  // people and passengers on the stage
  const DYN=['st','loc','leg','plan','pend','seen','last','lastTxt','away','free','here','vday','tr','px','carId'];
  S.G.forEach((x,i)=>{const P=GENTE[i];DYN.forEach(k=>{delete P[k];});P.px=null;P.tr=null;P.plan=[];P.pend=[];P.seen=0;P.last=null;fill(P,x);});
  S.PX.forEach(x=>{const p=PAX[x.i];Object.keys(p).forEach(k=>{if(k!=='i')delete p[k];});fill(p,x);p.on=true;if(p.pid!=null)dress(p,GENTE[p.pid]);else if(p.crew)crewDress(p);else if(p.look)wearOuter(p,p.look);});
  CREW.seq=S.CREW?S.CREW.seq:0;CREW.jobs=S.CREW?dec(S.CREW.jobs):[];
  GENTE.forEach(P=>{if(P.px&&!P.px.on)P.px=null;});
  // the cars on the roads and in the car park
  TRAF.cars.slice().forEach(c=>disposeVeh(c.g));TRAF.cars.length=0;PARKING.bays.forEach(B=>{B.occ=0;});
  TRAF.pend=[];if(S.TRAF){TRAF.seq=S.TRAF.seq;TRAF.next=S.TRAF.next;TRAF.pend=dec(S.TRAF.pend||[]);S.TRAF.bays.forEach((o,i)=>{if(PARKING.bays[i])PARKING.bays[i].occ=o;});
    S.TRAF.cars.forEach(x=>{const c=dec(x);c.g=makeVeh(c.kind,c.hex);scene.add(c.g);TRAF.cars.push(c);carPlace(c);});}
  // the trains on the board, with their cars and doors
  ttMigrate();
  TRAINS.forEach(tr=>{if(!tr.spawned||tr.done)return;
    tr.doorA=tmat(DOOR_C);tr.doorB=tmat(DOOR_C);
    trainSpecs(tr).forEach((sp,i,a)=>{const c=buildCar(tr,sp,i,a.length);scene.add(c.g);tr.cars.push(c);});
    placeCars(tr);
    if(tr.doors==='open'){const side=tr.stopTrack==='v2'?1:-1,ry=tr.cars[0].g.rotation.y,useA=(-Math.sin(ry))*side>0;(useA?tr.doorA:tr.doorB).color.setHex(DOOR_O);
      tr.cars.forEach(c=>{if(!c.leaves)return;c.g.updateMatrixWorld(true);c.leaves.forEach(m=>{m.getWorldPosition(_wp);const f=(_wp.z-c.g.position.z)>0?1:-1;m.userData.door.open=(f===side)?1:0;});});}});
  ttEnsure();refreshAspects();computeCrossing();
  lastList='';lastCtc='';lastTurno='';lastIncH='';lastLib='';lastBoard='';esqDirty=true;uiDirty=true;paint();
  document.getElementById('speed').value=sim.auto?'auto':String(sim.speed);autoLabel(true);
}

/* ---- dónde se guardan: tu cuenta (privada) y este navegador ---- */
async function gz(str){
  if(typeof CompressionStream==='undefined')return'r:'+str;
  const cs=new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));const buf=new Uint8Array(await new Response(cs).arrayBuffer());
  let b='';for(let i=0;i<buf.length;i+=0x8000)b+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return'z:'+btoa(b);}
async function gunz(s){
  if(s.slice(0,2)==='r:')return s.slice(2);
  const bin=atob(s.slice(2)),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  const ds=new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));return await new Response(ds).text();}
const LS_K=n=>NIVEL.clave+'-partida-'+n;
const LOCAL={
  list(){const out={};for(let n=1;n<=GAME.slots;n++){try{const r=localStorage.getItem(LS_K(n));if(r){const o=JSON.parse(r);out[n]=o.meta;}}catch(e){}}return out;},
  get(n){try{const r=localStorage.getItem(LS_K(n));return r?JSON.parse(r).z:null;}catch(e){return null;}},
  put(n,meta,z){try{localStorage.setItem(LS_K(n),JSON.stringify({meta:meta,z:z}));return true;}catch(e){return false;}},
  del(n){try{localStorage.removeItem(LS_K(n));}catch(e){}}};
const CHUNK=180000;
const CLOUD={
  base:()=>'data/users/'+GAME.uid,
  doc:n=>CLOUD.base()+'/'+(NIVEL.clave==='so'?'':NIVEL.clave+'-')+'s'+n,   // one set of slots per level (Santa Olalla keeps its old ids)
  async list(){const out={};const q=await GAME.store.collection(CLOUD.base()).get();q.docs.forEach(d=>{const m=d.data();if(m&&m.slot&&(m.nivel||'so')===NIVEL.clave)out[m.slot]=m.meta;});return out;},
  async get(n){const h=await GAME.store.doc(CLOUD.doc(n)).get();if(!h.exists)return null;const m=h.data();let z='';
    for(let i=0;i<m.parts;i++){const p=await GAME.store.doc(CLOUD.doc(n)+'/p/'+i).get();if(!p.exists)return null;z+=p.data().z;}return z;},
  async put(n,meta,z){const parts=Math.ceil(z.length/CHUNK);
    for(let i=0;i<parts;i++)await GAME.store.doc(CLOUD.doc(n)+'/p/'+i).set({z:z.slice(i*CHUNK,(i+1)*CHUNK)});
    await GAME.store.doc(CLOUD.doc(n)).set({slot:n,nivel:NIVEL.clave,meta:meta,parts:parts});},
  async del(n){await GAME.store.doc(CLOUD.doc(n)).delete();}};
async function storeInit(){
  try{if(!window.claude||!window.claude.use)return;const [db,user]=await Promise.all([window.claude.use('db'),window.claude.use('user')]);
    if(!db||!user)return;const id=await user.id();if(!id)return;GAME.store=db;GAME.uid=id;MSLOTS=await slotsList();menuRender();}catch(e){}}
async function slotsList(){const L=LOCAL.list();let C={};if(GAME.store){try{C=await CLOUD.list();}catch(e){}}
  const out={};for(let n=1;n<=GAME.slots;n++){const a=L[n],b=C[n];const m=a&&b?(a.savedAt>=b.savedAt?a:b):(a||b);if(m)out[n]=Object.assign({},m,{cloud:!!b,local:!!a});}return out;}
async function gameSave(n){
  const snap=snapEncode(),p=stats.trains?Math.round(stats.onTime/stats.trains*100):null;
  const meta={savedAt:Date.now(),level:GAME.level,levelName:GAME.levelName,t:sim.t,date0:DATE0.getTime(),trains:stats.trains,punt:p,caused:Math.round(stats.caused/60),inc:INC.list.length};
  const z=await gz(JSON.stringify(snap));
  const okL=LOCAL.put(n,meta,z);let okC=false,err='';
  if(GAME.store){try{await CLOUD.put(n,meta,z);okC=true;}catch(e){err=e&&e.code||'error';}}
  return{ok:okL||okC,local:okL,cloud:okC,err:err,size:z.length};}
async function gameLoad(n){
  const L=LOCAL.list()[n];let C=null,z=null;
  if(GAME.store){try{C=(await CLOUD.list())[n];}catch(e){}}
  if(C&&(!L||C.savedAt>L.savedAt)){try{z=await CLOUD.get(n);}catch(e){}}
  if(!z)z=LOCAL.get(n);if(!z&&C){try{z=await CLOUD.get(n);}catch(e){}}
  if(!z)return false;
  const S=JSON.parse(await gunz(z));
  if(!(S.v>=2))return'old';   // v2: plano de vías real de Adif; las anteriores tenían otra disposición de vías
  snapRestore(S);return true;}
async function gameDel(n){LOCAL.del(n);if(GAME.store){try{await CLOUD.del(n);}catch(e){}}}

/* ---- menú principal y menú de la partida ---- */
const MENU=document.getElementById('menu'),N1=document.getElementById('n1'),N1M=document.getElementById('n1m'),DLG=document.getElementById('gdlg');
const fechaJuego=m=>{const d0=new Date(m.date0),d=new Date(d0.getFullYear(),d0.getMonth(),d0.getDate()+JORN_SALTO*Math.floor(m.t/86400),12);return DIAS[d.getDay()]+' '+d.getDate()+' de '+MESES[d.getMonth()]+' · '+fmtHM(m.t);};
const haceCuanto=ms=>{const d=new Date(ms),now=new Date(),hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  if(d.toDateString()===now.toDateString())return'hoy a las '+hm;const y=new Date(now);y.setDate(now.getDate()-1);if(d.toDateString()===y.toDateString())return'ayer a las '+hm;
  return d.getDate()+' de '+MESES[d.getMonth()]+' a las '+hm;};
let MSLOTS={},menuView='home';
var MENU_ON=false;
/* behind the menu the level plays by itself: trains come and go, the camera turns slowly round the station */
function menuShow(v){menuView=v||'home';MENU.hidden=false;MENU_ON=true;const ap=document.getElementById('app');ap.setAttribute('aria-hidden','true');ap.classList.add('demo');
  if(!GAME.on){GAME.demo=true;INC.auto=false;sim.paused=false;sim.auto=false;sim.speed=4;cam.elev=0.36;cam.size=IS_PHONE?120:132;cam.target.set(-4,0,-8);}
  else if(!sim.paused){sim.paused=true;GAME.wasRunning=true;}
  menuRender(true);slotsList().then(s=>{MSLOTS=s;menuRender();});}
function menuHide(){MENU.hidden=true;MENU_ON=false;GAME.demo=false;const ap=document.getElementById('app');ap.removeAttribute('aria-hidden');ap.classList.remove('demo');
  animTo({theta:HOME.theta,elev:HOME.elev,size:HOME.size,tx:HOME.tx,tz:HOME.tz},1.2);}
const ovFor=tr=>CTC.msgs.some(m=>m.state==='pending'&&m.type==='ov'&&m.s===tr.id);   // a pending order to step this freight aside
function demoTick(dt){
  if(!GAME.demo)return;cam.theta+=dt*0.035;placeCam();
  GAME.demoT=(GAME.demoT||0)-dt;if(GAME.demoT>0)return;GAME.demoT=0.4;
  TRAINS.forEach(tr=>{if(tr.done||tr.work)return;const ph=tr.phase,A=trainActions(tr),has=a=>A.some(o=>o.act===a&&!o.dis);
    if(!tr.routeIn&&(tr.zone==='in'||(tr.spawned&&ph==='aprox'))){
      if(tr.md){for(const v of[tr.entryTrack,'v3','v1','v2'])if(has('in:'+v)){doTrainAct(tr,'in:'+v);break;}}
      else if((tr.svc.apt||ovFor(tr))&&has('in:v3'))doTrainAct(tr,'in:v3');else if(has('thru'))doTrainAct(tr,'thru');}
    if(ph==='puertas'&&sim.t>=tr.svc.dep-20&&has('close'))doTrainAct(tr,'close');
    if((ph==='listo'||ph==='apartado')&&(tr.svc.dep===undefined||sim.t>=tr.svc.dep)&&!ovFor(tr)&&has('dep'))doTrainAct(tr,'dep');
    if(ph==='pasando'&&!tr.routeOut&&has('exit'))doTrainAct(tr,'exit');});
  GAME.boardT=(GAME.boardT||0)-0.4;if(GAME.boardT<=0){GAME.boardT=2;boardFlap();}
}
/* split-flap departures board, like the ones in the stations of the time */
const FLAP={rows:7,cols:[5,1,5,1,15,1,2,1,11]},FW=FLAP.cols.reduce((a,b)=>a+b,0);let flapCells=null;
/* the level card shows the real track diagram: its styles are copied for the copy */
function esqThumbCss(){if(GAME.thumbCss)return;GAME.thumbCss=1;const out=[];for(const sh of document.styleSheets){let rs;try{rs=sh.cssRules;}catch(e){continue;}
  for(const r of rs){if(r.selectorText&&/#esq\b/.test(r.selectorText))out.push(r.cssText.replace(/#esq\b/g,'.lv-map'));}}
  const st=document.createElement('style');st.textContent=out.join('\n');document.head.appendChild(st);}
function flapBuild(){const b=document.getElementById('mflap');let h='';
  for(let r=0;r<FLAP.rows;r++){h+='<div class="fr">';for(let c=0;c<FW;c++)h+='<i> </i>';h+='</div>';}
  b.innerHTML=h;flapCells=[...b.querySelectorAll('.fr')].map(row=>[...row.children]);}
const flapTxt=(s,n)=>{s=String(s).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'');return(s+' '.repeat(n)).slice(0,n);};
function boardFlap(){if(!flapCells)flapBuild();
  document.getElementById('mclock').textContent=fmtHM(sim.t);
  const list=TRAINS.filter(t=>!t.done&&!t.work&&t.zone!=='end'&&tSO(t)>sim.t-120).sort((a,b)=>tSO(a)-tSO(b)).slice(0,FLAP.rows);
  for(let r=0;r<FLAP.rows;r++){const t=list[r];let line;
    if(!t)line=' '.repeat(FW);
    else{const st=t.spawned?(t.phase==='puertas'||t.phase==='parado'?'EN ANDEN':t.phase==='aprox'?'LLEGANDO':t.phase==='saliendo'||t.phase==='despachando'?'SALIENDO':t.stops?'EN VIA':'PASANDO'):
        (t.entryDelay||0)>=120?'RETR '+Math.round(t.entryDelay/60)+"'":t.stops?'':'SIN PARADA';
      const via=t.stopTrack?vn(t.stopTrack):(t.routeIn?vn(t.entryTrack):'');
      line=flapTxt(fmtHM(tSO(t)),5)+' '+flapTxt(t.svc.num,5)+' '+flapTxt(t.svc.to.replace(/-.*/,''),15)+' '+flapTxt(via,2)+' '+flapTxt(st,11);}
    for(let c=0;c<FW;c++){const ch=line[c],cell=flapCells[r][c];if(cell.textContent!==ch){cell.textContent=ch;cell.classList.remove('flip');void cell.offsetWidth;cell.classList.add('flip');}}}
}
function slotCard(n,m,act){
  if(!m)return'<button class="slot empty" data-'+act+'="'+n+'"'+(act==='load'?' disabled':'')+'><span class="sn">'+n+'</span><span class="si"><b>Ranura vacía</b><small>'+(act==='save'?'Guardar aquí':'Sin partida')+'</small></span></button>';
  return'<div class="slotw"><button class="slot" data-'+act+'="'+n+'"><span class="sn">'+n+'</span><span class="si"><b>N'+m.level+' · '+esc(m.levelName)+'</b><small>'+esc(fechaJuego(m))+'</small>'+
    '<small class="sm">'+(m.trains?m.trains+' trenes · '+(m.punt===null?'—':m.punt+'%')+' puntuales · '+m.caused+'′ generados':'Sin trenes todavía')+(m.inc?' · '+m.inc+' incidencia'+(m.inc>1?'s':'')+' abierta'+(m.inc>1?'s':''):'')+'</small>'+
    '<small class="sd">Guardada '+haceCuanto(m.savedAt)+(m.cloud?' · en tu cuenta':' · en este navegador')+'</small></span></button>'+
    (act==='load'?'<button class="sdel" data-del="'+n+'" aria-label="Borrar la partida de la ranura '+n+'" title="Borrar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>':'')+'</div>';}
const lastSlot=()=>Object.keys(MSLOTS).map(Number).sort((a,b)=>MSLOTS[b].savedAt-MSLOTS[a].savedAt)[0];
function menuRender(anim){
  const has=Object.keys(MSLOTS).length,last=has?lastSlot():null,body=document.getElementById('menu-b');let h='',i=0;
  const item=(m,t,sub,pri,dis)=>'<button class="mi'+(pri?' pri':'')+'" data-m="'+m+'"'+(dis?' disabled':'')+' style="--d:'+(i++)+'"><span class="mi-n">'+String(i).padStart(2,'0')+'</span><span class="mi-t">'+t+'<small>'+sub+'</small></span><span class="mi-a" aria-hidden="true">→</span></button>';
  if(menuView==='home'){
    h='<nav class="mlist" aria-label="Menú principal">'+(has?item('cont','Continuar',esc(fechaJuego(MSLOTS[last]))+' · ranura '+last,true):'')+
      item('new','Nueva partida','Elige nivel y empieza tu primera jornada, en otoño',!has)+
      item('load','Cargar partida',has?has+' partida'+(has>1?'s':'')+' guardada'+(has>1?'s':''):'No hay partidas guardadas',false,!has)+'</nav>'+
      '<p class="mnote" style="margin-top:14px;font-size:11px">Personas basadas en «Low Poly Male Character» de alicewithalex (Sketchfab), CC BY 4.0.</p>';}
  else if(menuView==='new'){
    esqThumbCss();const esq=document.getElementById('esq').outerHTML.replace(/ id="[^"]*"/g,'').replace('<svg','<svg aria-hidden="true" class="lv-map"');
    h='<div class="mhd"><button class="mback" data-m="home" aria-label="Volver">←</button><b>Elige nivel</b></div><div class="levels">'+
      TTC_NIVELES.map(L=>'<button class="lvc" data-lvl="'+L.id+'"><div class="lv-img">'+(L.id===NIVEL.id?esq:'<svg aria-hidden="true" class="lv-map" viewBox="0 0 1080 178"></svg>')+'<span class="lv-tag">N'+L.n+'</span></div><div class="lv-tx"><b>'+esc(L.nombre)+'</b>'+
        '<small>'+esc(L.sub)+'</small><div class="lv-chips">'+L.chips.map(c=>'<i>'+esc(c)+'</i>').join('')+'</div>'+
        '<p>'+esc(L.txt)+'</p></div><span class="lv-go">Jugar →</span></button>').join('')+
'<div class="lv-lock"><div>'+[1,2,3].map(k=>'<span>N'+(TTC_NIVELES.length+k)+'</span>').join('')+'</div><b>Más estaciones, próximamente</b><small>Nudos más grandes, más vías y más tráfico</small></div></div>';}
  else if(menuView==='load'){
    h='<div class="mhd"><button class="mback" data-m="home" aria-label="Volver">←</button><b>Cargar partida</b></div><div class="slots">'+
      Array.from({length:GAME.slots},(_,k)=>slotCard(k+1,MSLOTS[k+1],'load')).join('')+'</div>'+
      '<p class="mnote">'+(GAME.store?'Las partidas se guardan en tu cuenta y en este navegador.':'Las partidas se guardan en este navegador.')+'</p>';}
  body.innerHTML=h;MENU.classList.toggle('sub',menuView!=='home');
  if(anim){MENU.classList.remove('intro');void MENU.offsetWidth;MENU.classList.add('intro');}
  const f=body.querySelector('.mi:not(:disabled),.lvc,.slot:not(:disabled),.mback');if(f&&document.activeElement&&MENU.contains(document.activeElement)===false)f.focus({preventScroll:true});}
async function startNew(intro){GAME.over=false;GAME.loading=true;GAME.demo=false;snapRestore(GAME.fresh);GAME.on=true;menuHide();sim.paused=false;document.getElementById('pause').setAttribute('aria-pressed','false');
  setSpeed(2);GAME.loading=false;if(intro&&NIVEL.intro)dlgOpen(introHTML());else startTip();}
function startTip(){toast(UI.lay==='phone'?'Elige vía para cada tren en Trenes · un dedo gira e inclina, dos dedos mueven y acercan':'Elige vía para cada tren en el panel Trenes · arrastra para girar la maqueta');}
/* the level's introduction, before the first jornada of a new game (not for loaded games or the test shortcut #jugar) */
function introHTML(){const I=NIVEL.intro,x=dayDate(0),f=x.getDate()+' de '+MESES[x.getMonth()]+' de '+x.getFullYear(),n=I.p.length;
  return'<div class="mhd"><b>'+esc(I.titulo)+'</b><span class="gt">'+esc(f)+'</span></div>'+
    I.p.map((t,i)=>'<p class="mnote" style="margin:'+(i?'0 0 10px':'4px 0 10px')+';font-size:14px;line-height:1.55;color:var(--'+(i===n-1?'ink-2':'ink')+')">'+esc(t)+'</p>').join('')+
    '<div class="gd-a"><button class="btn primary" data-d="intro">Empezar</button></div>';}
async function startLoad(n){const b=document.querySelector('#menu [data-load="'+n+'"]');if(b){b.classList.add('busy');b.disabled=true;}
  GAME.demo=false;let ok=false;try{ok=await gameLoad(n);}catch(e){ok=false;}
  if(ok!==true){GAME.demo=true;MENU_ON=false;toast(ok==='old'?'La partida de la ranura '+n+' es del plano de vías anterior: no se puede cargar con el plano real':'No se ha podido cargar la partida de la ranura '+n);MENU_ON=true;menuRender();return;}
  GAME.on=true;menuHide();sim.paused=false;document.getElementById('pause').setAttribute('aria-pressed','false');showDec();
  toast('Partida cargada · '+fechaDia(Math.floor(sim.t/86400))+' a las '+fmtHM(sim.t));}
MENU.addEventListener('click',async e=>{
  const m=e.target.closest('[data-m]'),l=e.target.closest('[data-lvl]'),ld=e.target.closest('[data-load]'),dl=e.target.closest('[data-del]');
  if(m&&!m.disabled){const v=m.getAttribute('data-m');
    if(v==='cont'){startLoad(lastSlot());return;}
    menuView=v;menuRender(true);return;}
  if(l){const id=l.getAttribute('data-lvl');if(id===NIVEL.id){startNew(true);return;}
    /* another station: the page is built for one level, so it reloads with that one and starts a new game there */
    try{localStorage.setItem('ttc.nivel',id);}catch(_){}location.hash='nivel='+id+'&jugar';location.reload();return;}
  if(dl){const n=+dl.getAttribute('data-del');if(dl.classList.contains('arm')){await gameDel(n);delete MSLOTS[n];menuRender();}
    else{dl.classList.add('arm');dl.title='Pulsa otra vez para borrar';setTimeout(()=>dl.classList.remove('arm'),2500);}return;}
  if(ld&&!ld.disabled){startLoad(+ld.getAttribute('data-load'));}
});
/* keyboard: arrows to move, Enter to accept, Esc to go back */
window.addEventListener('keydown',e=>{if(MENU.hidden)return;
  const items=[...MENU.querySelectorAll('.mi:not(:disabled),.lvc,.slot:not(:disabled),.mback')];if(!items.length)return;
  const i=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=e.key==='ArrowDown'?(i+1)%items.length:(i<=0?items.length-1:i-1);items[n].focus();}
  else if(e.key==='Escape'&&menuView!=='home'){e.preventDefault();menuView='home';menuRender(true);}});
/* N1: menú de la partida */
function n1Open(on){N1M.hidden=!on;N1.setAttribute('aria-expanded',on?'true':'false');}
N1.addEventListener('click',e=>{e.stopPropagation();n1Open(N1M.hidden);});
document.addEventListener('click',e=>{if(!N1M.hidden&&!e.target.closest('#n1m'))n1Open(false);});
N1M.addEventListener('click',e=>{const b=e.target.closest('[data-g]');if(!b)return;n1Open(false);const g=b.getAttribute('data-g');if(g==='snd'){sndSet(!SND.on);return;}if(g==='mus'){musSet(!MUS.on);return;}
  if(g==='save')dlgSave(false);else if(g==='exit')dlgExit();});
function dlgClose(){if(GAME.over)return;DLG.hidden=true;if(GAME.dlgPaused){sim.paused=false;document.getElementById('pause').setAttribute('aria-pressed','false');}GAME.dlgPaused=false;}
function dlgOpen(html){DLG.querySelector('.gd-b').innerHTML=html;DLG.hidden=false;if(!sim.paused){sim.paused=true;GAME.dlgPaused=true;document.getElementById('pause').setAttribute('aria-pressed','true');}}
async function dlgSave(thenExit){
  dlgOpen('<div class="mhd"><b>'+(thenExit?'Guardar y salir':'Guardar partida')+'</b><span class="gt">'+esc(fechaDia(Math.floor(sim.t/86400)))+' · '+fmtHM(sim.t)+'</span></div><div class="slots" id="gslots"><p class="mnote">Leyendo partidas…</p></div>'+
    '<div class="gd-a"><button class="btn" data-d="x">Cancelar</button></div>');
  GAME.thenExit=thenExit;MSLOTS=await slotsList();
  document.getElementById('gslots').innerHTML=Array.from({length:GAME.slots},(_,i)=>slotCard(i+1,MSLOTS[i+1],'save')).join('')+
    '<p class="mnote">'+(GAME.store?'Se guarda en tu cuenta y en este navegador.':'Se guarda en este navegador.')+' Elige una ranura; si ya tiene una partida, se sustituye.</p>';}
function dlgExit(){dlgOpen('<div class="mhd"><b>Salir de la partida</b></div><p class="mnote" style="margin:4px 0 14px">¿Quieres guardar antes de volver al menú principal? Lo que no guardes se perderá.</p>'+
  '<div class="gd-a"><button class="btn" data-d="x">Cancelar</button><button class="btn" data-d="quit">Salir sin guardar</button><button class="btn primary" data-d="saveq">Guardar y salir</button></div>');}
DLG.addEventListener('click',async e=>{const b=e.target.closest('[data-d],[data-save]');if(!b)return;
  if(b.hasAttribute('data-save')){const n=+b.getAttribute('data-save');b.classList.add('busy');b.disabled=true;
    let r;try{r=await gameSave(n);}catch(err){r={ok:false};}
    if(!r.ok){toast('No se ha podido guardar la partida');b.classList.remove('busy');b.disabled=false;return;}
    toast('Partida guardada en la ranura '+n+(r.cloud?' (en tu cuenta)':' (en este navegador)'));
    if(GAME.thenExit){DLG.hidden=true;GAME.dlgPaused=false;exitToMenu();}else dlgClose();return;}
  const d=b.getAttribute('data-d');
  if(d==='x')dlgClose();else if(d==='intro'){dlgClose();startTip();}else if(d==='save')dlgSave(false);else if(d==='quit'){DLG.hidden=true;GAME.dlgPaused=false;exitToMenu();}else if(d==='saveq')dlgSave(true);});
function exitToMenu(){GAME.over=false;GAME.on=false;sim.paused=true;GAME.wasRunning=false;select(null);snapRestore(GAME.fresh);sim.paused=true;menuShow('home');}

document.getElementById('menu-ver').textContent='Train Traffic Controller · versión 74 · nivel 1 disponible';
GAME.fresh=snapEncode();   // the level as it is at 00:00 of the first jornada, before anyone plays: «Nueva partida» starts from it
sim.paused=true;storeInit();
/* #jugar en la dirección: directamente a una partida nueva (pruebas y desarrollo) */
if(/[#&?]jugar\b/.test(location.search+location.hash))startNew();else menuShow('home');

window.__SO={blkFor:blkFor,onTrack:onTrack,lineAt:lineAt,blockOcc:blockOcc,SND:SND,sndStep:sndStep,TRAINSs:TRAINS,simS:sim,devGoTime:devGoTime,WXs:WX,camS:cam,carSpecs:carSpecs,PARKING:PARKING,CAMINOS:CAMINOS,TRAF:TRAF,roadPath:roadPath,bayPath:bayPath,exitPath:exitPath,dropPath:dropPath,JN:JN,PN:PN,snapEncode:snapEncode,snapRestore:snapRestore,gameSave:gameSave,gameLoad:gameLoad,slotsList:slotsList,GAME:GAME,menuShow:menuShow,startNew:startNew,startLoad:startLoad,stats:stats,groundCanvas:groundTex.userData.c,ENT:ENT,TRACKS:TRACKS,SWITCHES:SWITCHES,SIGNALS:SIGNALS,BATCH:BATCH,SOUP:SOUP,MAT_HEX:MAT_HEX,groundH:groundH,HOUSES:HOUSES,TREES:TREES,
  select:select,SIGA:SIGA,LAMPS:LAMPS,parts432:parts432,parts448:parts448,R448:R448,stations448:stations448,R432:R432,R432_DOORS:R432_DOORS,parts470:parts470,tex470:tex470,TEX470:TEX470,R470:R470,layout470:layout470,paintFront470:paintFront470,parts269:parts269,tex269:tex269,paintFront269:paintFront269,PROF269:PROF269,R269:R269,parts252:parts252,tex252:tex252,parts3:parts3,paintT3:paintT3,paintNose3:paintNose3,KIND3:KIND3,carSpecs:carSpecs,partsSemat:partsSemat,partsJPD:partsJPD,parts319:parts319,paintCar319:paintCar319,paintFront319:paintFront319,UNITS319:UNITS319,partsTT6:partsTT6,paintTT6:paintTT6,paintJPD:paintJPD,paintJPDEnd:paintJPDEnd,buildSemat:buildSemat,buildCar:buildCar,paintSemat:paintSemat,mercSpecs:mercSpecs,compText:compText,LIVS:LIVS,paintCar252:paintCar252,paintCar269:paintCar269,paintFront252:paintFront252,build252:build252,T252:T252,surf252:surf252,R252:R252,v470:v470,sim:sim,stats:stats,TRAINS:TRAINS,ROUTES:ROUTES,PAX:PAX,doTrainAct:doTrainAct,search:search,checkIn:checkIn,checkOut:checkOut,opsStep:opsStep,trStatus:trStatus,DEV:DEV,DAY:DAY,WX:WX,CTC:CTC,ctcStep:ctcStep,LINE:LINE,lineStep:lineStep,parts10k:parts10k,R10K:R10K,estrellaSpecs:estrellaSpecs,trainActions:trainActions,etaSO:etaSO,blockOcc:blockOcc,makeDay:makeDay,climProb:climProb,pct100:pct100,wxStep:wxStep,PRECIP:PRECIP,WXU:WXU,solarPos:solarPos,updateDayNight:updateDayNight,NIGHT:NIGHT,setFree:setFree,FREE:FREE,cam:cam,devSpawn:devSpawn,devStep:devStep,GENTE:GENTE,PAX:PAX,gentePlanDay:gentePlanDay,pickAt:pickAt,renderInspector:renderInspector,INC:INC,IT:IT,TK:TK,telSend:telSend,solDo:solDo,chooseDec:chooseDec,incEnd:incEnd,incStep:incStep,setPage:setPage,PN:PN,SW_BY:SW_BY,refreshAspects:refreshAspects};
