import type { UiAction } from './actions';

/** Small line icons for the command card, 24x24, using currentColor. */
const paths: Record<UiAction['icon'], string> = {
  move: '<path d="M4 12h13M12 6l6 6-6 6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  attack: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  build: '<path d="M4 20h16M6 20V10l6-5 6 5v10"/><path d="M10 20v-5h4v5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  program: '<rect x="4" y="5" width="16" height="4" rx="1.5"/><rect x="7" y="11" width="13" height="4" rx="1.5"/><rect x="7" y="17" width="9" height="3" rx="1.2"/><path d="M5 9v9.5h2"/>',
  home: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 13l4-4 4 4M9.5 12v4.5h5V12"/>',
  infantryTraining:
    '<rect x="4" y="4" width="16" height="16" rx="2.5"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="10" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M8.5 13v3M12 13v3M15.5 13v3"/>',
  mechFactory:
    '<rect x="4" y="4" width="16" height="16" rx="2.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.3"/>',
  port: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><circle cx="12" cy="12" r="5"/><path d="M10 9v6M14 9v6M10 12h4"/>',
  gatherer: '<circle cx="10" cy="13" r="5"/><path d="M13.5 10l5-5"/><path d="M17.5 3.5l3 3"/>',
  lightInfantry: '<circle cx="10" cy="13" r="4.5"/><path d="M12.5 11l7-5"/>',
  heavyInfantry: '<circle cx="10" cy="13" r="5.5"/><circle cx="10" cy="13" r="2" fill="currentColor"/><path d="M14 10l6-4"/>',
  tank: '<rect x="3.5" y="8" width="13" height="9" rx="2"/><circle cx="10" cy="12.5" r="2.4"/><path d="M12 12.5h9"/>',
  ship: '<path d="M20 12L5 5.5 8 12l-3 6.5z"/>',
  mineralSource: '<path d="M12 3l4 6-1.5 9h-5L8 9z"/>',
  gasSource: '<rect x="5" y="5" width="14" height="14" rx="4"/><circle cx="12" cy="12" r="3.5"/>',
  dummy: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  dummyBunker: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 14l10-10M8 20L20 8M14 20l6-6"/>',
};

export const icon = (name: UiAction['icon']): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
