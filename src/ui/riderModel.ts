// Fahrer und Rad aus den Modellen in public/assets/common.
// Das Fahrermodell steht starr in A-Pose und hat kein Skelett. Hier bekommt es
// eines: Jeder Punkt wird dem nächstgelegenen Körperteil zugeordnet, danach
// lässt sich der Fahrer aufs Rad setzen und tritt passend zur Kadenz.
import * as THREE from 'three';
import { loadModel, type Model } from './assets';

export interface RiderParts {
  rider: THREE.BufferGeometry; // mit Skelett-Gewichten
  riderMap: THREE.Texture | null;
  frame: Model;
  wheel: Model;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const RIDER_SCALE = 1.05;
const BIKE_SCALE = 0.93;
const WHEEL_R = 0.34 * BIKE_SCALE;
// Maße des Rahmenmodells (Modellkoordinaten: x nach vorn, y nach oben)
const FRAME = { dropoutY: 0.223, rearX: -0.503, frontX: 0.519, bbX: -0.102, bbY: 0.182, saddleX: -0.235, saddleY: 0.859, hoodX: 0.5, hoodY: 0.775, hoodZ: 0.19 };
const LIFT = WHEEL_R - FRAME.dropoutY * BIKE_SCALE;
const bikeY = (y: number) => y * BIKE_SCALE + LIFT;
const BB = V(0, bikeY(FRAME.bbY), FRAME.bbX * BIKE_SCALE);
const CRANK = 0.165 * BIKE_SCALE;

// Gelenke des Fahrermodells in A-Pose (y nach oben, Blick nach +z), bereits skaliert
const J = (() => {
  const k = RIDER_SCALE;
  const side = (x: number, y: number, z = 0) => [V(-x * k, y * k, z * k), V(x * k, y * k, z * k)];
  return {
    hipCentre: V(0, 0.88 * k, 0),
    crotchY: 0.78 * k,
    spine: V(0, 0.935 * k, 0),
    chest: V(0, 1.15 * k, 0),
    neck: V(0, 1.47 * k, 0),
    headTop: V(0, 1.8 * k, 0),
    hip: side(0.095, 0.88),
    knee: side(0.15, 0.53),
    ankle: side(0.185, 0.09),
    toe: side(0.185, 0.03, 0.13),
    shoulder: side(0.18, 1.41),
    elbow: side(0.34, 1.18),
    wrist: side(0.477, 0.96),
    hand: side(0.51, 0.87),
  };
})();

interface BoneDef {
  name: string;
  a: THREE.Vector3; // Anfang (Drehpunkt)
  b: THREE.Vector3; // Ende
  r: number; // ungefähre Dicke des Körperteils
  side: number; // -1 / +1 für Arme und Beine, 0 für die Mitte
  tint: boolean; // gehört zum Trikot
}

const BONES: BoneDef[] = [
  { name: 'pelvis', a: J.hipCentre.clone().setY(J.hipCentre.y - 0.06), b: J.hipCentre.clone().setY(J.spine.y), r: 0.19, side: 0, tint: true },
  { name: 'spine', a: J.spine, b: J.chest, r: 0.18, side: 0, tint: true },
  { name: 'chest', a: J.chest, b: J.neck, r: 0.2, side: 0, tint: true },
  { name: 'head', a: J.neck, b: J.headTop, r: 0.14, side: 0, tint: false },
  ...[0, 1].flatMap((i): BoneDef[] => {
    const s = i ? 1 : -1;
    return [
      // Hilfsteile an Hüfte und Schulter drehen nur halb mit; so öffnet sich dort kein Spalt
      { name: `hipfix${i}`, a: J.hip[i], b: J.hip[i].clone().lerp(J.knee[i], 0.3), r: 0.13, side: s, tint: true },
      { name: `shfix${i}`, a: J.shoulder[i], b: J.shoulder[i].clone().lerp(J.elbow[i], 0.35), r: 0.085, side: s, tint: true },
      { name: `uarm${i}`, a: J.shoulder[i], b: J.elbow[i], r: 0.07, side: s, tint: true },
      { name: `farm${i}`, a: J.elbow[i], b: J.hand[i], r: 0.055, side: s, tint: true },
      { name: `thigh${i}`, a: J.hip[i], b: J.knee[i], r: 0.1, side: s, tint: false },
      { name: `shin${i}`, a: J.knee[i], b: J.ankle[i], r: 0.07, side: s, tint: false },
      { name: `foot${i}`, a: J.ankle[i], b: J.toe[i], r: 0.075, side: s, tint: false },
    ];
  }),
];
const index = (name: string) => BONES.findIndex((b) => b.name === name);
const ADJACENT = new Set<string>();
for (const [a, b] of [
  ['pelvis', 'spine'], ['spine', 'chest'], ['chest', 'head'],
  ['chest', 'shfix0'], ['chest', 'shfix1'], ['shfix0', 'uarm0'], ['shfix1', 'uarm1'], ['uarm0', 'farm0'], ['uarm1', 'farm1'],
  ['pelvis', 'hipfix0'], ['pelvis', 'hipfix1'], ['hipfix0', 'thigh0'], ['hipfix1', 'thigh1'], ['hipfix0', 'hipfix1'], ['thigh0', 'shin0'], ['thigh1', 'shin1'], ['shin0', 'foot0'], ['shin1', 'foot1'],
]) {
  ADJACENT.add(`${a}|${b}`);
  ADJACENT.add(`${b}|${a}`);
}

function segmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/** Ordnet jeden Punkt des Modells ein bis zwei Körperteilen zu. */
function rig(source: THREE.BufferGeometry) {
  const g = source.clone().scale(RIDER_SCALE, RIDER_SCALE, RIDER_SCALE);
  const pos = g.getAttribute('position');
  const n = pos.count;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  const tint = new Float32Array(n);
  const zone = new Float32Array(n * 2); // x: Hosenbereich, y: Trikotbereich
  const p = new THREE.Vector3();
  const scores = new Float32Array(BONES.length);
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    let best = 0;
    BONES.forEach((bone, bi) => {
      scores[bi] = segmentDistance(p, bone.a, bone.b) / bone.r;
      if (scores[bi] < scores[best]) best = bi;
    });
    // der nächste Körperteil plus seine Nachbarn teilen sich den Punkt; das ergibt weiche Gelenke
    const cand = [best];
    BONES.forEach((bone, bi) => {
      if (bi !== best && ADJACENT.has(`${BONES[best].name}|${bone.name}`)) cand.push(bi);
    });
    cand.sort((a, b) => scores[a] - scores[b]);
    const top = cand.slice(0, 3);
    const w = top.map((bi) => 1 / (scores[bi] ** 3 + 1e-4));
    const sum = w.reduce((a, b) => a + b, 0);
    let t = 0;
    top.forEach((bi, k) => {
      skinIndex[i * 4 + k] = bi;
      skinWeight[i * 4 + k] = w[k] / sum;
      if (BONES[bi].tint) t += w[k] / sum;
    });
    tint[i] = t;
    // Bereiche, in denen keine Haut zu sehen sein darf (in der A-Pose verdeckte Stellen sind falsch bemalt)
    const k = RIDER_SCALE;
    const ax = Math.abs(p.x);
    if (p.y > 0.71 * k && p.y < 1.0 * k && ax < 0.24 * k) zone[i * 2] = 1;
    else if (p.y >= 1.0 * k && p.y < 1.42 * k && ax < 0.27 * k) zone[i * 2 + 1] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 1));
  g.setAttribute('aZone', new THREE.Float32BufferAttribute(zone, 2));
  return g;
}

