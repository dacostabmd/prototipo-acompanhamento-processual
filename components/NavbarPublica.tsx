'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HelpCircle, LogIn, Search } from 'lucide-react';
import styles from './NavbarPublica.module.css';

const LINKS = [
  { href: '/', label: 'Consultar', icon: Search },
  { href: '/faq', label: 'Perguntas frequentes', icon: HelpCircle }
];

/** Barra do topo das páginas públicas (login/busca e FAQ). O app autenticado tem o cabeçalho próprio do AppShell. */
export default function NavbarPublica() {
  const pathname = usePathname();

  return (
    <header className={styles.barra}>
      <nav className={styles.inner} aria-label="Navegação principal">
        <Link href="/" className={styles.marca} aria-label="JusConsulta, página inicial">
          <img src="/jusconsulta-mark.svg" alt="" width={24} height={27} />
          <span className={styles.wordmark}>
            <strong>Jus</strong>
            <span>Consulta</span>
          </span>
        </Link>

        <ul className={styles.links}>
          {LINKS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link href={href} className={styles.link} aria-current={pathname === href ? 'page' : undefined}>
                <Icon size={16} strokeWidth={1.8} />
                <span className={styles.rotulo}>{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <Link href="/login" className={`${styles.entrar} bf-btn-ouro`}>
          <LogIn size={16} strokeWidth={1.9} />
          <span>Entrar</span>
        </Link>
      </nav>
    </header>
  );
}
