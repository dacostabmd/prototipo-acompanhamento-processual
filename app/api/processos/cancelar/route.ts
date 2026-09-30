import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { cancelarTribunal } from '@/lib/consultaAbort';

/**
 * Cancela a chamada de um tribunal específico dentro de uma consulta multi-tribunal em andamento
 * (POST /api/processos), identificada pelo consultaId recebido no evento 'started' do streaming NDJSON.
 * Não afeta os demais tribunais da mesma consulta.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  try {
    const { consultaId, label } = await request.json();
    if (!consultaId || !label) {
      return NextResponse.json({ error: 'consultaId e label são obrigatórios.' }, { status: 400 });
    }

    const cancelado = cancelarTribunal(consultaId, label);
    return NextResponse.json({ cancelado });
  } catch (error) {
    console.error('[api/processos/cancelar] Exceção:', error);
    return NextResponse.json({ error: 'Falha ao cancelar consulta do tribunal.' }, { status: 500 });
  }
}
