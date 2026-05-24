import { TERRAIN, UNITS, BUILDINGS, TECHS, CIV_DATA, CITY_NAMES, MAP_W, MAP_H, MAX_TECHS_WIN } from './data.js';

let _nextId = 1;
const uid = () => _nextId++;

// --- Noise / terrain generation ---

function hash(x, y, seed) {
  let h = (seed * 1000003 + x * 374761393 + y * 1234567) | 0;
  h ^= h >>> 13; h = (Math.imul(h, 0x45d9f3b)) | 0;
  h ^= h >>> 15; h = (Math.imul(h, 0x45d9f3b)) | 0;
  h ^= h >>> 16;
  return (h & 0x7fffffff) / 0x7fffffff;
}

function smoothNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi,   yi,   seed);
  const b = hash(xi+1, yi,   seed);
  const c = hash(xi,   yi+1, seed);
  const d = hash(xi+1, yi+1, seed);
  return a + (b-a)*u + (c-a)*v + (a-b-c+d)*u*v;
}

function fractal(x, y, seed, scale = 0.18, octaves = 4) {
  let v = 0, amp = 0.5, freq = scale;
  for (let o = 0; o < octaves; o++) {
    v += smoothNoise(x * freq, y * freq, seed + o * 137) * amp;
    amp *= 0.5; freq *= 2;
  }
  return Math.min(1, Math.max(0, v));
}

function generateTiles(seed) {
  const tiles = [];
  for (let y = 0; y < MAP_H; y++) {
    tiles[y] = [];
    for (let x = 0; x < MAP_W; x++) {
      const elev = fractal(x, y, seed, 0.18, 4);
      const moist = fractal(x, y, seed + 9999, 0.2, 3);

      // Edge water bias
      const edgeDist = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
      const adjElev = elev - Math.max(0, (1 - edgeDist) * 0.18);

      let type;
      if (adjElev < 0.30) type = 'WATER';
      else if (adjElev > 0.78) type = 'MOUNTAIN';
      else if (adjElev > 0.64) type = 'HILLS';
      else if (moist > 0.62) type = 'FOREST';
      else if (moist < 0.36) type = adjElev < 0.5 ? 'DESERT' : 'PLAINS';
      else type = moist > 0.50 ? 'GRASSLAND' : 'PLAINS';

      if ((y <= 0 || y >= MAP_H - 1) && type !== 'WATER') type = 'SNOW';

      tiles[y][x] = { type, x, y, owner: -1, unitId: null, cityId: null, revealed: [false, false] };
    }
  }
  return tiles;
}

function neighbors4(x, y) {
  return [[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(
    ([nx,ny]) => nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H
  );
}

function findStartPositions(tiles, count) {
  const candidates = [];
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      const t = tiles[y][x];
      if (!TERRAIN[t.type].passable) continue;
      const adj = neighbors4(x, y);
      if (adj.filter(([nx,ny]) => TERRAIN[tiles[ny][nx].type].passable).length >= 3)
        candidates.push([x, y]);
    }
  }
  const minDist = Math.floor(Math.min(MAP_W, MAP_H) * 0.55);
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  const chosen = [];
  for (const [cx, cy] of shuffled) {
    if (chosen.every(([px, py]) => Math.hypot(cx - px, cy - py) >= minDist)) {
      chosen.push([cx, cy]);
      if (chosen.length === count) break;
    }
  }
  if (chosen.length < count) {
    for (const [cx, cy] of shuffled) {
      if (!chosen.some(([px, py]) => px === cx && py === cy)) {
        chosen.push([cx, cy]);
        if (chosen.length === count) break;
      }
    }
  }
  return chosen;
}

