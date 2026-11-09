'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { authFetch } from '@/lib/authFetch';
import { AVISO, parsearSecoes } from '@/lib/pecas/formato';
import { CHAVE_IMPRESSAO } from './pecasUi';
import styles from './ImprimirPeca.module.css';

/**
 * Página de impressão da minuta (rota /pecas/imprimir, fora do AppShell: sem menu, topo nem rodapé do app).
 * Lê o texto enviado pelo editor (localStorage, inclui edições não salvas) ou, na falta dele, busca a peça pelo id.
 * `window.print()` abre o diálogo do navegador, onde se escolhe "Salvar como PDF". Sempre clara, A4.
 */
export default function ImprimirPeca() {
  return (
    <AuthGuard>
      <Conteudo />
    </AuthGuard>
  );
}

interface Rascunho {
  titulo: string;
  conteudo: string;
}

function lerRascunho(id: string | null): Rascunho | null {
  try {
    const bruto = localStorage.getItem(CHAVE_IMPRESSAO);
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Rascunho & { id?: string | null; em?: number };
    if (typeof r.conteudo !== 'string' || typeof r.titulo !== 'string') return null;
    if (id && r.id && r.id !== id) return null;
    // Rascunho velho (de outra sessão de impressão) não vale: só os últimos 10 minutos.
    if (r.em && Date.now() - r.em > 10 * 60_000) return null;
    return r;
  } catch {
    return null;
  }
}

function Conteudo() {
  const [peca, setPeca] = useState<Rascunho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [emitidoEm, setEmitidoEm] = useState('');

  useEffect(() => {
    setEmitidoEm(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }));
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const auto = params.get('auto') === '1';
    let ativo = true;

    const pronto = (p: Rascunho) => {
      setPeca(p);
      if (auto) window.setTimeout(() => window.print(), 600);
    };

    const rascunho = lerRascunho(id);
    if (rascunho) {
      pronto(rascunho);
    } else if (id) {
      authFetch(`/api/pecas/${encodeURIComponent(id)}`)
        .then(async res => {
          const d = await res.json().catch(() => ({}));
          if (!ativo) return;
          if (!res.ok) setErro(d.error || 'Não foi possível carregar a peça.');
          else pronto({ titulo: d.peca.titulo, conteudo: d.peca.conteudo });
        })
        .catch(() => ativo && setErro('Não foi possível carregar a peça.'));
    } else {
      setErro('Nenhuma minuta para imprimir. Volte e use "Imprimir / PDF" no editor.');
    }
    return () => {
      ativo = false;
    };
  }, []);

  const secoes = peca ? parsearSecoes(peca.conteudo) : [];

  return (
    <div className={styles.pagina}>
      {/* A cópia do rodapé do layout raiz não entra nesta página. */}
      <style>{`.bf-rodape--raiz{display:none !important}`}</style>

      <div className={styles.barra}>
        <a href="/pecas" className={`${styles.botao} ${styles.botaoSec}`}>
          <ArrowLeft size={16} />
          Voltar às peças
        </a>
        <button type="button" className={styles.botao} onClick={() => window.print()} disabled={!peca}>
          <Printer size={16} />
          Imprimir / Salvar como PDF
        </button>
      </div>

      <main className={styles.folha}>
        <p className={styles.aviso}>{AVISO}</p>

        {erro ? (
          <p className={styles.vazio}>{erro}</p>
        ) : !peca ? (
          <p className={styles.vazio}>
            <Loader2 size={16} className="animate-spin" style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Carregando...
          </p>
        ) : (
          <>
            <h1 className={styles.titulo}>{peca.titulo}</h1>
            {secoes.map((s, i) => (
              <section key={`${s.titulo}-${i}`} className={styles.secao}>
                <h2 className={styles.secaoTitulo}>{s.titulo}</h2>
                <p className={styles.texto}>{s.texto}</p>
              </section>
            ))}
            <footer className={styles.rodape}>JusConsulta{emitidoEm ? ` · emitido em ${emitidoEm}` : ''} · minuta sujeita a revisão do advogado responsável.</footer>
          </>
        )}
      </main>
    </div>
  );
}
