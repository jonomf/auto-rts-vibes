/** Debug helper: run one program on one scenario and print a timeline. bun scripts/watch.ts starter range classic */
import { createScenario, type ScenarioId } from '../src/sim/scenario';
import { RULESETS } from '../src/sim/ruleset';
import { PRESETS, type PresetId } from '../src/automation/presets';
import { DEFS } from '../src/sim/defs';

const [preset = 'starter', scen = 'range', rules = 'classic', minutes = '8'] = process.argv.slice(2);
const w = createScenario(scen as ScenarioId, RULESETS[rules as 'classic']);
w.program = PRESETS[preset as PresetId].make();
const snap = () => {
  const c: Record<string, number> = {};
  for (const e of w.all()) if (e.team === 0) { const k = e.def + (e.complete ? '' : '*') + (e.addon ? `[${e.addon}]` : ''); c[k] = (c[k] ?? 0) + 1; }
  const s = w.supply(0);
  const enemies = w.list((e) => e.team === 1).length;
  const bs = w.list((e) => e.team === 0 && DEFS[e.def].category === 'building' && !!DEFS[e.def].trains).map((b) => `${b.def}(${b.stock.minerals},${b.stock.gas})q${b.queue.length}`).join(' ');
  return `t=${Math.round(w.seconds)} step=${w.auto.step} [${w.auto.stepStatus}] ${w.auto.posture} supply=${s.used}/${s.cap} enemies=${enemies} lost=${w.stats.lostUnits[0]}\n   ${JSON.stringify(c)}\n   ${bs}`;
};
const end = Number(minutes) * 60;
for (let t = 30; t <= end; t += 30) {
  w.stepSeconds(30);
  console.log(snap());
  if (w.list((e) => e.team === 1).length === 0) { console.log('CLEARED at', w.seconds); break; }
}
