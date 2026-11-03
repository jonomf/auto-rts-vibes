import { createSandbox } from './sim/scenario';
import { Game } from './game';
import { Renderer } from './render/renderer';
import { Input } from './input/input';
import { Hud } from './ui/hud';

const root = document.getElementById('app')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;

const world = createSandbox();
const game = new Game(world);
const renderer = new Renderer(canvas, game);
const input = new Input(canvas, game);
const hud = new Hud(root, game);

// Start centered between the base and the mineral line.
const home = world.list((e) => e.def === 'home')[0];
game.camera.x = home.x + 6;
game.camera.y = home.y;

const resize = () => renderer.resize();
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let hudTimer = 0;
let hudVersion = -1;

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.update(dt);
  const alpha = game.frame(dt);
  renderer.render(alpha);

  hudTimer += dt;
  if (hudTimer > 0.1 || hudVersion !== game.uiVersion) {
    hudTimer = 0;
    hudVersion = game.uiVersion;
    hud.update();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the sim from the console.
Object.assign(window, { game, world });
