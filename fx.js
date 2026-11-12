/* PGH signage — the GPU film pipeline.
   Mood (Paul 2026-11-10): a showreel, "tasteful, elegant and beautiful", in his darker Twin Peaks / David Lynch
   emotional fingerprint. Our own scenes in that spirit: no show names, logos, characters or quotes.

   One WebGL2 canvas under all the slides. Each scene renders scene-linear HDR light (alpha = how much of the
   light source is visible, for light shafts) into a float buffer; scenes cross-dissolve on the GPU; then a post
   chain: light shafts toward the scene's light, bloom with a warm halation fringe, slight lens fringing,
   vignette, signal-dependent grain, AgX tone mapping, a gentle grade, dither.
   Credits: AgX and grain after gokayfem/shader-skills (MIT); halation after cl0nazepamm/powershot-threejs (MIT);
   PCG hash after Jarzynski & Olano (JCGT 2020). Textures: Poly Haven, CC0 (assets/tex/CREDITS.md). */
(function(){
var HEAD = '#version 300 es\nprecision highp float;\n';
var LIB = HEAD + [
'uniform vec2 R; uniform float T; uniform float M; uniform vec3 LC; uniform vec2 LP;',
'uniform sampler2D t0; uniform sampler2D t1;',
'out vec4 o;',
'uint pcg(uint v){uint s=v*747796405u+2891336453u;uint w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}',
'float h11(float p){return float(pcg(uint(int(floor(p)))))*(1./4294967295.);}',
'float h12(vec2 p){ivec2 i=ivec2(floor(p));return float(pcg(uint(i.x)+pcg(uint(i.y)+7u)))*(1./4294967295.);}',
'float n2(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h12(i),h12(i+vec2(1,0)),u.x),mix(h12(i+vec2(0,1)),h12(i+vec2(1,1)),u.x),u.y);}',
'float fbm(vec2 p){float v=0.,a=.5;mat2 r=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){v+=a*n2(p);p=r*p*2.03+vec2(17.1,3.7);a*=.5;}return v;}',
'vec3 lin(vec3 c){return pow(c,vec3(2.2));}',
// A fir in silhouette: coverage (0..1) at local x (screen units from the trunk) and height y.
// Drooping branch tiers, needle fuzz, and a soft edge whose width grows with distance (atmospheric softness).
'float fir(float lx,float y,float top,float base,float w,float soft,float seed){',
'  if(y>top+soft||y<base)return 0.;float d=max(top-y,0.);float H=top-base;',
'  float k=7.+3.*h11(seed);float tier=fract(d/H*k+h11(seed+3.)*.5);',
'  float hw=d*w*(.42+.58*pow(tier,.55))*(1.-.15*d/H);',
'  hw+=(n2(vec2(lx*140.,y*140.)+seed)-.5)*.010*min(d*6.,1.);',
'  hw=max(hw,.0025*smoothstep(0.,.02,d));',
'  return smoothstep(soft,-soft,abs(lx)-hw);}',
// A row of firs: x and y in screen units.
'float firRow(float x,float y,float base,float hgt,float dens,float seed,float sway,float soft){',
'  float cx=x*dens;float c=floor(cx);float r=0.;',
'  for(int k=-1;k<=1;k++){float ci=c+float(k);float rnd=h11(ci*1.37+seed);float j=(h11(ci+seed*3.1)-.5)*.7;',
'    float top=base+hgt*(.5+.5*rnd);float lx=(cx-(ci+.5+j))/dens;lx+=sin(T*.45+ci*1.7)*sway*(top-y);',
'    r=max(r,fir(lx,y,top,base-.3,.30,soft,ci+seed));}return r;}',
].join('\n');

var SCENES = {};

// FOREST — firs in drifting fog under a veiled moon. M=1: no moon; the fog is lit by a signal light (LC at LP).
SCENES.forest = { exposure: 1.15, rays: .5, light:[.73,.74], frag: [
'void main(){vec2 uv=gl_FragCoord.xy/R;float ar=R.x/R.y;vec2 p=vec2(uv.x*ar,uv.y);float px=1./R.y;',
' float cam=T*.006;float moonOn=1.-M;',
' vec2 mp=vec2(ar*.73,.74);vec2 lp=M>.5?vec2(LP.x*ar,LP.y):mp;',
' float md=length(p-lp);',
' vec3 sky=mix(vec3(.010,.022,.020),vec3(.0015,.004,.004),smoothstep(.2,1.,uv.y));',
' vec3 glowC=M>.5?LC*.45:vec3(.75,.85,.78);',
' sky+=glowC*(exp(-md*2.2)*.045+exp(-md*7.)*.10);',
' vec2 sg=floor(p*85.);float sr=h12(sg+3.);float st=step(.986,sr)*smoothstep(.13,.0,length(fract(p*85.)-.5))*(.5+.5*sin(T*1.1+sr*50.));',
' sky+=vec3(.5,.55,.5)*st*smoothstep(.5,.9,uv.y)*(1.-smoothstep(.0,.6,exp(-md*3.)));',
' float disc=smoothstep(.052+px,.052-px,length(p-mp))*moonOn;float mt=.75+.25*fbm((p-mp)*30.);',
' vec3 col=sky+vec3(1.,.96,.86)*disc*mt*9.;',
' float cl=fbm(vec2(p.x*1.2-T*.012,p.y*4.5));float veil=smoothstep(.5,.85,cl)*smoothstep(.5,.85,uv.y);',
' col=mix(col,glowC*(.012+exp(-md*4.)*.6),veil*.75);',
' float mask=(disc*(1.-veil*.8)+exp(-md*9.)*.6)*(1.-veil*.5);',
' if(M>.5){mask=exp(-md*14.)*1.5;}',
' vec3 fogC=vec3(.020,.034,.031)+glowC*.05;',
' for(int i=0;i<8;i++){float fi=float(i);float t=fi/7.;',
'   float base=mix(.40,-.12,pow(t,.8));float hgt=mix(.10,1.15,pow(t,1.3));float dens=mix(14.,1.25,pow(t,.7));',
'   float soft=mix(.004,.0015,t)+px;',
'   float x=p.x+cam*(.4+fi*1.2)+fi*5.3;',
'   float tr=firRow(x,uv.y,base,hgt,dens,fi*13.,.003*(1.+fi),soft);',
'   float haze=mix(.88,.04,pow(t,.6));',
'   vec3 near=vec3(.0012,.0028,.0022);',
'   vec3 fc=fogC*(1.+exp(-length(vec2(p.x-lp.x,(base+hgt*.4)-lp.y))*2.5)*2.);',
'   col=mix(col,mix(near,fc,haze),tr);mask*=1.-tr*(1.-haze*.6);',
'   float fy=base+hgt*.15;float band=smoothstep(.22,0.,abs(uv.y-fy));',
'   float fog=fbm(vec2(p.x*1.1-T*.02*(1.+fi*.4),uv.y*4.+fi*7.))*band*(1.-t*.5);',
'   col+=fc*fog*.55;}',
' float gf=fbm(vec2(p.x*.8-T*.03,uv.y*6.))*smoothstep(.28,.0,uv.y);col+=fogC*gf*1.3;',
' o=vec4(col,clamp(mask,0.,1.));}'].join('\n') };

// ROAD — a night highway through firs: wet asphalt, the center dashes coming out of the dark, headlight scatter in fog.
SCENES.road = { exposure: 1.35, rays: .2, light:[.5,.48], tex:['assets/tex/asphalt_02_diff.jpg','assets/tex/asphalt_02_nor_gl.jpg'], frag: [
'void main(){vec2 uv=gl_FragCoord.xy/R;float ar=R.x/R.y;vec2 p=vec2(uv.x*ar,uv.y);float px=1./R.y;',
' float hz=.48+sin(T*.7)*.0015;float spd=11.;float cx=ar*.5;',
' vec3 fogC=vec3(.010,.016,.015);',
' vec3 col=mix(fogC*1.6,vec3(.001,.0025,.0022),smoothstep(hz,1.,uv.y));',
' float vp=length(vec2((p.x-cx)*.6,(p.y-hz)*2.2));col+=vec3(.55,.6,.5)*exp(-vp*4.)*.035;',
' float mask=exp(-vp*9.)*.5;',
' col=mix(col,vec3(.0015,.003,.0025),firRow(p.x+T*.0015,uv.y,hz-.005,.07,22.,5.,.0,.0012+px));',
' if(uv.y<hz){float z=1.25/(hz-uv.y);float curve=.0007*z*z*sin(T*.05);',
'   float wx=(uv.x-.5)*ar*z-curve;float zz=z+T*spd;',
'   vec2 tuv=vec2(wx,zz)*.28;',
'   vec3 alb=lin(texture(t0,tuv).rgb)*.55;vec3 nt=texture(t1,tuv).xyz*2.-1.;',
'   float road=1.-smoothstep(3.7,3.9,abs(wx));',
'   vec3 grass=vec3(.004,.007,.005)*(.6+.8*n2(vec2(wx,zz)*3.));alb=mix(grass,alb,road);',
'   float dash=smoothstep(.075,.06,abs(wx))*step(fract(zz/7.),.42);',
'   float edge=smoothstep(.07,.05,abs(abs(wx)-3.4));',
'   alb=mix(alb,vec3(.75,.45,.04),dash*.95);alb=mix(alb,vec3(.6,.6,.55),edge*.8);',
'   float beam=exp(-pow(wx/(1.4+z*.09),2.));float I=26./(z*z+2.)*beam+.0015;',
'   vec3 c=alb*I*(.75+.25*nt.z);',
'   float glint=pow(max(0.,nt.y*.7+nt.z*.7),60.)*road*I*.6;c+=vec3(1.,.95,.85)*glint;',
'   c+=(dash*vec3(1.,.65,.1)+edge*vec3(.8))*I*.8;',
'   c=mix(c,fogC*(1.+beam*2.),1.-exp(-z*.028));col=c;}',
' for(int sd=0;sd<2;sd++){float sgn=sd==0?-1.:1.;',
'   for(int k=0;k<22;k++){float fk=float(k);float zt=mod(fk*5.5-T*spd+h11(fk*3.+float(sd)*40.)*4.,121.)+3.;',
'     float lat=sgn*(6.+h11(fk*7.+float(sd)*11.)*9.);',
'     float sx=cx+lat/zt;float sy=hz-1.25/zt;float th=(7.+h11(fk*5.+float(sd))*7.)/zt;',
'     if(abs(p.x-sx)>th*.5||p.y<sy-.01||p.y>sy+th+.01)continue;',
'     float cov=fir(p.x-sx,p.y,sy+th,sy-.002,.26,.0015+th*.004,fk+float(sd)*50.);',
'     float lit=26./(zt*zt+2.)*exp(-pow(lat/(1.4+zt*.09),2.))*.02;',
'     vec3 tc=mix(vec3(.0012,.0022,.0018)+vec3(.02,.025,.015)*lit,fogC*1.2,1.-exp(-zt*.028));',
'     col=mix(col,tc,cov);mask*=1.-cov;}}',
' float ins=.035*exp(-pow((uv.x-.5)*ar/(.12+max(hz-uv.y,0.)*1.6),2.))*smoothstep(hz+.06,hz-.5,uv.y);',
' col+=vec3(.9,.85,.7)*ins*(.7+.3*fbm(vec2(uv.x*6.,uv.y*3.-T*.6)));',
' o=vec4(col,clamp(mask,0.,1.));}'].join('\n') };

// CURTAIN — velvet folds in a slow draft, a lacquered zigzag floor that mirrors them, a spotlight through haze.
SCENES.curtain = { exposure: .85, rays: .3, light:[.333,1.02], tex:['assets/tex/velvet_nor_gl.jpg'], frag: [
'float H(float x,float y){return .55*sin(x*24.+sin(y*2.4+T*.33)*.7+sin(x*1.3-T*.2)*.6)+.25*sin(x*51.+y*1.3+T*.25)+.12*sin(x*97.-T*.4);}',
'vec3 velvet(vec2 p,float y,vec2 spot){float e=.0015;float h=H(p.x,y);float dh=(H(p.x+e,y)-H(p.x-e,y))/(2.*e);',
'  vec3 n=normalize(vec3(-dh*.045,0.,1.));vec3 nt=texture(t0,p*vec2(3.,3.)).xyz*2.-1.;n=normalize(n+nt*.18);',
'  vec3 L=normalize(vec3(spot.x-p.x,spot.y-p.y,.9));float diff=max(dot(n,L),0.);',
'  float sheen=pow(1.-max(n.z,0.),1.6);float fold=.55+.45*(h*.5+.5);',
'  float s=exp(-pow((p.x-spot.x)*1.25,2.)-pow((y-.62)*1.05,2.));',
'  vec3 base=vec3(.30,.010,.016);',
'  return base*(diff*.6+.15)*fold*(.03+s*3.2)+vec3(.95,.25,.22)*sheen*(.02+s*1.1)*fold;}',
'void main(){vec2 uv=gl_FragCoord.xy/R;float ar=R.x/R.y;float pan=-.04+.08*smoothstep(0.,18.,T);vec2 p=vec2(uv.x*ar+pan,uv.y);float fl=.30;',
' vec2 spot=vec2(ar*.333,1.02);vec3 col;',
' if(uv.y>=fl){col=velvet(p,uv.y,spot);col*=smoothstep(fl,fl+.06,uv.y)*.6+.4;}',
' else{float z=.30/(fl+.008-uv.y);float wx=((uv.x-.333)*ar+pan)*z;',
'   float v=fract(z*2.6+abs(fract(wx*2.2)-.5)*1.6);float aa=min(fwidth(v),.25);',
'   float zig=smoothstep(.5-aa,.5+aa,v)*(1.-smoothstep(1.-aa*2.,1.,v));vec3 alb=mix(vec3(.010,.009,.008),vec3(.62,.56,.44),zig);',
'   float s=exp(-wx*wx*.6-pow(z-1.3,2.)*.25);vec3 c=alb*(.006+s*.7);',
'   float ry=fl+(fl-uv.y)*.9;vec3 refl=velvet(vec2(p.x,ry),ry,spot);',
'   float fres=.06+.5*pow(1.-clamp((fl-uv.y)*3.,0.,1.),5.);',
'   c+=refl*fres*mix(1.,.5,zig)*.9;c=mix(c,vec3(.0015,0.,0.),1.-exp(-z*.08));col=c;}',
' float cone=exp(-pow((p.x-spot.x)/(.10+(spot.y-uv.y)*.42),2.))*smoothstep(fl-.05,1.,uv.y);',
' float haze=.6+.4*fbm(vec2(p.x*3.,uv.y*2.-T*.05));col+=vec3(1.,.82,.68)*cone*haze*.045;',
' float mask=exp(-length(vec2(p.x-spot.x,(uv.y-spot.y)*1.6))*6.)*1.4;',
' o=vec4(col,clamp(mask,0.,1.));}'].join('\n') };

// BENCH — six strings in lamplight over dark wood, out-of-focus highlights behind, a slow strum every few seconds.
SCENES.bench = { exposure: 1.1, rays: .25, light:[.80,.98], tex:['assets/tex/dark_wood_diff.jpg'], frag: [
'void main(){vec2 uv=gl_FragCoord.xy/R;float ar=R.x/R.y;vec2 p=vec2(uv.x*ar,uv.y);float px=1./R.y;',
' vec2 lamp=vec2(ar*.80,.98);float ld=length((p-lamp)*vec2(.8,1.));',
' vec3 wood=lin(texture(t0,vec2(p.x*.35+.1,p.y*.32),5.).rgb);',
' vec3 col=wood*(.02+exp(-ld*1.7)*.9)*vec3(1.,.8,.6);',
' for(int i=0;i<16;i++){float fi=float(i);vec2 c=vec2(h11(fi*3.1+1.)*ar,.35+h11(fi*7.7+2.)*.62);c.x+=sin(T*.07+fi)*.04;',
'   float r=.018+h11(fi*5.3+3.)*.035;float d=length(p-c);float disc=smoothstep(r+px*2.,r-px*2.,d);',
'   float ring=smoothstep(r*.75,r,d)*disc;vec3 bc=mix(vec3(1.,.62,.3),vec3(.95,.8,.6),h11(fi*2.+4.));',
'   col+=bc*(disc*.22+ring*.3)*(.1+.9*h11(fi*9.+5.))*(.6+.4*sin(T*.35+fi))*exp(-length(c-lamp)*1.2)*.45;}',
' float cyc=mod(T+2.,7.);',
' float mask=exp(-ld*7.)*1.4;',
' for(int i=0;i<6;i++){float fi=float(i);float y0=.10+fi*.058+(uv.x-.5)*.055;',
'   float tt=cyc-fi*.085;float a=tt>0.?.013*exp(-tt*.85)*(1.-fi*.07):0.;',
'   float env=a*abs(sin(3.14159*clamp(uv.x,0.,1.)))*(.55+.45*abs(sin(T*61.+fi*1.7)));',
'   float w=.0018+fi*.0007;float d=uv.y-y0;float spread=w+env;',
'   float cov=smoothstep(spread+px,spread-px,abs(d))*(w/spread);',
'   float s=clamp(d/spread,-1.,1.);vec3 n=normalize(vec3(0.,s,sqrt(max(1.-s*s,0.))));',
'   vec3 L=normalize(vec3(lamp-p,.6));float spec=pow(max(dot(reflect(-L,n),vec3(0,0,1)),0.),24.);',
'   float wound=fi>2.5?(.75+.25*sin(uv.x*R.x*.9)):1.;',
'   float along=exp(-pow((uv.x-.62-.08*sin(T*.15+fi))*3.2,2.));',
'   vec3 metal=fi>2.5?vec3(.95,.78,.55):vec3(.92,.92,.95);',
'   vec3 sc=metal*(.03+max(dot(n,L),0.)*.12+spec*(.4+7.*along))*wound;',
'   col=mix(col,sc,cov);col+=metal*exp(-abs(d)/(w*6.))*along*.04;}',
' o=vec4(col,clamp(mask,0.,1.));}'].join('\n') };

// VINYL — a record turning on dark wood; the anisotropic sheen stays with the lamp while the grooves turn.
SCENES.vinyl = { exposure: 1.25, rays: .2, light:[.62,1.0], tex:['assets/tex/dark_wood_diff.jpg','assets/tex/dark_wood_nor_gl.jpg'], frag: [
'void main(){vec2 uv=gl_FragCoord.xy/R;float ar=R.x/R.y;vec2 p=vec2(uv.x*ar,uv.y);float px=1./R.y;',
' vec2 lamp=vec2(ar*.62,1.05);',
' vec2 wuv=vec2(p.x*.5,p.y*.5);vec3 wood=lin(texture(t0,wuv).rgb);vec3 wn=texture(t1,wuv).xyz*2.-1.;',
' float ld=length(p-lamp);vec3 col=wood*(.015+exp(-ld*1.6)*.55)*(.8+.2*wn.z);',
' vec2 c=vec2(ar*.75,.48);vec2 d=p-c;float r=length(d);float R0=.43;',
' col*=1.-.75*smoothstep(R0+.06,R0-.01,length(d+vec2(-.015,.02)));',
' float on=smoothstep(R0+px,R0-px,r);',
' vec2 tng=vec2(-d.y,d.x)/max(r,1e-4);vec2 Lp=normalize(lamp-c);',
' float ta=dot(tng,Lp);float aniso=pow(sqrt(max(1.-ta*ta,0.)),90.);float aniso2=pow(sqrt(max(1.-ta*ta,0.)),10.);',
' float gaps=1.-.6*(smoothstep(.004,.0,abs(r-.21))+smoothstep(.004,.0,abs(r-.27))+smoothstep(.004,.0,abs(r-.33))+smoothstep(.004,.0,abs(r-.39)));',
' float ang=atan(d.y,d.x)+T*3.49;float micro=.85+.15*n2(vec2(ang*40.,r*300.));',
' vec3 rec=vec3(.006)+vec3(.9,.85,.75)*(aniso*.9+aniso2*.04)*gaps*micro*smoothstep(.15,.17,r)*(.25+exp(-ld*1.2)*1.2);',
' float speck=step(.9985,h12(floor(vec2(cos(ang),sin(ang))*r*700.)));rec+=speck*.4*smoothstep(.16,.2,r);',
' col=mix(col,rec,on);',
' vec3 label=vec3(.42,.12,.05)*(.05+exp(-ld*1.4)*.7)*(.9+.1*n2(p*300.));col=mix(col,label,smoothstep(.135+px,.135-px,r));',
' col=mix(col,vec3(.5,.5,.48)*(.05+exp(-ld*1.4)),smoothstep(.009,.007,r));',
' float mask=exp(-length((p-lamp)*vec2(1.,1.6))*6.)*1.2;',
' o=vec4(col,clamp(mask,0.,1.));}'].join('\n') };

var POST = {
mix: HEAD+'uniform sampler2D A;uniform sampler2D B;uniform float k;uniform vec2 R;out vec4 o;void main(){vec2 uv=gl_FragCoord.xy/R;o=mix(texture(A,uv),texture(B,uv),k);}',
bright: HEAD+'uniform sampler2D S;uniform vec2 R;uniform vec2 SR;out vec4 o;void main(){vec2 uv=gl_FragCoord.xy/R;vec2 e=1./SR;vec3 c=vec3(0.);for(int i=0;i<4;i++){vec2 off=vec2(float(i%2)-.5,float(i/2)-.5)*2.*e;vec3 s=texture(S,uv+off).rgb;c+=max(s-vec3(.09),0.);}o=vec4(c*.25,1.);}',
blur: HEAD+'uniform sampler2D S;uniform vec2 R;uniform vec2 D;out vec4 o;void main(){vec2 uv=gl_FragCoord.xy/R;vec3 c=texture(S,uv).rgb*.227;float w[4]=float[4](.194,.121,.054,.016);for(int i=1;i<5;i++){vec2 off=D*float(i)*1.5/R;c+=w[i-1]*(texture(S,uv+off).rgb+texture(S,uv-off).rgb);}o=vec4(c,1.);}',
comp: HEAD+[
'uniform sampler2D S;uniform sampler2D Bl;uniform vec2 R;uniform vec2 LP;uniform float rays;uniform float ex;uniform float T;uniform vec3 RC;out vec4 o;',
'uint pcg(uint v){uint s=v*747796405u+2891336453u;uint w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}',
'float hh(vec2 p,float f){ivec2 i=ivec2(p);return float(pcg(uint(i.x)+pcg(uint(i.y)+pcg(uint(int(f))))))*(1./4294967295.);}',
'vec3 agx(vec3 c){const mat3 a=mat3(.842479062253094,.0423282422610123,.0423756549057051,.0784335999999992,.878468636469772,.0784336,.0792237451477643,.0791661274605434,.879142973793104);',
' const mat3 b=mat3(1.19687900512017,-.0528968517574562,-.0529716355144438,-.0980208811401368,1.15190312990417,-.0980434501171241,-.0990297440797205,-.0989611768448433,1.15107367264116);',
' c=a*max(c,0.);c=clamp((log2(max(c,1e-10))+12.47393)/16.5,0.,1.);vec3 x2=c*c,x4=x2*x2;',
' c=15.5*x4*x2-40.14*x4*c+31.96*x4-6.868*x2*c+.4298*x2+.1191*c-.00232;c=b*c;return pow(max(c,0.),vec3(2.2));}',
'void main(){vec2 uv=gl_FragCoord.xy/R;vec2 cc=uv-.5;',
' float ca=.0018*dot(cc,cc)*4.;',
' vec3 c=vec3(texture(S,uv-cc*ca).r,texture(S,uv).g,texture(S,uv+cc*ca).b);',
' vec2 dir=(LP-uv)/48.;vec2 q=uv;float acc=0.,dec=1.;for(int i=0;i<48;i++){q+=dir;acc+=texture(S,q).a*dec;dec*=.965;}',
' c+=RC*acc/48.*rays*.9;',
' vec3 b=texture(Bl,uv).rgb;c+=b*.32+b*vec3(1.,.3,.1)*.22;',
' c*=ex;float v=1./(1.+dot(cc,cc)*2.6);c*=v*v;',
' float n=hh(gl_FragCoord.xy,floor(T*24.))*2.-1.;c+=.06*sqrt(max(c,0.))*n;',
' c=agx(c);',
' float l=dot(c,vec3(.2126,.7152,.0722));c=mix(c,c*vec3(.92,1.04,1.0),smoothstep(.25,.0,l));c=mix(c,c*vec3(1.05,1.,.92),smoothstep(.35,.9,l));',
' c=pow(c,vec3(1./2.2));c+=(hh(gl_FragCoord.xy+17.,floor(T*24.)+3.)-.5)/255.;',
' o=vec4(c,1.);}'].join('\n')
};

function Engine(canvas){
  var gl=canvas.getContext('webgl2',{antialias:false,alpha:false,preserveDrawingBuffer:true});
  if(!gl) return null;
  if(!gl.getExtension('EXT_color_buffer_float')) gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');
  var W=canvas.width,Hh=canvas.height,qW=Math.max(1,W>>2),qH=Math.max(1,Hh>>2);
  function sh(t,src,name){var s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){console.error('shader '+name+': '+gl.getShaderInfoLog(s));return null;}return s;}
  var VS='#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  function prog(fs,name){var v=sh(gl.VERTEX_SHADER,VS,name),f=sh(gl.FRAGMENT_SHADER,fs,name);if(!v||!f)return null;var p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.bindAttribLocation(p,0,'a');gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)){console.error('link '+name+': '+gl.getProgramInfoLog(p));return null;} p.u={};return p;}
  function U(p,n){if(!(n in p.u))p.u[n]=gl.getUniformLocation(p,n);return p.u[n];}
  var buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  function target(w,h){var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    var f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
    return {t:t,f:f,w:w,h:h};}
  var A=target(W,Hh),B=target(W,Hh),Mx=target(W,Hh),Q1=target(qW,qH),Q2=target(qW,qH);
  var P={mix:prog(POST.mix,'mix'),bright:prog(POST.bright,'bright'),blur:prog(POST.blur,'blur'),comp:prog(POST.comp,'comp')};
  var progs={},texCache={};
  function tex(url){ if(texCache[url]) return texCache[url];
    var t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([20,20,20,255]));
    var img=new Image();img.onload=function(){gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
      var an=gl.getExtension('EXT_texture_filter_anisotropic');if(an)gl.texParameterf(gl.TEXTURE_2D,an.TEXTURE_MAX_ANISOTROPY_EXT,8);t.ready=true;};
    img.src=url; texCache[url]=t; return t; }
  function sceneProg(name){ if(!(name in progs)) progs[name]=prog(LIB+'\n'+SCENES[name].frag,name); return progs[name]; }
  function draw(p,tg){gl.bindFramebuffer(gl.FRAMEBUFFER,tg?tg.f:null);gl.viewport(0,0,tg?tg.w:W,tg?tg.h:Hh);gl.useProgram(p);gl.drawArrays(gl.TRIANGLES,0,3);}
  function bindT(p,name,unit,t){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.uniform1i(U(p,name),unit);}
  function renderScene(s,tg){ var d=SCENES[s.name], p=sceneProg(s.name); if(!p) return;
    gl.useProgram(p); gl.uniform2f(U(p,'R'),W,Hh); gl.uniform1f(U(p,'T'),s.t); gl.uniform1f(U(p,'M'),s.m||0);
    var lc=s.lc||[1,1,1]; gl.uniform3f(U(p,'LC'),lc[0],lc[1],lc[2]); var lp=s.lp||d.light; gl.uniform2f(U(p,'LP'),lp[0],lp[1]);
    (d.tex||[]).forEach(function(u,i){ bindT(p,'t'+i,i,tex(u)); });
    draw(p,tg); }
  return {
    preload:function(names){ names.forEach(function(n){ sceneProg(n); (SCENES[n].tex||[]).forEach(tex); }); },
    ready:function(names){ return names.every(function(n){ return (SCENES[n].tex||[]).every(function(u){ return tex(u).ready; }); }); },
    frame:function(cur,prev,k,T){
      renderScene(cur,A); var src=A;
      if(prev&&k<1){ renderScene(prev,B); var p=P.mix; gl.useProgram(p); bindT(p,'A',0,B.t); bindT(p,'B',1,A.t); gl.uniform1f(U(p,'k'),k); gl.uniform2f(U(p,'R'),W,Hh); draw(p,Mx); src=Mx; }
      var b=P.bright; gl.useProgram(b); bindT(b,'S',0,src.t); gl.uniform2f(U(b,'R'),qW,qH); gl.uniform2f(U(b,'SR'),W,Hh); draw(b,Q1);
      var bl=P.blur; for(var i=0;i<2;i++){ gl.useProgram(bl); bindT(bl,'S',0,Q1.t); gl.uniform2f(U(bl,'R'),qW,qH); gl.uniform2f(U(bl,'D'),1,0); draw(bl,Q2);
        gl.useProgram(bl); bindT(bl,'S',0,Q2.t); gl.uniform2f(U(bl,'R'),qW,qH); gl.uniform2f(U(bl,'D'),0,1); draw(bl,Q1); }
      var dc=SCENES[cur.name], dp=prev?SCENES[prev.name]:dc, kk=prev?k:1;
      function lerp(a,b){return a+(b-a)*kk;}
      var lpC=cur.lp||dc.light, lpP=prev?(prev.lp||dp.light):lpC;
      var rc=cur.m&&cur.lc?cur.lc:[.85,.92,.85];
      var c=P.comp; gl.useProgram(c); bindT(c,'S',0,src.t); bindT(c,'Bl',1,Q1.t); gl.uniform2f(U(c,'R'),W,Hh);
      var lp=kk>.5?lpC:lpP; gl.uniform2f(U(c,'LP'),lp[0],lp[1]); gl.uniform1f(U(c,'rays'),lerp(dp.rays,dc.rays)); gl.uniform1f(U(c,'ex'),lerp(dp.exposure,dc.exposure));
      gl.uniform1f(U(c,'T'),T); gl.uniform3f(U(c,'RC'),rc[0],rc[1],rc[2]); draw(c,null);
    }
  };
}

