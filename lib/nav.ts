import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Search, Gavel, User } from 'lucide-react';
import type { ProfileRole } from './useProfile';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Quando ausente, o item é visível para todos os papéis. */
  roles?: ProfileRole[];
}

/** A ordem define o índice usado para decidir a direção do slide entre rotas. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/painel', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/consulta', label: 'Consultar processos', icon: Search },
  { href: '/processos', label: 'Meus processos', icon: Gavel },
  { href: '/perfil', label: 'Meu perfil', icon: User }
];

export const navIndex = (pathname: string) => NAV_ITEMS.findIndex(i => pathname === i.href || pathname.startsWith(i.href + '/'));
