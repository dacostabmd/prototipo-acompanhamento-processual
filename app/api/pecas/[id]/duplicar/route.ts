import { NextResponse } from 'next/server';
import { autorizarPecas } from '@/lib/pecas/acesso';
import { duplicarPeca } from '@/lib/pecas/repositorio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/pecas/:id/duplicar: cria uma cópia editável da peça (sem custo de IA). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await autorizarPecas(request);
  if (acesso instanceof NextResponse) return acesso;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Peça não encontrada.' }, { status: 404 });

  const r = await duplicarPeca(acesso.userId, id);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.indisponivel ? 503 : 500 });
  if (!r.dados) return NextResponse.json({ error: 'Peça não encontrada.' }, { status: 404 });
  return NextResponse.json({ peca: r.dados }, { status: 201 });
}
