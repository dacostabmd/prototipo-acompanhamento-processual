import { getAdminClient } from '@/lib/track';

/**
 * Contexto de um processo da conta (salvo em Meus processos ou só pesquisado) para a minuta: partes, vara, assunto,
 * valor e últimos andamentos. Mesmas fontes de lib/agent/contextoConta.ts, mas estruturado e para UM processo.
 * Só o servidor chama: o cliente informa apenas o número e nunca o texto do contexto.
 */

const MOVS = 12;
const digitos = (v: string) => String(v ?? '').replace(/\D/g, '');
const corta = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}...` : t);
const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');

export interface ProcessoLista {
  numero: string;
  origem: 'salvo' | 'pesquisado';
  tribunal: string;
  classe: string;
  parteContraria: string;
}

interface Mov {
  data: string;
  titulo: string;
  descricao: string;
}

export interface ProcessoContexto {
  numero: string;
  origem: 'salvo' | 'pesquisado';
  texto: string;
}

function movimentosDe(lista: any[] | undefined): Mov[] {
  return (lista ?? [])
    .filter(m => m && (m.titulo || m.descricao || m.conteudo))
    .map(m => ({
      data: String(m.data ?? m.data_movimentacao ?? '').slice(0, 10),
      titulo: String(m.titulo ?? ''),
      descricao: String(m.descricao ?? m.conteudo ?? '')
    }))
    .sort((a, b) => (a.data < b.data ? 1 : -1))
    .slice(0, MOVS);
}

/** Processos da conta para o seletor da tela (leve: sem andamentos). */
export async function listarProcessosDaConta(userId: string): Promise<ProcessoLista[]> {
  const db = getAdminClient();
  if (!db) return [];
  try {
    const [pesq, mon] = await Promise.all([
      db.from('ap_processos_pesquisados').select('numero_cnj, tribunal, classe, parte_passiva').eq('user_id', userId).order('created_at', { ascending: false }).limit(60),
      db
        .from('ap_processos_monitorados')
        .select('ap_processos!inner(numero_cnj, tribunal, classe_processual, metadados)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(60)
    ]);
    const mapa = new Map<string, ProcessoLista>();
    for (const m of (mon.data ?? []) as any[]) {
      const p = m.ap_processos;
      if (!p?.numero_cnj) continue;
      mapa.set(digitos(p.numero_cnj), {
        numero: p.numero_cnj,
        origem: 'salvo',
        tribunal: txt(p.tribunal),
        classe: txt(p.classe_processual),
        parteContraria: txt(p.metadados?.partePassiva)
      });
    }
    for (const p of (pesq.data ?? []) as any[]) {
      const chave = digitos(p.numero_cnj);
      if (!chave || mapa.has(chave)) continue;
      mapa.set(chave, { numero: p.numero_cnj, origem: 'pesquisado', tribunal: txt(p.tribunal), classe: txt(p.classe), parteContraria: txt(p.parte_passiva) });
    }
    return [...mapa.values()];
  } catch (e) {
    console.error('[pecas/contexto] falha ao listar processos:', e instanceof Error ? e.message : e);
    return [];
  }
}

function montarTexto(numero: string, origem: string, linhas: [string, string][], movs: Mov[]): string {
  const dados = linhas.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  const movsTxt = movs.length
    ? movs.map(m => `  - [${m.data || 's/ data'}] ${corta(m.titulo, 160)}${m.descricao && m.descricao !== m.titulo ? `: ${corta(m.descricao, 260)}` : ''}`).join('\n')
    : '  - (sem andamentos registrados)';
  return (
    `=== CONTEXTO DO PROCESSO (dados do sistema, ${origem}; use só o que for pertinente à peça) ===\n` +
    `Número: ${numero}\n${dados.join('\n')}\nÚltimos andamentos (mais recente primeiro):\n${movsTxt}`
  );
}

/** Contexto completo de um processo da conta, ou null se ele não estiver nem salvo nem pesquisado por este usuário. */
export async function carregarContextoProcesso(userId: string, numeroInformado: string): Promise<ProcessoContexto | null> {
  const db = getAdminClient();
  const chave = digitos(numeroInformado);
  if (!db || chave.length < 15) return null;

  try {
    const lista = await listarProcessosDaConta(userId);
    const achado = lista.find(p => digitos(p.numero) === chave);
    if (!achado) return null;

    if (achado.origem === 'salvo') {
      const { data } = await db
        .from('ap_processos_monitorados')
        .select(
          'processo_id, ap_processos!inner(numero_cnj, tribunal, classe_processual, assunto_principal, valor_causa, data_distribuicao, orgao_julgador, comarca, metadados)'
        )
        .eq('user_id', userId)
        .eq('ap_processos.numero_cnj', achado.numero)
        .limit(1)
        .maybeSingle();
      const p = (data as any)?.ap_processos;
      if (p) {
        const { data: movs } = await db
          .from('ap_movimentacoes')
          .select('data_movimentacao, titulo, conteudo')
          .eq('processo_id', (data as any).processo_id)
          .order('data_movimentacao', { ascending: false })
          .limit(MOVS);
        const meta = (p.metadados ?? {}) as Record<string, unknown>;
        const valor = p.valor_causa != null && !Number.isNaN(Number(p.valor_causa)) ? Number(p.valor_causa).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '';
        return {
          numero: p.numero_cnj,
          origem: 'salvo',
          texto: montarTexto(
            p.numero_cnj,
            'salvo em Meus processos',
            [
              ['Tribunal', txt(p.tribunal)],
              ['Classe', txt(p.classe_processual)],
              ['Assunto', txt(p.assunto_principal)],
              ['Vara/foro', txt(p.orgao_julgador) || txt(meta.varaForo) || txt(p.comarca)],
              ['Autor / polo ativo', txt(meta.parteAtiva)],
              ['Réu / polo passivo', txt(meta.partePassiva)],
              ['Valor da causa', valor],
              ['Distribuição', txt(p.data_distribuicao) || txt(meta.distribuicao)]
            ],
            movimentosDe(movs ?? [])
          )
        };
      }
    }

    const { data } = await db
      .from('ap_processos_pesquisados')
      .select('numero_cnj, tribunal, classe, assunto, parte_passiva, dados_brutos')
      .eq('user_id', userId)
      .eq('numero_cnj', achado.numero)
      .maybeSingle();
    if (!data) return null;
    const bruto = ((data as any).dados_brutos ?? {}) as Record<string, any>;
    const proc = (bruto.processo ?? {}) as Record<string, any>;
    return {
      numero: (data as any).numero_cnj,
      origem: 'pesquisado',
      texto: montarTexto(
        (data as any).numero_cnj,
        'só pesquisado',
        [
          ['Tribunal', txt((data as any).tribunal) || txt(proc.tribunal)],
          ['Classe', txt((data as any).classe) || txt(proc.tipo)],
          ['Assunto', txt((data as any).assunto) || txt(proc.assunto)],
          ['Vara/foro', txt(proc.varaForo)],
          ['Autor / polo ativo', txt(proc.autor)],
          ['Réu / polo passivo', txt(proc.reu) || txt(proc.parteContraria) || txt((data as any).parte_passiva)],
          ['Valor da causa', txt(bruto.valorCausa) || txt(proc.valorCausa)],
          ['Distribuição', txt(bruto.distribuicao) || txt(proc.distribuicao)]
        ],
        movimentosDe(proc.movimentos ?? bruto.movimentos)
      )
    };
  } catch (e) {
    console.error('[pecas/contexto] falha ao carregar contexto:', e instanceof Error ? e.message : e);
    return null;
  }
}
