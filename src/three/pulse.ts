import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DoubleSide, Group,
  LinearFilter, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Points, PointsMaterial,
  Scene, ShaderMaterial, SRGBColorSpace, WebGLRenderer,
} from 'three';

/** Mutable, render-loop-read state. Written by listeners, never triggers re-layout. */
const state = { scroll: 0, mx: 0, my: 0, tx: 0, ty: 0, running: true };

const VERT = /* glsl */ `
uniform float uTime; uniform float uAmp; uniform float uPhase; uniform float uSpeed;
varying vec2 vUv; varying float vH;
float g(float x,float c,float w){ float d=(x-c)/w; return exp(-d*d); }
float ecg(float p){
  return 0.10*g(p,0.18,0.035) - 0.12*g(p,0.335,0.012) + 1.0*g(p,0.36,0.013)
       - 0.30*g(p,0.385,0.012) + 0.22*g(p,0.56,0.05);
}
void main(){
  vUv = uv;
  vec3 p = position;
  float ph = fract(uv.x*1.6 - uTime*uSpeed + uPhase);
  float h = ecg(ph);
  float edge = smoothstep(0.0,0.14,uv.x)*smoothstep(1.0,0.86,uv.x);
  p.y += h*uAmp*edge + sin(uv.x*3.2 + uTime*0.35 + uPhase*6.0)*0.14;
  p.z += sin(uv.x*7.5 + uTime*0.55 + uPhase*3.0)*0.45*(uv.y-0.5)*2.0;
  vH = h*edge;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uA; uniform vec3 uB; uniform float uFade; uniform float uCore;
varying vec2 vUv; varying float vH;
void main(){
  float c = 1.0 - abs(vUv.y-0.5)*2.0;
  float core = pow(c, 14.0)*uCore;
  float glow = pow(c, 2.6)*0.28;
  float ends = smoothstep(0.0,0.16,vUv.x)*smoothstep(1.0,0.84,vUv.x);
  vec3 col = mix(uA, uB, vUv.x) + vec3(0.35,0.3,0.1)*vH;
  float a = (core + glow + vH*0.25*c)*ends*uFade;
  gl_FragColor = vec4(col, a);
}`;

type CardData = { time: string; title: string; sub: string; flag?: boolean };
const CARDS: CardData[] = [
  { time: '14.00', title: 'Tansiyon', sub: 'ölçüldü · kayda geçti' },
  { time: '18.00', title: 'Ateş yükseldi', sub: 'hemşireye bildirildi', flag: true },
  { time: '07.00', title: 'Devir raporu', sub: 'yeni refakatçiye hazır' },
];

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cardTexture(d: CardData): CanvasTexture {
  const W = 880, H = 400;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, 24, 20, W - 48, H - 60, 44);
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // accent bar
  roundRect(ctx, 60, 70, 14, H - 160, 7);
  ctx.fillStyle = d.flag ? '#F59E0B' : '#14B8A6';
  ctx.fill();
  ctx.fillStyle = '#0F766E';
  ctx.font = '700 64px "Space Grotesk", system-ui, sans-serif';
  ctx.fillText(d.time, 108, 138);
  ctx.fillStyle = '#0B1F23';
  ctx.font = '600 58px "Inter", system-ui, sans-serif';
  ctx.fillText(d.title, 108, 222);
  ctx.fillStyle = d.flag ? '#B45309' : '#3B5157';
  ctx.font = '400 44px "Inter", system-ui, sans-serif';
  ctx.fillText(d.sub, 108, 288);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

