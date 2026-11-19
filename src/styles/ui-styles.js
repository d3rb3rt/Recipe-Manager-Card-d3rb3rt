/**
 * Interface styles for Recipe Manager Card.
 *
 * "fresh" and "compact" use the same palettes as the Shopping List Manager card
 * (green and indigo) so both cards look like one product. "classic" keeps the
 * original named themes in THEME_VARS (recipe-manager-card.js).
 *
 * Components read these through CSS custom properties, which inherit into every
 * shadow root, so most of the restyle needs no prop drilling:
 *   --rm-bg-main / --rm-bg-surface / --rm-bg-elevated   backgrounds
 *   --rm-text / --rm-text-secondary / --rm-text-muted    text
 *   --rm-accent / --rm-accent-soft / --rm-accent-text    brand colour, its tint, text on the tint
 *   --rm-ink                                              text on an accent fill
 *   --rm-border / --rm-line                               card outline / row divider
 *   --rm-warn / --rm-danger                               star rating / favourite heart
 *   --rm-radius / --rm-radius-sm / --rm-radius-card       corner radii
 */

const SHARED_FRESH = {
  '--rm-radius': '22px',
  '--rm-radius-sm': '14px',
  '--rm-radius-card': '22px',
};

const SHARED_COMPACT = {
  '--rm-radius': '18px',
  '--rm-radius-sm': '12px',
  '--rm-radius-card': '18px',
};

export const UI_PALETTES = {
  fresh: {
    light: {
      '--rm-h1': '#0F7B5A', '--rm-h2': '#2A5DA8', '--rm-h3': '#9A5A0B', '--rm-h4': '#6A3FA8', '--rm-h5': '#0E6B7A', '--rm-h6': '#B03A6E',
      ...SHARED_FRESH,
      '--rm-bg-main': '#F3F6F4', '--rm-bg-surface': '#FFFFFF', '--rm-bg-elevated': '#E8EEEA',
      '--rm-text': '#12201B', '--rm-text-secondary': '#5A6B64', '--rm-text-muted': '#5A6B64',
      '--rm-accent': '#0F7B5A', '--rm-accent-soft': '#DDF1E8', '--rm-accent-text': '#0B6048',
      '--rm-ink': '#FFFFFF', '--rm-border': '#E3EAE6', '--rm-line': '#EEF2EF',
      '--rm-warn': '#9A5A0B', '--rm-danger': '#A32B2B',
      '--rm-shadow': '0 1px 3px rgba(18,32,27,0.10)',
      '--rm-shadow-float': '0 10px 30px rgba(18,32,27,0.14)',
    },
    dark: {
      '--rm-h1': '#5BD6A4', '--rm-h2': '#6CB6FF', '--rm-h3': '#FFB454', '--rm-h4': '#C79BFF', '--rm-h5': '#5CCBDC', '--rm-h6': '#FF8FB8',
      ...SHARED_FRESH,
      '--rm-bg-main': '#0F1714', '--rm-bg-surface': '#18231E', '--rm-bg-elevated': '#1F2D26',
      '--rm-text': '#E8F1EC', '--rm-text-secondary': '#9DB0A7', '--rm-text-muted': '#9DB0A7',
      '--rm-accent': '#3FBF92', '--rm-accent-soft': '#1B3A2F', '--rm-accent-text': '#7FE0BC',
      '--rm-ink': '#0B1A14', '--rm-border': '#26352E', '--rm-line': '#202D27',
      '--rm-warn': '#FFB454', '--rm-danger': '#FF8F8F',
      '--rm-shadow': '0 1px 3px rgba(0,0,0,0.4)',
      '--rm-shadow-float': '0 10px 30px rgba(0,0,0,0.5)',
    },
  },
  compact: {
    light: {
      '--rm-h1': '#0F7B5A', '--rm-h2': '#2A5DA8', '--rm-h3': '#9A5A0B', '--rm-h4': '#6A3FA8', '--rm-h5': '#0E6B7A', '--rm-h6': '#B03A6E',
      ...SHARED_COMPACT,
      '--rm-bg-main': '#F4F5F8', '--rm-bg-surface': '#FFFFFF', '--rm-bg-elevated': '#ECEEF3',
      '--rm-text': '#14161C', '--rm-text-secondary': '#5B6270', '--rm-text-muted': '#5B6270',
      '--rm-accent': '#4F5FD6', '--rm-accent-soft': '#E3E6FA', '--rm-accent-text': '#3A47B0',
      '--rm-ink': '#FFFFFF', '--rm-border': '#E1E4EB', '--rm-line': '#EDEFF4',
      '--rm-warn': '#9A5A0B', '--rm-danger': '#A32B2B',
      '--rm-shadow': '0 1px 3px rgba(18,32,27,0.10)',
      '--rm-shadow-float': '0 20px 50px rgba(20,22,28,0.18)',
    },
    dark: {
      '--rm-h1': '#5BD6A4', '--rm-h2': '#6CB6FF', '--rm-h3': '#FFB454', '--rm-h4': '#C79BFF', '--rm-h5': '#5CCBDC', '--rm-h6': '#FF8FB8',
      ...SHARED_COMPACT,
      '--rm-bg-main': '#0E1014', '--rm-bg-surface': '#171A20', '--rm-bg-elevated': '#1F232B',
      '--rm-text': '#ECEFF4', '--rm-text-secondary': '#9AA3B2', '--rm-text-muted': '#9AA3B2',
      '--rm-accent': '#8B9BFF', '--rm-accent-soft': '#232B52', '--rm-accent-text': '#B4BEFF',
      '--rm-ink': '#0E1014', '--rm-border': '#2A2F39', '--rm-line': '#1E222A',
      '--rm-warn': '#FFB454', '--rm-danger': '#FF8F8F',
      '--rm-shadow': '0 1px 3px rgba(0,0,0,0.4)',
      '--rm-shadow-float': '0 20px 50px rgba(0,0,0,0.5)',
    },
  },
};

