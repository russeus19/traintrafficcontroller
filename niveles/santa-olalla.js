'use strict';
/* =====================================================================
   Train Traffic Controller · Nivel 1 · Santa Olalla de Bureba
   Línea Madrid – Hendaya, tramo Burgos – Miranda de Ebro, finales de los 90.
   Todo lo que es propio de esta estación: la maqueta (terreno, vías, estación, pueblo), el horario, el censo, las
   carreteras de la comarca, el clima y los nombres de las estaciones vecinas. El motor llama a cada bloque en su
   momento (NIVEL.<bloque>()) y usa lo que devuelve; dentro de cada bloque están a mano los ayudantes del motor.
   ===================================================================== */
const NIVEL={id:'santa-olalla',clave:'so',n:1,
  /* introducción de la primera partida: la historia que cuenta el juego */
  intro:{titulo:'Primer destino',p:[
    'Acabas de entrar en Renfe y te han dado tu primer destino: factor de circulación en Santa Olalla de Bureba, una estación pequeña de la línea Burgos – Miranda de Ebro, junto a un pueblo de cuarenta vecinos con su iglesia y su paso a nivel.',
    'Por aquí pasan Talgos, expresos nocturnos, regionales y mercancías, de día y de noche. Tú decides por qué vía entra cada tren, cuándo sale y qué hacer cuando algo se tuerce: una avería, una nevada, un viajero indispuesto. Todo queda anotado en tu hoja de servicio.',
    'Cada jornada es una estación del año. Si al cabo de un año tu hoja está limpia, llegará el ascenso y, con él, estaciones más grandes. Pero si das paso a un tren hacia una vía ocupada, no habrá segunda oportunidad.',
    'Son las doce de la noche. Empieza tu primera jornada.']},
  nombre:'Santa Olalla',nombreLargo:'Santa Olalla de Bureba',linea:'Burgos – Miranda de Ebro',lineaCorta:'Burgos – Miranda',
  lado:{o:'Miranda',e:'Burgos'},            // hacia dónde mira cada extremo de la maqueta (-x, +x)
  pnLado:'Miranda',pnSenales:'E2, E4 y las salidas hacia Miranda',pnTxt:'Paso a Nivel de la carretera de Santa María del Invierno (lado Miranda)',
  telemando:'Miranda',relevo:'Burgos o Miranda',piso:'Burgos',
  censo:'40 vecinos empadronados (1999)',climaFuente:'Burgos Aeropuerto 1981–2010',
  // sonido: el reloj del ayuntamiento (da las horas de 7 a 23), el nido de cigüeñas de la torre y el paso a nivel
  apartar:dir=>dir<0?'vía 3 o 5':'vía 3',   // dónde apartar un tren (a la vía 5 solo se entra desde el lado Burgos)
  sonido:{reloj:{x:-19,y:12,z:-98,desde:7,hasta:23},cigüeñas:{x:13,y:22,z:-104.5},pnZ:9}};
/* ---- tablero · tamaño de la maqueta y relieve del terreno ---- */
/* ---- plants of few polygons (trees and bushes): foliage in faceted lumps, each a little irregular and turned its own way,
   darker underneath and lighter on top (vertex colour), the facets softened towards the round of the crown; trunks and
   boughs as tapered tubes ---- */
function vegHash(x,y,z){const s=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;return s-Math.floor(s);}
function vegLump(P,geo,sx,sy,sz,x,y,z,jit,seed,ang){const q=geo.index?geo.toNonIndexed():geo,a=q.attributes.position.array,ca=Math.cos(ang||0),sa=Math.sin(ang||0);
  for(let i=0;i<a.length;i+=3){const k=1+(jit||0)*(vegHash(a[i]+(seed||0),a[i+1],a[i+2])-0.5)*2,px=a[i]*ca-a[i+2]*sa,pz=a[i]*sa+a[i+2]*ca;P.push(px*k*sx+x,a[i+1]*k*sy+y,pz*k*sz+z);}}
function vegTube(P,p0,p1,r0,r1,n){const d=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]],L=Math.hypot(d[0],d[1],d[2])||1;d[0]/=L;d[1]/=L;d[2]/=L;
  let u=Math.abs(d[1])<0.9?[0,1,0]:[1,0,0];const v=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]],vl=Math.hypot(v[0],v[1],v[2]);v[0]/=vl;v[1]/=vl;v[2]/=vl;
  u=[v[1]*d[2]-v[2]*d[1],v[2]*d[0]-v[0]*d[2],v[0]*d[1]-v[1]*d[0]];
  const pt=(p,r,k)=>{const a=k*TAU/n,c=Math.cos(a)*r,q=Math.sin(a)*r;return[p[0]+u[0]*c+v[0]*q,p[1]+u[1]*c+v[1]*q,p[2]+u[2]*c+v[2]*q];};
  for(let k=0;k<n;k++){const a=pt(p0,r0,k),b=pt(p0,r0,k+1),c=pt(p1,r1,k+1),e=pt(p1,r1,k);P.push(a[0],a[1],a[2],c[0],c[1],c[2],b[0],b[1],b[2],a[0],a[1],a[2],e[0],e[1],e[2],c[0],c[1],c[2]);}}
function vegGeo(P,o){o=o||{};if(o.floor!==undefined)for(let i=1;i<P.length;i+=3)if(P[i]<o.floor)P[i]=o.floor;
  let y0=1e9,y1=-1e9;for(let i=1;i<P.length;i+=3){y0=Math.min(y0,P[i]);y1=Math.max(y1,P[i]);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.computeVertexNormals();
  const n=g.attributes.normal.array,C=[],lo=o.lo===undefined?1:o.lo,hi=o.hi===undefined?1:o.hi,cy=o.cy===undefined?(y0+y1)/2:o.cy,sm=o.smooth||0;
  for(let i=0;i<P.length;i+=3){const t=(P[i+1]-y0)/((y1-y0)||1),c=lo+(hi-lo)*t;C.push(c,c,c);
    if(sm){const rx=P[i],ry=(P[i+1]-cy)*(o.ry||1),rz=P[i+2],l=Math.hypot(rx,ry,rz)||1,nx=n[i]*(1-sm)+rx/l*sm,ny=n[i+1]*(1-sm)+ry/l*sm,nz=n[i+2]*(1-sm)+rz/l*sm,nl=Math.hypot(nx,ny,nz)||1;n[i]=nx/nl;n[i+1]=ny/nl;n[i+2]=nz/nl;}}
  g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));return g;}
/* a round crown (encina, plátano, frutal): a core, a ring of lumps round it and one on top; floor flattens it underneath */
function crownRound(seed,n,floor,tall){const P=[],R=mulberry(seed),I=new THREE.IcosahedronGeometry(1,0),t=tall||1;vegLump(P,I,0.8,0.52*t,0.8,0,0,0,0.12,seed,R()*TAU);
  for(let k=0;k<n;k++){const a=k*TAU/n+R()*0.7,d=0.46+0.14*R(),q=0.42+0.16*R();vegLump(P,I,q,q*0.74*t,q,Math.cos(a)*d,(-0.1+0.26*R())*t,Math.sin(a)*d,0.14,seed+k+1,R()*TAU);}
  vegLump(P,I,0.5+0.1*R(),0.3*t,0.5+0.1*R(),0.16*(R()-0.5),(0.3+0.08*R())*t,0.16*(R()-0.5),0.12,seed+19,R()*TAU);
  return vegGeo(P,{floor:floor,lo:0.58,hi:1.1,smooth:0.45,ry:1.5});}
/* the column of a Lombardy poplar: lumps one over another, each a little off the axis so the outline is not a string of
   beads, widest a third of the way up and narrowing to the tip */
function crownChopo(seed){const P=[],R=mulberry(seed),I=new THREE.IcosahedronGeometry(1,0),N=9;
  for(let k=0;k<N;k++){const u=k/(N-1),y=-0.62+1.3*u,q=(u<0.3?0.66+1.0*u:0.96-0.86*(u-0.3))*(0.9+0.2*R()),o=0.2*(1-0.6*u),a=R()*TAU;vegLump(P,I,q,0.3+0.06*R(),q,Math.cos(a)*o,y,Math.sin(a)*o,0.16,seed+k,R()*TAU);}
  for(let k=0;k<5;k++){const a=k*2.4+R(),y=-0.52+k*0.22,d=0.5-0.05*k;vegLump(P,I,0.46-0.04*k,0.24,0.46-0.04*k,Math.cos(a)*d,y,Math.sin(a)*d,0.14,seed+10+k,R()*TAU);}
  return vegGeo(P,{lo:0.66,hi:1.08,smooth:0.45,ry:0.2});}
NIVEL.tablero=function(){
/* the board reaches 180 m past the entry signals (±248) so that a train held at one is seen whole (the longest, a
   night Estrella, is 179 m); OX0..OX1 is the original board, kept for what was laid out on it, and the range the
   track diagram of the puesto de mando shows (EX0..EX1) */
const X0=-440,X1=440,Z0=-200,Z1=80,BW=X1-X0,BD=Z1-Z0,OX0=-260,OX1=260,EX0=OX0,EX1=OX1;
function groundH(x,z){
  let h=0;
  h+=5.2*ss((-z-50)/70);                                         // village slope
  h+=30*ss((-z-115)/75)*(0.62+0.7*fbm(x*0.012+2,z*0.015+4));     // hills
  h+=(fbm(x*0.02+3,z*0.02+7)-0.5)*1.5*ss((-z-40)/30);            // roughness north
  h+=(fbm(x*0.015+11,z*0.02)-0.5)*1.8*ss((z-36)/22);             // gentle swell in the southern fields
  return h;
}
return{X0,X1,Z0,Z1,BW,BD,OX0,OX1,EX0,EX1,groundH};};

/* ---- vias · vías, desvíos, señales y paso a nivel ---- */
NIVEL.vias=function(){
/* Plano de vías real del apartadero (Adif, Subdirección de Circulación Norte, «Enclavamiento eléctrico · vías y elementos
   I.S.E.», marzo de 2016; P.K. 402,013 de la línea 100). En el plano Madrid está a la izquierda; aquí se ve girado 180°,
   desde el lado del pueblo: Miranda (Hendaya) a la izquierda y el edificio de viajeros arriba. Junto al E.V. va la vía 2
   (andén lateral), luego la vía 1, el andén central de las vías 1 y 3, la vía 3 y la vía 5 de servicio, en topera, que sale
   de la vía 3 por la aguja 7 hacia el lado Miranda. Las distancias van comprimidas para que quepan en la maqueta (entre las
   señales de entrada hay 1.459 m en la realidad y 496 aquí), pero el orden y la disposición de vías, agujas y señales son
   los del plano. Claves internas de las vías: v1 = vía 2, v2 = vía 1, v3 = vía 3, v5 = vía 5. */
const TZ={1:0,2:4.3,3:13.7,5:18.2};          // track centre lines
const PH=1.33;                               // platform top (550 mm over rail head at 0.78)
const TRACKS={
  v1:{pts:line(X0+1.5,X1-1.5,TZ[1])},
  v2:{pts:line(X0+1.5,X1-1.5,TZ[2])},
  v3:{pts:join(scurve(-152,TZ[2],-112,TZ[3]),line(-112,112,TZ[3]),scurve(112,TZ[3],152,TZ[2]))},
  v5:{pts:join(line(-152,36,TZ[5]),scurve(36,TZ[5],60,TZ[3]))},
  dw:{pts:scurve(-196,TZ[1],-170,TZ[2])},
  de:{pts:scurve(170,TZ[2],196,TZ[1])}
};
// aparatos del plano: nº, P.K. real; el 7 no lleva calentador de agujas
const SWITCHES=[
  {id:'A24',num:'2–4',name:'Diagonal 2–4',side:'Miranda',connects:'Vía 2 ↔ vía 1',hl:'dw',pk:'402,637 · 402,565',legs:[{x:-196,t:1,dir:1,br:'dw',fromStart:true},{x:-170,t:2,dir:-1,br:'dw',fromStart:false}]},
  {id:'A6',num:'6',name:'Aguja 6',side:'Miranda',connects:'Vía 1 ↔ vía 3',pk:'402,554',legs:[{x:-152,t:2,dir:1,br:'v3',fromStart:true}]},
  {id:'A13',num:'1–3',name:'Diagonal 1–3',side:'Burgos',connects:'Vía 2 ↔ vía 1',hl:'de',pk:'401,760 · 401,832',legs:[{x:196,t:1,dir:-1,br:'de',fromStart:false},{x:170,t:2,dir:1,br:'de',fromStart:true}]},
  {id:'A5',num:'5',name:'Aguja 5',side:'Burgos',connects:'Vía 1 ↔ vía 3',pk:'401,847',legs:[{x:152,t:2,dir:-1,br:'v3',fromStart:false}]},
  {id:'A7',num:'7',name:'Aguja 7',side:'Burgos',connects:'Vía 3 ↔ vía 5',pk:'401,945',cal:false,legs:[{x:60,t:3,dir:-1,br:'v5',fromStart:false}]}
];
SWITCHES.forEach(s=>{s.reverse=false;});
/* señales del plano con su P.K. real. S2/x salen hacia Burgos (Madrid), S1/x hacia Miranda (Hendaya). S2/3A es la señal
   intermedia de la vía 3, sobre el andén central: abre con el itinerario que pasa por ella. La S2/2 figura en la tabla con
   P.K. 401,481, junto a la entrada: por el dibujo y por los 700 m de la vía 2 está en el 401,84 aprox.
   R1, R2 y R4 son de retroceso: monos de cuatro focos (rojo arriba a la izquierda, los otros tres blancos). Con la entrada
   en parada están en parada (el rojo); con la entrada abierta dicen a dónde va el tren: dos blancos a la derecha, a vía
   general sin pasar por los cambios; dos blancos abajo, a vía desviada. */
const SIGNALS=[
  {id:'E2', x:-248,t:1,face:-1,kind:'entrada',side:'Miranda',pk:'402,929',protects:'Paso a nivel y diagonal 2–4'},
  {id:'E4', x:-248,t:2,face:-1,kind:'entrada',side:'Miranda',pk:'402,929',protects:'Paso a nivel, diagonal 2–4 y aguja 6'},
  {id:'E3', x:248, t:1,face:1, kind:'entrada',side:'Burgos',pk:'401,470',protects:'Diagonal 1–3'},
  {id:'E1', x:248, t:2,face:1, kind:'entrada',side:'Burgos',pk:'401,470',protects:'Diagonal 1–3 y aguja 5'},
  {id:'S1/2',x:-140,t:1,face:1, kind:'salida',side:'Miranda',pk:'402,546'},
  {id:'S1/1',x:-105,t:2,face:1, kind:'salida',side:'Miranda',pk:'402,476',lbl:'in'},
  {id:'S1/3',x:-110,t:3,face:1, kind:'salida',side:'Miranda',pk:'402,492'},
  {id:'S2/2',x:140, t:1,face:-1,kind:'salida',side:'Burgos',pk:'401,84 (en la tabla del plano, 401,481)'},
  {id:'S2/1',x:85,  t:2,face:-1,kind:'salida',side:'Burgos',pk:'401,911'},
  {id:'S2/3',x:131.5,t:3,face:-1,kind:'salida',side:'Burgos',pk:'401,905',szOut:2.2},   // ya en la curva hacia la aguja 5, junto al poste de catenaria, por fuera
  {id:'S2/3A',x:28, t:3,face:-1,kind:'intermedia',side:'Burgos',pk:'402,029',aux:true,y0:PH,protects:'Aguja 7'},
  {id:'S2/5',x:28,  t:5,face:-1,kind:'salida',side:'Burgos',pk:'402,027',aux:true,protects:'Aguja 7'},
  /* señales de retroceso (bajas): entre la señal de entrada y las primeras agujas, mirando hacia la estación. Ordenan el
     retroceso a la estación de un tren que ha salido por esa vía y tiene que volver; a los que entran por ella les hacen de
     indicadora de entrada y abren con su itinerario. Si el itinerario no tiene comprobación (aguja sin comprobación,
     circuito de vía que marca ocupado) se quedan en parada como la entrada y también hay que autorizar su rebase. */
  {id:'R1', x:212, t:1,face:1, kind:'retroceso',side:'Burgos',pk:'401,720',aux:true,protects:'Diagonal 1–3'},
  {id:'R2', x:-212,t:1,face:-1,kind:'retroceso',side:'Miranda',pk:'402,679',aux:true,protects:'Diagonal 2–4'},
  {id:'R4', x:-212,t:2,face:-1,kind:'retroceso',side:'Miranda',pk:'402,679',aux:true,protects:'Diagonal 2–4 y aguja 6'}
];
SIGNALS.forEach(s=>{s.aspect='parada';s.sz=({1:-2.4,2:6.6,3:11.5,5:20.5})[s.t];s.low=(s.t>=3||s.kind==='retroceso');
  if(s.szOut){const p=TRACKS['v'+s.t].pts;let i=1;while(i<p.length-1&&s.x>p[i][0])i++;s.sz=p[i-1][1]+(p[i][1]-p[i-1][1])*(s.x-p[i-1][0])/((p[i][0]-p[i-1][0])||1)+s.szOut;}});
const PN={x:-228,down:false,anim:0};
/* grafo de vías para la búsqueda de itinerarios: agujas que se toman de punta en cada vía, por dónde empalma cada
   extremo, longitudes útiles (entre señales de salida, o de la S2/5 a la topera), vías con andén y la topera */
const DIV={v3:1,v5:1,dw:1,de:1};
const LU={v1:280,v2:190,v3:216,v5:172};
const FACING={
  v1:[{x:-196,dir:1,br:'dw',u:'A24'},{x:196,dir:-1,br:'de',u:'A13'}],
  v2:[{x:-170,dir:-1,br:'dw',u:'A24'},{x:-152,dir:1,br:'v3',u:'A6'},{x:152,dir:-1,br:'v3',u:'A5'},{x:170,dir:1,br:'de',u:'A13'}],
  v3:[{x:60,dir:-1,br:'v5',u:'A7'}],v5:[],dw:[],de:[]};
const ENDS={v3:{w:['v2','A6'],e:['v2','A5']},v5:{e:['v3','A7']},dw:{w:['v1','A24'],e:['v2','A24']},de:{w:['v2','A13'],e:['v1','A13']}};
const VNUM={v1:2,v2:1,v3:3,v5:5};             // número de cada vía en el plano
const PLAT={v1:'1',v2:'2',v3:'2'};            // andén de cada vía
const TOPE={v5:{x:-152,dir:-1}};               // la vía 5 acaba en topera hacia Miranda
/* la vía 5 solo se deja en retroceso: el tren recula hasta la vía 3 hasta dejar libre la aguja 7 (cabeza en x) y luego
   sale por la S1/3 hacia Miranda */
const RETRO={v5:{to:'v3',x:72,sig:'S2/5',max:244}};
return{TZ,PH,TRACKS,SWITCHES,SIGNALS,PN,DIV,LU,FACING,ENDS,VNUM,PLAT,TOPE,RETRO};};

/* ---- plano · plano del pueblo: calles, caminos, plaza, casas, naves y árboles ---- */
NIVEL.plano=function(){
const occupied=[];
function free(x0,z0,x1,z1){for(const b of occupied){if(x0<b[2]&&x1>b[0]&&z0<b[3]&&z1>b[1])return false;}return true;}
function occupy(x0,z0,x1,z1){occupied.push([x0,z0,x1,z1]);}
const ROADS={
  camino:{w:6,col:'#C9B58C',pts:[[-2,-34],[-4,-48],[-6,-62],[-6,-80]]},
  real:{w:6.5,col:'#C6B48C',pts:[[-122,-80],[78,-80]]},
  iglesia:{w:5,col:'#C6B48C',pts:[[-6,-80],[-6,-132]]},
  arriba:{w:4.6,col:'#C3B089',pts:[[-82,-120],[42,-120]]},
  pn:{w:6.5,col:'#8C8984',asphalt:true,pts:[[-122,-80],[-168,-64],[-212,-36],[-228,-14],[-228,18],[-224,38],[-206,58]]},
  este:{w:6.5,col:'#8C8984',asphalt:true,pts:[[78,-80],[150,-88],[262,-100],[442,-122]]}
};
/* field tracks out of the village: from the ends of the upper streets to the fields and the hills */
const CAMINOS=[
  {w:3.4,pts:[[-82,-120],[-93,-121.5],[-106,-126],[-121,-133],[-140,-141],[-162,-151],[-186,-166],[-206,-182],[-218,-201]]},
  {w:3.4,pts:[[42,-120],[51,-117],[62,-115.5],[78,-117],[96,-122],[118,-130],[142,-142],[166,-160],[182,-178],[190,-201]]},
  {w:3.2,pts:[[-6,-132],[-7,-142],[-5,-154],[0,-168],[4,-184],[5,-201]]}];
/* roads off the board: from the junction before the level crossing to Quintanavides (west edge), and past the
   crossing, to Santa María del Invierno (south edge) */
const ROADS2={oeste:[[-212,-36],[-236,-40],[-262,-46],[-300,-53],[-442,-74]],sur:[[-224,38],[-234,58],[-240,82]]};
/* the through road is one asphalt ribbon: the Calle Real is its travesía */
const ASF_THRU=ROADS.pn.pts.slice().reverse().concat(ROADS.real.pts.slice(1),ROADS.este.pts.slice(1));
const PLZ={x0:-22,x1:4,z0:-110,z1:-83.4,fx:-10,fz:-97},PLZ_TREES=[[0.8,-90.5],[0.8,-97],[0.8,-103.5]];
const AYTO={x0:-23,x1:-15,z0:-106,z1:-90};
const SQ={x0:-46,x1:42,z0:-40,acera:-24,z1:-20};                     // station square
const PK={x0:14,bay:2.5,n:8,rowS:[-29,-24],rowN:[-39.5,-34.5]};       // car park: two rows of bays, aisle between
function nearRoad(x,z,m){for(const k in ROADS){if(distPoly(x,z,ROADS[k].pts)<ROADS[k].w/2+m)return true;}return false;}

// reserved areas
occupy(-24,-112,6,-82);      // plaza mayor
occupy(4,-116,48,-94);       // church + yard
occupy(-45,-40,40,-8);       // station square + building
occupy(-130,-83.3,82,-76.7); occupy(-8.6,-134,-3.4,-34); occupy(-86,-122.4,46,-117.6);

const HOUSES=[];
function addHouse(x0,z0,x1,z1,front){
  const floors=rnd()<0.55?2:1;
  HOUSES.push({x0:x0,z0:z0,x1:x1,z1:z1,front:front,floors:floors,wall:pick(WALLS),roof:pick(ROOF),rise:rr(1.5,2.3)});
  occupy(x0-0.7,z0-0.7,x1+0.7,z1+0.7);
}
function streetX(z,half,xa,xb,side){
  let x=xa+rr(0,3);
  while(x<xb-6){const w=rr(7,12),d=rr(8,11);let z0,z1;
    if(side<0){z1=z-half-0.6;z0=z1-d;}else{z0=z+half+0.6;z1=z0+d;}
    if(x+w<=xb&&free(x,z0,x+w,z1))addHouse(x,z0,x+w,z1,side<0?'s':'n');
    x+=w+(rnd()<0.22?rr(5,10):rr(0.2,1.0));}
}
function streetZ(x,half,za,zb,side){
  let z=za+rr(0,3);
  while(z<zb-6){const w=rr(7,11),d=rr(8,10.5);let x0,x1;
    if(side<0){x1=x-half-0.6;x0=x1-d;}else{x0=x+half+0.6;x1=x0+d;}
    if(z+w<=zb&&free(x0,z,x1,z+w))addHouse(x0,z,x1,z+w,side<0?'e':'w');
    z+=w+(rnd()<0.22?rr(5,10):rr(0.2,1.0));}
}
streetX(-80,3.25,-118,76,-1); streetX(-80,3.25,-118,76,1);
streetZ(-6,2.5,-132,-86,-1); streetZ(-6,2.5,-132,-86,1);
streetZ(-6,2.5,-76,-50,-1); streetZ(-6,2.5,-76,-50,1);
streetX(-120,2.3,-80,40,-1); streetX(-120,2.3,-80,40,1);
// a few loose houses and farm sheds on the edges
[[-104,-62,10,9,'n'],[52,-60,9,8,'n'],[66,-100,11,9,'w'],[-112,-104,10,8,'e'],[-58,-134,9,8,'s']].forEach(h=>{
  if(free(h[0],h[1],h[0]+h[2],h[1]+h[3]))addHouse(h[0],h[1],h[0]+h[2],h[1]+h[3],h[4]);});
const SHEDS=[{x0:-70,z0:-66,x1:-48,z1:-54,roof:M.rojo,wall:M.nave},{x0:84,z0:-74,x1:106,z1:-62,roof:M.chapa,wall:M.cal2}];
SHEDS.forEach(s=>occupy(s.x0-1,s.z0-1,s.x1+1,s.z1+1));
const FARM={x:-200,z:64};
occupy(FARM.x-18,FARM.z-10,FARM.x+20,FARM.z+14);
const TENADA={x0:-272,x1:-254,z0:58,z1:68,z2:78};   // the sheepfold west of the farm: the shed and its walled yard


/* trees */
const TREES=[];  // {x,z,r,kind}
(function(){
  let n=0;
  for(let i=0;i<5200&&n<720;i++){
    const x=rr(OX0+4,OX1-4),z=rr(Z0+4,-112);
    const p=fbm(x*0.028+1,z*0.028+8);
    if(p<0.44||rnd()>0.78)continue;
    if(!free(x-2,z-2,x+2,z+2)||nearRoad(x,z,2))continue;
    TREES.push({x:x,z:z,r:rr(1.9,3.5),k:'encina'});n++;
  }
  // scattered encinas in the open fields and slopes
  for(let i=0;i<500&&n<800;i++){
    const x=rr(OX0+6,OX1-6),z=rr(-110,76);
    if(z>-44&&z<34)continue;
    if(z<-36&&x>-132&&x<92)continue;
    if(!free(x-3,z-3,x+3,z+3)||nearRoad(x,z,3))continue;
    if(rnd()<0.10){TREES.push({x:x,z:z,r:rr(2.6,4.2),k:'encina'});n++;}
  }
  // poplars along the eastern road (the part on the widened board, with its own generator)
  const p=ROADS.este.pts,W2=mulberry(5309),w2=(a,b)=>a+(b-a)*W2();
  for(let s=1;s<p.length;s++){const a=p[s-1],b=p[s];const L=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const nx=-(b[1]-a[1])/L,nz=(b[0]-a[0])/L;
    for(let d=6;d<L-3;d+=7.5){const t=d/L;TREES.push({x:a[0]+(b[0]-a[0])*t-nx*6,z:a[1]+(b[1]-a[1])*t-nz*6,r:s<3?rr(1.3,1.7):w2(1.3,1.7),k:'chopo'});}}
  // the strips the board gained at both ends: encinas on the hills and a few in the fields
  [[X0+4,OX0],[OX1,X1-4]].forEach(([xa,xb])=>{let m=0;
    for(let i=0;i<4000&&m<Math.round(720*(xb-xa)/(OX1-OX0));i++){const x=w2(xa,xb),z=w2(Z0+4,-112);const pf=fbm(x*0.028+1,z*0.028+8);
      if(pf<0.44||W2()>0.78)continue;if(!free(x-2,z-2,x+2,z+2)||nearRoad(x,z,2))continue;TREES.push({x:x,z:z,r:w2(1.9,3.5),k:'encina'});m++;}
    for(let i=0;i<Math.round(500*(xb-xa)/(OX1-OX0));i++){const x=w2(xa,xb),z=w2(-110,76);if(z>-44&&z<34)continue;
      if(!free(x-3,z-3,x+3,z+3)||nearRoad(x,z,3))continue;if(W2()<0.10)TREES.push({x:x,z:z,r:w2(2.6,4.2),k:'encina'});}});
  // plane trees in the station square
  [[-41,-37],[-30,-27.5],[38.25,-37.5],[38.25,-26.5]].forEach(q=>TREES.push({x:q[0],z:q[1],r:3.2,k:'platano'}));
  // a few around the farm and along the PN road
  [[-178,52],[-172,73],[-230,-40],[-238,-56],[-150,-70]].forEach(q=>TREES.push({x:q[0],z:q[1],r:3,k:'encina'}));
})();

for(let i=TREES.length-1;i>=0;i--){const t=TREES[i];if(CAMINOS.some(c=>distPoly(t.x,t.z,c.pts)<c.w/2+Math.min(t.r,2.6))||Object.values(ROADS).some(r=>distPoly(t.x,t.z,r.pts)<r.w/2+Math.min(t.r,2.6)*0.8)||Object.values(ROADS2).some(p=>distPoly(t.x,t.z,p)<3.2+Math.min(t.r,2.6)))TREES.splice(i,1);}

for(let i=TREES.length-1;i>=0;i--){const t=TREES[i];if(t.x>TENADA.x0-2-t.r&&t.x<TENADA.x1+2+t.r&&t.z>TENADA.z0-2-t.r&&t.z<TENADA.z2+2+t.r)TREES.splice(i,1);}
NIVEL.TENADA=TENADA;
return{ROADS,CAMINOS,ROADS2,ASF_THRU,PLZ,PLZ_TREES,AYTO,SQ,PK,HOUSES,SHEDS,FARM,TREES,isFree:free};};

/* what a field shows in month m (0 = January) of year y: in its cereal year it is ploughed and sown in October, comes up
   in November (the late ones in December), grows green through the spring, heads in June, is ripe and cut in July and
   left in stubble (with the bales) in August and September; in its barbecho year the stubble stays until February and
   the field is ploughed in March and kept tilled until it is sown again */
NIVEL.fieldState=function(f,m,y){const ay=y+(m>=9?1:0),cer=(ay+f.rot)%2===0;
  if(cer)return m===9?'arado':m===10?(f.late?'sembrado':'verde'):m===11?(f.late?'sembrado':'verde'):m<=4?'verde':m===5?'espigado':m===6?'maduro':'rastrojo';
  return(m>=9||m<=1)?'rastrojo':'arado';};
