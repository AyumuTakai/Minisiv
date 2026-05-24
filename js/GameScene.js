import {
  TILE_SIZE, MAP_W, MAP_H, TOP_BAR_H,
  MAP_AREA_W, MAP_AREA_H, PANEL_X, PANEL_W, CANVAS_W, CANVAS_H,
  TERRAIN, UNITS, BUILDINGS, TECHS, CIV_DATA, MAX_TECHS_WIN, MAX_TURNS,
} from './data.js';
import { GameState } from './GameState.js';

const COL = {
  panel:    0x121212,
  panelBdr: 0x333333,
  text:     '#e0e0e0',
  dim:      '#888888',
  accent:   '#4fc3f7',
  warn:     '#ff8a65',
  good:     '#81c784',
  btn:      0x37474f,
  btnHov:   0x546e7a,
  btnEnd:   0x1b5e20,
  sel:      0xf9d01e,
  moveHl:   0x00bcd4,
  atkHl:    0xff5722,
  own0:     0x1e88e5,
  own1:     0xe53935,
};

export class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  create() {
    const saved = localStorage.getItem('minisiv_save');
    if (saved) {
      try { this.gs = GameState.load(saved); }
      catch(e) { localStorage.removeItem('minisiv_save'); this.gs = new GameState(); }
    } else {
      this.gs = new GameState();
    }
    this.selectedUnit = null;
    this.selectedCity = null;
    this.panelMode = 'overview';   // 'overview' | 'tech' | 'production'
    this.menuOpen = false;
    this.hovX = -1; this.hovY = -1;
    this.dirty = true;

    // Graphics layers (depth order: tiles < overlay < entities < panel < menu < gameOver)
    this.gfxTiles    = this.add.graphics();
    this.gfxOverlay  = this.add.graphics();
    this.gfxEntities = this.add.graphics();
    this.gfxPanel    = this.add.graphics();
    this.gfxMenu     = this.add.graphics().setDepth(50);
    this.gfxHelp     = this.add.graphics().setDepth(75);
    this.gfxGameOver = this.add.graphics().setDepth(100);

    // Text pools
    this.cityTexts    = [];
    this.unitTexts    = [];
    this.panelTexts   = [];
    this.panelBtns    = [];
    this.menuBtns     = [];   // dropdown menu items (depth 51/52)
    this._menuItemHov = -1;  // currently hovered dropdown item index
    this.helpTexts    = [];   // help layer texts (depth 76)
    this.helpObjs     = [];   // help layer misc objects (blocking zone etc.)
    this.helpOpen     = false;
    this._helpCloseBtn = null; // {x,y,w,h} for coordinate-based click detection
    this.goTexts      = [];   // game over layer texts
    this.goBtns       = [];   // game over layer buttons

    // Persistent hamburger button (top-left, never destroyed)
    this._buildHamburgerBtn();

