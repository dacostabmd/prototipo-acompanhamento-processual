import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminClient, trackEvento } from '@/lib/track';
import { enviarLembretesDePrazos } from '@/lib/lembretesPrazos';

export const maxDuration = 120;

const PRAZO_TOTAL_MS = 100_000;

function validarSegredo(request: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  // Sem segredo só é aceito em desenvolvimento local; em produção, nunca.
  if (!segredo) return process.env.NODE_ENV !== 'production';

  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token.length !== segredo.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(segredo));
  } catch {
    return false;
  }
}

// A Vercel chama o cron com GET; POST continua para disparo manual (curl com o mesmo Bearer).
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!validarSegredo(request)) {
    return NextResponse.json({ error: 'Acesso não autorizado ao cron de lembretes de prazos.' }, { status: 401 });
  }

  const db = getAdminClient();
  if (!db) return NextResponse.json({ error: 'Banco de dados indisponível.' }, { status: 503 });

  const resultado = await enviarLembretesDePrazos(db, { ateMs: Date.now() + PRAZO_TOTAL_MS });

  await trackEvento(request, null, {
    tipo: 'reconsulta_noturna',
    dados: { subtipo: 'lembretes_prazos', ...resultado }
  });

  return NextResponse.json({ ...resultado, status: 'concluido' });
}