NIVEL.fieldFresh=(f,m,y)=>(m===7||m===8)&&((y+f.rot)%2===0);   // stubble of this summer's harvest (the bales are still out)
/* ---- suelo · campos y suelo pintado de la maqueta ---- */
NIVEL.suelo=function(){
/* the fields go "año y vez": cereal one agricultural year (October to September), barbecho the next. rot says which
   half of the rotation each one is in; late, the ones sown last (in November). What each shows in a month is
   NIVEL.fieldState, and the board is painted for the day of the game */
const FIELDS=[
  {poly:[[-435,34],[-122,34],[-122,78],[-435,78]],rot:0,ang:0},
  {poly:[[-116,34],[-8,34],[-8,78],[-116,78]],rot:1,late:1,ang:0},
  {poly:[[-2,34],[122,34],[122,78],[-2,78]],rot:0,ang:0.5},
  {poly:[[128,34],[435,34],[435,78],[128,78]],rot:1,ang:0},
  {poly:[[-435,-104],[-138,-104],[-150,-74],[-196,-48],[-435,-30]],rot:0,ang:-0.4},
  {poly:[[96,-94],[435,-118],[435,-30],[96,-40]],rot:1,late:1,ang:0.12},
  {poly:[[-435,-26],[-214,-44],[-176,-60],[-132,-70],[-128,-44],[-435,-14]],rot:1,ang:-0.2},
  {poly:[[150,-30],[435,-30],[435,-12],[150,-12]],rot:0,ang:0}
];
{const d=new Date();FIELDS.forEach(f=>f.kind=NIVEL.fieldState(f,d.getMonth(),d.getFullYear()));}
/* ---- man-made ground (roads, tracks, plaza mayor, station square), painted the same way on the board texture
   (4 px/m) and on the close-up texture of the village (12 px/m) so the two match where they meet ---- */
function paintMan(c,S,ox,oz,W,H){
  const X=x=>(x-ox)*S,Z=z=>(z-oz)*S;let sd=24601;const R=()=>(sd=sd*16807%2147483647)/2147483647;
  const o=document.createElement('canvas');o.width=W;o.height=H;const q=o.getContext('2d');
  const path=(g,P)=>{g.beginPath();P.forEach((p,i)=>i?g.lineTo(X(p[0]),Z(p[1])):g.moveTo(X(p[0]),Z(p[1])));};
  const line=(g,P,w,col,dash,cap)=>{if(typeof dash==='string'){cap=dash;dash=null;}g.lineCap=cap||'round';g.lineJoin='round';g.strokeStyle=col;g.lineWidth=Math.max(w*S,0.7);g.setLineDash(dash?dash.map(v=>v*S):[]);path(g,P);g.stroke();g.setLineDash([]);};
  const box=(g,x0,z0,x1,z1,col,r)=>{g.fillStyle=col;g.beginPath();if(r&&g.roundRect)g.roundRect(X(x0),Z(z0),(x1-x0)*S,(z1-z0)*S,r*S);else g.rect(X(x0),Z(z0),(x1-x0)*S,(z1-z0)*S);g.fill();};
  const off=(P,d)=>P.map((p,i)=>{const a=P[Math.max(0,i-1)],b=P[Math.min(P.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return[p[0]-(b[1]-a[1])/l*d,p[1]+(b[0]-a[0])/l*d];});
  const trim=(P,d0)=>{let L=0;for(let i=1;i<P.length;i++){const l=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);if(L+l>d0){const t=(d0-L)/l;return[[P[i-1][0]+(P[i][0]-P[i-1][0])*t,P[i-1][1]+(P[i][1]-P[i-1][1])*t]].concat(P.slice(i));}L+=l;}return P.slice(-1);};
  const dot=(g,x,z,s,col)=>{g.fillStyle=col;const p=Math.max(s*S,1);g.fillRect(X(x)-p/2,Z(z)-p/2,p,p);};
  const pick=a=>a[(R()*a.length)|0];
  // grain scattered along a polyline (within its width) or over a box
  const grainL=(g,P,w,dens,cols,s0,s1)=>{for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1])||1,nx=-(b[1]-a[1])/L,nz=(b[0]-a[0])/L,N=Math.round(L*w*dens);
    for(let k=0;k<N;k++){const t=R(),u=(R()-0.5)*w;dot(g,a[0]+(b[0]-a[0])*t+nx*u,a[1]+(b[1]-a[1])*t+nz*u,s0+(s1-s0)*R(),pick(cols));}}};
  const grainB=(g,x0,z0,x1,z1,dens,cols,s0,s1)=>{const N=Math.round((x1-x0)*(z1-z0)*dens);for(let k=0;k<N;k++)dot(g,x0+(x1-x0)*R(),z0+(z1-z0)*R(),s0+(s1-s0)*R(),pick(cols));};
  // a surface laid in a shape: the shape goes on a scratch sheet, its texture is sprinkled only inside it, then it is stamped down
  const lay=(shape,tex,a)=>{q.globalCompositeOperation='source-over';q.clearRect(0,0,W,H);shape(q);q.globalCompositeOperation='source-atop';if(tex)tex(q);
    q.globalCompositeOperation='source-over';c.globalAlpha=a||1;c.drawImage(o,0,0);c.globalAlpha=1;};
  // rounded corner where a side road opens into another: corner (cx,cz), the open quadrant towards (sx,sz)
  const fil=(g,cx,cz,sx,sz,r,col)=>{g.fillStyle=col;g.beginPath();g.moveTo(X(cx+sx*r),Z(cz));g.lineTo(X(cx),Z(cz));g.lineTo(X(cx),Z(cz+sz*r));g.quadraticCurveTo(X(cx),Z(cz),X(cx+sx*r),Z(cz));g.fill();};

  /* field tracks: two wheel ruts and grass down the middle, out to the fields and the hills */
  const TRK='#BCA67C';
  CAMINOS.forEach(cm=>{const P=cm.pts,w=cm.w;
    line(c,P,w+1.8,'rgba(140,124,86,.2)');
    lay(g=>line(g,P,w,TRK),g=>{
      grainL(g,P,w,1.5,['rgba(224,208,172,.6)','rgba(138,118,86,.45)','rgba(170,150,112,.5)'],0.12,0.35);
      [-1,1].forEach(s=>line(g,off(P,s*0.78),0.62,'rgba(128,108,78,.5)'));
      line(g,trim(P,6),0.6,'rgba(122,128,72,.6)');grainL(g,trim(P,6),0.7,3,['rgba(104,116,58,.65)','rgba(150,150,88,.55)'],0.12,0.32);});
  });
  /* earth streets of the upper village */
  const DRT='#C7B48B',dirt=['arriba','iglesia'];
  dirt.forEach(k=>{const P=ROADS[k].pts,w=ROADS[k].w;line(c,P,w+1.5,'rgba(150,132,96,.28)');line(c,P,w+0.6,'rgba(186,168,128,.75)');});
  lay(g=>{dirt.forEach(k=>line(g,ROADS[k].pts,ROADS[k].w,DRT));
    // the corners of the crossing at the top of Calle de la Iglesia
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([sx,sz])=>fil(g,-6+sx*2.5,-120+sz*2.3,sx,sz,2.2,DRT));
    // and where the tracks leave the streets
    [['arriba',0],['arriba',1],['iglesia',1]].forEach(([k,e],i)=>{const R0=ROADS[k],a=e?R0.pts[R0.pts.length-1]:R0.pts[0],cm=CAMINOS.find(c=>c.pts[0][0]===a[0]&&c.pts[0][1]===a[1]);if(!cm)return;
      const b=cm.pts[1],L=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/L,nz=(b[0]-a[0])/L,h0=R0.w/2,h1=cm.w/2+0.3;   // the street narrows into the track
      g.fillStyle=DRT;g.beginPath();g.moveTo(X(a[0]+nx*h0),Z(a[1]+nz*h0));g.lineTo(X(b[0]+nx*h1),Z(b[1]+nz*h1));g.lineTo(X(b[0]-nx*h1),Z(b[1]-nz*h1));g.lineTo(X(a[0]-nx*h0),Z(a[1]-nz*h0));g.fill();});},
   g=>{dirt.forEach(k=>{const P=ROADS[k].pts,w=ROADS[k].w;grainL(g,P,w,1.4,['rgba(226,212,178,.55)','rgba(146,126,92,.4)','rgba(176,156,118,.45)'],0.12,0.4);
      [-1,1].forEach(s=>line(g,off(P,s*1.0),0.8,'rgba(150,128,94,.26)'));});});

  /* asphalt: the through road (with the Calle Real as its travesía), the station road and the station forecourt, all one surface */
  const CAM=ROADS.camino.pts,CW=5.2,ASF='#6E6C68',sq=SQ;
  line(c,ASF_THRU,8.0,'rgba(158,148,126,.5)');                  // earth shoulder
  Object.values(ROADS2).forEach(p=>line(c,p,7.6,'rgba(158,148,126,.5)'));
  line(c,ROADS.real.pts,7.5,'#BEB7A7',null,'butt');               // concrete gutter through the village
  line(c,CAM,CW+1.1,'rgba(158,148,126,.5)');
  const mouth=[[-8.6,-76.75,-1,1],[-3.4,-76.75,1,1],[-5.5,sq.z0,-1,-1],[-0.2,sq.z0,1,-1]];
  lay(g=>{line(g,ASF_THRU,6.5,ASF);Object.values(ROADS2).forEach(p=>line(g,p,6.2,ASF));line(g,CAM,CW,ASF);box(g,-25,sq.z0,sq.x1,sq.acera,ASF,2.5);
    mouth.forEach(m=>fil(g,m[0],m[1],m[2],m[3],3,ASF));},
   g=>{const ag=['rgba(160,158,150,.28)','rgba(140,138,132,.3)','rgba(62,61,59,.3)','rgba(186,182,172,.22)'];
    grainL(g,ASF_THRU,6.5,3,ag,0.1,0.25);Object.values(ROADS2).forEach(p=>grainL(g,p,6.2,3,ag,0.1,0.25));grainL(g,CAM,CW,3,ag,0.1,0.25);grainB(g,-25,sq.z0,sq.x1,sq.acera,3,ag,0.1,0.25);
    // patched potholes and trench repairs
    [[ASF_THRU,6.5,0.03],[CAM,CW,0.04]].forEach(([P,w,n])=>{for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);
      for(let k=0;k<Math.round(L*n);k++){const t=R(),u=(R()-0.5)*(w-2),x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t+u,sx=0.8+R()*2.2,sz=0.6+R()*1.4;
        box(g,x-sx/2,z-sz/2,x+sx/2,z+sz/2,R()<0.6?'rgba(84,82,79,.55)':'rgba(128,126,120,.4)');}}});
    // wheel tracks polished darker
    [-1.65,1.65].forEach(d=>line(g,off(ASF_THRU,d),1.2,'rgba(92,90,87,.22)'));});
  // centre and edge lines on the open road only (from the village signs out)
  // (the centre and edge lines of the open road are 3D strips: NIVEL.vegetacion, «marcas viales»)
  // give-way line where the station road meets the Calle Real
  line(c,[[-8.3,-77.1],[-3.7,-77.1]],0.3,'rgba(238,234,222,.85)',[0.5,0.5],'butt');

  /* plaza mayor: setts, a granite border, a ring of slabs round the fountain and stone-framed tree pits */
  const P=PLZ;
  lay(g=>box(g,P.x0,P.z0,P.x1,P.z1,'#CDBFA0',0.5),g=>{
    for(let z=P.z0,r=0;z<P.z1;z+=0.42,r++){for(let x=P.x0-(r%2)*0.3;x<P.x1;x+=0.6){g.fillStyle=R()<0.5?'rgba(150,136,108,.32)':'rgba(232,222,198,.38)';
      g.fillRect(X(x)+0.6,Z(z)+0.6,Math.max(0.6*S-1.2,0.6),Math.max(0.42*S-1.2,0.6));}}
    g.strokeStyle='#A99A7B';g.lineWidth=1.2*S;g.strokeRect(X(P.x0+0.6),Z(P.z0+0.6),(P.x1-P.x0-1.2)*S,(P.z1-P.z0-1.2)*S);
    for(let x=P.x0;x<P.x1;x+=1.1){line(g,[[x,P.z0],[x,P.z0+1.2]],0.05,'rgba(80,70,55,.4)','butt');line(g,[[x,P.z1-1.2],[x,P.z1]],0.05,'rgba(80,70,55,.4)','butt');}
    for(let z=P.z0;z<P.z1;z+=1.1){line(g,[[P.x0,z],[P.x0+1.2,z]],0.05,'rgba(80,70,55,.4)','butt');line(g,[[P.x1-1.2,z],[P.x1,z]],0.05,'rgba(80,70,55,.4)','butt');}
    g.strokeStyle='#B5A685';g.lineWidth=1.3*S;g.beginPath();g.arc(X(P.fx),Z(P.fz),4.0*S,0,TAU);g.stroke();
    g.strokeStyle='rgba(80,70,55,.35)';g.lineWidth=Math.max(0.05*S,0.6);for(let a=0;a<TAU;a+=TAU/28){g.beginPath();g.moveTo(X(P.fx+Math.cos(a)*3.35),Z(P.fz+Math.sin(a)*3.35));g.lineTo(X(P.fx+Math.cos(a)*4.65),Z(P.fz+Math.sin(a)*4.65));g.stroke();}
    // a granite strip marks the way across, where the street runs through
    line(g,[[-6,P.z0],[-6,P.z1]],1.1,'rgba(176,164,138,.55)','butt');
    PLZ_TREES.forEach(t=>{box(g,t[0]-0.85,t[1]-0.85,t[0]+0.85,t[1]+0.85,'#9E907A');box(g,t[0]-0.65,t[1]-0.65,t[0]+0.65,t[1]+0.65,'#6F5A41');grainB(g,t[0]-0.65,t[1]-0.65,t[0]+0.65,t[1]+0.65,30,['rgba(140,110,80,.6)','rgba(60,48,34,.5)'],0.05,0.15);});});
  line(c,[[P.x0,P.z1],[P.x1,P.z1]],0.25,'#E0D8C6','butt');            // kerb against the Calle Real

  /* station square: pavement along the building, a small garden, the forecourt (asphalt, above) and the car park */
  lay(g=>box(g,sq.x0,sq.acera,sq.x1,sq.z1+0.8,'#CEC7B6'),g=>{for(let x=sq.x0;x<sq.x1;x+=1)line(g,[[x,sq.acera],[x,sq.z1+0.8]],0.04,'rgba(110,100,88,.3)','butt');
    for(let z=sq.acera;z<sq.z1+0.8;z+=1)line(g,[[sq.x0,z],[sq.x1,z]],0.04,'rgba(110,100,88,.3)','butt');grainB(g,sq.x0,sq.acera,sq.x1,sq.z1+0.8,2,['rgba(150,140,124,.35)','rgba(230,226,214,.4)'],0.1,0.3);});
  lay(g=>box(g,sq.x0,sq.z0,-25,sq.acera,'#A8A26E',1),g=>{grainB(g,sq.x0,sq.z0,-25,sq.acera,6,['rgba(120,128,70,.55)','rgba(170,160,110,.5)','rgba(140,120,84,.4)','rgba(96,108,56,.5)'],0.15,0.5);
    line(g,[[sq.x0,-32],[-25,-32]],1.6,'#CDBB92','butt');line(g,[[-35.5,sq.z0],[-35.5,sq.acera]],1.6,'#CDBB92','butt');
    grainL(g,[[sq.x0,-32],[-25,-32]],1.6,5,['rgba(230,218,190,.6)','rgba(150,130,96,.5)'],0.08,0.2);grainL(g,[[-35.5,sq.z0],[-35.5,sq.acera]],1.6,5,['rgba(230,218,190,.6)','rgba(150,130,96,.5)'],0.08,0.2);});
  lay(g=>box(g,35,sq.z0+0.5,41.5,sq.acera-0.5,'#A3A26C',1.2),g=>grainB(g,35,sq.z0,41.5,sq.acera,6,['rgba(118,126,68,.55)','rgba(170,160,110,.5)'],0.15,0.5));
  const PL='rgba(242,240,232,.92)';
  for(let k=0;k<=PK.n;k++){const x=PK.x0+k*PK.bay;line(c,[[x,PK.rowS[0]],[x,PK.rowS[1]-0.3]],0.12,PL,null,'butt');line(c,[[x,PK.rowN[0]+0.1],[x,PK.rowN[1]]],0.12,PL,null,'butt');}
  [PK.rowS[0],PK.rowN[1]].forEach(z=>line(c,[[PK.x0,z],[PK.x0+PK.n*PK.bay,z]],0.12,PL,[0.6,0.6],'butt'));
  // oil stains in the bays
  for(let k=0;k<PK.n*2;k++){const x=PK.x0+(k%PK.n+0.5)*PK.bay,z=k<PK.n?-26.6:-36.9;if(R()<0.7){c.fillStyle='rgba(50,48,46,.22)';c.beginPath();c.ellipse(X(x),Z(z),0.6*S,0.9*S,0,0,TAU);c.fill();}}
  line(c,[[sq.x0,sq.acera],[sq.x1,sq.acera]],0.28,'#E2DBCB','butt');
  line(c,[[-25,sq.z0],[-25,sq.acera]],0.28,'#E2DBCB','butt');line(c,[[sq.x0,sq.z0],[-25,sq.z0]],0.28,'#E2DBCB','butt');
}
/* soft dark spots under the trees (baked occlusion) */
function treeShade(c,S,ox,oz,keep){
  TREES.forEach(t=>{if(keep&&!keep(t))return;const x=(t.x-ox)*S,z=(t.z-oz)*S,r=t.r*S*1.3;const gr=c.createRadialGradient(x,z,0,x,z,r);
    gr.addColorStop(0,'rgba(50,48,30,.38)');gr.addColorStop(1,'rgba(50,48,30,0)');c.fillStyle=gr;c.fillRect(x-r*1.08,z-r*1.08,r*2.16,r*2.16);});
}
const VD={x0:-132,x1:92,z0:-144,z1:-4};   // the village close-up: on the 4 m terrain grid
const groundTex=canvasTex(BW*GS,BD*GS,(c,w,h)=>{
  c.fillStyle='#B6A673';c.fillRect(0,0,w,h);
  for(let i=0;i<Math.round(14000*BW/520);i++){c.fillStyle=pick(['rgba(150,135,92,.45)','rgba(198,182,132,.5)','rgba(140,128,86,.35)','rgba(176,160,110,.4)']);
    const s=rr(2,6);c.beginPath();c.arc(rr(0,w),rr(0,h),s*0.62,0,TAU);c.fill();}   // soft round dabs (squares showed as blocks up close)
  // hills: darker, scrubbier
  let g=c.createLinearGradient(0,GZ(-200),0,GZ(-100));
  g.addColorStop(0,'rgba(124,108,72,.95)');g.addColorStop(1,'rgba(124,108,72,0)');
  c.fillStyle=g;c.fillRect(0,GZ(-200),w,GZ(-100)-GZ(-200));
  for(let i=0;i<9000;i++){const x=rr(OX0,OX1),z=rr(Z0,-100);const a=(-z-100)/100;
    c.fillStyle='rgba(80,84,52,'+(0.12+0.35*a).toFixed(2)+')';c.beginPath();c.arc(GX(x),GZ(z),rr(1.5,5),0,TAU);c.fill();}
  {const W3=mulberry(7717),w3=(a,b)=>a+(b-a)*W3();[[X0,OX0],[OX1,X1]].forEach(([xa,xb])=>{for(let i=0;i<Math.round(9000*(xb-xa)/(OX1-OX0));i++){const x=w3(xa,xb),z=w3(Z0,-100);const a=(-z-100)/100;
    c.fillStyle='rgba(80,84,52,'+(0.12+0.35*a).toFixed(2)+')';c.beginPath();c.arc(GX(x),GZ(z),w3(1.5,5),0,TAU);c.fill();}});}
  // fields
  FIELDS.forEach(f=>{
    c.save();c.beginPath();f.poly.forEach((p,i)=>{const X=GX(p[0]),Y=GZ(p[1]);i?c.lineTo(X,Y):c.moveTo(X,Y);});c.closePath();c.clip();
    const base={rastrojo:'#D8BE7B',arado:'#8F6B4A',sembrado:'#7C5D42',verde:'#A3AE6A',espigado:'#A9AE62',maduro:'#D2B060'}[f.kind];
    const lineA={rastrojo:'rgba(242,222,160,.55)',arado:'rgba(110,80,54,.75)',sembrado:'rgba(96,70,48,.6)',verde:'rgba(132,150,82,.7)',espigado:'rgba(150,160,84,.6)',maduro:'rgba(232,204,128,.55)'}[f.kind];
    const lineB={rastrojo:'rgba(180,152,90,.35)',arado:'rgba(166,128,94,.45)',sembrado:'rgba(146,116,86,.35)',verde:'rgba(186,186,120,.35)',espigado:'rgba(190,186,110,.35)',maduro:'rgba(178,146,78,.4)'}[f.kind];
    c.fillStyle=base;c.fillRect(0,0,w,h);
    c.translate(GX(f.poly[0][0]),GZ(f.poly[0][1]));c.rotate(f.ang);
    for(let k=-1600;k<1600;k+=6){c.fillStyle=(k/6)%2?lineA:lineB;c.fillRect(-1600,k,3200,f.kind==='arado'?3:2);}
    c.restore();
    // margin (lindero)
    c.strokeStyle='rgba(150,138,96,.9)';c.lineWidth=7;c.beginPath();f.poly.forEach((p,i)=>{const X=GX(p[0]),Y=GZ(p[1]);i?c.lineTo(X,Y):c.moveTo(X,Y);});c.closePath();c.stroke();
  });
  // railway corridor: gravel
  c.fillStyle='#ABA394';c.fillRect(0,GZ(-4),w,GZ(24)-GZ(-4));
  c.fillStyle='rgba(120,112,100,.35)';for(let i=0;i<Math.round(3000*BW/520);i++){c.fillRect(rr(0,w),rr(GZ(-4),GZ(24)),2,2);}
  // building plot behind the station square
  c.fillStyle='#CFC6B4';c.fillRect(GX(-46),GZ(-20.5),GX(42)-GX(-46),GZ(-4)-GZ(-20.5));
  // muelle yard + farm yard
  c.fillStyle='#BDB4A2';c.fillRect(GX(-82),GZ(24),GX(16)-GX(-82),GZ(34)-GZ(24));
  c.fillStyle='#BFAF8C';c.fillRect(GX(FARM.x-22),GZ(FARM.z-12),44*GS,28*GS);{const T=NIVEL.TENADA;c.fillRect(GX(T.x0-2),GZ(T.z0-2),(T.x1-T.x0+4)*GS,(T.z2-T.z0+4)*GS);}
  // church yard
  c.fillStyle='#CBBE9C';c.fillRect(GX(6),GZ(-114),GX(46)-GX(6),GZ(-95)-GZ(-114));
  // house yards, then the streets over them
  HOUSES.forEach(hh=>{c.fillStyle='rgba(176,158,118,.85)';c.fillRect(GX(hh.x0-1.5),GZ(hh.z0-1.5),(hh.x1-hh.x0+3)*GS,(hh.z1-hh.z0+3)*GS);});
  paintMan(c,GS,X0,Z0,w,h);
  // soft dark spots under trees (those wholly inside the village close-up are drawn there, sharper)
  treeShade(c,GS,X0,Z0,t=>!(t.x-t.r*1.5>VD.x0&&t.x+t.r*1.5<VD.x1&&t.z-t.r*1.5>VD.z0&&t.z+t.r*1.5<VD.z1));
});
return{paintMan,treeShade,VD,groundTex,FIELDS};};

/* ---- placa · placa del marco de la maqueta ---- */
NIVEL.placa=function(){
const plaqueTex=canvasTex(1024,128,(c,w,h)=>{
  const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#D9B66A');g.addColorStop(.5,'#B98F3F');g.addColorStop(1,'#8F6C2A');
  c.fillStyle=g;c.fillRect(0,0,w,h);c.strokeStyle='rgba(60,40,10,.55)';c.lineWidth=5;c.strokeRect(8,8,w-16,h-16);
  c.fillStyle='#3B2A12';c.textAlign='center';c.textBaseline='middle';
  c.font='700 54px "Barlow Condensed","Arial Narrow",sans-serif';c.fillText('SANTA OLALLA  ·  NIVEL 1',w/2,52);
  c.font='500 24px "IBM Plex Mono",monospace';c.fillText('LÍNEA BURGOS – MIRANDA DE EBRO  ·  ESCALA H0 1:87',w/2,98);
});
return{plaqueTex};};

/* ---- estacion · andenes, edificio de viajeros, mobiliario, farolas y muelle ---- */
NIVEL.estacion=function(){
function platform(id,x0,x1,z0,z1,edges){
  sboxX(M.hormigon,x0,72,0,PH,z0,z1);
  const ang=Math.atan2(PH-0.8,8);
  put('box',M.hormigon,76,(PH+0.8)/2-1,(z0+z1)/2,Math.hypot(8,PH-0.8),2,z1-z0,0,0,-ang);
  edges.forEach(ez=>{
    const inner=ez>(z0+z1)/2?-1:1;
    sboxX(M.bordillo,x0,72,PH,PH+0.05,ez-(inner>0?0:0.6),ez+(inner>0?0.6:0),true);
    const lz=ez+inner*1.0;
    sboxX(M.amarillo,x0+0.5,71.5,PH,PH+0.055,lz-0.07,lz+0.07,true);
  });
}
platform('a1',-80,80,-10.7,-1.72,[-1.72]);
platform('a2',-80,80,6.02,11.98,[6.02,11.98]);
// escalerilla at the Miranda end of andén 1, by the railing: three concrete steps down to the track side (the agente de
// circulación goes down by it to the agujas and señales of that side)
for(let k=0;k<3;k++)sboxX(M.hormigon,-80.6-0.6*k,-80-0.6*k,0,PH*(3-k)/4,-10.3,-8.7);
ent('a1',{kind:'platform',name:'Andén 1',sub:'Lateral · da servicio a la vía 2',rows:[['Longitud','160 m (190 m en la realidad)'],['Anchura','8,7 m'],['Altura','550 mm sobre carril'],['Servicios','Edificio de viajeros, bancos, alumbrado']]});
ent('a2',{kind:'platform',name:'Andén 2',sub:'Central · vías 1 y 3',rows:[['Longitud','160 m (195 m en la realidad)'],['Anchura','6 m'],['Altura','550 mm sobre carril'],['Acceso','Paso entablonado, lado Burgos'],['Abrigo','Marquesina con banco']]});
hitBox('a1',0,0,-6.2,160,PH+0.2,8.9);bb('a1',-80,0,-10.7,80,PH,-1.72);
hitBox('a2',0,0,9,160,PH+0.2,5.96);bb('a2',-80,0,6.02,80,PH,11.98);
// planked crossing between the platforms (lado Burgos)
for(let k=0;k<9;k++){sboxX(k%2?M.madera:M.maderaClara,80+k*0.333,80.33+k*0.333,0.68,0.8,-1.72,6.02,true);}
ent('paso',{kind:'crossing',name:'Paso entre andenes',sub:'Entablonado a nivel · vías 2 y 1',rows:[['Uso','Viajeros, con precaución'],['Aviso','Prohibido cruzar con tren a la vista'],['Situación','Extremo lado Burgos']]});
hitBox('paso',81.5,0,2.15,3.4,1.2,7.8);bb('paso',80,0.6,-1.72,83,1.2,6.02);
[[78.6,-3.0],[78.6,7.4]].forEach(p=>{scyl(M.hierro,p[0],PH-0.55,p[1],0.05,2.3,true);sbox(M.blanco,p[0],PH+1.25,p[1],0.06,0.7,1.1);sbox(M.rojo,p[0]+0.035,PH+1.25,p[1],0.02,0.16,1.1,0,true);});

/* station building — after the stations of the Compañía del Norte (cal walls, granate trim, teja) */
const B={x0:-18,x1:6,z0:-20,z1:-10.6,top:PH+7.6, wx1:15, wz0:-20.4, wz1:-10.0, wtop:PH+8.8};
(function building(){
  const g=M.granate;
  // main body + wing
  sboxX(M.cal,B.x0,B.x1,0,B.top,B.z0,B.z1);
  sboxX(M.cal,B.x1,B.wx1,0,B.wtop,B.wz0,B.wz1);
  hip(ROOF[0],B.x0,B.x1,B.z0,B.z1,B.top,2.5,0.75);
  gable(ROOF[0],M.cal,B.x1,B.wx1,B.wz0,B.wz1,B.wtop,3.0,0.75,'x');
  // trim bands on all four sides of both bodies
  function bands(x0,x1,z0,z1,top,imp){
    const o=0.12;
    [[PH-0.05,PH+0.55],[imp,imp+0.34],[top-0.42,top]].forEach(b=>{
      sboxX(g,x0-o,x1+o,b[0],b[1],z1,z1+o,true); sboxX(g,x0-o,x1+o,b[0],b[1],z0-o,z0,true);
      sboxX(g,x0-o,x0,b[0],b[1],z0,z1,true); sboxX(g,x1,x1+o,b[0],b[1],z0,z1,true);});
    sboxX(g,x0-o,x0,0,PH,z0,z1,true);
    [[x0,z1],[x1,z1],[x0,z0],[x1,z0]].forEach(c=>sbox(g,c[0],PH,c[1],0.75,top-PH,0.75,0,true));
  }
  bands(B.x0,B.x1,B.z0,B.z1,B.top,PH+3.9);
  bands(B.x1,B.wx1,B.wz0,B.wz1,B.wtop,PH+4.3);
  // openings: frame (granate) + glass/door (dark) + white bars
  function opening(x,y0,zf,w,h,dir,kind){
    // dir: +1 facade faces +z, -1 faces -z, 'e' faces +x, 'w' faces -x
    const along=(dir==='e'||dir==='w');
    // lights: the gabinete de circulación is the west end of the ground floor (its two windows on the west wall and the
    // one on the track side: the only ones lit all night); the rest of the ground floor and the wing (vestíbulo, taquilla,
    // sala de espera) and the aseos of the annex are the sala de viajeros; the upper floor is the jefe de estación's home
    const ground=y0<PH+3,gab=ground&&(dir==='w'||(!along&&x>=B.x0&&x<B.x0+5));
    const wm=!ground?M.vViv:gab?(dir===-1?M.cristal:M.vA):M.vSala;
    const s=(dir===1||dir==='e')?1:-1;
    const fw=w+0.36,fh=h+0.3;
    const pz=zf+s*0.06;
    if(!along){
      sbox(g,x,y0-0.15,pz,fw,fh,0.12,0,true);
      sbox(kind==='door'?M.puerta:wm,x,y0,pz+s*0.04,w,h,0.1,0,true);
      if(kind!=='door'){sbox(M.blanco,x,y0,pz+s*0.08,0.07,h,0.04,0,true);sbox(M.blanco,x,y0+h*0.55,pz+s*0.08,w,0.07,0.04,0,true);}
      else{sbox(M.cristal,x,y0+h*0.62,pz+s*0.08,w*0.8,h*0.3,0.03,0,true);}
    }else{
      sbox(g,zf+s*0.06,y0-0.15,x,0.12,fh,fw,0,true);
      sbox(kind==='door'?M.puerta:wm,zf+s*0.1,y0,x,0.1,h,w,0,true);
      if(kind!=='door'){sbox(M.blanco,zf+s*0.14,y0,x,0.04,h,0.07,0,true);sbox(M.blanco,zf+s*0.14,y0+h*0.55,x,0.04,0.07,w,0,true);}
    }
  }
  const front=[[-14.6,'win'],[-10.6,'door'],[-6.0,'door'],[-1.6,'win'],[2.6,'door']];
  front.forEach(f=>{opening(f[0],f[1]==='door'?PH:PH+0.7,B.z1,f[1]==='door'?1.4:1.15,f[1]==='door'?2.75:2.1,1,f[1]);
    opening(f[0],PH+4.75,B.z1,1.05,1.85,1,'win');
    opening(f[0],f[1]==='door'&&f[0]===-6?0.2:PH+0.7,B.z0,1.15,f[1]==='door'&&f[0]===-6?2.7:2.1,-1,f[0]===-6?'door':'win');
    opening(f[0],PH+4.75,B.z0,1.05,1.85,-1,'win');});
  // wing: big ticket-hall window + upper window, track side; rear
  opening(10.5,PH+0.55,B.wz1,3.6,2.35,1,'win');
  for(let k=-3;k<=3;k++)sbox(M.hierro,10.5+k*0.5,PH+0.55,B.wz1+0.2,0.05,2.35,0.05,0,true);
  opening(10.5,PH+5.0,B.wz1,1.05,1.9,1,'win');
  opening(10.5,PH+0.7,B.wz0,1.15,2.1,-1,'win');opening(10.5,PH+5.0,B.wz0,1.05,1.9,-1,'win');
  // east gable end: window, oculus, name plate, AC unit
  opening(-16.2,PH+0.7,B.wx1,1.15,2.1,'e','win');opening(-14.2,PH+5.0,B.wx1,1.05,1.9,'e','win');
  // west end of main body
  opening(-17.4,PH+0.7,B.x0,1.15,2.1,'w','win');opening(-13.2,PH+0.7,B.x0,1.15,2.1,'w','win');
  opening(-17.4,PH+4.75,B.x0,1.05,1.85,'w','win');opening(-13.2,PH+4.75,B.x0,1.05,1.85,'w','win');
  put('cyl',g,B.wx1+0.07,B.wtop+1.0,-15.2,0.78,0.1,0.78,0,0,PI/2);
  put('cyl',M.cristal,B.wx1+0.12,B.wtop+1.0,-15.2,0.56,0.1,0.56,0,0,PI/2);
  sbox(M.blanco,B.wx1+0.35,PH+4.55,-12.4,0.55,0.62,0.95);
  sbox(M.galva,B.wx1+0.62,PH+4.62,-12.4,0.02,0.48,0.48,0,true);
  // eave brackets (canecillos)
  for(let x=B.x0-0.4;x<=B.x1+0.4;x+=0.9){sbox(M.granate,x,B.top-0.2,B.z1+0.42,0.17,0.2,0.62,0,true);sbox(M.granate,x,B.top-0.2,B.z0-0.42,0.17,0.2,0.62,0,true);}
  for(let x=B.x1-0.4;x<=B.wx1+0.4;x+=0.9){sbox(M.granate,x,B.wtop-0.2,B.wz1+0.42,0.17,0.2,0.62,0,true);sbox(M.granate,x,B.wtop-0.2,B.wz0-0.42,0.17,0.2,0.62,0,true);}
  // chimneys
  sbox(M.cal2,-11,B.top+0.8,-15.6,0.9,2.6,0.9);sbox(M.granate,-11,B.top+3.4,-15.6,1.1,0.25,1.1);
  sbox(M.cal2,12.5,B.wtop+1.2,-16.8,0.9,2.8,0.9);sbox(M.granate,12.5,B.wtop+4.0,-16.8,1.1,0.25,1.1);
  // rear steps down to the square
  sboxX(M.piedra,-7.5,-4.5,0,0.45,-21.6,-20,true);sboxX(M.piedra,-7.5,-4.5,0,0.9,-21,-20,true);
  // annex: lampistería y aseos
  sboxX(M.cal,-32,-24,0,PH+3.5,-18,-11);
  hip(ROOF[1],-32,-24,-18,-11,PH+3.5,1.7,0.55);
  sboxX(g,-32.1,-23.9,PH-0.05,PH+0.5,-11.0,-10.9,true);
  [[-32,-11],[-24,-11],[-32,-18],[-24,-18]].forEach(c=>sbox(g,c[0],PH,c[1],0.55,3.5,0.55,0,true));
  opening(-29.6,PH,-11,1.0,2.4,1,'door');opening(-26.4,PH+1.4,-11,0.9,0.8,1,'win');
})();
const nameTex=canvasTex(512,64,(c,w,h)=>{c.fillStyle='#7E2A24';c.fillRect(0,0,w,h);c.strokeStyle='rgba(255,255,255,.45)';c.lineWidth=3;c.strokeRect(5,5,w-10,h-10);
  c.fillStyle='#F6F0E2';c.textAlign='center';c.textBaseline='middle';c.font='700 40px "Barlow Condensed","Arial Narrow",sans-serif';c.fillText('S A N T A   O L A L L A',w/2,h/2+2);});
/* Renfe's signs of the nineties: a grey panel with a blue band along the top, fading into the grey; the station's name in
   white; the vías in white and their number big in yellow */
function renfeBand(c,w,h,f){const b=h*f,g=c.createLinearGradient(0,0,0,b*1.5);g.addColorStop(0,'#2C5FC4');g.addColorStop(0.62,'#3C6FCF');g.addColorStop(1,'rgba(120,132,146,0)');
  c.fillStyle=g;c.fillRect(0,0,w,b*1.5);}
const blueTex=canvasTex(768,192,(c,w,h)=>{const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#7A8592');g.addColorStop(1,'#6A7480');c.fillStyle=g;c.fillRect(0,0,w,h);
  renfeBand(c,w,h,0.2);c.fillStyle='#F7F8F6';c.textAlign='center';c.textBaseline='middle';c.font='500 70px "Barlow","Arial",sans-serif';c.fillText('Santa Olalla',w/2,h*0.6);});
const viaTex=n=>canvasTex(256,384,(c,w,h)=>{c.fillStyle='#46515E';c.fillRect(0,0,w,h);renfeBand(c,w,h,0.12);
  c.fillStyle='#E9ECEE';c.textAlign='left';c.textBaseline='alphabetic';c.font='500 64px "Barlow","Arial",sans-serif';c.fillText('Vía',22,h*0.36);
  c.fillStyle='#D2D23C';c.textAlign='center';c.font='600 200px "Barlow","Arial",sans-serif';c.fillText(String(n),w*0.55,h*0.86);});
window.FONT_TEX=(window.FONT_TEX||[]);const FONT_TEX=window.FONT_TEX;
const nameMat=new THREE.MeshLambertMaterial({map:nameTex});MAT_HEX.set(nameMat,0x7E2A24);
const blueMat=new THREE.MeshLambertMaterial({map:blueTex});MAT_HEX.set(blueMat,0x1D4F91);
function plane(mat,x,y,z,w,h,ry){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);m.position.set(x,y,z);m.rotation.y=ry||0;scene.add(m);return m;}
plane(nameMat,-8.3,PH+3.42,B.z1+0.14,6.4,0.8,0);
plane(nameMat,-8.3,PH+3.42,B.z0-0.14,6.4,0.8,PI);
plane(nameMat,B.wx1+0.14,PH+7.6,-15.2,6.0,0.75,PI/2);
plane(blueMat,10.5,PH+3.55,B.wz1+0.14,2.9,0.72,0);
ent('edificio',{kind:'building',name:'Edificio de viajeros',sub:'Estilo Compañía del Norte',rows:[['Plantas','2 + ala de taquillas'],['Planta baja','Vestíbulo, taquilla, sala de espera'],['Gabinete de circulación','Extremo oeste · tu puesto'],['Planta alta','Vivienda del jefe de estación']]});
hitBox('edificio',-1.5,0,-15.3,33,PH+11,10.6);bb('edificio',B.x0,0,B.wz0,B.wx1,B.wtop+3,B.wz1);
ent('anexo',{kind:'building',name:'Lampistería y aseos',sub:'Edificio auxiliar',rows:[['Uso','Lámparas, faroles y aseos públicos'],['Planta','1']]});
hitBox('anexo',-28,0,-14.5,8.4,PH+5.3,7.4);bb('anexo',-32,0,-18,-24,PH+5.2,-11);

/* platform furniture */
const LAMPS=[];
(function furniture(){
  const lamps=[];for(let x=-72;x<=72;x+=16)lamps.push([x,-3.9]);   // andén 1: every 16 m, symmetric about the building
  for(let x=-72;x<=72;x+=16)lamps.push([x,9.0]);   // andén 2 (vías 1 y 3): in line with those of andén 1
  lamps.forEach(p=>{
    if(p[1]>5&&p[0]>-24.6&&p[0]<-11.4){   // under the marquesina: the lantern hangs from its roof
      sbox(M.verdeFarola,p[0],PH+2.92,p[1],0.05,0.08,0.05,0,true);sbox(M.farola,p[0],PH+2.5,p[1],0.3,0.42,0.3);LAMPS.push([p[0],PH+2.71,p[1]]);scone(M.verdeFarola,p[0],PH+2.86,p[1],0.24,0.14,true);return;}
    scyl(M.verdeFarola,p[0],PH,p[1],0.09,4.3,true);sbox(M.verdeFarola,p[0],PH+4.3,p[1],0.38,0.12,0.38);
    sbox(M.farola,p[0],PH+4.42,p[1],0.3,0.42,0.3);LAMPS.push([p[0],PH+4.63,p[1]]);scone(M.verdeFarola,p[0],PH+4.84,p[1],0.3,0.32,true);});
  function bench(x,z,ry){sbox(M.madera,x,PH+0.42,z,1.9,0.08,0.45,ry);sbox(M.madera,x,PH+0.5,z+(ry?0:-0.22),1.9,0.45,0.06,ry);
    sbox(M.hierro,x-0.8,PH,z,0.06,0.45,0.45,ry);sbox(M.hierro,x+0.8,PH,z,0.06,0.45,0.45,ry);}
  [[-14,-8.6],[-3.5,-8.6],[28,-8.0],[46,-8.0],[-48,-8.0]].forEach(p=>bench(p[0],p[1],0));
  [[20,9.6],[40,9.6],[-40,9.6]].forEach(p=>bench(p[0],p[1],0));
  // marquesina on the island
  [[-24,7.6],[-12,7.6],[-24,10.4],[-12,10.4]].forEach(p=>sbox(M.verdeFarola,p[0],PH,p[1],0.18,3.0,0.18));
  sboxX(M.verdeFarola,-24.6,-11.4,PH+3.0,PH+3.22,7.0,11.0);
  sboxX(M.chapa,-24.8,-11.2,PH+3.22,PH+3.34,6.8,11.2);
  bench(-18,9.8,0);sboxX(ds(M.cristal),-24,-12,PH+0.3,PH+2.6,10.55,10.62,true);
  // bins
  [[-30,-3.6],[30,-3.6],[-30,8.0],[30,8.0]].forEach(p=>scyl(M.verdeFarola,p[0],PH,p[1],0.28,0.85));
  // the station's name at the platform ends, on one white post (Renfe, nineties)
  const edge=lam(0x6C7682),bandE=lam(0x2C5FC4);
  [[-62,-5.2],[62,-5.2],[-62,9],[62,9]].forEach(p=>{
    scyl(M.blanco,p[0],PH,p[1],0.05,2.36,true);
    const m=new THREE.Mesh(GEO.box,[edge,edge,bandE,edge,blueMat,blueMat]);
    m.position.set(p[0],PH+2.62,p[1]);m.scale.set(2.2,0.55,0.07);m.castShadow=true;scene.add(m);});
  // the vías: panels hanging from a grey post, along the platform; on the island one for each side
  const postM=lam(0x8B9298),viaM={};
  const via=n=>viaM[n]||(viaM[n]=(t=>{FONT_TEX.push(t);return new THREE.MeshLambertMaterial({map:t});})(viaTex(n)));
  const panel=(n,x,z)=>{const m=new THREE.Mesh(GEO.box,[via(n),via(n),bandE,edge,edge,edge]);m.position.set(x,PH+2.93,z);m.scale.set(0.05,0.84,0.56);m.castShadow=true;scene.add(m);};
  [-34,34].forEach(x=>{
    scyl(postM,x,PH,-4.7,0.055,3.45,true);sboxX(postM,x-0.03,x+0.03,PH+3.36,PH+3.42,-4.75,-3.9,true);panel(VNUM.v1,x,-4.2);
    scyl(postM,x,PH,9,0.055,3.45,true);sboxX(postM,x-0.03,x+0.03,PH+3.36,PH+3.42,8.35,9.65,true);panel(VNUM.v2,x,8.66);panel(VNUM.v3,x,9.34);});
  // railings behind andén 1 outside the building
  [[-80,-34],[17,80]].forEach(r=>{for(let x=r[0];x<=r[1];x+=2.5)sbox(M.verdeFarola,x,PH,-10.55,0.07,1.1,0.07,0,true);
    sboxX(M.verdeFarola,r[0],r[1],PH+1.02,PH+1.1,-10.6,-10.5,true);sboxX(M.verdeFarola,r[0],r[1],PH+0.55,PH+0.6,-10.6,-10.5,true);});
  // a station clock on a bracket by the wing
  put('cyl',M.blanco,16.2,PH+3.6,-9.4,0.5,0.14,0.5,PI/2,0,0);put('cyl',M.negro,16.2,PH+3.6,-9.32,0.42,0.02,0.42,PI/2,0,0,true);
  sbox(M.hierro,15.6,PH+3.55,-9.4,1.2,0.08,0.08,0,true);
})();
/* street lighting: wall lanterns on the house fronts of the village streets (a post where there is no house), posts in
   the plaza mayor and the station square, and lanterns on both façades of the station building */
