'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell, Burger, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { motion } from 'motion/react';
import { IconChevronLeft, IconChevronRight, IconLogout } from '@tabler/icons-react';
import { NAV_ITEMS, navIndex } from '@/lib/nav';
import { getSupabase } from '@/lib/supabase';
import { authFetch } from '@/lib/authFetch';
import PageTransition from './PageTransition';
import UserChip from './UserChip';

const RAIL = 80;
const EXPANDED = 250;
const ICON = 22;

export default function AppShellLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false);
  const active = navIndex(pathname);

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
        <div className="bf-side-brand">
          <Link href="/painel" aria-label="Blindagem Financeira — início" className="bf-side-logo">
            <Image src="/blindagem-logo.png" alt="Blindagem Financeira" width={122} height={40} priority />
          </Link>
        </div>

        <span className="bf-side-caption" aria-hidden>
          Navegação
        </span>

        <nav aria-label="Principal" className="bf-side-nav">
          {NAV_ITEMS.map((item, i) => {
            const isActive = i === active;
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
                    <Icon size={ICON} stroke={1.7} />
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
                <IconLogout size={ICON} stroke={1.7} />
              </span>
              <span className="bf-nav-label">Sair</span>
            </UnstyledButton>
          </Tooltip>
          <UnstyledButton
            onClick={toggle}
            visibleFrom="sm"
            aria-label={expanded ? 'Recolher menu' : 'Expandir menu'}
            aria-expanded={expanded}
            className="bf-nav-item bf-nav-muted"
          >
            <span className="bf-nav-icon">
              {expanded ? <IconChevronLeft size={ICON} stroke={1.7} /> : <IconChevronRight size={ICON} stroke={1.7} />}
            </span>
            <span className="bf-nav-label">Recolher</span>
          </UnstyledButton>
        </div>
      </AppShell.Navbar>

      <AppShell.Main className="bf-main">
        <PageTransition>{children}</PageTransition>
      </AppShell.Main>
    </AppShell>
  );
}
