import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Paleta TechTie Flow: champagne (acento) sobre grafite. Fonte única para Mantine; os tokens CSS --tt-* em
    app/globals.css espelham estes valores. */
export const brand: MantineColorsTuple = [
  '#fbf6ec',
  '#f6ecd9',
  '#f6e7cc',
  '#efdfc2',
  '#e8d5b0',
  '#cdb68e',
  '#b39b72',
  '#8f7b58',
  '#6b5b40',
  '#463b29'
];

export const navy: MantineColorsTuple = [
  '#f3f1ec',
  '#d9d9dc',
  '#b4b6bb',
  '#9a9da5',
  '#6b6e76',
  '#4a4d55',
  '#3a3e47',
  '#2c2f35',
  '#24272c',
  '#1c1d21'
];

export const theme = createTheme({
  fontFamily: 'var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: { fontFamily: 'var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  colors: { brand, navy },
  primaryColor: 'brand',
  primaryShade: 4,
  // champagne é claro: texto escuro automático em botões/badges preenchidos
  autoContrast: true,
  luminanceThreshold: 0.45,
  defaultRadius: 'md',
  black: '#15161a',
  cursorType: 'pointer'
});
