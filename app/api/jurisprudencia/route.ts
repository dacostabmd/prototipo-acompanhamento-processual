import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { verificarRecursoPlano } from '@/lib/planos';
import { buscarJurisprudencia, excedeuLimiteUsuario } from '@/lib/jurisprudencia';
import { TRIBUNAIS_DISPONIVEIS } from '@/components/jurisprudencia/utils';

const LIMITE_BUSCAS = 20; // por janela
const JANELA_SEGUNDOS = 60;

/**
 * GET /api/jurisprudencia?q=&tribunal=&anoMin=&limite=
 * Busca híbrida (textual + semântica) na base de jurisprudência. Recurso do Plano Pro.
 */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });

  const acesso = await verificarRecursoPlano(userId, 'jurisprudencia');
  if (!acesso.permitido) {
    return NextResponse.json(
      { error: 'A pesquisa de jurisprudência é exclusiva do Plano Pro.', codigo: 'recurso_pro' },
      { status: 403 }
    );
  }

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim().slice(0, 300);
  if (q.length < 3) {
    return NextResponse.json({ error: 'Digite ao menos 3 caracteres para pesquisar.' }, { status: 400 });
  }

  const tribunalParam = (params.get('tribunal') || '').trim().toUpperCase();
  const tribunal = TRIBUNAIS_DISPONIVEIS.some(t => t.value === tribunalParam) ? tribunalParam : null;

  const anoAtual = new Date().getFullYear();
  const anoBruto = Number.parseInt(params.get('anoMin') || '', 10);
  const anoMin = Number.isFinite(anoBruto) && anoBruto >= 1988 && anoBruto <= anoAtual ? anoBruto : null;

  const limiteBruto = Number.parseInt(params.get('limite') || '', 10);
  const limite = Number.isFinite(limiteBruto) ? Math.min(Math.max(limiteBruto, 1), 30) : 15;

  if (await excedeuLimiteUsuario(userId, 'busca', LIMITE_BUSCAS, JANELA_SEGUNDOS)) {
    return NextResponse.json(
      { error: 'Muitas pesquisas em pouco tempo. Aguarde um minuto e tente de novo.', codigo: 'limite' },
      { status: 429, headers: { 'Retry-After': String(JANELA_SEGUNDOS) } }
    );
  }

  try {
    const { itens, modo } = await buscarJurisprudencia(q, { tribunal, anoMin, limite });
    return NextResponse.json({ itens, total: itens.length, modo, fonte: 'dados abertos do STJ' });
  } catch (e) {
    console.error('[api/jurisprudencia] erro na busca:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível pesquisar agora. Tente novamente em instantes.' }, { status: 500 });
  }
}
