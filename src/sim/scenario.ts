import { ENEMY, NEUTRAL, PLAYER } from './types';
import { World } from './world';

/**
 * The M1 sandbox map: one base with minerals and gas, a second mining spot for an
 * expansion, and a field of inert enemy targets on the right to shoot at.
 */
export function createSandbox(): World {
  const world = new World({ width: 64, height: 44 });

  // Main base (Unity scene: Home Building + Minerals/Gas Sources + Gatherers).
  const home = world.spawn('commandCenter', PLAYER, 11, 22);
  home.stock.minerals = 50;

  for (const [x, y] of [
    [4.6, 15.6],
    [3.9, 17.8],
    [3.5, 20.0],
    [3.4, 22.2],
    [3.5, 24.4],
    [3.9, 26.6],
    [4.6, 28.8],
  ])
    world.spawn('mineralSource', NEUTRAL, x, y);
  world.spawn('gasSource', NEUTRAL, 11, 14.5);
  world.spawn('gasSource', NEUTRAL, 11, 29.5);

  for (let i = 0; i < 4; i++) world.spawn('scv', PLAYER, 8, 19.8 + i * 1.5);

  // Expansion site (bottom middle).
  for (const [x, y] of [
    [27, 40.5],
    [29.2, 41],
    [31.4, 41],
    [33.6, 40.5],
  ])
    world.spawn('mineralSource', NEUTRAL, x, y);
  world.spawn('gasSource', NEUTRAL, 37.5, 38.5);

  // Combat sandbox: inert targets.
  world.spawn('dummyBunker', ENEMY, 56, 22);
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 2; col++)
      world.spawn('dummy', ENEMY, 50 + col * 1.6, 17.5 + row * 3);

  return world;
}
