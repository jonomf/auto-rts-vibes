import type { UiAction } from './actions';

/** Small line icons for the command card, 24x24, using currentColor. */
const paths: Record<UiAction['icon'], string> = {
  move: '<path d="M4 12h13M12 6l6 6-6 6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  attack: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  build: '<path d="M4 20h16M6 20V10l6-5 6 5v10"/><path d="M10 20v-5h4v5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  program: '<rect x="4" y="5" width="16" height="4" rx="1.5"/><rect x="7" y="11" width="13" height="4" rx="1.5"/><rect x="7" y="17" width="9" height="3" rx="1.2"/><path d="M5 9v9.5h2"/>',
  commandCenter: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 13l4-4 4 4M9.5 12v4.5h5V12"/>',
  barracks:
    '<rect x="4" y="4" width="16" height="16" rx="2.5"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="12" cy="10" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><path d="M8.5 13v3M12 13v3M15.5 13v3"/>',
  factory:
    '<rect x="4" y="4" width="16" height="16" rx="2.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.3"/>',
  starport: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><circle cx="12" cy="12" r="5"/><path d="M10 9v6M14 9v6M10 12h4"/>',
  scv: '<circle cx="10" cy="13" r="5"/><path d="M13.5 10l5-5"/><path d="M17.5 3.5l3 3"/>',
  marine: '<circle cx="10" cy="13" r="4.5"/><path d="M12.5 11l7-5"/>',
  marauder: '<circle cx="10" cy="13" r="5.5"/><circle cx="10" cy="13" r="2" fill="currentColor"/><path d="M14 10l6-4"/>',
  siegeTank: '<rect x="3.5" y="8" width="13" height="9" rx="2"/><circle cx="10" cy="12.5" r="2.4"/><path d="M12 12.5h9"/>',
  banshee: '<path d="M20 12L5 5.5 8 12l-3 6.5z"/>',
  supplyDepot: '<rect x="5" y="7" width="14" height="10" rx="1.5"/><path d="M5 12h14M9 7v10M15 7v10"/>',
  refinery: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 9h6v6H9z"/><path d="M12 5V3M12 21v-2"/>',
  techLab: '<rect x="6" y="8" width="12" height="11" rx="1.5"/><path d="M10 8V4h4v4M9 14h6"/>',
  reactor: '<rect x="6" y="6" width="12" height="12" rx="6"/><path d="M12 6v12M6 12h12"/>',
  medic: '<circle cx="12" cy="12" r="6"/><path d="M12 9v6M9 12h6"/>',
  hellion: '<path d="M4 15l8-7 8 7"/><path d="M12 8v-3"/><circle cx="7" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/>',
  viking: '<path d="M4 13l8-8 8 8-8 3z"/><path d="M12 16v4"/>',
  medivac: '<rect x="5" y="8" width="14" height="9" rx="4.5"/><path d="M12 10v5M9.5 12.5h5"/>',
  zergling: '<path d="M5 17c3-8 11-8 14 0"/><path d="M8 13l-3-4M16 13l3-4"/>',
  bunker: '<path d="M4 18h16V11l-3-4H7l-3 4z"/><path d="M8 13h8"/>',
  missileTurret: '<circle cx="12" cy="14" r="5"/><path d="M9 10l-2-5M15 10l2-5"/>',
  siege: '<path d="M3 18h18M7 18l3-6h4l3 6M12 12V5l6-1"/>',
  stim: '<path d="M14 3l-6 9h4l-2 9 6-10h-4z"/>',
  mineralSource: '<path d="M12 3l4 6-1.5 9h-5L8 9z"/>',
  gasSource: '<rect x="5" y="5" width="14" height="14" rx="4"/><circle cx="12" cy="12" r="3.5"/>',
  dummy: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  dummyBunker: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 14l10-10M8 20L20 8M14 20l6-6"/>',
};

export const icon = (name: UiAction['icon']): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