// The signal light on the hours scene: same 15 s cycle as the CSS lamps (red 0-44%, green 48-82%, amber 86-98%).
function mixc(a,b,k){ return [a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k]; }
function signal(t){ var ph=(t%15)/15, r=[1,.16,.1], g=[.2,1,.6], a=[1,.62,.2], z=[0,0,0];
  if(ph<.44) return r; if(ph<.46) return mixc(r,z,(ph-.44)/.02); if(ph<.48) return mixc(z,g,(ph-.46)/.02);
  if(ph<.82) return g; if(ph<.84) return mixc(g,z,(ph-.82)/.02); if(ph<.86) return mixc(z,a,(ph-.84)/.02);
  if(ph<.98) return a; return mixc(a,r,(ph-.98)/.02); }
function swayDeg(t){ return -3*Math.cos((t/7)*Math.PI*2); }   // matches the CSS sway (-3deg..3deg, 7 s, ease-in-out)

// Slow dust motes drifting in light (2D canvas, additive). Time-based, so captures are frame-exact.
function motes(canvas, n, warm){
  var c=canvas.getContext('2d'),W=canvas.width,H=canvas.height,P=[];
  for(var i=0;i<n;i++)P.push({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*8,vy:-3-Math.random()*12,r:.6+Math.random()*2.2,ph:Math.random()*6.3});
  return function(t){c.clearRect(0,0,W,H);c.globalCompositeOperation='lighter';
    for(var i=0;i<P.length;i++){var p=P[i];var x=((p.x+p.vx*t+Math.sin(t*.4+p.ph)*9)%W+W)%W, y=((p.y+p.vy*t)%(H+20)+H+20)%(H+20)-10;
      var a=(.22+.22*Math.sin(t*.9+p.ph));c.fillStyle=warm?'rgba(247,200,140,'+a+')':'rgba(220,230,215,'+a*.7+')';c.beginPath();c.arc(x,y,p.r,0,6.283);c.fill();}};
}

