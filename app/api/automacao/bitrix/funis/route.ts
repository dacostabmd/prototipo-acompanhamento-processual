import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { requireAdvogadoOuAdmin } from '@/lib/requireRole';
import { listarFunisIA } from '@/lib/bitrix';

const CAMPO_PROCESSO_DEFAULT = 'UF_CRM_1740590606';

export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;
  const roleBlocked = await requireAdvogadoOuAdmin(request);
  if (roleBlocked) return roleBlocked;

  const url = new URL(request.url);
  const campoProcesso = url.searchParams.get('campoProcesso')?.trim() || CAMPO_PROCESSO_DEFAULT;

  try {
    const { pipelines, simulated } = await listarFunisIA(campoProcesso);
    return NextResponse.json({ pipelines, simulated });
  } catch (e) {
    console.error('[api/automacao/bitrix/funis] erro:', e);
    return NextResponse.json({ error: 'Falha ao consultar funis no Bitrix.' }, { status: 502 });
  }
}
