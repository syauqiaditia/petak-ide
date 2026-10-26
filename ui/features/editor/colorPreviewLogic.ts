/**
 * Pure color preview logic for Flutter Color(0x...) and Colors.<name>[shade] (Batch 55).
 * Usable in browser/Svelte UI and headless unit tests.
 */

export interface ColorMatchItem {
  from: number;
  to: number;
  matchText: string;
  cssColor: string;
  colorType: 'hex' | 'material';
  hexArgb?: string;
}

/**
 * Standard Material Design palette definition for Flutter Colors.<name>
 */
export const MATERIAL_PALETTE: Record<string, { default: string; shades?: Record<number, string> }> = {
  red: {
    default: '#F44336',
    shades: {
      50: '#FFEBEE', 100: '#FFCDD2', 200: '#EF9A9A', 300: '#E57373', 400: '#EF5350',
      500: '#F44336', 600: '#E53935', 700: '#D32F2F', 800: '#C62828', 900: '#B71C1C',
    },
  },
  pink: {
    default: '#E91E63',
    shades: {
      50: '#FCE4EC', 100: '#F8BBD0', 200: '#F48FB1', 300: '#F06292', 400: '#EC407A',
      500: '#E91E63', 600: '#D81B60', 700: '#C2185B', 800: '#AD1457', 900: '#880E4F',
    },
  },
  purple: {
    default: '#9C27B0',
    shades: {
      50: '#F3E5F5', 100: '#E1BEE7', 200: '#CE93D8', 300: '#BA68C8', 400: '#AB47BC',
      500: '#9C27B0', 600: '#8E24AA', 700: '#7B1FA2', 800: '#6A1B9A', 900: '#4A148C',
    },
  },
  deepPurple: {
    default: '#673AB7',
    shades: {
      50: '#EDE7F6', 100: '#D1C4E9', 200: '#B39DDB', 300: '#9575CD', 400: '#7E57C2',
      500: '#673AB7', 600: '#5E35B1', 700: '#512DA8', 800: '#4527A0', 900: '#311B92',
    },
  },
  indigo: {
    default: '#3F51B5',
    shades: {
      50: '#E8EAF6', 100: '#C5CAE9', 200: '#9FA8DA', 300: '#7986CB', 400: '#5C6BC0',
      500: '#3F51B5', 600: '#3949AB', 700: '#303F9F', 800: '#283593', 900: '#1A237E',
    },
  },
  blue: {
    default: '#2196F3',
    shades: {
      50: '#E3F2FD', 100: '#BBDEFB', 200: '#90CAF9', 300: '#64B5F6', 400: '#42A5F5',
      500: '#2196F3', 600: '#1E88E5', 700: '#1976D2', 800: '#1565C0', 900: '#0D47A1',
    },
  },
  lightBlue: {
    default: '#03A9F4',
    shades: {
      50: '#E1F5FE', 100: '#B3E5FC', 200: '#81D4FA', 300: '#4FC3F7', 400: '#29B6F6',
      500: '#03A9F4', 600: '#039BE5', 700: '#0288D1', 800: '#0277BD', 900: '#01579B',
    },
  },
  cyan: {
    default: '#00BCD4',
    shades: {
      50: '#E0F7FA', 100: '#B2EBF2', 200: '#80DEEA', 300: '#4DD0E1', 400: '#26C6DA',
      500: '#00BCD4', 600: '#00ACC1', 700: '#0097A7', 800: '#00838F', 900: '#006064',
    },
  },
  teal: {
    default: '#009688',
    shades: {
      50: '#E0F2F1', 100: '#B2DFDB', 200: '#80CBC4', 300: '#4DB6AC', 400: '#26A69A',
      500: '#009688', 600: '#00897B', 700: '#00796B', 800: '#00695C', 900: '#004D40',
    },
  },
  green: {
    default: '#4CAF50',
    shades: {
      50: '#E8F5E9', 100: '#C8E6C9', 200: '#A5D6A7', 300: '#81C784', 400: '#66BB6A',
      500: '#4CAF50', 600: '#43A047', 700: '#388E3C', 800: '#2E7D32', 900: '#1B5E20',
    },
  },
  lightGreen: {
    default: '#8BC34A',
    shades: {
      50: '#F1F8E9', 100: '#DCEDC8', 200: '#C5E1A5', 300: '#AED581', 400: '#9CCC65',
      500: '#8BC34A', 600: '#7CB342', 700: '#689F38', 800: '#558B2F', 900: '#33691E',
    },
  },
  lime: {
    default: '#CDDC39',
    shades: {
      50: '#F9FBE7', 100: '#F0F4C3', 200: '#E6EE9C', 300: '#DCE775', 400: '#D4E157',
      500: '#CDDC39', 600: '#C0CA33', 700: '#AFB42B', 800: '#9E9D24', 900: '#827717',
    },
  },
  yellow: {
    default: '#FFEB3B',
    shades: {
      50: '#FFFDE7', 100: '#FFF9C4', 200: '#FFF59D', 300: '#FFF176', 400: '#FFEE58',
      500: '#FFEB3B', 600: '#FDD835', 700: '#FBC02D', 800: '#F9A825', 900: '#F57F17',
    },
  },
  amber: {
    default: '#FFC107',
    shades: {
      50: '#FFF8E1', 100: '#FFECB3', 200: '#FFE082', 300: '#FFD54F', 400: '#FFCA28',
      500: '#FFC107', 600: '#FFB300', 700: '#FFA000', 800: '#FF8F00', 900: '#FF6F00',
    },
  },
  orange: {
    default: '#FF9800',
    shades: {
      50: '#FFF3E0', 100: '#FFE0B2', 200: '#FFCC80', 300: '#FFB74D', 400: '#FFA726',
      500: '#FF9800', 600: '#FB8C00', 700: '#F57C00', 800: '#EF6C00', 900: '#E65100',
    },
  },
  deepOrange: {
    default: '#FF5722',
    shades: {
      50: '#FBE9E7', 100: '#FFCCBC', 200: '#FFAB91', 300: '#FF8A65', 400: '#FF7043',
      500: '#FF5722', 600: '#F4511E', 700: '#E64A19', 800: '#D84315', 900: '#BF360C',
    },
  },
  brown: {
    default: '#795548',
    shades: {
      50: '#EFEBE9', 100: '#D7CCC8', 200: '#BCAAA4', 300: '#A1887F', 400: '#8D6E63',
      500: '#795548', 600: '#6D4C41', 700: '#5D4037', 800: '#4E342E', 900: '#3E2723',
    },
  },
  grey: {
    default: '#9E9E9E',
    shades: {
      50: '#FAFAFA', 100: '#F5F5F5', 200: '#EEEEEE', 300: '#E0E0E0', 400: '#BDBDBD',
      500: '#9E9E9E', 600: '#757575', 700: '#616161', 800: '#424242', 900: '#212121',
    },
  },
  blueGrey: {
    default: '#607D8B',
    shades: {
      50: '#ECEFF1', 100: '#CFD8DC', 200: '#B0BEC5', 300: '#90A4AE', 400: '#78909C',
      500: '#607D8B', 600: '#546E7A', 700: '#455A64', 800: '#37474F', 900: '#263238',
    },
  },

  // Accents
  redAccent: {
    default: '#FF5252',
    shades: { 100: '#FF8A80', 200: '#FF5252', 400: '#FF1744', 700: '#D50000' },
  },
  pinkAccent: {
    default: '#FF4081',
    shades: { 100: '#FF80AB', 200: '#FF4081', 400: '#F50057', 700: '#C51162' },
  },
  purpleAccent: {
    default: '#E040FB',
    shades: { 100: '#EA80FC', 200: '#E040FB', 400: '#D500F9', 700: '#AA00FF' },
  },
  deepPurpleAccent: {
    default: '#7C4DFF',
    shades: { 100: '#B388FF', 200: '#7C4DFF', 400: '#651FFF', 700: '#6200EA' },
  },
  indigoAccent: {
    default: '#536DFE',
    shades: { 100: '#8C9EFF', 200: '#536DFE', 400: '#3D5AFE', 700: '#304FFE' },
  },
  blueAccent: {
    default: '#448AFF',
    shades: { 100: '#82B1FF', 200: '#448AFF', 400: '#2979FF', 700: '#2962FF' },
  },
  lightBlueAccent: {
    default: '#40C4FF',
    shades: { 100: '#80D8FF', 200: '#40C4FF', 400: '#00B0FF', 700: '#0091EA' },
  },
  cyanAccent: {
    default: '#18FFFF',
    shades: { 100: '#84FFFF', 200: '#18FFFF', 400: '#00E5FF', 700: '#00B8D4' },
  },
  tealAccent: {
    default: '#64FFDA',
    shades: { 100: '#A7FFEB', 200: '#64FFDA', 400: '#1DE9B6', 700: '#00BFA5' },
  },
  greenAccent: {
    default: '#69F0AE',
    shades: { 100: '#B9F6CA', 200: '#69F0AE', 400: '#00E676', 700: '#00C853' },
  },
  lightGreenAccent: {
    default: '#B2FF59',
    shades: { 100: '#CCFF90', 200: '#B2FF59', 400: '#76FF03', 700: '#64DD17' },
  },
  limeAccent: {
    default: '#EEFF41',
    shades: { 100: '#F4FF81', 200: '#EEFF41', 400: '#C6FF00', 700: '#AEEA00' },
  },
  yellowAccent: {
    default: '#FFFF00',
    shades: { 100: '#FFFF8D', 200: '#FFFF00', 400: '#FFEA00', 700: '#FFD600' },
  },
  amberAccent: {
    default: '#FFD740',
    shades: { 100: '#FFE57F', 200: '#FFD740', 400: '#FFC400', 700: '#FFAB00' },
  },
  orangeAccent: {
    default: '#FFAB40',
    shades: { 100: '#FFD180', 200: '#FFAB40', 400: '#FF9100', 700: '#FF6D00' },
  },
  deepOrangeAccent: {
    default: '#FF6E40',
    shades: { 100: '#FF9E80', 200: '#FF6E40', 400: '#FF3D00', 700: '#DD2C00' },
  },

  // Constants
  white: { default: '#FFFFFF' },
  black: { default: '#000000' },
  transparent: { default: 'transparent' },
  black87: { default: 'rgba(0, 0, 0, 0.87)' },
  black54: { default: 'rgba(0, 0, 0, 0.54)' },
  black45: { default: 'rgba(0, 0, 0, 0.45)' },
  black38: { default: 'rgba(0, 0, 0, 0.38)' },
  black26: { default: 'rgba(0, 0, 0, 0.26)' },
  black12: { default: 'rgba(0, 0, 0, 0.12)' },
  white70: { default: 'rgba(255, 255, 255, 0.70)' },
  white60: { default: 'rgba(255, 255, 255, 0.60)' },
  white54: { default: 'rgba(255, 255, 255, 0.54)' },
  white38: { default: 'rgba(255, 255, 255, 0.38)' },
  white30: { default: 'rgba(255, 255, 255, 0.30)' },
  white24: { default: 'rgba(255, 255, 255, 0.24)' },
  white12: { default: 'rgba(255, 255, 255, 0.12)' },
  white10: { default: 'rgba(255, 255, 255, 0.10)' },
};