    // Input
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);

    // Keyboard
    this.input.keyboard.on('keydown-ENTER', () => this.doEndTurn());
    this.input.keyboard.on('keydown-SPACE', () => this.doEndTurn());
    this.input.keyboard.on('keydown-ESC',   () => {
      if (this.helpOpen) { this.helpOpen = false; this.dirty = true; return; }
      this.deselect(); this.panelMode = 'overview'; this.dirty = true;
    });
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.drawAll();
  }

  // ─── Draw all layers ────────────────────────────────────────────────────────

  drawAll() {
    this.drawTopBar();
    this.drawTiles();
    this.drawOverlays();
    this.drawEntities();
    this.drawPanel();
    this.updateMenuLayer();
    if (this.gs.gameOver) this.helpOpen = false; // auto-close help on game over
    if (this.helpOpen) this.drawHelpLayer();
    else this.clearHelpLayer();
    if (this.gs.gameOver) this.drawGameOverLayer();
    else this.clearGameOverLayer();
  }

  drawTopBar() {
    const g = this.gfxTiles;
    g.clear();
    g.fillStyle(0x1a237e, 1);
    g.fillRect(0, 0, MAP_AREA_W, TOP_BAR_H);
    g.lineStyle(1, 0x3949ab);
    g.strokeRect(0, 0, MAP_AREA_W, TOP_BAR_H);

    const yields = this.gs.getCivYields(0);
    const items = [
      `Turn ${this.gs.turn}/${MAX_TURNS}`,
      `🌾 ${yields.food >= 0 ? '+' : ''}${yields.food}`,
      `⚒ ${yields.prod >= 0 ? '+' : ''}${yields.prod}`,
      `💰 ${this.gs.player.gold} (${yields.gold >= 0 ? '+' : ''}${yields.gold})`,
      `🔬 ${yields.science >= 0 ? '+' : ''}${yields.science}`,
    ];

    this.clearTextPool(this.cityTexts);
    for (let i = 0; i < items.length; i++) {
      const t = this.add.text(10 + i * 158, 14, items[i], {
        fontSize: '15px', fill: '#e0e0e0', fontFamily: 'monospace',
      });
      this.cityTexts.push(t);
    }
  }

  drawTiles() {
    const g = this.gfxTiles;
    // Already cleared in drawTopBar; just draw tiles below top bar

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const tile = this.gs.tiles[y][x];
        const px = x * TILE_SIZE;
        const py = TOP_BAR_H + y * TILE_SIZE;

        if (!tile.revealed[0]) {
          g.fillStyle(0x050505, 1);
          g.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          g.lineStyle(1, 0x111111);
          g.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
          continue;
        }

        const ter = TERRAIN[tile.type];
        g.fillStyle(ter.color, 1);
        g.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        // Owner tint border
        if (tile.owner >= 0) {
          const oc = tile.owner === 0 ? COL.own0 : COL.own1;
          g.lineStyle(2, oc, 0.5);
          g.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        }

        // Grid
        g.lineStyle(1, ter.dark, 0.4);
        g.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

        // Terrain features
        this.drawTerrainFeature(g, tile.type, px, py);
      }
    }

    // Panel background
    g.fillStyle(COL.panel, 1);
    g.fillRect(PANEL_X, 0, PANEL_W, CANVAS_H);
    g.lineStyle(2, COL.panelBdr);
    g.strokeRect(PANEL_X, 0, PANEL_W, CANVAS_H);
    g.lineStyle(1, COL.panelBdr);
    g.lineBetween(PANEL_X, 0, PANEL_X, CANVAS_H);
  }

  drawTerrainFeature(g, type, px, py) {
    const cx = px + TILE_SIZE / 2, cy = py + TILE_SIZE / 2;
    const s = TILE_SIZE;
    if (type === 'FOREST') {
      g.fillStyle(0x1b5e20, 0.7);
      for (const [ox, oy] of [[-6,-4],[6,-4],[0,4]]) {
        g.fillTriangle(cx+ox, cy+oy-7, cx+ox-5, cy+oy+4, cx+ox+5, cy+oy+4);
      }
    } else if (type === 'MOUNTAIN') {
      g.fillStyle(0x90a4ae, 0.9);
      g.fillTriangle(cx, cy-12, cx-12, cy+9, cx+12, cy+9);
      g.fillStyle(0xeceff1, 0.8);
      g.fillTriangle(cx, cy-12, cx-4, cy-3, cx+4, cy-3);
    } else if (type === 'HILLS') {
      g.fillStyle(0x8d6e63, 0.6);
      g.fillCircle(cx-5, cy+4, 9);
      g.fillCircle(cx+6, cy+5, 7);
    } else if (type === 'WATER') {
      g.lineStyle(1, 0x42a5f5, 0.3);
      g.lineBetween(px+6, cy-3, px+s-6, cy-3);
      g.lineBetween(px+4, cy+4, px+s-4, cy+4);
    }
  }

  drawOverlays() {
    const g = this.gfxOverlay;
    g.clear();

    if (this.selectedUnit) {
      const su = this.selectedUnit;
      const movRange = this.gs.getMovementRange(su);
      const atkRange = this.gs.getAttackRange(su);

      for (const [key, pos] of movRange) {
        if (pos.x === su.x && pos.y === su.y) continue;
        const tile = this.gs.tiles[pos.y][pos.x];
        const eu = tile.unitId ? this.gs.units.find(u => u.id === tile.unitId) : null;
        const ec = this.gs.getCityAt(pos.x, pos.y);
        if ((eu && eu.civIndex !== su.civIndex) || (ec && ec.civIndex !== su.civIndex)) continue;
        g.fillStyle(COL.moveHl, 0.28);
        g.fillRect(pos.x * TILE_SIZE, TOP_BAR_H + pos.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }

      if (!su.hasActed) {
        for (const key of atkRange) {
          const [kx, ky] = key.split(',').map(Number);
          const tile = this.gs.tiles[ky][kx];
          const eu = tile.unitId ? this.gs.units.find(u => u.id === tile.unitId) : null;
          const ec = this.gs.getCityAt(kx, ky);
          if ((eu && eu.civIndex !== su.civIndex) || (ec && ec.civIndex !== su.civIndex)) {
            g.fillStyle(COL.atkHl, 0.4);
            g.fillRect(kx * TILE_SIZE, TOP_BAR_H + ky * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          }
        }
      }

      // Selection highlight
      g.lineStyle(3, COL.sel, 1);
      g.strokeRect(su.x * TILE_SIZE + 1, TOP_BAR_H + su.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    }

    if (this.selectedCity) {
      const sc = this.selectedCity;
      g.lineStyle(3, COL.sel, 1);
      g.strokeRect(sc.x * TILE_SIZE + 1, TOP_BAR_H + sc.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
      // Territory highlight
      for (const { x, y } of sc.territory) {
        g.fillStyle(COL.sel, 0.12);
        g.fillRect(x * TILE_SIZE, TOP_BAR_H + y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }

    // Hover
    if (this.hovX >= 0 && this.hovX < MAP_W && this.hovY >= 0 && this.hovY < MAP_H) {
      g.lineStyle(2, 0xffffff, 0.35);
      g.strokeRect(this.hovX * TILE_SIZE, TOP_BAR_H + this.hovY * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  drawEntities() {
    const g = this.gfxEntities;
    g.clear();
    this.clearTextPool(this.unitTexts);

    // Cities
    for (const city of this.gs.cities) {
      if (!this.gs.tiles[city.y][city.x].revealed[0]) continue;
      const cx = city.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = TOP_BAR_H + city.y * TILE_SIZE + TILE_SIZE / 2;
      const cc = CIV_DATA[city.civIndex].color;
      const isCapital = city.isCapital;

      g.fillStyle(cc, 1);
      g.fillRect(cx - 13, cy - 14, 26, 22);
      g.lineStyle(2, 0xffffff, 0.9);
      g.strokeRect(cx - 13, cy - 14, 26, 22);
      if (isCapital) {
        g.fillStyle(0xffd700, 1);
        g.fillTriangle(cx - 6, cy - 14, cx, cy - 20, cx + 6, cy - 14);
      }

      // City HP bar (only if damaged)
      if (city.hp < city.maxHp) {
        const bw = TILE_SIZE - 4;
        const bx = city.x * TILE_SIZE + 2;
        const by = TOP_BAR_H + (city.y + 1) * TILE_SIZE - 5;
        g.fillStyle(0x333333, 1); g.fillRect(bx, by, bw, 4);
        g.fillStyle(0xff5722, 1); g.fillRect(bx, by, bw * city.hp / city.maxHp, 4);
      }

      const sym = isCapital ? '★' : '●';
      const t = this.add.text(cx, cy - 5, sym, {
        fontSize: '12px', fill: '#fff', fontFamily: 'monospace', align: 'center',
      }).setOrigin(0.5, 0.5);
      this.unitTexts.push(t);

      const nameT = this.add.text(cx, TOP_BAR_H + (city.y + 1) * TILE_SIZE - 3, city.name, {
        fontSize: '10px', fill: '#fff', fontFamily: 'monospace', align: 'center',
        stroke: '#000', strokeThickness: 2,
      }).setOrigin(0.5, 1);
      this.unitTexts.push(nameT);
    }

    // Units
    for (const unit of this.gs.units) {
      if (!this.gs.tiles[unit.y][unit.x].revealed[0]) continue;
      const ux = unit.x * TILE_SIZE + TILE_SIZE / 2;
      const uy = TOP_BAR_H + unit.y * TILE_SIZE + TILE_SIZE / 2;
      const bg = CIV_DATA[unit.civIndex].unitBg;
      const spent = unit.movesLeft === 0 || unit.hasActed;

      g.fillStyle(bg, 1);
      g.fillCircle(ux, uy, 14);
      g.lineStyle(spent ? 1 : 2.5, spent ? 0x444444 : 0xffffff, 1);
      g.strokeCircle(ux, uy, 14);

      // HP bar
      const bw = 24;
      const bx = ux - bw / 2;
      const by = uy + 12;
      const def = UNITS[unit.type];
      g.fillStyle(0x222222, 1); g.fillRect(bx, by, bw, 3);
      const hpColor = unit.hp > 60 ? 0x4caf50 : unit.hp > 30 ? 0xff9800 : 0xf44336;
      g.fillStyle(hpColor, 1); g.fillRect(bx, by, bw * unit.hp / def.maxHp, 3);

      const t = this.add.text(ux, uy, def.sym, {
        fontSize: '13px', fill: spent ? '#aaa' : '#fff',
        fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5, 0.5);
      this.unitTexts.push(t);
    }
  }

  // ─── Panel ──────────────────────────────────────────────────────────────────

  drawPanel() {
    const g = this.gfxPanel;
    g.clear();
    this.clearTextPool(this.panelTexts);
    this.destroyPanelBtns();


    const px = PANEL_X + 10;
    const pw = PANEL_W - 20;
    let y = 10;

    // Civ header
    const civ = this.gs.player;
    const cc = CIV_DATA[0].color;
    g.fillStyle(cc, 1);
    g.fillRoundedRect(PANEL_X + 4, y, PANEL_W - 8, 36, 6);
    this.addPText(px + 5, y + 9, `${civ.name}  Turn ${this.gs.turn}/${MAX_TURNS}`, 16, '#fff', true);
    y += 42;

    // Yields
    const yields = this.gs.getCivYields(0);
    this.addPText(px, y, '── 収入 ──────────────', 11, '#666');
    y += 17;
    const yl = [
      [`🌾 食料 ${yields.food >= 0 ? '+' : ''}${yields.food}/turn`, '#81c784'],
      [`⚒ 生産 ${yields.prod >= 0 ? '+' : ''}${yields.prod}/turn`,  '#ffb74d'],
      [`💰 金   ${civ.gold} (${yields.gold >= 0 ? '+' : ''}${yields.gold}/turn)`, '#ffd54f'],
      [`🔬 科学 ${yields.science >= 0 ? '+' : ''}${yields.science}/turn`, '#4fc3f7'],
    ];
    for (const [txt, col] of yl) {
      this.addPText(px, y, txt, 13, col); y += 18;
    }
    y += 4;

    // Research
    this.addPText(px, y, '── 研究 ──────────────', 11, '#666');
    y += 17;
    if (civ.currentTech) {
      const td = TECHS[civ.currentTech.techId];
      const pct = Math.min(1, civ.currentTech.progress / td.cost);
      const turns = yields.science > 0 ? Math.ceil((td.cost - civ.currentTech.progress) / yields.science) : '∞';
      this.addPText(px, y, `${td.name}  (あと${turns}T)`, 12, '#4fc3f7');
      y += 16;
      this.drawBar(g, px, y, pw, 8, pct, 0x1565c0, 0x42a5f5);
      y += 14;
    } else {
      this.addPText(px, y, '研究なし', 12, '#888');
      y += 18;
    }
    this.addPBtn(px, y, pw, 26, '研究を選ぶ', () => { this.panelMode = 'tech'; this.dirty = true; }, COL.btn);
    y += 32;

    // End Turn
    this.addPBtn(px, y, pw, 34, `終了ターン  [Enter]`, () => this.doEndTurn(), COL.btnEnd);
    y += 40;

    // Context
    const divY = y;
    this.addPText(px, y, '── 選択中 ────────────', 11, '#666');
    y += 17;

    if (this.panelMode === 'tech') {
      y = this.drawTechPanel(g, px, pw, y);
    } else if (this.panelMode === 'production' && this.selectedCity) {
      y = this.drawProductionPanel(g, px, pw, y);
    } else if (this.selectedUnit) {
      y = this.drawUnitPanel(g, px, pw, y);
    } else if (this.selectedCity) {
      y = this.drawCityPanel(g, px, pw, y);
    } else {
      y = this.drawOverviewPanel(g, px, pw, y);
    }

    // Log
    y = Math.max(y, CANVAS_H - 170);
    g.lineStyle(1, 0x333333);
    g.lineBetween(PANEL_X + 4, y - 2, PANEL_X + PANEL_W - 4, y - 2);
    this.addPText(px, y, '── ログ ──────────────', 11, '#666');
    y += 16;
    for (const entry of this.gs.log.slice(0, 6)) {
      if (typeof entry === 'object' && entry.turn !== undefined) {
        this.addPText(px,      y, `T${entry.turn}`, 9,  '#4a6278');
        this.addPText(px + 28, y, entry.msg,        10, '#aaa');
      } else {
        this.addPText(px, y, String(entry), 10, '#aaa');
      }
      y += 14;
    }

  }

  drawUnitPanel(g, px, pw, y) {
    const u = this.selectedUnit;
    const def = UNITS[u.type];
    const civName = CIV_DATA[u.civIndex].name;
    this.addPText(px, y, `${civName}: ${def.name}`, 14, '#e0e0e0', true); y += 20;
    this.addPText(px, y, `HP`, 11, '#888'); y += 14;
    this.drawBar(g, px, y, pw, 8, u.hp / def.maxHp, 0x333, u.hp > 60 ? 0x4caf50 : u.hp > 30 ? 0xff9800 : 0xf44336);
    this.addPText(px + pw - 50, y - 14, `${u.hp}/${def.maxHp}`, 11, '#ccc');
    y += 14;
    this.addPText(px, y, `ATK:${def.atk}  DEF:${def.def}  MOV:${u.movesLeft}/${def.mov}  RNG:${def.range}`, 12, '#aaa');
    y += 20;
    if (u.hasActed) this.addPText(px, y, '行動済み', 12, '#888');
    else this.addPText(px, y, '行動可能', 12, '#81c784');
    y += 22;

    if (def.canSettle) {
      this.addPBtn(px, y, pw, 26, '都市を建設', () => {
        if (this.gs.settleCity(u)) { this.selectedUnit = null; this.panelMode = 'overview'; this.saveGame(); }
        else alert('ここには建設できません');
        this.dirty = true;
      }, COL.btn);
      y += 32;
    }
    this.addPBtn(px, y, pw, 26, 'スキップ (このユニット)', () => {
      u.movesLeft = 0; u.hasActed = true; this.selectedUnit = null; this.dirty = true;
    }, COL.btn);
    y += 32;
    this.addPBtn(px, y, pw, 26, '選択解除', () => { this.selectedUnit = null; this.dirty = true; }, COL.btn);
    y += 32;
    return y;
  }

  drawCityPanel(g, px, pw, y) {
    const c = this.selectedCity;
    const civName = CIV_DATA[c.civIndex].name;
    const cap = c.isCapital ? '★ ' : '';
    this.addPText(px, y, `${cap}${civName}: ${c.name}`, 14, '#e0e0e0', true); y += 20;
    const cy = this.gs.getCityYields(c);
    this.addPText(px, y, `人口:${c.population}  🌾${cy.food} ⚒${cy.prod} 💰${cy.gold} 🔬${cy.science}`, 12, '#aaa');
    y += 18;
    this.addPText(px, y, `食料: ${c.food}/${c.foodTarget}`, 11, '#888');
    this.drawBar(g, px, y + 14, pw, 6, c.food / c.foodTarget, 0x333, 0x4caf50);
    y += 26;

    if (c.productionQueue) {
      const pq = c.productionQueue;
      const pct = pq.progress / pq.cost;
      const turns = cy.prod > 0 ? Math.ceil((pq.cost - pq.progress) / cy.prod) : '∞';
      const nm = pq.itemType === 'UNIT' ? UNITS[pq.itemId].name : BUILDINGS[pq.itemId].name;
      this.addPText(px, y, `生産: ${nm}  (あと${turns}T)`, 12, '#ffb74d'); y += 16;
      this.drawBar(g, px, y, pw, 8, pct, 0x333, 0xffa000); y += 14;
    } else {
      this.addPText(px, y, '生産なし', 12, '#888'); y += 18;
    }

    if (c.buildings.length) {
      this.addPText(px, y, `建物: ${c.buildings.map(b => BUILDINGS[b].name).join(', ')}`, 11, '#aaa');
      y += 16;
    }
    y += 4;

    if (c.civIndex === 0) {
      this.addPBtn(px, y, pw, 26, '生産物を変更', () => { this.panelMode = 'production'; this.dirty = true; }, COL.btn);
      y += 32;
    }
    this.addPBtn(px, y, pw, 26, '選択解除', () => { this.selectedCity = null; this.dirty = true; }, COL.btn);
    y += 32;
    return y;
  }

  drawProductionPanel(g, px, pw, y) {
    const city = this.selectedCity;
    if (!city) { this.panelMode = 'overview'; return y; }
    const items = this.gs.availableProduction(city);
    this.addPText(px, y, `${city.name} — 生産選択:`, 13, '#ffd54f', true); y += 20;
    const cy = this.gs.getCityYields(city);

    for (const item of items) {
      const turns = cy.prod > 0 ? Math.ceil(item.cost / cy.prod) : '∞';
      const label = `${item.name} (${item.cost}⚒ | ${turns}T)`;
      const isCurrent = city.productionQueue?.itemId === item.itemId;
      this.addPBtn(px, y, pw, 24, label, () => {
        this.gs.setProduction(city, item.itemType, item.itemId);
        this.panelMode = 'overview';
        this.saveGame();
        this.dirty = true;
      }, isCurrent ? 0x1b5e20 : COL.btn);
      y += 30;
    }
    this.addPBtn(px, y, pw, 24, '← 戻る', () => { this.panelMode = 'overview'; this.dirty = true; }, 0x263238);
    y += 30;
    return y;
  }

  drawTechPanel(g, px, pw, y) {
    const civ = this.gs.player;
    this.addPText(px, y, '研究する技術を選択:', 13, '#4fc3f7', true); y += 20;
    const avail = this.gs.availableTechs(0);

    for (const tech of avail) {
      const turns = this.gs.getCivYields(0).science > 0
        ? Math.ceil(tech.cost / this.gs.getCivYields(0).science) : '∞';
      const isCurr = civ.currentTech?.techId === tech.id;
      const label = `${tech.name} (${tech.cost}🔬 | ${turns}T)`;
      this.addPBtn(px, y, pw, 24, label, () => {
        this.gs.setResearch(0, tech.id);
        this.panelMode = 'overview';
        this.saveGame();
        this.dirty = true;
      }, isCurr ? 0x1565c0 : COL.btn);
      y += 30;
    }

    if (civ.techs.length) {
      y += 6;
      this.addPText(px, y, '習得済み:', 11, '#555'); y += 16;
      this.addPText(px, y, civ.techs.map(id => TECHS[id].name).join(', '), 10, '#666'); y += 16;
    }

    this.addPBtn(px, y, pw, 24, '← 戻る', () => { this.panelMode = 'overview'; this.dirty = true; }, 0x263238);
    y += 30;
    return y;
  }

  drawOverviewPanel(g, px, pw, y) {
    const gs = this.gs;
    this.addPText(px, y, '勝利条件:', 12, '#888'); y += 16;
    this.addPText(px, y, `  敵首都を占領 または ${MAX_TECHS_WIN}テク研究`, 11, '#666'); y += 14;
    this.addPText(px, y, `  ターン上限(100T)は支配度で判定`, 11, '#666'); y += 18;

    // Score
    for (const civ of gs.civs) {
      const cities = gs.cities.filter(c => c.civIndex === civ.index).length;
      const units = gs.units.filter(u => u.civIndex === civ.index).length;
      const col = civ.index === 0 ? '#90caf9' : '#ef9a9a';
      this.addPText(px, y, `${civ.name}: ${cities}都市 ${units}ユニット ${civ.techs.length}テク`, 12, col);
      y += 16;
    }
    y += 6;

    // Save indicator
    const hasSave = !!localStorage.getItem('minisiv_save');
    this.addPText(px, y, hasSave ? '💾 自動保存: オン' : '💾 保存なし', 11, hasSave ? '#81c784' : '#888');
    y += 20;
    return y;
  }

  // ─── Hamburger menu (persistent + depth-50 dropdown) ────────────────────────

  // Ham button constants (shared by build / onPointerDown / onPointerMove)
  static HAM = { x: 8, y: 8, w: 40, h: 34 };
  static DROP = { dw: 220, pad: 6, itemH: 30, itemGap: 4 };

  _buildHamburgerBtn() {
    const { x: bx, y: by, w: bw, h: bh } = GameScene.HAM;
    this.gfxHam = this.add.graphics().setDepth(51);
    this._hamActive = false; // tracks hover+open state for redraw
    this._redrawHamBtn(false);
    this.add.text(bx + bw / 2, by + bh / 2, '☰', {
      fontSize: '18px', fill: '#fff', fontFamily: 'monospace',
    }).setOrigin(0.5, 0.5).setDepth(52);
    // Click & hover handled directly in onPointerDown / onPointerMove
    // (Phaser zone pointerdown unreliable when topOnly=true with depth layering)
  }

  _redrawHamBtn(active) {
    const bx = 8, by = 8, bw = 40, bh = 34;
    this.gfxHam.clear();
    this.gfxHam.fillStyle(active ? 0x0d47a1 : 0x1a237e, 1);
    this.gfxHam.fillRoundedRect(bx, by, bw, bh, 5);
    this.gfxHam.lineStyle(1, active ? 0x42a5f5 : 0x3949ab);
    this.gfxHam.strokeRoundedRect(bx, by, bw, bh, 5);
  }

  updateMenuLayer() {
    // Clear existing dropdown items
    this.gfxMenu.clear();
    this.menuBtns.forEach(({ g2, t }) => { g2.destroy(); t.destroy(); });
    this.menuBtns = [];
    this._menuItemHov = -1; // reset hover index
    if (!this.menuOpen) return;

    // Dropdown below the hamburger button
    const { x: bx, y: by, h: bh } = GameScene.HAM;
    const { dw, pad, itemH, itemGap } = GameScene.DROP;
    const dx = bx, dy = by + bh + 4;
    const totalH = pad + itemH + itemGap + itemH + pad;

    // Shadow + background
    this.gfxMenu.fillStyle(0x000000, 0.45);
    this.gfxMenu.fillRoundedRect(dx + 3, dy + 3, dw, totalH, 7);
    this.gfxMenu.fillStyle(0x1e2a3a, 1);
    this.gfxMenu.fillRoundedRect(dx, dy, dw, totalH, 7);
    this.gfxMenu.lineStyle(1, 0x455a64);
    this.gfxMenu.strokeRoundedRect(dx, dy, dw, totalH, 7);

    // Menu items (click + hover handled coordinate-based in onPointerDown/Move)
    this._addMenuBtn(dx + pad, dy + pad, dw - pad * 2, itemH, 'ヘルプ', 0x1a3a5c);
    this._addMenuBtn(dx + pad, dy + pad + itemH + itemGap, dw - pad * 2, itemH, '新規ゲーム（データ削除）', 0x4e342e);
  }

  _addMenuBtn(x, y, w, h, label, bg = COL.btn) {
    // Click handled in onPointerDown; hover handled in onPointerMove via _menuItemHov
    const g2 = this.add.graphics().setDepth(51);
    const drawBg = (col) => {
      g2.clear();
      g2.fillStyle(col, 1); g2.fillRoundedRect(x, y, w, h, 4);
      g2.lineStyle(1, 0x555555); g2.strokeRoundedRect(x, y, w, h, 4);
    };
    drawBg(bg);
    const t = this.add.text(x + w / 2, y + h / 2, label, {
      fontSize: '12px', fill: '#e0e0e0', fontFamily: 'monospace',
    }).setOrigin(0.5, 0.5).setDepth(52);
    this.menuBtns.push({ g2, t, drawBg, bg, x, y, w, h });
  }

  // ─── Help dialog layer (depth 75/76) ────────────────────────────────────────

  clearHelpLayer() {
    this.gfxHelp.clear();
    this.clearTextPool(this.helpTexts);
    this.helpObjs.forEach(o => o.destroy());
    this.helpObjs = [];
    this._helpCloseBtn = null;
  }

  drawHelpLayer() {
    this.clearHelpLayer();
    const g = this.gfxHelp;
    const D = 76; // depth for all help texts

    // ── Full-screen backdrop ────────────────────────────────────────────────
    g.fillStyle(0x000000, 0.88);
    g.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // ── Dialog box ───────────────────────────────────────────────────────────
    const bx = 28, by = 8, bw = 1144, bh = 584;
    g.fillStyle(0x0c1a28, 1);
    g.fillRoundedRect(bx, by, bw, bh, 10);
    g.lineStyle(2, 0x2e4a60, 1);
    g.strokeRoundedRect(bx, by, bw, bh, 10);

    // Header band
    g.fillStyle(0x132236, 1);
    g.fillRoundedRect(bx, by, bw, 48, 10);
    g.fillRect(bx, by + 28, bw, 20); // square off lower half
    g.lineStyle(1, 0x2a4a60, 1);
    g.lineBetween(bx, by + 48, bx + bw, by + 48);

    // ── Local helpers ────────────────────────────────────────────────────────
    // HT: add a text object to the help layer
    const HT = (x, y, text, size, fill = '#aaa', bold = false, center = false) => {
      const t = this.add.text(x, y, text, {
        fontSize: `${size}px`, fill,
        fontFamily: 'monospace', fontStyle: bold ? 'bold' : 'normal',
      }).setDepth(D);
      if (center) t.setOrigin(0.5, 0.5);
      this.helpTexts.push(t);
      return t;
    };
    // SEC: section header with coloured bg, returns new y
    const cw = 352;
    const SEC = (x, y, label) => {
      g.fillStyle(0x183045, 1);
      g.fillRect(x, y, cw, 19);
      g.lineStyle(1, 0x2a4a62, 1);
      g.lineBetween(x, y + 19, x + cw, y + 19);
      HT(x + 5, y + 2, label, 10, '#4fc3f7', true);
      return y + 22;
    };
    // LN: one body line, returns new y
    const LN = (x, y, text, col = '#999', sz = 10) => {
      HT(x, y, text, sz, col);
      return y + 13;
    };

    // ── Title & close button ─────────────────────────────────────────────────
    HT(bx + 16, by + 13, '■ ヘルプ  /  MiniSiv ゲームガイド', 16, '#4fc3f7', true);

    const cbx = bx + bw - 98, cby = by + 9, cbw = 88, cbh = 30;
    g.fillStyle(0x253545, 1);
    g.fillRoundedRect(cbx, cby, cbw, cbh, 5);
    g.lineStyle(1, 0x3a5570, 1);
    g.strokeRoundedRect(cbx, cby, cbw, cbh, 5);
    HT(cbx + cbw / 2, cby + cbh / 2, '✕  閉じる', 12, '#ccc', false, true);
    this._helpCloseBtn = { x: cbx, y: cby, w: cbw, h: cbh };

    // ── Column positions ─────────────────────────────────────────────────────
    // 3 columns × 352px, gaps of 14px, left padding 14px → 14+352+14+352+14+352+14 = 1112 ≤ 1144 ✓
    const c1x = bx + 14;          // 42
    const c2x = c1x + cw + 14;    // 408
    const c3x = c2x + cw + 14;    // 774
    const cy0 = by + 56;          // content start y

    // ════════════════════════════════════════════════════════════════════════
    // Column 1 — 概要 / 勝利条件 / 操作 / ユニット状態
    // ════════════════════════════════════════════════════════════════════════
    let y1 = cy0;

    y1 = SEC(c1x, y1, ' ゲーム概要');
    y1 = LN(c1x + 4, y1, '2文明のターン制ストラテジー。ユニットと');
    y1 = LN(c1x + 4, y1, '都市を操り敵文明に打ち勝とう。ゲームは');
    y1 = LN(c1x + 4, y1, '最大100ターン。毎ターン終了時に収入・');
    y1 = LN(c1x + 4, y1, '研究・生産が自動処理される。');
    y1 += 7;

    y1 = SEC(c1x, y1, ' 勝利条件');
    y1 = LN(c1x + 4, y1, '● ドミネーション勝利', '#ff8a65', 10);
    y1 = LN(c1x + 14, y1, '敵の首都を軍事力で占領する', '#777');
    y1 = LN(c1x + 4, y1, '● 科学勝利', '#4fc3f7', 10);
    y1 = LN(c1x + 14, y1, `テクノロジーを${MAX_TECHS_WIN}種すべて研究する`, '#777');
    y1 = LN(c1x + 4, y1, '● スコア勝利', '#ffd54f', 10);
    y1 = LN(c1x + 14, y1, '100T終了時に都市数+技術数が多い', '#777');
    y1 = LN(c1x + 14, y1, '文明が勝利する', '#777');
    y1 += 7;

    y1 = SEC(c1x, y1, ' 基本操作');
    y1 = LN(c1x + 4, y1, '  ユニットクリック → 選択');
    y1 = LN(c1x + 4, y1, '  青タイル         → 移動先を指定');
    y1 = LN(c1x + 4, y1, '  赤タイル         → 攻撃対象を指定');
    y1 = LN(c1x + 4, y1, '  都市クリック     → 生産管理');
    y1 = LN(c1x + 4, y1, '  [研究を選ぶ]     → 技術研究');
    y1 = LN(c1x + 4, y1, '  Enter / Space    → ターン終了');
    y1 = LN(c1x + 4, y1, '  ESC              → 選択解除/ヘルプ閉じる');
    y1 += 7;

    y1 = SEC(c1x, y1, ' ユニット状態の見方');
    y1 = LN(c1x + 4, y1, '白枠の円 = 行動可能  灰枠 = 行動済み');
    y1 = LN(c1x + 4, y1, '円下のHPバー: 緑→黄→赤 で残HP表示');
    y1 = LN(c1x + 4, y1, '自軍都市に駐留すると毎ターンHP+20回復');
    y1 = LN(c1x + 4, y1, '射程2ユニットは移動後も射撃攻撃が可能');
    y1 = LN(c1x + 4, y1, '遠距離攻撃を受けた場合は反撃ダメなし');

    // ════════════════════════════════════════════════════════════════════════
    // Column 2 — ユニット一覧 + 説明
    // ════════════════════════════════════════════════════════════════════════
    let y2 = cy0;

    y2 = SEC(c2x, y2, ' ユニット一覧');

    // Table header row
    g.fillStyle(0x1a2c3c, 1);
    g.fillRect(c2x, y2, cw, 16);
    const TH = (x, y, txt, col = '#666') => HT(x, y + 1, txt, 9, col);
    TH(c2x + 2,   y2, '名前');
    TH(c2x + 100, y2, 'ATK', '#ff8a65');
    TH(c2x + 126, y2, 'DEF', '#81c784');
    TH(c2x + 154, y2, ' HP', '#aaa');
    TH(c2x + 182, y2, 'MOV', '#4fc3f7');
    TH(c2x + 208, y2, 'RNG', '#ffd54f');
    TH(c2x + 234, y2, '必要テク');
    y2 += 17;

    const unitRows = [
      { id: 'WARRIOR',  tech: '−' },
      { id: 'ARCHER',   tech: 'Archery' },
      { id: 'SETTLER',  tech: '− (開拓)' },
      { id: 'SPEARMAN', tech: 'Bronze W.' },
      { id: 'KNIGHT',   tech: 'Horseback R.' },
    ];
    for (let i = 0; i < unitRows.length; i++) {
      const { id, tech } = unitRows[i];
      const u = UNITS[id];
      if (i % 2 === 0) { g.fillStyle(0x14222e, 0.8); g.fillRect(c2x, y2, cw, 15); }
      TH(c2x + 2,   y2, `[${u.sym}] ${u.name}`, '#ccc');
      TH(c2x + 102, y2, String(u.atk),            '#ff8a65');
      TH(c2x + 128, y2, String(u.def),            '#81c784');
      TH(c2x + 156, y2, String(u.maxHp),          '#aaa');
      TH(c2x + 184, y2, String(u.mov),            '#4fc3f7');
      TH(c2x + 210, y2, u.range > 0 ? String(u.range) : '−', '#ffd54f');
      TH(c2x + 236, y2, tech,                     '#777');
      y2 += 15;
    }
    y2 += 7;

    // Unit descriptions
    y2 = SEC(c2x, y2, ' ユニット詳細');

    const unitDescs = [
      { id: 'WARRIOR',  d1: '序盤の主力歩兵。安価で生産しやすい。',   d2: '移動2/射程1。攻防バランスが取れた基本ユニット。' },
      { id: 'ARCHER',   d1: '射程2の弓兵。遠距離から安全に攻撃。',    d2: '射撃時は反撃なし。防御が低いため護衛が必要。' },
      { id: 'SETTLER',  d1: '新都市を建設する開拓者ユニット。',        d2: '建設後に消滅。戦闘力が低いため護衛推奨。' },
      { id: 'SPEARMAN', d1: '重装歩兵。高い防御力を誇る前線の盾。',    d2: 'ATK30/DEF28で均衡。Bronze Working必須。' },
      { id: 'KNIGHT',   d1: '移動力4の騎士。高機動・高攻撃力。',       d2: 'コスト100が重いが戦況を一変させる力あり。' },
    ];
    for (const { id, d1, d2 } of unitDescs) {
      const u = UNITS[id];
      const icX = c2x + 10, icY = y2 + 10;
      g.fillStyle(CIV_DATA[0].unitBg, 0.85);
      g.fillCircle(icX, icY, 9);
      HT(icX, icY, u.sym, 9, '#fff', true, true);
      HT(c2x + 24, y2,      u.name, 10, '#ddd', true);
      HT(c2x + 24, y2 + 13, d1,     9,  '#888');
      HT(c2x + 24, y2 + 24, d2,     9,  '#666');
      y2 += 39;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Column 3 — 地形 / 建物 / 技術ツリー
    // ════════════════════════════════════════════════════════════════════════
    let y3 = cy0;

    y3 = SEC(c3x, y3, ' 地形一覧');

    g.fillStyle(0x1a2c3c, 1);
    g.fillRect(c3x, y3, cw, 16);
    TH(c3x + 2,   y3, '地形(日本語名)');
    TH(c3x + 162, y3, '食', '#81c784');
    TH(c3x + 188, y3, '生', '#ffb74d');
    TH(c3x + 214, y3, '金', '#ffd54f');
    TH(c3x + 240, y3, '移', '#4fc3f7');
    y3 += 17;

    const terrainRows = [
      ['GRASSLAND', '草原'],   ['PLAINS',    '平原'],
      ['HILLS',     '丘陵'],   ['FOREST',    '森林'],
      ['DESERT',    '砂漠'],   ['SNOW',      '凍土'],
      ['WATER',     '海水'],   ['MOUNTAIN',  '山岳'],
    ];
    for (let i = 0; i < terrainRows.length; i++) {
      const [id, jp] = terrainRows[i];
      const ter = TERRAIN[id];
      if (i % 2 === 0) { g.fillStyle(0x14222e, 0.8); g.fillRect(c3x, y3, cw, 15); }
      g.fillStyle(ter.color, 0.9);
      g.fillRect(c3x + 1, y3 + 2, 5, 11);
      TH(c3x + 10, y3, `${ter.name} (${jp})`, '#bbb');
      if (!ter.passable) {
        TH(c3x + 166, y3, '通行不可', '#555');
      } else {
        TH(c3x + 164, y3, String(ter.food),     '#81c784');
        TH(c3x + 190, y3, String(ter.prod),     '#ffb74d');
        TH(c3x + 216, y3, String(ter.gold),     '#ffd54f');
        TH(c3x + 242, y3, String(ter.moveCost), '#4fc3f7');
      }
      y3 += 15;
    }
    y3 += 7;

    y3 = SEC(c3x, y3, ' 建物一覧');

    g.fillStyle(0x1a2c3c, 1);
    g.fillRect(c3x, y3, cw, 16);
    TH(c3x + 2,   y3, '建物名');
    TH(c3x + 110, y3, '食', '#81c784');
    TH(c3x + 130, y3, '生', '#ffb74d');
    TH(c3x + 150, y3, '金', '#ffd54f');
    TH(c3x + 170, y3, '科', '#4fc3f7');
    TH(c3x + 194, y3, '費用');
    TH(c3x + 236, y3, '必要テク');
    y3 += 17;

    const bldgRows = [
      { id: 'GRANARY',  tech: 'Pottery' },
      { id: 'WORKSHOP', tech: '−' },
      { id: 'MARKET',   tech: '−' },
      { id: 'BARRACKS', tech: 'Bronze W.' },
      { id: 'LIBRARY',  tech: 'Writing' },
    ];
    for (let i = 0; i < bldgRows.length; i++) {
      const { id, tech } = bldgRows[i];
      const b = BUILDINGS[id];
      if (i % 2 === 0) { g.fillStyle(0x14222e, 0.8); g.fillRect(c3x, y3, cw, 15); }
      TH(c3x + 2,   y3, b.name,                                '#ccc');
      TH(c3x + 110, y3, b.food    > 0 ? `+${b.food}`    : '−', '#81c784');
      TH(c3x + 130, y3, b.prod    > 0 ? `+${b.prod}`    : '−', '#ffb74d');
      TH(c3x + 150, y3, b.gold    > 0 ? `+${b.gold}`    : '−', '#ffd54f');
      TH(c3x + 170, y3, b.science > 0 ? `+${b.science}` : '−', '#4fc3f7');
      TH(c3x + 194, y3, `${b.cost}⚒`,                          '#aaa');
      TH(c3x + 236, y3, tech,                                   '#777');
      y3 += 15;
    }
    HT(c3x + 4, y3 + 1, '※Barracks: 都市駐留ユニットのHP回復量+', 9, '#555');
    y3 += 16;
    y3 += 7;

    y3 = SEC(c3x, y3, ` 技術ツリー  (全9種 / ${MAX_TECHS_WIN}種研究で科学勝利)`);

    const treeLines = [
      ['Pottery(35)  → Writing(80) → Mathematics(120)',       '#4fc3f7'],
      ['             Writing → Library 建設可能',              '#666'],
      ['Archery(40)  → Archer 生産可能',                       '#4fc3f7'],
      ['Bronze W.(65) → Spearman, Barracks 解放',             '#4fc3f7'],
      ['               → Iron Working(100)',                   '#666'],
      ['               → Currency(80) → Market 建設可能',     '#666'],
      ['Animal H.(40) → Horseback Riding(100)',                '#4fc3f7'],
      ['               → Knight 生産可能',                    '#666'],
    ];
    for (const [txt, col] of treeLines) {
      HT(c3x + 4, y3, txt, 9, col);
      y3 += 13;
    }
    HT(c3x + 4, y3 + 3, '費用の単位は 🔬(サイエンス)', 9, '#555');

    // ── Blocking zone: prevent panel/map zones from firing while help is open ─
    const bz = this.add.zone(0, 0, CANVAS_W, CANVAS_H).setOrigin(0, 0).setInteractive().setDepth(D);
    this.helpObjs.push(bz);
  }

  clearGameOverLayer() {
    this.gfxGameOver.clear();
    this.clearTextPool(this.goTexts);
    this.goBtns.forEach(({ g2, t, zone }) => { g2.destroy(); t.destroy(); zone.destroy(); });
    this.goBtns = [];
  }

  drawGameOverLayer() {
    this.clearGameOverLayer();
    const g = this.gfxGameOver;
    const gs = this.gs;
    const winner = CIV_DATA[gs.winner].name;
    const isPlayer = gs.winner === 0;
    const reasonLabel = {
      domination: 'ドミネーション勝利',
      science:    '科学勝利',
      score:      'スコア勝利',
    }[gs.winReason] ?? '勝利';

    // Full-screen dim overlay
    g.fillStyle(0x000000, 0.72);
    g.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Centered dialog box
    const bw = 420, bh = 230;
    const bx = (CANVAS_W - bw) / 2;
    const by = (CANVAS_H - bh) / 2;
    g.fillStyle(0x1a1a2e, 1);
    g.fillRoundedRect(bx, by, bw, bh, 12);
    g.lineStyle(2, isPlayer ? 0x81c784 : 0xef9a9a, 1);
    g.strokeRoundedRect(bx, by, bw, bh, 12);

    const cx = CANVAS_W / 2;
    const DEPTH = 100;
    this.addGOText(cx, by + 28,  'ゲーム終了',                   28, '#ffd700', true,  DEPTH);
    this.addGOText(cx, by + 72,  `${winner} の${reasonLabel}！`, 22, isPlayer ? '#81c784' : '#ef9a9a', true, DEPTH);
    this.addGOText(cx, by + 110,
      reasonLabel === '科学勝利'          ? '全テクノロジーを研究しました'   :
      reasonLabel === 'ドミネーション勝利' ? '全首都を占領しました'           :
                                            'ターン終了時のスコアで判定されました',
      13, '#888', true, DEPTH);
    this.addGOBtn(bx + 40, by + 152, bw - 80, 38, 'もう一度プレイ（新規ゲーム）',
      () => this.newGame(), COL.btnEnd, DEPTH);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  drawBar(g, x, y, w, h, pct, bgColor, fillColor) {
    g.fillStyle(bgColor, 1); g.fillRect(x, y, w, h);
    g.fillStyle(fillColor, 1); g.fillRect(x, y, Math.round(w * Math.min(1, Math.max(0, pct))), h);
  }

  addPText(x, y, text, size = 13, fill = COL.text, bold = false, center = false) {
    const t = this.add.text(x, y, text, {
      fontSize: `${size}px`, fill,
      fontFamily: 'monospace', fontStyle: bold ? 'bold' : 'normal',
    });
    if (center) t.setOrigin(0.5, 0);
    this.panelTexts.push(t);
    return t;
  }

  addPBtn(x, y, w, h, label, action, bg = COL.btn) {
    const g2 = this.add.graphics();
    g2.fillStyle(bg, 1); g2.fillRoundedRect(x, y, w, h, 4);
    g2.lineStyle(1, 0x444444); g2.strokeRoundedRect(x, y, w, h, 4);

    const t = this.add.text(x + w / 2, y + h / 2, label, {
      fontSize: '12px', fill: '#e0e0e0', fontFamily: 'monospace',
    }).setOrigin(0.5, 0.5);

    const zone = this.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive();
    zone.on('pointerover', () => { g2.clear(); g2.fillStyle(COL.btnHov, 1); g2.fillRoundedRect(x, y, w, h, 4); g2.lineStyle(1, 0x666666); g2.strokeRoundedRect(x, y, w, h, 4); });
    zone.on('pointerout',  () => { g2.clear(); g2.fillStyle(bg, 1); g2.fillRoundedRect(x, y, w, h, 4); g2.lineStyle(1, 0x444444); g2.strokeRoundedRect(x, y, w, h, 4); });
    zone.on('pointerdown', () => { if (!this.helpOpen) action(); });

    this.panelBtns.push({ g2, t, zone });
  }

  addGOText(x, y, text, size, fill, center, depth) {
    const t = this.add.text(x, y, text, {
      fontSize: `${size}px`, fill, fontFamily: 'monospace',
    }).setDepth(depth);
    if (center) t.setOrigin(0.5, 0);
    this.goTexts.push(t);
  }

  addGOBtn(x, y, w, h, label, action, bg, depth) {
    const g2 = this.add.graphics().setDepth(depth);
    g2.fillStyle(bg, 1); g2.fillRoundedRect(x, y, w, h, 4);
    g2.lineStyle(1, 0x444444); g2.strokeRoundedRect(x, y, w, h, 4);
    const t = this.add.text(x + w / 2, y + h / 2, label, {
      fontSize: '12px', fill: '#e0e0e0', fontFamily: 'monospace',
    }).setOrigin(0.5, 0.5).setDepth(depth);
    const zone = this.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive().setDepth(depth);
    zone.on('pointerover', () => { g2.clear(); g2.fillStyle(COL.btnHov, 1); g2.fillRoundedRect(x, y, w, h, 4); });
    zone.on('pointerout',  () => { g2.clear(); g2.fillStyle(bg, 1); g2.fillRoundedRect(x, y, w, h, 4); });
    zone.on('pointerdown', () => action());
    this.goBtns.push({ g2, t, zone });
  }

  clearTextPool(pool) {
    pool.forEach(t => t.destroy());
    pool.length = 0;
  }

  destroyPanelBtns() {
    for (const { g2, t, zone } of this.panelBtns) {
      g2.destroy(); t.destroy(); zone.destroy();
    }
    this.panelBtns.length = 0;
    this.clearTextPool(this.panelTexts);
  }

  deselect() {
    this.selectedUnit = null;
    this.selectedCity = null;
  }

  // ─── Input ───────────────────────────────────────────────────────────────────

  onPointerMove(pointer) {
    const { x, y } = pointer;

    // Hamburger hover effect (coordinate-based, no zone events needed)
    const { x: hx, y: hy, w: hw, h: hh } = GameScene.HAM;
    const overHam = x >= hx && x <= hx + hw && y >= hy && y <= hy + hh;
    const wantActive = overHam || this.menuOpen;
    if (wantActive !== this._hamActive) {
      this._hamActive = wantActive;
      this._redrawHamBtn(wantActive);
    }

    // Dropdown item hover (coordinate-based highlight)
    if (this.menuOpen && this.menuBtns.length) {
      let hovIdx = -1;
      this.menuBtns.forEach(({ x: ix, y: iy, w: iw, h: ih }, idx) => {
        if (x >= ix && x <= ix + iw && y >= iy && y <= iy + ih) hovIdx = idx;
      });
      if (hovIdx !== this._menuItemHov) {
        this._menuItemHov = hovIdx;
        this.menuBtns.forEach(({ drawBg, bg }, idx) => drawBg(idx === hovIdx ? COL.btnHov : bg));
      }
    }

    // Map hover highlight
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor((y - TOP_BAR_H) / TILE_SIZE);
    if (tx !== this.hovX || ty !== this.hovY) {
      this.hovX = tx; this.hovY = ty; this.dirty = true;
    }
  }

  onPointerDown(pointer) {
    if (this.gs.gameOver) return;
    const { x, y } = pointer;

    // ── Hamburger button (coordinate-based, bypasses Phaser zone events) ──────
    const { x: hx, y: hy, w: hw, h: hh } = GameScene.HAM;
    if (x >= hx && x <= hx + hw && y >= hy && y <= hy + hh) {
      this.menuOpen = !this.menuOpen;
      this._hamActive = this.menuOpen;
      this._redrawHamBtn(this.menuOpen);
      this.dirty = true;
      return;
    }

    // ── Dropdown area ─────────────────────────────────────────────────────────
    const { dw, pad, itemH, itemGap } = GameScene.DROP;
    const dropY = hy + hh + 4;
    const dropH  = pad + itemH + itemGap + itemH + pad;
    if (this.menuOpen && x >= hx && x <= hx + dw && y >= dropY && y <= dropY + dropH) {
      const itemX = hx + pad, itemW = dw - pad * 2;
      const item0Y = dropY + pad;
      const item1Y = item0Y + itemH + itemGap;
      if (x >= itemX && x <= itemX + itemW) {
        if (y >= item0Y && y <= item0Y + itemH) {
          // ヘルプ
          this.menuOpen = false; this._hamActive = false; this._redrawHamBtn(false);
          this.helpOpen = true; this.dirty = true;
        } else if (y >= item1Y && y <= item1Y + itemH) {
          // 新規ゲーム
          this.menuOpen = false; this._hamActive = false; this._redrawHamBtn(false); this.dirty = true;
          if (confirm('保存データを削除して新規ゲームを開始しますか？')) this.newGame();
        }
      }
      return; // consumed by dropdown area regardless
    }

    // ── Close menu if clicking outside ───────────────────────────────────────
    if (this.menuOpen) {
      this.menuOpen = false; this._hamActive = false; this._redrawHamBtn(false); this.dirty = true;
    }

    // ── Help dialog ──────────────────────────────────────────────────────────
    if (this.helpOpen) {
      const c = this._helpCloseBtn;
      if (c && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
        this.helpOpen = false; this.dirty = true;
      }
      return; // block all map / panel interactions while help is open
    }

    if (x >= PANEL_X) return; // Panel handled by zones
    if (y < TOP_BAR_H) return;

    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor((y - TOP_BAR_H) / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return;

    this.handleMapClick(tx, ty);
  }

  handleMapClick(tx, ty) {
    const gs = this.gs;
    const clickedUnit = gs.getUnitAt(tx, ty);
    const clickedCity = gs.getCityAt(tx, ty);

    if (this.selectedUnit) {
      const su = this.selectedUnit;

      // Attack enemy unit
      if (clickedUnit && clickedUnit.civIndex !== su.civIndex) {
        const ar = gs.getAttackRange(su);
        if (ar.has(`${tx},${ty}`) && !su.hasActed && UNITS[su.type].atk > 0) {
          const res = gs.attack(su, clickedUnit);
          if (res.atkDied) this.selectedUnit = null;
          this.saveGame();
          this.dirty = true;
          return;
        }
      }

      // Attack enemy city
      if (clickedCity && clickedCity.civIndex !== su.civIndex) {
        const ar = gs.getAttackRange(su);
        if (ar.has(`${tx},${ty}`) && !su.hasActed && UNITS[su.type].atk > 0) {
          const res = gs.attackCity(su, clickedCity);
          if (res.atkDied) this.selectedUnit = null;
          this.saveGame();
          this.dirty = true;
          return;
        }
      }

      // Move
      const mr = gs.getMovementRange(su);
      const key = `${tx},${ty}`;
      if (mr.has(key) && su.movesLeft > 0 && !clickedUnit) {
        gs.moveUnit(su, tx, ty);
        this.saveGame();
        this.dirty = true;
        return;
      }

      // Deselect then re-evaluate
      this.selectedUnit = null;
      this.panelMode = 'overview';
    }

    // Select player unit
    if (clickedUnit?.civIndex === 0) {
      this.selectedUnit = clickedUnit;
      this.selectedCity = null;
      this.panelMode = 'overview';
      this.dirty = true;
      return;
    }

    // Select city
    if (clickedCity) {
      this.selectedCity = clickedCity;
      this.selectedUnit = null;
      this.panelMode = clickedCity.civIndex === 0 ? 'overview' : 'overview';
      this.dirty = true;
      return;
    }

    this.deselect();
    this.panelMode = 'overview';
    this.dirty = true;
  }

  doEndTurn() {
    if (this.gs.gameOver) return;
    this.deselect();
    this.panelMode = 'overview';
    this.gs.endTurn();
    this.saveGame();
    this.dirty = true;
  }

  saveGame() {
    try {
      localStorage.setItem('minisiv_save', this.gs.save());
    } catch(e) {
      console.warn('Save failed:', e.message);
    }
  }

  newGame() {
    localStorage.removeItem('minisiv_save');
    this.scene.restart();
  }

  showFloatText(worldX, worldY, text, color = '#fff') {
    const t = this.add.text(worldX, worldY, text, {
      fontSize: '16px', fill: color, fontStyle: 'bold',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5, 1);
    this.tweens.add({ targets: t, y: worldY - 48, alpha: 0, duration: 1400, onComplete: () => t.destroy() });
  }
}