(function streetLamps(){
  const lantern=(x,y,z)=>{sbox(M.farola,x,y-0.19,z,0.26,0.38,0.26,0,true);scone(M.hierro,x,y+0.19,z,0.22,0.24,true);sbox(M.hierro,x,y-0.25,z,0.18,0.06,0.18,0,true);};
  const wall=(x,z,gy,y,nx,nz)=>{const lx=x+nx*0.58,lz=z+nz*0.58;
    sbox(M.hierro,x+nx*0.30,y+0.32,z+nz*0.30,nx?0.60:0.05,0.05,nz?0.60:0.05,0,true);
    sbox(M.hierro,x+nx*0.02,y,z+nz*0.02,nx?0.04:0.14,0.42,nz?0.04:0.14,0,true);
    lantern(lx,y,lz);LAMPS.push([lx,y-0.02,lz,gy,nx,nz]);};
  const pole=(x,z)=>{const gy=groundH(x,z);scyl(M.hierro,x,gy,z,0.08,3.9,true);sbox(M.hierro,x,gy+3.9,z,0.3,0.1,0.3,0,true);lantern(x,gy+4.21,z);LAMPS.push([x,gy+4.19,z,gy]);};
  /* evenly along each street (one every 22 m measured along it, alternating sides), never two within 13 m of each other:
     on the house front when there is one at the kerb, on a post where there is none */
  const placed=[],free_=(x,z)=>placed.every(q=>Math.hypot(q[0]-x,q[1]-z)>=13);
  const post=(x,z)=>{if(!free_(x,z))return;placed.push([x,z]);pole(x,z);};
  [[-13.6,-86],[3,-86],[-13.6,-108.5],[3,-108.5],[-37.2,-33.7],[38.25,-32]].forEach(p=>post(p[0],p[1]));   // plaza mayor, station garden, car park
  [['real',3.25],['arriba',2.3],['iglesia',2.5],['camino',2.5]].forEach(([k,half])=>{
    const P=ROADS[k].pts;let L=0;const seg=[];for(let i=1;i<P.length;i++){const l=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);seg.push([P[i-1],P[i],L,l]);L+=l;}
    let side=1;
    for(let d0=8;d0<=L-4;d0+=22){side=-side;
      // a junction or a lamp just there: try a few metres either way before giving up on this one
      let d=null;for(const off of[0,5,-5,9,-9]){const dd=d0+off;if(dd<2||dd>L-2)continue;const g=seg.find(q=>dd>=q[2]&&dd<=q[2]+q[3]),k2=(dd-g[2])/g[3],x=g[0][0]+(g[1][0]-g[0][0])*k2,z=g[0][1]+(g[1][1]-g[0][1])*k2,
        tx=(g[1][0]-g[0][0])/g[3],tz=(g[1][1]-g[0][1])/g[3],qx=x-tz*side*(half+0.35),qz=z+tx*side*(half+0.35);
        if(!free_(qx,qz)){if(off===0)break;continue;}   // this stretch already has its lamp
        if(!Object.keys(ROADS).some(q=>q!==k&&distPoly(qx,qz,ROADS[q].pts)<ROADS[q].w/2+0.6)){d=dd;break;}}
      if(d===null)continue;
      const g=seg.find(q=>d>=q[2]&&d<=q[2]+q[3]),k2=(d-g[2])/g[3],x=g[0][0]+(g[1][0]-g[0][0])*k2,z=g[0][1]+(g[1][1]-g[0][1])*k2;
      const tx=(g[1][0]-g[0][0])/g[3],tz=(g[1][1]-g[0][1])/g[3],nx=-tz*side,nz=tx*side;   // normal towards this side
      const px=x+nx*(half+0.35),pz=z+nz*(half+0.35);
      if(!free_(px,pz)||Object.keys(ROADS).some(q=>q!==k&&distPoly(px,pz,ROADS[q].pts)<ROADS[q].w/2+0.6))continue;   // not in the middle of a crossing street
      // a house front right at the kerb on this side: the lantern goes on its wall
      const o=HOUSES.find(q=>{const fx=x+nx*(half+0.6),fz=z+nz*(half+0.6);return fx>q.x0-0.3&&fx<q.x1+0.3&&fz>q.z0-0.3&&fz<q.z1+0.3&&
        (Math.abs(nx)>Math.abs(nz)?(px>q.x0+0.8||true)&&pz>q.z0+0.8&&pz<q.z1-0.8:px>q.x0+0.8&&px<q.x1-0.8);});
      placed.push([px,pz]);
      if(o){const ax=Math.abs(nx)>Math.abs(nz),fx=ax?(nx>0?o.x0:o.x1):px,fz=ax?pz:(nz>0?o.z0:o.z1);
        wall(fx,fz,groundH(fx-nx*1.5,fz-nz*1.5),groundH(fx,fz)+3.7,ax?-Math.sign(nx):0,ax?0:-Math.sign(nz));}
      else{   // a post never touches a house corner: slide it along the street until it is clear
        let qx=px,qz=pz;for(let t=0;t<8;t++){const h=HOUSES.find(q=>qx>q.x0-0.7&&qx<q.x1+0.7&&qz>q.z0-0.7&&qz<q.z1+0.7);if(!h)break;
          const sl=[1,-1].map(sg=>{let u=0;while(u<12&&qx+tx*sg*u>h.x0-0.7&&qx+tx*sg*u<h.x1+0.7&&qz+tz*sg*u>h.z0-0.7&&qz+tz*sg*u<h.z1+0.7)u+=0.25;return[u,sg];}).sort((a,b)=>a[0]-b[0])[0];
          qx+=tx*sl[1]*sl[0];qz+=tz*sl[1]*sl[0];}
        placed[placed.length-1]=[qx,qz];pole(qx,qz);}}});
  // station building: platform façade and street façade (clear of the name boards, the blue board and the clock)
  [[-16,B.z1],[-2.5,B.z1],[7.4,B.wz1],[13.3,B.wz1]].forEach(p=>wall(p[0],p[1],PH,PH+3.05,0,1));
  [[-16,B.z0],[-2.5,B.z0],[10.5,B.wz0]].forEach(p=>wall(p[0],p[1],groundH(p[0],p[1]-1.5),PH+3.05,0,-1));
})();

/* =====================================================================
   11. Goods dock, warehouse, parked wagons
   ===================================================================== */
(function goods(){
  sboxX(M.hormigon,-70,10,0,1.25,20.4,30);
  const ang=Math.atan2(1.25,7);put('box',M.hormigon,-73.5,1.25/2-1,25.2,Math.hypot(7,1.25),2,9.6,0,0,ang);
  sboxX(M.bordillo,-70,10,1.25,1.3,20.4,21.0,true);
  // almacén
  const y=1.25;
  sboxX(M.cal,-60,-34,y,y+5.2,21.8,29.6);
  gable(ROOF[2],M.cal,-60,-34,21.8,29.6,y+5.2,2.2,0.7,'x');
  [[-60,21.8],[-34,21.8],[-60,29.6],[-34,29.6]].forEach(c=>sbox(M.granate,c[0],y,c[1],0.6,5.2,0.6,0,true));
  sboxX(M.granate,-60.1,-33.9,y,y+0.45,21.68,21.8,true);sboxX(M.granate,-60.1,-33.9,y+4.8,y+5.2,21.68,21.8,true);
  [-53,-41].forEach(x=>{sbox(M.granate,x,y,21.72,3.6,3.95,0.1,0,true);sbox(M.madera,x,y,21.66,3.1,3.7,0.1,0,true);
    for(let k=-1;k<=1;k++)sbox(M.maderaClara,x+k*1.0,y,21.6,0.08,3.7,0.04,0,true);});
  sboxX(M.chapa,-56,-38,y+4.1,y+4.25,20.4,21.8);
  // crates and sacks
  [[-30,24],[-28.6,24.2],[-29.3,24.1,1],[-24,26],[-12,22.4]].forEach(p=>sbox(M.maderaClara,p[0],y+(p[2]?1.0:0),p[1],1.2,1.0,1.0,rnd()*0.4));
})();
/* topera de la vía 5 (lado Miranda): bloque de hormigón, pórtico de perfiles y travesaño con topes, pintado a franjas */
(function topera(){const x=TOPE.v5.x,z=TZ[5],yb=1.62;
  sbox(M.hormigon,x-2.4,0,z,2.6,1.1,3.6);
  [-0.85,0.85].forEach(o=>{sbox(M.negro,x-0.55,0.6,z+o,0.22,yb+0.3-0.6,0.22);
    put('box',M.negro,x-1.3,0.6+(yb-0.6)/2,z+o,0.16,Math.hypot(1.5,yb-0.6),0.16,0,0,Math.atan2(1.5,yb-0.6));
    put('cyl',M.negro,x-0.15,yb+0.27,z+o,0.17,0.5,0.17,0,0,PI/2);});
  sbox(M.rojo,x-0.5,yb,z,0.3,0.55,2.9);
  [-1.1,0,1.1].forEach(o=>sbox(M.blanco,x-0.34,yb,z+o,0.02,0.55,0.4,0,true));
})();
ent('topera',{kind:'building',name:'Topera',sub:'Final de la vía 5 · lado Miranda',rows:[['Vía','5 (servicio, en topera)'],['Longitud de la vía','377 m en la realidad (S2/5 – topera, 172 m útiles aquí)']]});
hitBox('topera',TOPE.v5.x-1.4,0,TZ[5],4,2.4,4);bb('topera',TOPE.v5.x-3.7,0,TZ[5]-1.8,TOPE.v5.x,2.2,TZ[5]+1.8);
ent('almacen',{kind:'building',name:'Almacén de mercancías',sub:'Muelle cubierto · vía 5',rows:[['Superficie','26 × 8 m'],['Puertas','2 correderas al muelle'],['Uso','Cereal y abonos de la comarca']]});
hitBox('almacen',-47,1.25,25.7,26.4,8,8.4);bb('almacen',-60,1.25,21.8,-34,9.6,29.6);
ent('muelle',{kind:'platform',name:'Muelle de carga',sub:'Junto a la vía 5 · sin servicio de viajeros',rows:[['Longitud','80 m'],['Altura','1,25 m'],['Acceso','Rampa lado Miranda']]});
hitBox('muelle',-12,0,25.2,44,1.6,9.6);bb('muelle',-70,0,20.4,10,1.3,30);

/* ---- glow sprites and light pools for the night (opacity follows the night factor) ---- */
return{nameTex,blueTex,LAMPS};};

/* ---- pasoNivel · paso a nivel ---- */
NIVEL.pasoNivel=function(){
const barriers=[];
(function levelCrossing(){
  const x=PN.x;
  /* the deck: rubber panels between and beside the rails, which run through it in their grooves */
  sboxX(lam(0x343536),x-3.4,x+3.4,0.6,0.8,-1.4,5.7,true);
  [0,4.3].forEach(tz=>[-0.834,0.834].forEach(o=>{sboxX(M.negro,x-3.4,x+3.4,0.79,0.803,tz+o-0.09,tz+o+0.09,true);sboxX(M.carril,x-3.4,x+3.4,0.79,0.812,tz+o-0.036,tz+o+0.036,true);}));
  for(let px=x-3.4+0.9;px<x+3.3;px+=0.9)sboxX(M.negro,px-0.015,px+0.015,0.79,0.804,-1.4,5.7,true);
  [[x-4.6,-6.4,1],[x+4.6,10.6,-1]].forEach(b=>{
    sbox(M.blanco,b[0],0,b[1],0.36,1.6,0.36);
    sbox(M.rojo,b[0],1.6,b[1],0.5,0.5,0.5);
    // St Andrew's cross + light box
    scyl(M.hierro,b[0]-b[2]*0.9,0,b[1]-b[2]*1.2,0.07,3.4,true);
    sbox(M.negro,b[0]-b[2]*0.9,2.4,b[1]-b[2]*1.2,0.5,0.5,0.2);
    sbox(M.blanco,b[0]-b[2]*0.9,3.0,b[1]-b[2]*1.2,1.5,0.18,0.06,PI/4,true);
    sbox(M.blanco,b[0]-b[2]*0.9,3.0,b[1]-b[2]*1.2,1.5,0.18,0.06,-PI/4,true);
    const piv=new THREE.Group();piv.position.set(b[0],1.85,b[1]);scene.add(piv);
    for(let k=0;k<6;k++){const s=new THREE.Mesh(GEO.box,k%2?M.blanco:M.rojo);s.scale.set(1.2,0.14,0.14);s.position.set(b[2]*(0.6+k*1.2),0,0);s.castShadow=true;piv.add(s);}
    piv.userData.dir=b[2];piv.rotation.z=b[2]*1.35;barriers.push(piv);
  });
})();
// the road climbs to the deck, at rail level, over the shoulders of the ballast: an asphalt ramp on each side
{const x=PN.x,RA=Math.atan2(0.8,6),rampM=lam(0x5F5D59);
  put('box',rampM,x,0.4-Math.cos(RA),-4.4+Math.sin(RA),6.8,2,Math.hypot(6,0.8),-RA,0,0);
  put('box',rampM,x,0.4-Math.cos(RA),8.7-Math.sin(RA),6.8,2,Math.hypot(6,0.8),RA,0,0);}
ent('pn',{kind:'crossing',name:'Paso a nivel',sub:'Carretera de Santa María del Invierno · lado Miranda',rows:[['Protección','Barreras y señales luminosas'],['Vías','1 y 2'],['Accionamiento','Automático por aproximación']]});
hitBox('pn',PN.x,0,2.15,12,3,22);bb('pn',PN.x-5,0,-7,PN.x+5,3.6,11.3);

/* the height of the road over the crossing: the deck and its ramps */
const deckH=(x,z)=>{if(Math.abs(x-PN.x)>3.4)return 0;if(z>=-1.4&&z<=5.7)return 0.8;
  if(z>-7.4&&z<-1.4)return 0.8*(z+7.4)/6;if(z>5.7&&z<11.7)return 0.8*(11.7-z)/6;return 0;};
return{barriers,deckH};};

