import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { LOTE_TRADUCAO, traduzirMovimentacoes } from '@/lib/traducaoMovimentacoes';

/** Mesmo limite de movimentações por processo que o GET de /api/monitoramento devolve. */
const POR_PROCESSO = 10;
const MAX_LOTES = 3;

/**
 * Traduz para linguagem leiga as movimentações ainda sem tradução dos processos pedidos:
 * { processoIds: string[] } -> { traducoes: { [movimentacaoId]: texto } }.
 * Só processos que o usuário acompanha; o resultado fica gravado em ap_movimentacoes (cache).
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ traducoes: {} });

  const body = (await request.json().catch(() => null)) as { processoIds?: unknown } | null;
  const pedidos = Array.isArray(body?.processoIds)
    ? body.processoIds.filter((x): x is string => typeof x === 'string').slice(0, 50)
    : [];
  if (pedidos.length === 0) return NextResponse.json({ traducoes: {} });

  const { data: meus, error: errMeus } = await db
    .from('ap_processos_monitorados')
    .select('processo_id')
    .eq('user_id', userId)
    .in('processo_id', pedidos);
  if (errMeus) {
    console.error('[api/monitoramento/traduzir] erro ao validar processos:', errMeus.message);
    return NextResponse.json({ error: 'Falha ao validar processos.' }, { status: 500 });
  }
  const ids = (meus ?? []).map(m => m.processo_id as string);

  const pendentes: { id: string; texto: string }[] = [];
  await Promise.all(
    ids.map(async id => {
      const { data, error } = await db
        .from('ap_movimentacoes')
        .select('id, titulo, conteudo, traducao_leiga')
        .eq('processo_id', id)
        .order('data_movimentacao', { ascending: false })
        .limit(POR_PROCESSO);
      if (error) {
        console.error('[api/monitoramento/traduzir] erro ao ler movimentações:', error.message);
        return;
      }
      for (const m of data ?? []) {
        if (m.traducao_leiga) continue;
        const texto = [m.titulo, m.conteudo]
          .filter((t, i, arr): t is string => typeof t === 'string' && !!t.trim() && arr.indexOf(t) === i)
          .join(' — ');
        if (texto) pendentes.push({ id: m.id as string, texto });
      }
    })
  );

  const traducoes: Record<string, string> = {};
  const lotes: { id: string; texto: string }[][] = [];
  for (let i = 0; i < pendentes.length && lotes.length < MAX_LOTES; i += LOTE_TRADUCAO) {
    lotes.push(pendentes.slice(i, i + LOTE_TRADUCAO));
  }

  await Promise.all(
    lotes.map(async lote => {
      const { traducoes: mapa, modelo } = await traduzirMovimentacoes(lote);
      const agora = new Date().toISOString();
      await Promise.all(
        [...mapa].map(async ([id, texto]) => {
          traducoes[id] = texto;
          const { error } = await db
            .from('ap_movimentacoes')
            .update({ traducao_leiga: texto, traducao_modelo: modelo, traducao_em: agora })
            .eq('id', id);
          if (error) console.error('[api/monitoramento/traduzir] erro ao gravar tradução:', error.message);
        })
      );
    })
  );

  return NextResponse.json({ traducoes });
}