/** Entfernt die starren Kurbeln und Pedale aus dem Rahmenmodell; sie werden beweglich neu gebaut. */
function stripCranks(source: THREE.BufferGeometry) {
  const g = source.index ? source.toNonIndexed() : source.clone();
  const pos = g.getAttribute('position');
  const keep: number[] = [];
  const inCrank = (i: number) => {
    const dx = pos.getX(i) - FRAME.bbX;
    const dy = pos.getY(i) - FRAME.bbY;
    const d = Math.hypot(dx, dy);
    return Math.abs(pos.getZ(i)) > 0.035 && Math.abs(dx) < 0.07 && d > 0.092 && d < 0.24;
  };
  for (let t = 0; t < pos.count; t += 3) {
    if (!(inCrank(t) && inCrank(t + 1) && inCrank(t + 2))) keep.push(t, t + 1, t + 2);
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const src = g.getAttribute(name);
    const arr = new Float32Array(keep.length * src.itemSize);
    keep.forEach((vi, k) => {
      for (let c = 0; c < src.itemSize; c++) arr[k * src.itemSize + c] = src.getComponent(vi, c);
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, src.itemSize));
  }
  return out;
}

let partsPromise: Promise<RiderParts | null> | null = null;
export function loadRiderParts(): Promise<RiderParts | null> {
  partsPromise ??= Promise.all([loadModel('common/rider'), loadModel('common/bike_frame'), loadModel('common/wheel')]).then(([rider, frame, wheel]) => {
    if (!rider || !frame || !wheel) return null;
    return { rider: rig(rider.geometry), riderMap: rider.map, frame: { ...frame, geometry: stripCranks(frame.geometry) }, wheel };
  });
  return partsPromise;
}