export async function mountPulse(canvas: HTMLCanvasElement, hero: HTMLElement) {
  try {
    await Promise.all([
      document.fonts.load('700 64px "Space Grotesk"'),
      document.fonts.load('600 58px "Inter"'),
    ]);
  } catch { /* system font fallback is fine */ }

  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 60);
  camera.position.set(0, 0, 10);

  const world = new Group();
  scene.add(world);

  // --- pulse ribbons ---
  const ribbonGeo = new PlaneGeometry(18, 0.9, 360, 10);
  const mkRibbon = (amp: number, phase: number, core: number, fade: number, a: string, b: string, speed: number) =>
    new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: AdditiveBlending, side: DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uAmp: { value: amp }, uPhase: { value: phase }, uSpeed: { value: speed },
        uA: { value: new Color(a) }, uB: { value: new Color(b) }, uFade: { value: fade }, uCore: { value: core },
      },
    });
  const mainMat = mkRibbon(1.35, 0.0, 1.0, 1.0, '#5EEAD4', '#99F6E4', 0.16);
  const echoMat = mkRibbon(0.7, 0.37, 0.55, 0.55, '#14B8A6', '#2DD4BF', 0.12);
  const ribbon = new Mesh(ribbonGeo, mainMat);
  const echo = new Mesh(ribbonGeo, echoMat);
  echo.position.set(0, -0.35, -1.6);
  const ribbons = new Group();
  ribbons.add(echo, ribbon);
  world.add(ribbons);

  // --- particles ---
  const N = 240;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 20;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
    pos[i * 3 + 2] = -Math.random() * 6 + 1;
    seed[i] = Math.random() * 10;
  }
  const pGeo = new BufferGeometry();
  pGeo.setAttribute('position', new BufferAttribute(pos, 3));
  const dust = new Points(pGeo, new PointsMaterial({
    color: 0x99f6e4, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending,
  }));
  world.add(dust);

  // --- floating report cards ---
  const cardGeo = new PlaneGeometry(2.2, 1.0);
  const cards = CARDS.map((d, i) => {
    const m = new Mesh(cardGeo, new MeshBasicMaterial({ map: cardTexture(d), transparent: true, depthWrite: false }));
    m.userData = { i, base: { x: 0, y: 0, z: 0 }, scale: 1, visible: true };
    world.add(m);
    return m;
  });

  // --- layout ---
  let W = 1, H = 1;
  function layout() {
    const r = hero.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    H = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
    W = H * camera.aspect;
    const portrait = camera.aspect < 1;
    if (portrait) {
      ribbons.position.set(0, -H * 0.37, 0);
      ribbons.scale.setScalar(0.62);
      const s = Math.min(0.72, (W * 0.46) / 2.2);
      const spots = [
        { x: -W * 0.18, y: -H * 0.29, z: 0.6 },
        { x: W * 0.2, y: -H * 0.43, z: 0.9 },
        { x: 0, y: 0, z: 0 },
      ];
      cards.forEach((c, i) => {
        c.userData.base = spots[i];
        c.userData.scale = s;
        c.userData.visible = i < 2;
      });
    } else {
      ribbons.position.set(0, -H * 0.38, 0);
      ribbons.scale.setScalar(Math.max(0.9, W / 16));
      const spots = [
        { x: W * 0.22, y: H * 0.2, z: 0.4 },
        { x: W * 0.31, y: -H * 0.01, z: 1.0 },
        { x: W * 0.21, y: -H * 0.21, z: 0.7 },
      ];
      cards.forEach((c, i) => {
        c.userData.base = spots[i];
        c.userData.scale = camera.aspect < 1.35 ? 0.8 : 1;
        c.userData.visible = true;
      });
    }
  }
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(hero);

  // --- input ---
  const onScroll = () => {
    state.scroll = Math.min(1, Math.max(0, window.scrollY / Math.max(1, hero.offsetHeight)));
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const fine = window.matchMedia('(pointer: fine)').matches;
  if (fine) {
    window.addEventListener('pointermove', (e) => {
      state.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      state.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });
  }
  const io = new IntersectionObserver(([en]) => { state.running = en.isIntersecting; if (state.running) loop(); });
  io.observe(hero);
  document.addEventListener('visibilitychange', () => { state.running = !document.hidden; if (state.running) loop(); });

  // --- loop ---
  let t = 0, last = performance.now(), raf = 0, first = true;
  const MAX_TILT = (4 * Math.PI) / 180;
  function loop() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }
  function frame(now: number) {
    if (!state.running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const s = state.scroll;
    mainMat.uniforms.uTime.value = t;
    echoMat.uniforms.uTime.value = t;
    mainMat.uniforms.uFade.value = 1 - s * 0.6;

    state.mx += (state.tx - state.mx) * 0.05;
    state.my += (state.ty - state.my) * 0.05;
    world.rotation.y = state.mx * MAX_TILT;
    world.rotation.x = state.my * MAX_TILT * 0.6;

    const arr = pGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < N; i++) {
      arr[i * 3 + 1] += dt * 0.08;
      if (arr[i * 3 + 1] > 4.5) arr[i * 3 + 1] = -4.5;
      arr[i * 3] += Math.sin(t * 0.3 + seed[i]) * dt * 0.02;
    }
    pGeo.attributes.position.needsUpdate = true;

    cards.forEach((c) => {
      const u = c.userData as { i: number; base: { x: number; y: number; z: number }; scale: number; visible: boolean };
      c.visible = u.visible;
      const bob = Math.sin(t * 0.8 + u.i * 1.7) * 0.12;
      c.position.set(u.base.x, u.base.y + bob + s * (1.6 + u.i * 0.6), u.base.z + s * 1.2);
      c.rotation.set(Math.sin(t * 0.5 + u.i) * 0.06, -0.18 + Math.cos(t * 0.4 + u.i) * 0.08, Math.sin(t * 0.6 + u.i * 2) * 0.03);
      c.scale.setScalar(u.scale);
      (c.material as MeshBasicMaterial).opacity = Math.max(0, 1 - s * 1.5);
    });

    renderer.render(scene, camera);
    if (first) { first = false; hero.classList.add('is-3d'); }
    raf = requestAnimationFrame(frame);
  }
  loop();

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    state.running = false;
    hero.classList.remove('is-3d');
  });
}
