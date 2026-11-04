/**
 * Game rules that the tech-tree prototypes vary. One codebase, several rulesets;
 * pick one per match (New match dialog, or ?rules=... in the URL).
 */
export type Ruleset = {
  id: 'classic' | 'streamlined';
  name: string;
  blurb: string;
  /** hard: can't train past the cap (Starcraft). soft: you can, but over-cap units train 3x slower. */
  supply: 'hard' | 'soft';
  /** attached: add-ons sit beside their building and need free ground. inplace: no footprint. */
  addons: 'attached' | 'inplace';
  /** manual: siege and stim only happen when a rule (or you) says so. auto: units use them by themselves. */
  abilities: 'manual' | 'auto';
};

export const RULESETS: Record<Ruleset['id'], Ruleset> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    blurb: 'Starcraft rules: hard supply cap, add-ons need room beside their building, siege and stim only when told.',
    supply: 'hard',
    addons: 'attached',
    abilities: 'manual',
  },
  streamlined: {
    id: 'streamlined',
    name: 'Streamlined',
    blurb: 'Automation-friendly: soft supply cap (over-cap units train 3× slower), add-ons have no footprint, tanks siege and bio stims by themselves.',
    supply: 'soft',
    addons: 'inplace',
    abilities: 'auto',
  },
};

/** Over the soft cap, production runs this many times slower. */
export const SOFT_CAP_SLOWDOWN = 3;
