// 3D-Ansicht der Fahrt. Die Landschaft wird aus den Modellen und Bildern unter
// public/assets aufgebaut; welche wo stehen, legt worlds.ts fest.
// Die Straße folgt dem echten Höhenprofil der Strecke; ihr Verlauf in der
// Ebene ist erfunden (sanfte Kurven), die echte Lage zeigt die Streckenkarte.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getState } from '../core/app';
import { positionAt } from '../core/gpx';
import { zoneOf } from '../core/stats';
import type { Route } from '../core/types';
import { loadModel, loadTexture, type Model } from './assets';
import { loadRiderParts, makeAssetRider, type RiderParts } from './riderModel';
import { makeRider, toon } from './riderSimple';
import { worldByKey, type PropDef, type WorldDef } from './worlds';

const STEP = 5; // m zwischen Wegpunkten
const CHUNK = 100; // m, Bewuchs wird in Abschnitten verwaltet
const LEAD = 400; // m Straße vor dem Start
const SUN_ELEVATION = 40; // Grad über dem Horizont
const SUN_AZIMUTH = -48; // Grad, bezogen auf die Hauptfahrtrichtung

const fract = (v: number) => v - Math.floor(v);
const hash = (x: number, z: number) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function noise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
}
const fbm = (x: number, z: number) => noise(x, z) * 0.55 + noise(x * 2.1 + 5, z * 2.1) * 0.3 + noise(x * 4.3, z * 4.3 + 9) * 0.15;

/** Straßenverlauf: Distanz → Position. Wächst bei Bedarf. */
class Path {
  private xs: number[] = [0];
  private zs: number[] = [0];
  private hs: number[] = [0];
  private phase: number;
  private base: number;

  constructor(private route?: Route) {
    let seed = 0;
    for (const ch of route?.id ?? 'frei') seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
    this.phase = seed / 1000;
    this.base = route ? route.points[0].ele : 0;
  }

  private heading(d: number) {
    // Krümmung bleibt klein (Radius > 300 m), damit sich das Gelände nie überlappt
    return 0.5 * Math.sin(d / 260 + this.phase) + 0.18 * Math.sin(d / 140 + this.phase * 2.3);
  }

  private ensure(index: number) {
    while (this.xs.length <= index + 1) {
      const i = this.xs.length;
      const h = this.heading((i - 1) * STEP - LEAD);
      this.xs.push(this.xs[i - 1] + Math.sin(h) * STEP);
      this.zs.push(this.zs[i - 1] + Math.cos(h) * STEP);
      this.hs.push(h);
    }
  }

  /** Echte Höhe über dem Meer (für die Baumgrenze). */
  altitude(d: number) {
    return this.route ? positionAt(this.route, d).ele : 500;
  }

  at(d: number) {
    const f = Math.max(0, (d + LEAD) / STEP);
    const i = Math.floor(f);
    this.ensure(i + 1);
    const t = f - i;
    const pos = this.route ? positionAt(this.route, d) : null;
    return {
      x: lerp(this.xs[i], this.xs[i + 1], t),
      z: lerp(this.zs[i], this.zs[i + 1], t),
      y: pos ? pos.ele - this.base : 0,
      heading: lerp(this.hs[i], this.hs[i + 1], t),
      grade: pos ? pos.grade : 0,
    };
  }
}

const HALF = [3.6, 4.6, 6.5, 9, 13, 18, 25, 34, 46, 62, 82, 108, 140, 180, 230, 290];
const OFFSETS = [...HALF.map((v) => -v).reverse(), ...HALF];
const ROAD_HALF = 3.6;

function terrainHeight(x: number, z: number, roadY: number, off: number, hillScale: number) {
  const a = Math.abs(off);
  const hills = (fbm(x / 240, z / 240) - 0.42) * 120 + (noise(x / 26, z / 26) - 0.5) * 3;
  const peaks = smooth(110, 290, a) * (0.25 + fbm(x / 380 + 7, z / 380)) * 230;
  return roadY + (smooth(7, 95, a) * hills + peaks) * hillScale - smooth(ROAD_HALF, 6.5, a) * 0.4;
}

interface WorldAssets {
  def: WorldDef;
  trees: { model: Model; weight: number; scale: [number, number] }[];
  bush: Model | null;
  rocks: Model[];
  flowers: Model | null;
  fence: Model | null;
  props: { def: PropDef; model: Model }[];
  arch: Model | null;
  guardrail: Model | null;
  spectators: Model[];
  grass: THREE.Texture | null;
  rock: THREE.Texture | null;
  asphalt: THREE.Texture | null;
  backdrop: THREE.Texture | null;
  clouds: THREE.Texture[];
  rider: RiderParts | null;
}

