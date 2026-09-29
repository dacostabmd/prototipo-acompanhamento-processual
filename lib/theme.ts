import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Paleta pré-definida da marca (azul Blindagem). Fonte única para Mantine, CSS e Tailwind. */
export const brand: MantineColorsTuple = [
  '#eef3fd',
  '#dbe5f8',
  '#b6c9f0',
  '#8eabe8',
  '#6d92e0',
  '#4f7bd8',
  '#2f63cf',
  '#2455b8',
  '#17347a',
  '#0b1636'
];

export const navy: MantineColorsTuple = [
  '#e7eaf3',
  '#c9cfe2',
  '#a3aecd',
  '#7c8bb6',
  '#5a6b9f',
  '#3f5089',
  '#2a3a70',
  '#17265a',
  '#0b1636',
  '#040b20'
];

export const theme = createTheme({
  fontFamily: 'var(--font-inter), sans-serif',
  headings: { fontFamily: 'var(--font-inter), sans-serif' },
  colors: { brand, navy },
  primaryColor: 'brand',
  primaryShade: 7,
  defaultRadius: 'md',
  black: '#0f172a',
  cursorType: 'pointer'
});
