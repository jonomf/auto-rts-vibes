/**
 * Strategy lab: every preset program × scenario × ruleset, headless and deterministic.
 *   bun scripts/lab.ts                  -> table on stdout, JSON to lab-results.json
 *   bun scripts/lab.ts --minutes 10     -> longer time limit
 */
import { createScenario, SCENARIOS, type ScenarioId } from '../src/sim/scenario';
import { RULESETS, type Ruleset } from '../src/sim/ruleset';
import { PRESETS, type PresetId } from '../src/automation/presets';
import type { Program } from '../src/automation/types';
import { DEFS } from '../src/sim/defs';
import { writeFileSync } from 'node:fs';

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

if (import.meta.main) {
  const args = process.argv.slice(2);
  const minutes = Number(args[args.indexOf('--minutes') + 1] || 8);
  const only = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
  const results: LabResult[] = [];
  const fmt = (s: number | null) => (s === null ? '  —  ' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
  for (const rules of Object.values(RULESETS))
    for (const [id, p] of Object.entries(PRESETS)) {
      if (only && only !== id) continue;
      const row: string[] = [];
      for (const scen of Object.keys(SCENARIOS) as ScenarioId[]) {
        const t0 = performance.now();
        const r = runMatch(p.make(), scen, rules, minutes * 60, id);
        results.push(r);
        row.push(`${fmt(r.clear)}${r.clear === null ? `(${r.enemyLeft} left)` : ''} lost ${r.lostUnits} ${Math.round(performance.now() - t0)}ms`);
      }
      console.log(`${rules.id.padEnd(11)} ${(id as PresetId).padEnd(8)} ${row.join(' | ')}`);
    }
  writeFileSync('lab-results.json', JSON.stringify(results, null, 1));
}
