// Laden der Modelle (GLB) und Bilder aus public/assets, mit Zwischenspeicher.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Model {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[];
  map: THREE.Texture | null; // erste Textur des Modells
  size: THREE.Vector3;
}

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const modelCache = new Map<string, Promise<Model | null>>();
const texCache = new Map<string, Promise<THREE.Texture | null>>();

/**
 * Lädt ein Modell. Besteht es aus mehreren Teilen mit eigenen Texturen (z. B. Wände,
 * Dach und Fenster), werden sie zu einer Geometrie mit mehreren Materialien verbunden.
 * Fehlt die Datei, kommt null zurück.
 */
export function loadModel(path: string): Promise<Model | null> {
  let p = modelCache.get(path);
  if (!p) {
    p = gltfLoader
      .loadAsync(`/assets/${path}.glb`)
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const parts: THREE.BufferGeometry[] = [];
        const materials: THREE.MeshLambertMaterial[] = [];
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
          // nur die Angaben behalten, die alle Teile haben, sonst lassen sie sich nicht verbinden
          for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
          if (!g.getAttribute('normal')) g.computeVertexNormals();
          if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
          parts.push(g.index ? g.toNonIndexed() : g);
          const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
          if (src.map) src.map.anisotropy = 4;
          // gemalte Texturen brauchen kein aufwendiges Material
          materials.push(new THREE.MeshLambertMaterial({ map: src.map ?? null, color: src.map ? 0xffffff : src.color }));
        });
        if (!parts.length) return null;
        const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, true);
        if (!geometry) return null;
        geometry.computeBoundingBox();
        return {
          geometry,
          material: materials.length === 1 ? materials[0] : materials,
          map: materials.find((m) => m.map)?.map ?? null,
          size: geometry.boundingBox!.getSize(new THREE.Vector3()),
        };
      })
      .catch(() => null);
    modelCache.set(path, p);
  }
  return p;
}

export function loadTexture(path: string, repeat = false): Promise<THREE.Texture | null> {
  let p = texCache.get(path);
  if (!p) {
    p = texLoader
      .loadAsync(`/assets/${path}`)
      .then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        return t;
      })
      .catch(() => null);
    texCache.set(path, p);
  }
  return p;
}