/* ---- pueblo · casas, naves, iglesia, granja, plaza y ayuntamiento ---- */
NIVEL.pueblo=function(){
function minH(x0,z0,x1,z1){return Math.min(groundH(x0,z0),groundH(x1,z0),groundH(x0,z1),groundH(x1,z1),groundH((x0+x1)/2,(z0+z1)/2));}
function maxH(x0,z0,x1,z1){return Math.max(groundH(x0,z0),groundH(x1,z0),groundH(x0,z1),groundH(x1,z1),groundH((x0+x1)/2,(z0+z1)/2));}
/* trim shared by the houses: whitewashed surrounds, ridge tiles, zinc gutters, carpentry colours, geraniums */
M.recerco=M.recerco||lam(0xF1ECE0);M.cumbrera=M.cumbrera||lam(0x98503A);M.zinc=M.zinc||lam(0x8D9290);M.hoja=M.hoja||lam(0x4F7A3A);M.flor=M.flor||lam(0xC43A32);M.flor2=M.flor2||lam(0xE08AA0);
const TRIM=[lam(0x3F5B45),lam(0x5E4130),lam(0x4A3A2C),lam(0x4E6272),lam(0x7A2E22),lam(0x6B4A33)];
HOUSES.forEach((hh,hi)=>{
  const base=minH(hh.x0,hh.z0,hh.x1,hh.z1)-0.6, top=maxH(hh.x0,hh.z0,hh.x1,hh.z1)+(hh.floors===2?6.0:3.4);
  sboxX(hh.wall,hh.x0,hh.x1,base,top,hh.z0,hh.z1);
  const ax=(hh.front==='n'||hh.front==='s')?'x':'z';
  gable(hh.roof,hh.wall,hh.x0,hh.x1,hh.z0,hh.z1,top,hh.rise,0.55,ax);
  // plinth
  sboxX(M.piedraOsc,hh.x0-0.05,hh.x1+0.05,base,base+1.2,hh.z0-0.05,hh.z1+0.05,true);
  // windows + door on the street front
  const gy=top-(hh.floors===2?6.0:3.4);
  const along=ax==='x'?[hh.x0,hh.x1]:[hh.z0,hh.z1];
  const n=Math.max(1,Math.floor((along[1]-along[0])/3.2));
  const fz={n:hh.z0,s:hh.z1,e:hh.x1,w:hh.x0}[hh.front];
  const sgn=(hh.front==='s'||hh.front==='e')?1:-1;
  const doorI=Math.floor(rnd()*n);
  /* carpentry and trim of each house, from its own number (the village's random stream is left as it was): the colour of
     doors and shutters, whether its windows have shutters or bars, a balcony over the door, a TV aerial */
  const H=mulberry(5200+hi*37),K={col:TRIM[Math.floor(H()*TRIM.length)],shut:H()<0.55,bars:H()<0.5,balc:hh.floors===2&&H()<0.6,aerial:H()<0.6,dark:H()<0.4,pots:H()<0.6};
  const white=hh.wall===M.cal||hh.wall===M.cal2,FR=white?M.piedra2:M.recerco,MU=K.dark?M.marco:M.recerco;
  /* a box on a wall: u along it, y0 its foot, d out from the wall (its centre), w along, h up, t thick */
  const face=(axF,fzF,sg)=>(mat,u,y0,d,w,h,t)=>axF==='x'?sbox(mat,u,y0,fzF+sg*d,w,h,t,0,true):sbox(mat,fzF+sg*d,y0,u,t,h,w,0,true);
  const B=face(ax,fz,sgn);
  /* a window: stone or whitewashed surround, the glass, its glazing bars and sill; shutters folded back or bars */
  const win=(Bx,u,y,ww,wh,mat,o)=>{o=o||{};
    Bx(FR,u,y-0.14,0.03,ww+0.34,wh+0.3,0.06);Bx(mat,u,y,0.05,ww,wh,0.1);
    Bx(MU,u,y,0.105,0.055,wh,0.03);Bx(MU,u,y+wh*0.62,0.105,ww,0.05,0.03);
    Bx(FR,u,y-0.2,0.1,ww+0.44,0.1,0.2);
    if(o.shut)[-1,1].forEach(q=>{Bx(K.col,u+q*(ww*0.75+0.05),y,0.07,ww*0.5,wh,0.05);Bx(M.marco2,u+q*(ww*0.75+0.05),y+wh*0.3,0.1,ww*0.5,0.04,0.02);Bx(M.marco2,u+q*(ww*0.75+0.05),y+wh*0.7,0.1,ww*0.5,0.04,0.02);});
    if(o.bars){for(let k=-2;k<=2;k++)Bx(M.hierro,u+k*ww/5,y-0.04,0.16,0.03,wh+0.08,0.03);[0.02,wh-0.06].forEach(v=>Bx(M.hierro,u,y+v,0.16,ww+0.06,0.04,0.03));}};
  for(let i=0;i<n;i++){const u=along[0]+(i+0.5)*(along[1]-along[0])/n;
    const fl=[gy+1.1];if(hh.floors===2)fl.push(gy+3.9);
    fl.forEach((y,j)=>{const isDoor=(j===0&&i===doorI);
      if(isDoor){const ww=1.15,wh=2.3,gd=ax==='x'?groundH(u,fz+sgn*0.5):groundH(fz+sgn*0.5,u),y0=Math.min(gy,gd)+0.04;   // down to the ground in front of it (the plinth stops at the door)
        B(FR,u,y0-0.05,0.045,ww+0.5,wh+0.3,0.07);B(K.col,u,y0,0.06,ww,wh,0.1);B(M.marco2,u,y0,0.115,0.03,wh,0.02);
        [-1,1].forEach(q=>[0.25,1.25].forEach(v=>B(M.marco2,u+q*ww*0.25,y0+v,0.115,ww*0.3,0.8,0.02)));          // sunk panels of the two leaves
        B(M.bronce,u+0.1,y0+1.05,0.13,0.05,0.12,0.04);                                                         // the knocker
        B(M.piedra2,u,y0-0.3,0.32,ww+0.7,0.34,0.64);                                                              // doorstep
        hh.doorU=u;}
      else if(j===1&&i===doorI&&K.balc){const ww=1.0,wh=2.15,y0=gy+3.12;                                         // balcony over the door
        B(FR,u,y0-0.05,0.03,ww+0.34,wh+0.25,0.06);B(houseWin(hh,u,y,fz),u,y0,0.05,ww,wh,0.1);B(MU,u,y0,0.105,0.055,wh,0.03);B(MU,u,y0+wh*0.7,0.105,ww,0.05,0.03);
        B(M.piedra2,u,y0-0.14,0.33,ww+1.0,0.12,0.66);
        [0.06,0.5,0.95].forEach(v=>B(M.hierro,u,y0-0.02+v,0.62,ww+0.9,0.035,0.035));
        for(let k=0;k<=8;k++)B(M.hierro,u-(ww+0.9)/2+k*(ww+0.9)/8,y0-0.02,0.62,0.025,0.97,0.025);
        [-1,1].forEach(q=>{[0.06,0.5,0.95].forEach(v=>B(M.hierro,u+q*(ww+0.9)/2,y0-0.02+v,0.33,0.035,0.035,0.6));});
        if(K.pots)[-0.55,0,0.55].forEach((q,k)=>{B(M.teja,u+q,y0-0.02,0.5,0.24,0.2,0.2);B(M.hoja,u+q,y0+0.18,0.5,0.3,0.16,0.26);B(k%2?M.flor2:M.flor,u+q,y0+0.3,0.5,0.22,0.1,0.2);});}
      else win(B,u,y,0.95,1.15,houseWin(hh,u,y,fz),{shut:K.shut,bars:j===0&&K.bars&&!K.shut});
    });}
  /* the back and the two gable ends: a few smaller windows, so no wall is blank */
  {const bz={n:hh.z1,s:hh.z0,e:hh.x0,w:hh.x1}[hh.front],Bb=face(ax,bz,-sgn),nb=Math.max(1,Math.floor((along[1]-along[0])/4.2));
    for(let i=0;i<nb;i++){const u=along[0]+(i+0.5)*(along[1]-along[0])/nb;if(H()<0.75)win(Bb,u,gy+(hh.floors===2?4.05:1.35),0.8,0.9,houseWin(hh,u,gy+4,bz));
      if(hh.floors===2&&H()<0.45)win(Bb,u,gy+1.3,0.8,0.9,houseWin(hh,u,gy+1.3,bz),{bars:true});}
    const ax2=ax==='x'?'z':'x',side=ax==='x'?[hh.z0,hh.z1]:[hh.x0,hh.x1],ends=ax==='x'?[[hh.x0,-1],[hh.x1,1]]:[[hh.z0,-1],[hh.z1,1]];
    ends.forEach(([f,sg])=>{if(H()<0.6)return;const Bs=face(ax2,f,sg),u=(side[0]+side[1])/2+(H()-0.5)*1.5;
      win(Bs,u,gy+(hh.floors===2?4.0:1.4),0.75,0.85,houseWin(hh,f,gy+4,u));});}
  /* the roof: ridge tiles, a board under each eave with its gutter and downpipe, the chimney with its cap, the aerial */
  {const o=0.55,len=along[1]-along[0]+2*o,um=(along[0]+along[1])/2,vv=ax==='x'?[hh.z0,hh.z1]:[hh.x0,hh.x1],vm=(vv[0]+vv[1])/2,half=(vv[1]-vv[0])/2,yO=top-hh.rise/half*o;
    const L=(mat,v,y0,w,h)=>ax==='x'?sbox(mat,um,y0,v,len,h,w,0,true):sbox(mat,v,y0,um,w,h,len,0,true);
    L(M.cumbrera,vm,top+hh.rise-0.03,0.34,0.14);
    [[vv[0]-o+0.07,-1],[vv[1]+o-0.07,1]].forEach(([v,q])=>{L(M.marco,v,yO-0.17,0.06,0.16);L(M.zinc,v+q*0.1,yO-0.13,0.14,0.11);});
    const fv=(hh.front==='s'||hh.front==='e')?vv[1]:vv[0],fq=(hh.front==='s'||hh.front==='e')?1:-1,du=along[0]+0.18;
    if(ax==='x'){scyl(M.zinc,du,gy-0.3,fv+fq*0.13,0.055,yO-gy+0.2,true);sbox(M.zinc,du,yO-0.14,fv+fq*(o/2+0.1),0.09,0.09,o,0,true);}
    else{scyl(M.zinc,fv+fq*0.13,gy-0.3,du,0.055,yO-gy+0.2,true);sbox(M.zinc,fv+fq*(o/2+0.1),yO-0.14,du,o,0.09,0.09,0,true);}
    if(K.aerial){const au=along[0]+(along[1]-along[0])*(0.2+0.6*H()),ay=top+hh.rise,P=(m,du2,y,dv,w,h,d)=>ax==='x'?sbox(m,au+du2,y,vm+dv,w,h,d,0,true):sbox(m,vm+dv,y,au+du2,d,h,w,0,true);
      P(M.galva,0,ay-0.2,0,0.045,2.5,0.045);P(M.galva,0,ay+2.05,0,0.03,0.03,1.15);
      [[-0.5,0.62],[-0.3,0.52],[-0.1,0.46],[0.1,0.42],[0.3,0.38],[0.5,0.34]].forEach(([dv,w])=>P(M.galva,0,ay+2.05,dv,w,0.02,0.02));
      P(M.galva,0,ay+1.55,0,0.5,0.02,0.02);P(M.galva,0,ay+1.55,0.12,0.5,0.02,0.02);}}
  if(rnd()<0.5){const cx=lerp(hh.x0,hh.x1,rr(.25,.75)),cz=lerp(hh.z0,hh.z1,rr(.3,.7));sbox(M.cal2,cx,top+hh.rise*0.5,cz,0.7,hh.rise*0.7+0.6,0.7);hh.chim={x:cx,y:top+hh.rise*1.2+0.6,z:cz};
    const cy=top+hh.rise*1.2+0.6;sbox(M.piedra2,cx,cy-0.02,cz,0.9,0.1,0.9,0,true);[[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>sbox(M.cal2,cx+a*0.27,cy+0.08,cz+b*0.27,0.14,0.2,0.14,0,true));sbox(M.teja2,cx,cy+0.28,cz,0.86,0.07,0.86,0,true);}
  hh.top=top;hh.base=base;
});
SHEDS.forEach(s=>{const base=minH(s.x0,s.z0,s.x1,s.z1)-0.5,top=maxH(s.x0,s.z0,s.x1,s.z1)+4.6;
  sboxX(s.wall,s.x0,s.x1,base,top,s.z0,s.z1);gable(s.roof===M.rojo?lam(0x9E3B33,{side:THREE.DoubleSide}):ds(M.chapa),s.wall,s.x0,s.x1,s.z0,s.z1,top,1.3,0.4,'x');
  /* a sliding door of two leaves on its rail, a concrete footing, a row of high windows on each side, the ridge, a lamp over the door */
  const xm=(s.x0+s.x1)/2,g0=base+0.5,DR=s.roof===M.rojo?M.granate:M.galva;
  sbox(M.hierro,xm,g0+3.62,s.z1+0.1,8.6,0.1,0.1,0,true);
  [-1,1].forEach(q=>{sbox(DR,xm+q*1.02,g0,s.z1+0.07,2.0,3.6,0.08,0,true);[0.9,1.8,2.7].forEach(v=>sbox(M.hierro,xm+q*1.02,g0+v,s.z1+0.115,2.0,0.05,0.02,0,true));
    [-0.97,0.97].forEach(e=>sbox(M.hierro,xm+q*1.02+e,g0,s.z1+0.115,0.06,3.6,0.02,0,true));});
  sboxX(M.hormigon,s.x0-0.06,s.x1+0.06,base,base+0.9,s.z0-0.06,s.z1+0.06,true);
  for(let x=s.x0+2.2;x<s.x1-1;x+=3.4)[s.z0,s.z1].forEach((z,k)=>{if(k&&Math.abs(x-xm)<5.4)return;const q=k?1:-1;sbox(M.recerco,x,top-1.35,z+q*0.03,1.7,0.8,0.06,0,true);sbox(M.cristal,x,top-1.28,z+q*0.05,1.5,0.66,0.06,0,true);
    [-0.25,0.25].forEach(e=>sbox(M.recerco,x+e,top-1.28,z+q*0.085,0.04,0.66,0.02,0,true));});
  sbox(s.roof===M.rojo?M.cumbrera:M.galva,xm,top+1.3-0.03,(s.z0+s.z1)/2,s.x1-s.x0+0.8,0.12,0.4,0,true);
  [s.z0-0.4+0.06,s.z1+0.4-0.06].forEach((z,k)=>sbox(M.zinc,xm,top-1.3/((s.z1-s.z0)/2)*0.4-0.13,z+(k?0.08:-0.08),s.x1-s.x0+0.8,0.11,0.14,0,true));
  sbox(M.hierro,xm,g0+4.0,s.z1+0.2,0.06,0.06,0.4,0,true);sbox(M.farola,xm,g0+3.86,s.z1+0.38,0.22,0.14,0.22,0,true);});
/* corral walls */
[[-118,-70,-104,-66],[30,-70,46,-64],[-90,-102,-76,-92],[44,-128,60,-120]].forEach(r=>{const y=minH(r[0],r[1],r[2],r[3])-0.4;
  sboxX(M.piedra,r[0],r[2],y,y+1.9,r[1],r[1]+0.5);sboxX(M.piedra,r[0],r[2],y,y+1.9,r[3]-0.5,r[3]);sboxX(M.piedra,r[0],r[0]+0.5,y,y+1.9,r[1],r[3]);sboxX(M.piedra,r[2]-0.5,r[2],y,y+1.9,r[1],r[3]);});

/* church of Santa Eulalia */
const CH={x0:16,x1:40,z0:-110,z1:-99,tx0:9.9,tx1:16.1,tz0:-107.6,tz1:-101.4};
(function church(){
  const b=minH(CH.tx0,CH.z0,CH.x1+5,CH.z1)-0.8;
  CH.base=b;
  sboxX(M.piedra,CH.x0,CH.x1,b,b+10.6,CH.z0,CH.z1);
  gable(ROOF[3],M.piedra,CH.x0,CH.x1,CH.z0,CH.z1,b+10.6,3.3,0.55,'x');
  put('halfcyl',M.piedra,CH.x1,b+4.6,(CH.z0+CH.z1)/2,5.2,9.2,5.2);
  put('halfcone',ROOF[3],CH.x1,b+9.2+1.35,(CH.z0+CH.z1)/2,5.6,2.7,5.6);
  [22,28,34].forEach(x=>sboxX(M.piedra2,x-0.5,x+0.5,b,b+7.4,CH.z1,CH.z1+1.1));
  sboxX(M.piedra2,CH.x0,CH.x1+0.1,b+10.2,b+10.6,CH.z1,CH.z1+0.25,true);
  /* the south door: a round arch of dressed stone in a projecting frame, two studded leaves, three steps */
  const disc=(mat,x,y,z,r,t)=>put('cyl',mat,x,y,z,r,t,r,PI/2,0,0,true),dz=CH.z1,dy=groundH(25,CH.z1+1.5)-0.05;
  sboxX(M.piedra2,22.9,27.1,b,dy+6.0,dz,dz+0.35,true);sboxX(M.piedra2,22.7,27.3,dy+6.0,dy+6.3,dz,dz+0.5,true);
  const fy=dy+0.45;
  sbox(M.piedraOsc,25,fy,dz+0.36,2.9,3.2,0.1,0,true);disc(M.piedraOsc,25,fy+3.2,dz+0.36,1.45,0.1);
  sbox(M.puerta,25,fy,dz+0.4,2.0,3.2,0.1,0,true);disc(M.puerta,25,fy+3.2,dz+0.4,1.0,0.1);sbox(M.marco2,25,fy,dz+0.46,0.05,4.15,0.02,0,true);
  [-0.5,0.5].forEach(q=>[0.5,1.3,2.1,2.9].forEach(v=>sbox(M.bronce,25+q,fy+v,dz+0.46,0.07,0.07,0.03,0,true)));
  [[4.0,1.5,0],[3.4,1.0,0.15],[2.8,0.5,0.3]].forEach(([w,d,h])=>sbox(M.piedra2,25,dy+h-0.3,dz+0.36+d/2,w,0.46,d,0,true));
  /* round-headed windows in stone surrounds on both sides, a cornice under each eave, a stone cross on the gable over the apse */
  [[CH.z1,1],[CH.z0,-1]].forEach(([z,q])=>{[19,31,37].concat(q<0?[25]:[]).forEach(x=>{
      sbox(M.piedra2,x,b+5.9,z+q*0.05,0.95,2.1,0.1,0,true);disc(M.piedra2,x,b+8.0,z+q*0.05,0.475,0.1);
      sbox(M.cristal,x,b+6.1,z+q*0.08,0.5,1.9,0.1,0,true);disc(M.cristal,x,b+8.0,z+q*0.08,0.25,0.1);sbox(M.piedra2,x,b+5.8,z+q*0.1,1.15,0.14,0.2,0,true);});
    if(q<0)sboxX(M.piedra2,CH.x0,CH.x1+0.1,b+10.2,b+10.6,CH.z0-0.25,CH.z0,true);});
  {const zc=(CH.z0+CH.z1)/2,yr=b+10.6+3.3;sbox(M.piedra2,CH.x1+0.3,yr-0.1,zc,0.5,0.5,0.6,0,true);sbox(M.piedra2,CH.x1+0.3,yr+0.4,zc,0.16,1.5,0.16,0,true);sbox(M.piedra2,CH.x1+0.3,yr+1.25,zc,0.16,0.16,0.9,0,true);}
  sbox(M.cumbrera,(CH.x0+CH.x1)/2,b+10.6+3.3-0.04,(CH.z0+CH.z1)/2,CH.x1-CH.x0+1.0,0.16,0.4,0,true);
  // tower
  const T=CH,tb=b,tt=b+21,disc0=(mat,x,y,z,r,t)=>put('cyl',mat,x,y,z,r,t,r,PI/2,0,0,true);
  sboxX(M.piedra,T.tx0,T.tx1,tb,tt,T.tz0,T.tz1);
  sboxX(M.piedra2,T.tx0-0.35,T.tx1+0.35,tt,tt+0.6,T.tz0-0.35,T.tz1+0.35);
  sboxX(M.piedra2,T.tx0-0.2,T.tx1+0.2,tb+10.4,tb+10.8,T.tz0-0.2,T.tz1+0.2,true);
  const cx=(T.tx0+T.tx1)/2,cz=(T.tz0+T.tz1)/2;
  /* belfry: round-headed openings with their imposts and a sill course; corner stones up the shaft */
  const discX=(mat,x,y,z,r,t)=>put('cyl',mat,x,y,z,r,t,r,0,0,PI/2,true);
  sboxX(M.piedra2,T.tx0-0.2,T.tx1+0.2,tb+15.75,tb+16.05,T.tz0-0.2,T.tz1+0.2,true);
  for(let y=tb+1.4;y<tb+15.2;y+=1.5)[[T.tx0,T.tz0],[T.tx1,T.tz0],[T.tx0,T.tz1],[T.tx1,T.tz1]].forEach(([x,z],k)=>{const w=(Math.round((y-tb)/1.5)+k)%2?0.9:0.55;
    sboxX(M.piedra2,x-(x===T.tx0?0.04:w),x+(x===T.tx0?w:0.04),y,y+0.7,z-(z===T.tz0?0.04:0.55),z+(z===T.tz0?0.55:0.04),true);});
  [-1.4,1.4].forEach(o=>{
    [T.tz1+0.02,T.tz0-0.02].forEach(z=>disc0(M.negro,cx+o,tb+18.7,z,0.575,0.12));
    [T.tx1+0.02,T.tx0-0.02].forEach(x=>discX(M.negro,x,tb+18.7,cz+o,0.575,0.12));
    sbox(M.negro,cx+o,tb+16.2,T.tz1+0.02,1.15,2.5,0.12,0,true);sbox(M.negro,cx+o,tb+16.2,T.tz0-0.02,1.15,2.5,0.12,0,true);
    sbox(M.negro,T.tx1+0.02,tb+16.2,cz+o,0.12,2.5,1.15,0,true);sbox(M.negro,T.tx0-0.02,tb+16.2,cz+o,0.12,2.5,1.15,0,true);
    sico(M.bronce,cx+o,tb+17.3,T.tz1-0.4,0.42,0.5,0.42);sico(M.bronce,cx+o,tb+17.3,T.tz0+0.4,0.42,0.5,0.42);
  });
  sbox(M.cristal,cx,tb+7,T.tz1+0.03,0.5,1.5,0.1,0,true);
  hip(ROOF[3],T.tx0,T.tx1,T.tz0,T.tz1,tt+0.6,2.6,0.25);
  [[T.tx0,T.tz0],[T.tx1,T.tz0],[T.tx0,T.tz1],[T.tx1,T.tz1]].forEach(c=>{scone(M.piedra2,c[0],tt+0.6,c[1],0.36,1.7,true);sico(M.piedra2,c[0],tt+2.45,c[1],0.3,0.3,0.3);});
  // stork's nest and its stork
  const ay=tt+0.6+2.6;
  scyl(M.nido,cx,ay-0.45,cz,1.15,0.6);
  NIVEL.nidos=[{x:cx,y:ay+0.15,z:cz,a:PI/2}];
  // churchyard wall
  sboxX(M.piedra,6,46,b,b+1.4,-114.2,-113.7,true);sboxX(M.piedra,45.5,46,b,b+1.4,-114,-95,true);
})();
ent('iglesia',{kind:'building',name:'Iglesia de Santa Eulalia',sub:'Patrona que da nombre al pueblo',rows:[['Torre','22 m · campanario con nido de cigüeña'],['Planta','Nave única con ábside'],['Situación','Plaza Mayor']]});
hitBox('iglesia',27,CH.base,-104.5,38,25,13);bb('iglesia',CH.tx0,CH.base,CH.z0,CH.x1+5,CH.base+27,CH.z1);
ent('pueblo',{kind:'village',name:'Santa Olalla',sub:'Pueblo · comarca de La Bureba',rows:[['Habitantes','40 empadronados (INE, 1999)'],['Casas',String(HOUSES.length)],['Distancia a la estación','≈ 600 m por el camino']]});
HOUSES.forEach((hh,i)=>{const id='casa:'+i,y=minH(hh.x0,hh.z0,hh.x1,hh.z1);ent(id,{kind:'house',h:i,name:'Casa',sub:'Santa Olalla'});hitBox(id,(hh.x0+hh.x1)/2,y,(hh.z0+hh.z1)/2,hh.x1-hh.x0,7,hh.z1-hh.z0);bb(id,hh.x0,y,hh.z0,hh.x1,y+3.2*hh.floors+2.5,hh.z1);});
bb('pueblo',-120,0,-135,80,10,-50);ENT.pueblo.anchor=[-30,10,-84];

/* farm */
(function farm(){
  const x=FARM.x,z=FARM.z,b=minH(x-16,z-8,x+18,z+12)-0.4;
  sboxX(M.cal2,x-16,x+8,b,b+5.5,z-6,z+6);gable(ds(M.chapa),M.cal2,x-16,x+8,z-6,z+6,b+5.5,1.6,0.5,'x');
  /* the nave: sliding doors on their rail, a concrete footing, high windows, the ridge; the silo with its hoops, ladder and
     filling pipe; the house with its door and windows */
  sbox(M.hierro,x-4,b+4.85,z+6.1,13,0.1,0.1,0,true);
  [-1,1].forEach(q=>{sbox(M.galva,x-4+q*1.52,b+0.4,z+6.07,3.0,4.4,0.08,0,true);[1.1,2.2,3.3].forEach(v=>sbox(M.hierro,x-4+q*1.52,b+0.4+v,z+6.115,3.0,0.05,0.02,0,true));
    [-1.47,1.47].forEach(e=>sbox(M.hierro,x-4+q*1.52+e,b+0.4,z+6.115,0.06,4.4,0.02,0,true));});
  sboxX(M.hormigon,x-16.06,x+8.06,b,b+0.9,z-6.06,z+6.06,true);
  for(let wx=x-13.5;wx<x+7;wx+=3.6)[z-6,z+6].forEach((wz,k)=>{if(k&&Math.abs(wx-(x-4))<7.6)return;const q=k?1:-1;sbox(M.recerco,wx,b+4.0,wz+q*0.03,1.7,0.8,0.06,0,true);sbox(M.cristal,wx,b+4.07,wz+q*0.05,1.5,0.66,0.06,0,true);
    [-0.25,0.25].forEach(e=>sbox(M.recerco,wx+e,b+4.07,wz+q*0.085,0.04,0.66,0.02,0,true));});
  sbox(M.galva,x-4,b+5.5+1.6-0.03,z,24.8,0.12,0.4,0,true);
  scyl(M.silo,x+13,b,z-2,2.6,11);scone(M.silo,x+13,b+11,z-2,2.7,1.8);
  [1.2,3.4,5.6,7.8,10].forEach(v=>scyl(M.galva,x+13,b+v,z-2,2.66,0.12));scyl(M.galva,x+13,b+12.7,z-2,0.35,0.5);
  [-0.22,0.22].forEach(e=>sbox(M.hierro,x+13+e,b+0.4,z-2+2.68,0.05,10.9,0.05,0,true));for(let v=0.8;v<11.2;v+=0.45)sbox(M.hierro,x+13,b+v,z-2+2.68,0.44,0.04,0.04,0,true);
  put('cyl',M.galva,x+10.2,b+6.4,z-2,0.14,13.2,0.14,0,0,0.0,true);put('cyl',M.galva,x+11.6,b+12.9,z-2,0.14,3.2,0.14,0,0,PI/2,true);
  sbox(M.puerta,x+9,b,z+12.05,1.1,2.2,0.1,0,true);sbox(M.recerco,x+9,b-0.02,z+12.03,1.5,2.4,0.06,0,true);
  [x+12,x+15.5].forEach(wx=>{sbox(M.recerco,wx,b+0.95,z+12.03,1.3,1.4,0.06,0,true);sbox(M.cristal,wx,b+1.05,z+12.05,1.0,1.15,0.1,0,true);sbox(M.recerco,wx,b+1.05,z+12.105,0.05,1.15,0.03,0,true);});
  sbox(M.cumbrera,x+12,b+3.6+1.6-0.03,z+9,12.8,0.12,0.34,0,true);
  sboxX(M.nave,x+6,x+18,b,b+3.6,z+6,z+12);gable(ROOF[1],M.nave,x+6,x+18,z+6,z+12,b+3.6,1.6,0.5,'x');
  // the tenada: a low stone sheepfold with a tiled roof, open to its walled yard on the south, the gate on the east
  const T=NIVEL.TENADA,tb=minH(T.x0,T.z0,T.x1,T.z2)-0.4;
  sboxX(M.piedra,T.x0,T.x1,tb,tb+2.8,T.z0,T.z1-0.2);gable(ROOF[2],M.piedra,T.x0,T.x1,T.z0,T.z1,tb+2.8,1.3,0.5,'x');
  for(let k=0;k<4;k++)sbox(M.puerta,T.x0+2.5+k*4.3,tb+0.4,T.z1-0.15,2.2,2.2,0.1,0,true);
  /* a timber lintel over the stalls, half-doors, the ridge; in the yard a trough, a hay rack and a stack of bales; the gate */
  sbox(M.madera,(T.x0+T.x1)/2,tb+2.55,T.z1-0.1,T.x1-T.x0-1.0,0.22,0.24,0,true);
  for(let k=0;k<4;k++){const gx=T.x0+2.5+k*4.3;sbox(M.maderaClara,gx,tb+0.4,T.z1-0.05,2.2,1.0,0.06,0,true);[0.25,0.75].forEach(v=>sbox(M.madera,gx,tb+0.4+v,T.z1-0.01,2.2,0.07,0.03,0,true));}
  sbox(M.cumbrera,(T.x0+T.x1)/2,tb+2.8+1.3-0.03,(T.z0+T.z1)/2,T.x1-T.x0+1.0,0.12,0.34,0,true);
  {const ty=groundH(T.x0+3,T.z2-2);sboxX(M.piedra2,T.x0+1.2,T.x0+4.6,ty,ty+0.45,T.z2-1.9,T.z2-1.1,true);sboxX(lam(0x6F9FB0),T.x0+1.32,T.x0+4.48,ty+0.4,ty+0.46,T.z2-1.8,T.z2-1.2,true);
    sboxX(M.madera,T.x0+0.6,T.x0+0.9,ty,ty+1.1,T.z1+1.5,T.z1+5.0,true);for(let v=0.25;v<1.1;v+=0.28)sboxX(M.maderaClara,T.x0+0.9,T.x0+1.25,ty+v,ty+v+0.06,T.z1+1.5,T.z1+5.0,true);
    [[0,0,0],[1.25,0,0],[0,0,0.85],[1.25,0,0.85],[0.6,0.62,0.4]].forEach(([dx,dy,dz])=>sbox(M.paca,T.x1-3.6+dx,ty+dy,T.z2-2.6+dz,1.15,0.6,0.75,0,true));
    const gz0=T.z1+3,gz1=T.z2-3.5,gl=gz1-gz0;[0.35,0.75,1.1].forEach(v=>sbox(M.madera,T.x1+gl/2,ty+v,gz0-0.1,gl,0.09,0.07,0,true));   // the gate, swung open against the wall
    for(let k=0;k<=4;k++)sbox(M.madera,T.x1+k*gl/4,ty+0.2,gz0-0.1,0.09,1.05,0.09,0,true);}
  sboxX(M.piedra,T.x0,T.x0+0.5,tb,tb+1.5,T.z1,T.z2);sboxX(M.piedra,T.x0,T.x1,tb,tb+1.5,T.z2-0.5,T.z2);
  sboxX(M.piedra,T.x1-0.5,T.x1,tb,tb+1.5,T.z1,T.z1+3);sboxX(M.piedra,T.x1-0.5,T.x1,tb,tb+1.5,T.z2-3.5,T.z2);
  sbox(M.madera,T.x1-0.25,tb+0.3,(T.z1+3+T.z2-3.5)/2,0.12,1.1,0.2,0,true);
})();
ent('tenada',{kind:'building',name:'Tenada',sub:'Corral de ovejas de la granja',rows:[['Rebaño','Unas 40 ovejas churras con su pastor y su perro'],['Pasto','Rastrojeras y barbechos de alrededor']]});
hitBox('tenada',(NIVEL.TENADA.x0+NIVEL.TENADA.x1)/2,0,(NIVEL.TENADA.z0+NIVEL.TENADA.z2)/2,18,5,20);
ent('granja',{kind:'building',name:'Granja de Los Llanos',sub:'Explotación de cereal',rows:[['Instalaciones','Nave, silo y vivienda'],['Acceso','Camino por el paso a nivel']]});
hitBox('granja',FARM.x,0,FARM.z+2,38,13,22);bb('granja',FARM.x-16,0,FARM.z-6,FARM.x+18,13,FARM.z+12);

/* plaza mayor: the town hall with its arcade on the west side, the fountain in front of it, a row of plane trees with stone
   benches along the east side (the Calle de la Iglesia runs through the middle) */
function benchW(x,z,ry){const y=groundH(x,z),s=Math.sin(ry),c=Math.cos(ry);
  sbox(M.madera,x,y+0.42,z,1.9,0.07,0.45,ry,true);sbox(M.madera,x-0.22*s,y+0.5,z-0.22*c,1.9,0.42,0.06,ry,true);
  [-0.8,0.8].forEach(u=>sbox(M.hierro,x+u*c,y,z-u*s,0.06,0.44,0.46,ry,true));}
(function plaza(){const P=PLZ;
  // fountain: stepped base levelled on the slope, basin, column with four spouts
  {const x=P.fx,z=P.fz,lo=Math.min(groundH(x-2.8,z),groundH(x+2.8,z),groundH(x,z-2.8),groundH(x,z+2.8))-0.05,
     hi=Math.max(groundH(x-2.8,z),groundH(x+2.8,z),groundH(x,z-2.8),groundH(x,z+2.8))+0.22;
   scyl(M.piedra2,x,lo,z,2.85,hi-lo);scyl(M.piedra,x,hi,z,2.25,0.72);scyl(lam(0x6F9FB0),x,hi+0.7,z,1.98,0.04);
   scyl(M.piedra2,x,hi,z,0.4,2.5);sico(M.piedra2,x,hi+2.62,z,0.5,0.3,0.5);scone(M.piedra2,x,hi+2.85,z,0.2,0.55);
   [[1,0],[-1,0],[0,1],[0,-1]].forEach(d=>sbox(M.bronce,x+d[0]*0.48,hi+1.95,z+d[1]*0.48,d[0]?0.42:0.08,0.08,d[1]?0.42:0.08,0,true));}
  [-93.75,-100.25].forEach(z=>{const y=groundH(-1.6,z);sbox(M.piedra2,-1.6,y-0.1,z,0.6,0.55,2.1);});
  [[P.fx,P.fz-5.4,0],[P.fx,P.fz+5.4,PI]].forEach(b=>benchW(b[0],b[1],b[2]));
})();
/* Casa Consistorial: stone, two floors, an arcade (soportales) on the plaza, balcony with the flag, clock and bell on an espadaña */
(function ayuntamiento(){const A=AYTO,x0=A.x0,x1=A.x1,z0=A.z0,z1=A.z1,zc=(z0+z1)/2;
  const b=minH(x0,z0,x1,z1)-0.6,g=maxH(x0,z0,x1,z1),f1=g+3.5,top=g+6.9,xr=x1-2.7;
  sboxX(M.piedra,x0,xr,b,f1,z0,z1);                       // ground floor, set back behind the arcade
  sboxX(M.piedra,x0,x1,f1,top,z0,z1);                     // upper floor, over the arcade
  sboxX(M.piedraOsc,x0-0.05,xr,b,b+1.1,z0-0.05,z1+0.05,true);
  for(let k=0;k<=5;k++){const z=z0+0.4+k*(z1-z0-0.8)/5,y=Math.min(groundH(x1-0.4,z),f1-3)-0.3;
    sboxX(M.piedra2,x1-0.75,x1-0.05,y,f1-0.4,z-0.35,z+0.35);sboxX(M.piedra2,x1-0.85,x1+0.05,f1-0.45,f1,z-0.65,z+0.65,true);}
  sboxX(M.piedra2,x1-0.1,x1+0.12,f1-0.05,f1+0.28,z0,z1,true);                       // string course over the arcade
  sboxX(M.piedra2,x1-0.05,x1+0.1,top-0.35,top,z0-0.1,z1+0.1,true);                    // cornice
  // doors and windows under the arcade
  [[z0+2.6,0],[zc,1],[z1-2.6,0]].forEach(([z,d])=>{const y=groundH(xr+0.5,z);
    if(d){sbox(M.puerta,xr+0.05,y,z,0.1,2.7,1.6,0,true);sbox(M.piedra2,xr+0.08,y+2.7,z,0.12,0.25,2.0,0,true);}
    else{sbox(winMat(xr,y+1.4,z),xr+0.05,y+0.9,z,0.1,1.4,1.0,0,true);sbox(M.hierro,xr+0.12,y+0.9,z,0.04,1.4,1.0,0,true);}});
  // upper floor: three balcony doors, the middle one with a stone balcony and iron railing
  [z0+3,zc,z1-3].forEach((z,i)=>{sbox(winMat(x1,f1+0.6,z),x1+0.04,f1+0.6,z,0.1,2.2,1.05,0,true);sbox(M.piedra2,x1+0.08,f1+2.8,z,0.12,0.22,1.45,0,true);
    const w=i===1?3.2:1.6;sboxX(M.piedra2,x1,x1+(i===1?0.9:0.45),f1+0.42,f1+0.58,z-w/2,z+w/2,true);
    sboxX(M.hierro,x1+(i===1?0.85:0.4),x1+(i===1?0.9:0.45),f1+0.58,f1+1.55,z-w/2,z+w/2,true);});
  /* the other three walls: stone-framed windows on both floors, so none is blank; ridge tiles */
  {const W=(axF,f,sg,u,y,ww,wh)=>{const Bx=(mat,d,w,h,t,dy)=>axF==='x'?sbox(mat,u,y+(dy||0),f+sg*d,w,h,t,0,true):sbox(mat,f+sg*d,y+(dy||0),u,t,h,w,0,true);
      Bx(M.piedra2,0.03,ww+0.36,wh+0.34,0.06,-0.16);Bx(axF==='x'?winMat(u,y,f):winMat(f,y,u),0.05,ww,wh,0.1);Bx(M.recerco,0.105,0.055,wh,0.03);Bx(M.recerco,0.105,ww,0.05,0.03,wh*0.62);Bx(M.piedra2,0.1,ww+0.46,0.1,0.2,-0.22);};
    [z0+2.6,zc,z1-2.6].forEach(z=>{W('z',x0,-1,z,f1+0.9,1.0,1.5);W('z',x0,-1,z,g+1.2,1.0,1.3);});
    [[z0,-1],[z1,1]].forEach(([z,sg])=>[x0+2.2,(x0+xr)/2+0.6].forEach(x=>{W('x',z,sg,x,f1+0.9,1.0,1.5);W('x',z,sg,x,g+1.2,1.0,1.3);}));}
  sbox(M.cumbrera,(x0+x1)/2,top+2.0-0.04,zc,0.36,0.14,z1-z0+1.1,0,true);
  gable(ROOF[2],M.piedra,x0,x1,z0,z1,top,2.0,0.55,'z');
  // espadaña over the façade: two piers, a lintel and a little pyramid, the bell in the opening, the clock below it
  const ex0=x1-0.6,ex1=x1-0.05;
  sboxX(M.piedra,ex0,ex1,top-0.4,top+1.2,zc-1.5,zc+1.5);
  [-1,1].forEach(s=>sboxX(M.piedra,ex0,ex1,top+1.2,top+2.7,zc+s*0.6,zc+s*1.5));
  sboxX(M.piedra,ex0,ex1,top+2.7,top+3.2,zc-1.5,zc+1.5);scone(M.piedra2,(ex0+ex1)/2,top+3.2,zc,0.5,0.9,true);
  sico(M.bronce,(ex0+ex1)/2,top+1.75,zc,0.42,0.48,0.42);
  put('cyl',M.blanco,x1+0.0,top+0.45,zc,0.48,0.08,0.48,0,0,PI/2,true);
  sbox(M.negro,x1+0.05,top+0.45,zc,0.03,0.34,0.05,0,true);sbox(M.negro,x1+0.05,top+0.45,zc+0.1,0.03,0.05,0.24,0,true);
  // flag on the balcony
  const fx=x1+0.75,fz=zc+1.3,fy=f1+0.58;scyl(M.hierro,fx,fy,fz,0.035,2.6,true);
  [[0,0xB3261E],[1,0xE8B92C],[2,0xB3261E]].forEach(([i,h])=>sbox(lam(h),fx,fy+2.5-(i===0?0.22:i===1?0.67:0.89),fz+0.72,0.03,i===1?0.45:0.22,1.4,0,true));
})();
ent('ayuntamiento',{kind:'building',name:'Ayuntamiento de Santa Olalla',sub:'Casa consistorial · Plaza Mayor',rows:[['Edificio','Piedra de sillería, soportales y espadaña con reloj'],
  ['Secretaría','Agrupada con otros pueblos: el secretario viene martes y jueves'],['Situación','Plaza Mayor']]});
hitBox('ayuntamiento',(AYTO.x0+AYTO.x1)/2,minH(AYTO.x0,AYTO.z0,AYTO.x1,AYTO.z1),(AYTO.z0+AYTO.z1)/2,AYTO.x1-AYTO.x0,12,AYTO.z1-AYTO.z0);
bb('ayuntamiento',AYTO.x0,minH(AYTO.x0,AYTO.z0,AYTO.x1,AYTO.z1),AYTO.z0,AYTO.x1,maxH(AYTO.x0,AYTO.z0,AYTO.x1,AYTO.z1)+11,AYTO.z1);

/* station square: kerbs, a small garden with benches and a hedge, the car park (cars can come and go: PARKING.bays) and a phone box */
/* vehicles built from models Dani supplied (.glb): only what can be seen from outside, faces turned outwards, simplified
   with their shape and colours, makers' badges left out. Each is stored as int16 millimetres, uint16 faces and one
   material per face, front towards +z, standing on y = 0; drawn double-sided like the originals, with normals smoothed
   across edges that bend less than 35°. 'paint' takes the colour of each vehicle.
   · mb100: Mercedes-Benz MB 100 D (1988–1995, built by MEVOSA in Vitoria) · 155,813 → 12,400 triangles
   · punto: Fiat Punto (1993) · 47,924 → 9,300 triangles · model by tonielpro520 (Sketchfab), CC BY 4.0
   · alpina: Alpina B7 Turbo Coupé (1982, BMW E24) · 225,792 → 10,300 triangles · model by tonielpro520 (Sketchfab), CC BY 4.0;
     its decals and the BMW and Alpina badges are left out
   · p205: Peugeot 205 (1997) · 244,213 → 12,900 triangles · model by tonielpro520 (Sketchfab), CC BY 4.0; lions and lettering left out
   · sec: Mercedes-Benz 560 SEC (C126) · 62,791 → 12300 triangles · model by tonielpro520 (Sketchfab), CC BY 4.0;
     the stars and the lettering left out; the front side windows come down, as in the model */
/* VEH: material.js */
return{benchW};};

/* ---- plazaEstacion · plaza y aparcamiento de la estación, señales de tráfico, árboles, pacas y tractor ---- */
NIVEL.plazaEstacion=function(){
const PARKING={bays:[]};
(function stationSquare(){const sq=SQ,K=(x0,z0,x1,z1)=>sboxX(M.bordillo,x0,x1,-0.04,0.14,z0,z1,true);
  K(sq.x0,sq.acera-0.15,sq.x1,sq.acera+0.15);K(-25.15,sq.z0,-24.85,sq.acera-0.15);K(sq.x0,sq.z0-0.15,-25,sq.z0+0.15);
  K(35,sq.z0+0.35,41.5,sq.z0+0.65);K(35,sq.acera-0.65,41.5,sq.acera-0.35);K(34.85,sq.z0+0.5,35.15,sq.acera-0.5);K(41.35,sq.z0+0.5,41.65,sq.acera-0.5);
  const hedge=lam(0x55663A);[[sq.x0+0.5,-36.6],[-34.4,-25.4]].forEach(([a,b])=>sboxX(hedge,a,b,0,0.75,sq.z0+0.35,sq.z0+1.05));
  sboxX(hedge,sq.x0+0.3,sq.x0+1.0,0,0.75,sq.z0+1,-33);sboxX(hedge,sq.x0+0.3,sq.x0+1.0,0,0.75,-31,sq.acera-0.5);
  [[-41,-33.4,0],[-30,-33.4,0],[-41,-30.6,PI],[-30,-30.6,PI]].forEach(b=>benchW(b[0],b[1],b[2]));
  // phone box and litter bins on the pavement
  {const x=-13,z=-22.3;sboxX(lam(0x9AA3A8),x-0.55,x+0.55,0,0.25,z-0.55,z+0.55);[[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([a,b])=>sbox(lam(0x6E7B86),x+a*0.5,0.25,z+b*0.5,0.08,2.0,0.08,0,true));
    sboxX(ds(M.cristal),x-0.5,x+0.5,0.9,2.2,z-0.5,z+0.5,true);sboxX(lam(0x2F6FA8),x-0.6,x+0.6,2.25,2.6,z-0.6,z+0.6);}
  [[-21,-23.4],[9,-23.4],[-25.8,-31.2]].forEach(([x,z])=>{scyl(M.hierro,x,0,z,0.04,0.7,true);scyl(lam(0x3E5E46),x,0.45,z,0.24,0.5,true);});
  // the "P" sign at the way in
  {const t=canvasTex(64,64,(c,w,h)=>{c.fillStyle='#1F57A4';c.fillRect(0,0,w,h);c.strokeStyle='#F4F1EA';c.lineWidth=3;c.strokeRect(3,3,w-6,h-6);c.fillStyle='#F4F1EA';c.font='bold 46px Arial,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('P',w/2,h/2+2);});
   const x=2.6,z=sq.z0-1.0;scyl(M.galva,x,0,z,0.04,2.6,true);const pl=new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.6),lam(0xFFFFFF,{map:t}));
   pl.position.set(x,2.35,z-0.05);pl.rotation.y=PI;scene.add(pl);sboxX(M.galva,x-0.3,x+0.3,2.05,2.65,z+0.0,z+0.03,true);}
  // the bays: the traffic module parks the cars in them
  for(let r=0;r<2;r++)for(let k=0;k<PK.n;k++){const x=PK.x0+(k+0.5)*PK.bay,z=r?(PK.rowN[0]+PK.rowN[1])/2:(PK.rowS[0]+PK.rowS[1])/2;
    PARKING.bays.push({x:x,z:z,d:r?-1:1,car:null});}
  PARKING.bays.forEach(B=>{B.occ=0;});
})();
ent('aparcamiento',{kind:'building',name:'Aparcamiento de la estación',sub:'Plaza de la estación',rows:[['Plazas',PARKING.bays.length+' · 2,5 × 5 m'],['Uso','Viajeros de la comarca que vienen en coche a coger el tren']]});
hitBox('aparcamiento',PK.x0+PK.n*PK.bay/2,0,(PK.rowN[0]+PK.rowS[1])/2,PK.n*PK.bay,1.6,PK.rowS[1]-PK.rowN[0]);
bb('aparcamiento',PK.x0,0,PK.rowN[0],PK.x0+PK.n*PK.bay,1.6,PK.rowS[1]);

/* village name signs where the road comes in (white plate, black lettering) */
(function signs(){const t=canvasTex(256,112,(c,w,h)=>{c.fillStyle='#F4F2EC';c.fillRect(0,0,w,h);c.strokeStyle='#1E2022';c.lineWidth=6;c.strokeRect(7,7,w-14,h-14);
    c.fillStyle='#1E2022';c.textAlign='center';c.textBaseline='middle';c.font='bold 34px Arial,sans-serif';c.fillText('Santa Olalla',w/2,h/2-16);c.font='bold 25px Arial,sans-serif';c.fillText('de Bureba',w/2,h/2+22);});
  const mat=lam(0xFFFFFF,{map:t}),back=lam(0x8A8F8C);
  [[-133.6,-71.2,-0.944,0.329],[91.4,-86.1,0.994,-0.110]].forEach(([x,z,nx,nz])=>{const y=groundH(x,z),ry=Math.atan2(nx,nz),tx=nz,tz=-nx;
    [-0.55,0.55].forEach(u=>scyl(M.galva,x+tx*u,y-0.2,z+tz*u,0.04,2.5,true));
    const pl=new THREE.Mesh(new THREE.PlaneGeometry(1.6,0.7),mat);pl.position.set(x+nx*0.03,y+1.95,z+nz*0.03);pl.rotation.y=ry;pl.castShadow=true;scene.add(pl);
    sbox(back,x,y+1.6,z,1.6,0.7,0.03,ry,true);});
})();

/* trees, bales and a tractor */
TREES.forEach(t=>{
  const y=groundH(t.x,t.z);
  /* drawn in NIVEL.vegetacion (the trees), with the season; the draws stay here so the rest comes out the same */
  t.y=y;if(t.k==='chopo')t.c=rnd()<.6?0:1;else if(t.k!=='platano')t.c=pick([0,1,2]);
});
for(let i=0;i<16;i++){rr(6,116);rr(40,74);rnd();}   // the bales and the tractor go with the season now (vegetacion, ambiente): the draws stay so the rest comes out the same

return{PARKING};};

/* ---- vegetacion · el campo: cereal y rastrojo según el mes, pacas, hierba, ribazos, cardos, arbustos (retama, escaramujo,
   zarza), piedras y majanos; corrales y traseras de las casas; postes del telégrafo e hitos kilométricos de la vía.
   Todo de pocos polígonos e instanciado. ---- */
NIVEL.vegetacion=function(){
const VR=mulberry(80431),vr=(a,b)=>a+(b-a)*VR(),K=IS_PHONE?0.5:1;
const inPoly=(x,z,P)=>{let c=false;for(let i=0,j=P.length-1;i<P.length;j=i++){const a=P[i],b=P[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
const ring=P=>P.concat([P[0]]);
const fieldAt=(x,z)=>FIELDS.find(f=>inPoly(x,z,f.poly));
const edgeOf=new Map(FIELDS.map(f=>[f,ring(f.poly)])),edgeD=(f,x,z)=>distPoly(x,z,edgeOf.get(f));
const inVillage=(x,z)=>x>VD.x0&&x<VD.x1&&z>VD.z0&&z<VD.z1;
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
// the trees in 10 m cells, so each spot only looks at its neighbours
const TG=new Map(),tk=(i,j)=>i*1000+j;TREES.forEach(t=>{const k=tk(Math.floor(t.x/10),Math.floor(t.z/10));(TG.get(k)||TG.set(k,[]).get(k)).push(t);});
function nearTree(x,z,f){const i=Math.floor(x/10),j=Math.floor(z/10);for(let a=i-1;a<=i+1;a++)for(let b=j-1;b<=j+1;b++){const L=TG.get(tk(a,b));if(L)for(const t of L)if(Math.hypot(t.x-x,t.z-z)<f(t))return true;}return false;}
const T=NIVEL.TENADA;
const yards=[[-82,24,16,34],[FARM.x-22,FARM.z-12,FARM.x+22,FARM.z+16],[6,-114,46,-95],[-46,-40,42,-4],[T.x0-2,T.z0-2,T.x1+2,T.z2+2],
  [-118,-70,-104,-66],[30,-70,46,-64],[-90,-102,-76,-92],[44,-128,60,-120]];   // muelle, farm, churchyard, station square, tenada, the stone corrals
const inYard=(x,z,m)=>yards.some(r=>x>r[0]-m&&x<r[2]+m&&z>r[1]-m&&z<r[3]+m);
const nearRoadV=(x,z,m)=>{for(const k in ROADS)if(distPoly(x,z,ROADS[k].pts)<ROADS[k].w/2+0.9+m)return true;
  for(const k in ROADS2)if(distPoly(x,z,ROADS2[k])<3.6+m)return true;return CAMINOS.some(c=>distPoly(x,z,c.pts)<c.w/2+0.4+m);};
/* open ground: off the fields, the railway, the roads and tracks, the yards, the houses and the trunks */
function open(x,z,m){
  if(x<X0+2||x>X1-2||z<Z0+2||z>Z1-2)return false;
  if(z>-6&&z<26)return false;                                   // railway corridor
  if(!isFree(x-m,z-m,x+m,z+m)||inYard(x,z,m))return false;
  if(inVillage(x,z)&&HOUSES.some(h=>x>h.x0-1.8&&x<h.x1+1.8&&z>h.z0-1.8&&z<h.z1+1.8))return false;
  if(nearRoadV(x,z,m))return false;
  if(nearTree(x,z,t=>(t.k==='encina'?t.r*0.55:0.7)+m))return false;
  return true;
}
/* a clump of blades: n triangles leaning out round a centre, darker at the foot (vertex colour) */
function tuft(n,w,lean){const P=[],N=[],C=[];
  for(let i=0;i<n;i++){const a=i*TAU/n+0.4*Math.sin(i*2.3),ca=Math.cos(a),sa=Math.sin(a),px=-sa*w/2,pz=ca*w/2,r0=0.22*(i%2);
    const bx=ca*r0,bz=sa*r0,l=lean*(0.7+0.3*(i%3));
    P.push(bx+px,0,bz+pz, bx-px,0,bz-pz, bx+ca*l,1-0.18*(i%3),bz+sa*l);
    const nl=Math.hypot(ca*0.35,1,sa*0.35);for(let k=0;k<3;k++)N.push(ca*0.35/nl,1/nl,sa*0.35/nl);
    C.push(0.36,0.36,0.36, 0.36,0.36,0.36, 1,1,1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(N,3));g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));return g;}
const vmat=()=>lam(0xFFFFFF,{vertexColors:true,side:THREE.DoubleSide});
const _v=new THREE.Object3D(),_col=new THREE.Color();
function mesh(geo,mat,n,shadow){const m=new THREE.InstancedMesh(geo,mat,Math.max(1,n));m.count=n;
  for(let i=0;i<Math.max(1,n);i++)m.setColorAt(i,_col.setRGB(1,1,1));   // the colour buffer from the start (the shader is built with it)
  m.castShadow=!!shadow;m.receiveShadow=true;m.frustumCulled=false;scene.add(m);return m;}
// colours are given in sRGB, like the hex ones
function place(m,list,f){m.count=list.length;list.forEach((q,i)=>{f(q,_v,_col);_col.convertSRGBToLinear();_v.updateMatrix();m.setMatrixAt(i,_v.matrix);m.setColorAt(i,_col);});
  m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
const G={cereal:tuft(5,0.5,0.42),stub:tuft(5,0.08,0.15),grass:tuft(6,0.3,0.5),tall:tuft(7,0.16,0.35),cardo:tuft(8,0.22,0.7),
  stone:new THREE.IcosahedronGeometry(1,0),bush:new THREE.DodecahedronGeometry(1,0),bale:new THREE.CylinderGeometry(1,1,1,10)};

/* ---- corrales: behind the houses of the village, a yard walled with adobe or stone (a door in the back wall): a fruit
   tree, the hen house, the woodpile, the washing line, a kitchen garden in the bigger ones ---- */
const YARDS=[],FRUIT=[],HUERTO=[];
const ADOBE=[0xC4A27A,0xB9976F,0xCDB08A,0xB08E68];
HOUSES.forEach((h,hi)=>{if(!inVillage((h.x0+h.x1)/2,(h.z0+h.z1)/2)&&Math.abs(h.x0)>130)return;
  const back={n:'s',s:'n',e:'w',w:'e'}[h.front];   // the side the yard goes: opposite the street
  const d=vr(4.5,8.5);let r;
  if(back==='n')r=[h.x0,h.z0-d,h.x1,h.z0];else if(back==='s')r=[h.x0,h.z1,h.x1,h.z1+d];
  else if(back==='w')r=[h.x0-d,h.z0,h.x0,h.z1];else r=[h.x1,h.z0,h.x1+d,h.z1];
  const away=back==='n'?[0,-1]:back==='s'?[0,1]:back==='w'?[-1,0]:[1,0];
  // clear of the other houses, the streets, the trees, the plaza and church (isFree, looked at past the own house's margin), the other yards
  const t0=[r[0]+(away[0]>0?0.8:0),r[1]+(away[1]>0?0.8:0),r[2]-(away[0]<0?0.8:0),r[3]-(away[1]<0?0.8:0)];
  if(!isFree(t0[0],t0[1],t0[2],t0[3]))return;
  if(HOUSES.some((o,oi)=>oi!==hi&&r[0]<o.x1+0.6&&r[2]>o.x0-0.6&&r[1]<o.z1+0.6&&r[3]>o.z0-0.6))return;
  if(YARDS.some(o=>r[0]<o.r[2]+0.3&&r[2]>o.r[0]-0.3&&r[1]<o.r[3]+0.3&&r[3]>o.r[1]-0.3))return;
  if(inYard((r[0]+r[2])/2,(r[1]+r[3])/2,Math.max(r[2]-r[0],r[3]-r[1])/2))return;
  for(let u=0;u<=1;u+=0.25)for(let w=0;w<=1;w+=0.25){const x=r[0]+(r[2]-r[0])*u,z=r[1]+(r[3]-r[1])*w;if(nearRoadV(x,z,0.3)||nearTree(x,z,t=>t.r*0.6+0.3))return;}
  if(VR()<0.12)return;                                            // not every house has one
  YARDS.push({r,h:hi,back,away});});
YARDS.forEach(Y=>{const r=Y.r,y=Math.min(groundH(r[0],r[1]),groundH(r[2],r[3]),groundH(r[0],r[3]),groundH(r[2],r[1]))-0.3;Y.y=y;
  const stone=VR()<0.3,wm=stone?M.piedra:lam(ADOBE[Math.floor(VR()*ADOBE.length)]),hgt=vr(1.6,2.1),th=0.35;
  const W=(x0,z0,x1,z1)=>{sboxX(wm,x0,x1,y,y+hgt,z0,z1);if(!stone)sboxX(ROOF[0],x0-0.06,x1+0.06,y+hgt,y+hgt+0.12,z0-0.06,z1+0.06,true);};
  const[ax,az]=Y.away;
  // the three walls (the house closes the fourth); the back one with a door
  if(az){const zb=az>0?r[3]-th:r[1];const dx=vr(r[0]+1.2,r[2]-2.4);
    W(r[0],zb,dx,zb+th);W(dx+1.3,zb,r[2],zb+th);sbox(M.puerta,dx+0.65,y,zb+th/2,1.3,hgt-0.15,th+0.06,0,true);
    W(r[0],Math.min(r[1],r[3]),r[0]+th,Math.max(r[1],r[3]));W(r[2]-th,r[1],r[2],r[3]);}
  else{const xb=ax>0?r[2]-th:r[0];const dz=vr(r[1]+1.2,r[3]-2.4);
    W(xb,r[1],xb+th,dz);W(xb,dz+1.3,xb+th,r[3]);sbox(M.puerta,xb+th/2,y,dz+0.65,th+0.06,hgt-0.15,1.3,0,true);
    W(r[0],r[1],r[2],r[1]+th);W(r[0],r[3]-th,r[2],r[3]);}
  const ix0=r[0]+0.8,ix1=r[2]-0.8,iz0=r[1]+0.8,iz1=r[3]-0.8;if(ix1-ix0<1.5||iz1-iz0<1.5)return;
  const spot=()=>({x:vr(ix0,ix1),z:vr(iz0,iz1)});
  // a fruit tree (peral, manzano, ciruelo): the crown goes with the season
  if(VR()<0.7){const p=spot(),gy=groundH(p.x,p.z);scyl(M.tronco,p.x,gy,p.z,0.14,1.5,true);
    [[0.6,0],[0.5,2.1],[0.55,4.2]].forEach(([l,a])=>put('cyl6',M.tronco,p.x+Math.cos(a)*0.25,gy+1.75,p.z+Math.sin(a)*0.25,0.05,l,0.05,Math.sin(a)*0.6,0,-Math.cos(a)*0.6,true));
    FRUIT.push({x:p.x,y:gy+2.1,z:p.z,r:vr(1.1,1.6),j:vr(-1,1)});}
  // the hen house: a lean-to of brick and corrugated sheet against the wall, a few hens about
  if(VR()<0.6){const w=1.8,d=1.4,cx=az?vr(ix0+w/2,ix1-w/2):(ax>0?ix1-d/2:ix0+d/2),cz=az?(az>0?iz1-d/2:iz0+d/2):vr(iz0+w/2,iz1-w/2),gy=groundH(cx,cz);
    sbox(M.cal2,cx,gy,cz,az?w:d,1.3,az?d:w);sbox(ds(M.chapa),cx,gy+1.3,cz,(az?w:d)+0.3,0.06,(az?d:w)+0.3,0,true);
    sbox(M.puerta,cx,gy,cz-(az?az*d/2:0)*1.02,0.5,0.6,0.06,0,true);
    for(let k=0;k<3;k++){const hx=cx+vr(-1.5,1.5),hz=cz-az*vr(1,2)-ax*0,hy=groundH(hx,hz);if(hx<ix0||hx>ix1||hz<iz0||hz>iz1)continue;
      const c=VR()<0.5?M.cigueña:lam(0x9A5A30);put('ico',c,hx,hy+0.22,hz,0.16,0.15,0.2,0,VR()*TAU,0,true);put('box',M.rojo,hx,hy+0.38,hz,0.04,0.06,0.06,0,0,0,true);}}
  // the woodpile against a wall: logs of encina, stacked
  if(VR()<0.65){const L=vr(1.6,2.6),gx=az?vr(ix0+L/2,ix1-L/2):(ax>0?ix0+0.3:ix1-0.3),gz=az?(az>0?iz0+0.3:iz1-0.3):vr(iz0+L/2,iz1-L/2),gy=groundH(gx,gz);
    for(let row=0;row<3;row++)for(let k=0;k<Math.round(L/0.22);k++){const o=-L/2+0.11+k*0.22+(row%2)*0.06;if(o>L/2-0.1)continue;
      put('cyl6',VR()<0.5?M.madera:M.maderaClara,az?gx+o:gx,gy+0.11+row*0.19,az?gz:gz+o,0.1,0.55,0.1,az?PI/2:0,0,az?0:PI/2,true);}}
  // the washing line
  if(VR()<0.5){const a=spot(),b={x:a.x+(az?3:0.2),z:a.z+(az?0.2:3)};if(b.x<ix1+0.5&&b.z<iz1+0.5){const gy=groundH(a.x,a.z);
    [a,b].forEach(p=>scyl(M.madera,p.x,gy,p.z,0.04,1.8,true));put('box',M.blanco,(a.x+b.x)/2,gy+1.78,(a.z+b.z)/2,az?3:0.02,0.02,az?0.02:3,0,0,0,true);
    const CL=[0xF2F0EA,0x8FA7C8,0xC94A3A,0xE6D6A8,0x3D5A80,0xF2F0EA];for(let k=0;k<4;k++){if(VR()<0.25)continue;const t=0.15+k*0.22,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,hh=vr(0.5,0.8);
      put('box',lam(CL[k+Math.floor(VR()*2)]),x,gy+1.78-hh/2,z,az?vr(0.4,0.6):0.02,hh,az?0.02:vr(0.4,0.6),0,0,0,true);}}}
  // a kitchen garden in the bigger yards: dug earth and rows of greens
  if((ix1-ix0)*(iz1-iz0)>22&&VR()<0.6){const w=Math.min(4,(ix1-ix0)*0.6),d=Math.min(3.5,(iz1-iz0)*0.6),cx=ix0+w/2+0.3,cz=(az>0?iz1-d/2:iz0+d/2);
    sbox(lam(0x5E4630),cx,groundH(cx,cz)-0.02,cz,w,0.06,d,0,true);
    for(let u=-w/2+0.4;u<w/2-0.2;u+=0.6)for(let v=-d/2+0.3;v<d/2-0.2;v+=0.35)HUERTO.push({x:cx+u,z:cz+v,y:groundH(cx+u,cz+v)+0.02,s:vr(0.8,1.2),r:vr(0,TAU)});}
});
NIVEL.YARDS=YARDS;
YARDS.forEach(Y=>yards.push([Y.r[0]-0.3,Y.r[1]-0.3,Y.r[2]+0.3,Y.r[3]+0.3]));
const fmat=()=>lam(0xFFFFFF,{vertexColors:true}),wood=()=>lam(0xFFFFFF,{vertexColors:true,side:THREE.DoubleSide}),NL=IS_PHONE?3:5;
const fruitM=mesh(crownRound(771,4),fmat(),FRUIT.length,true),hueM=mesh(G.grass,vmat(),HUERTO.length);

/* ---- the trees: the encinas of the hills and the fields (evergreen: a short trunk that forks under a wide, dense crown,
   flat underneath), the Lombardy poplars along the road and the plane trees of the two squares. Poplars and planes go
   with the season: fresh green in April, yellow in October, thinning in November, bare from December to March, when
   only their trunks and boughs are left ---- */
const EN=TREES.filter(t=>t.k==='encina'),CH=TREES.filter(t=>t.k==='chopo'),
  PL=TREES.filter(t=>t.k==='platano').map(t=>({x:t.x,z:t.z,r:t.r,cy:5.4})).concat(PLZ_TREES.map(q=>({x:q[0],z:q[1],r:3.1,cy:5.3})));
[EN,CH,PL].forEach(L=>L.forEach(t=>{t.y=groundH(t.x,t.z);t.h1=vegHash(t.x,t.z,1);t.h2=vegHash(t.z,t.x,2);}));
const enL=[0,1,2].map(k=>EN.filter((t,i)=>i%3===k)),enM=enL.map((L,k)=>mesh(crownRound(311+k*17,NL,-0.3),fmat(),L.length,true));
const ENC=[[0.30,0.37,0.23],[0.36,0.42,0.25],[0.25,0.32,0.20]];
enM.forEach((m,k)=>place(m,enL[k],(t,o,c)=>{const r=t.r;o.position.set(t.x,t.y+0.55*r+0.9,t.z);o.rotation.set(0,t.h1*TAU,0);o.scale.set(r,r*(0.92+0.2*t.h2),r);
  const b=ENC[t.c||0],j=t.h2-0.5;c.setRGB(b[0]*(1+0.16*j),b[1]*(1+0.14*j),b[2]*(1+0.14*j));}));
const enT=mesh((()=>{const P=[];vegTube(P,[0,-0.15,0],[0,1,0],1,0.7,6);[0.3,2.4,4.5].forEach(a=>vegTube(P,[0,0.7,0],[Math.cos(a)*2.5,1.2,Math.sin(a)*2.5],0.55,0.2,5));return vegGeo(P,{lo:0.75,hi:1.05});})(),wood(),EN.length,true);
place(enT,EN,(t,o,c)=>{const r=t.r;o.position.set(t.x,t.y,t.z);o.rotation.set(0,t.h2*TAU,0);o.scale.set(0.08*r+0.12,0.55*r+0.9,0.08*r+0.12);c.setRGB(0.36+0.05*t.h1,0.30+0.04*t.h1,0.24+0.03*t.h1);});
const chL=[0,1].map(k=>CH.filter((t,i)=>i%2===k)),chM=chL.map((L,k)=>mesh(crownChopo(71+k*26),fmat(),L.length,true));
const chS=mesh((()=>{const P=[];vegTube(P,[0,-0.3,0],[0,12.4,0],0.26,0.03,6);
  // ascending boughs, close to the trunk, all the way up: bare in winter they still draw the column
  for(let k=0;k<24;k++){const y=2.2+k*0.4,a=k*2.39996,l=(0.85-0.02*k)*(0.75+0.4*vegHash(k,1,2)),top=y+2.3-0.05*k,e=[Math.cos(a)*l,top,Math.sin(a)*l];vegTube(P,[0,y,0],e,0.06-0.0015*k,0.012,3);
    if(k%2===0)vegTube(P,[e[0]*0.6,y+(top-y)*0.6,e[2]*0.6],[Math.cos(a+0.9)*l*1.05,top-0.2,Math.sin(a+0.9)*l*1.05],0.022,0.008,3);}
  return vegGeo(P,{lo:0.8,hi:1.05});})(),wood(),CH.length,true);
place(chS,CH,(t,o,c)=>{o.position.set(t.x,t.y,t.z);o.rotation.set(0,t.h2*TAU,0);o.scale.set(t.r/1.5,0.92+0.16*t.h1,t.r/1.5);c.setRGB(0.50,0.45,0.38);});
const plM=mesh(crownRound(533,NL+1,undefined,1.25),fmat(),PL.length,true);
const plS=mesh((()=>{const P=[];vegTube(P,[0,-0.3,0],[0,3.3,0],0.34,0.25,7);for(let k=0;k<5;k++){const a=k*TAU/5+0.3,e=[Math.cos(a)*1.7,5.5,Math.sin(a)*1.7];vegTube(P,[0,3.0,0],e,0.16,0.07,5);
    [-0.55,0,0.55].forEach(d=>vegTube(P,e,[Math.cos(a+d)*(d?2.3:2.0),d?6.5:7.0,Math.sin(a+d)*(d?2.3:2.0)],0.065,0.015,4));}return vegGeo(P,{lo:0.85,hi:1.05});})(),wood(),PL.length,true);
place(plS,PL,(t,o,c)=>{o.position.set(t.x,t.y,t.z);o.rotation.set(0,t.h1*TAU,0);o.scale.set(t.r/3.2,1,t.r/3.2);c.setRGB(0.62,0.58,0.48);});
function treeSeason(m){
  const cho=m===3?[[0.62,0.72,0.34],0.82]:m>=4&&m<=8?[[0.40,0.53,0.24],1]:m===9?[[0.80,0.68,0.24],1]:m===10?[[0.84,0.64,0.22],0.74]:[null,0];
  chM.forEach((mm,k)=>{mm.visible=cho[1]>0;if(!cho[1])return;place(mm,chL[k],(t,o,c)=>{const hv=0.92+0.16*t.h1,f=cho[1];o.position.set(t.x,t.y+7.4*hv,t.z);o.rotation.set(0,t.h1*TAU,0);o.scale.set(t.r*f,5.6*hv*(0.9+0.1*f),t.r*f);
    const b=cho[0],j=t.h2-0.5;c.setRGB(b[0]*(t.c?0.86:1)*(1+0.1*j),b[1]*(1+0.1*j),b[2]*(1+0.1*j));});});
  const pla=m===3?[[0.60,0.68,0.34],0.85]:m>=4&&m<=8?[[0.50,0.58,0.28],1]:m===9?[[0.72,0.60,0.26],1]:m===10?[[0.66,0.47,0.22],0.75]:[null,0];
  plM.visible=pla[1]>0;if(pla[1])place(plM,PL,(t,o,c)=>{const f=pla[1];o.position.set(t.x,t.y+t.cy,t.z);o.rotation.set(0,t.h2*TAU,0);o.scale.set(t.r*f,t.r*f,t.r*f);const b=pla[0],j=t.h2-0.5;c.setRGB(b[0]*(1+0.08*j),b[1]*(1+0.08*j),b[2]*(1+0.08*j));});
}

/* ---- cereal and stubble: each field its own clumps, made the first time it needs them; in rows along the furrows ---- */
const CEL=[],STL=[];
function sow(fi,cer){const f=FIELDS[fi],xs=f.poly.map(p=>p[0]),zs=f.poly.map(p=>p[1]),R0=mulberry(9100+fi*17+(cer?0:500)),r0=(a,b)=>a+(b-a)*R0();
  const ca=Math.cos(f.ang),sa=Math.sin(f.ang),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
  const R=Math.hypot(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs))/2+2;
  const du=(cer?1.0:2.6)/Math.sqrt(K),dv=(cer?0.92:1.5)/Math.sqrt(K),L=[];   // along the row, across
  for(let v=-R;v<R;v+=dv)for(let u=-R;u<R;u+=du){
    const x=cx+u*ca-v*sa+r0(-0.15,0.15)*(cer?1:6),z=cz+u*sa+v*ca+r0(-0.1,0.1)*(cer?1:3);
    if(x>X1-2||x<X0+2||z>Z1-2||z<Z0+2||!inPoly(x,z,f.poly)||edgeD(f,x,z)<(cer?1.2:1.6))continue;
    if(!cer&&R0()<0.35)continue;
    if(inYard(x,z,0.5)||!isFree(x-0.4,z-0.4,x+0.4,z+0.4)||nearRoadV(x,z,0)||nearTree(x,z,t=>t.r*0.6))continue;
    L.push({x,z,y:groundH(x,z)-0.03,s:r0(0.85,1.15),r:r0(0,TAU),j:r0(-1,1),k:fbm(x*0.05+3,z*0.05+9)});}
  return L;}
function fieldMesh(arr,fi,cer){if(!arr[fi]){const L=sow(fi,cer);arr[fi]={L,m:mesh(cer?G.cereal:G.stub,vmat(),L.length)};}return arr[fi];}
/* bales on this summer's stubble: round bales of straw, lying in the field until they are carted in October */
const BALES=FIELDS.map((f,fi)=>{const R0=mulberry(7300+fi),L=[],xs=f.poly.map(p=>p[0]),zs=f.poly.map(p=>p[1]);
  const n=Math.min(70,Math.round(Math.abs(xs.reduce((s,x,i)=>s+x*zs[(i+1)%zs.length]-xs[(i+1)%xs.length]*zs[i],0))/2/380));
  for(let i=0,tries=0;i<n&&tries<n*20;tries++){const x=Math.min(...xs)+(Math.max(...xs)-Math.min(...xs))*R0(),z=Math.min(...zs)+(Math.max(...zs)-Math.min(...zs))*R0();
    if(x>X1-3||x<X0+3||z>Z1-3||!inPoly(x,z,f.poly)||edgeD(f,x,z)<4||inYard(x,z,2)||!isFree(x-1,z-1,x+1,z+1)||nearTree(x,z,t=>t.r+1))continue;
    L.push({x,z,y:groundH(x,z),a:R0()*PI});i++;}
  return L;});
const baleM=mesh(G.bale,lam(0xFFFFFF),BALES.reduce((s,L)=>s+L.length,0),true);

/* ---- matas de hierba, in patches: thicker on the hills, along the linderos and the cunetas, thin round the village ---- */
const GR=[],BU=[],TALL=[],CARDO=[],STONE=[];
function patch(x,z,n,spread){for(let k=0;k<n;k++){const a=vr(0,TAU),d=spread*Math.sqrt(VR()),px=x+Math.cos(a)*d,pz=z+Math.sin(a)*d;
  const f=fieldAt(px,pz);if(f&&edgeD(f,px,pz)>1.0)continue;if(!open(px,pz,0.2))continue;
  GR.push({x:px,z:pz,y:groundH(px,pz)-0.04,s:vr(0.7,1.3),r:vr(0,TAU),j:vr(-1,1),dry:VR()});}}
const NG=Math.round(8000*K);
for(let i=0;i<NG;i++){const x=vr(X0+2,X1-2),z=vr(Z0+2,Z1-2),f=fieldAt(x,z);
  let dens;
  if(f){if(edgeD(f,x,z)>1.2)continue;dens=1;}
  else if(z<-112)dens=0.45+0.5*fbm(x*0.04,z*0.04);
  else if(inVillage(x,z))dens=0.3;
  else dens=0.8;
  if(VR()>dens)continue;patch(x,z,2+Math.floor(VR()*5),1.6);}
// the cess beyond the ballast: weeds along the railway, outside the platforms and the yards
for(let x=X0+3;x<X1-3;x+=3.2/K)[-7.4,27].forEach(z0=>{if(VR()<0.3)return;patch(x+vr(-1,1),z0+vr(-1.2,1.2),2+Math.floor(VR()*3),1.2);});
// the verges of the roads
Object.values(ROADS).filter(r=>r.asphalt).map(r=>r.pts).concat(Object.values(ROADS2)).forEach(P=>{for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/L,nz=(b[0]-a[0])/L;
  for(let d=0;d<L;d+=4/K)[-1,1].forEach(sd=>{if(VR()<0.4)return;const t=d/L;patch(a[0]+(b[0]-a[0])*t+sd*nx*5,a[1]+(b[1]-a[1])*t+sd*nz*5,2+Math.floor(VR()*3),1.0);});}});
/* ribazos: the strip between two fields and along the edge of each, where the plough does not reach: tall grass gone to seed */
FIELDS.forEach(f=>{const P=edgeOf.get(f);for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/L,nz=(b[0]-a[0])/L;
  for(let d=vr(0,1);d<L;d+=vr(0.7,1.6)/K){const t=d/L,o=vr(-0.8,0.8),x=a[0]+(b[0]-a[0])*t+nx*o,z=a[1]+(b[1]-a[1])*t+nz*o;
    if(fbm(x*0.06+2,z*0.06+4)<0.38||!open(x,z,0.15))continue;TALL.push({x,z,y:groundH(x,z)-0.04,s:vr(0.8,1.3),r:vr(0,TAU),j:vr(-1,1)});}}});
/* cardos on the dry waste ground and the road verges; stones, more of them on the hills; majanos, the heaps of stones
   picked off the fields, at the corners and on the linderos */
for(let i=0;i<Math.round(9000*K);i++){const x=vr(X0+2,X1-2),z=vr(Z0+2,Z1-2);if(fieldAt(x,z)||inVillage(x,z))continue;
  if(VR()>(z<-112?0.25:0.5)*smooth(0.35,0.6,fbm(x*0.03+9,z*0.03+1)))continue;if(!open(x,z,0.2))continue;
  CARDO.push({x,z,y:groundH(x,z)-0.03,s:vr(0.8,1.3),r:vr(0,TAU),j:vr(-1,1)});}
for(let i=0;i<Math.round(6000*K);i++){const x=vr(X0+2,X1-2),z=vr(Z0+2,Z1-2);if(fieldAt(x,z))continue;
  if(VR()>(z<-112?0.6:inVillage(x,z)?0.05:0.18))continue;if(!open(x,z,0.3))continue;
  STONE.push({x,z,y:groundH(x,z),r:vr(0.12,z<-112?0.45:0.3),a:vr(0,TAU),b:vr(0,TAU),j:vr(-1,1)});}
const MAJ=[];
FIELDS.forEach((f,fi)=>{const P=edgeOf.get(f);for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/L,nz=(b[0]-a[0])/L;
  for(let d=vr(10,40);d<L-6;d+=vr(45,110)){const t=d/L,x=a[0]+(b[0]-a[0])*t-nx*2.2,z=a[1]+(b[1]-a[1])*t-nz*2.2;   // just outside the field
    if(fieldAt(x,z)||!open(x,z,2))continue;MAJ.push({x,z});}}});
MAJ.forEach(m=>{const R0=vr(1.4,2.4),n=Math.round(R0*9);for(let k=0;k<n;k++){const a=vr(0,TAU),d=R0*Math.sqrt(VR()),x=m.x+Math.cos(a)*d,z=m.z+Math.sin(a)*d,h=(1-d/R0)*R0*0.45;
  STONE.push({x,z,y:groundH(x,z)+h,r:vr(0.22,0.42),a:vr(0,TAU),b:vr(0,TAU),j:vr(-1,1),maj:1});}
  for(let k=0;k<6;k++){const a=vr(0,TAU),d=R0+vr(0,0.6);GR.push({x:m.x+Math.cos(a)*d,z:m.z+Math.sin(a)*d,y:groundH(m.x,m.z)-0.04,s:vr(0.9,1.3),r:vr(0,TAU),j:vr(-1,1),dry:VR()});}
  if(VR()<0.6)BU.push({x:m.x+vr(-1,1),z:m.z+vr(-1,1),y:groundH(m.x,m.z),r:vr(0.8,1.3),k:VR()<0.6?'zarza':'escaramujo',a:vr(0,TAU),j:vr(-1,1)});});

/* ---- arbustos: retama (dark green, round), escaramujo and zarza (bramble, low and spread). In lines along the linderos
   (the strip nobody ploughs between two fields and along the tracks), scattered under the encinas on the hillsides,
   here and there on the waste ground ---- */
function bush(x,z,k){const r=k==='zarza'?vr(0.9,1.7):k==='retama'?vr(0.7,1.2):vr(0.6,1.0);if(!open(x,z,r*0.5))return;
  const f=fieldAt(x,z);if(f&&edgeD(f,x,z)>0.6)return;
  BU.push({x,z,y:groundH(x,z),r,k,a:vr(0,TAU),j:vr(-1,1)});
  if(k!=='retama'&&VR()<0.7){const a=vr(0,TAU),d=r*0.8;BU.push({x:x+Math.cos(a)*d,z:z+Math.sin(a)*d,y:groundH(x,z),r:r*0.7,k,a:vr(0,TAU),j:vr(-1,1)});}}
const kind=()=>VR()<0.45?'retama':VR()<0.55?'zarza':'escaramujo';
FIELDS.forEach(f=>{const P=edgeOf.get(f);for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);
  for(let d=vr(0,6);d<L;d+=vr(3,9)/K){const t=d/L,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;if(fbm(x*0.03+5,z*0.03)<0.42)continue;bush(x+vr(-0.6,0.6),z+vr(-0.6,0.6),kind());}}});
