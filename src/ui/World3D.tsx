// 3D-Ansicht der Fahrt im gemalten Anime-Look: Toon-Schattierung, kräftige Farben,
// tiefblauer Himmel mit großen Quellwolken, blau verblassende Schneeberge.
// Die Straße folgt dem echten Höhenprofil der Strecke; ihr Verlauf in der
// Ebene ist erfunden (sanfte Kurven), die echte Lage zeigt die Streckenkarte.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getState } from '../core/app';
import { positionAt } from '../core/gpx';
import { zoneOf } from '../core/stats';
import type { Route } from '../core/types';

const STEP = 5; // m zwischen Wegpunkten
const LEAD = 400; // m Straße vor dem Start
const HAZE = new THREE.Color(0xa9d6f5); // blauer Dunst am Horizont
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

  /** Echte Höhe über dem Meer (für Baumgrenze und Schnee). */
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

function terrainHeight(x: number, z: number, roadY: number, off: number) {
  const a = Math.abs(off);
  const hills = (fbm(x / 240, z / 240) - 0.42) * 120 + (noise(x / 26, z / 26) - 0.5) * 3;
  const peaks = smooth(110, 290, a) * (0.25 + fbm(x / 380 + 7, z / 380)) * 230;
  return roadY + smooth(7, 95, a) * hills + peaks - smooth(ROAD_HALF, 6.5, a) * 0.4;
}

const C = {
  grass: new THREE.Color(0x4fb83c),
  light: new THREE.Color(0x8ed84a), // sonnige Lichtflecken auf der Wiese
  forest: new THREE.Color(0x1f8f52),
  rock: new THREE.Color(0x6f86ad),
  snow: new THREE.Color(0xffffff),
  verge: new THREE.Color(0x8fcf52),
};

/** Stufen-Verlauf für die Toon-Schattierung: Schatten, Mittelton, Licht. */
let ramp: THREE.DataTexture | null = null;
function toonRamp() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 185, 185, 185, 255, 235, 235, 235, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  return ramp;
}
const toon = (params: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params });

/** Canvas-Textur aus mehreren Rauschschichten. */
function noiseTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function grassTexture() {
  return noiseTexture(512, (g, s) => {
    g.fillStyle = '#f4f4f4';
    g.fillRect(0, 0, s, s);
    g.lineCap = 'round';
    for (let i = 0; i < 1500; i++) {
      const x = 12 + Math.random() * (s - 24);
      const y = 16 + Math.random() * (s - 32);
      const dark = Math.random() > 0.35;
      g.strokeStyle = dark ? `rgba(40,90,60,${0.1 + Math.random() * 0.2})` : `rgba(255,255,255,${0.35 + Math.random() * 0.4})`;
      g.lineWidth = 1.5 + Math.random() * 2.5;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (Math.random() - 0.5) * 6, y - 5, x + (Math.random() - 0.5) * 9, y - 7 - Math.random() * 9);
      g.stroke();
    }
  });
}

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#66728c';
  g.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 5000; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${Math.random() * 0.07})` : `rgba(0,0,0,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * 512, Math.random() * 1024, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // leicht hellere Fahrspuren
  for (const x of [150, 362]) {
    const grad = g.createLinearGradient(x - 70, 0, x + 70, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.045)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x - 70, 0, 140, 1024);
  }
  g.fillStyle = '#ffffff';
  g.fillRect(14, 0, 9, 1024);
  g.fillRect(489, 0, 9, 1024);
  g.fillRect(252, 0, 8, 512);
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function cloudTexture(seed: number) {
  return noiseTexture(1024, (g) => {
    const puffs: [number, number, number][] = [];
    const rnd = (i: number) => hash(i * 1.37 + seed, seed * 3.1);
    // große Grundform, darauf viele kleine Quellungen
    for (let i = 0; i < 34; i++) {
      const t = rnd(i);
      const x = 150 + t * 724;
      const mid = 1 - Math.abs(t - 0.5 + (rnd(i + 90) - 0.5) * 0.3) * 2;
      const r = 50 + rnd(i + 30) * 85 * (0.5 + mid);
      const y = 660 - rnd(i + 60) * 400 * Math.max(0.08, mid);
      puffs.push([x, y, r]);
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI * (0.1 + rnd(i * 7 + k) * 0.8);
        puffs.push([x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85, r * (0.28 + rnd(i * 11 + k) * 0.3)]);
      }
    }
    const draw = (dx: number, dy: number, k: number, color: string) => {
      g.fillStyle = color;
      for (const [x, y, r] of puffs) {
        g.beginPath();
        g.arc(x + dx, y + dy, r * k, 0, Math.PI * 2);
        g.fill();
      }
    };
    draw(0, 0, 1, '#7fa6e3'); // Schattenseite
    draw(-6, -10, 0.93, '#a9c6f2');
    draw(-11, -19, 0.86, '#dbe9fc');
    draw(-17, -29, 0.76, '#ffffff'); // Sonnenseite
    // Unterkante weich in den Dunst auslaufen lassen
    const fade = g.createLinearGradient(0, 600, 0, 700);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = fade;
    g.fillRect(0, 600, 1024, 424);
    g.globalCompositeOperation = 'source-over';
  }, false);
}