// BFS movement range → Map<"x,y", {x,y,movesLeft}>
function bfsMove(tiles, sx, sy, maxMoves, civIdx, units) {
  const reach = new Map();
  const queue = [{ x: sx, y: sy, ml: maxMoves }];
  const seen = new Set([`${sx},${sy}`]);
  reach.set(`${sx},${sy}`, { x: sx, y: sy, movesLeft: maxMoves });

  while (queue.length) {
    const cur = queue.shift();
    for (const [nx, ny] of neighbors4(cur.x, cur.y)) {
      const key = `${nx},${ny}`;
      const tile = tiles[ny][nx];
      const ter = TERRAIN[tile.type];
      if (!ter.passable) continue;

      const existingUnit = tile.unitId ? units.find(u => u.id === tile.unitId) : null;
      if (existingUnit && existingUnit.civIndex === civIdx) continue; // friendly blocks

      const newMl = cur.ml - ter.moveCost;
      if (newMl < 0) continue;

      if (!seen.has(key)) {
        seen.add(key);
        reach.set(key, { x: nx, y: ny, movesLeft: newMl });
        if (!existingUnit) queue.push({ x: nx, y: ny, ml: newMl }); // can't move through enemies
      }
    }
  }
  return reach;
}

function calcDamage(atk, def) {
  const ratio = atk / (atk + def);
  return Math.round(ratio * 32 * (0.8 + Math.random() * 0.4));
}

// --- GameState ---

export class GameState {
  constructor(seed = (Math.random() * 99999) | 0, savedData = null) {
    if (savedData) {
      this._initFromSave(savedData);
      return;
    }
    this.tiles = generateTiles(seed);
    this.civs = [];
    this.units = [];
    this.cities = [];
    this.turn = 1;
    this.gameOver = false;
    this.winner = -1;
    this.log = [];

    const positions = findStartPositions(this.tiles, 2);
    for (let i = 0; i < 2; i++) {
      const cd = CIV_DATA[i];
      this.civs.push({
        index: i, name: cd.name, color: cd.color, unitBg: cd.unitBg,
        isPlayer: i === 0,
        gold: 10, science: 0,
        techs: [],
        currentTech: null,
        cityNameIdx: 0,
        panelMode: 'overview',  // used by renderer
      });
      if (i < positions.length) {
        const [sx, sy] = positions[i];
        this.foundCity(i, sx, sy, true);
        this.createUnit(i, 'WARRIOR', sx + (i === 0 ? 1 : -1), sy);
        this.createUnit(i, 'WARRIOR', sx, sy + (i === 0 ? 1 : -1));
      }
    }
    for (const civ of this.civs) {
      for (const u of this.units.filter(u => u.civIndex === civ.index))
        this.revealAround(u.x, u.y, 2, civ.index);
      for (const c of this.cities.filter(c => c.civIndex === civ.index))
        this.revealAround(c.x, c.y, 3, civ.index);
    }
  }

  _initFromSave(data) {
    this.tiles  = data.tiles;
    this.civs   = data.civs;
    this.units  = data.units;
    this.cities = data.cities;
    this.turn     = data.turn;
    this.gameOver = data.gameOver;
    this.winner   = data.winner;
    this.log      = data.log ?? [];
    // Restore ID counter above any existing IDs to avoid collisions
    const ids = [...this.units.map(u => u.id), ...this.cities.map(c => c.id)];
    if (ids.length) _nextId = Math.max(...ids) + 1;
  }

  save() {
    return JSON.stringify({
      tiles:    this.tiles,
      civs:     this.civs,
      units:    this.units,
      cities:   this.cities,
      turn:     this.turn,
      gameOver: this.gameOver,
      winner:   this.winner,
      log:      this.log,
    });
  }

  static load(json) {
    return new GameState(undefined, JSON.parse(json));
  }

  get player() { return this.civs[0]; }

  addLog(msg) {
    this.log.unshift(msg);
    if (this.log.length > 8) this.log.pop();
  }

