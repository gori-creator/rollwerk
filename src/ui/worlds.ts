// Die Welten der 3D-Ansicht: Farben, Licht und welche Modelle wo stehen.
// Die Dateien liegen unter public/assets/<Ordner>/.

export interface PropDef {
  file: string;
  every: number; // mittlerer Abstand in m entlang der Straße
  off: [number, number]; // Abstand zur Straßenmitte in m
  count?: number; // Gruppe (z. B. Kühe)
  faceRoad?: boolean;
  overRoad?: boolean; // steht mittig über der Straße (Felsbogen)
  scale?: number;
}

export interface WorldDef {
  key: string;
  name: string;
  sky: [top: number, mid: number, low: number];
  haze: number;
  sun: number;
  hemi: [sky: number, ground: number];
  trees: { file: string; weight: number; scale?: [number, number] }[];
  treeDensity: number; // 1 = dichter Wald
  treeline: boolean; // oberhalb von ca. 1700 m keine Bäume
  bush: string;
  rocks: string[];
  rockDensity: number;
  flowers: string;
  fence: string;
  props: PropDef[];
  rockBand: [number, number]; // ab welcher Höhe über der Straße der Fels beginnt
  snowBand: [number, number] | null;
  tuft: number | null; // Farbe der Grasbüschel, null = keine
  hills: number; // Höhe der Hänge neben der Straße (1 = Alpen)
}

