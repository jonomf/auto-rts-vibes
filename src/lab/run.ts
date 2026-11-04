/**
 * Headless match runner for the strategy lab (pure TypeScript; runs in tests, scripts and the browser).
 */
import { createScenario, type ScenarioId } from '../sim/scenario';
import type { Ruleset } from '../sim/ruleset';
import type { Program } from '../automation/types';
import { DEFS } from '../sim/defs';

export type LabResult = {
  preset: string;
  scenario: ScenarioId;
  rules: Ruleset['id'];
  /** Seconds to destroy every enemy, or null if not done within the limit. */
  clear: number | null;
  enemyLeft: number;
  lostUnits: number;
  lostValue: number;
  killedValue: number;
  gathered: number;
  supplyBlocked: number;
  /** Resources sitting unused in Command Centers at the end (logistics backlog). */
  ccHoard: number;
  /** Army supply when the match ended. */
  army: Record<string, number>;
  /** Seconds at which the army went on the offense. */
  offenseAt: number | null;
};

export function runMatch(program: Program, scenario: ScenarioId, rules: Ruleset, limitSeconds: number, presetName = 'custom'): LabResult {
  const w = createScenario(scenario, rules);
  w.program = program;
  let clear: number | null = null;
  let offenseAt: number | null = null;
  const ticks = limitSeconds * 20;
  for (let t = 0; t < ticks; t++) {
    w.step();
    if (offenseAt === null && w.auto.posture === 'offense') offenseAt = w.seconds;
    if (t % 20 === 0 && w.list((e) => e.team === 1).length === 0) {
      clear = w.seconds;
      break;
    }
  }
  const army: Record<string, number> = {};
  for (const e of w.all()) if (e.team === 0 && DEFS[e.def].category === 'unit' && e.def !== 'scv') army[e.def] = (army[e.def] ?? 0) + 1;
  const cc = w.list((e) => e.team === 0 && e.def === 'commandCenter');
  return {
    preset: presetName,
    scenario,
    rules: rules.id,
    clear,
    enemyLeft: w.list((e) => e.team === 1).length,
    lostUnits: w.stats.lostUnits[0],
    lostValue: w.stats.lostValue[0],
    killedValue: w.stats.lostValue[1],
    gathered: w.stats.gathered.minerals + w.stats.gathered.gas,
    supplyBlocked: Math.round(w.stats.supplyBlocked),
    ccHoard: cc.reduce((s, c) => s + c.stock.minerals + c.stock.gas, 0),
    army,
    offenseAt,
  };
}
