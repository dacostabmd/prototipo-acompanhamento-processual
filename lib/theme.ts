import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Paleta pré-definida da marca (cinza Blindagem: Porcelain → Grey Olive → Charcoal → Gunmetal). Fonte única para Mantine, CSS e Tailwind. */
export const brand: MantineColorsTuple = [
  '#f7f7f6',
  '#ececea',
  '#d4d4d2',
  '#bdbdbb',
  '#a8a8a6',
  '#999999',
  '#7a7a7a',
  '#5f5f5f',
  '#3d3d3d',
  '#232323'
];

export const navy: MantineColorsTuple = [
  '#f0f0ef',
  '#dadada',
  '#b8b8b7',
  '#969695',
  '#7a7a79',
  '#636362',
  '#4e4e4d',
  '#3d3d3d',
  '#2a2a2a',
  '#181818'
];

export const theme = createTheme({
  fontFamily: 'var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: { fontFamily: 'var(--font-inter), Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  colors: { brand, navy },
  primaryColor: 'brand',
  primaryShade: 7,
  defaultRadius: 'md',
  black: '#232323',
  cursorType: 'pointer'
});