async function loadWorld(def: WorldDef): Promise<WorldAssets> {
  const k = def.key;
  const some = <T,>(xs: (T | null)[]) => xs.filter((x): x is T => x !== null);
  const [trees, bush, rocks, flowers, fence, props, arch, guardrail, spectators, grass, rock, asphalt, backdrop, clouds, rider] = await Promise.all([
    Promise.all(def.trees.map(async (t) => ({ model: await loadModel(`${k}/${t.file}`), weight: t.weight, scale: t.scale ?? ([0.9, 1.4] as [number, number]) }))),
    loadModel(`${k}/${def.bush}`),
    Promise.all(def.rocks.map((r) => loadModel(`${k}/${r}`))),
    loadModel(`${k}/${def.flowers}`),
    loadModel(`${k}/${def.fence}`),
    Promise.all(def.props.map(async (p) => ({ def: p, model: await loadModel(`${k}/${p.file}`) }))),
    loadModel('common/arch'),
    loadModel('common/guardrail'),
    Promise.all([loadModel('common/spectator_1'), loadModel('common/spectator_2')]),
    loadTexture(`${k}/grass.png`, true),
    loadTexture(`${k}/rock.png`, true),
    loadTexture('common/asphalt.png', true),
    loadTexture(`${k}/backdrop.png`, true),
    Promise.all([1, 2, 3, 4].map((i) => loadTexture(`common/cloud_${i}.png`))),
    loadRiderParts(),
  ]);
  return {
    def,
    trees: trees.filter((t): t is { model: Model; weight: number; scale: [number, number] } => t.model !== null),
    bush,
    rocks: some(rocks),
    flowers,
    fence,
    props: props.filter((p): p is { def: PropDef; model: Model } => p.model !== null),
    arch,
    guardrail,
    spectators: some(spectators),
    grass,
    rock,
    asphalt,
    backdrop,
    clouds: some(clouds),
    rider,
  };
}

// ---------- Texturen und Materialien ----------

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Straße: gemalter Asphalt (falls vorhanden) mit Rand- und Mittellinie. */
function roadTexture(asphalt: THREE.Texture | null) {
  const t = canvasTexture(512, 1024, (g) => {
    if (asphalt?.image) {
      g.drawImage(asphalt.image as CanvasImageSource, 0, 0, 512, 512);
      g.drawImage(asphalt.image as CanvasImageSource, 0, 512, 512, 512);
    } else {
      g.fillStyle = '#66728c';
      g.fillRect(0, 0, 512, 1024);
    }
    g.fillStyle = '#ffffff';
    g.fillRect(14, 0, 9, 1024);
    g.fillRect(489, 0, 9, 1024);
    g.fillRect(252, 0, 8, 512);
  });
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  return t;
}

/** Grasbüschel: einzelne gebogene Halme auf transparentem Grund. */
function tuftTexture() {
  return canvasTexture(128, 128, (g) => {
    for (let i = 0; i < 13; i++) {
      const x = 14 + hash(i, 3.3) * 100;
      const tipX = x + (hash(i, 7.7) - 0.5) * 44;
      const tipY = 6 + hash(i, 5.5) * 70;
      const tone = Math.round(205 + hash(i, 9.9) * 50);
      g.fillStyle = `rgb(${tone},${tone},${tone})`;
      g.beginPath();
      g.moveTo(x - 6, 128);
      g.quadraticCurveTo(x - 3, 70, tipX, tipY);
      g.quadraticCurveTo(x + 5, 70, x + 6, 128);
      g.fill();
    }
  });
}

function tuftGeometry() {
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
    const dx = Math.cos(a) * 0.55;
    const dz = Math.sin(a) * 0.55;
    const base = pos.length / 3;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, 0.62, dz, -dx, 0.62, -dz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    // Normalen nach oben: die Halme werden beleuchtet wie der Boden und verschmelzen mit ihm
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function label(text: string, bg: string) {
  return canvasTexture(512, 128, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#fff';
    g.font = 'bold 92px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 70);
  });
}

/** Gelände: Gras- und Felstextur werden je nach Höhe gemischt, ganz oben liegt Schnee. */
function terrainMaterial(grass: THREE.Texture | null, rock: THREE.Texture | null) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: grass, color: grass ? 0xffffff : 0x4fb83c });
  if (!grass || !rock) return m;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rockMap = { value: rock };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aMix;\nvarying vec2 vMix;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMix = aMix;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D rockMap;\nvarying vec2 vMix;')
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, texture2D(rockMap, vMapUv * 0.3).rgb, vMix.x);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vMix.y);',
      );
  };
  return m;
}

/**
 * Fernansicht eines Modells: Es wird einmal von der Seite auf eine Textur gezeichnet
 * und in der Ferne als zwei gekreuzte Flächen dargestellt. So bleiben auch große
 * Wälder flüssig.
 */
