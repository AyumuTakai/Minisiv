export const VERSION = '1.0.0';

export const TILE_SIZE = 50;
export const MAP_W = 16;
export const MAP_H = 11;
export const TOP_BAR_H = 50;
export const MAP_AREA_W = MAP_W * TILE_SIZE;   // 800
export const MAP_AREA_H = MAP_H * TILE_SIZE;   // 550
export const PANEL_X = MAP_AREA_W;
export const PANEL_W = 400;
export const CANVAS_W = MAP_AREA_W + PANEL_W;  // 1200
export const CANVAS_H = TOP_BAR_H + MAP_AREA_H; // 600

export const TERRAIN = {
  WATER:     { color: 0x1565c0, dark: 0x0d47a1, name: 'Water',     food: 0, prod: 0, gold: 0, passable: false, moveCost: 99 },
  GRASSLAND: { color: 0x388e3c, dark: 0x2e7d32, name: 'Grassland', food: 2, prod: 0, gold: 0, passable: true,  moveCost: 1 },
  PLAINS:    { color: 0xf9a825, dark: 0xf57f17, name: 'Plains',    food: 1, prod: 1, gold: 0, passable: true,  moveCost: 1 },
  HILLS:     { color: 0x6d4c41, dark: 0x4e342e, name: 'Hills',     food: 0, prod: 2, gold: 0, passable: true,  moveCost: 2 },
  FOREST:    { color: 0x1b5e20, dark: 0x145214, name: 'Forest',    food: 1, prod: 1, gold: 0, passable: true,  moveCost: 2 },
  MOUNTAIN:  { color: 0x546e7a, dark: 0x37474f, name: 'Mountain',  food: 0, prod: 0, gold: 0, passable: false, moveCost: 99 },
  DESERT:    { color: 0xfdd835, dark: 0xf9a825, name: 'Desert',    food: 0, prod: 0, gold: 1, passable: true,  moveCost: 1 },
  SNOW:      { color: 0xe0e0e0, dark: 0xbdbdbd, name: 'Tundra',    food: 0, prod: 0, gold: 0, passable: true,  moveCost: 2 },
};

export const UNITS = {
  WARRIOR:  { name: 'Warrior',  cost: 40,  maxHp: 100, atk: 20, def: 20, mov: 2, range: 1, upkeep: 1, sym: 'W', tech: null },
  ARCHER:   { name: 'Archer',   cost: 50,  maxHp: 80,  atk: 28, def: 12, mov: 2, range: 2, upkeep: 1, sym: 'A', tech: 'archery' },
  SETTLER:  { name: 'Settler',  cost: 80,  maxHp: 50,  atk: 0,  def: 5,  mov: 2, range: 0, upkeep: 0, sym: 'S', tech: null, canSettle: true },
  SPEARMAN: { name: 'Spearman', cost: 65,  maxHp: 100, atk: 30, def: 28, mov: 2, range: 1, upkeep: 1, sym: 'P', tech: 'bronze_working' },
  KNIGHT:   { name: 'Knight',   cost: 100, maxHp: 120, atk: 46, def: 32, mov: 4, range: 1, upkeep: 2, sym: 'K', tech: 'horseback_riding' },
};

export const BUILDINGS = {
  GRANARY:  { name: 'Granary',  cost: 60, food: 2, prod: 0, gold: 0, science: 0, tech: 'pottery' },
  WORKSHOP: { name: 'Workshop', cost: 80, food: 0, prod: 2, gold: 0, science: 0, tech: null },
  MARKET:   { name: 'Market',   cost: 80, food: 0, prod: 0, gold: 3, science: 0, tech: null },
  BARRACKS: { name: 'Barracks', cost: 80, food: 0, prod: 0, gold: 0, science: 0, tech: 'bronze_working' },
  LIBRARY:  { name: 'Library',  cost: 80, food: 0, prod: 0, gold: 0, science: 2, tech: 'writing' },
};

export const TECHS = {
  pottery:          { name: 'Pottery',          cost: 35,  req: [],                   unlocks: ['GRANARY'] },
  animal_husbandry: { name: 'Animal Husbandry', cost: 40,  req: [],                   unlocks: [] },
  archery:          { name: 'Archery',           cost: 40,  req: [],                   unlocks: ['ARCHER'] },
  bronze_working:   { name: 'Bronze Working',    cost: 65,  req: [],                   unlocks: ['SPEARMAN', 'BARRACKS'] },
  writing:          { name: 'Writing',           cost: 80,  req: ['pottery'],          unlocks: ['LIBRARY'] },
  horseback_riding: { name: 'Horseback Riding',  cost: 100, req: ['animal_husbandry'], unlocks: ['KNIGHT'] },
  iron_working:     { name: 'Iron Working',      cost: 100, req: ['bronze_working'],   unlocks: [] },
  currency:         { name: 'Currency',          cost: 80,  req: ['bronze_working'],   unlocks: ['MARKET'] },
  mathematics:      { name: 'Mathematics',       cost: 120, req: ['writing'],          unlocks: [] },
};

export const CIV_DATA = [
  { name: 'Greece', color: 0x1e88e5, unitBg: 0x1565c0 },
  { name: 'Rome',   color: 0xe53935, unitBg: 0xb71c1c },
];

export const CITY_NAMES = {
  Greece: ['Athens', 'Sparta', 'Corinth', 'Thebes', 'Argos'],
  Rome:   ['Rome',   'Antium', 'Capua',   'Cumae',  'Neapolis'],
};

export const MAX_TECHS_WIN = 7;
export const MAX_TURNS = 100;
