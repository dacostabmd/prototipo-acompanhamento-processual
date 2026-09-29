import { NextResponse } from 'next/server';
import { getUserId, trackEvento, type TipoEvento } from '@/lib/track';

// Eventos disparados pelo navegador. Consultas são registradas no servidor (/api/processos).
const PERMITIDOS: TipoEvento[] = ['login', 'logout', 'signup', 'page_view'];

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const { tipo, dados } = await request.json().catch(() => ({}));
  if (!PERMITIDOS.includes(tipo)) return NextResponse.json({ error: 'Evento inválido.' }, { status: 400 });

  await trackEvento(request, userId, { tipo, dados: typeof dados === 'object' && dados ? dados : {} });
  return NextResponse.json({ ok: true });
}
