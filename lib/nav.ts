import {
  IconLayoutDashboard,
  IconSearch,
  IconGavel,
  IconUserCircle,
  type Icon
} from '@tabler/icons-react';

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
}

/** A ordem define o índice usado para decidir a direção do slide entre rotas. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/painel', label: 'Visão geral', icon: IconLayoutDashboard },
  { href: '/consulta', label: 'Consultar processos', icon: IconSearch },
  { href: '/processos', label: 'Meus processos', icon: IconGavel },
  { href: '/perfil', label: 'Meu perfil', icon: IconUserCircle }
];

export const navIndex = (pathname: string) => NAV_ITEMS.findIndex(i => pathname === i.href || pathname.startsWith(i.href + '/'));