function makeImpostor(renderer: THREE.WebGLRenderer, model: Model, def: WorldDef, sunDir: THREE.Vector3) {
  const w = Math.max(model.size.x, model.size.z) * 1.04;
  const h = model.size.y * 1.02;
  const rt = new THREE.WebGLRenderTarget(256, Math.min(768, Math.max(128, Math.round((256 * h) / w))));
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(def.hemi[0], def.hemi[1], 1.45));
  const sun = new THREE.DirectionalLight(def.sun, 2.0);
  sun.position.copy(sunDir);
  scene.add(sun, new THREE.Mesh(model.geometry, model.material));
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h, 0, 0.1, 200);
  cam.position.set(0, 0, 100);
  cam.lookAt(0, 0, 0);
  cam.position.y = 0;
  cam.updateMatrixWorld();
  const shadows = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(null);
  renderer.shadowMap.enabled = shadows;
  const a = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  return {
    geometry: mergeGeometries([a, b])!,
    material: new THREE.MeshBasicMaterial({ map: rt.texture, alphaTest: 0.4, side: THREE.DoubleSide }),
    target: rt,
  };
}
type Impostor = ReturnType<typeof makeImpostor>;

interface Kit {
  A: WorldAssets;
  impostors: Impostor[];
  terrainMat: THREE.Material;
  roadMat: THREE.Material;
  tuftGeo: THREE.BufferGeometry;
  tuftMat: THREE.Material;
  postGeo: THREE.BufferGeometry;
  postMat: THREE.Material;
  signMat: THREE.Material;
  low: boolean;
}

interface Item { p: THREE.Vector3; ry: number; s: number; sy?: number }
interface Chunk { mid: number; near: THREE.Group; far: THREE.Group }

const mat4 = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);

function instances(geometry: THREE.BufferGeometry, material: THREE.Material, items: Item[], shadow: boolean) {
  const im = new THREE.InstancedMesh(geometry, material, items.length);
  items.forEach((it, i) => {
    quat.setFromAxisAngle(yAxis, it.ry);
    mat4.compose(it.p, quat, new THREE.Vector3(it.s, it.sy ?? it.s, it.s));
    im.setMatrixAt(i, mat4);
  });
  im.castShadow = shadow;
  im.receiveShadow = shadow;
  return im;
}

