import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { invalidateProcessosCache } from '@/lib/redis';
import { obterStatusPlanoUsuario } from '@/lib/planos';
import { sincronizarMonitoramento } from '@/lib/sincronizarMonitoramento';
import type { LegalProcess } from '@/lib/mockProcesses';

/**
 * POST /api/processos/salvar — "Salvar em Meus processos", confirmado no dialog que abre ao fim da busca.
 * Corpo: { itens: [{ consultaId, numero }] }.
 *
 * Não confia em dados do cliente: o processo é remontado a partir de ap_processos_pesquisados (gravado pelo
 * servidor na busca, da própria conta) e o custo vem da consulta registrada (ap_historico_consultas).
 * Vincula ao usuário em ap_processos_monitorados (FK user_id) com consulta_id e custo_pesquisa.
 */

interface Item {
  consultaId: string;
  numero: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITENS = 100;

interface LinhaPesquisado {
  numero_cnj: string;
  tribunal: string | null;
  classe: string | null;
  parte_passiva: string | null;
  consulta_id: string | null;
  custo_pesquisa: number | null;
  dados_brutos: { processo?: LegalProcess; valorCausa?: string; distribuicao?: string; movimentos?: LegalProcess['movimentos'] } | null;
}

/** Processo completo salvo na busca; linhas antigas (sem dados_brutos.processo) viram um processo mínimo. */
function remontar(l: LinhaPesquisado): LegalProcess {
  if (l.dados_brutos?.processo?.numero) return l.dados_brutos.processo;
  return {
    numero: l.numero_cnj,
    tribunal: l.tribunal ?? '',
    tipo: l.classe ?? '',
    parteContraria: l.parte_passiva ?? '',
    valorCausa: l.dados_brutos?.valorCausa ?? '',
    distribuicao: l.dados_brutos?.distribuicao ?? '',
    movimentos: l.dados_brutos?.movimentos ?? []
  };
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const itens: Item[] = (Array.isArray(body?.itens) ? body.itens : [])
    .filter((i: any) => typeof i?.numero === 'string' && i.numero.trim() && typeof i?.consultaId === 'string' && UUID.test(i.consultaId))
    .slice(0, MAX_ITENS)
    .map((i: any) => ({ consultaId: i.consultaId, numero: i.numero.trim() }));
  if (itens.length === 0) return NextResponse.json({ error: 'Nenhum processo informado.' }, { status: 400 });

  const numeros = Array.from(new Set(itens.map(i => i.numero)));

  // A busca grava ap_processos_pesquisados depois de responder (after()): se o usuário confirmar muito rápido,
  // a linha pode ainda não existir. Tenta por alguns segundos antes de desistir.
  let linhas: LinhaPesquisado[] = [];
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const { data, error } = await db
      .from('ap_processos_pesquisados')
      .select('numero_cnj, tribunal, classe, parte_passiva, consulta_id, custo_pesquisa, dados_brutos')
      .eq('user_id', userId)
      .in('numero_cnj', numeros);
    if (error) {
      console.error('[api/processos/salvar] leitura:', error.message);
      return NextResponse.json({ error: 'Não foi possível salvar agora.' }, { status: 500 });
    }
    linhas = (data ?? []) as LinhaPesquisado[];
    if (linhas.length >= numeros.length) break;
    await new Promise(r => setTimeout(r, 700));
  }

  // Limite do plano (owner/admin sem limite). Processos já salvos não contam como novos.
  const [{ data: perfil }, status] = await Promise.all([
    db.from('ap_perfis').select('role').eq('id', userId).maybeSingle(),
    obterStatusPlanoUsuario(userId)
  ]);
  const semLimite = perfil?.role === 'owner' || perfil?.role === 'admin';
  const vagas = semLimite ? Infinity : Math.max(0, status.regras.limiteProcessosMonitorados - status.totalProcessosMonitorados);

  const { data: jaSalvos } = await db
    .from('ap_processos_monitorados')
    .select('ap_processos!inner(numero_cnj)')
    .eq('user_id', userId);
  const digitos = (v: string) => v.replace(/\D/g, '');
  const salvosDigitos = new Set(((jaSalvos ?? []) as any[]).map(r => digitos(r.ap_processos?.numero_cnj ?? '')));

  const novos = linhas.filter(l => !salvosDigitos.has(digitos(l.numero_cnj)));
  const dentroDoLimite = novos.slice(0, vagas === Infinity ? novos.length : vagas);
  const foraDoLimite = novos.slice(dentroDoLimite.length).map(l => l.numero_cnj);

  const vinculados = await sincronizarMonitoramento(userId, dentroDoLimite.map(remontar));

  // Custo da pesquisa e a consulta de origem no vínculo do usuário.
  const porNumero = new Map(dentroDoLimite.map(l => [l.numero_cnj, l]));
  await Promise.all(
    Array.from(vinculados.entries()).map(([numero, processoId]) => {
      const l = porNumero.get(numero);
      return db
        .from('ap_processos_monitorados')
        .update({ consulta_id: l?.consulta_id ?? null, custo_pesquisa: Number(l?.custo_pesquisa ?? 0) })
        .eq('user_id', userId)
        .eq('processo_id', processoId)
        .then(({ error }) => {
          if (error) console.error('[api/processos/salvar] custo:', error.message);
        });
    })
  );
  if (vinculados.size > 0) await invalidateProcessosCache(userId);

  const encontrados = new Set(linhas.map(l => l.numero_cnj));
  return NextResponse.json({
    salvos: Array.from(vinculados.keys()),
    jaSalvos: linhas.filter(l => salvosDigitos.has(digitos(l.numero_cnj))).map(l => l.numero_cnj),
    foraDoLimite,
    naoEncontrados: numeros.filter(n => !encontrados.has(n)),
    limite: semLimite ? null : status.regras.limiteProcessosMonitorados
  });
}
