'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, Burger, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import { NAV_ITEMS } from '@/lib/nav';
import { getSupabase } from '@/lib/supabase';
import { authFetch } from '@/lib/authFetch';
import { useProfile } from '@/lib/useProfile';
import PageTransition from './PageTransition';
import UserChip from './UserChip';

// WebGL (ogl) é custoso e puramente decorativo: carregado só no client, fora do caminho
// crítico de render inicial de cada rota autenticada (diagnóstico de performance registrado
// em roadmap.json, feature "tema-dark-glass-shell").
const GhostFibers = dynamic(() => import('./GhostFibers'), { ssr: false });

const RAIL = 80;
const EXPANDED = 250;
const ICON = 20;

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false);
  const { profile } = useProfile();
  const navItems = NAV_ITEMS.filter(item => !item.roles || item.roles.includes(profile.role));

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
        <UserChip />
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

        <div className="bf-side-brand">
          <Link href="/painel" aria-label="Blindagem Financeira — início" className="bf-side-logo">
            <Image src="/blindagem-logo.png" alt="Blindagem Financeira" width={122} height={40} priority />
          </Link>
        </div>

        <span className="bf-side-caption" aria-hidden>
          Navegação
        </span>

        <nav aria-label="Principal" className="bf-side-nav">
          {navItems.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Tooltip key={item.href} label={item.label} position="right" offset={14} withArrow disabled={expanded || mobileOpened}>
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
                  <span className="bf-nav-icon">
                    <Icon size={ICON} strokeWidth={1.8} />
                  </span>
                  <span className="bf-nav-label">{item.label}</span>
                </UnstyledButton>
              </Tooltip>
            );
          })}
        </nav>

        <div className="bf-side-foot">
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
        {/* Montado uma única vez no shell (fora do PageTransition): persiste entre navegações
            em vez de reinicializar o contexto WebGL a cada troca de rota. */}
        <GhostFibers lineColor="#262626" glowColor="#3d3d3d" backdropColor="#0e0e0e" speed={0.15} brightness={1.4} blueBoost={1} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <PageTransition>{children}</PageTransition>
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