CAMINOS.forEach(c=>{const P=c.pts;for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/L,nz=(b[0]-a[0])/L;
  for(let d=0;d<L;d+=vr(4,10)/K){const t=d/L,sd=VR()<0.5?-1:1,o=c.w/2+1.6;bush(a[0]+(b[0]-a[0])*t+sd*nx*o,a[1]+(b[1]-a[1])*t+sd*nz*o,kind());}}});
const NB=Math.round(7000*K);
for(let i=0;i<NB;i++){const x=vr(X0+2,X1-2),z=vr(Z0+2,Z1-2);let p;
  if(fieldAt(x,z))continue;
  if(z<-112)p=0.7*smooth(0.3,0.7,fbm(x*0.03+7,z*0.03+2))+0.2;
  else if(inVillage(x,z))p=0.03;
  else p=0.2*smooth(0.25,0.65,fbm(x*0.02+1,z*0.02+6))+0.05;
  if(VR()<p)bush(x,z,kind());}

const grM=mesh(G.grass,vmat(),GR.length),tallM=mesh(G.tall,vmat(),TALL.length),cardoM=mesh(G.cardo,vmat(),CARDO.length);
/* the bushes, each kind its own shape: the zarza a low sprawling thicket, the escaramujo a rounder bush with arching canes,
   the retama a broom of upright switches (yellow with flower in May and June) */
const stoneM=mesh(G.stone,lam(0xFFFFFF),STONE.length,true),BK={zarza:[],retama:[],escaramujo:[]};BU.forEach(q=>BK[q.k].push(q));NIVEL.BUSHES=BK;
const I0=new THREE.IcosahedronGeometry(1,0);
/* leaf sprays (short broad triangles pointing outward) and canes (two thin triangles: up and out, then arching over) on the
   upper half of an ellipsoid: they break the outline of the lumps, which alone read as boulders */
const sprays=(P,n,rx,ry,rz,cy,len,w,ph0)=>{for(let k=0;k<n;k++){const t=0.08+0.86*(k+0.5)/n,ph=k*2.39996+ph0,q=Math.sqrt(1-t*t),dx=Math.cos(ph)*q,dz=Math.sin(ph)*q,
    bx=dx*rx*0.82,by=cy+t*ry*0.82,bz=dz*rz*0.82,wx=-Math.sin(ph)*w,wz=Math.cos(ph)*w,l=len*(0.7+0.6*vegHash(k,ph0,3));
  P.push(bx-wx,by-w*0.4,bz-wz, bx+wx,by+w*0.4,bz+wz, bx+dx*l,by+t*l+0.3*l,bz+dz*l);}};
const canes=(P,n,r0,h,reach,w,ph0)=>{for(let k=0;k<n;k++){const ph=k*TAU/n+ph0+0.5*vegHash(k,ph0,5),c=Math.cos(ph),s2=Math.sin(ph),wx=-s2*w,wz=c*w,f=0.8+0.4*vegHash(k,ph0,7),
    mx=c*(r0+reach*0.55*f),my=h*f,mz=s2*(r0+reach*0.55*f),tx=c*(r0+reach*f),ty=h*f*0.62,tz=s2*(r0+reach*f);
  P.push(c*r0-wx,h*0.25,s2*r0-wz, c*r0+wx,h*0.25,s2*r0+wz, mx,my,mz,  mx-wx*0.7,my,mz-wz*0.7, mx+wx*0.7,my,mz+wz*0.7, tx,ty,tz);}};
const zaG=(()=>{const P=[];[[0.62,0.42,0.55,0,0.36,0],[0.46,0.33,0.46,0.58,0.28,0.12],[0.42,0.3,0.46,-0.52,0.26,-0.2],[0.38,0.27,0.4,0.1,0.22,0.56],[0.34,0.25,0.36,-0.2,0.2,-0.6],[0.3,0.3,0.3,0.3,0.5,-0.25]].slice(0,IS_PHONE?3:6).forEach((l,k)=>vegLump(P,I0,l[0],l[1],l[2],l[3],l[4],l[5],0.2,40+k,k*1.3));
  sprays(P,IS_PHONE?10:16,1.0,0.62,0.95,0.2,0.3,0.11,0.7);canes(P,7,0.35,0.86,0.95,0.035,0.2);
  return vegGeo(P,{floor:0,lo:0.64,hi:1.16,smooth:0.5,ry:2});})();
const esG=(()=>{const P=[];[[0.46,0.44,0.44,0,0.5,0],[0.36,0.36,0.36,0.46,0.62,0.2],[0.34,0.36,0.34,-0.4,0.66,-0.26],[0.32,0.34,0.32,-0.05,0.72,0.46],[0.3,0.3,0.3,0.1,0.98,-0.1]].slice(0,IS_PHONE?3:5).forEach((l,k)=>vegLump(P,I0,l[0],l[1],l[2],l[3],l[4],l[5],0.22,60+k,k*2.1));
  sprays(P,12,0.86,0.95,0.86,0.35,0.28,0.1,1.9);canes(P,6,0.25,1.45,0.9,0.045,1.1);
  return vegGeo(P,{floor:0,lo:0.66,hi:1.14,smooth:0.5,ry:1.4});})();
const reG=(()=>{const P=[];vegLump(P,I0,0.2,0.26,0.2,0,0.3,0,0.2,80,0.5);
  // a broom: switches fanning up from the foot, the inner ones taller and nearly upright
  for(let k=0;k<44;k++){const a=k*2.39996,ca=Math.cos(a),sa=Math.sin(a),u=(k%11)/10,r0=0.03+0.1*u,l=0.08+0.5*u*(0.7+0.6*vegHash(k,2,9)),h=(1.02-0.42*u)*(0.85+0.3*vegHash(k,4,1)),w=0.045;
    P.push(ca*r0-sa*w,0.03,sa*r0+ca*w, ca*r0+sa*w,0.03,sa*r0-ca*w, ca*(r0+l),h,sa*(r0+l));}
  return vegGeo(P,{floor:0,lo:0.62,hi:1.14,smooth:0.3,ry:1});})();
const zaM=mesh(zaG,vmat(),BK.zarza.length,true),esM=mesh(esG,vmat(),BK.escaramujo.length,true),reM=mesh(reG,vmat(),BK.retama.length,true);
const BCOL={retama:[0.33,0.40,0.22],zarza:[0.30,0.39,0.19],escaramujo:[0.40,0.46,0.25]};
function bushSeason(m){const mix=(b,t,k)=>[b[0]+(t[0]-b[0])*k,b[1]+(t[1]-b[1])*k,b[2]+(t[2]-b[2])*k];
  const zc=m>=10||m<=1?mix(BCOL.zarza,[0.36,0.28,0.18],0.35):BCOL.zarza,ec=m>=8&&m<=10?mix(BCOL.escaramujo,[0.5,0.36,0.2],0.15):m>=11||m<=2?mix(BCOL.escaramujo,[0.4,0.34,0.26],0.5):BCOL.escaramujo,
    rc=m===4||m===5?mix(BCOL.retama,[0.82,0.72,0.2],0.55):BCOL.retama;
  const put2=(M2,L,b,sx,sy)=>place(M2,L,(q,o,c)=>{o.position.set(q.x,q.y-0.04,q.z);o.rotation.set(0,q.a,0);o.scale.set(q.r*sx,q.r*sy,q.r*(sx>1.1?1:sx));c.setRGB(b[0]*(1+0.15*q.j),b[1]*(1+0.12*q.j),b[2]*(1+0.12*q.j));});
  put2(zaM,BK.zarza,zc,1.25,1.15);put2(esM,BK.escaramujo,ec,1.3,1.4);put2(reM,BK.retama,rc,1.05,1.7);}
place(stoneM,STONE,(q,o,c)=>{o.position.set(q.x,q.y+q.r*0.25,q.z);o.rotation.set(q.b*0.3,q.a,0);o.scale.set(q.r*1.2,q.r*0.7,q.r);
  const g=q.maj?0.66:0.7;c.setRGB(g+0.06*q.j,g*0.97+0.05*q.j,g*0.88+0.05*q.j);});

/* ---- the telegraph: a line of wooden poles south of the railway, along the edge of the fields, two crossarms of
   insulators and their wires ---- */
const TELE=[];
(function telegrafo(){const outer=x=>{let z=-1e9;['v1','v2','v3','v5'].forEach(k=>{const v=zAt(TRACKS[k].pts,x);if(v!==null&&v>z)z=v;});return z;};
  const masts=[];['v3','v5'].forEach(k=>{});   // the catenary masts on this side stand 2.8–3 m from their track: the poles go 5.6 m out
  /* along the edge of the fields south of the railway (their boundary at z 34), as behind the yard: a pole every
     24–29 m, each planted a little off the line, as they were set by hand */
  let sd=7177;const R=()=>(sd=sd*16807%2147483647)/2147483647;
  for(let x=X0+6;x<X1-4;x+=24+R()*5){const z=33.1+(R()-0.5)*0.5;
    if(Object.values(ROADS).some(r=>distPoly(x,z,r.pts)<r.w/2+2.5)||Object.values(ROADS2).some(p=>distPoly(x,z,p)<5.5))continue;
    TELE.push({x,z,y:groundH(x,z)});}
  const wood=lam(0x6E5A44),ins=lam(0xE8E4DA),H=6.6;
  TELE.forEach(p=>{scyl(wood,p.x,p.y-0.3,p.z,0.11,H+0.3,true);
    [H-0.35,H-0.95].forEach((y,k)=>{sbox(wood,p.x,p.y+y,p.z,0.12,0.12,k?1.2:1.6,0,true);
      (k?[-0.5,-0.17,0.17,0.5]:[-0.72,-0.4,0.4,0.72]).forEach(o=>scyl(ins,p.x,p.y+y+0.06,p.z+o,0.05,0.16,true));});});
  // the wires, with their sag
  const W=[];const lines=[[H-0.35+0.22,[-0.72,-0.4,0.4,0.72]],[H-0.95+0.22,[-0.5,-0.17,0.17,0.5]]];
  for(let i=1;i<TELE.length;i++){const a=TELE[i-1],b=TELE[i];if(b.x-a.x>60)continue;
    lines.forEach(([y,os])=>os.forEach(o=>{let px=a.x,py=a.y+y,pz=a.z+o;for(let k=1;k<=6;k++){const t=k/6,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t+o,yy=a.y+(b.y-a.y)*t+y-Math.sin(t*PI)*0.45;
      W.push(px,py,pz,x,yy,z);px=x;py=yy;pz=z;}}));}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(W,3));scene.add(new THREE.LineSegments(g,WIRE_MAT));   // the same wire as the catenary (motor.js:WIRE_MAT, darkened at night)
})();
/* ---- marcas viales: the centre line (3 m dashes, 4.5 m gaps) and the edge lines of the open road, from the village signs
   out, as thin strips just over the asphalt: painted on the ground texture they broke up into pixels ---- */