  revealAround(x, y, r, civIdx) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H)
          this.tiles[ny][nx].revealed[civIdx] = true;
      }
  }

  claimTerritory(civIdx, cx, cy, r = 1) {
    const claimed = [];
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const tile = this.tiles[ny][nx];
        if (tile.owner === -1) { tile.owner = civIdx; claimed.push({ x: nx, y: ny }); }
        else if (tile.owner === civIdx) { claimed.push({ x: nx, y: ny }); }
      }
    return claimed;
  }

  foundCity(civIdx, x, y, isCapital = false) {
    const civ = this.civs[civIdx];
    const names = CITY_NAMES[civ.name];
    const name = names[civ.cityNameIdx % names.length];
    civ.cityNameIdx++;

    const tile = this.tiles[y][x];
    const city = {
      id: uid(), name, civIndex: civIdx, x, y, isCapital,
      population: 1, food: 0, foodTarget: 15,
      production: 0, productionQueue: null,
      buildings: [],
      territory: this.claimTerritory(civIdx, x, y, 1),
      hp: 100, maxHp: 100,
    };
    this.cities.push(city);
    tile.cityId = city.id;
    tile.owner = civIdx;
    return city;
  }

  createUnit(civIdx, type, x, y) {
    // Find empty passable tile near (x,y)
    const candidates = [[x, y], ...neighbors4(x, y), ...(
      (() => { const r = []; for (let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) r.push([x+dx,y+dy]); return r; })()
    )];
    let placed = null;
    for (const [cx, cy] of candidates) {
      if (cx < 0 || cy < 0 || cx >= MAP_W || cy >= MAP_H) continue;
      const t = this.tiles[cy][cx];
      if (!TERRAIN[t.type].passable || t.unitId || t.cityId) continue;
      placed = [cx, cy]; break;
    }
    if (!placed) return null;
    const [px, py] = placed;
    const def = UNITS[type];
    const unit = {
      id: uid(), type, civIndex: civIdx, x: px, y: py,
      hp: def.maxHp, maxHp: def.maxHp,
      movesLeft: def.mov, hasActed: false,
    };
    this.units.push(unit);
    this.tiles[py][px].unitId = unit.id;
    this.revealAround(px, py, 2, civIdx);
    return unit;
  }

  removeUnit(unit) {
    if (this.tiles[unit.y]?.[unit.x]?.unitId === unit.id)
      this.tiles[unit.y][unit.x].unitId = null;
    const i = this.units.indexOf(unit);
    if (i !== -1) this.units.splice(i, 1);
  }

  getMovementRange(unit) {
    return bfsMove(this.tiles, unit.x, unit.y, unit.movesLeft, unit.civIndex, this.units);
  }

  getAttackRange(unit) {
    const r = UNITS[unit.type].range;
    const set = new Set();
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > r || (dx === 0 && dy === 0)) continue;
        const nx = unit.x + dx, ny = unit.y + dy;
        if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H) set.add(`${nx},${ny}`);
      }
    return set;
  }

  moveUnit(unit, tx, ty) {
    const range = this.getMovementRange(unit);
    const key = `${tx},${ty}`;
    if (!range.has(key)) return false;
    this.tiles[unit.y][unit.x].unitId = null;
    unit.movesLeft = range.get(key).movesLeft;
    unit.x = tx; unit.y = ty;
    this.tiles[ty][tx].unitId = unit.id;
    this.revealAround(tx, ty, 2, unit.civIndex);
    return true;
  }

  attack(attacker, defender) {
    const aDef = UNITS[attacker.type];
    const dDef = UNITS[defender.type];
    const dmgD = calcDamage(aDef.atk, dDef.def);
    const dmgA = aDef.range > 1 ? 0 : calcDamage(dDef.atk, aDef.def);

    defender.hp = Math.max(0, defender.hp - dmgD);
    attacker.hp = Math.max(0, attacker.hp - dmgA);
    attacker.hasActed = true; attacker.movesLeft = 0;

    const res = { dmgD, dmgA, defDied: false, atkDied: false, captured: null };

    this.addLog(`${CIV_DATA[attacker.civIndex].name}'s ${aDef.name} → ${CIV_DATA[defender.civIndex].name}'s ${dDef.name}: -${dmgD}HP${dmgA ? `, 反撃 -${dmgA}HP` : ''}`);

    if (defender.hp <= 0) {
      res.defDied = true;
      if (aDef.range === 1) {
        this.tiles[attacker.y][attacker.x].unitId = null;
        attacker.x = defender.x; attacker.y = defender.y;
        this.tiles[defender.y][defender.x].unitId = attacker.id;
      }
      this.removeUnit(defender);
      this.addLog(`${CIV_DATA[defender.civIndex].name}'s ${dDef.name} が撃破されました！`);
    }
    if (attacker.hp <= 0) { res.atkDied = true; this.removeUnit(attacker); }
    return res;
  }

  attackCity(attacker, city) {
    const aDef = UNITS[attacker.type];
    const cityDef = 15 + city.population * 5;
    const dmgC = calcDamage(aDef.atk, cityDef);
    const dmgA = aDef.range > 1 ? 0 : calcDamage(8, aDef.def);

    city.hp = Math.max(0, (city.hp ?? 100) - dmgC);
    attacker.hp = Math.max(0, attacker.hp - dmgA);
    attacker.hasActed = true; attacker.movesLeft = 0;

    const res = { dmgC, dmgA, captured: false, atkDied: false };
    this.addLog(`${CIV_DATA[attacker.civIndex].name}'s ${aDef.name} が ${city.name} を攻撃: -${dmgC}HP${dmgA ? `, 反撃 -${dmgA}HP` : ''}`);

    if (city.hp <= 0) {
      city.hp = 50; city.population = Math.max(1, city.population - 1);
      const prevCiv = city.civIndex;
      city.civIndex = attacker.civIndex;
      this.tiles[city.y][city.x].owner = attacker.civIndex;
      // Reclaim territory
      city.territory = this.claimTerritory(attacker.civIndex, city.x, city.y, 1);
      this.tiles[city.y][city.x].unitId = null;
      attacker.x = city.x; attacker.y = city.y;
      this.tiles[city.y][city.x].unitId = attacker.id;
      res.captured = true;
      this.addLog(`${city.name} が ${CIV_DATA[attacker.civIndex].name} に占領されました！`);
      this.checkVictory();
    }
    if (attacker.hp <= 0) { res.atkDied = true; this.removeUnit(attacker); }
    return res;
  }

  settleCity(unit) {
    if (!UNITS[unit.type].canSettle) return false;
    const tile = this.tiles[unit.y][unit.x];
    if (tile.cityId) return false;
    this.addLog(`${CIV_DATA[unit.civIndex].name} が新都市を建設しました！`);
    this.foundCity(unit.civIndex, unit.x, unit.y, false);
    this.removeUnit(unit);
    return true;
  }

  setProduction(city, itemType, itemId) {
    const def = itemType === 'UNIT' ? UNITS[itemId] : BUILDINGS[itemId];
    if (!def) return;
    city.productionQueue = { itemType, itemId, progress: 0, cost: def.cost };
    city.production = 0;
  }

  setResearch(civIdx, techId) {
    const civ = this.civs[civIdx];
    if (civ.techs.includes(techId)) return;
    civ.currentTech = { techId, progress: 0 };
  }

  availableTechs(civIdx) {
    const civ = this.civs[civIdx];
    return Object.entries(TECHS)
      .filter(([id, def]) => !civ.techs.includes(id) && def.req.every(r => civ.techs.includes(r)))
      .map(([id, def]) => ({ id, ...def }));
  }

  availableProduction(city) {
    const civ = this.civs[city.civIndex];
    const items = [];
    for (const [id, def] of Object.entries(UNITS))
      if (!def.tech || civ.techs.includes(def.tech))
        items.push({ itemType: 'UNIT', itemId: id, name: def.name, cost: def.cost });
    for (const [id, def] of Object.entries(BUILDINGS)) {
      if (city.buildings.includes(id)) continue;
      if (!def.tech || civ.techs.includes(def.tech))
        items.push({ itemType: 'BUILDING', itemId: id, name: def.name, cost: def.cost });
    }
    return items;
  }

  getCivYields(civIdx) {
    let food = 0, prod = 0, gold = 0, science = 0;
    for (const c of this.cities.filter(c => c.civIndex === civIdx)) {
      const y = this.getCityYields(c);
      food += y.food; prod += y.prod; gold += y.gold; science += y.science;
    }
    for (const u of this.units.filter(u => u.civIndex === civIdx))
      gold -= UNITS[u.type].upkeep;
    return { food, prod, gold, science };
  }

  getCityYields(city) {
    let food = 1, prod = 1, gold = 0, science = 0;
    for (const { x, y } of city.territory) {
      const ter = TERRAIN[this.tiles[y][x].type];
      food += ter.food; prod += ter.prod; gold += ter.gold;
    }
    for (const bid of city.buildings) {
      const b = BUILDINGS[bid];
      food += b.food; prod += b.prod; gold += b.gold; science += b.science;
    }
    return { food, prod, gold, science };
  }

  getCityAt(x, y) {
    return this.cities.find(c => c.x === x && c.y === y) ?? null;
  }
  getUnitAt(x, y) {
    const t = this.tiles[y]?.[x];
    return t?.unitId ? (this.units.find(u => u.id === t.unitId) ?? null) : null;
  }

  checkVictory() {
    // Domination: own all capitals
    const capitals = this.cities.filter(c => c.isCapital);
    for (const civ of this.civs) {
      if (capitals.length > 0 && capitals.every(c => c.civIndex === civ.index)) {
        this.gameOver = true; this.winner = civ.index; return;
      }
    }
    // Science: 7 techs
    for (const civ of this.civs) {
      if (civ.techs.length >= MAX_TECHS_WIN) {
        this.gameOver = true; this.winner = civ.index; return;
      }
    }
    // Turn limit
    if (this.turn >= 100) {
      // Winner by most cities + techs
      const score = (c) => this.cities.filter(ci => ci.civIndex === c.index).length * 5 + c.techs.length;
      const best = this.civs.reduce((a, b) => score(a) >= score(b) ? a : b);
      this.gameOver = true; this.winner = best.index;
    }
  }

  endTurn() {
    for (const civ of this.civs) {
      const yields = this.getCivYields(civ.index);
      civ.gold = Math.max(0, civ.gold + yields.gold);

      // Research
      if (civ.currentTech) {
        civ.currentTech.progress += yields.science;
        const techDef = TECHS[civ.currentTech.techId];
        if (civ.currentTech.progress >= techDef.cost) {
          civ.techs.push(civ.currentTech.techId);
          this.addLog(`${civ.name}: ${techDef.name} の研究が完了しました！`);
          civ.currentTech = null;
          this.checkVictory();
        }
      }

      // Cities
      for (const city of this.cities.filter(c => c.civIndex === civ.index)) {
        const cy = this.getCityYields(city);
        city.food += cy.food;
        if (city.food >= city.foodTarget) {
          city.food -= city.foodTarget;
          city.population++;
          city.foodTarget = Math.round(city.foodTarget * 1.35);
          city.territory = this.claimTerritory(civ.index, city.x, city.y, Math.min(2, city.population));
          this.addLog(`${city.name} が人口 ${city.population} に成長しました！`);
        }
        if (city.hp < city.maxHp) city.hp = Math.min(city.maxHp, city.hp + 5); // city recovery

        if (city.productionQueue) {
          city.production += cy.prod;
          if (city.production >= city.productionQueue.cost) {
            city.production = 0;
            const q = city.productionQueue;
            city.productionQueue = null;
            if (q.itemType === 'UNIT') {
              this.createUnit(civ.index, q.itemId, city.x, city.y);
              this.addLog(`${city.name}: ${UNITS[q.itemId].name} が完成しました！`);
            } else {
              city.buildings.push(q.itemId);
              this.addLog(`${city.name}: ${BUILDINGS[q.itemId].name} が完成しました！`);
            }
          }
        }
      }

      // Reset units
      for (const u of this.units.filter(u => u.civIndex === civ.index)) {
        u.movesLeft = UNITS[u.type].mov;
        u.hasActed = false;
      }

      if (!civ.isPlayer) this.doAITurn(civ);
    }

    this.turn++;
    this.checkVictory();
  }

  doAITurn(civ) {
    const myCities = this.cities.filter(c => c.civIndex === civ.index);
    const myUnits = this.units.filter(u => u.civIndex === civ.index);
    const enemies = this.units.filter(u => u.civIndex !== civ.index);
    const enemyCities = this.cities.filter(c => c.civIndex !== civ.index);

    // Research
    if (!civ.currentTech) {
      const avail = this.availableTechs(civ.index);
      if (avail.length) {
        // Prefer offensive techs
        const pref = avail.find(t => ['bronze_working','archery','horseback_riding'].includes(t.id)) ?? avail[0];
        this.setResearch(civ.index, pref.id);
      }
    }

    // Production
    for (const city of myCities) {
      if (!city.productionQueue) {
        const avail = this.availableProduction(city);
        const units = avail.filter(a => a.itemType === 'UNIT' && a.itemId !== 'SETTLER');
        const buildings = avail.filter(a => a.itemType === 'BUILDING');
        let choice;
        if (myUnits.length < myCities.length * 2 + 2) {
          choice = units[Math.floor(Math.random() * units.length)];
        } else {
          choice = Math.random() < 0.6
            ? (buildings[0] ?? units[0])
            : (units[0] ?? buildings[0]);
        }
        if (choice) this.setProduction(city, choice.itemType, choice.itemId);
      }
    }

    // Units
    for (const unit of [...myUnits]) {
      if (!this.units.includes(unit)) continue;
      const def = UNITS[unit.type];
      if (def.canSettle) {
        const tile = this.tiles[unit.y][unit.x];
        if (!tile.cityId && !enemyCities.some(c => Math.hypot(c.x-unit.x,c.y-unit.y) < 4)) {
          this.settleCity(unit); continue;
        }
      }
      if (def.atk === 0) continue;

      // Find nearest target
      let target = null, bestDist = Infinity;
      for (const eu of enemies) {
        const d = Math.hypot(unit.x-eu.x, unit.y-eu.y);
        if (d < bestDist) { bestDist = d; target = { x: eu.x, y: eu.y, isUnit: true, e: eu }; }
      }
      for (const ec of enemyCities) {
        const d = Math.hypot(unit.x-ec.x, unit.y-ec.y);
        if (d < bestDist) { bestDist = d; target = { x: ec.x, y: ec.y, isUnit: false, e: ec }; }
      }
      if (!target) continue;

      const atkRange = this.getAttackRange(unit);
      const tkey = `${target.x},${target.y}`;
      if (atkRange.has(tkey) && !unit.hasActed) {
        target.isUnit ? this.attack(unit, target.e) : this.attackCity(unit, target.e);
        continue;
      }

      // Move toward
      const movRange = this.getMovementRange(unit);
      let best = null, bestD = Infinity;
      for (const [, pos] of movRange) {
        const d = Math.hypot(pos.x - target.x, pos.y - target.y);
        if (d < bestD) { bestD = d; best = pos; }
      }
      if (best && (best.x !== unit.x || best.y !== unit.y)) {
        this.moveUnit(unit, best.x, best.y);
        if (!unit.hasActed) {
          const ar2 = this.getAttackRange(unit);
          if (ar2.has(tkey)) {
            target.isUnit ? this.attack(unit, target.e) : this.attackCity(unit, target.e);
          }
        }
      }
    }
  }
}