/** Baut Gelände, Straße und alles, was darauf steht, für den Abschnitt d0…d1. */
function buildStrip(path: Path, d0: number, d1: number, K: Kit, route: Route | undefined) {
  const { A, low } = K;
  const def = A.def;
  const group = new THREE.Group();
  const n = Math.round((d1 - d0) / STEP) + 1;
  const m = OFFSETS.length;
  const pos = new Float32Array(n * m * 3);
  const col = new Float32Array(n * m * 3);
  const mix = new Float32Array(n * m * 2);
  const uv = new Float32Array(n * m * 2);
  const rpos = new Float32Array(n * 2 * 3);
  const ruv = new Float32Array(n * 2 * 2);
  const heights = new Float32Array(n * m);
  const nearLateral = low ? 28 : 70;

  const chunkCount = Math.ceil((d1 - d0) / CHUNK);
  const lists = Array.from({ length: chunkCount }, () => ({
    trees: A.trees.map(() => [] as Item[]),
    bushes: [] as Item[],
    rocks: A.rocks.map(() => [] as Item[]),
    flowers: [] as Item[],
  }));
  const farTrees = A.trees.map(() => [] as Item[]);
  const tufts: { p: THREE.Vector3; c: THREE.Color; s: number; r: number }[] = [];
  const posts: Item[] = [];
  const rails: Item[] = [];
  const fences: Item[] = [];
  const totalWeight = A.trees.reduce((a, t) => a + t.weight, 0);
  const tuftColor = def.tuft !== null ? new THREE.Color(def.tuft) : null;

  /** Geländehöhe an beliebiger Stelle neben der Straße. */
  const ground = (d: number, off: number) => {
    const p = path.at(d);
    const x = p.x + Math.cos(p.heading) * off;
    const z = p.z - Math.sin(p.heading) * off;
    return { v: new THREE.Vector3(x, terrainHeight(x, z, p.y, off, def.hills), z), heading: p.heading, roadY: p.y };
  };

  for (let i = 0; i < n; i++) {
    const d = d0 + i * STEP;
    const p = path.at(d);
    const rx = Math.cos(p.heading); // Vektor quer zur Fahrtrichtung
    const rz = -Math.sin(p.heading);
    const alt = path.altitude(d);
    const ci = Math.min(chunkCount - 1, Math.floor((d - d0) / CHUNK));
    for (let j = 0; j < m; j++) {
      const off = OFFSETS[j];
      const a = Math.abs(off);
      const x = p.x + rx * off;
      const z = p.z + rz * off;
      const y = terrainHeight(x, z, p.y, off, def.hills);
      heights[i * m + j] = y;
      pos.set([x, y, z], (i * m + j) * 3);
      uv.set([x / 11, z / 11], (i * m + j) * 2);
      const rel = y - p.y;
      // Tönung: helle Lichtflecken auf der Wiese, dunkler an bewaldeten Hängen
      const tint = 0.93 * (1 + 0.16 * smooth(0.47, 0.53, fbm(x / 55, z / 55))) * (1 - 0.2 * smooth(25, 70, rel)) * (a < 4.7 ? 0.9 : 1);
      col.set([tint, tint, tint], (i * m + j) * 3);
      const wobble = (noise(x / 30, z / 30) - 0.5) * 30;
      mix.set(
        [smooth(def.rockBand[0], def.rockBand[1], rel + wobble), def.snowBand ? smooth(def.snowBand[0], def.snowBand[1], rel + (alt - 900) / 9 + wobble) : 0],
        (i * m + j) * 2,
      );
    }
    rpos.set([p.x - rx * ROAD_HALF, p.y + 0.03, p.z - rz * ROAD_HALF, p.x + rx * ROAD_HALF, p.y + 0.03, p.z + rz * ROAD_HALF], i * 6);
    ruv.set([0, d / 12, 1, d / 12], i * 4);

    /** Höhe auf der Querschnittslinie – genau auf dem Geländenetz. */
    const onLine = (off: number) => {
      let j = 0;
      while (j < m - 2 && OFFSETS[j + 1] < off) j++;
      const t = (off - OFFSETS[j]) / (OFFSETS[j + 1] - OFFSETS[j]);
      return lerp(heights[i * m + j], heights[i * m + j + 1], t);
    };

    // Leitplanke, wo es neben der Straße steil abfällt, sonst Leitpfosten
    for (const s of [-1, 1]) {
      const drop = onLine(s * 13) - p.y;
      if (A.guardrail && drop < -1.7) {
        rails.push({ p: new THREE.Vector3(p.x + rx * s * 4.2, p.y - 0.12, p.z + rz * s * 4.2), ry: p.heading - Math.PI / 2, s: STEP / A.guardrail.size.x, sy: 1 });
      } else if (Math.round(d) % 50 === 0) {
        posts.push({ p: new THREE.Vector3(p.x + rx * s * 4.3, p.y - 0.05, p.z + rz * s * 4.3), ry: p.heading, s: 1 });
      }
    }

    // Grasbüschel nahe der Straße (nur im Bereich um den Fahrer)
    if (tuftColor && !low && d > d0 + 250 && d < d0 + 850) {
      for (let k = 0; k < 84; k++) {
        const off = (k % 2 ? 1 : -1) * (4.7 + hash(d * 0.19 + k, k * 2.3) ** 1.5 * 34);
        const along = (hash(k * 1.7, d * 0.31) - 0.5) * STEP;
        const x = p.x + rx * off + Math.sin(p.heading) * along;
        const z = p.z + rz * off + Math.cos(p.heading) * along;
        const light = 1 + 0.16 * smooth(0.47, 0.53, fbm(x / 55, z / 55));
        tufts.push({
          p: new THREE.Vector3(x, onLine(off) + along * p.grade - 0.04, z),
          c: tuftColor.clone().multiplyScalar(light * (0.92 + hash(k, d) * 0.18)),
          s: 0.7 + hash(d, k * 3.9) * 0.9,
          r: hash(k, d * 0.7) * 3.14,
        });
      }
    }

    // Blumen, Büsche und Felsen
    const along = (k: number) => (hash(k * 3.3, d * 0.77) - 0.5) * STEP;
    const place = (off: number, k: number, s: number, sink = 0.05): Item => {
      const al = along(k);
      return { p: new THREE.Vector3(p.x + rx * off + Math.sin(p.heading) * al, onLine(off) + al * p.grade - sink, p.z + rz * off + Math.cos(p.heading) * al), ry: hash(d, k * 4.1) * 6.28, s };
    };
    const sideOf = (k: number) => (hash(d * 0.11, k * 7.7) > 0.5 ? 1 : -1);
    for (let k = 0; k < (low ? 1 : 2); k++) {
      if (A.flowers && hash(d * 0.91 + k, k * 5.3) < 0.55 && fbm(p.x / 35 + k, p.z / 35) > 0.42) {
        lists[ci].flowers.push(place(sideOf(k) * (4.9 + hash(d * 0.67, k * 3.3) * 9), k, 0.9 + hash(k, d) * 0.7, 0.02));
      }
    }
    if (A.bush && hash(d * 0.43, 2.2) < (low ? 0.12 : 0.3)) lists[ci].bushes.push(place(sideOf(11) * (6.5 + hash(d * 0.29, 8.1) ** 1.4 * 40), 11, 0.8 + hash(d, 6.6) * 0.9, 0.08));
    if (A.rocks.length && hash(d * 0.57, 9.4) < 0.11 * def.rockDensity) {
      const which = Math.floor(hash(d, 1.9) * A.rocks.length);
      lists[ci].rocks[which].push(place(sideOf(17) * (7 + hash(d * 0.21, 3.7) ** 1.3 * 60), 17, 0.6 + hash(d, 2.8) * 1.3, 0.25));
    }

    // Bäume genau auf den Querschnittslinien, damit sie auf dem Gelände stehen
    if (totalWeight > 0) {
      const density = def.treeDensity * (def.treeline ? 1 - smooth(1500, 1950, alt) : 1);
      for (let k = 0; k < 9; k++) {
        if (hash(d * 0.37 + k * 17.3, k + 3.1) > 0.4 * density) continue;
        const off = sideOf(k + 30) * (10 + hash(d * 0.53, k * 2.9) ** 1.5 * 262);
        const x = p.x + rx * off;
        const z = p.z + rz * off;
        if (fbm(x / 90, z / 90) < 0.43) continue; // Wiesen und Lichtungen
        const y = onLine(off);
        if (y - p.y > def.rockBand[0] + 20) continue; // Fels
        let pick = hash(x * 0.3, z * 0.3) * totalWeight;
        let type = 0;
        while (type < A.trees.length - 1 && pick > A.trees[type].weight) pick -= A.trees[type++].weight;
        const sc = A.trees[type].scale;
        const item: Item = { p: new THREE.Vector3(x + (hash(x, z) - 0.5) * 3, y - 0.15, z + (hash(z, x) - 0.5) * 3), ry: hash(k, d) * 6.28, s: lerp(sc[0], sc[1], hash(d, k)) };
        (Math.abs(off) < nearLateral ? lists[ci].trees[type] : farTrees[type]).push(item);
      }
    }

    // Zaun bzw. Mauer in einzelnen Abschnitten am Straßenrand
    if (A.fence && i % Math.max(1, Math.round(A.fence.size.x / STEP)) === 0) {
      const run = Math.floor(d / 260);
      if (hash(run, 5.5) > 0.55 && d - run * 260 > 30 && d - run * 260 < 230) {
        const s = hash(run, 8.8) > 0.5 ? 1 : -1;
        fences.push({ p: new THREE.Vector3(p.x + rx * s * 6.4, onLine(s * 6.4) - 0.08, p.z + rz * s * 6.4), ry: p.heading - Math.PI / 2, s: STEP / A.fence.size.x, sy: 1 });
      }
    }
  }

  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j;
      idx.push(a, a + m, a + 1, a + 1, a + m, a + m + 1);
    }
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  tg.setAttribute('aMix', new THREE.BufferAttribute(mix, 2));
  tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, K.terrainMat);
  terrain.receiveShadow = true;
  terrain.userData.own = true;
  group.add(terrain);

  const ridx: number[] = [];
  for (let i = 0; i < n - 1; i++) ridx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  rg.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
  rg.setIndex(ridx);
  rg.computeVertexNormals();
  const road = new THREE.Mesh(rg, K.roadMat);
  road.receiveShadow = true;
  road.userData.own = true;
  group.add(road);

  // Bewuchs je Abschnitt: nah als volles Modell, fern als Fernansicht
  const shadow = !low;
  const chunks: Chunk[] = lists.map((l, ci) => {
    const near = new THREE.Group();
    const far = new THREE.Group();
    l.trees.forEach((items, t) => {
      if (!items.length) return;
      near.add(instances(A.trees[t].model.geometry, A.trees[t].model.material, items, shadow));
      far.add(instances(K.impostors[t].geometry, K.impostors[t].material, items, false));
    });
    if (A.bush && l.bushes.length) near.add(instances(A.bush.geometry, A.bush.material, l.bushes, shadow));
    if (A.flowers && l.flowers.length) near.add(instances(A.flowers.geometry, A.flowers.material, l.flowers, false));
    l.rocks.forEach((items, r) => {
      if (items.length) group.add(instances(A.rocks[r].geometry, A.rocks[r].material, items, shadow));
    });
    near.visible = false;
    group.add(near, far);
    return { mid: d0 + (ci + 0.5) * CHUNK, near, far };
  });
  farTrees.forEach((items, t) => {
    if (items.length) group.add(instances(K.impostors[t].geometry, K.impostors[t].material, items, false));
  });

  if (tufts.length) {
    const im = new THREE.InstancedMesh(K.tuftGeo, K.tuftMat, tufts.length);
    tufts.forEach((f, i) => {
      quat.setFromAxisAngle(yAxis, f.r);
      mat4.compose(f.p, quat, new THREE.Vector3(f.s, f.s, f.s));
      im.setMatrixAt(i, mat4);
      im.setColorAt(i, f.c);
    });
    im.receiveShadow = shadow;
    group.add(im);
  }
  if (posts.length) group.add(instances(K.postGeo, K.postMat, posts, shadow));
  if (A.guardrail && rails.length) group.add(instances(A.guardrail.geometry, A.guardrail.material, rails, shadow));
  if (A.fence && fences.length) group.add(instances(A.fence.geometry, A.fence.material, fences, shadow));

  // Gebäude, Tiere und andere Einzelstücke
  const single = (model: Model, v: THREE.Vector3, ry: number, s = 1) => {
    const mesh = new THREE.Mesh(model.geometry, model.material);
    mesh.position.copy(v);
    mesh.rotation.y = ry;
    mesh.scale.setScalar(s);
    mesh.castShadow = mesh.receiveShadow = shadow;
    group.add(mesh);
  };
  A.props.forEach(({ def: pd, model }, pi) => {
    for (let k = Math.floor(d0 / pd.every); k <= Math.floor(d1 / pd.every); k++) {
      const d = (k + 0.2 + 0.6 * hash(k, pi * 7.3 + 1)) * pd.every;
      if (d < Math.max(d0, 80) || d >= d1 || (route && d > route.distance - 60)) continue;
      const side = hash(k, pi + 0.5) > 0.5 ? 1 : -1;
      for (let c = 0; c < (pd.count ?? 1); c++) {
        const off = pd.overRoad ? 0 : side * lerp(pd.off[0], pd.off[1], hash(k + c * 3.1, pi * 2.7));
        const g = ground(d + c * 7 * (hash(c, k) - 0.3), off);
        const ry = pd.overRoad ? g.heading : pd.faceRoad ? g.heading - (side * Math.PI) / 2 : hash(k * 1.3 + c, pi) * 6.28;
        if (pd.overRoad) g.v.y = g.roadY - 0.3;
        else g.v.y -= 0.12;
        single(model, g.v, ry, pd.scale ?? 1);
      }
    }
  });

  // Start und Ziel: Bogen, Schild und Zuschauer
  const gate = (d: number, text: string, bg: string) => {
    const p = path.at(d);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.heading;
    if (A.arch) {
      const arch = new THREE.Mesh(A.arch.geometry, A.arch.material);
      arch.castShadow = shadow;
      g.add(arch);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(A.arch.size.x * 0.5, A.arch.size.y * 0.13), new THREE.MeshBasicMaterial({ map: label(text, bg), side: THREE.DoubleSide }));
      board.position.set(0, A.arch.size.y * 0.915, -A.arch.size.z / 2 - 0.04);
      board.rotation.y = Math.PI;
      board.userData.own = true;
      g.add(board);
    }
    A.spectators.forEach((sp, si) => {
      for (let c = 0; c < 5; c++) {
        const side = (c + si) % 2 ? 1 : -1;
        const person = new THREE.Mesh(sp.geometry, sp.material);
        person.position.set(side * (4.9 + hash(c, si + d) * 1.2), -0.05, (hash(si, c + d) - 0.5) * 34);
        person.rotation.y = (-side * Math.PI) / 2 + (hash(c, si) - 0.5) * 0.6;
        person.castShadow = shadow;
        g.add(person);
      }
    });
    group.add(g);
  };
  if (d0 <= 0 && d1 > 0) gate(0, 'START', '#2f7d4f');
  if (route && d0 <= route.distance && d1 > route.distance) gate(route.distance, 'ZIEL', '#b93a12');

  // Kilometerschilder
  for (let km = Math.max(1, Math.ceil(d0 / 1000)); km * 1000 < d1; km++) {
    if (route && km * 1000 > route.distance - 100) continue;
    const p = path.at(km * 1000);
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8), K.signMat);
    post.position.y = 1.15;
    const board = new THREE.MeshBasicMaterial({ map: label(`${km} km`, '#1f5f8b') });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.04), [K.signMat, K.signMat, K.signMat, K.signMat, board, board]);
    plate.position.y = 2.2;
    post.userData.own = plate.userData.own = true;
    g.add(post, plate);
    g.position.set(p.x - Math.cos(p.heading) * 5.2, p.y, p.z + Math.sin(p.heading) * 5.2);
    g.rotation.y = p.heading + Math.PI;
    group.add(g);
  }

  return { group, chunks };
}

