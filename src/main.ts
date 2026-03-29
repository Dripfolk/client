// Entry point for the Shadow Creatures client.

import { Game } from './Game';

const canvas = document.getElementById('c') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('Canvas element #c not found');
}

const game = new Game(canvas);
game.start().catch((err) => {
  console.error('Failed to start game:', err);
});