/** Gemaltes Blattbüschel mit harter Kante: dunkle Tupfer unten, helle obenauf. */
function leafTexture(seed: number, aspect: number) {
  return noiseTexture(256, (g) => {
    const rnd = (i: number) => hash(i * 2.11 + seed, seed * 1.7);
    g.fillStyle = '#8a8a8a';
    g.beginPath();
    g.arc(128, 128, 46, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 90; i++) {
      const a = rnd(i) * Math.PI * 2;
      const r = Math.sqrt(rnd(i + 200)) * 100;
      const tone = Math.round(120 + (i / 90) * 135);
      g.fillStyle = `rgb(${tone},${tone},${tone})`;
      g.save();
      g.translate(128 + Math.cos(a) * r, 128 + Math.sin(a) * r - (i / 90) * 10);
      g.rotate(aspect > 1.5 ? a + Math.PI / 2 + (rnd(i + 50) - 0.5) : rnd(i + 400) * Math.PI);
      const w = 9 + rnd(i + 300) * 9;
      g.beginPath();
      g.ellipse(0, 0, w / aspect + 2, w * (aspect > 1.5 ? 1.5 : 1), 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }, false);
}

/** Grasbüschel: einzelne gebogene Halme auf transparentem Grund. */
function tuftTexture() {
  return noiseTexture(128, (g) => {
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
  }, false);
}

interface Card { c: THREE.Vector3; o: THREE.Vector3; n: THREE.Vector3; size: number }

/**
 * Baumkrone aus vielen kleinen, bemalten Flächen. Die Schattierung nutzt weiche,
 * nach außen zeigende Normalen, dadurch wirkt die Krone wie ein gemaltes Volumen.
 */
function foliageGeometry(cards: Card[], core: THREE.BufferGeometry, seed: number) {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const c of cards) { yMin = Math.min(yMin, c.c.y); yMax = Math.max(yMax, c.c.y); }
  const up = new THREE.Vector3(0, 1, 0);
  const t = new THREE.Vector3();
  const b = new THREE.Vector3();
  const v = new THREE.Vector3();
  cards.forEach((card, i) => {
    t.crossVectors(card.o, up);
    if (t.lengthSq() < 0.001) t.set(1, 0, 0);
    t.normalize();
    b.crossVectors(card.o, t);
    const roll = hash(i, seed) * Math.PI * 2;
    const tx = t.clone().multiplyScalar(Math.cos(roll)).addScaledVector(b, Math.sin(roll));
    const bx = b.clone().multiplyScalar(Math.cos(roll)).addScaledVector(t, -Math.sin(roll));
    const h = card.size / 2;
    const base = pos.length / 3;
    const shadeV = lerp(0.6, 1.2, (card.c.y - yMin) / (yMax - yMin || 1)) + (hash(i, seed + 5) - 0.5) * 0.14;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      v.copy(card.c).addScaledVector(tx, sx * h).addScaledVector(bx, sy * h);
      pos.push(v.x, v.y, v.z);
      nor.push(card.n.x, card.n.y, card.n.z);
      uv.push((sx + 1) / 2, (sy + 1) / 2);
      col.push(shadeV, shadeV, shadeV);
    }
    // Vorder- und Rückseite mit gleichen Normalen, damit beide gleich beleuchtet sind
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
  });
  // dunkler Kern, damit man nicht durch die Krone hindurchsieht
  const cg = core.toNonIndexed();
  cg.computeVertexNormals();
  const cp = cg.getAttribute('position');
  const cn = cg.getAttribute('normal');
  const base = pos.length / 3;
  for (let i = 0; i < cp.count; i++) {
    pos.push(cp.getX(i), cp.getY(i), cp.getZ(i));
    nor.push(cn.getX(i), cn.getY(i), cn.getZ(i));
    uv.push(0.5, 0.5);
    col.push(0.66, 0.66, 0.66);
    idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function broadleafGeometry(perCluster = 17, sizeK = 1.25) {
  const clusters: [number, number, number, number][] = [[0, 5.2, 0, 2.3], [1.6, 4.3, 0.6, 1.7], [-1.5, 4.4, -0.7, 1.8], [0.3, 6.7, -0.3, 1.6], [-0.4, 4.6, 1.6, 1.5], [0.9, 5.6, -1.4, 1.4]];
  const cards: Card[] = [];
  const centre = new THREE.Vector3(0, 4.6, 0);
  clusters.forEach(([x, y, z, r], k) => {
    for (let i = 0; i < perCluster; i++) {
      const a = hash(i + k * 20, 1.1) * Math.PI * 2;
      const yy = lerp(-0.85, 1, hash(i + k * 20, 2.2));
      const rr = Math.sqrt(1 - yy * yy);
      const o = new THREE.Vector3(Math.cos(a) * rr, yy, Math.sin(a) * rr);
      const c = new THREE.Vector3(x, y, z).addScaledVector(o, r * 0.8);
      cards.push({ c, o: o.clone().add(new THREE.Vector3(hash(i, k) - 0.5, hash(k, i) - 0.5, 0).multiplyScalar(0.5)).normalize(), n: c.clone().sub(centre).normalize().lerp(o, 0.4).normalize(), size: r * sizeK });
    }
  });
  const core = mergeGeometries(clusters.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r * 0.72, 1).translate(x, y, z)))!;
  return foliageGeometry(cards, core, 3.1);
}

