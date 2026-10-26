import { createTheme, type MantineColorsTuple } from '@mantine/core';

/** Paleta JusConsulta (briefing de identidade v1.0): azul sobre azul-noite. Fonte única para Mantine; os tokens
    CSS --tt-* em app/globals.css espelham estes valores. */
export const brand: MantineColorsTuple = [
  '#EDF2FA',
  '#D4E5FC',
  '#A9CBFA',
  '#3FA0FF',
  '#1E7CF2',
  '#2A5BD7',
  '#2249B8',
  '#1B3FA8',
  '#142F80',
  '#0B1730'
];

export const navy: MantineColorsTuple = [
  '#F4F7FC',
  '#C9D6EE',
  '#A9B9D9',
  '#8EA0C4',
  '#4A5878',
  '#2B3957',
  '#22345E',
  '#122552',
  '#0B1730',
  '#060F28'
];

export const theme = createTheme({
  fontFamily: 'var(--font-inter-tight), "Inter Tight", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headings: { fontFamily: 'var(--font-outfit), Outfit, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', fontWeight: '600' },
  colors: { brand, navy },
  primaryColor: 'brand',
  primaryShade: 4,
  // azul elétrico: texto branco em botões/badges preenchidos
  autoContrast: true,
  luminanceThreshold: 0.5,
  defaultRadius: 'md',
  black: '#060F28',
  cursorType: 'pointer'
});