/** Gibt frei, was nur zu diesem Abschnitt gehört; Modelle und gemeinsame Materialien bleiben. */
function disposeStrip(g: THREE.Object3D) {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    if (!mesh.userData.own) return;
    mesh.geometry?.dispose();
    for (const mt of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const map = (mt as THREE.MeshBasicMaterial).map;
      if (map && (map as THREE.CanvasTexture).isCanvasTexture) {
        map.dispose();
        mt.dispose();
      }
    }
  });
}

interface AnyRider {
  group: THREE.Object3D;
  setColor(c: THREE.Color): void;
  update(dt: number, speed: number, cadence: number): void;
}

function simpleRider(color: number, opacity = 1): AnyRider {
  const r = makeRider(color, opacity);
  return { group: r.group, setColor: (c) => r.jerseyMat.color.lerp(c, 0.08), update: r.update };
}

function createWorld(el: HTMLDivElement, low: boolean, def: WorldDef, onState: (s: string) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  const haze = new THREE.Color(def.haze);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(def.haze, 0.0009);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 9000);

  // Himmel: gemalter Verlauf von tiefem Blau zu hellem Dunst am Horizont
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(def.sky[0]) }, mid: { value: new THREE.Color(def.sky[1]) }, low: { value: new THREE.Color(def.sky[2]) } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vDir; void main() { float h = max(vDir.y, 0.0); vec3 c = mix(low, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.18, 0.75, h)); gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION), THREE.MathUtils.degToRad(SUN_AZIMUTH));
  // farbiges Gegenlicht von unten lässt Schatten bläulich wirken
  scene.add(new THREE.HemisphereLight(def.hemi[0], def.hemi[1], 1.45));
  const sun = new THREE.DirectionalLight(def.sun, 2.0);
  sun.castShadow = !low;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -70;
  sc.right = sc.top = 70;
  sc.near = 1;
  sc.far = 700;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);

  const far = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3400, 32), new THREE.MeshBasicMaterial({ color: haze, fog: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -140;
  far.add(ground);
  scene.add(far);

  let me: AnyRider = simpleRider(0xf5a524);
  let pacer: AnyRider = simpleRider(0x2f9fe0);
  let ghost: AnyRider = simpleRider(0xa78bfa, 0.4);
  me.group.visible = pacer.group.visible = ghost.group.visible = false;
  scene.add(me.group, pacer.group, ghost.group);

  let kit: Kit | null = null;
  let closed = false;
  const own: { dispose(): void }[] = [];

  onState('Welt wird geladen …');
  loadWorld(def)
    .then((A) => {
      if (closed) return;
      // gemaltes Bergpanorama rundherum
      if (A.backdrop) {
        A.backdrop.repeat.set(4, 1);
        const height = 1250;
        const mat = new THREE.MeshBasicMaterial({ map: A.backdrop, alphaTest: 0.5, side: THREE.BackSide, fog: false });
        // der oberste Rand der Bilder hat einen Farbsaum vom Freistellen: ein paar Pixel abschneiden
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            '#include <map_fragment>\nif (texture2D(map, vMapUv + vec2(0.0, 0.016)).a < 0.6 || texture2D(map, vMapUv + vec2(0.0004, 0.008)).a < 0.6) discard;',
          );
        };
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(3000, 3000, height, 96, 1, true), mat);
        ring.position.y = -330 + height / 2;
        far.add(ring);
        own.push(ring.geometry, mat);
      }
      A.clouds.forEach((map, c) => {
        for (let i = 0; i < 3; i++) {
          const a = ((c * 3 + i) / 12) * Math.PI * 2 + hash(i, c + 4.2) * 0.35;
          const r = 3400 + hash(i, c + 9.9) * 500;
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, fog: false, transparent: true, depthWrite: false }));
          const w = 1500 + hash(i, c + 2.2) * 1300;
          sprite.scale.set(w, w / 2, 1);
          sprite.position.set(Math.sin(a) * r, 520 + hash(i, c + 6.6) * 520, Math.cos(a) * r);
          sprite.renderOrder = -5;
          far.add(sprite);
          own.push(sprite.material);
        }
      });

      const impostors = A.trees.map((t) => makeImpostor(renderer, t.model, def, sunDir));
      const terrainMat = terrainMaterial(A.grass, A.rock);
      const roadMap = roadTexture(A.asphalt);
      const tuftMap = tuftTexture();
      kit = {
        A,
        impostors,
        terrainMat,
        roadMat: new THREE.MeshLambertMaterial({ map: roadMap }),
        tuftGeo: tuftGeometry(),
        tuftMat: new THREE.MeshLambertMaterial({ map: tuftMap, alphaTest: 0.5 }),
        postGeo: new THREE.BoxGeometry(0.12, 1.0, 0.07).translate(0, 0.5, 0),
        postMat: toon({ color: 0xffffff }),
        signMat: toon({ color: 0xe6ecf5 }),
        low,
      };
      own.push(terrainMat, roadMap, tuftMap, kit.roadMat, kit.tuftGeo, kit.tuftMat, kit.postGeo, kit.postMat, kit.signMat);
      for (const im of impostors) own.push(im.geometry, im.material, im.target);

      // Fahrer aus den Modellen; gelingt das nicht, bleibt der einfache Fahrer
      if (A.rider) {
        try {
          const next = [makeAssetRider(A.rider, 0xf5a524, 1), makeAssetRider(A.rider, 0x2f9fe0, 1), makeAssetRider(A.rider, 0xa78bfa, 0.45)];
          scene.remove(me.group, pacer.group, ghost.group);
          [me, pacer, ghost] = next;
          scene.add(me.group, pacer.group, ghost.group);
        } catch (err) {
          console.warn('Fahrermodell konnte nicht aufgebaut werden, nutze den einfachen Fahrer.', err);
        }
      }
      me.group.visible = true;
      onState('');
    })
    .catch(() => onState('Die Welt konnte nicht geladen werden.'));

  let path: Path | null = null;
  let routeId: string | undefined = '-';
  let strip: { group: THREE.Group; chunks: Chunk[] } | null = null;
  let stripCenter = NaN;
  let shown = { me: 0, pacer: 0, ghost: 0 };
  let seen = { dist: -1, at: 0 };
  let raf = 0;
  let frames = 0;
  let last = performance.now();
  const zoneColor = new THREE.Color();

  const resize = () => {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  const put = (r: AnyRider, d: number, side: number) => {
    const p = path!.at(d);
    r.group.position.set(p.x + Math.cos(p.heading) * side, p.y + 0.03, p.z - Math.sin(p.heading) * side);
    r.group.rotation.set(-Math.atan(p.grade), p.heading, 0, 'YXZ');
  };

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const { ride, live, profile } = getState();
    if (!ride) return;

    if (ride.route?.id !== routeId || !path) {
      routeId = ride.route?.id;
      path = new Path(ride.route);
      stripCenter = NaN;
      shown = { me: ride.dist, pacer: ride.pacer?.dist ?? 0, ghost: ride.ghost?.dist ?? 0 };
    }

    // Die Engine liefert einen Wert pro Sekunde; dazwischen weich weiterrechnen
    if (ride.dist !== seen.dist) seen = { dist: ride.dist, at: now };
    const moving = ride.status === 'running';
    const ahead = moving ? Math.min(1.2, (now - seen.at) / 1000) : 0;
    const ease = Math.min(1, dt * 3);
    shown.me += (ride.dist + ride.speed * ahead - shown.me) * ease;
    if (Math.abs(ride.dist - shown.me) > 60) shown.me = ride.dist;

    if (kit) {
      const center = Math.round(shown.me / 300) * 300;
      if (center !== stripCenter) {
        if (strip) {
          scene.remove(strip.group);
          disposeStrip(strip.group);
        }
        strip = buildStrip(path, center - 400, center + 1500, kit, ride.route);
        scene.add(strip.group);
        stripCenter = center;
      }
      // volle Modelle nur in der Nähe des Fahrers, sonst die Fernansicht
      const reach = low ? 110 : 250;
      for (const c of strip!.chunks) {
        const dd = c.mid - shown.me;
        const near = dd > -CHUNK && dd < reach;
        c.near.visible = near;
        c.far.visible = !near;
      }
    }

    put(me, shown.me, -0.9);
    me.update(dt, moving ? ride.speed : 0, moving ? live.cadence : 0);
    // Trikotfarbe = aktuelle Leistungszone
    me.setColor(zoneColor.set(zoneOf(ride.power / profile.ftp).color));

    pacer.group.visible = !!ride.pacer && !!kit;
    if (ride.pacer) {
      shown.pacer += (ride.pacer.dist - shown.pacer) * ease;
      if (Math.abs(ride.pacer.dist - shown.pacer) > 60) shown.pacer = ride.pacer.dist;
      put(pacer, shown.pacer, 0.9);
      pacer.update(dt, moving ? ride.speed : 0, moving ? 88 : 0);
    }
    ghost.group.visible = !!ride.ghost && !!kit;
    if (ride.ghost) {
      shown.ghost += (ride.ghost.dist - shown.ghost) * ease;
      if (Math.abs(ride.ghost.dist - shown.ghost) > 60) shown.ghost = ride.ghost.dist;
      put(ghost, shown.ghost, 2.3);
      ghost.update(dt, moving ? ride.speed : 0, moving ? 85 : 0);
    }

    const back = path.at(shown.me - 7.5);
    const look = path.at(shown.me + 16);
    const sway = Math.sin(now / 11000) * 0.8;
    camera.position.set(back.x + Math.cos(back.heading) * (1.1 + sway), back.y + 2.6, back.z - Math.sin(back.heading) * (1.1 + sway));
    camera.lookAt(look.x, look.y + 1.2, look.z);
    sky.position.copy(camera.position);
    far.position.set(camera.position.x, Math.min(0, camera.position.y - 40), camera.position.z);

    // Schattenbereich folgt dem Fahrer
    sun.target.position.copy(me.group.position);
    sun.position.copy(me.group.position).addScaledVector(sunDir, 300);

    renderer.render(scene, camera);
    frames++;
    (window as unknown as { rollwerkFrames?: number }).rollwerkFrames = frames; // für Tests und Leistungsmessung
  };
  raf = requestAnimationFrame(frame);

  return () => {
    closed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    if (strip) disposeStrip(strip.group);
    for (const o of own) o.dispose();
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

export function World3D({ low = false, world }: { low?: boolean; world?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState('');
  useEffect(() => {
    if (!ref.current) return;
    try {
      return createWorld(ref.current, low, worldByKey(world), setState);
    } catch {
      setState('Die 3D-Ansicht braucht WebGL, das dieser Browser nicht bereitstellt.');
    }
  }, [low, world]);
  return (
    <div className="world">
      {/* eigener Behälter für die Zeichenfläche: React darf ihn nicht leeren, wenn sich der Hinweis ändert */}
      <div ref={ref} className="world-canvas" />
      {state && <div className="world-state">{state}</div>}
    </div>
  );
}