function coniferGeometry(stepY = 0.62, perMetre = 5, sizeK = 1) {
  const cards: Card[] = [];
  for (let y = 2.1; y < 10.4; y += stepY) {
    const r = 2.5 * (1 - (y - 2.1) / 8.6) + 0.22;
    const count = Math.max(3, Math.round(r * perMetre));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + y * 2.4 + (hash(i, y) - 0.5) * 0.5;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      // Äste hängen leicht nach außen unten
      cards.push({ c: dir.clone().multiplyScalar(r * 0.72).setY(y - r * 0.12), o: new THREE.Vector3(dir.x, 0.75, dir.z).normalize(), n: new THREE.Vector3(dir.x, 0.45, dir.z).normalize(), size: (1.25 + r * 0.55) * sizeK });
    }
  }
  return foliageGeometry(cards, new THREE.ConeGeometry(1.45, 8.6, 9).translate(0, 6.3, 0), 8.4);
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
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 192);
  g.strokeStyle = '#fff';
  g.lineWidth = 8;
  g.strokeRect(10, 10, 492, 172);
  g.fillStyle = '#fff';
  g.font = 'bold 108px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 102);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Gemeinsam genutzte Geometrien und Materialien (werden nur einmal angelegt). */
function makeAssets() {
  const leafA = leafTexture(1.3, 1);
  const leafB = leafTexture(6.1, 2.4);
  const depth = (map: THREE.Texture) => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 });
  return {
    conifer: coniferGeometry(),
    broadleaf: broadleafGeometry(),
    // vereinfachte Bäume für die Ferne: weniger, dafür größere Blattflächen
    coniferFar: coniferGeometry(1.5, 2.2, 1.7),
    broadleafFar: broadleafGeometry(5, 1.9),
    trunk: new THREE.CylinderGeometry(0.17, 0.3, 4.2, 10).translate(0, 2.1, 0),
    post: new THREE.BoxGeometry(0.12, 1.0, 0.07).translate(0, 0.5, 0),
    flower: new THREE.IcosahedronGeometry(0.1, 1),
    tuft: tuftGeometry(),
    coniferMat: toon({ vertexColors: true, map: leafB, alphaTest: 0.5 }),
    broadleafMat: toon({ vertexColors: true, map: leafA, alphaTest: 0.5 }),
    coniferDepth: depth(leafB),
    broadleafDepth: depth(leafA),
    tuftMat: new THREE.MeshLambertMaterial({ map: tuftTexture(), alphaTest: 0.5 }),
    trunkMat: toon({ color: 0x7a5236 }),
    postMat: toon({ color: 0xffffff }),
    signMat: toon({ color: 0xe6ecf5 }),
    flowerMat: new THREE.MeshBasicMaterial(),
    // Gelände weich schattiert: Toon-Stufen ergäben auf Hängen harte Streifen
    terrainMat: new THREE.MeshLambertMaterial({ vertexColors: true, map: grassTexture() }),
    roadMat: toon({ map: roadTexture() }),
  };
}
type Assets = ReturnType<typeof makeAssets>;

/** Farbe des Geländes an einer Stelle (auch für die Grasbüschel, damit sie zum Boden passen). */
function terrainColor(out: THREE.Color, x: number, z: number, rel: number, alt: number, a: number) {
  // Wiese mit klar begrenzten, hellen Lichtflecken wie in gemalten Hintergründen
  out.copy(C.grass).lerp(C.light, smooth(0.47, 0.53, fbm(x / 55, z / 55)) * 0.85);
  out.lerp(C.forest, smooth(25, 70, rel) * 0.8);
  out.lerp(C.rock, smooth(105, 135, rel + (alt - 900) / 14 + (noise(x / 30, z / 30) - 0.5) * 30));
  out.lerp(C.snow, smooth(178, 192, rel + (alt - 900) / 9 + (noise(x / 45, z / 45) - 0.5) * 36));
  if (a < 6.6) out.lerp(C.verge, a < 4.7 ? 0.8 : 0.4);
  // Fernes verblasst ins Blaue
  out.lerp(HAZE, smooth(110, 290, a) * 0.32);
  return out;
}