export const WORLDS: WorldDef[] = [
  {
    key: 'alpen',
    name: 'Alpen',
    sky: [0x1763d4, 0x49a2ee, 0xcfe9fb],
    haze: 0xa9d6f5,
    sun: 0xfff6dc,
    hemi: [0xeaf5ff, 0x6fa0e0],
    trees: [
      { file: 'tree_1', weight: 4, scale: [0.9, 1.5] },
      { file: 'tree_2', weight: 2, scale: [0.9, 1.6] },
      { file: 'tree_3', weight: 2, scale: [0.9, 1.4] },
      { file: 'tree_4', weight: 1, scale: [0.9, 1.4] },
    ],
    treeDensity: 1,
    treeline: true,
    bush: 'bush',
    rocks: ['rock_1', 'rock_2'],
    rockDensity: 0.5,
    flowers: 'flowers',
    fence: 'fence',
    props: [
      { file: 'hut', every: 700, off: [20, 36], faceRoad: true },
      { file: 'chapel', every: 2300, off: [24, 40], faceRoad: true },
      { file: 'cow', every: 450, off: [10, 28], count: 3 },
    ],
    rockBand: [105, 135],
    snowBand: [178, 192],
    tuft: 0x63c22a,
    hills: 1,
  },
  {
    key: 'kueste',
    name: 'Mittelmeerküste',
    sky: [0x1a6fe0, 0x5ab4f2, 0xdaf0fa],
    haze: 0xc2e4f6,
    sun: 0xfff2d0,
    hemi: [0xf2f8ff, 0x7fb0e0],
    trees: [
      { file: 'tree_1', weight: 3, scale: [0.9, 1.4] },
      { file: 'tree_2', weight: 3, scale: [0.9, 1.5] },
      { file: 'tree_3', weight: 3, scale: [0.9, 1.3] },
      { file: 'tree_4', weight: 2, scale: [0.9, 1.3] },
    ],
    treeDensity: 0.45,
    treeline: false,
    bush: 'bush',
    rocks: ['rock_1'],
    rockDensity: 0.8,
    flowers: 'flowers',
    fence: 'wall',
    props: [
      { file: 'house', every: 600, off: [18, 34], faceRoad: true },
      { file: 'lighthouse', every: 2600, off: [45, 70] },
    ],
    rockBand: [55, 85],
    snowBand: null,
    tuft: 0xc9b458,
    hills: 0.55,
  },
  {
    key: 'japan',
    name: 'Japan im Frühling',
    sky: [0x3f8fe0, 0x8cc4f0, 0xeef3f6],
    haze: 0xdbe8f1,
    sun: 0xfff4e4,
    hemi: [0xf6f8ff, 0x8fb4d8],
    trees: [
      { file: 'tree_1', weight: 4, scale: [0.9, 1.4] },
      { file: 'tree_2', weight: 2, scale: [0.9, 1.4] },
      { file: 'tree_3', weight: 2, scale: [0.9, 1.3] },
      { file: 'tree_4', weight: 2, scale: [1.0, 1.7] },
    ],
    treeDensity: 0.9,
    treeline: false,
    bush: 'bush',
    rocks: ['rock_1'],
    rockDensity: 0.4,
    flowers: 'flowers',
    fence: 'fence',
    props: [
      { file: 'house', every: 800, off: [20, 36], faceRoad: true },
      { file: 'shrine', every: 1500, off: [7.5, 10], faceRoad: true },
      { file: 'torii', every: 2000, off: [9, 12], faceRoad: true },
      { file: 'lantern', every: 320, off: [5.4, 6] },
    ],
    rockBand: [130, 165],
    snowBand: null,
    tuft: 0x6cc93a,
    hills: 0.9,
  },
  {
    key: 'canyon',
    name: 'Wüste und Canyon',
    sky: [0x2a6fd0, 0x7ab4e8, 0xf6e2c8],
    haze: 0xf0d2b0,
    sun: 0xffeccc,
    hemi: [0xfff3e2, 0xb08fb8],
    trees: [
      { file: 'tree_1', weight: 4, scale: [0.9, 1.6] },
      { file: 'tree_2', weight: 2, scale: [0.9, 1.4] },
      { file: 'tree_3', weight: 2, scale: [0.9, 1.3] },
    ],
    treeDensity: 0.16,
    treeline: false,
    bush: 'bush',
    rocks: ['rock_1', 'rock_2', 'rock_2'],
    rockDensity: 1.6,
    flowers: 'flowers',
    fence: 'fence',
    props: [
      { file: 'diner', every: 2600, off: [16, 22], faceRoad: true },
      { file: 'windmill', every: 1500, off: [18, 40] },
      { file: 'arch', every: 3200, off: [0, 0], overRoad: true, scale: 1.25 },
    ],
    rockBand: [22, 50],
    snowBand: null,
    tuft: 0xd2b25a,
    hills: 0.8,
  },
  {
    key: 'herbst',
    name: 'Herbstwald',
    sky: [0x3a78c8, 0x8fb8e0, 0xf6ecd2],
    haze: 0xefdcae,
    sun: 0xffe9bd,
    hemi: [0xfff4e0, 0x8f9fc8],
    trees: [
      { file: 'tree_1', weight: 3, scale: [0.9, 1.5] },
      { file: 'tree_2', weight: 3, scale: [0.9, 1.5] },
      { file: 'tree_3', weight: 3, scale: [0.9, 1.5] },
      { file: 'tree_4', weight: 2, scale: [0.9, 1.4] },
    ],
    treeDensity: 1.25,
    treeline: false,
    bush: 'bush',
    rocks: ['rock_1'],
    rockDensity: 0.4,
    flowers: 'flowers',
    fence: 'fence',
    props: [
      { file: 'cabin', every: 900, off: [20, 34], faceRoad: true },
      { file: 'deer', every: 600, off: [12, 30] },
    ],
    rockBand: [150, 190],
    snowBand: null,
    tuft: 0x9a9a3a,
    hills: 0.6,
  },
  {
    key: 'winter',
    name: 'Winterlandschaft',
    sky: [0x2f6fc4, 0x8dbcec, 0xe6f0fb],
    haze: 0xd6e6f8,
    sun: 0xfff6e8,
    hemi: [0xf4f8ff, 0x8fb0e8],
    trees: [
      { file: 'tree_1', weight: 4, scale: [0.9, 1.5] },
      { file: 'tree_2', weight: 2, scale: [0.9, 1.6] },
      { file: 'tree_3', weight: 2, scale: [0.9, 1.4] },
    ],
    treeDensity: 0.9,
    treeline: true,
    bush: 'bush',
    rocks: ['rock_1'],
    rockDensity: 0.5,
    flowers: 'flowers',
    fence: 'fence',
    props: [
      { file: 'cabin', every: 800, off: [20, 34], faceRoad: true },
      { file: 'snowman', every: 700, off: [6.5, 9], faceRoad: true },
      { file: 'lamp', every: 160, off: [5.2, 5.4] },
    ],
    rockBand: [110, 140],
    snowBand: null,
    tuft: null,
    hills: 1,
  },
];

export const worldByKey = (key: string | undefined) => WORLDS.find((w) => w.key === key) ?? WORLDS[0];
