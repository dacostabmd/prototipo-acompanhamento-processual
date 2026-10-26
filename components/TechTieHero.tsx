import type { CSSProperties } from 'react';
import Image from 'next/image';
import { LayoutDashboard, Search, Sparkles, Zap } from 'lucide-react';
import ParticulasOuro from './ParticulasOuro';
import styles from './TechTieHero.module.css';

const MARCA = '/jusconsulta-mark.png';

const DIFERENCIAIS = [
  { icon: Search, texto: 'Busca unificada em tribunais estaduais, federais e na base nacional do CNJ.' },
  { icon: Zap, texto: 'Varredura inteligente que começa pelo tribunal mais provável e reduz o custo da consulta.' },
  { icon: Sparkles, texto: 'Resumo de cada andamento gerado por IA, sem juridiquês.' },
  { icon: LayoutDashboard, texto: 'Todos os processos que você acompanha em um painel único.' }
];

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

/** Coluna esquerda do login: marca TechTie (PNG 3D) com entrada, reflexo e flutuação + copy. Só CSS. */
export default function TechTieHero() {
  return (
    <>
      <div className={styles.fundo} aria-hidden>
        <div className={styles.brilho} />
      </div>

      <div className={styles.palco}>
        {/* dentro do palco (área da marca), e não no fundo da tela inteira: nada anima atrás do cartão de vidro,
            cujo backdrop-filter teria de ser recalculado a cada quadro */}
        <ParticulasOuro className={styles.particulas} />
        <div className={styles.marcaWrap}>
          <span className={styles.anel} aria-hidden />
          <div className={styles.marcaEntrada}>
            <Image src={MARCA} alt="TechTie" width={512} height={512} priority className={styles.marca} />
            {/* reflexo que atravessa a marca, recortado pela própria silhueta do PNG */}
            <div className={styles.reflexoMascara} aria-hidden>
              <span className={styles.reflexo} />
            </div>
          </div>
        </div>

        <div className={styles.copy}>
          <p className={styles.eyebrow}>TechTie · Acompanhamento processual</p>
          <h1 className={styles.titulo}>Acompanhamento processual otimizado, do primeiro andamento à decisão final.</h1>
          <p className={styles.lead}>
            Consulte processos por CPF, CNPJ ou número CNJ, entenda cada movimentação em linguagem clara e mantenha tudo o que
            importa em um só lugar.
          </p>
          <ul className={styles.diferenciais}>
            {DIFERENCIAIS.map(({ icon: Icon, texto }, i) => (
              <li key={texto} className={styles.diferencial} style={v({ '--i': i })}>
                <span className={styles.icone}>
                  <Icon size={16} strokeWidth={1.8} />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