(function marcas(){const W=[],I=[];
  const dense=P=>{const o=[];let s=0;for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.ceil(L/1.0));
      for(let k=(i===1?0:1);k<=n;k++){const t=k/n;o.push({x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,s:s+L*t});}s+=L;}
    o.forEach((p,i)=>{const a=o[Math.max(0,i-1)],b=o[Math.min(o.length-1,i+1)],l=Math.hypot(b.x-a.x,b.z-a.z)||1;p.nx=-(b.z-a.z)/l;p.nz=(b.x-a.x)/l;});return o;};
  const onDeck=(x,z)=>Math.abs(x-PN.x)<4.6&&z>-9&&z<13;
  const strip=(Q,d,w,dash,s0)=>{for(let i=1;i<Q.length;i++){const a=Q[i-1],b=Q[i];if(a.s<s0)continue;
      if(dash&&((a.s+b.s)/2-s0)%7.5>3)continue;
      const pa=[a.x+a.nx*d,a.z+a.nz*d],pb=[b.x+b.nx*d,b.z+b.nz*d];if(onDeck(pa[0],pa[1])||onDeck(pb[0],pb[1]))continue;
      const o=W.length/3;[[pa,a,-1],[pa,a,1],[pb,b,1],[pb,b,-1]].forEach(([p,q,k])=>{const x=p[0]+q.nx*k*w/2,z=p[1]+q.nz*k*w/2;W.push(x,groundH(x,z)+0.07,z);});
      I.push(o,o+2,o+1,o,o+3,o+2);}};
  [ROADS.pn.pts,ROADS.este.pts,ROADS2.oeste,ROADS2.sur].forEach((P,i)=>{const Q=dense(P),s0=i>1?8:16;strip(Q,0,0.14,true,s0);strip(Q,-3.0,0.11,false,s0);strip(Q,3.0,0.11,false,s0);
    /* hitos de arista on both verges every 50 m: white posts with their black band and reflector */
    for(let k=0;k<Q.length;k++){const q=Q[k];if(q.s<s0+12||Math.round(q.s)%50!==0||(k&&Math.round(Q[k-1].s)===Math.round(q.s)))continue;
      [-1,1].forEach(d=>{const x=q.x+q.nx*d*4.25,z=q.z+q.nz*d*4.25;if(Math.abs(x-PN.x)<9&&z>-14&&z<18)return;if(Math.abs(x)>X1-4||(z>-6&&z<24))return;
        const y=groundH(x,z),ry=-Math.atan2(q.nz,q.nx);sbox(M.blanco,x,y,z,0.13,1.0,0.06,ry,true);sbox(M.negro,x,y+0.68,z,0.135,0.18,0.065,ry,true);
        sbox(d>0?M.amarillo:M.recerco,x,y+0.73,z,0.06,0.08,0.075,ry,true);});}});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(W,3));g.setIndex(I);g.computeVertexNormals();
  const n=g.attributes.normal;for(let i=0;i<n.count;i++)n.setXYZ(i,0,1,0);
  /* white paint: the lit Lambert alone reads grey on the asphalt, so by day it carries some of its own white (motor.js:nightFX fades it) */
  const mt=lam(0xFFFFFF,{side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,emissive:0xFFFFFF,emissiveIntensity:0.35});window.MARCAS_M=mt;
  const m=new THREE.Mesh(g,mt);m.receiveShadow=true;scene.add(m);
})();
/* the kilometre posts (P.K. 402,929 at the Miranda entry signals, 401,470 at the Burgos ones: the board shortens the line) and
   the hectometre posts between them, on the north side at the edge of the ballast */
(function hitos(){const pk=x=>402.929+(x+248)*(401.470-402.929)/496,xOf=k=>-248+(k-402.929)*496/(401.470-402.929);
  const kmTex={},hmTex={};const tex=(txt,w,h,fs)=>{const t=canvasTex(w,h,(c,W,Hh)=>{c.fillStyle='#F2F0EA';c.fillRect(0,0,W,Hh);c.fillStyle='#1E2022';
    c.font='600 '+fs+'px "Barlow Condensed",sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(txt,W/2,Hh*0.55);});(window.FONT_TEX=window.FONT_TEX||[]).push(t);return t;};
  const mastNear=x=>[-434,-396,-358,-320,-280,-240,-200,-160,-124,-88,-50,24,56,88,124,160,200,240,280,320,358,396,434].some(m=>Math.abs(m-x)<1.2);
  for(let h=Math.ceil(pk(X1-4)*10);h<=Math.floor(pk(X0+4)*10);h++){let x=xOf(h/10);if(Math.abs(x)<84||Math.abs(x+228)<7)continue;if(mastNear(x))x+=1.5;
    const z=-2.5,y=groundH(x,z)+0.3,km=h%10===0,n=km?String(h/10):String(h%10);
    const t=km?(kmTex[n]||(kmTex[n]=tex(n,96,64,46))):(hmTex[n]||(hmTex[n]=tex(n,32,48,40)));
    const face=new THREE.MeshLambertMaterial({map:t}),side=M.blanco;
    const m=new THREE.Mesh(GEO.box,[face,face,M.negro,side,side,side]);
    if(km){m.scale.set(0.16,0.55,0.75);m.position.set(x,y+0.95,z);sbox(M.blanco,x,y,z,0.16,0.7,0.2,0,true);}
    else{m.scale.set(0.14,0.42,0.18);m.position.set(x,y+0.21,z);}
    m.castShadow=true;scene.add(m);}
})();

/* ---- the month ---- */
const CERM=[  // height (m), colour of the cereal by month
  [0.20,[0.42,0.60,0.25]],[0.24,[0.40,0.60,0.24]],[0.36,[0.38,0.58,0.22]],[0.62,[0.40,0.60,0.22]],[0.92,[0.48,0.62,0.24]],
  [0.98,[0.70,0.70,0.34]],[0.92,[0.88,0.76,0.42]],[0,null],[0,null],[0,null],[0.10,[0.44,0.62,0.27]],[0.15,[0.43,0.61,0.26]]];
const GRM=[[0.44,0.50,0.25],[0.44,0.51,0.25],[0.45,0.53,0.25],[0.44,0.54,0.24],[0.48,0.54,0.25],[0.64,0.58,0.32],
  [0.72,0.62,0.37],[0.74,0.64,0.39],[0.70,0.61,0.37],[0.58,0.56,0.31],[0.50,0.53,0.27],[0.46,0.51,0.26]];
let curK=-1;
function VEG_SEASON(m,y){y=y||new Date().getFullYear();const key=y*12+m;if(key===curK)return;const first=curK<0;curK=key;
  let repaint=false;FIELDS.forEach(f=>{const k=NIVEL.fieldState(f,m,y);if(k!==f.kind){f.kind=k;repaint=true;}});
  if(repaint&&!first)redraw(groundTex);
  FIELDS.forEach((f,fi)=>{
    const cer=f.kind==='verde'||f.kind==='espigado'||f.kind==='maduro',h=CERM[m][0],cc=CERM[m][1];
    if(cer&&cc){const F=fieldMesh(CEL,fi,true);F.m.visible=true;const late=f.late&&m>=10?0.6:1;F.L.forEach(q=>q.cut=0);
      place(F.m,F.L,(q,o,c)=>{const v=0.88+0.24*q.k;o.position.set(q.x,q.y,q.z);o.rotation.set(0,q.r,0);o.scale.set(0.62*q.s,h*late*v*(0.92+0.08*q.s),0.62*q.s);
        c.setRGB(cc[0]*(1+0.06*q.j+0.08*(q.k-0.5)),cc[1]*(1+0.05*q.j),cc[2]*(1+0.08*q.j));});}
    else if(CEL[fi])CEL[fi].m.visible=false;
    if(f.kind==='rastrojo'){const F=fieldMesh(STL,fi,false),fresh=NIVEL.fieldFresh(f,m,y),age=fresh?0:((m+12-7)%12)/7;   // the stubble greys and settles over the winter
      F.m.visible=true;place(F.m,F.L,(q,o,c)=>{o.position.set(q.x,q.y,q.z);o.rotation.set(0,q.r,0);const hh=0.19-0.07*age;o.scale.set(0.45*q.s,hh*q.s,0.45*q.s);
        c.setRGB((0.86-0.12*age)+0.05*q.j,(0.76-0.1*age)+0.05*q.j,(0.52-0.02*age)+0.04*q.j);});}
    else if(STL[fi])STL[fi].m.visible=false;});
  // bales
  const BL=[];FIELDS.forEach((f,fi)=>{if(f.kind==='rastrojo'&&NIVEL.fieldFresh(f,m,y))BALES[fi].forEach(b=>BL.push(b));});
  place(baleM,BL,(q,o,c)=>{o.position.set(q.x,q.y+0.72,q.z);o.rotation.set(PI/2,0,q.a);o.scale.set(0.75,1.2,0.75);c.setRGB(0.85,0.73,0.42);});
  baleM.rotation.set(0,0,0);
  // grass, ribazos and cardos: green in the wet months, straw in summer
  const g=GRM[m],gd=GRM[7];
  place(grM,GR,(q,o,c)=>{o.position.set(q.x,q.y,q.z);o.rotation.set(0,q.r,0);o.scale.set(0.7*q.s,0.42*q.s,0.7*q.s);
    const t=q.dry<0.25?0.6:0;c.setRGB((g[0]+(gd[0]-g[0])*t)*(1+0.1*q.j),(g[1]+(gd[1]-g[1])*t)*(1+0.08*q.j),(g[2]+(gd[2]-g[2])*t)*(1+0.1*q.j));});
  const tg=m>=5&&m<=9?[0.78,0.68,0.42]:m>=3&&m<=4?[0.5,0.6,0.28]:[0.62,0.6,0.4];
  place(tallM,TALL,(q,o,c)=>{o.position.set(q.x,q.y,q.z);o.rotation.set(0,q.r,0);o.scale.set(0.55*q.s,(m>=4&&m<=8?0.95:0.6)*q.s,0.55*q.s);c.setRGB(tg[0]*(1+0.08*q.j),tg[1]*(1+0.06*q.j),tg[2]*(1+0.08*q.j));});
  const cg=m>=6&&m<=10?[0.58,0.52,0.38]:[0.5,0.56,0.46];   // the thistles dry out after flowering
  place(cardoM,CARDO,(q,o,c)=>{o.position.set(q.x,q.y,q.z);o.rotation.set(0,q.r,0);o.scale.set(0.4*q.s,(m>=4&&m<=9?0.75:0.4)*q.s,0.4*q.s);c.setRGB(cg[0]*(1+0.08*q.j),cg[1]*(1+0.06*q.j),cg[2]*(1+0.08*q.j));});
  // the kitchen gardens and the fruit trees
  place(hueM,HUERTO,(q,o,c)=>{o.position.set(q.x,q.y,q.z);o.rotation.set(0,q.r,0);const s=m>=3&&m<=9?1:0.5;o.scale.set(0.35*q.s*s,0.4*q.s*s,0.35*q.s*s);c.setRGB(0.36,0.52,0.22);});
  const fc=m===3?[0.95,0.9,0.92]:m===9?[0.78,0.62,0.28]:[0.38,0.5,0.24],fs=m>=4&&m<=9?1:m===3?0.85:m===10?0.6:0;   // blossom in April, yellow in October, bare in winter
  place(fruitM,FRUIT,(q,o,c)=>{o.position.set(q.x,q.y+q.r*0.35,q.z);o.rotation.set(0,q.j,0);o.scale.set(q.r*fs+0.001,q.r*1.2*fs+0.001,q.r*fs+0.001);c.setRGB(fc[0]*(1+0.06*q.j),fc[1]*(1+0.05*q.j),fc[2]*(1+0.05*q.j));});
  fruitM.visible=fs>0;
  treeSeason(m);bushSeason(m);
  if(NIVEL.onSeason)NIVEL.onSeason(m,y);
}
VEG_SEASON(new Date().getMonth(),new Date().getFullYear());
/* the combine leaves the cut strips behind it: their clumps go (until the month changes and the field is stubble anyway) */
const ZERO=new THREE.Matrix4().makeScale(0,0,0);
function cutCereal(fi,test){const F=CEL[fi];if(!F||!F.m.visible)return;let ch=false;F.L.forEach((q,i)=>{if(!q.cut&&test(q.x,q.z)){q.cut=1;F.m.setMatrixAt(i,ZERO);ch=true;}});if(ch)F.m.instanceMatrix.needsUpdate=true;}
NIVEL.campo={inPoly,edgeD,fieldAt,open,nearTree,ring,cutCereal};
return{VEG_SEASON};};

/* ---- ambiente · la vida del campo: el tractor (y la cosechadora en julio) haciendo las labores de cada mes, el rebaño
   de la tenada con su pastor y su perro, las cigüeñas (de febrero a agosto), las bandadas, los perros del pueblo y el humo
   de las chimeneas en los meses fríos. Todo sale de la hora y el día de juego: no se guarda nada. ---- */
NIVEL.ambiente=function(){
const C=NIVEL.campo,TN=NIVEL.TENADA;
const dayOf=()=>Math.floor(sim.t/86400),secOf=()=>((sim.t%86400)+86400)%86400;
const absDay=d=>Math.floor(dayDate(d).getTime()/864e5);
const hash=(a,b)=>{const s=Math.sin(a*127.1+b*311.7)*43758.5453;return s-Math.floor(s);};
const L=(hex,o)=>lam(hex,o);
const box=(g,mat,x,y,z,sx,sy,sz,cast)=>{const m=new THREE.Mesh(GEO.box,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=cast!==false;m.receiveShadow=true;g.add(m);return m;};
const cylX=(g,mat,x,y,z,r,len,axis,seg)=>{const m=new THREE.Mesh(seg===6?GEO.cyl6:GEO.cyl,mat);m.position.set(x,y,z);m.scale.set(r,len,r);
  if(axis==='z')m.rotation.x=PI/2;else if(axis==='x')m.rotation.z=PI/2;m.castShadow=true;g.add(m);return m;};

/* ---------- machinery ---------- */
const MT={verde:L(0x2F6B3A),verdeO:L(0x24502C),negro:L(0x1E2022),gris:L(0x8A8F8C),rojo:L(0xA8352B),rojoO:L(0x7E2A22),azul:L(0x3B5E8C),
  naranja:L(0xC8702A),blanco:L(0xE8E6DE),crist:M.cristal,llanta:L(0xC9B98A)};
function wheel(g,x,y,z,r,w,rim){const p=new THREE.Object3D();p.position.set(x,y,z);g.add(p);
  cylX(p,MT.negro,0,0,0,r,w,'z');const h=cylX(p,rim||MT.llanta,0,0,(z>0?1:-1)*0.01,r*0.55,w+0.04,'z',6);box(p,MT.negro,0,0,0,r*1.6,r*0.18,w+0.06,false);return p;}
function tractor(){const g=new THREE.Group();g.userData.wh=[];
  box(g,MT.verde,0.75,1.15,0,2.3,0.95,1.0);box(g,MT.negro,0.8,0.62,0,1.8,0.45,0.75);box(g,MT.gris,1.92,1.2,0,0.06,0.7,0.9,false);   // bonnet, engine, grille
  box(g,MT.verde,-0.75,1.15,0,1.3,0.5,1.25);                                                           // the body under the cab
  [-0.68,0.68].forEach(z=>{box(g,MT.crist,-0.7,2.15,z,1.3,1.4,0.04,false);});box(g,MT.crist,-0.05,2.15,0,0.04,1.4,1.36,false);box(g,MT.crist,-1.35,2.15,0,0.04,1.4,1.36,false);
  [[-0.05,0.68],[-0.05,-0.68],[-1.35,0.68],[-1.35,-0.68]].forEach(([x,z])=>box(g,MT.negro,x,2.15,z,0.07,1.4,0.07,false));
  box(g,MT.verde,-0.7,2.9,0,1.55,0.12,1.55);box(g,MT.blanco,-0.7,2.98,0,1.4,0.04,1.4,false);
  [-1,1].forEach(s=>box(g,MT.verde,-0.75,1.85,s*0.98,1.5,0.08,0.55));                                   // mudguards
  cylX(g,MT.negro,1.4,2.0,0.32,0.05,1.3,null,6);
  [[-0.75,0.85,0.98,0.85,0.45],[-0.75,0.85,-0.98,0.85,0.45],[1.45,0.5,0.82,0.5,0.3],[1.45,0.5,-0.82,0.5,0.3]].forEach(w=>g.userData.wh.push({o:wheel(g,w[0],w[1],w[2],w[3],w[4]),r:w[3]}));
  // the implements, behind (one shows at a time)
  const T={};const tool=k=>{const t=new THREE.Group();t.visible=false;g.add(t);T[k]=t;return t;};
  let t=tool('arado');box(t,MT.gris,-1.9,0.75,0,0.9,0.12,0.12);box(t,MT.rojo,-2.9,0.6,0,1.9,0.14,0.14);
    [-2.2,-2.8,-3.4].forEach((x,i)=>{const b=box(t,MT.rojo,x,0.35,0.15-i*0.35,0.55,0.5,0.08);b.rotation.y=0.6;box(t,MT.gris,x,0.62,0.15-i*0.35,0.08,0.5,0.08,false);});
  t=tool('sembradora');box(t,MT.gris,-1.8,0.75,0,0.6,0.1,0.1);box(t,MT.azul,-2.6,1.05,0,1.0,0.75,3.0);box(t,MT.gris,-2.75,0.45,0,0.6,0.1,3.0,false);
    for(let k=0;k<10;k++)box(t,MT.negro,-2.75,0.25,-1.35+k*0.3,0.06,0.4,0.04,false);[-1.4,1.4].forEach(z=>cylX(t,MT.negro,-3.1,0.3,z,0.3,0.15,'z'));
  t=tool('abonadora');box(t,MT.gris,-1.6,1.0,0,0.7,0.1,0.1,false);const cn=new THREE.Mesh(GEO.cone,MT.naranja);cn.position.set(-2.2,1.45,0);cn.scale.set(0.75,1.0,0.75);cn.rotation.x=PI;cn.castShadow=true;t.add(cn);
    cylX(t,MT.gris,-2.2,0.85,0,0.35,0.06);
  t=tool('sulfatadora');cylX(t,MT.blanco,-2.4,1.25,0,0.6,1.6,'x');box(t,MT.gris,-3.3,1.25,0,0.1,0.1,11,false);box(t,MT.gris,-2.4,0.6,0,1.6,0.12,0.12,false);
    [-1,1].forEach(z=>cylX(t,MT.negro,-2.4,0.42,z*0.75,0.42,0.2,'z'));
  t=tool('cultivador');box(t,MT.gris,-1.8,0.75,0,0.6,0.1,0.1);box(t,MT.naranja,-2.4,0.65,0,0.18,0.18,3.4);box(t,MT.naranja,-2.9,0.65,0,0.18,0.18,3.4);
    for(let k=0;k<9;k++)box(t,MT.gris,-2.4-(k%2)*0.5,0.35,-1.6+k*0.4,0.06,0.6,0.06,false);
  t=tool('empacadora');box(t,MT.gris,-1.9,0.75,0.4,1.2,0.1,0.1);box(t,MT.rojo,-2.9,1.0,1.1,2.6,1.25,1.1);box(t,MT.rojoO,-2.0,0.45,1.6,0.5,0.35,1.8);
    box(t,MT.gris,-4.3,0.8,1.1,0.4,0.1,0.9,false);[0.55,1.65].forEach(z=>cylX(t,MT.negro,-3.2,0.4,z,0.4,0.18,'z'));
  t=tool('remolque');box(t,MT.gris,-1.9,0.75,0,0.9,0.1,0.1);box(t,MT.rojo,-4.2,1.35,0,4.0,0.9,2.2);box(t,MT.rojoO,-4.2,0.85,0,4.0,0.12,2.2);
    [-1.15,1.15].forEach(z=>{cylX(t,MT.negro,-3.8,0.5,z,0.5,0.3,'z');cylX(t,MT.negro,-4.7,0.5,z,0.5,0.3,'z');});
  g.userData.tools=T;scene.add(g);return g;}
function cosechadora(){const g=new THREE.Group();g.userData.wh=[];
  box(g,MT.rojo,-0.4,2.2,0,5.4,2.4,2.8);box(g,MT.rojoO,-0.4,1.05,0,5.0,0.3,2.6);box(g,MT.blanco,-0.6,3.65,0,2.6,0.5,2.4);   // body, belly, grain tank
  box(g,MT.crist,1.6,3.95,0,1.5,1.3,1.7,false);box(g,MT.rojo,1.55,4.65,0,1.8,0.12,2.0);[[0.85,0.85],[0.85,-0.85],[2.35,0.85],[2.35,-0.85]].forEach(([x,z])=>box(g,MT.negro,x,3.95,z,0.07,1.3,0.07,false));
  box(g,MT.rojoO,3.0,1.6,0,1.3,0.7,1.2);                                                                // feeder
  box(g,MT.rojo,3.95,0.75,0,1.1,0.55,4.6);box(g,MT.gris,4.45,0.45,0,0.2,0.1,4.6,false);                 // header, cutter bar
  const reel=new THREE.Object3D();reel.position.set(4.2,1.45,0);g.add(reel);cylX(reel,MT.rojoO,0,0,0,0.12,4.4,'z',6);
  for(let k=0;k<5;k++){const b=box(reel,MT.llanta,0,0,0,0.05,0.9,4.3,false);b.rotation.z=k*PI/5;}g.userData.reel=reel;
  const tube=cylX(g,MT.rojo,-0.6,3.4,-1.6,0.16,3.6,'x',6);tube.position.set(-0.2,3.55,-1.55);
  cylX(g,MT.negro,-2.2,4.3,0.6,0.08,0.9,null,6);
  [[1.6,0.85,1.45,0.85,0.6],[1.6,0.85,-1.45,0.85,0.6],[-2.4,0.55,1.25,0.55,0.4],[-2.4,0.55,-1.25,0.55,0.4]].forEach(w=>g.userData.wh.push({o:wheel(g,w[0],w[1],w[2],w[3],w[4],MT.llanta),r:w[3]}));
  scene.add(g);return g;}
const TR=tractor(),CO=cosechadora();CO.visible=false;
const PARK={x:FARM.x-6,z:FARM.z+10.5,a:0};                         // in the farm yard, in front of the big door
/* the work of each month: which fields (by what they show), with what, how wide each pass, how fast */
const TASK={9:['arado','arado',1.6,1.5],10:['sembrado','sembradora',3,2],1:['verde','abonadora',12,2.5],2:['arado','arado',1.6,1.5],
  3:['verde','sulfatadora',12,2.2],4:['arado','cultivador',3.4,2.2],5:['arado','cultivador',3.4,2.2],6:['maduro','cosechadora',4.6,1.3],
  7:['rastrojo','empacadora',6,2],8:['arado','cultivador',3.4,2.2]};
const planCache=new Map();
function plan(d){const k=d;if(planCache.has(k))return planCache.get(k);let P=null;
  const m=monthOf(d),dw=dowOf(d),y=dayDate(d).getFullYear(),dom=dayDate(d).getDate(),job=TASK[m];
  if(job&&dw!==0){let [state,tool,w,v]=job;if(m===9&&dom>15){state='arado';tool='sembradora';w=3;v=2;}
    const elig=FIELDS.map((f,i)=>i).filter(i=>{const f=FIELDS[i];return NIVEL.fieldState(f,m,y)===state&&(m!==7||NIVEL.fieldFresh(f,m,y));});
    const A=absDay(d);for(let e=0;e<elig.length&&!P;e++){const fi=elig[(A*7+3+e)%elig.length],f=FIELDS[fi],R=mulberry(A*97+fi);
      const ca=Math.cos(f.ang),sa=Math.sin(f.ang),xs=f.poly.map(p=>p[0]),zs=f.poly.map(p=>p[1]);
      for(let tr=0;tr<120&&!P;tr++){const Lw=(tr<60?50+R()*40:30+R()*20),N=2*Math.max(1,Math.round((tool==='cosechadora'?10:(tr<60?12:8))/w)),Wd=N*w+6;
        const cx=Math.min(...xs)+(Math.max(...xs)-Math.min(...xs))*R(),cz=Math.min(...zs)+(Math.max(...zs)-Math.min(...zs))*R();
        const cor=[[-1,-1],[1,-1],[1,1],[-1,1],[0,0]].map(([a,b])=>[cx+a*Lw/2*ca-b*Wd/2*sa,cz+a*Lw/2*sa+b*Wd/2*ca]);
        if(cor.every(p=>p[0]>X0+6&&p[0]<X1-6&&p[1]<Z1-4&&C.inPoly(p[0],p[1],f.poly)&&C.edgeD(f,p[0],p[1])>4&&isFree(p[0]-3,p[1]-3,p[0]+3,p[1]+3))
          &&!C.nearTree(cx,cz,t=>t.r+Math.max(Lw,Wd)/2))
          P={fi,tool,w,v,Lw,N,cx,cz,ca,sa,m};}}}
  planCache.set(k,P);return P;}
function hours(m,tool){const st=(m>=10||m<=1)?9:8.5,end=tool==='cosechadora'?21.5:(m>=4&&m<=8)?20.5:(m>=10||m<=1)?17.5:19;return[st*3600,13.5*3600,15.5*3600,end*3600];}
function route(P){if(P.pts)return P.pts;const U=[],w=P.w,N=P.N,L2=P.Lw/2,vk=k=>-N*w/2+(k+0.5)*w,arc=(cu,cv,r,a0,a1)=>{for(let i=1;i<=10;i++){const a=a0+(a1-a0)*i/10;U.push([cu+Math.cos(a)*r,cv+Math.sin(a)*r]);}};
  U.push([-L2,vk(0)]);
  for(let k=0;k<N;k++){const dir=k%2?-1:1;U.push([dir*L2,vk(k)]);if(k<N-1)arc(dir*L2,vk(k)+w/2,w/2,-PI/2,dir>0?PI/2:-3*PI/2);}
  // the last pass ends on the -u side (N is even): out on to the headland and back down to the first pass
  const R=Math.max(w/2,2.5),uh=-L2-R;arc(-L2,vk(N-1)-R,R,PI/2,PI);U.push([uh,vk(0)+R]);arc(-L2,vk(0)+R,R,PI,3*PI/2);
  const pts=U.map(([u,v])=>[P.cx+u*P.ca-v*P.sa,P.cz+u*P.sa+v*P.ca]);const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  P.pts=pts;P.cum=cum;P.len=cum[cum.length-1];return pts;}
function along(P,s){const pts=route(P),c=P.cum;s=((s%P.len)+P.len)%P.len;let lo=0,hi=c.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(c[mid]<=s)lo=mid;else hi=mid;}
  const a=pts[lo],b=pts[hi],u=(s-c[lo])/((c[hi]-c[lo])||1);return{x:a[0]+(b[0]-a[0])*u,z:a[1]+(b[1]-a[1])*u,a:Math.atan2(b[1]-a[1],b[0]-a[0])};}
function setVeh(g,x,z,a,roll){const y=groundH(x,z);g.position.set(x,y,z);g.rotation.set(0,-a,0);
  if(roll!==undefined)g.userData.wh.forEach(w=>{w.o.rotation.z=-roll/w.r;});}
function stepMachines(){const d=dayOf(),t=secOf(),P=plan(d);
  Object.values(TR.userData.tools).forEach(o=>o.visible=false);CO.visible=false;
  if(!P){setVeh(TR,PARK.x,PARK.z,PARK.a);return;}
  const[h0,h1,h2,h3]=hours(P.m,P.tool);
  const ws=Math.max(0,Math.min(t,h1)-h0)+Math.max(0,Math.min(t,h3)-h2),s=P.v*ws,inField=t>=h0-600&&t<=h3+(P.tool==='cosechadora'?1e9:600);
  if(P.tool==='cosechadora'){
    CO.visible=true;const q=along(P,s);setVeh(CO,q.x,q.z,q.a,s);CO.userData.reel.rotation.z=-s*1.2;
    const kd=Math.min(P.N,Math.floor(s/(P.Lw+PI*P.w/2)));if(kd>(P.kc||0)){P.kc=kd;const vmax=-P.N*P.w/2+kd*P.w;
      C.cutCereal(P.fi,(x,z)=>{const dx=x-P.cx,dz=z-P.cz,u=dx*P.ca+dz*P.sa,v=-dx*P.sa+dz*P.ca;return Math.abs(u)<=P.Lw/2&&v>=-P.N*P.w/2&&v<=vmax;});}
    // the tractor and its trailer wait at the edge of the field for the grain
    if(t>=h0&&t<=h3){TR.userData.tools.remolque.visible=true;setVeh(TR,P.cx-P.ca*(P.Lw/2+9)+P.sa*(P.N*P.w/2+5),P.cz-P.sa*(P.Lw/2+9)-P.ca*(P.N*P.w/2+5),Math.atan2(P.sa,P.ca)+PI/2);}
    else setVeh(TR,PARK.x,PARK.z,PARK.a);
    return;}
  if(!inField||t<h0-600){setVeh(TR,PARK.x,PARK.z,PARK.a);return;}
  TR.userData.tools[P.tool].visible=true;const q=along(P,s);setVeh(TR,q.x,q.z,q.a,s);
  const sb=TR.userData.tools.sulfatadora;if(P.tool==='sulfatadora')sb.children[1].scale.z=(t>h1&&t<h2)?3:11;}

/* ---------- storks: in the nest on the tower and in one on a catenary mast, February to August; now and then one of the
   pair goes off over the fields and comes back ---------- */
const nests=(NIVEL.nidos||[]).slice();
// the second nest, on top of a catenary mast west of the station
(function(){const x=-320,zT=0,zM=-3,top=7.35+0.12;scyl(M.nido,x,top+0.02,zM,1.0,0.55);nests.push({x,y:top+0.62,z:zM,a:0.3});})();
function stork(){const g=new THREE.Group(),W=M.cigueña,Bk=M.negro,R=M.rojo;
  const body=new THREE.Mesh(GEO.ico,W);body.scale.set(0.42,0.3,0.24);body.position.y=0.95;body.castShadow=true;g.add(body);
  const neck=box(g,W,0.38,1.22,0,0.09,0.45,0.09);neck.rotation.z=-0.35;
  const head=new THREE.Mesh(GEO.ico,W);head.scale.set(0.12,0.1,0.09);head.position.set(0.5,1.45,0);g.add(head);
  const beak=box(g,R,0.72,1.42,0,0.32,0.05,0.05,false);beak.rotation.z=-0.25;
  const legs=[-0.07,0.07].map(z=>box(g,R,0,0.42,z,0.04,0.84,0.04));
  const wings=[-1,1].map(s=>{const p=new THREE.Object3D();p.position.set(0,1.0,s*0.18);g.add(p);
    const w=box(p,W,0,0,s*0.45,0.42,0.04,0.9);const tip=box(p,Bk,-0.05,0,s*0.95,0.36,0.04,0.3);return{p,s};});
  const folded=new THREE.Group();g.add(folded);[-1,1].forEach(s=>box(folded,Bk,-0.18,0.95,s*0.2,0.5,0.17,0.05,false));   // the black of the folded wings
  g.userData={wings,legs,neck,head,beak,folded,body};scene.add(g);return g;}
const ST=nests.map(n=>[stork(),stork()]);
function poseStork(g,fly,flap){const u=g.userData;u.wings.forEach(w=>{w.p.visible=fly;w.p.rotation.x=w.s*flap;});u.folded.visible=!fly;
  u.legs.forEach(l=>{l.rotation.z=fly?PI/2-0.2:0;l.position.set(fly?-0.45:0,fly?0.95:0.42,l.position.z);});}
function stepStorks(dtR){const d=dayOf(),m=monthOf(d),t=secOf(),here=m>=1&&m<=7;
  ST.forEach((pair,ni)=>{const n=nests[ni];pair.forEach((g,k)=>{g.visible=here;if(!here)return;
    // flights: the second bird, a few times a day in daylight, out in a wide loop and back (6 minutes)
    const P=1500+ni*311,ph=(t+ni*700)%P,flying=k===1&&t>7.5*3600&&t<20.5*3600&&ph<360;
    if(flying){const u=ph/360,R=55+ni*25,th=ni*2.1+0.8,dx=Math.cos(th),dz=Math.sin(th),loop=v=>{const a=v*TAU;return[n.x+R*((1-Math.cos(a))*dx-Math.sin(a)*0.6*dz),n.z+R*((1-Math.cos(a))*dz+Math.sin(a)*0.6*dx)];};
      const[x,z]=loop(u),[x2,z2]=loop(u+0.002),y=n.y+Math.sin(u*PI)*28;
      g.position.set(x,y-0.95,z);g.rotation.set(0,-Math.atan2(z2-z,x2-x),0);
      const glide=Math.sin(performance.now()/1000*0.7+ni)>0.2;poseStork(g,true,glide?0.05:Math.sin(performance.now()/1000*5)*0.45);}
    else{const o=k?0.35:-0.35;g.position.set(n.x+Math.cos(n.a)*o,n.y-0.15,n.z+Math.sin(n.a)*o);g.rotation.set(0,-(n.a+(k?PI:0))+0.4*Math.sin(t/900+k),0);poseStork(g,false,0);
      // the clatter: head thrown back now and then
      const cl=Math.max(0,Math.sin(t/37+k*2+ni)-0.9)*10;g.userData.neck.rotation.z=-0.35+cl*0.9;g.userData.head.position.set(0.5-cl*0.35,1.45+cl*0.05,0);g.userData.beak.rotation.z=-0.25+cl*1.4;g.userData.beak.position.set(0.72-cl*0.45,1.42+cl*0.25,0);}
  });});}

/* ---------- the flock of the tenada: out to the nearest stubble or barbecho in the morning, back in the afternoon;
   the shepherd (a real person of the pool) behind them with his crook, the dog going round them ---------- */
const NS=IS_PHONE?26:40,SH={};
/* the sheep, in metres and faceted like the rest: a woolly body (barrel, chest and rump, a stub of a tail) and a churra's
   head (white, with the black ears, eye patches and muzzle of the breed); each takes its own colour on top */
function lump(parts){const P=[],C=[];parts.forEach(([g,sx,sy,sz,x,y,z,col,rz])=>{const q=g.index?g.toNonIndexed():g.clone();q.scale(sx,sy,sz);if(rz)q.rotateZ(rz);q.translate(x,y,z);
    const a=q.attributes.position.array;for(let i=0;i<a.length;i++)P.push(a[i]);const c=col||[1,1,1];for(let i=0;i<a.length/3;i++)C.push(c[0],c[1],c[2]);});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));g.computeVertexNormals();return g;}
const ICO0=new THREE.IcosahedronGeometry(1,0),ICO1=new THREE.IcosahedronGeometry(1,1),DK=[0.04,0.035,0.03];
const sheepBody=mesh2(lump([[ICO1,0.5,0.34,0.31,0,0,0],[ICO0,0.3,0.3,0.27,0.34,0.06,0],[ICO0,0.3,0.3,0.28,-0.3,0.03,0],[ICO0,0.07,0.12,0.06,-0.56,-0.02,0]]),NS,true);
const sheepHead=mesh2(lump([[GEO.box,0.2,0.16,0.15,0,0,0],[GEO.box,0.13,0.11,0.11,0.15,-0.035,0],[GEO.box,0.035,0.07,0.09,0.215,-0.05,0,DK],
  [GEO.box,0.04,0.05,0.11,-0.07,0.05,0.115,DK,0],[GEO.box,0.04,0.05,0.11,-0.07,0.05,-0.115,DK,0],[GEO.box,0.07,0.06,0.012,0.04,0.025,0.078,DK],[GEO.box,0.07,0.06,0.012,0.04,0.025,-0.078,DK],
  [ICO0,0.13,0.1,0.12,-0.06,0.07,0]]),NS,true);sheepHead.material.vertexColors=true;sheepBody.material.vertexColors=true;
const sheepLeg=mesh2(GEO.box,NS*4,false);
function mesh2(geo,n,cast){const m=new THREE.InstancedMesh(geo,lam(0xFFFFFF),n);m.castShadow=cast;m.receiveShadow=true;m.frustumCulled=false;m.count=0;scene.add(m);
  const c=new THREE.Color(1,1,1);for(let i=0;i<n;i++)m.setColorAt(i,c);return m;}
const SR=mulberry(4242),SHEEP=[];for(let i=0;i<NS;i++){const a=SR()*TAU,r=Math.sqrt(SR());SHEEP.push({ox:Math.cos(a)*r,oz:Math.sin(a)*r,ph:SR()*TAU,w:SR(),
  col:SR()<0.06?[0.25,0.22,0.2]:SR()<0.1?[0.55,0.45,0.35]:[0.88+0.06*SR(),0.85+0.05*SR(),0.76+0.05*SR()]});}
SHEEP.forEach((s,i)=>{const c=new THREE.Color(s.col[0],s.col[1],s.col[2]).convertSRGBToLinear();sheepBody.setColorAt(i,c);
  sheepHead.setColorAt(i,s.col[0]<0.5?new THREE.Color(0x2A2420).convertSRGBToLinear():new THREE.Color(Math.min(1,s.col[0]+0.05),Math.min(1,s.col[1]+0.06),Math.min(1,s.col[2]+0.1)).convertSRGBToLinear());
  for(let k=0;k<4;k++)sheepLeg.setColorAt(i*4+k,new THREE.Color(s.col[0]<0.5?0x1E1A18:0x3A342E).convertSRGBToLinear());});
const GATE={x:TN.x1+1.5,z:(TN.z1+3+TN.z2-3.5)/2};
function flockPlan(d){const m=monthOf(d),y=dayDate(d).getFullYear(),A=absDay(d);
  const elig=FIELDS.map((f,i)=>i).filter(i=>{const f=FIELDS[i],k=NIVEL.fieldState(f,m,y);return f.poly.every(p=>p[1]>=30)&&(k==='rastrojo'||k==='arado');});
  if(!elig.length)return null;elig.sort((a,b)=>{const c=i=>{const P=FIELDS[i].poly,x=P.reduce((s,p)=>s+p[0],0)/P.length,z=P.reduce((s,p)=>s+p[1],0)/P.length;return Math.hypot(x-GATE.x,z-GATE.z)-(FIELDS[i].kind==='rastrojo'?60:0);};return c(a)-c(b);});
  const fi=elig[0],f=FIELDS[fi],R=mulberry(A*13+5),xs=f.poly.map(p=>p[0]);
  // where they graze today: a spot in the field not far from the tenada, and the way there along the edge
  const Rg=9+R()*4,ok=(x,z)=>C.inPoly(x,z,f.poly)&&C.edgeD(f,x,z)>4&&x>X0+8&&x<X1-8&&z<Z1-4&&isFree(x-3,z-3,x+3,z+3);
  // the spot and the ground the flock wanders over from it (2R either way along, R across; the dog a little wider) all in the field
  let best=null;for(let k=0;k<60;k++){const x=GATE.x+(R()-0.5)*260,z=40+R()*30;
    if(![[0,0],[-2,0],[2,0],[-2,1],[2,1],[0,1]].every(([a,b])=>ok(x+a*(Rg*1.15+2),z+b*Rg+(b?Rg*1.15+2:-(Rg*0.6))))||C.nearTree(x,z,t=>t.r+Rg*2))continue;best={x,z};break;}
  if(!best)return null;
  const winter=m>=10||m<=1;return{A:best,out:(winter?10.5:9.5)*3600,home:(winter?16.5:m>=5&&m<=7?20.5:18)*3600,R:Rg,fi};}
const fpCache=new Map();const fplan=d=>{if(!fpCache.has(d))fpCache.set(d,flockPlan(d));return fpCache.get(d);};
function flockAt(P,t){const v=0.7,Dx=P.A.x-GATE.x,Dz=P.A.z-GATE.z,D=Math.hypot(Dx,Dz),T1=P.out+D/v,T3=P.home+D/v;
  if(t<P.out||t>T3)return null;
  if(t<T1){const u=(t-P.out)/(D/v);return{x:GATE.x+Dx*u,z:GATE.z+Dz*u,hx:Dx/D,hz:Dz/D,graze:0};}
  const tau=Math.min(t,P.home)-T1,gx=P.A.x+P.R*2*Math.sin(tau/900),gz=P.A.z+P.R*(1-Math.cos(tau/700))*0.5;
  if(t<=P.home){const dx=2*P.R*Math.cos(tau/900)/900,dz=P.R*0.5*Math.sin(tau/700)/700,l=Math.hypot(dx,dz)||1;return{x:gx,z:gz,hx:dx/l,hz:dz/l,graze:1};}
  const u=(t-P.home)/(D/v),bx=gx+(GATE.x-gx)*u,bz=gz+(GATE.z-gz)*u,l=Math.hypot(GATE.x-gx,GATE.z-gz)||1;return{x:bx,z:bz,hx:(GATE.x-gx)/l,hz:(GATE.z-gz)/l,graze:0};}
const _o=new THREE.Object3D();
function stepFlock(){const d=dayOf(),t=secOf(),P=fplan(d),F=P&&flockAt(P,t);
  if(!F){sheepBody.count=sheepHead.count=sheepLeg.count=0;DOGS[0].visible=false;shepherd(null);return;}
  sheepBody.count=sheepHead.count=NS;sheepLeg.count=NS*4;
  const ha=Math.atan2(F.hz,F.hx),spread=F.graze?P.R:4.5,len=F.graze?1:2.6;
  SHEEP.forEach((s,i)=>{const wob=F.graze?1.6:0.6;
    let lx=s.ox*spread*len*(F.graze?1:1)+Math.sin(t*0.013+s.ph)*wob,lz=s.oz*spread*(F.graze?0.8:0.45)+Math.cos(t*0.011+s.ph*1.3)*wob;
    if(!F.graze)lx-=spread*len*0.5;
    const x=F.x+lx*Math.cos(ha)-lz*Math.sin(ha),z=F.z+lx*Math.sin(ha)+lz*Math.cos(ha),y=groundH(x,z);
    const a=F.graze?ha+Math.sin(t*0.004+s.ph*3)*1.6:ha,ca=Math.cos(a),sa=Math.sin(a),eat=F.graze&&Math.sin(t*0.05+s.ph*5)>-0.3;
    const step=F.graze?0:Math.sin(t*6+s.ph)*0.35;
    const sc=0.92+0.16*s.w;_o.position.set(x,y+0.6*sc,z);_o.rotation.set(0,-a,0);_o.scale.set(sc,sc,sc);_o.updateMatrix();sheepBody.setMatrixAt(i,_o.matrix);
    const hy=(eat?0.3:0.8)*sc,hx=(eat?0.62:0.58)*sc;_o.position.set(x+ca*hx,y+hy,z+sa*hx);_o.rotation.set(0,-a,eat?-1.0:-0.25);_o.updateMatrix();sheepHead.setMatrixAt(i,_o.matrix);
    [[0.3,0.12],[0.3,-0.12],[-0.3,0.12],[-0.3,-0.12]].forEach(([fx,fz],k)=>{const sw=(k===0||k===3?1:-1)*step;
      _o.position.set(x+ca*fx*sc-sa*fz,y+0.19*sc,z+sa*fx*sc+ca*fz);_o.rotation.set(0,-a,sw);_o.scale.set(0.055,0.4*sc,0.055);_o.updateMatrix();sheepLeg.setMatrixAt(i*4+k,_o.matrix);});});
  [sheepBody,sheepHead,sheepLeg].forEach(m=>m.instanceMatrix.needsUpdate=true);
  // the dog runs round them; the shepherd walks behind
  const dg=DOGS[0],da=t*(F.graze?0.05:0.12),dr=spread*(F.graze?1.15:1.3)+1.5;dg.visible=true;
  const dx=F.x-Math.cos(ha)*(F.graze?0:spread)+Math.cos(da)*dr,dz=F.z-Math.sin(ha)*(F.graze?0:spread)+Math.sin(da)*dr;
  poseDog(dg,dx,dz,da+PI/2,F.graze?(Math.sin(t*0.02)>0.3?0:1):1,t);
  shepherd({x:F.x-Math.cos(ha)*(spread*len+4)+Math.sin(ha)*3,z:F.z-Math.sin(ha)*(spread*len+4)-Math.cos(ha)*3,graze:F.graze});}
const PASTOR_LOOK={h:1.0,w:1.06,f:false,long:false,pack:false,bag:false,skirt:false,bald:false,bun:false,jacket:false,big:false,hs:'short',
  head:'cap',outer:'coat',hood:false,stoop:false,cane:true,kid:false,
  c:{top:0x5C4A3A,sl:0x5C4A3A,leg:0x4C5258,skin:0xC99A78,hair:0x9A9590,shoe:0x2A2420,cap:0x1E2022,outer:0x6B553A,shirt:0xD8D2C4,tights:0x4C5258,bag:0x5A4636,scarf:0x3A3A3A}};
function shepherd(at){let p=PAX.find(q=>q.on&&q.crew==='pastor');
  if(!at){if(p)hidePax(p);return;}
  if(!p){p=newPax(at.x,at.z,'pastor');if(!p)return;Object.assign(p,{crew:'pastor',task:null,look:PASTOR_LOOK,sp:0.95});
    p.wear='coat';paxPaint(p);}
  const d=Math.hypot(at.x-p.x,at.z-p.z);if(d>60){p.x=at.x;p.z=at.z;p.wp=[];}
  else if(d>(at.graze?3.5:1.2)){p.wp=[{x:at.x,z:at.z}];p.wi=0;p.sp=Math.min(1.6,0.6+d*0.08);}}

/* ---------- dogs: the flock's carea and two loose ones in the village, trotting along the streets and stopping to sniff ---------- */
/* a dog, faceted like the sheep: barrel, deep chest and haunches, a neck, the head with its muzzle, nose and pricked ears,
   a tail that wags and four legs that swing from the shoulder and the hip */
function dog(col,col2){const g=new THREE.Group(),A=lam(col),B=lam(col2||col),N=lam(0x1A1816);
  const part=(par,geo,mat,cast)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=cast!==false;m.receiveShadow=true;par.add(m);return m;};
  part(g,lump([[ICO1,0.3,0.125,0.11,-0.02,0.45,0],[ICO0,0.16,0.16,0.125,0.19,0.46,0],[ICO0,0.14,0.14,0.12,-0.25,0.455,0],[ICO0,0.09,0.13,0.085,0.31,0.55,0,null,-0.6]]),A);
  part(g,lump([[ICO0,0.12,0.09,0.1,0.2,0.375,0],[ICO0,0.2,0.06,0.085,-0.02,0.385,0]]),B,false);
  const head=new THREE.Object3D();head.position.set(0.38,0.62,0);g.add(head);
  part(head,lump([[ICO0,0.105,0.095,0.095,0.02,0.01,0],[GEO.cone4,0.035,0.1,0.03,-0.01,0.115,0.058],[GEO.cone4,0.035,0.1,0.03,-0.01,0.115,-0.058]]),A);
  part(head,lump([[GEO.box,0.15,0.07,0.085,0.14,-0.025,0],[GEO.box,0.1,0.03,0.07,0.13,-0.07,0]]),B,false);part(head,lump([[GEO.box,0.03,0.035,0.05,0.225,-0.005,0]]),N,false);
  const tail=part(g,lump([[GEO.cone4,0.035,0.26,0.035,-0.059,0.116,0,null,0.47]]),A,false);tail.position.set(-0.37,0.5,0);tail.rotation.z=0.6;
  const LEG=lump([[new THREE.CylinderGeometry(0.046,0.026,0.34,5),1,1,1,0,-0.17,0],[GEO.box,0.085,0.035,0.06,0.012,-0.325,0]]);
  const legs=[[0.2,0.075],[0.2,-0.075],[-0.24,0.075],[-0.24,-0.075]].map(([x,z])=>{const p=new THREE.Object3D();p.position.set(x,0.34,z);g.add(p);part(p,LEG,B,false);return p;});
  g.userData={head,tail,legs};scene.add(g);return g;}
