import { NextResponse } from 'next/server';
import { autorizarPecas } from '@/lib/pecas/acesso';
import { listarProcessosDaConta } from '@/lib/pecas/contexto';

/** GET /api/pecas/processos: processos salvos ou pesquisados da conta, para escolher o contexto da peça. */
export async function GET(request: Request) {
  const acesso = await autorizarPecas(request);
  if (acesso instanceof NextResponse) return acesso;
  return NextResponse.json({ processos: await listarProcessosDaConta(acesso.userId) });
}
