import { GameScene } from './GameScene.js';
import { CANVAS_W, CANVAS_H } from './data.js';

new Phaser.Game({
  type: Phaser.AUTO,
  width: CANVAS_W,
  height: CANVAS_H,
  backgroundColor: '#050505',
  scene: [GameScene],
  parent: 'game-container',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});