interface Tree { x: number; y: number; z: number; s: number; tone: number }

/** Baut Gelände, Straße, Bäume und Schilder für den Abschnitt d0…d1. */
function buildStrip(path: Path, d0: number, d1: number, A: Assets, route: Route | undefined, low: boolean) {
  const group = new THREE.Group();
  const n = Math.round((d1 - d0) / STEP) + 1;
  const m = OFFSETS.length;
  const pos = new Float32Array(n * m * 3);
  const col = new Float32Array(n * m * 3);
  const uv = new Float32Array(n * m * 2);
  const rpos = new Float32Array(n * 2 * 3);
  const ruv = new Float32Array(n * 2 * 2);
  const heights = new Float32Array(n * m);
  const tmp = new THREE.Color();
  const conifers: Tree[] = [];
  const broadleaves: Tree[] = [];
  const conifersFar: Tree[] = [];
  const broadleavesFar: Tree[] = [];
  const tufts: { p: THREE.Vector3; c: THREE.Color; s: number; r: number }[] = [];
  const flowers: { p: THREE.Vector3; c: number }[] = [];
  const posts: THREE.Vector3[] = [];
  const postHeadings: number[] = [];

  for (let i = 0; i < n; i++) {
    const d = d0 + i * STEP;
    const p = path.at(d);
    const rx = Math.cos(p.heading); // Vektor quer zur Fahrtrichtung
    const rz = -Math.sin(p.heading);
    const alt = path.altitude(d);
    for (let j = 0; j < m; j++) {
      const off = OFFSETS[j];
      const a = Math.abs(off);
      const x = p.x + rx * off;
      const z = p.z + rz * off;
      const y = terrainHeight(x, z, p.y, off);
      heights[i * m + j] = y;
      pos.set([x, y, z], (i * m + j) * 3);
      uv.set([x / 9, z / 9], (i * m + j) * 2);
      const rel = y - p.y;
      terrainColor(tmp, x, z, rel, alt, a);
      col.set([tmp.r, tmp.g, tmp.b], (i * m + j) * 3);
    }
    rpos.set([p.x - rx * ROAD_HALF, p.y + 0.03, p.z - rz * ROAD_HALF, p.x + rx * ROAD_HALF, p.y + 0.03, p.z + rz * ROAD_HALF], i * 6);
    ruv.set([0, d / 12, 1, d / 12], i * 4);

    // Leitpfosten alle 50 m
    if (Math.round(d) % 50 === 0) {
      for (const s of [-1, 1]) {
        posts.push(new THREE.Vector3(p.x + rx * s * 4.3, p.y - 0.05, p.z + rz * s * 4.3));
        postHeadings.push(p.heading);
      }
    }

    // Grasbüschel auf den Wiesen nahe der Straße (nur im Bereich um den Fahrer)
    if (!low && d > d0 + 250 && d < d0 + 850) {
      for (let k = 0; k < 84; k++) {
        const off = (k % 2 ? 1 : -1) * (4.7 + hash(d * 0.19 + k, k * 2.3) ** 1.5 * 34);
        let j = 0;
        while (j < m - 2 && OFFSETS[j + 1] < off) j++;
        const t = (off - OFFSETS[j]) / (OFFSETS[j + 1] - OFFSETS[j]);
        const along = (hash(k * 1.7, d * 0.31) - 0.5) * STEP;
        const x = p.x + rx * off + Math.sin(p.heading) * along;
        const z = p.z + rz * off + Math.cos(p.heading) * along;
        const y = lerp(heights[i * m + j], heights[i * m + j + 1], t) + along * p.grade - 0.04;
        const c = terrainColor(new THREE.Color(), x, z, y - p.y, alt, Math.abs(off)).multiplyScalar(0.97 + hash(k, d) * 0.16);
        tufts.push({ p: new THREE.Vector3(x, y, z), c, s: 0.7 + hash(d, k * 3.9) * 0.9, r: hash(k, d * 0.7) * 3.14 });
      }
    }

    // Blumen am Straßenrand
    for (let k = 0; k < 5; k++) {
      if (hash(d * 0.91 + k, k * 5.3) > 0.55 || fbm(p.x / 35 + k, p.z / 35) < 0.45) continue;
      const off = (hash(d * 0.23, k * 1.9) > 0.5 ? 1 : -1) * (4.9 + hash(d * 0.67, k * 3.3) * 12);
      let j = 0;
      while (j < m - 2 && OFFSETS[j + 1] < off) j++;
      const t = (off - OFFSETS[j]) / (OFFSETS[j + 1] - OFFSETS[j]);
      const along = (hash(k, d) - 0.5) * STEP;
      flowers.push({
        p: new THREE.Vector3(p.x + rx * off + Math.sin(p.heading) * along, lerp(heights[i * m + j], heights[i * m + j + 1], t) + 0.14, p.z + rz * off + Math.cos(p.heading) * along),
        c: [0xffffff, 0xffd84a, 0xff9a3c, 0xf7a8d8][Math.floor(hash(d, k * 9.1) * 4)],
      });
    }

    // Bäume genau auf den Querschnittslinien, damit sie auf dem Gelände stehen
    const density = 1 - smooth(1500, 1950, alt);
    for (let k = 0; k < 7; k++) {
      if (hash(d * 0.37 + k * 17.3, k + 3.1) > 0.5 * density) continue;
      const side = hash(d * 0.11, k * 7.7) > 0.5 ? 1 : -1;
      const off = side * (11 + hash(d * 0.53, k * 2.9) ** 1.5 * 260);
      let j = 0;
      while (j < m - 2 && OFFSETS[j + 1] < off) j++;
      const t = (off - OFFSETS[j]) / (OFFSETS[j + 1] - OFFSETS[j]);
      const x = p.x + rx * off;
      const z = p.z + rz * off;
      const wood = fbm(x / 90, z / 90);
      if (wood < 0.43) continue; // Wiesen und Lichtungen
      const y = lerp(heights[i * m + j], heights[i * m + j + 1], t);
      if (y - p.y > 150) continue; // Fels
      const near = !low && Math.abs(off) < 70;
      const tree = { x: x + (hash(x, z) - 0.5) * 3, z: z + (hash(z, x) - 0.5) * 3, y: y - 0.2, s: 0.75 + hash(d, k) * 0.85, tone: hash(k, d) };
      (hash(x * 0.3, z * 0.3) < smooth(500, 1100, alt) * 0.6 + 0.4 ? (near ? conifers : conifersFar) : near ? broadleaves : broadleavesFar).push(tree);
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
  tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, A.terrainMat);
  terrain.receiveShadow = true;
  group.add(terrain);

  const ridx: number[] = [];
  for (let i = 0; i < n - 1; i++) ridx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  rg.setAttribute('uv', new THREE.BufferAttribute(ruv, 2));
  rg.setIndex(ridx);
  rg.computeVertexNormals();
  const road = new THREE.Mesh(rg, A.roadMat);
  road.receiveShadow = true;
  group.add(road);

  const mat = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const plant = (list: Tree[], crownGeo: THREE.BufferGeometry, crownMat: THREE.Material, depthMat: THREE.Material | null, hue: number, sat: number, light: number) => {
    if (!list.length) return;
    const crown = new THREE.InstancedMesh(crownGeo, crownMat, list.length);
    const trunk = new THREE.InstancedMesh(A.trunk, A.trunkMat, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(yAxis, t.tone * 6.28);
      mat.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + t.tone * 0.35), t.s));
      crown.setMatrixAt(i, mat);
      trunk.setMatrixAt(i, mat);
      crown.setColorAt(i, tmp.setHSL(hue + t.tone * 0.04, sat, light + t.tone * 0.1));
    });
    if (depthMat) {
      crown.customDepthMaterial = depthMat;
      crown.castShadow = trunk.castShadow = true;
    }
    crown.receiveShadow = true;
    group.add(crown, trunk);
  };
  plant(conifers, A.conifer, A.coniferMat, A.coniferDepth, 0.43, 0.7, 0.3); // dunkles Blaugrün
  plant(broadleaves, A.broadleaf, A.broadleafMat, A.broadleafDepth, 0.28, 0.75, 0.47); // helles Sommergrün
  plant(conifersFar, A.coniferFar, A.coniferMat, null, 0.43, 0.7, 0.3);
  plant(broadleavesFar, A.broadleafFar, A.broadleafMat, null, 0.28, 0.75, 0.47);

  if (tufts.length) {
    const im = new THREE.InstancedMesh(A.tuft, A.tuftMat, tufts.length);
    tufts.forEach((f, i) => {
      q.setFromAxisAngle(yAxis, f.r);
      mat.compose(f.p, q, new THREE.Vector3(f.s, f.s, f.s));
      im.setMatrixAt(i, mat);
      im.setColorAt(i, f.c);
    });
    im.receiveShadow = true;
    group.add(im);
  }

  if (flowers.length) {
    const im = new THREE.InstancedMesh(A.flower, A.flowerMat, flowers.length);
    flowers.forEach((f, i) => {
      mat.compose(f.p, q.identity(), new THREE.Vector3(1, 0.7, 1));
      im.setMatrixAt(i, mat);
      im.setColorAt(i, tmp.set(f.c));
    });
    group.add(im);
  }

  if (posts.length) {
    const im = new THREE.InstancedMesh(A.post, A.postMat, posts.length);
    posts.forEach((p, i) => {
      q.setFromAxisAngle(yAxis, postHeadings[i]);
      mat.compose(p, q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, mat);
    });
    im.castShadow = true;
    group.add(im);
  }

  // Kilometerschilder, Start- und Zielbogen
  const signs = (pd: number, text: string, bg: string, arch = false) => {
    const p = path.at(pd);
    const rx = Math.cos(p.heading);
    const rz = -Math.sin(p.heading);
    const g = new THREE.Group();
    const board = toon({ map: label(text, bg) });
    const faces = [A.signMat, A.signMat, A.signMat, A.signMat, board, board];
    if (arch) {
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 6.2, 12), A.signMat);
        post.position.set(s * 4.6, 3.1, 0);
        g.add(post);
      }
      const banner = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.7, 0.25), faces);
      banner.position.set(0, 5.6, 0);
      g.add(banner);
      g.position.set(p.x, p.y, p.z);
    } else {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8), A.signMat);
      post.position.y = 1.15;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.56, 0.04), faces);
      plate.position.y = 2.2;
      g.add(post, plate);
      g.position.set(p.x - rx * 5.2, p.y, p.z - rz * 5.2);
    }
    g.rotation.y = p.heading + Math.PI;
    g.traverse((o) => { o.castShadow = true; });
    group.add(g);
  };
  for (let km = Math.max(1, Math.ceil(d0 / 1000)); km * 1000 < d1; km++) {
    if (!route || km * 1000 < route.distance - 100) signs(km * 1000, `${km} km`, '#1f5f8b');
  }
  if (d0 <= 0 && d1 > 0) signs(0, 'START', '#2f7d4f', true);
  if (route && d0 <= route.distance && d1 > route.distance) signs(route.distance, 'ZIEL', '#b93a12', true);

  return group;
}

