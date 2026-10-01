import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { listarFunis } from '@/lib/bitrix';

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  try {
    const { pipelines, simulated } = await listarFunis();
    return NextResponse.json({ pipelines, simulated });
  } catch (e) {
    console.error('[api/automacao/bitrix/funis] erro:', e);
    return NextResponse.json({ error: 'Falha ao consultar funis no Bitrix.' }, { status: 502 });
  }
}
