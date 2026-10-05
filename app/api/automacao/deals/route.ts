import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { getAdminClient, getUserId } from '@/lib/track';
import type { AutomacaoDeal } from '@/lib/automacao';

function mapDeal(row: Record<string, unknown>): AutomacaoDeal {
  return {
    id: row.id as string,
    regraId: row.regra_id as string,
    dealId: row.deal_id as number,
    dealTitulo: (row.deal_titulo as string) ?? null,
    numeroCnj: (row.numero_cnj as string) ?? null,
    numeroCnjFormatado: (row.numero_cnj_formatado as string) ?? null,
    tribunalLabel: (row.tribunal_label as string) ?? null,
    esfera: (row.esfera as AutomacaoDeal['esfera']) ?? null,
    valorDeal: row.valor_deal !== null && row.valor_deal !== undefined ? Number(row.valor_deal) : null,
    status: row.status as AutomacaoDeal['status'],
    erroMensagem: (row.erro_mensagem as string) ?? null,
    dadosEnriquecidos: (row.dados_enriquecidos as AutomacaoDeal['dadosEnriquecidos']) ?? {},
    processadoEm: (row.processado_em as string) ?? null,
    createdAt: row.created_at as string
  };
}

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!db || !userId) return NextResponse.json({ deals: [], total: 0, page: 1, pageSize: 10 });

  const url = new URL(request.url);
  const regraId = url.searchParams.get('regraId');
  if (!regraId) return NextResponse.json({ error: 'regraId é obrigatório.' }, { status: 400 });

  const { data: regra } = await db.from('ap_automacao_regras').select('user_id').eq('id', regraId).maybeSingle();
  if (!regra) return NextResponse.json({ error: 'Regra não encontrada.' }, { status: 404 });

  const { data: perfil } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  if (regra.user_id !== userId && perfil?.role !== 'admin' && perfil?.role !== 'owner') {
    return NextResponse.json({ error: 'Sem permissão para ver esta regra.' }, { status: 403 });
  }

  const page = Math.max(Number(url.searchParams.get('page') ?? '1'), 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get('pageSize') ?? '10'), 1), 100);
  const esfera = url.searchParams.get('esfera');
  const valorMin = url.searchParams.get('valorMin');
  const valorMax = url.searchParams.get('valorMax');
  const busca = url.searchParams.get('busca')?.trim();

  // Só exibe deals efetivamente enriquecidos (com dado real) — processos sem informação no
  // InfoSimples/DataJud nunca são persistidos por app/api/automacao/processar/route.ts, mas o
  // filtro aqui também protege contra linhas antigas gravadas por uma versão anterior do fluxo.
  let query = db
    .from('ap_automacao_deals')
    .select('id,regra_id,deal_id,deal_titulo,numero_cnj,numero_cnj_formatado,tribunal_label,esfera,valor_deal,status,erro_mensagem,dados_enriquecidos,processado_em,created_at', {
      count: 'exact'
    })
    .eq('regra_id', regraId)
    .eq('status', 'enriquecido')
    .order('created_at', { ascending: false });

  if (esfera) query = query.eq('esfera', esfera);
  if (valorMin) query = query.gte('valor_deal', Number(valorMin));
  if (valorMax) query = query.lte('valor_deal', Number(valorMax));
  if (busca) query = query.or(`numero_cnj_formatado.ilike.%${busca}%,deal_titulo.ilike.%${busca}%`);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error('[api/automacao/deals] erro ao listar:', error.message);
    return NextResponse.json({ error: 'Falha ao carregar deals.' }, { status: 500 });
  }

  return NextResponse.json({ deals: (data ?? []).map(mapDeal), total: count ?? 0, page, pageSize });
}
