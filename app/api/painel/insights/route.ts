import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { classifyTag } from '@/lib/classify';
import type { MovementTag } from '@/lib/mockProcesses';

/**
 * GET /api/painel/insights — insights por processo da conta, para a coluna direita da Visão geral.
 * Junta os processos pesquisados (ap_processos_pesquisados) e os salvos em Meus processos
 * (ap_processos_monitorados), com custo da pesquisa, consulta de origem, andamentos classificados por
 * risco e o último resumo de IA (só para salvos: o cron noturno só reconsulta os monitorados).
 */

export interface MovimentoInsight {
  data: string;
  titulo: string;
  descricao: string;
  tag: MovementTag;
}

export interface ProcessoInsight {
  numero: string;
  tribunal: string;
  classe: string;
  parteContraria: string;
  valorCausa: string | null;
  ultimaMovimentacao: string | null;
  pesquisadoEm: string | null;
  salvo: boolean;
  salvoEm: string | null;
  canais: { email: boolean; whatsapp: boolean } | null;
  custoPesquisa: number;
  /** Consulta que encontrou o processo (necessária para salvá-lo em Meus processos). */
  consultaId: string | null;
  consulta: { tipoBusca: string; termo: string; tribunais: string[]; custoCobrado: number; totalProcessos: number; criadaEm: string } | null;
  movimentos: MovimentoInsight[];
  contagem: Record<MovementTag, number>;
  resumoIa: { resumo: string; statusAtual: string | null; proximosPassos: string | null; urgencia: string | null; criadoEm: string } | null;
}

const LIMITE = 60;
const digitos = (v: string) => v.replace(/\D/g, '');

function contar(movs: MovimentoInsight[]): Record<MovementTag, number> {
  const c: Record<MovementTag, number> = { urgente: 0, positivo: 0, andamento: 0, informativo: 0 };
  for (const m of movs) c[m.tag] += 1;
  return c;
}