const X = V(1, 0, 0);
const rotX = (deg: number) => new THREE.Quaternion().setFromAxisAngle(X, THREE.MathUtils.degToRad(deg));

/** Zwei-Gelenk-Lösung: liefert das Mittelgelenk (Knie/Ellbogen) zwischen Anfang und Ziel. */
function midJoint(start: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3) {
  const dir = target.clone().sub(start);
  const raw = dir.length();
  const d = Math.min(l1 + l2 - 0.005, Math.max(Math.abs(l1 - l2) + 0.005, raw));
  dir.normalize();
  const k = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - k * k));
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return { mid: start.clone().addScaledVector(dir, k).addScaledVector(perp, h), end: start.clone().addScaledVector(dir, d) };
}

export function makeAssetRider(parts: RiderParts, jersey: number, opacity: number) {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const transparent = opacity < 1;
  const shadow = !transparent;

  // ----- Rad -----
  const fadeOne = (m: THREE.Material) => {
    const c = m.clone();
    c.transparent = true;
    c.opacity = opacity;
    return c;
  };
  const fade = (m: THREE.Material | THREE.Material[]) => (!transparent ? m : Array.isArray(m) ? m.map(fadeOne) : fadeOne(m));
  const bike = new THREE.Group();
  bike.rotation.y = -Math.PI / 2; // Modell zeigt nach +x, gefahren wird nach +z
  bike.scale.setScalar(BIKE_SCALE);
  bike.position.y = LIFT;
  const frame = new THREE.Mesh(parts.frame.geometry, fade(parts.frame.material));
  frame.castShadow = shadow;
  bike.add(frame);
  group.add(bike);

  const wheelMat = fade(parts.wheel.material);
  const wheels = [FRAME.rearX, FRAME.frontX].map((x) => {
    const w = new THREE.Group();
    const mesh = new THREE.Mesh(parts.wheel.geometry, wheelMat);
    // Radmodell steht mit der Unterkante am Boden: auf die Achse zentrieren, dann quer stellen
    mesh.position.y = -parts.wheel.size.y / 2;
    const turn = new THREE.Group();
    turn.rotation.y = -Math.PI / 2;
    turn.scale.setScalar(BIKE_SCALE);
    turn.add(mesh);
    mesh.castShadow = shadow;
    w.add(turn);
    w.position.set(0, WHEEL_R, x * BIKE_SCALE);
    group.add(w);
    return w;
  });

  const metal = new THREE.MeshLambertMaterial({ color: 0x2b2f38, transparent, opacity });
  const cranks = new THREE.Group();
  cranks.position.copy(BB);
  const pedals: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, CRANK, 0.028), metal);
    arm.position.set(s * 0.075, (s * CRANK) / 2, 0);
    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.016, 0.07), metal);
    pedal.position.set(s * 0.125, s * CRANK, 0);
    arm.castShadow = pedal.castShadow = shadow;
    cranks.add(arm, pedal);
    pedals.push(pedal);
  }
  group.add(cranks);

  // ----- Fahrer -----
  const tintColor = { value: new THREE.Color(jersey) };
  const skin = new THREE.MeshLambertMaterial({ map: parts.riderMap, transparent, opacity });
  skin.onBeforeCompile = (shader) => {
    shader.uniforms.tintColor = tintColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;\nattribute vec2 aZone;\nvarying float vTint;\nvarying vec2 vZone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = aTint;\nvZone = aZone;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 tintColor;\nvarying float vTint;\nvarying vec2 vZone;')
      .replace(
        '#include <map_fragment>',
        // nur die weißen Flächen des Trikots einfärben, Haut und Hose bleiben
        '#include <map_fragment>\nfloat skinLike = step(0.45, diffuseColor.r) * step(0.1, diffuseColor.r - diffuseColor.b) * step(diffuseColor.b, diffuseColor.g + 0.02);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.035, 0.045), skinLike * step(0.5, vZone.x));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86), skinLike * step(0.5, vZone.y));\nfloat white = smoothstep(0.5, 0.75, min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b));\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * tintColor, white * vTint);',
      );
  };
  const bones = BONES.map((b) => {
    const bone = new THREE.Bone();
    bone.position.copy(b.a);
    return bone;
  });
  const body = new THREE.SkinnedMesh(parts.rider, skin);
  const rigRoot = new THREE.Group();
  for (const b of bones) rigRoot.add(b);
  rigRoot.add(body);
  group.add(rigRoot);
  rigRoot.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(bones, BONES.map((b) => new THREE.Matrix4().makeTranslation(-b.a.x, -b.a.y, -b.a.z))), new THREE.Matrix4());
  body.frustumCulled = false;
  body.castShadow = shadow;

  const bi = Object.fromEntries(BONES.map((b, i) => [b.name, i])) as Record<string, number>;
  /** Setzt ein Körperteil: Drehpunkt an neue Stelle, Drehung q. Liefert eine Funktion, die Punkte der A-Pose mitnimmt. */
  const setBone = (name: string, at: THREE.Vector3, q: THREE.Quaternion) => {
    const bone = bones[bi[name]];
    bone.position.copy(at);
    bone.quaternion.copy(q);
    const origin = BONES[bi[name]].a;
    return (v: THREE.Vector3) => v.clone().sub(origin).applyQuaternion(q).add(at);
  };
  const aim = (name: string, from: THREE.Vector3, to: THREE.Vector3) => {
    const def = BONES[bi[name]];
    const q = new THREE.Quaternion().setFromUnitVectors(def.b.clone().sub(def.a).normalize(), to.clone().sub(from).normalize());
    setBone(name, from, q);
    return q;
  };

  const thighLen = J.hip[0].distanceTo(J.knee[0]);
  const shinLen = J.knee[0].distanceTo(J.ankle[0]);
  const upperLen = J.shoulder[0].distanceTo(J.elbow[0]);
  const foreLen = J.elbow[0].distanceTo(J.wrist[0]) + 0.05;
  const saddle = V(0, bikeY(FRAME.saddleY), FRAME.saddleX * BIKE_SCALE);
  const hipSeat = V(0, saddle.y + (J.hipCentre.y - J.crotchY) - 0.01, saddle.z + 0.03);

  let crankAngle = 0.6;
  let sway = 0;

  const pose = (cadence: number) => {
    // Becken auf dem Sattel, Oberkörper nach vorn zum Lenker gebeugt
    const rock = Math.sin(crankAngle) * Math.min(1, cadence / 80) * 0.012;
    const pelvisQ = rotX(20).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rock * 2));
    const pelvis = setBone('pelvis', hipSeat, pelvisQ);
    const spine = setBone('spine', pelvis(J.spine), rotX(44));
    const chestQ = rotX(63);
    const chest = setBone('chest', spine(J.chest), chestQ);
    setBone('head', chest(J.neck), rotX(22));

    for (const i of [0, 1]) {
      const s = i ? 1 : -1;
      // Beine: Fuß folgt dem Pedal, das Knie ergibt sich
      const a = crankAngle + (i ? 0 : Math.PI);
      const pedal = V(s * 0.125, BB.y + Math.cos(a) * CRANK, BB.z + Math.sin(a) * CRANK);
      const ankle = pedal.clone().add(V(-s * 0.005, 0.105, -0.05));
      const hip = pelvis(J.hip[i]);
      const leg = midJoint(hip, ankle, thighLen, shinLen, V(s * 0.12, 0.2, 1));
      const thighQ = aim(`thigh${i}`, hip, leg.mid);
      setBone(`hipfix${i}`, hip, pelvisQ.clone().slerp(thighQ, 0.5));
      aim(`shin${i}`, leg.mid, leg.end);
      // Fußspitze zeigt nach vorn, unten leicht gestreckt
      const toeDrop = 0.22 + 0.12 * Math.cos(a);
      aim(`foot${i}`, leg.end, leg.end.clone().add(V(0, -toeDrop, 1)));

      // Arme: Hände an den Bremsgriffen
      const shoulder = chest(J.shoulder[i]);
      const grip = V(s * FRAME.hoodZ * BIKE_SCALE, bikeY(FRAME.hoodY) + 0.05, FRAME.hoodX * BIKE_SCALE - 0.02);
      const arm = midJoint(shoulder, grip, upperLen, foreLen, V(s * 0.9, -0.5, -0.3));
      const armQ = aim(`uarm${i}`, shoulder, arm.mid);
      setBone(`shfix${i}`, shoulder, chestQ.clone().slerp(armQ, 0.5));
      aim(`farm${i}`, arm.mid, arm.end);
    }
  };
  pose(0);

  return {
    group,
    setColor(c: THREE.Color) {
      tintColor.value.lerp(c, 0.08);
    },
    update(dt: number, speed: number, cadence: number) {
      for (const w of wheels) w.rotation.x += (speed * dt) / WHEEL_R;
      crankAngle += ((cadence * Math.PI * 2) / 60) * dt;
      cranks.rotation.x = crankAngle;
      for (const p of pedals) p.rotation.x = -crankAngle;
      sway += dt;
      pose(cadence);
    },
  };
}
