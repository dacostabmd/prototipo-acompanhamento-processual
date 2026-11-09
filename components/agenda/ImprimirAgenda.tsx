'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import AuthGuard from '@/components/AuthGuard';
import { diaDaSemanaTexto, diasEntre, formatarData, ROTULO_TIPO, type PrazoAgenda } from './agendaUtil';
import styles from './ImprimirAgenda.module.css';

/**
 * Página de impressão da agenda (rota /agenda/imprimir, fora do AppShell: sem menu, topo nem rodapé do app).
 * `window.print()` abre o diálogo do navegador, onde se escolhe "Salvar como PDF". Sempre clara, A4.
 */
export default function ImprimirAgenda() {
  return (
    <AuthGuard>
      <Conteudo />
    </AuthGuard>
  );
}

function rotuloGrupo(data: string, hoje: string): { texto: string; classe: string } {
  const dias = diasEntre(hoje, data);
  if (dias < 0) return { texto: `atrasado há ${-dias} dia${dias === -1 ? '' : 's'}`, classe: styles.atrasado };
  if (dias === 0) return { texto: 'vence hoje', classe: styles.hoje };
  if (dias === 1) return { texto: 'vence amanhã', classe: '' };
  return { texto: `em ${dias} dias`, classe: '' };
}

function Conteudo() {
  const [prazos, setPrazos] = useState<PrazoAgenda[] | null>(null);
  const [hoje, setHoje] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [emitidoEm, setEmitidoEm] = useState('');

  useEffect(() => {
    setEmitidoEm(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }));
    let ativo = true;
    authFetch('/api/agenda?filtro=pendentes')
      .then(async res => {
        const dados = await res.json().catch(() => ({}));
        if (!ativo) return;
        if (res.status === 403) setErro('A agenda de prazos é um recurso do Plano Pro.');
        else if (!res.ok) setErro(dados.error || 'Não foi possível carregar a agenda.');
        else {
          setHoje(dados.hoje);
          setPrazos(dados.prazos ?? []);
          // Aberto pelo botão "Exportar PDF": já abre o diálogo de impressão quando a lista renderizar.
          if (new URLSearchParams(window.location.search).get('auto') === '1') window.setTimeout(() => window.print(), 600);
        }
      })
      .catch(() => ativo && setErro('Não foi possível carregar a agenda.'));
    return () => {
      ativo = false;
    };
  }, []);

  const grupos = useMemo(() => {
    const mapa = new Map<string, PrazoAgenda[]>();
    for (const p of [...(prazos ?? [])].sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento) || a.titulo.localeCompare(b.titulo))) {
      mapa.set(p.dataVencimento, [...(mapa.get(p.dataVencimento) ?? []), p]);
    }
    return [...mapa.entries()];
  }, [prazos]);

  return (
    <div className={styles.pagina}>
      {/* A cópia do rodapé do layout raiz não entra nesta página (ela traz o próprio rodapé). */}
      <style>{`.bf-rodape--raiz{display:none !important}`}</style>

      <div className={styles.barra}>
        <a href="/agenda" className={`${styles.botao} ${styles.botaoSec}`}>
          <ArrowLeft size={16} />
          Voltar à agenda
        </a>
        <div className={styles.botoes}>
          <button type="button" className={styles.botao} onClick={() => window.print()} disabled={!prazos}>
            <Printer size={16} />
            Imprimir / Salvar como PDF
          </button>
        </div>
      </div>

      <main className={styles.folha}>
        <header className={styles.cabecalho}>
          <span className={styles.marca}>
            <img src="/jusconsulta-mark.svg" alt="" width={26} height={29} />
            <span>
              <strong>Jus</strong>
              <span>Consulta</span>
            </span>
          </span>
          <p className={styles.meta}>{emitidoEm && `Emitido em ${emitidoEm}`}</p>
        </header>

        <h1 className={styles.titulo}>Agenda de prazos</h1>
        <p className={styles.meta}>
          {prazos ? `${prazos.length} compromisso${prazos.length === 1 ? '' : 's'} pendente${prazos.length === 1 ? '' : 's'}, agrupados por data de vencimento.` : ''}
        </p>

        {erro ? (
          <p className={styles.vazio}>{erro}</p>
        ) : !prazos ? (
          <p className={styles.vazio}>
            <Loader2 size={16} className="animate-spin" style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Carregando...
          </p>
        ) : grupos.length === 0 ? (
          <p className={styles.vazio}>Nenhum compromisso pendente na agenda.</p>
        ) : (
          grupos.map(([data, itens]) => {
            const rotulo = rotuloGrupo(data, hoje);
            return (
              <section key={data} className={styles.grupo}>
                <h2 className={styles.grupoTitulo}>
                  <span>
                    {formatarData(data)} · {diaDaSemanaTexto(data)}
                  </span>
                  <span className={`${styles.grupoRotulo} ${rotulo.classe}`}>{rotulo.texto}</span>
                </h2>
                <ul className={styles.itens}>
                  {itens.map(p => (
                    <li key={p.id} className={styles.item}>
                      <span className={styles.caixa} aria-hidden />
                      <div>
                        <p className={styles.itemTitulo}>{p.titulo}</p>
                        <p className={styles.itemMeta}>
                          {ROTULO_TIPO[p.tipo]}
                          {p.numeroCnj ? ` · Processo ${p.numeroCnj}` : ''}
                          {p.origem !== 'manual' ? ' · data estimada automaticamente' : ''}
                        </p>
                        {p.descricao && p.origem === 'manual' && <p className={styles.itemDescricao}>{p.descricao}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}

        <footer className={styles.rodape}>
          <span className={styles.rodapeMarca}>
            <img src="/jusconsulta-mark.svg" alt="" width={16} height={18} />
            JusConsulta · uma solução TechTie
          </span>
          <span>Datas de prazos extraídos de movimentações são estimativas: confira no processo.</span>
        </footer>
      </main>
    </div>
  );
}
