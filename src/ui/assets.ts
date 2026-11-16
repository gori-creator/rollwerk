// Laden der Modelle (GLB) und Bilder aus public/assets, mit Zwischenspeicher.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Model {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
  size: THREE.Vector3;
}

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const modelCache = new Map<string, Promise<Model | null>>();
const texCache = new Map<string, Promise<THREE.Texture | null>>();

/** Lädt ein Modell (eine Fläche, ein Material). Fehlt die Datei, kommt null zurück. */
export function loadModel(path: string): Promise<Model | null> {
  let p = modelCache.get(path);
  if (!p) {
    p = gltfLoader
      .loadAsync(`/assets/${path}.glb`)
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        let mesh: THREE.Mesh | null = null;
        gltf.scene.traverse((o) => {
          if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh;
        });
        if (!mesh) return null;
        const m = mesh as THREE.Mesh;
        const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
        geometry.computeBoundingBox();
        const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
        if (src.map) src.map.anisotropy = 4;
        // gemalte Texturen brauchen kein aufwendiges Material
        const material = new THREE.MeshLambertMaterial({ map: src.map ?? null, color: src.map ? 0xffffff : src.color });
        return { geometry, material, size: geometry.boundingBox!.getSize(new THREE.Vector3()) };
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