function poseDog(g,x,z,a,move,t){g.position.set(x,groundH(x,z),z);g.rotation.set(0,-a,0);const u=g.userData,s=Math.sin(t*9);
  u.legs.forEach((l,k)=>l.rotation.z=move?((k===0||k===3)?s:-s)*0.6:0);u.tail.rotation.z=0.6+Math.sin(t*12)*0.3;u.head.rotation.z=move?0:-0.5+Math.sin(t*0.7)*0.2;}
const DOGS=[dog(0x2A2826,0xE8E2D6),dog(0x8A5A32,0xC9A46A),dog(0xC9A46A)];
const DOGR=[null,ROADS.real.pts.map(p=>[p[0],p[1]+3.4]),ROADS.iglesia.pts.map(p=>[p[0]+2.6,p[1]])];
function polyAt(P,s){for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(s<=l||i===P.length-1){const u=Math.min(1,s/l);return{x:a[0]+(b[0]-a[0])*u,z:a[1]+(b[1]-a[1])*u,a:Math.atan2(b[1]-a[1],b[0]-a[0])};}s-=l;}}
const polyLen=P=>P.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-P[i][0],p[1]-P[i][1]),0);
function stepDogs(){const t=secOf(),hr=t/3600;[1,2].forEach(k=>{const g=DOGS[k],P=DOGR[k];if(hr<8+k||hr>20.5){g.visible=false;return;}g.visible=true;
  // trot a stretch, stop a while, come back: one cycle every 20 minutes
  const Lp=polyLen(P),cyc=1200,u=((t+k*517)%cyc)/cyc,leg=u<0.5?u*2:(1-u)*2,pause=Math.sin(u*TAU*3)>0.6;
  const s=Math.max(0,Math.min(Lp,(0.15+0.7*smoothV(leg))*Lp)),q=polyAt(P,s);poseDog(g,q.x,q.z,q.a+(u<0.5?0:PI),!pause,t);});}
function smoothV(x){return x*x*(3-2*x);}

/* ---------- birds: a flock wheeling over the fields (starlings in winter, swallows and sparrows the rest of the year) ---------- */
const NBIRD=IS_PHONE?24:48;
/* low poly: a spindle body with its head and forked tail, and two swept wings hinged at the shoulders that beat
   (each bird at its own pace, gliding now and then); every bird heads where it is going and banks into the turns */
const birdGeo=(()=>{const A=[],tri=(a,b,c)=>A.push(...a,...b,...c);
    const N=[0,0.01,0.15],T=[0,0.005,-0.11],L=[-0.035,0,0.01],Rr=[0.035,0,0.01],U=[0,0.035,0.02],D=[0,-0.03,0.02];
    [[N,L,U],[N,U,Rr],[N,Rr,D],[N,D,L],[T,U,L],[T,Rr,U],[T,D,Rr],[T,L,D]].forEach(f=>tri(...f));
    tri([0,0.004,-0.10],[-0.055,0,-0.20],[0,0.002,-0.15]);tri([0,0.004,-0.10],[0,0.002,-0.15],[0.055,0,-0.20]);   // the forked tail
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(A,3));g.computeVertexNormals();return g;})();
const wingGeo=(()=>{const A=[0,0,0.05, 0.13,0.01,0.04, 0,0,-0.04,  0.13,0.01,0.04, 0.29,0,-0.07, 0,0,-0.04,  0.13,0.01,0.04, 0.26,0,-0.02, 0.29,0,-0.07];
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(A,3));g.computeVertexNormals();
  const n=g.attributes.normal;for(let i=0;i<n.count;i++)n.setXYZ(i,0,1,0);return g;})();
const birdMat=new THREE.MeshBasicMaterial({color:0x2E2925,side:THREE.DoubleSide}),   // dark against the sky, as birds are seen
  birdM=new THREE.InstancedMesh(birdGeo,birdMat,NBIRD),
  wingR=new THREE.InstancedMesh(wingGeo,birdMat,NBIRD),wingL=new THREE.InstancedMesh(wingGeo,birdMat,NBIRD);
[birdM,wingR,wingL].forEach(m=>{m.frustumCulled=false;m.count=0;scene.add(m);});
const BR=mulberry(777),BIRDS=[];for(let i=0;i<NBIRD;i++)BIRDS.push({a:BR()*TAU,b:BR()*TAU,r:2+BR()*9,h:BR()*4,f:9+BR()*5,ph:BR()*TAU,gl:BR()*TAU,px:null,pz:null,py:0,yaw:0,bank:0});
let birdT=0;const _bm=new THREE.Matrix4(),_wm=new THREE.Matrix4(),_q=new THREE.Quaternion(),_e=new THREE.Euler(),_bv=new THREE.Vector3(),_bs=new THREE.Vector3(1.3,1.3,1.3);
function stepBirds(dtR){const t=secOf(),hr=t/3600;birdT+=dtR;
  if(hr<7.5||hr>19.5){birdM.count=wingR.count=wingL.count=0;return;}birdM.count=wingR.count=wingL.count=NBIRD;
  const T=birdT,cx=-40+190*Math.sin(T*0.021),cz=-20+70*Math.sin(T*0.013+1),cy=18+8*Math.sin(T*0.05);
  BIRDS.forEach((b,i)=>{const x=cx+b.r*Math.cos(b.a+T*0.4)*1.4,z=cz+b.r*Math.sin(b.a+T*0.37),y=cy+b.h+Math.sin(T*0.6+b.b)*2;
    if(b.px!==null&&dtR>0){const dx=x-b.px,dz=z-b.pz;if(dx*dx+dz*dz>1e-6){const yw=Math.atan2(dx,dz);let d=yw-b.yaw;d=Math.atan2(Math.sin(d),Math.cos(d));
        b.bank+=(clamp(-d/Math.max(dtR,1e-3)*0.35,-0.7,0.7)-b.bank)*Math.min(1,dtR*3);b.yaw=yw;}
      b.pitch=clamp(-(y-b.py)/Math.max(Math.hypot(dx,dz),1e-3),-0.5,0.5);}
    b.px=x;b.pz=z;b.py=y;
    _e.set(b.pitch||0,b.yaw,b.bank,'YXZ');_q.setFromEuler(_e);_bm.compose(_bv.set(x,y,z),_q,_bs);birdM.setMatrixAt(i,_bm);
    const glide=Math.sin(T*0.25+b.gl)>0.55,fl=glide?0.12:0.10+0.75*Math.sin(T*b.f+b.ph);
    _wm.makeRotationZ(fl).setPosition(0.03,0.01,0.01);wingR.setMatrixAt(i,_wm.premultiply(_bm));
    _wm.makeRotationZ(-fl).setPosition(-0.03,0.01,0.01);_wm.scale(_bv.set(-1,1,1));wingL.setMatrixAt(i,_wm.premultiply(_bm));});
  [birdM,wingR,wingL].forEach(m=>m.instanceMatrix.needsUpdate=true);}

/* ---------- smoke from the chimneys of the lived-in houses, October to April (more in the morning and the evening) ---------- */
const CHIM=HOUSES.filter(h=>h.chim&&h.use!=='cerrada'&&h.use!=='segunda').map(h=>h.chim);
const NP=6,smokeM=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),lam(0xD9D7D2,{transparent:true,opacity:0.32,depthWrite:false}),Math.max(1,CHIM.length*NP));
smokeM.frustumCulled=false;smokeM.count=0;scene.add(smokeM);let smokeT=0;
function stepSmoke(dtR){const d=dayOf(),m=monthOf(d),hr=secOf()/3600;smokeT+=dtR;
  const cold=m>=9||m<=3;if(!cold||hr<6.5||hr>23.5){smokeM.count=0;return;}
  const busy=(hr<10||hr>18)?1:0.45;let n=0;
  CHIM.forEach((c,ci)=>{if(hash(ci,Math.floor(d))>busy+0.1)return;
    for(let k=0;k<NP;k++){const life=7,u=((smokeT+k*life/NP+ci*1.3)%life)/life,s=0.2+u*0.75;
      _o.position.set(c.x+u*3.2+Math.sin(u*5+ci)*0.3,c.y+0.2+u*5.5,c.z+u*1.2);_o.rotation.set(u*2,ci,0);_o.scale.set(s*(1-u*0.4),s*0.8*(1-u*0.4),s*(1-u*0.4));_o.updateMatrix();smokeM.setMatrixAt(n++,_o.matrix);}});
  smokeM.count=n;smokeM.instanceMatrix.needsUpdate=true;}

NIVEL.dbgAmb={plan,fplan,flockAt,TR,CO,DOGS};
NIVEL.tick=function(dt){stepMachines();stepStorks(dt);stepFlock();stepDogs();stepBirds(dt);stepSmoke(dt);};
return{};};

/* ---- camara · vista inicial ---- */
NIVEL.camara=function(){
const HOME={theta:0.62,elev:0.60,size:IS_PHONE?150:178,tx:IS_PHONE?-2:-5,tz:IS_PHONE?-22:-30};
return{HOME};};

/* ---- sitio · situación (latitud, longitud y orientación de la línea) ---- */
NIVEL.sitio=function(){
const SITE={lat:42.59,lon:-3.44,bearing:225};
return{SITE};};

/* ---- clima · climatología AEMET de la estación meteorológica más cercana ---- */
NIVEL.clima=function(){
const AEMET_BU={DR:[7.5,6.9,6.1,9.2,9.3,5.7,3.6,3.4,5.3,8.3,8.7,9.3],DN:[4.7,3.7,2.8,1.9,0.3,0,0,0,0,0,1.7,3.4],
  I:[86,116,175,185,226,277,320,292,220,151,99,78],T:[3.1,4.1,7.0,8.6,12.2,16.5,19.5,19.5,16.1,11.5,6.6,3.9],
  DT:[0.1,0.1,0.4,1.5,4.0,3.4,3.3,3.0,1.9,0.6,0.1,0.1],DF:[6.8,3.8,1.6,1.1,1.5,1.3,0.8,1.3,1.7,2.9,4.6,6.0]};
return{AEMET_BU};};

/* ---- horario · horario de un día ---- */
NIVEL.horario=function(){
/* Horario de un día laborable (martes a jueves, fuera de verano y fiestas), reconstruido con dos guías de Renfe:
   - largo recorrido e internacionales: guía de Grandes Líneas de mayo de 1999;
   - regionales y regionales exprés: guía de septiembre de 1993 (tabla 115 Valladolid/León – Burgos – Miranda –
     Irún/Zaragoza).
   Hora en Santa Olalla: la de parada cuando la guía la da; si el tren pasa sin parar, interpolada por kilómetros entre
   Burgos, Briviesca, Miranda o Logroño (Santa Olalla queda a 32 km de Burgos, 15 de Briviesca y 57 de Miranda). En la
   realidad solo paraban aquí los regionales 6200 y 6207; a los otros dos regionales y a los cuatro regionales exprés se
   les ha dado parada para dar vida a la estación. El 38021 no está en la guía: es el gemelo inverso del 38020, añadido
   para que haya un tren de mañana hacia Briviesca y Miranda.
   Mercancías: no hay guía pública de los surcos de 1999, así que son inventados, metidos en los huecos y cargados de
   noche, con números de la familia 49300 (pares hacia Burgos, impares hacia Miranda). A propósito, algunos pasan pocos
   minutos por delante de un tren rápido del mismo sentido: el CTC pedirá apartarlos en Santa Olalla y, si salen
   delante, la orden cuenta como incumplida. Dos tienen el adelantamiento previsto en el horario (llegada y salida).
   [tipo, número, sentido (+1 hacia Burgos, -1 hacia Miranda), hora en Santa Olalla, salida si espera, origen, destino,
    nombre, rótulo] */
const TT_DAY=[
  // nocturnos
  ['estrella',930,-1,'00:00',null,'Gijón','Barcelona-Sants','Pío Baroja'],
  ['estrella',313,1,'01:15',null,'Irún','Lisboa-Santa Apolónia','Sud Expreso'],
  ['estrella',923,1,'01:46',null,'Barcelona-Sants','A Coruña','Galicia'],
  ['estrella',204,1,'02:19',null,'Irún','Madrid-Chamartín','Costa Vasca'],
  ['estrella',920,-1,'02:39',null,'A Coruña','Barcelona-Sants','Galicia'],
  ['estrella',205,-1,'03:45',null,'Madrid-Chamartín','Irún','Costa Vasca'],
  ['estrella',310,-1,'05:34',null,'Lisboa-Santa Apolónia','Hendaya','Sud Expreso'],
  ['estrella',933,1,'05:43',null,'Barcelona-Sants','Gijón','Pío Baroja'],
  // diurnos, Intercity y Talgos
  ['ic',530,-1,'10:48',null,'Salamanca','Barcelona-Sants','Miguel de Unamuno'],
  ['ic',202,1,'11:01',null,'Irún','Madrid-Chamartín'],
  ['diurno',283,1,'11:53',null,'Irún','Vigo'],
  ['diurno',410,-1,'13:19',null,'Salamanca','Irún'],
  ['ic',203,-1,'13:44',null,'Madrid-Chamartín','Irún'],
  ['diurno',623,1,'14:57',null,'Barcelona-Sants','Gijón','Covadonga'],
  ['diurno',620,-1,'15:22',null,'Gijón','Barcelona-Sants','Covadonga'],
  ['diurno',413,1,'16:42',null,'Irún','Salamanca'],
  ['diurno',280,-1,'17:12',null,'Vigo','Irún'],
  ['alvia',200,1,'18:42',null,'Irún','Madrid-Chamartín'],
  ['alvia',201,-1,'19:03',null,'Madrid-Chamartín','Irún'],
  ['ic',533,1,'20:36',null,'Barcelona-Sants','Salamanca','Miguel de Unamuno'],
  // regionales (432) y regionales exprés (470): paran un minuto
  ['md',38020,1,'08:19',null,'Vitoria-Gasteiz','Madrid-Chamartín','Sierra de Gorbea','R. Exprés'],
  ['md',6200,1,'09:12',null,'Vitoria-Gasteiz','Burgos',null,'Regional'],
  ['md',38021,-1,'08:14',null,'Madrid-Chamartín','Vitoria-Gasteiz','Sierra de Gorbea','R. Exprés'],   // inventado: gemelo inverso del 38020
  ['md',38415,-1,'11:59',null,'Valladolid','Logroño',null,'Regional'],
  ['md',6207,-1,'14:09',null,'Burgos','Vitoria-Gasteiz',null,'Regional'],
  ['md',6001,-1,'17:55',null,'Madrid-Chamartín','Zaragoza',null,'R. Exprés'],
  ['md',38417,1,'18:08',null,'Logroño','Valladolid',null,'Regional'],
  ['md',6000,1,'18:50',null,'Zaragoza','Madrid-Chamartín',null,'R. Exprés'],
  ['md',8021,-1,'21:43',null,'Madrid-Chamartín','Bilbao-Abando','Sierra de Gorbea','R. Exprés'],
  // mercancías hacia Burgos: los de 01:11, 14:52 y 18:38 van justos delante del 313, el 623 y el 200;
  // el de 10:52 espera en vía 3 a que le adelante el Intercity 202
  ...['00:20','00:44','01:11','02:52','03:20','03:55','04:30','05:05','06:30','07:15',['10:52','11:06'],'12:40',
      '14:52','16:10','18:38','19:40','21:10','22:30','23:15'].map((t,i)=>['merc',49300+2*i,1].concat(t)),
  // mercancías hacia Miranda: los de 03:40, 10:44 y 17:08 van justos delante del 205, el 530 y el 280;
  // el de 13:12 espera en vía 3 a que le adelante el diurno 410
  ...['00:35','01:05','01:40','02:15','03:05','03:40','04:25','05:10','06:15','07:30','09:00','10:44',['13:12','13:24'],
      '15:12','16:30','17:08','18:20','20:00','21:00','22:15','23:20'].map((t,i)=>['merc',49301+2*i,-1].concat(t))];
const TT_TALGO={},TT_ESTRELLA={};
const TT_MERC=[['Madrid-Abroñigal','Irún'],['Valladolid-Argales','Vitoria-Júndiz'],['Venta de Baños','Irún'],['Medina del Campo','Vitoria-Júndiz'],['Burgos-Villafría','Irún']];
/* los regionales van en 432 reformada (librea Regionales); los regionales exprés, en 470 */
const MD432={6200:1,6207:1,38415:1,38417:1};
return{TT_DAY,TT_TALGO,TT_ESTRELLA,TT_MERC,MD432};};

/* ---- linea · estaciones colindantes y bloqueo ---- */
NIVEL.linea=function(){
const LINE={C:2000,OB1:2300,side:{'1':{prev:'Briviesca',next:'Quintanapalla',Lin:10800,Lout:11200},'-1':{prev:'Quintanapalla',next:'Briviesca',Lin:11200,Lout:10800}},
  faults:[],powerUntil:0,blk:{'1':null,'-1':null},day:0};
return{LINE};};

/* ---- nombres · nombres y apellidos de la zona y pueblos de la comarca ---- */
NIVEL.nombres=function(){
const NOM={M:{old:['Pilar','Carmen','María','Dolores','Mercedes','Josefa','Concepción','Ascensión','Purificación','Julia','Teresa','Felisa','Visitación','Agustina','Encarnación','Milagros','Petra','Rosario','Amparo','Florentina','Eulalia','Angelines','Consuelo','Aurora','Saturnina','Benita','Leonor','Gloria'],
  mid:['Mari Carmen','Ana','Isabel','Rosa','Marisa','Yolanda','Esther','Susana','Begoña','Maite','Charo','Pili','Lourdes','Inés','Alicia','Elena','Marta','Mari Luz','Montse','Belén','Nieves','Paloma'],
  yng:['Cristina','Laura','Sonia','Raquel','Silvia','Nuria','Beatriz','Patricia','Vanesa','Noelia','Lorena','Eva','Natalia','Sara','Rebeca','Irene']},
 H:{old:['José','Antonio','Juan','Julián','Eusebio','Gregorio','Teodoro','Florentino','Faustino','Celestino','Valentín','Saturnino','Emiliano','Ángel','Félix','Marcelino','Isidro','Benito','Lorenzo','Tomás','Victoriano','Eugenio','Ricardo','Pedro','Severiano','Clemente'],
  mid:['Javier','Jesús','Luis','Miguel Ángel','Fernando','Carlos','Alberto','José Luis','Santiago','Ignacio','Ramón','Juan Carlos','Alfonso','Andrés','Rafael','Julio','Enrique','Roberto','Jose Mari','Agustín','César','Ángel'],
  yng:['David','Sergio','Raúl','Óscar','Iván','Rubén','Álvaro','Daniel','Diego','Jorge','Víctor','Pablo','Héctor','Mario','Adrián','Alfonso']}};
const APE=['García','Martínez','González','López','Pérez','Ruiz','Díez','Alonso','Ortega','Arnáiz','Ortiz','Santamaría','Varona','Barriuso','Peña','Saiz','Gómez','Hernando','Cuesta','Miguel','Palacios','del Moral','Ibeas','Revilla','Arroyo','Llorente','Moreno','del Olmo','Marcos','Mena','Abad','del Barrio','Plaza','Quintana','Fernández','Sedano','Rodrigo','Lázaro','Puente','Gil','Calvo','Manso','Pascual','Sáez','Villanueva','Ubierna','Bartolomé','Sancho','Rojo','Cámara','Hidalgo','Bárcena'];
const COMARCA=['Quintanavides','Galbarros','Santa María del Invierno','Monasterio de Rodilla','Caborredondo','Castil de Peones','Prádanos de Bureba'];

/* ---- casas: puerta, calle y número (impares a un lado, pares al otro) ---- */
return{NOM,APE,COMARCA};};