var eng=null, cur=null, prev=null, switchAt=0, raf=null, DISSOLVE=2.6;
function step(now){
  var k=Math.min(1,(now-switchAt)/DISSOLVE); k=k*k*(3-2*k);
  cur.t=now-cur.t0;
  if(cur.m){ cur.lc=signal(cur.t); var a=swayDeg(cur.t)*Math.PI/180; cur.lp=[(1505-Math.sin(a)*330)/1920, 1-(84+Math.cos(a)*330)/1080]; }
  if(prev){ prev.t=now-prev.t0; if(k>=1) prev=null; }
  if(eng) eng.frame(cur,prev,k,now);
  if(cur.slide&&cur.slide._motes) cur.slide._motes(cur.t);
  if(prev&&prev.slide&&prev.slide._motes) prev.slide._motes(prev.t);
}
function tick(){ raf=null; if(!cur) return; step(performance.now()/1000); if(!FX.manual) raf=requestAnimationFrame(tick); }
window.FX={
  manual:false,
  init:function(canvas,names){ if(!eng||eng.canvas!==canvas){ eng=Engine(canvas); if(eng) eng.canvas=canvas; } if(eng) eng.preload(names); return !!eng; },
  ready:function(names){ return !eng || eng.ready(names); },
  attachMotes:function(slide){ var mc=slide.querySelector('canvas.motes'); if(mc) slide._motes=motes(mc,+(mc.getAttribute('data-n')||60),mc.hasAttribute('data-warm')); },
  // Switch scenes; the previous one keeps moving under the GPU dissolve.
  go:function(name,m,slide){ var now=performance.now()/1000; prev=cur; cur={name:name,m:m||0,t0:now,slide:slide}; switchAt=now;
    if(!FX.manual&&!raf) raf=requestAnimationFrame(tick); },
  // Frame-exact capture: pose the current scene at scene time t (no dissolve).
  renderAt:function(t){ if(!cur) return; cur.t0=0; prev=null; switchAt=-1e9; step(t); }
};
})();
