import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { cancelarTribunal, encerrarConsulta } from '@/lib/consultaAbort';

/**
 * Cancela a chamada de um tribunal específico dentro de uma consulta multi-tribunal em andamento
 * (POST /api/processos), identificada pelo consultaId recebido no evento 'started' do streaming NDJSON.
 * Não afeta os demais tribunais da mesma consulta.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  try {
    const { consultaId, label, encerrar } = await request.json();
    // encerrar: true = "encerrar e ver resultados" (aborta tudo, mas a consulta termina com o que já achou).
    if (consultaId && encerrar === true) {
      return NextResponse.json({ cancelado: encerrarConsulta(consultaId) });
    }
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
