import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { listarEtapas } from '@/lib/bitrix';

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  const url = new URL(request.url);
  const categoriaId = Number(url.searchParams.get('categoriaId') ?? '0');
  if (Number.isNaN(categoriaId)) {
    return NextResponse.json({ error: 'categoriaId inválido.' }, { status: 400 });
  }

  try {
    const { stages, simulated } = await listarEtapas(categoriaId);
    return NextResponse.json({ stages, simulated });
  } catch (e) {
    console.error('[api/automacao/bitrix/etapas] erro:', e);
    return NextResponse.json({ error: 'Falha ao consultar etapas no Bitrix.' }, { status: 502 });
  }
}
