import { NextResponse } from 'next/server';
import { autorizarPecas } from '@/lib/pecas/acesso';
import { montarConteudo, parsearSecoes } from '@/lib/pecas/formato';
import { atualizarPeca, excluirPeca, obterPeca } from '@/lib/pecas/repositorio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_CONTEUDO = 120_000;

type Contexto = { params: Promise<{ id: string }> };

function erroDe(r: { indisponivel: boolean; erro: string }) {
  return NextResponse.json({ error: r.erro }, { status: r.indisponivel ? 503 : 500 });
}

/** GET /api/pecas/:id: reabre uma peça do histórico. */
export async function GET(request: Request, { params }: Contexto) {
  const acesso = await autorizarPecas(request);
  if (acesso instanceof NextResponse) return acesso;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Peça não encontrada.' }, { status: 404 });

  const r = await obterPeca(acesso.userId, id);
  if (!r.ok) return erroDe(r);
  if (!r.dados) return NextResponse.json({ error: 'Peça não encontrada.' }, { status: 404 });
  return NextResponse.json({ peca: r.dados });
}

/** PATCH /api/pecas/:id { titulo?, conteudo? }: salva a edição feita na tela (o aviso fixo sempre volta). */
export async function PATCH(request: Request, { params }: Contexto) {
  const acesso = await autorizarPecas(request);
  if (acesso instanceof NextResponse) return acesso;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Peça não encontrada.' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { titulo?: unknown; conteudo?: unknown } | null;
  const campos: { titulo?: string; conteudo?: string } = {};
  if (typeof body?.titulo === 'string') {
    const titulo = body.titulo.trim();
    if (!titulo) return NextResponse.json({ error: 'O título não pode ficar vazio.' }, { status: 400 });
    campos.titulo = titulo;
  }
  if (typeof body?.conteudo === 'string') {
    if (body.conteudo.length > LIMITE_CONTEUDO) return NextResponse.json({ error: 'O texto da peça é longo demais.' }, { status: 400 });
    const secoes = parsearSecoes(body.conteudo);
    if (secoes.length === 0) return NextResponse.json({ error: 'A peça precisa ter ao menos uma seção.' }, { status: 400 });
    campos.conteudo = montarConteudo(secoes);
  }
  if (Object.keys(campos).length === 0) return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });

  const r = await atualizarPeca(acesso.userId, id, campos);
  if (!r.ok) return erroDe(r);
  if (!r.dados) return NextResponse.json({ error: 'Peça não encontrada.' }, { status: 404 });
  return NextResponse.json({ peca: r.dados });
}

/** DELETE /api/pecas/:id */
export async function DELETE(request: Request, { params }: Contexto) {
  const acesso = await autorizarPecas(request);
  if (acesso instanceof NextResponse) return acesso;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Peça não encontrada.' }, { status: 404 });

  const r = await excluirPeca(acesso.userId, id);
  if (!r.ok) return erroDe(r);
  if (!r.dados) return NextResponse.json({ error: 'Peça não encontrada.' }, { status: 404 });
  return NextResponse.json({ sucesso: true });
}