export const UI_STYLES = ['fresh', 'compact', 'classic'];

export function normaliseUiStyle(v) {
  return UI_STYLES.includes(v) ? v : 'fresh';
}

// ---------------------------------------------------------------------------
// Themes (same as Shopping List Manager): Meadow, Slate, Sunset.
// A theme only changes the accent (buttons, hero, tabs, active states); backgrounds stay
// as the style defines them. a = accent, i = text on the accent, s = soft tint, t = accent as text.
// `null` means "use the style's own palette" (its default theme).
// ---------------------------------------------------------------------------

export const THEMES = [
  {
    id: 'meadow', name: 'Meadow',
    preview: { light: { bg: '#F3F6F4', a: '#0F7B5A', s: '#DDF1E8' }, dark: { bg: '#1F2D26', a: '#3FBF92', s: '#1B3A2F' } },
    fresh: { light: null, dark: null },
    compact: {
      light: { a: '#0F7B5A', i: '#FFFFFF', s: '#DDF1E8', t: '#0B6048' },
      dark:  { a: '#3FBF92', i: '#0B1A14', s: '#1B3A2F', t: '#7FE0BC' },
    },
  },
  {
    id: 'slate', name: 'Slate',
    preview: { light: { bg: '#E9ECF4', a: '#3B4BA8', s: '#D5DAF2' }, dark: { bg: '#1F232B', a: '#8B9BFF', s: '#232B52' } },
    fresh: {
      light: { a: '#3B4BA8', i: '#FFFFFF', s: '#E1E5F7', t: '#2E3A8A' },
      dark:  { a: '#8B9BFF', i: '#0E1230', s: '#232B52', t: '#B4BEFF' },
    },
    compact: { light: null, dark: null },
  },
  {
    id: 'sunset', name: 'Sunset',
    preview: { light: { bg: '#F8EDE6', a: '#B8481F', s: '#F4D5C6' }, dark: { bg: '#2A1D18', a: '#FF8A5B', s: '#3F2218' } },
    fresh: {
      light: { a: '#B8481F', i: '#FFFFFF', s: '#FBE3D8', t: '#8F3512' },
      dark:  { a: '#FF8A5B', i: '#2A0F05', s: '#3F2218', t: '#FFB291' },
    },
    compact: {
      light: { a: '#B8481F', i: '#FFFFFF', s: '#FBE3D8', t: '#8F3512' },
      dark:  { a: '#FF8A5B', i: '#2A0F05', s: '#3F2218', t: '#FFB291' },
    },
  },
];

// Fresh starts on Meadow (green); Compact starts on Slate (periwinkle blue)
export const DEFAULT_THEME = { fresh: 'meadow', compact: 'slate' };

/** The theme for a style and saved id (falls back to the style's default). */
export function themeEntry(style, id) {
  return THEMES.find(t => t.id === id) || THEMES.find(t => t.id === (DEFAULT_THEME[style] || 'meadow'));
}

/** Accent overrides {a,i,s,t} for the style/mode, or null for the style's own palette. */
export function themeOverrides(style, id, dark) {
  const per = themeEntry(style, id)?.[style];
  if (!per) return null;
  return (dark ? per.dark : per.light) || null;
}

/** CSS custom properties for a style + light/dark (+ optional theme id), or null for "classic". */
export function paletteFor(uiStyle, isDark, themeId) {
  const p = UI_PALETTES[uiStyle];
  if (!p) return null;
  const v = { ...(isDark ? p.dark : p.light) };
  const ov = themeOverrides(uiStyle, themeId, isDark);
  if (ov) {
    v['--rm-accent'] = ov.a; v['--rm-ink'] = ov.i; v['--rm-accent-soft'] = ov.s; v['--rm-accent-text'] = ov.t;
  }
  // Some components reference these shorter names (with dark fallbacks); alias them.
  return { ...v, '--rm-bg': v['--rm-bg-main'], '--rm-surface': v['--rm-bg-surface'], '--rm-success': v['--rm-accent'] };
}