/** Gibt alles frei, was nur zu diesem Abschnitt gehört (gemeinsame Assets bleiben). */
function disposeStrip(g: THREE.Object3D, A: Assets) {
  const shared = new Set<unknown>(Object.values(A));
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !shared.has(mesh.geometry)) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const mt of mats) {
      if (shared.has(mt)) continue;
      (mt as THREE.MeshStandardMaterial).map?.dispose();
      mt.dispose();
    }
    (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose();
  });
}

/** Stilisierter Radfahrer aus Grundkörpern, mit tretenden Beinen. */
function makeRider(jersey: number, opacity = 1) {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const transparent = opacity < 1;
  const mat = (color: number, _r = 0, _m = 0) => toon({ color, transparent, opacity });
  const frameMat = mat(0x1d2026, 0.35, 0.6);
  const jerseyMat = mat(jersey);
  const skin = mat(0xd9a27e);
  const dark = mat(0x1a1c20);
  const up = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.CylinderGeometry(1, 1, 1, 14);

  const place = (mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const dir = b.clone().sub(a);
    const len = dir.length();
    mesh.position.copy(a).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    mesh.scale.set(r, len, r);
  };
  const tube = (a: number[], b: number[], r: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(unit, m);
    place(mesh, new THREE.Vector3(...a), new THREE.Vector3(...b), r);
    group.add(mesh);
    return mesh;
  };

  const R = [0, 0.34, -0.5];
  const F = [0, 0.34, 0.52];
  const BB = [0, 0.29, -0.08];
  const S = [0, 0.9, -0.25];
  const H = [0, 0.86, 0.36];
  tube(BB, S, 0.022, frameMat);
  tube(BB, H, 0.026, frameMat);
  tube(S, H, 0.022, frameMat);
  tube(S, R, 0.014, frameMat);
  tube(BB, R, 0.016, frameMat);
  tube(H, F, 0.018, frameMat);
  tube([0, 0.86, 0.36], [0, 0.96, 0.42], 0.018, frameMat);
  tube([-0.2, 0.96, 0.44], [0.2, 0.96, 0.44], 0.014, dark);
  tube([0, 0.9, -0.25], [0, 0.97, -0.27], 0.018, frameMat);
  tube([0, 0.975, -0.38], [0, 0.975, -0.14], 0.03, dark);

  const wheels = [R, F].map((c) => {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.021, 10, 44), dark);
    tyre.rotation.y = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 8, 44), mat(0x30343c, 0.3, 0.8));
    rim.rotation.y = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 10), mat(0xb8bcc4, 0.3, 0.8));
    hub.rotation.z = Math.PI / 2;
    w.add(tyre, rim, hub);
    const spokeMat = mat(0xc9ccd3, 0.3, 0.8);
    for (let i = 0; i < 8; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.6, 0.004), spokeMat);
      spoke.rotation.x = (i * Math.PI) / 8;
      w.add(spoke);
    }
    w.position.set(c[0], c[1], c[2]);
    group.add(w);
    return w;
  });

  // Oberkörper
  tube([0, 0.99, -0.24], [0, 1.36, 0.16], 0.115, jerseyMat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), skin);
  head.position.set(0, 1.5, 0.27);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 12, 0, Math.PI * 2, 0, Math.PI / 1.9), mat(0xf4f1ea, 0.4));
  helmet.position.set(0, 1.51, 0.26);
  helmet.rotation.x = 0.35;
  group.add(head, helmet);
  for (const s of [-1, 1]) {
    tube([s * 0.13, 1.33, 0.14], [s * 0.17, 1.12, 0.32], 0.036, jerseyMat);
    tube([s * 0.17, 1.12, 0.32], [s * 0.18, 0.98, 0.45], 0.03, skin);
  }

  // Beine: Hüfte fest, Fuß am Pedal, Knie per Zwei-Gelenk-Lösung
  const T = 0.42;
  const L = 0.45;
  const legs = [-1, 1].map((s) => ({
    s,
    thigh: new THREE.Mesh(unit, dark),
    shin: new THREE.Mesh(unit, skin),
    crank: new THREE.Mesh(unit, mat(0xb8bcc4)),
    shoe: new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.2), mat(0xf4f1ea)),
  }));
  for (const l of legs) group.add(l.thigh, l.shin, l.crank, l.shoe);

  const hip = new THREE.Vector3();
  const foot = new THREE.Vector3();
  const knee = new THREE.Vector3();
  const bb = new THREE.Vector3();
  let crankAngle = 0;

  if (!transparent) group.traverse((o) => { o.castShadow = true; });

  return {
    group,
    jerseyMat,
    update(dt: number, speed: number, cadence: number) {
      for (const w of wheels) w.rotation.x += (speed * dt) / 0.34;
      crankAngle += ((cadence * Math.PI * 2) / 60) * dt;
      for (const l of legs) {
        const a = crankAngle + (l.s > 0 ? Math.PI : 0);
        bb.set(l.s * 0.09, 0.29, -0.08);
        foot.set(l.s * 0.11, 0.29 + Math.cos(a) * 0.17, -0.08 + Math.sin(a) * 0.17);
        hip.set(l.s * 0.08, 0.99, -0.22);
        const dy = foot.y + 0.06 - hip.y;
        const dz = foot.z - hip.z;
        const raw = Math.hypot(dy, dz);
        const d = Math.min(T + L - 0.01, raw);
        const k = (T * T - L * L + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, T * T - k * k));
        // Knie nach vorn (positive z-Richtung)
        knee.set(l.s * 0.1, hip.y + (dy / raw) * k + (dz / raw) * h, hip.z + (dz / raw) * k - (dy / raw) * h);
        place(l.thigh, hip, knee, 0.062);
        place(l.shin, knee, foot.clone().setY(foot.y + 0.06), 0.042);
        place(l.crank, bb, foot, 0.012);
        l.shoe.position.set(foot.x, foot.y + 0.02, foot.z + 0.03);
      }
    },
  };
}

