import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { verificarRecursoPlano } from '@/lib/planos';
import { excedeuLimiteUsuario, explicarEmLinguagemSimples, obterJurisprudenciaPorId } from '@/lib/jurisprudencia';

const LIMITE_EXPLICACOES = 15; // por janela
const JANELA_SEGUNDOS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/jurisprudencia/explicar  { id }
 * Explica a ementa de um julgado em linguagem simples (IA, com cache). Recurso do Plano Pro.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });

  const acesso = await verificarRecursoPlano(userId, 'jurisprudencia');
  if (!acesso.permitido) {
    return NextResponse.json(
      { error: 'A explicação de julgados é exclusiva do Plano Pro.', codigo: 'recurso_pro' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'Julgado inválido.' }, { status: 400 });

  if (await excedeuLimiteUsuario(userId, 'explicar', LIMITE_EXPLICACOES, JANELA_SEGUNDOS)) {
    return NextResponse.json(
      { error: 'Muitas explicações em pouco tempo. Aguarde alguns minutos.', codigo: 'limite' },
      { status: 429, headers: { 'Retry-After': String(JANELA_SEGUNDOS) } }
    );
  }

  const item = await obterJurisprudenciaPorId(id);
  if (!item) return NextResponse.json({ error: 'Julgado não encontrado.' }, { status: 404 });

  const r = await explicarEmLinguagemSimples(item);
  if (!r.explicacao) {
    return NextResponse.json({ error: 'Não foi possível gerar a explicação agora. Leia a ementa original.' }, { status: 502 });
  }
  return NextResponse.json({ id, explicacao: r.explicacao, modelo: r.modelo, cache: r.cache });
}
