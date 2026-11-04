import { Game } from './game';
import { Renderer } from './render/renderer';
import { Input } from './input/input';
import { Hud } from './ui/hud';
import { Editor } from './ui/editor';
import { MatchDialog } from './ui/match';

const root = document.getElementById('app')!;
const canvas = document.getElementById('view') as HTMLCanvasElement;

const game = new Game();
const renderer = new Renderer(canvas, game);
const input = new Input(canvas, game);
const hud = new Hud(root, game);
const editor = new Editor(root, game);
const match = new MatchDialog(root.querySelector('[data-match]')!, root.querySelector('[data-match-open]')!, game);

// Start framed on the main base and its build area.
const home = game.world.list((e) => e.def === 'commandCenter')[0];
game.camera.x = home.x + 9;
game.camera.y = home.y;
game.camera.zoom = 22;

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
    editor.update();
    match.update();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Handy for poking at the sim from the console.
Object.assign(window, { game });