/** Ferne Bergkette mit fest eingemaltem Licht: Sonnenseite hell, Schattenseite blau. */
function mountainRing(sunDir: THREE.Vector3) {
  const seg = 320;
  const radii = [1250, 1380, 1540, 1730, 1950, 2200, 2500, 2850, 3250, 3700];
  const profile = [0.02, 0.16, 0.38, 0.66, 0.9, 1, 0.86, 0.6, 0.3, 0.06];
  const pos: number[] = [];
  for (let r = 0; r < radii.length; r++) {
    for (let i = 0; i <= seg; i++) {
      const a = ((i % seg) / seg) * Math.PI * 2;
      const sx = Math.sin(a);
      const cz = Math.cos(a);
      // einzelne Gipfel entlang des Kreises, dazu Grate und kleinteilige Zacken
      const peak = fbm(sx * 2.6 + 11, cz * 2.6) ** 1.4 * 900;
      const ridge = (1 - Math.abs(2 * fbm(sx * 7 + r * 0.35, cz * 7 + 3) - 1)) * 170;
      const detail = (noise(sx * 20 + r * 0.6, cz * 20) - 0.5) * 70;
      pos.push(sx * radii[r], -160 + profile[r] * (140 + peak + ridge + detail), cz * radii[r]);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < radii.length - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * (seg + 1) + i;
      const b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.getAttribute('normal');
  const col: number[] = [];
  const c = new THREE.Color();
  const n = new THREE.Vector3();
  const pal = {
    snowLit: new THREE.Color(0xffffff), snowShade: new THREE.Color(0x9cc0f5),
    rockLit: new THREE.Color(0x7d9fe0), rockShade: new THREE.Color(0x4168bd),
    woodLit: new THREE.Color(0x4fae7c), woodShade: new THREE.Color(0x2f7f88),
  };
  for (let i = 0; i < nor.count; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    if (n.y < 0) n.negate();
    const lit = smooth(0.18, 0.32, n.dot(sunDir));
    const wobble = (noise(x / 160, z / 160) - 0.5) * 170;
    const snow = smooth(330, 380, y + wobble);
    const wood = 1 - smooth(60, 170, y + wobble * 0.6);
    c.copy(pal.rockShade).lerp(pal.rockLit, lit);
    c.lerp(pal.woodShade.clone().lerp(pal.woodLit, lit), wood);
    c.lerp(pal.snowShade.clone().lerp(pal.snowLit, lit), snow);
    // nach unten und in die Ferne im Dunst verblassen
    c.lerp(HAZE, 0.1 + 0.5 * (1 - smooth(-160, 420, y)));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
}

function createWorld(el: HTMLDivElement, low: boolean) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(HAZE.getHex(), 0.0009);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 9000);

  // Himmel: gemalter Verlauf von tiefem Blau zu hellem Dunst am Horizont
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(6000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(0x1763d4) }, mid: { value: new THREE.Color(0x49a2ee) }, low: { value: HAZE.clone().lerp(new THREE.Color(0xffffff), 0.35) } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vDir; void main() { float h = max(vDir.y, 0.0); vec3 c = mix(low, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.18, 0.75, h)); gl_FragColor = vec4(c, 1.0);\n#include <colorspace_fragment>\n}',
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION), THREE.MathUtils.degToRad(SUN_AZIMUTH));
  // bläuliches Gegenlicht von unten lässt Schatten blau wirken
  scene.add(new THREE.HemisphereLight(0xeaf5ff, 0x6fa0e0, 1.45));
  const sun = new THREE.DirectionalLight(0xfff6dc, 2.0);
  sun.castShadow = true;
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
  far.add(mountainRing(sunDir));
  const cloudMaps = [1, 2, 3, 4].map((k) => cloudTexture(k * 7.3));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + hash(i, 4.2) * 0.3;
    const r = 3700 + hash(i, 9.9) * 700;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudMaps[i % 4], fog: false, transparent: true, depthWrite: false }));
    const w = 1500 + hash(i, 2.2) * 1500;
    sprite.scale.set(w, w, 1);
    sprite.position.set(Math.sin(a) * r, 250 + hash(i, 6.6) * 500 + w * 0.12, Math.cos(a) * r);
    sprite.renderOrder = -5;
    far.add(sprite);
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3400, 32), new THREE.MeshBasicMaterial({ color: HAZE.clone().lerp(C.forest, 0.45), fog: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -125;
  far.add(ground);
  scene.add(far);

  const A = makeAssets();
  const me = makeRider(0xf5a524);
  const pacer = makeRider(0x2f9fe0);
  const ghost = makeRider(0xa78bfa, 0.4);
  scene.add(me.group, pacer.group, ghost.group);

  let path: Path | null = null;
  let routeId: string | undefined = '-';
  let strip: THREE.Group | null = null;
  let stripCenter = NaN;
  let shown = { me: 0, pacer: 0, ghost: 0 };
  let seen = { dist: -1, at: 0 };
  let raf = 0;
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

  const put = (r: ReturnType<typeof makeRider>, d: number, side: number) => {
    const p = path!.at(d);
    r.group.position.set(p.x + Math.cos(p.heading) * side, p.y + 0.03, p.z - Math.sin(p.heading) * side);
    r.group.rotation.set(-Math.atan(p.grade), p.heading, 0);
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

    const center = Math.round(shown.me / 250) * 250;
    if (center !== stripCenter) {
      if (strip) {
        scene.remove(strip);
        disposeStrip(strip, A);
      }
      strip = buildStrip(path, center - 350, center + 1500, A, ride.route, low);
      scene.add(strip);
      stripCenter = center;
    }

    put(me, shown.me, -0.9);
    me.update(dt, moving ? ride.speed : 0, moving ? live.cadence : 0);
    // Trikotfarbe = aktuelle Leistungszone
    zoneColor.set(zoneOf(ride.power / profile.ftp).color);
    me.jerseyMat.color.lerp(zoneColor, 0.08);

    pacer.group.visible = !!ride.pacer;
    if (ride.pacer) {
      shown.pacer += (ride.pacer.dist - shown.pacer) * ease;
      if (Math.abs(ride.pacer.dist - shown.pacer) > 60) shown.pacer = ride.pacer.dist;
      put(pacer, shown.pacer, 0.9);
      pacer.update(dt, moving ? ride.speed : 0, moving ? 88 : 0);
    }
    ghost.group.visible = !!ride.ghost;
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
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const mt of mats) {
        (mt as THREE.MeshStandardMaterial).map?.dispose();
        mt.dispose();
      }
    });
    for (const v of Object.values(A)) (v as { dispose(): void }).dispose();
    for (const mt of [A.coniferMat, A.broadleafMat, A.tuftMat]) mt.map?.dispose();
    for (const t of cloudMaps) t.dispose();
    A.terrainMat.map?.dispose();
    A.roadMat.map?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

export function World3D({ low = false }: { low?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    try {
      return createWorld(ref.current, low);
    } catch {
      setFailed(true);
    }
  }, [low]);
  return <div ref={ref} className={`world ${failed ? 'world-flat' : ''}`} />;
}
