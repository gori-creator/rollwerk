// Einfacher Fahrer aus Grundkörpern – Rückfall, falls die 3D-Modelle nicht geladen werden können.
import * as THREE from 'three';

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
export const toon = (params: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...params });

/** Stilisierter Radfahrer aus Grundkörpern, mit tretenden Beinen. */
export function makeRider(jersey: number, opacity = 1) {
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