/* ---- gente · calles, trabajos y censo de vecinos ---- */
NIVEL.gente=function(){
const CALLE={real:'Calle Real',arriba:'Calle de Arriba',iglesia:'Calle de la Iglesia',camino:'Camino de la Estación'};
const J0={x:-6,z:-80},J1={x:-6,z:-120};
HOUSES.forEach((H,i)=>{H.i=i;const cx=(H.x0+H.x1)/2,cz=(H.z0+H.z1)/2;
  H.door=H.front==='s'?{x:cx,z:H.z1+0.6}:H.front==='n'?{x:cx,z:H.z0-0.6}:H.front==='e'?{x:H.x1+0.6,z:cz}:{x:H.x0-0.6,z:cz};
  const D=H.door;
  if((H.front==='e'||H.front==='w')&&Math.abs(D.x+6)<6){H.st=D.z<-80?'iglesia':'camino';H.pos=H.st==='iglesia'?-D.z:D.z;H.side=D.x<-6?0:1;}
  else{const dr=Math.abs(D.z+80),da=(D.x>-82&&D.x<42)?Math.abs(D.z+120):1e9;H.st=da<dr?'arriba':'real';H.pos=D.x;H.side=D.z<(H.st==='real'?-80:-120)?0:1;}});
Object.keys(CALLE).forEach(k=>[0,1].forEach(sd=>{HOUSES.filter(H=>H.st===k&&H.side===sd).sort((a,b)=>a.pos-b.pos).forEach((H,j)=>{H.num=2*j+(sd?2:1);H.addr=CALLE[k]+', '+H.num;});}));
/* walking: door → street → crossroads of Calle Real with the station road (J0); the station road houses join it directly */
function houseRoute(h){const H=HOUSES[h],D=H.door;
  if(H.st==='real')return[D,{x:D.x,z:-80},J0];
  if(H.st==='arriba')return[D,{x:D.x,z:-120},J1,J0];
  if(H.st==='iglesia')return[D,{x:-6,z:D.z},J0];
  return[D,{x:-6,z:D.z}];}
const CARPT=()=>({x:15+Math.random()*3,z:-33.5+Math.random()*3});   // the cars leave them and pick them up in the car park

/* ---- la gente ---- */
/* trabajos y estudios (salida y vuelta en el regional) */
const RUT={
  burgosFab:{k:'trabajo',up:38020,down:6001,dest:'Burgos',job:'Trabaja en una fábrica del polígono de Villalonquéjar (Burgos)'},
  yague:{k:'trabajo',up:38020,down:6001,dest:'Burgos',job:'Enfermera en el Hospital General Yagüe (Burgos)'},
  correos:{k:'trabajo',up:38020,down:6001,dest:'Burgos',job:'Cartero en Correos, en Burgos'},
  caja:{k:'trabajo',up:38020,down:6001,dest:'Burgos',job:'Trabaja en una oficina de la Caja de Burgos'},
  dipu:{k:'trabajo',up:38020,down:6001,dest:'Burgos',job:'Administrativo en la Diputación de Burgos'},
  ayuBriv:{k:'trabajo',up:38021,down:38417,dest:'Briviesca',job:'Administrativa en el Ayuntamiento de Briviesca'},
  maestra:{k:'trabajo',up:38021,down:38417,dest:'Briviesca',job:'Maestra en un colegio de Briviesca'},
  tallerBriv:{k:'trabajo',up:38021,down:38417,dest:'Briviesca',job:'Mecánico en un taller de Briviesca'},
  renfeMir:{k:'trabajo',up:38021,down:38417,dest:'Miranda de Ebro',job:'Factor de circulación en la estación de Miranda (Renfe)'},
  monte:{k:'trabajo',up:38021,down:6000,dest:'Miranda de Ebro',job:'Trabaja en la fábrica de Montefibre, en Miranda'},
  bayas:{k:'trabajo',up:38021,down:38417,dest:'Miranda de Ebro',job:'Trabaja en una química del polígono de Bayas (Miranda)'},
  ubu:{k:'estudios',up:6200,down:6207,dest:'Burgos',job:'Estudia en la Universidad de Burgos'},
  ubuSem:{k:'semanal',up:38020,down:6207,dest:'Burgos',job:'Estudia en la Universidad de Burgos; entre semana vive en un piso de estudiantes'}};

(function censo(){
  const R=GR,idx=HOUSES.map((H,i)=>i);
  for(let i=idx.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[idx[i],idx[j]]=[idx[j],idx[i]];}
  const near=idx.filter(i=>HOUSES[i].st!=='real'||Math.abs(HOUSES[i].door.z+80)<8),far=idx.filter(i=>near.indexOf(i)<0),order=near.concat(far);
  let hi=0;const nextHouse=()=>order[hi++];
  const casa=(use)=>{const h=nextHouse();HOUSES[h].use=use;return h;};
  const visitas=(h,parents,R)=>{const n=R()<0.35?2:1;for(let k=0;k<n;k++){const sx=R()<0.5?'H':'M',city=gpick(['Burgos','Burgos','Burgos','Bilbao','Bilbao','Vitoria-Gasteiz','Madrid','Madrid','Miranda de Ebro','Valladolid'],R);
    const pa=parents.find(p=>p.sx==='H')||parents[0],ma=parents.find(p=>p.sx==='M')||parents[0];
    persona({sx:sx,age:Math.round(grr(34,58,R)),kind:'visita',city:city,base:h,a1:pa.sx==='H'?pa.a1:gpick(APE,R),a2:ma.sx==='M'?ma.a1:gpick(APE,R),parents:parents.map(p=>p.id),
      rel:(sx==='M'?'Hija':'Hijo')+' de '+parents.map(p=>p.n).join(' y ')});}};
  // 9 matrimonios mayores
  for(let k=0;k<9;k++){const h=casa('vecino'),a=Math.round(grr(68,88)),H1=persona({sx:'H',age:a,kind:'vecino',home:h,base:h}),M1=persona({sx:'M',age:Math.max(64,a-Math.round(grr(0,6))),kind:'vecino',home:h,base:h});
    H1.rel='Casado con '+M1.n;M1.rel='Casada con '+H1.n;visitas(h,[H1,M1],R);}
  // 2 familias
  const fam=(jobH,jobM,kid1,kid2)=>{const h=casa('vecino'),H1=persona({sx:'H',age:Math.round(grr(43,52)),kind:'vecino',home:h,base:h,rut:jobH,job:jobH?jobH.job:'Agricultor'}),
      M1=persona({sx:'M',age:Math.round(grr(41,49)),kind:'vecino',home:h,base:h,rut:jobM,job:jobM?jobM.job:null});H1.rel='Casado con '+M1.n;M1.rel='Casada con '+H1.n;
    const c1=persona({sx:kid1.sx,age:Math.round(grr(19,22)),kind:'vecino',home:h,base:h,rut:kid1.rut,job:kid1.rut.job,a1:H1.a1,a2:M1.a1,rel:(kid1.sx==='M'?'Hija':'Hijo')+' de '+H1.n+' y '+M1.n});
    const c2=persona({sx:kid2,age:Math.round(grr(13,16)),kind:'vecino',home:h,base:h,job:'Va al instituto de Briviesca en el autobús escolar',a1:H1.a1,a2:M1.a1,rel:(kid2==='M'?'Hija':'Hijo')+' de '+H1.n+' y '+M1.n});
    [H1,M1,c1,c2].forEach(p=>{p.look=mkLook(p,R);});};
  fam(RUT.burgosFab,null,{sx:'H',rut:RUT.ubu},'M');
  fam(null,RUT.ayuBriv,{sx:'M',rut:RUT.ubuSem},'H');
  // 7 viudos, casi todas mujeres (y de luto la mayoría)
  for(let k=0;k<7;k++){const h=casa('vecino'),sx=k<6?'M':'H',P=persona({sx:sx,age:Math.round(grr(72,92)),kind:'vecino',home:h,base:h,luto:sx==='M'});P.rel=sx==='M'?'Viuda':'Viudo';P.look=mkLook(P,R);visitas(h,[P],R);}
  // 3 que viven solos y trabajan fuera
  [[ 'H',46,RUT.renfeMir],['M',38,RUT.yague],['M',52,RUT.maestra]].forEach(([sx,a,r])=>{const h=casa('vecino'),P=persona({sx:sx,age:a,kind:'vecino',home:h,base:h,rut:r,job:r.job});P.rel=sx==='M'?'Soltera':'Soltero';P.look=mkLook(P,R);});
  // 2 hermanas solteras
  {const h=casa('vecino'),a1=gpick(APE),a2=gpick(APE),A=persona({sx:'M',age:76,kind:'vecino',home:h,base:h,a1:a1,a2:a2}),B=persona({sx:'M',age:73,kind:'vecino',home:h,base:h,a1:a1,a2:a2});
    A.rel='Vive con su hermana '+B.n;B.rel='Vive con su hermana '+A.n;visitas(h,[A],R);}
  // madre viuda con su hijo soltero
  {const h=casa('vecino'),M1=persona({sx:'M',age:81,kind:'vecino',home:h,base:h,luto:true}),S=persona({sx:'H',age:50,kind:'vecino',home:h,base:h,rut:RUT.correos,job:RUT.correos.job,a2:M1.a1});
    M1.rel='Viuda · vive con su hijo '+S.n;S.rel='Vive con su madre, '+M1.n;M1.look=mkLook(M1,R);S.look=mkLook(S,R);}
  // 7 casas de segunda residencia: familias del pueblo que emigraron
  ['Bilbao','Bilbao','Vitoria-Gasteiz','Burgos','Burgos','Madrid','Madrid'].forEach(city=>{const h=casa('segunda'),fid='f'+h,a=Math.round(grr(48,64)),
      H1=persona({sx:'H',age:a,kind:'segunda',city:city,home:h,base:h,fam:fid}),M1=persona({sx:'M',age:a-Math.round(grr(0,5)),kind:'segunda',city:city,home:h,base:h,fam:fid});
    H1.rel='Casado con '+M1.n;M1.rel='Casada con '+H1.n;
    if(R()<0.5){const c=persona({sx:R()<0.5?'H':'M',age:Math.round(grr(15,24)),kind:'segunda',city:city,home:h,base:h,fam:fid,a1:H1.a1,a2:M1.a1});c.rel=(c.sx==='M'?'Hija':'Hijo')+' de '+H1.n+' y '+M1.n;}
    HOUSES[h].fam=fid;HOUSES[h].city=city;HOUSES[h].famName=H1.a1;});
  // the rest, closed
  while(hi<order.length){const h=nextHouse();HOUSES[h].use='cerrada';HOUSES[h].why=gpick(['Cerrada · los dueños viven en Madrid','Cerrada desde que murió su dueña','En venta','Cerrada · la heredaron unos sobrinos de Barcelona'],R);}
  // la comarca: 20 personas por pueblo; dos trabajan fuera, alguno estudia en Burgos y el resto viaja de vez en cuando
  const jobs=[RUT.burgosFab,RUT.caja,RUT.dipu,RUT.tallerBriv,RUT.monte,RUT.bayas,RUT.yague,RUT.correos];
  COMARCA.forEach((v,vi)=>{for(let k=0;k<20;k++){let o={kind:'comarca',from:v};
    if(k<2){const r=jobs[(vi*2+k)%jobs.length];o.rut=r;o.job=r.job;o.sx=r===RUT.yague?'M':R()<0.6?'H':'M';o.age=Math.round(grr(28,55));}
    else if(k===2&&vi%3!==2){o.rut=RUT.ubu;o.job=RUT.ubu.job;o.sx=R()<0.5?'H':'M';o.age=Math.round(grr(18,23));}
    else{o.sx=R()<0.58?'M':'H';o.age=Math.round(R()<0.55?grr(62,88):grr(17,61));o.luto=o.sx==='M'&&o.age>72&&R()<0.5;}
    if(o.rut===RUT.yague)o.job='Celador en el Hospital General Yagüe (Burgos)';
    if(o.rut&&o.rut.k==='trabajo'&&o.sx==='M'&&o.job.indexOf('Mecánico')===0)o.job='Trabaja en un taller de Briviesca';
    const P=persona(o,R);P.look=mkLook(P,R);}});
  GENTE.forEach(P=>{P.walk=P.base!=null?(routeLen(houseRoute(P.base))+85)/P.sp:35/P.sp;
    ent('px:'+P.id,{kind:'person',person:P,name:P.n+' '+P.a1,sub:pSub(P),anchor:()=>P.px&&P.px.on?[P.px.x,P.px.y+2.1,P.px.z]:null,
      bbFn:()=>P.px&&P.px.on?[P.px.x-0.45,P.px.y,P.px.z-0.45,P.px.x+0.45,P.px.y+1.95,P.px.z+0.45]:null});});
})();
return{houseRoute,CARPT};};

/* ---- viajes · motivos de viaje, sentidos y trenes de cada ciudad ---- */
NIVEL.viajes=function(){
const MOTIVO=[
  {dir:1,ups:[38020,6200],downs:[6207,6001],dest:'Burgos',why:'Va a una consulta en el Hospital General Yagüe',back:'Vuelve de la consulta en el Yagüe',age:[50,99],w:3},
  {dir:1,ups:[6200],downs:[6207,6001,8021],dest:'Burgos',why:'Va de compras a Burgos',back:'Vuelve de compras en Burgos',age:[16,85],w:3},
  {dir:1,ups:[6200],downs:[6207,6001],dest:'Burgos',why:'Va a hacer gestiones a Burgos (Hacienda, la Diputación)',back:'Vuelve de hacer gestiones en Burgos',age:[25,80],w:2},
  {dir:1,ups:[6200,38417],downs:[8021],dest:'Burgos',why:'Va a ver a su hija, que vive en Burgos',back:'Vuelve de ver a su hija en Burgos',age:[55,99],w:2},
  {dir:1,ups:[38417,6000],downs:[8021],dest:'Burgos',why:'Sale por Burgos: cine y cena',back:'Vuelve de salir por Burgos',age:[17,35],w:2},
  {dir:1,ups:[6200],multi:[2,6],downs:[38415,6207,6001],dest:'Valladolid',why:'Se va unos días a casa de su hijo, en Valladolid',back:'Vuelve de pasar unos días en Valladolid',age:[60,99],w:1},
  {dir:-1,ups:[38021,38415],downs:[38417],dest:'Briviesca',why:'Va al médico al centro de salud de Briviesca',back:'Vuelve del centro de salud de Briviesca',age:[45,99],w:4},
  {dir:-1,ups:[38021,38415],downs:[38417],dest:'Briviesca',why:'Va al banco y a la plaza de Briviesca',back:'Vuelve de Briviesca con la compra',age:[30,90],w:3},
  {dir:-1,ups:[38021,38415,6207],downs:[38417,6000],dest:'Miranda de Ebro',why:'Va a ver a su hermana a Miranda',back:'Vuelve de ver a su hermana en Miranda',age:[50,99],w:2},
  {dir:-1,ups:[38021,38415],downs:[6000],dest:'Vitoria-Gasteiz',why:'Va de compras a Vitoria',back:'Vuelve de compras en Vitoria',age:[18,70],w:1},
  {dir:-1,ups:[38021,38415,6207],multi:[2,8],downs:[6200,38417],dest:'Bilbao',why:'Se va unos días a Bilbao, con sus hijos (cambia de tren en Miranda)',back:'Vuelve de pasar unos días en Bilbao',age:[60,99],w:1},
  {dir:-1,ups:[38021,38415],downs:[38417],dest:'Briviesca',why:'Tiene hora en el dentista, en Briviesca',back:'Vuelve del dentista de Briviesca',age:[20,85],w:2},
  {dir:-1,ups:[38021,38415],downs:[38417],dest:'Briviesca',why:'Va a la peluquería a Briviesca',back:'Vuelve de la peluquería',age:[30,90],w:2},
  {dir:-1,ups:[38021,38415,6207],downs:[38417,6000],dest:'Briviesca',why:'Va a la notaría de Briviesca a firmar unas tierras',back:'Vuelve de la notaría de Briviesca',age:[40,90],w:1},
  {dir:-1,ups:[6207,6001],multi:[1,3],downs:[6200,38417],dest:'Miranda de Ebro',why:'Se va a dormir a casa de su hija, en Miranda',back:'Vuelve de pasar unos días en Miranda',age:[55,99],w:2},
  {dir:-1,ups:[6001,8021],multi:[1,3],downs:[6200,38417],dest:'Vitoria-Gasteiz',why:'Se va unos días a Vitoria, a casa de su hermano',back:'Vuelve de Vitoria',age:[25,90],w:2},
  {dir:-1,ups:[6001,8021],multi:[2,4],downs:[38417],dest:'Bilbao',why:'Se va a Bilbao a ver el fútbol y a casa de unos primos',back:'Vuelve de Bilbao',age:[18,60],w:1},
  {dir:1,ups:[38020,6200],downs:[6207,6001],dest:'Burgos',why:'Va al oculista, en Burgos',back:'Vuelve del oculista de Burgos',age:[40,95],w:2},
  {dir:1,ups:[6200],downs:[6001,8021],dest:'Burgos',why:'Va a ver a un amigo ingresado en el Yagüe',back:'Vuelve del hospital',age:[30,95],w:1},
  {dir:1,ups:[6000],multi:[1,3],downs:[38415,6207],dest:'Burgos',why:'Se va a dormir a casa de su hija, en Burgos',back:'Vuelve de pasar unos días en Burgos',age:[55,99],w:2}];
const desdeSO=c=>({Burgos:1,Madrid:1,Valladolid:1,Palencia:1}[c]?-1:1);   // trains bringing someone from city c run in this direction
const llegaDe=c=>desdeSO(c)<0?[38021,38415,6207]:[38020,6200],vaA=c=>desdeSO(c)<0?[38417,6000]:[38021,6001,8021];
// segunda residencia: llegan por la tarde y se vuelven por la tarde
const segLlega=c=>desdeSO(c)<0?[6001,8021]:[38417,6000],segVuelve=c=>desdeSO(c)<0?[38417,6000]:[6001,8021];

/* ---- plan del día: quién sube y quién baja en cada MD ----
   viajeros que suben en cada MD (mínimo y máximo, contando los habituales): muchos a primera hora, pocos por la noche */
const TGT={38020:[9,13],38021:[8,12],6200:[7,11],38415:[6,10],6207:[5,9],6001:[5,9],38417:[4,8],6000:[3,6],8021:[2,5]};
return{MOTIVO,desdeSO,llegaDe,vaA,segLlega,segVuelve,TGT};};

/* ---- carreteras · red de carreteras, cruces y salidas de la comarca ---- */
NIVEL.carreteras=function(){
const RP={
  E:{pts:[[442,-122],[262,-100],[150,-88],[78,-80],[-6,-80]],seg:[{o:1.7,v:22},{o:1.7,v:22},{o:1.7,v:16},{o:1.7,v:11}]},
  W:{pts:ROADS2.oeste.slice().reverse(),seg:[{o:1.6,v:19},{o:1.6,v:19},{o:1.6,v:19},{o:1.6,v:16}]},
  S:{pts:ROADS2.sur.slice().reverse().concat([[-228,18],[-228,-14],[-212,-36]]),seg:[{o:1.6,v:19},{o:1.6,v:16},{o:1.7,v:12},{o:1.7,v:11},{o:1.7,v:14}]},
  P:{pts:[[-212,-36],[-168,-64],[-122,-80],[-6,-80]],seg:[{o:1.7,v:22},{o:1.7,v:19},{o:1.7,v:11}]},
  N:{pts:[[5,-201],[4,-184],[0,-168],[-5,-154],[-7,-142],[-6,-132],[-6,-120],[-6,-80]],seg:[{o:0.6,v:8},{o:0.6,v:8},{o:0.6,v:8},{o:0.6,v:8},{o:0.6,v:6},{o:0.8,v:5.5},{o:0.8,v:4.5}]},
  C:{pts:[[-6,-80],[-6,-62],[-4,-48],[-2.86,-40]],seg:[{o:1.35,v:11},{o:1.35,v:11},{o:1.35,v:8}]}
};
/* junctions: centre, radius, and the pieces that have the right of way */
const JN={J0:{x:-6,z:-80,r:4.6,prio:['E','P']},JP:{x:-212,z:-36,r:4.6,prio:['P','S']}};
const EDGE={E:{piece:'E',j:'J0'},W:{piece:'W',j:'JP'},S:{piece:'S',j:'JP'},N:{piece:'N',j:'J0'}};
/* where each village of the comarca comes from */
const COMARCA_EDGE={'Quintanavides':'W','Prádanos de Bureba':'W','Monasterio de Rodilla':'E','Caborredondo':'E','Santa María del Invierno':'S','Castil de Peones':'S','Galbarros':'N'};
/* the pieces to drive from an edge to a junction, or between junctions, each with its sense (+1 as drawn, -1 reversed) */
return{RP,JN,COMARCA_EDGE};};

/* ---- plazaTrafico · entrada y parada de la plaza de la estación ---- */
NIVEL.plazaTrafico=function(){
const SQP={ent:{x:-4.21,z:-41},ext:{x:-1.51,z:-41},stop:{x:-8,z:-28.4}};
return{SQP};};

/* ---- tramos · nombres de las estaciones colindantes ---- */
NIVEL.tramos=function(){
const SIDES={B:'Briviesca',Q:'Quintanapalla'};
return{SIDES};};

/* ---- tramosTxt · nombres de los trayectos y vías por sentido ---- */
NIVEL.tramosTxt=function(){
const trayN=s=>s==='B'?'Briviesca – Santa Olalla':'Santa Olalla – Quintanapalla';
const viaN=dir=>dir>0?'vía II':'vía I';   // the two tracks of the line (BAB), continuation of the station's vías 2 and 1: II, habitual towards Burgos; I, towards Miranda
return{trayN,viaN};};
/* ---- fichasVias · fichas de las vías para el inspector ---- */
NIVEL.fichasVias=function(){
[['v1','Vía 2','Vía general · andén 1',[['Tipo','General (directa)'],['Sentido normal','Miranda → Burgos'],['Andén','Andén 1 · lateral'],['Longitud útil','280 m (S1/2 – S2/2) · 700 m en la realidad'],['Velocidad','160 km/h por directa'],['Electrificación','3 kV cc']]],
 ['v2','Vía 1','Vía general · andén 2',[['Tipo','General (directa)'],['Sentido normal','Burgos → Miranda'],['Andén','Andén 2 · central'],['Longitud útil','190 m (S1/1 – S2/1) · 560 m en la realidad'],['Velocidad','160 km/h por directa'],['Electrificación','3 kV cc']]],
 ['v3','Vía 3','Vía desviada · andén 2',[['Tipo','Desviada (apartadero)'],['Andén','Andén 2 · central'],['Longitud útil','242 m (S1/3 – S2/3) · 582 m en la realidad'],['Acceso','Agujas 5 y 6 desde vía 1'],['Señal intermedia','S2/3A, protege la aguja 7'],['Velocidad','30 km/h por desviada'],['Electrificación','3 kV cc']]],
 ['v5','Vía 5','Vía de servicio · en topera',[['Tipo','Servicio (apartado)'],['Andén','No'],['Longitud útil','172 m (S2/5 – topera) · 377 m en la realidad'],['Acceso','Aguja 7 desde vía 3, solo desde el lado Burgos'],['Salida','En retroceso hasta la vía 3, luego por la S1/3'],['Estacionado','El tren de trabajos de Infraestructura (53 m: dos coches taller, vagoneta con bobinas y vagoneta castillete), junto a la topera; la 311 viene de Miranda a por él'],['Velocidad','30 km/h por desviada · 10 km/h en retroceso'],['Electrificación','3 kV cc']]]
].forEach(r=>{ent(r[0],{kind:'track',name:r[1],sub:r[2],rows:r[3]});});
ENT.v1.anchor=[30,1,0];ENT.v2.anchor=[30,1,4.3];ENT.v3.anchor=[40,1,13.7];ENT.v5.anchor=[-60,1,18.2];

return{};};
/* ---- catenaria · catenaria: postes y hilos ---- */
NIVEL.catenaria=function(){
(function catenary(){
  const XS=[-434,-396,-358,-320,-280,-240,-200,-160,-124,-88,-50,24,56,88,124,160,200,240,280,320,358,396,434];
  const wire=[];
  /* one cantilever mast per track at every mast line: lattice mast (two flanges with rungs on both faces,
     tapering to the top) on a concrete block, strut + top tube + tie rod, messenger insulator over the
     track, drop to the registration insulator beyond it and the steady arm back to the contact wire */
  const YM=6.1,YS=7.35;                       // contact wire and messenger (as the wires below)
  const rod=(mat,x,ya,za,yb,zb,r)=>{const dy=yb-ya,dz=zb-za,L=Math.hypot(dy,dz);put('cyl6',mat,x,(ya+yb)/2,(za+zb)/2,r,L,r,Math.atan2(dz,dy),0,0);};
  function mast(x,zM,zT,base){
    const sd=Math.sign(zT-zM),R=Math.abs(zT-zM)+0.55,Z=f=>zM+sd*f;  // Z(f): f metres from the mast towards the track
    const top=YS+0.12,H=top-base,d0=0.40,d1=0.26,w=0.24;
    // concrete block (smaller plinth on a platform)
    if(base<0.5)sbox(M.hormigon,x,base-0.05,zM,0.72,0.42,0.72);else sbox(M.hormigon,x,base,zM,0.5,0.12,0.5,0,true);
    const yb=base+(base<0.5?0.37:0.12),Hm=top-yb,lean=Math.atan(((d0-d1)/2)/Hm);
    // flanges (narrow faces, leaning in) and the rungs of the lattice on both faces
    [-1,1].forEach(k=>put('box',M.galva,x,yb+Hm/2,zM+k*(d0+d1)/4,w,Hm,0.05,-k*lean,0,0));
    for(let y=yb+0.45;y<top-0.2;y+=0.55){const t=(y-yb)/Hm,dd=lerp(d0,d1,t)-0.06;[-1,1].forEach(k=>put('box',M.galva,x+k*(w/2-0.02),y,zM,0.03,0.05,dd,0,0,0,true));}
    sbox(M.galva,x,top,zM,w+0.04,0.06,d1+0.04,0,true);
    // cantilever
    const b1=0.49*R,yU=YS-0.15,zTr=Math.abs(zT-zM);
    rod(M.galva,x,YM+0.05,Z(0.1),yU-0.05,Z(b1),0.045);                 // strut from the mast up to the top tube
    rod(M.galva,x,top-0.08,Z(0.1),yU+0.02,Z(b1),0.015);                // tie rod
    rod(M.galva,x,yU-0.05,Z(b1),yU,Z(zTr+0.15),0.04);                  // top tube over the track
    rod(M.galva,x,yU,Z(zTr+0.15),YM+0.28,Z(R),0.035);                  // drop beyond the track
    scyl(M.aislador,x,yU+0.02,Z(zTr),0.07,YS-yU-0.04);                  // messenger support insulator
    put('cyl6',M.aislador,x,YM+0.28,Z(R-0.12),0.06,0.26,0.06,PI/2,0,0); // registration insulator
    rod(M.galva,x,YM+0.27,Z(R-0.25),YM+0.02,Z(zTr),0.02);              // steady arm back to the contact wire
    rod(M.galva,x,YM+0.02,Z(zTr),YM+0.12,Z(zTr-0.12),0.015);
  }
  const onA1=(x,z)=>Math.abs(x)<=80&&z>-10.7&&z<-1.72,onA2=(x,z)=>Math.abs(x)<=80&&z>6.02&&z<11.98,onMuelle=(x,z)=>x>=-70&&x<=10&&z>20.4&&z<30;
  const baseAt=(x,z)=>onA1(x,z)||onA2(x,z)?PH:(onMuelle(x,z)?1.25:0);
  const LINES=[['v1',X0+1,X1-1,-1],['v2',X0+1,X1-1,1],['v3',-152,152,-1],['v5',-152,60,1]];
  LINES.forEach(([id,xa,xb,side])=>{XS.filter(x=>x>xa&&x<xb).forEach(x=>{const zT=zAt(TRACKS[id].pts,x);if(zT===null)return;
    // vía 3 out on its curves: mast on its outer side, clear of the vía 1 mast (towards Miranda it stands between vías 3 and 5)
    const sd=(id==='v3'&&Math.abs(x)>100)?1:side,zM=zT+sd*(id==='v5'?2.8:3.0);
    mast(x,zM,zT,baseAt(x,zM));});});
  /* vía 5: anchor mast just before the topera, where its wires end, guyed back to the ground */
  const xE=TOPE.v5.x+2,zE=zAt(TRACKS.v5.pts,xE),zEM=zE+2.8;
  mast(xE,zEM,zE,baseAt(xE,zEM));wire.push(xE,YS+0.1,zEM,xE-6,0.05,zEM);
  const segs=[['v1',X0+1,X1-1],['v2',X0+1,X1-1],['v3',-152,152],['v5',xE,60]];
  /* a branch wire starts at its switch on the parent's wire: the parent gets a breakpoint there, so its
     wire passes through that point (v3 over the v1 switches at ±152, v5 over the v3 switch 7 at 60) */
  const JOINS={v2:[-152,152],v3:[60]};
  segs.forEach(sg=>{
    const pts=TRACKS[sg[0]].pts;
    const xs=[sg[1]].concat(XS.concat(JOINS[sg[0]]||[]).filter(x=>x>sg[1]&&x<sg[2]).sort((a,b)=>a-b)).concat([sg[2]]);
    for(let i=1;i<xs.length;i++){const xa=xs[i-1],xb=xs[i];const za=zAt(pts,xa),zb=zAt(pts,xb);if(za===null||zb===null)continue;
      wire.push(xa,6.1,za,xb,6.1,zb, xa,7.35,za,xb,7.35,zb);
      const n=Math.max(1,Math.round((xb-xa)/9));
      for(let k=1;k<n;k++){const t=k/n;const x=lerp(xa,xb,t),z=lerp(za,zb,t);const sag=Math.sin(t*PI)*0.55;wire.push(x,6.1,z,x,7.35-sag,z);}
    }
  });
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(wire,3));
  const l=new THREE.LineSegments(g,WIRE_MAT);scene.add(l);
})();

return{};};

/* ---- andenesPaso · zonas de andén y caminos de los viajeros por la estación ---- */
NIVEL.andenesPaso=function(){
function zoneOf(x,z){
  if(x>=-80.5&&x<=80.5&&z>=-10.8&&z<=-1.6)return'A1';
  if(x>=-80.5&&x<=80.5&&z>=5.9&&z<=12.1)return'ISL';
  if(x>80.5&&x<84&&z>-1.9&&z<6.2)return'X';
  return'OUT';
}
const W_BLD=[{x:-6,z:-23},{x:-6,z:-21},{x:-6,z:-15},{x:-6,z:-9.4}];
const W_TOISL=[{x:70,z:-3.4},{x:78.4,z:-3.4,gate:1},{x:81.5,z:-1.2},{x:81.5,z:5.6},{x:78.4,z:7.4},{x:70,z:8.4}];
const W_TOA1=[{x:78.4,z:7.4,gate:1},{x:81.5,z:5.6},{x:81.5,z:-1.2},{x:78.4,z:-3.4},{x:70,z:-3.6}];
const W_VIN=[{x:-6,z:-62},{x:-4,z:-48},{x:-3,z:-36}];
const W_VOUT=[{x:-3,z:-36},{x:-4,z:-48},{x:-6,z:-62},{x:-6,z:-88}];
function cp(a){return a.map(q=>Object.assign({},q));}
function pathTo(p,tx,tz,leave){
  const zf=zoneOf(p.x,p.z),zt=leave?'OUT':zoneOf(tx,tz);let w=[];
  if(zf==='OUT'){ if(p.z<-40)w=w.concat(cp(W_VIN)); if(zt==='A1')w=w.concat(cp(W_BLD)); else if(zt==='ISL')w=w.concat(cp(W_BLD),cp(W_TOISL)); }
  else if(zf==='A1'){ if(zt==='ISL')w=cp(W_TOISL); else if(zt==='OUT')w=cp(W_BLD).reverse().concat(cp(W_VOUT)); }
  else if(zf==='ISL'){ if(zt==='A1')w=cp(W_TOA1); else if(zt==='OUT')w=cp(W_TOA1).concat(cp(W_BLD).reverse(),cp(W_VOUT)); }
  else if(zf==='X'){ if(zt==='ISL')w=[{x:81.5,z:5.6},{x:78.4,z:7.4},{x:70,z:8.4}]; else if(zt==='A1')w=[{x:81.5,z:-1.2},{x:78.4,z:-3.4},{x:70,z:-3.6}];
    else w=[{x:81.5,z:-1.2},{x:78.4,z:-3.4}].concat(cp(W_BLD).reverse(),cp(W_VOUT)); }
  if(!leave)w.push({x:tx,z:tz});
  if(leave&&p.pid!=null)w=homeward(p,w);
  p.wp=w;p.wi=0;
}
function platZone(tr){if(!tr||!tr.stopTrack)return'A1';return tr.stopTrack==='v1'?'A1':'ISL';}
function spotFor(tr){
  if(!tr||!tr.stopTrack)return{x:rr2(-34,30),z:rr2(-8.6,-5.4)};
  const span=tr.dir>0?[72-tr.len+6,68]:[-68,-72+tr.len-6];const x=rr2(span[0],span[1]);
  if(tr.stopTrack==='v1')return{x:x,z:rr2(-5.2,-3.0)};
  if(tr.stopTrack==='v2')return{x:x,z:rr2(7.0,8.4)};
  return{x:x,z:rr2(9.6,10.9)};
}
return{zoneOf,pathTo,platZone,spotFor};};
/* ---- personal · por dónde va al campo el personal: el agente de circulación sale del gabinete al andén 1 y baja a la
   vía por la rampa del lado Burgos o por la escalerilla del lado Miranda; las brigadas de Mantenimiento dejan la furgoneta
   en el aparcamiento de la estación (y entran por el vestíbulo) o en el arcén junto al paso a nivel. Por la vía andan por
   el paseo de la vía 2, fuera de los postes de la catenaria. ---- */
NIVEL.personal=function(){
const CESS=-4.4;
const GAB={x:-15.6,z:-9.9};                                   // puerta del gabinete al andén 1
const HALL=[{x:-6,z:-24.6},{x:-6,z:-21},{x:-6,z:-15},{x:-6,z:-9.4},{x:-6,z:-6.8}];
const W=[{x:-16.2,z:-6.8},{x:-77.5,z:-6.8},{x:-79.6,z:-9.5},{x:-82.2,z:-9.5},{x:-84.2,z:-7.2},{x:-86,z:CESS}];
const E=[{x:-16.2,z:-6.8},{x:70,z:-6.8},{x:79.6,z:-4.8},{x:85,z:CESS}];
/* the two places to leave a van by the level crossing: on the right-hand verge before it, coming from Quintanavides (A)
   or from Santa María del Invierno (B); in: from the road edge to the verge; out: on along the same road */
const PNV={A:{from:'W',to:'S',stop:z=>z>-24,pull:[{x:-232.2,z:-18.6},{x:-233.6,z:-15.2},{x:-233.6,z:-12.6}],
           merge:z=>z>-10,lead:[{x:-234.6,z:-10.4},{x:-234.6,z:CESS}]},
           B:{from:'S',to:'W',stop:z=>z<29,pull:[{x:-222.4,z:24.6},{x:-221.3,z:21.4},{x:-221.2,z:19.6}],
           merge:z=>z<15,lead:[{x:-220.6,z:15.6},{x:-226,z:9.4},{x:-226,z:CESS}]}};
/* the level crossing: the agent who guards it stands by the north barrier's mechanism; the technicians at the boxes of the
   lights on each side */
const PNS={guarda:{x:-233.3,z:-5.5,hd:Math.atan2(0.7,-0.9),pose:'stand',pn:'N'},
  repN:{x:-234.3,z:-8.5,hd:Math.PI/4,pose:'reach',pn:'N'},repS:{x:-221.7,z:12.6,hd:-3*Math.PI/4,pose:'reach',pn:'S'}};
const cp=a=>a.map(q=>({x:q.x,z:q.z}));
/* from where they start (base: gab, park, pnA, pnB) to the spot T; ap: a clear place beside T to come at it from, for
   what lies level with the platforms (reached round by the Burgos end) */
function crewRoute(base,T,ap){
  if(base==='pnB'&&T.pn==='S')return[{x:T.x,z:T.z}];
  if(base==='pnA'&&T.pn==='N')return T===PNS.guarda?[{x:-234.6,z:-10.4},{x:-234.6,z:-6.6},{x:T.x,z:T.z}]:[{x:T.x,z:T.z}];
  const inSt=Math.abs(T.x)<=80,west=!inSt&&T.x<0;let w=[];
  if(base==='park')w=cp(HALL);
  if(base==='gab'||base==='park')w=w.concat(cp(west?W:E));
  else w=cp(PNV[base==='pnA'?'A':'B'].lead);
  const cx=inSt?85:T.x;
  w.push({x:cx,z:CESS});
  if(inSt&&ap){w.push({x:cx,z:ap.z});w.push({x:ap.x,z:ap.z});}
  w.push({x:T.x,z:T.z});
  return w;}
return{CESS,GAB,PNV,PNS,crewRoute};};
/* ---- esquema · esquema de vías del puesto de mando ---- */
NIVEL.esquema=function(){
const SY={1:56,2:82,3:118,5:146};
function esqPath(id){
  if(id==='v1')return'M'+SX(EX0+2)+' '+SY[1]+'H'+SX(EX1-2);
  if(id==='v2')return'M'+SX(EX0+2)+' '+SY[2]+'H'+SX(EX1-2);
  if(id==='v3')return'M'+SX(-152)+' '+SY[2]+'L'+SX(-122)+' '+SY[3]+'H'+SX(122)+'L'+SX(152)+' '+SY[2];
  if(id==='v5')return'M'+SX(-152)+' '+SY[5]+'H'+SX(36)+'L'+SX(60)+' '+SY[3];
  if(id==='dw')return'M'+SX(-196)+' '+SY[1]+'L'+SX(-170)+' '+SY[2];
  if(id==='de')return'M'+SX(170)+' '+SY[2]+'L'+SX(196)+' '+SY[1];
}
function esqY(t,x){
  const ax=Math.abs(x);
  if(t==='v1')return SY[1];if(t==='v2')return SY[2];
  if(t==='v3')return ax<=122?SY[3]:lerp(SY[3],SY[2],clamp((ax-122)/30,0,1));
  if(t==='v5')return x<=36?SY[5]:lerp(SY[5],SY[3],clamp((x-36)/24,0,1));
  if(t==='dw')return lerp(SY[1],SY[2],clamp((x+196)/26,0,1));
  if(t==='de')return lerp(SY[2],SY[1],clamp((x-170)/26,0,1));
  return SY[1];
}
const ESQ_BR={
  'A24:0':[SX(-170),SY[2]],'A24:1':[SX(-196),SY[1]],'A6:0':[SX(-122),SY[3]],'A7:0':[SX(36),SY[5]],
  'A13:0':[SX(170),SY[2]],'A13:1':[SX(196),SY[1]],'A5:0':[SX(122),SY[3]]
};
return{SY,esqPath,esqY,ESQ_BR};};
/* ---- esqFondo · fondo del esquema del puesto de mando: rótulos, edificio, andenes, vías y sus números ---- */
NIVEL.esqFondo=function(s){
  s.push('<text class="lbl2" x="'+SX(EX0)+'" y="18">Lado '+NIVEL.lado.o+'</text><text class="lbl2" x="'+SX(EX1)+'" y="18" text-anchor="end">Lado '+NIVEL.lado.e+'</text>');
  s.push('<rect class="bld" x="'+SX(-18)+'" y="22" width="'+(SX(15)-SX(-18))+'" height="14" rx="2" data-ent="edificio"/>');
  s.push('<text class="lbl" x="'+((SX(-18)+SX(15))/2)+'" y="32.5" text-anchor="middle" style="font-size:9px">EV</text>');
  s.push('<rect class="plat" x="'+SX(-80)+'" y="40" width="'+(SX(80)-SX(-80))+'" height="9" rx="2"/>');
  s.push('<rect class="plat" x="'+SX(-80)+'" y="91" width="'+(SX(80)-SX(-80))+'" height="18" rx="2"/>');
  s.push('<rect class="plat" x="'+SX(-70)+'" y="153" width="'+(SX(10)-SX(-70))+'" height="8" rx="2"/>');
  s.push('<text class="lbl2" x="'+SX(0)+'" y="47.5" text-anchor="middle" style="font-size:8.5px">Andén 1</text>');
  s.push('<text class="lbl2" x="'+SX(0)+'" y="103" text-anchor="middle" style="font-size:8.5px">Andén 2</text>');
  s.push('<text class="lbl2" x="'+SX(-30)+'" y="170" text-anchor="middle" style="font-size:8.5px">Muelle</text>');
  s.push('<line class="pn" x1="'+SX(PN.x)+'" y1="'+(SY[1]-12)+'" x2="'+SX(PN.x)+'" y2="'+(SY[2]+12)+'"/>');
  s.push('<text class="lbl2" x="'+SX(PN.x)+'" y="'+(SY[2]+24)+'" text-anchor="middle" style="font-size:8.5px">P.N.</text>');
  ['v1','v2','v3','v5','dw','de'].forEach(id=>{const eid=(SWITCHES.find(S=>S.hl===id)||{}).id||id;s.push('<path class="trk" d="'+esqPath(id)+'" data-ent="'+eid+'"/>');});
  s.push('<path class="tope" d="M'+(SX(-152)-1.5)+' '+(SY[5]-6)+'V'+(SY[5]+6)+'"/>');   // topera de la vía 5
  s.push('<g id="esqR"></g><g id="esqT"></g>');
  [1,2,3,5].forEach(t=>s.push('<text class="lbl" x="'+(t<=2?SX(-120):SX(-60))+'" y="'+(SY[t]-6)+'">'+VNUM['v'+t]+'</text>'));
};
