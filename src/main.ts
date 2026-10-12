import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const app = document.querySelector<HTMLElement>('#app');

if (!canvas || !app) {
  throw new Error('Missing #game-canvas or #app element.');
}

const game = new Game(canvas, app);
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
