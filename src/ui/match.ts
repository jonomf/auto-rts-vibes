import type { Game } from '../game';
import { SCENARIOS, type ScenarioId } from '../sim/scenario';
import { RULESETS, type Ruleset } from '../sim/ruleset';
import { PRESETS, type PresetId } from '../automation/presets';
import { nodeCount } from '../automation/blocks';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The New match dialog: scenario × rules × program. */
export class MatchDialog {
  private scenario: ScenarioId;
  private rules: Ruleset['id'];
  private program: PresetId | 'keep' = 'keep';

  constructor(
    private readonly el: HTMLElement,
    private readonly opener: HTMLElement,
    private readonly game: Game,
  ) {
    this.scenario = game.scenarioId;
    this.rules = game.rulesetId;
    opener.addEventListener('click', () => this.open());
    el.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el.classList.contains('open')) el.classList.remove('open');
    });
  }

  /** Top-bar label: current scenario and rules. */
  update(): void {
    const label = `${SCENARIOS[this.game.scenarioId].name} · ${RULESETS[this.game.rulesetId].name}`;
    if (this.opener.textContent !== label) this.opener.textContent = label;
  }

  open(): void {
    this.scenario = this.game.scenarioId;
    this.rules = this.game.rulesetId;
    this.program = 'keep';
    this.render();
    this.el.classList.add('open');
  }

  private render(): void {
    const card = (group: string, id: string, on: boolean, title: string, body: string, extra = '') =>
      `<button class="mcard${on ? ' on' : ''}" data-${group}="${id}"><b>${esc(title)}</b><span>${esc(body)}</span>${extra}</button>`;
    const scen = Object.values(SCENARIOS)
      .map((s) => card('scen', s.id, s.id === this.scenario, s.name, s.blurb, `<em>${esc(s.hint)}</em>`))
      .join('');
    const rules = Object.values(RULESETS)
      .map((r) => card('rules', r.id, r.id === this.rules, r.name, r.blurb))
      .join('');
    const n = nodeCount(this.game.program);
    const progs =
      card('prog', 'keep', this.program === 'keep', 'Keep my program', n ? `${n} blocks` : 'empty: units will stand still') +
      Object.entries(PRESETS)
        .map(([id, p]) => card('prog', id, this.program === id, p.name, p.blurb))
        .join('');
    this.el.innerHTML = `<div class="sheet">
      <div class="sheet-head"><h2>New match</h2><button data-close>✕</button></div>
      <h3>Scenario</h3><div class="mgrid">${scen}</div>
      <h3>Rules</h3><div class="mgrid two">${rules}</div>
      <h3>Program</h3><div class="mgrid">${progs}</div>
      ${this.program !== 'keep' ? '<p class="warnline">Loading an example replaces your current program (copy it from the editor’s JSON button first if you want to keep it).</p>' : ''}
      <div class="mfoot"><button class="go" data-start>Start match</button></div>
    </div>`;
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t === this.el || t.closest('[data-close]')) {
      this.el.classList.remove('open');
      return;
    }
    const pick = t.closest<HTMLElement>('[data-scen],[data-rules],[data-prog]');
    if (pick) {
      if (pick.dataset.scen) this.scenario = pick.dataset.scen as ScenarioId;
      if (pick.dataset.rules) this.rules = pick.dataset.rules as Ruleset['id'];
      if (pick.dataset.prog) this.program = pick.dataset.prog as PresetId | 'keep';
      this.render();
      return;
    }
    if (t.closest('[data-start]')) {
      if (this.program !== 'keep') this.game.replaceProgram(PRESETS[this.program].make());
      this.game.newMatchWith(this.scenario, this.rules);
      this.el.classList.remove('open');
      this.game.notify(`${SCENARIOS[this.scenario].name} · ${RULESETS[this.rules].name}`);
    }
  }
}
