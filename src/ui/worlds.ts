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

/** Landschaftsabschnitte, aus denen eine Welt zusammengesetzt ist. */
export type SectionType = 'open' | 'valley' | 'forest' | 'village' | 'lake' | 'hillside' | 'bridge' | 'pass' | 'canyon';
export interface Section {
  type: SectionType;
  length: number; // m
  side?: 1 | -1; // Seite des Wassers bzw. des Abhangs (1 = rechts)
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
  hills: number; // Höhe der Berge (1 = Alpen)
  sections: Section[]; // Abfolge der Abschnitte, wiederholt sich danach
  houses: string[]; // Gebäude für Dörfer
  landmark?: string; // ein besonderes Gebäude je Dorf
  lamp?: string; // Laternen im Dorf
  water: string | null; // Textur für Seen, Flüsse und Meer
  still?: boolean; // Wasser bewegt sich nicht (Eis)
  sea?: boolean; // Wasserabschnitte sind offenes Meer bis zum Horizont
  floating?: string; // Modell, das auf dem Wasser schwimmt
  bridgeRail?: string; // eigenes Geländer für Brücken
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
    rockBand: [170, 230],
    snowBand: [150, 172],
    tuft: 0x63c22a,
    hills: 1,
    sections: [
      { type: 'open', length: 600 }, { type: 'village', length: 420 }, { type: 'forest', length: 500 }, { type: 'lake', length: 800, side: 1 },
      { type: 'hillside', length: 800, side: 1 }, { type: 'bridge', length: 170 }, { type: 'valley', length: 600 }, { type: 'open', length: 500 },
      { type: 'village', length: 320 }, { type: 'lake', length: 600, side: -1 }, { type: 'pass', length: 800 }, { type: 'bridge', length: 140 }, { type: 'forest', length: 450 },
    ],
    houses: ['hut'],
    landmark: 'chapel',
    water: 'kueste/water.png',
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
    rockBand: [90, 140],
    snowBand: null,
    tuft: 0xc9b458,
    hills: 0.55,
    sections: [
      { type: 'lake', length: 900, side: 1 }, { type: 'village', length: 480 }, { type: 'hillside', length: 800, side: 1 }, { type: 'lake', length: 500, side: 1 },
      { type: 'bridge', length: 180 }, { type: 'open', length: 500 }, { type: 'forest', length: 400 }, { type: 'village', length: 360 }, { type: 'lake', length: 1000, side: 1 },
      { type: 'pass', length: 500 }, { type: 'bridge', length: 150 }, { type: 'open', length: 450 },
    ],
    houses: ['house'],
    landmark: 'lighthouse',
    water: 'kueste/water.png',
    sea: true,
    floating: 'boat',
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
    rockBand: [220, 280],
    snowBand: null,
    tuft: 0x6cc93a,
    hills: 0.9,
    sections: [
      { type: 'village', length: 450 }, { type: 'forest', length: 550 }, { type: 'lake', length: 700, side: -1 }, { type: 'open', length: 500 },
      { type: 'bridge', length: 160 }, { type: 'hillside', length: 700, side: 1 }, { type: 'valley', length: 600 }, { type: 'village', length: 350 },
      { type: 'forest', length: 450 }, { type: 'lake', length: 600, side: 1 }, { type: 'bridge', length: 140 }, { type: 'open', length: 450 },
    ],
    houses: ['house'],
    landmark: 'shrine',
    lamp: 'lantern',
    water: 'japan/water.png',
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
    sections: [
      { type: 'open', length: 800 }, { type: 'canyon', length: 700 }, { type: 'bridge', length: 200 }, { type: 'open', length: 600 },
      { type: 'village', length: 300 }, { type: 'pass', length: 700 }, { type: 'canyon', length: 600 }, { type: 'hillside', length: 700, side: -1 },
      { type: 'bridge', length: 160 }, { type: 'open', length: 700 },
    ],
    houses: ['diner'],
    landmark: 'windmill',
    water: null,
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
    rockBand: [230, 290],
    snowBand: null,
    tuft: 0x9a9a3a,
    hills: 0.6,
    sections: [
      { type: 'forest', length: 600 }, { type: 'lake', length: 700, side: 1 }, { type: 'village', length: 380 }, { type: 'open', length: 500 },
      { type: 'bridge', length: 170 }, { type: 'forest', length: 500 }, { type: 'hillside', length: 700, side: -1 }, { type: 'valley', length: 500 },
      { type: 'lake', length: 600, side: -1 }, { type: 'village', length: 300 }, { type: 'bridge', length: 140 }, { type: 'open', length: 450 },
    ],
    houses: ['cabin'],
    water: 'japan/water.png',
    bridgeRail: 'bridge',
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
    rockBand: [170, 230],
    snowBand: null,
    tuft: null,
    hills: 1,
    sections: [
      { type: 'open', length: 600 }, { type: 'forest', length: 500 }, { type: 'lake', length: 800, side: 1 }, { type: 'village', length: 400 },
      { type: 'valley', length: 600 }, { type: 'bridge', length: 160 }, { type: 'pass', length: 800 }, { type: 'hillside', length: 700, side: 1 },
      { type: 'village', length: 300 }, { type: 'lake', length: 600, side: -1 }, { type: 'bridge', length: 140 }, { type: 'forest', length: 450 },
    ],
    houses: ['cabin'],
    lamp: 'lamp',
    water: 'winter/ice.png',
    still: true,
  },
];

export const worldByKey = (key: string | undefined) => WORLDS.find((w) => w.key === key) ?? WORLDS[0];