/**
 * Parse an 8-character ARGB hex string (from Color(0xAARRGGBB)) into CSS color.
 * Example: 'FF2B2D30' -> '#2B2D30' (alpha 255)
 * Example: '802B2D30' -> 'rgba(43, 45, 48, 0.5)'
 */
export function parseArgbHex(argbHex: string): {
  a: number;
  r: number;
  g: number;
  b: number;
  css: string;
  hex: string;
} {
  const clean = argbHex.replace(/^0x/i, '').replace(/^#/i, '');
  if (clean.length !== 8) {
    return { a: 255, r: 0, g: 0, b: 0, css: '#000000', hex: 'FF000000' };
  }

  const a = parseInt(clean.substring(0, 2), 16);
  const r = parseInt(clean.substring(2, 4), 16);
  const g = parseInt(clean.substring(4, 6), 16);
  const b = parseInt(clean.substring(6, 8), 16);

  let css: string;
  if (a === 255) {
    css = `#${clean.substring(2, 8).toUpperCase()}`;
  } else {
    const alphaNum = Number((a / 255).toFixed(2));
    css = `rgba(${r}, ${g}, ${b}, ${alphaNum})`;
  }

  return { a, r, g, b, css, hex: clean.toUpperCase() };
}

/**
 * Format CSS color (#RRGGBB or rgba) back into Flutter Color(0xAARRGGBB) string.
 */
export function cssToFlutterColor(cssColor: string, originalAlphaHex: string = 'FF'): string {
  if (cssColor.startsWith('#')) {
    const hex = cssColor.slice(1);
    if (hex.length === 6) {
      return `Color(0x${originalAlphaHex.toUpperCase()}${hex.toUpperCase()})`;
    }
  }
  return `Color(0x${originalAlphaHex.toUpperCase()}FFFFFF)`;
}

/**
 * Resolve Flutter Colors.<name>[shade] to CSS color.
 */
export function resolveMaterialColor(name: string, shadeStr?: string): string | null {
  // Normalize color name e.g. blue, redAccent, white
  const key = Object.keys(MATERIAL_PALETTE).find(
    (k) => k.toLowerCase() === name.toLowerCase()
  );
  if (!key) return null;

  const entry = MATERIAL_PALETTE[key];
  if (shadeStr) {
    const shade = parseInt(shadeStr, 10);
    if (entry.shades && entry.shades[shade]) {
      return entry.shades[shade];
    }
  }

  return entry.default;
}

/**
 * Extract all Flutter color tokens from Dart document.
 */
export function extractColorMatches(docText: string): ColorMatchItem[] {
  const matches: ColorMatchItem[] = [];

  // 1. Match Color(0x[0-9a-fA-F]{8})
  const hexRegex = /\bColor\(\s*0x([0-9a-fA-F]{8})\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = hexRegex.exec(docText)) !== null) {
    const hexArgb = m[1];
    const parsed = parseArgbHex(hexArgb);
    matches.push({
      from: m.index,
      to: m.index + m[0].length,
      matchText: m[0],
      cssColor: parsed.css,
      colorType: 'hex',
      hexArgb: parsed.hex,
    });
  }

  // 2. Match Colors.<name>(?:\[([0-9]+)\])?
  const matRegex = /\bColors\.([a-zA-Z0-9]+)(?:\[(\d+)\])?/g;
  while ((m = matRegex.exec(docText)) !== null) {
    const name = m[1];
    const shadeStr = m[2];
    const css = resolveMaterialColor(name, shadeStr);
    if (css) {
      matches.push({
        from: m.index,
        to: m.index + m[0].length,
        matchText: m[0],
        cssColor: css,
        colorType: 'material',
      });
    }
  }

  // Sort by document position
  matches.sort((a, b) => a.from - b.from);
  return matches;
}
