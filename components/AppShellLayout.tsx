'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, Burger, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import { NAV_ITEMS } from '@/lib/nav';
import { getSupabase } from '@/lib/supabase';
import { authFetch } from '@/lib/authFetch';
import { ProfileProvider, useSharedProfile } from './ProfileProvider';
import PageTransition from './PageTransition';
import UserChip from './UserChip';
import ZoomControls from './ZoomControls';
import Changelog from './Changelog';

const RAIL = 80;
const EXPANDED = 250;
const ICON = 20;

/** Monta o ProfileProvider uma única vez no shell: todas as páginas filhas (via useSharedProfile) reaproveitam essa mesma busca de perfil, em vez de cada uma refazer auth.getUser()+select em ap_perfis. */
export default function AppShellLayout({ children }: { children: ReactNode }) {
  return (
    <ProfileProvider>
      <AppShellLayoutInner>{children}</AppShellLayoutInner>
    </ProfileProvider>
  );
}

function AppShellLayoutInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false);
  const [naoLidas, setNaoLidas] = useState(0);
  const { profile } = useSharedProfile();
  const navItems = NAV_ITEMS.filter(item => !item.roles || item.roles.includes(profile.role));

  useEffect(() => {
    let ativo = true;
    const carregarNaoLidas = () => {
      authFetch('/api/notificacoes')
        .then(res => (res.ok ? res.json() : null))
        .then(d => {
          if (ativo && typeof d?.naoLidas === 'number') {
            setNaoLidas(d.naoLidas);
          }
        })
        .catch(() => {});
    };
    carregarNaoLidas();
    const interval = setInterval(carregarNaoLidas, 45_000);
    return () => {
      ativo = false;
      clearInterval(interval);
    };
  }, [pathname]);

  useEffect(() => {
    try {
      setExpanded(localStorage.getItem('bf-sidebar') !== '0');
    } catch {}
  }, []);

  useEffect(() => closeMobile(), [pathname, closeMobile]);

  const toggle = () =>
    setExpanded(v => {
      try {
        localStorage.setItem('bf-sidebar', v ? '0' : '1');
      } catch {}
      return !v;
    });

  const logout = async () => {
    await authFetch('/api/eventos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'logout' })
    }).catch(() => {});
    try {
      localStorage.removeItem('bf-demo-user');
      sessionStorage.removeItem('bf-login-tracked');
    } catch {}
    await getSupabase()?.auth.signOut();
    router.replace('/');
  };

  return (
    <div className="bf-zoom-root">
    <AppShell
      header={{ height: 64 }}
      navbar={{
        width: { base: EXPANDED, sm: expanded ? EXPANDED : RAIL },
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened }
      }}
      padding={0}
      layout="alt"
    >
      <AppShell.Header className="bf-topbar">
        <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Abrir menu" />
        <div className="bf-topbar-right">
          <ZoomControls />
          <UserChip />
        </div>
      </AppShell.Header>

      <AppShell.Navbar className="bf-side" data-expanded={expanded || undefined}>
        <UnstyledButton
          onClick={toggle}
          visibleFrom="sm"
          aria-label={expanded ? 'Recolher menu' : 'Expandir menu'}
          aria-expanded={expanded}
          className="bf-nav-item bf-nav-muted"
        >
          <span className="bf-nav-icon">
            {expanded ? <ChevronLeft size={ICON} strokeWidth={1.8} /> : <ChevronRight size={ICON} strokeWidth={1.8} />}
          </span>
          <span className="bf-nav-label">Recolher</span>
        </UnstyledButton>

        <span className="bf-side-caption" aria-hidden>
          Navegação
        </span>

        <nav aria-label="Principal" className="bf-side-nav">
          {navItems.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            const temNaoLidas = item.href === '/processos' && naoLidas > 0;
            const labelTooltip = temNaoLidas ? `${item.label} (${naoLidas} novidade${naoLidas > 1 ? 's' : ''})` : item.label;
            return (
              <Tooltip key={item.href} label={labelTooltip} position="right" offset={14} withArrow disabled={expanded || mobileOpened}>
                <UnstyledButton
                  component={Link}
                  href={item.href}
                  prefetch
                  aria-current={isActive ? 'page' : undefined}
                  className="bf-nav-item"
                  data-active={isActive || undefined}
                >
                  {isActive && (
                    <motion.span
                      layoutId="bf-nav-pill"
                      className="bf-nav-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                    />
                  )}
                  <span className="bf-nav-icon relative">
                    <Icon size={ICON} strokeWidth={1.8} />
                    {temNaoLidas && !expanded && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-400 ring-2 ring-[#15161a]" />
                    )}
                  </span>
                  <span className="bf-nav-label flex items-center justify-between gap-2">
                    <span>{item.label}</span>
                    {temNaoLidas && expanded && (
                      <span className="inline-flex items-center justify-center rounded-full border border-red-400/40 bg-red-400/20 px-1.5 py-0.2 text-[10px] font-semibold text-red-200">
                        {naoLidas > 99 ? '99+' : naoLidas}
                      </span>
                    )}
                  </span>
                </UnstyledButton>
              </Tooltip>
            );
          })}
        </nav>

        <div className="bf-side-foot">
          <div className="bf-side-logo">
            <img src="/techtie-mark-512.png" alt="Techtie" width={32} height={32} />
            <span className="bf-side-wordmark" aria-hidden>
              <strong>TECHTIE</strong>
              <small>Processos</small>
            </span>
          </div>

          <Tooltip label="Sair" position="right" offset={14} withArrow disabled={expanded || mobileOpened}>
            <UnstyledButton onClick={logout} className="bf-nav-item">
              <span className="bf-nav-icon">
                <LogOut size={ICON} strokeWidth={1.8} />
              </span>
              <span className="bf-nav-label">Sair</span>
            </UnstyledButton>
          </Tooltip>
        </div>
      </AppShell.Navbar>

      <AppShell.Main className="bf-main">
        <PageTransition>{children}</PageTransition>
      </AppShell.Main>
      <Changelog isOwner={profile.role === 'owner'} />
    </AppShell>
    </div>
  );
}