function normalizarMovimentos(lista: any[] | undefined): MovimentoInsight[] {
  return (lista ?? [])
    .filter(m => m && (m.titulo || m.descricao))
    .map(m => {
      const titulo = String(m.titulo ?? '');
      const descricao = String(m.descricao ?? m.conteudo ?? '');
      const tag = (['urgente', 'positivo', 'andamento', 'informativo'] as const).includes(m.tag) ? m.tag : classifyTag(`${titulo} ${descricao}`);
      return { data: String(m.data ?? m.data_movimentacao ?? ''), titulo, descricao, tag };
    })
    .sort((a, b) => (a.data < b.data ? 1 : -1))
    .slice(0, 20);
}

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ processos: [] });

  const [pesq, mon] = await Promise.all([
    db
      .from('ap_processos_pesquisados')
      .select('numero_cnj, tribunal, classe, parte_passiva, ultima_movimentacao_em, created_at, custo_pesquisa, consulta_id, dados_brutos')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LIMITE),
    db
      .from('ap_processos_monitorados')
      .select(
        'processo_id, created_at, notificar_email, notificar_whatsapp, custo_pesquisa, consulta_id, ap_processos!inner(numero_cnj, tribunal, classe_processual, valor_causa, ultima_movimentacao_em, metadados)'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(LIMITE)
  ]);
  if (pesq.error) console.error('[api/painel/insights] pesquisados:', pesq.error.message);
  if (mon.error) console.error('[api/painel/insights] monitorados:', mon.error.message);

  const monitorados = (mon.data ?? []) as any[];
  const monPorDigitos = new Map(monitorados.map(m => [digitos(m.ap_processos.numero_cnj), m]));
  const processoIds = monitorados.map(m => m.processo_id as string);

  // Consultas de origem, resumos de IA e andamentos dos salvos que não vieram de uma pesquisa registrada.
  const consultaIds = Array.from(
    new Set([...(pesq.data ?? []).map((p: any) => p.consulta_id), ...monitorados.map(m => m.consulta_id)].filter(Boolean))
  ) as string[];
  const pesqDigitos = new Set((pesq.data ?? []).map((p: any) => digitos(p.numero_cnj)));
  const semPesquisa = monitorados.filter(m => !pesqDigitos.has(digitos(m.ap_processos.numero_cnj))).map(m => m.processo_id as string);

  const [consultas, resumos, movs] = await Promise.all([
    consultaIds.length
      ? db.from('ap_historico_consultas').select('id, tipo_busca, termo, tribunais, custo_cobrado, total_processos, created_at').in('id', consultaIds)
      : Promise.resolve({ data: [] as any[] }),
    processoIds.length
      ? db
          .from('ap_resumos_ia')
          .select('processo_id, resumo_simplificado, status_atual_explicado, proximos_passos, urgencia, created_at')
          .in('processo_id', processoIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    semPesquisa.length
      ? db
          .from('ap_movimentacoes')
          .select('processo_id, data_movimentacao, titulo, conteudo, tipo')
          .in('processo_id', semPesquisa)
          .order('data_movimentacao', { ascending: false })
          .limit(semPesquisa.length * 20)
      : Promise.resolve({ data: [] as any[] })
  ]);

  const consultaPorId = new Map(
    ((consultas.data ?? []) as any[]).map(c => [
      c.id,
      {
        tipoBusca: c.tipo_busca,
        termo: c.termo,
        tribunais: c.tribunais ?? [],
        custoCobrado: Number(c.custo_cobrado ?? 0),
        totalProcessos: c.total_processos ?? 0,
        criadaEm: c.created_at
      }
    ])
  );
  const resumoPorProcesso = new Map<string, ProcessoInsight['resumoIa']>();
  for (const r of (resumos.data ?? []) as any[]) {
    if (resumoPorProcesso.has(r.processo_id)) continue;
    resumoPorProcesso.set(r.processo_id, {
      resumo: r.resumo_simplificado,
      statusAtual: r.status_atual_explicado ?? null,
      proximosPassos: r.proximos_passos ?? null,
      urgencia: r.urgencia ?? null,
      criadoEm: r.created_at
    });
  }
  const movsPorProcesso = new Map<string, any[]>();
  for (const m of (movs.data ?? []) as any[]) {
    const lista = movsPorProcesso.get(m.processo_id) ?? [];
    lista.push(m);
    movsPorProcesso.set(m.processo_id, lista);
  }

  const processos: ProcessoInsight[] = [];

  for (const p of (pesq.data ?? []) as any[]) {
    const m = monPorDigitos.get(digitos(p.numero_cnj));
    const movimentos = normalizarMovimentos(p.dados_brutos?.processo?.movimentos ?? p.dados_brutos?.movimentos);
    const consultaId = m?.consulta_id ?? p.consulta_id;
    processos.push({
      numero: p.numero_cnj,
      tribunal: p.tribunal ?? '',
      classe: p.classe ?? '',
      parteContraria: p.parte_passiva ?? '',
      valorCausa: p.dados_brutos?.valorCausa ?? null,
      ultimaMovimentacao: p.ultima_movimentacao_em ?? movimentos[0]?.data ?? null,
      pesquisadoEm: p.created_at,
      salvo: !!m,
      salvoEm: m?.created_at ?? null,
      canais: m ? { email: !!m.notificar_email, whatsapp: !!m.notificar_whatsapp } : null,
      custoPesquisa: Number(m?.custo_pesquisa || p.custo_pesquisa || 0),
      consultaId: consultaId ?? null,
      consulta: consultaId ? consultaPorId.get(consultaId) ?? null : null,
      movimentos,
      contagem: contar(movimentos),
      resumoIa: m ? resumoPorProcesso.get(m.processo_id) ?? null : null
    });
  }

  for (const m of monitorados) {
    if (pesqDigitos.has(digitos(m.ap_processos.numero_cnj))) continue;
    const proc = m.ap_processos;
    const movimentos = normalizarMovimentos(movsPorProcesso.get(m.processo_id));
    processos.push({
      numero: proc.numero_cnj,
      tribunal: proc.tribunal ?? '',
      classe: proc.classe_processual ?? '',
      parteContraria: proc.metadados?.partePassiva ?? '',
      valorCausa: proc.valor_causa != null ? Number(proc.valor_causa).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null,
      ultimaMovimentacao: proc.ultima_movimentacao_em ?? null,
      pesquisadoEm: null,
      salvo: true,
      salvoEm: m.created_at,
      canais: { email: !!m.notificar_email, whatsapp: !!m.notificar_whatsapp },
      custoPesquisa: Number(m.custo_pesquisa ?? 0),
      consultaId: m.consulta_id ?? null,
      consulta: m.consulta_id ? consultaPorId.get(m.consulta_id) ?? null : null,
      movimentos,
      contagem: contar(movimentos),
      resumoIa: resumoPorProcesso.get(m.processo_id) ?? null
    });
  }

  return NextResponse.json({ processos });
}
