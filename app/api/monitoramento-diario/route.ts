import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { colegasDoEscritorio } from '@/lib/equipe';
import {
  atualizarBuscaDiario,
  cadastrarBuscaDiario,
  excluirBuscaDiario,
  listarBuscasDiario,
  listarPublicacoesDiario,
  marcarPublicacoesLidas,
  obterUsoLimiteDiario,
  varrerMonitoramentosDiario,
  type CodigoErroDiario,
  type ItemVarreduraDiario
} from '@/lib/monitoramentoDiario';

// O cadastro já dispara a 1ª varredura (até 5 páginas do DJEN, espaçadas em 1,2 s).
export const maxDuration = 60;

const STATUS_POR_CODIGO: Record<CodigoErroDiario, number> = {
  limite_plano: 403,
  invalido: 400,
  duplicado: 409,
  nao_encontrado: 404,
  indisponivel: 503,
  erro: 500
};

function respostaErro(erro: string | undefined, codigo: CodigoErroDiario | undefined) {
  return NextResponse.json(
    { error: erro || 'Falha ao processar a solicitação.', ...(codigo ? { codigo } : {}) },
    { status: STATUS_POR_CODIGO[codigo ?? 'erro'] }
  );
}

async function autenticar(request: Request): Promise<{ userId: string } | { resposta: NextResponse }> {
  const naoAutorizado = await requireUser(request);
  if (naoAutorizado) return { resposta: naoAutorizado };
  const userId = await getUserId(request);
  if (!userId) return { resposta: NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 }) };
  return { userId };
}

/**
 * Lista as buscas do Diário com a contagem de não lidas e o uso do limite do plano.
 * Com `?publicacoes=1` devolve as publicações (opcionais: `busca=ID`, `naoLidas=1`, `pagina`, `porPagina`).
 */
export async function GET(request: Request) {
  const auth = await autenticar(request);
  if ('resposta' in auth) return auth.resposta;
  const { userId } = auth;

  const { searchParams } = new URL(request.url);

  // Escritório: buscas dos colegas entram na lista em modo leitura (sem escritório, `colegas` é vazio).
  const colegas = await colegasDoEscritorio(userId);

  if (searchParams.get('publicacoes') === '1') {
    // Publicações de uma busca de colega (somente leitura): a busca precisa pertencer a alguém do escritório.
    let donoDasPublicacoes = userId;
    const buscaPedida = searchParams.get('busca');
    const db = getAdminClient();
    if (buscaPedida && colegas.length > 0 && db) {
      const { data: dona } = await db.from('ap_monitoramento_diario').select('user_id').eq('id', buscaPedida).maybeSingle();
      const donaId = (dona as { user_id?: string } | null)?.user_id;
      if (donaId && colegas.some(c => c.id === donaId)) donoDasPublicacoes = donaId;
    }
    const lista = await listarPublicacoesDiario(donoDasPublicacoes, {
      buscaId: searchParams.get('busca'),
      apenasNaoLidas: searchParams.get('naoLidas') === '1',
      pagina: Number(searchParams.get('pagina')) || 1,
      porPagina: Number(searchParams.get('porPagina')) || 20
    });
    return NextResponse.json(lista);
  }

  const [buscas, uso, buscasDosColegas] = await Promise.all([
    listarBuscasDiario(userId),
    obterUsoLimiteDiario(userId),
    Promise.all(
      colegas.map(async c =>
        (await listarBuscasDiario(c.id)).map(b => ({ ...b, naoLidas: 0, compartilhadoPor: c.nome, somenteLeitura: true as const }))
      )
    )
  ]);
  return NextResponse.json({
    buscas: [...buscas, ...buscasDosColegas.flat()],
    uso,
    // Não lidas e limite contam só as buscas do próprio usuário.
    totalNaoLidas: buscas.reduce((soma, b) => soma + b.naoLidas, 0)
  });
}

/** Cadastra uma busca (OAB, nome ou termo) e já faz a 1ª varredura (importa 7 dias, sem alertar). */
export async function POST(request: Request) {
  const auth = await autenticar(request);
  if ('resposta' in auth) return auth.resposta;
  const { userId } = auth;

  const body = await request.json().catch(() => null);
  const resultado = await cadastrarBuscaDiario({
    userId,
    tipo: typeof body?.tipo === 'string' ? body.tipo : '',
    valor: typeof body?.valor === 'string' ? body.valor : '',
    ufOab: typeof body?.ufOab === 'string' ? body.ufOab : null,
    notificarWhatsapp: typeof body?.notificarWhatsapp === 'boolean' ? body.notificarWhatsapp : true,
    notificarEmail: typeof body?.notificarEmail === 'boolean' ? body.notificarEmail : true
  });
  if (!resultado.sucesso || !resultado.dados) return respostaErro(resultado.erro, resultado.codigo);

  // Primeira varredura na hora, para o usuário já ver as publicações recentes. Se o DJEN falhar ou estiver
  // em pausa, o cron refaz (ultima_varredura_em continua nulo, então segue sendo a 1ª e sem alerta).
  let importadas = 0;
  let avisoVarredura: string | undefined;
  const db = getAdminClient();
  if (db) {
    const busca = resultado.dados.busca;
    const item: ItemVarreduraDiario = {
      id: busca.id,
      user_id: busca.user_id,
      tipo: busca.tipo,
      valor: busca.valor,
      uf_oab: busca.uf_oab,
      rotulo: busca.rotulo,
      notificar_whatsapp: busca.notificar_whatsapp,
      notificar_email: busca.notificar_email,
      ultima_varredura_em: null
    };
    const resumo = await varrerMonitoramentosDiario(db, [item]);
    importadas = resumo.novasPublicacoes;
    if (resumo.comErro > 0 || resumo.adiadas > 0) {
      avisoVarredura = 'A busca foi cadastrada, mas o Diário não respondeu agora. Tentaremos de novo automaticamente.';
    }
  }

  return NextResponse.json({ sucesso: true, id: resultado.dados.busca.id, importadas, aviso: avisoVarredura }, { status: 201 });
}

/**
 * PATCH: `{ id, ativo?, notificarWhatsapp?, notificarEmail? }` altera a busca;
 * `{ lidas: true, busca?: ID, ids?: [...] }` marca publicações como lidas (sem `busca`/`ids`, todas).
 */
export async function PATCH(request: Request) {
  const auth = await autenticar(request);
  if ('resposta' in auth) return auth.resposta;
  const { userId } = auth;

  const body = await request.json().catch(() => null);

  if (body?.lidas === true) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((i: unknown): i is string => typeof i === 'string') : undefined;
    const resultado = await marcarPublicacoesLidas(userId, { ids, buscaId: typeof body.busca === 'string' ? body.busca : null });
    return resultado.sucesso ? NextResponse.json({ sucesso: true }) : respostaErro(resultado.erro, resultado.codigo);
  }

  const id = typeof body?.id === 'string' ? body.id : null;
  if (!id) return NextResponse.json({ error: 'ID da busca não informado.' }, { status: 400 });

  const resultado = await atualizarBuscaDiario(userId, id, {
    ativo: typeof body.ativo === 'boolean' ? body.ativo : undefined,
    notificarWhatsapp: typeof body.notificarWhatsapp === 'boolean' ? body.notificarWhatsapp : undefined,
    notificarEmail: typeof body.notificarEmail === 'boolean' ? body.notificarEmail : undefined
  });
  return resultado.sucesso ? NextResponse.json({ sucesso: true }) : respostaErro(resultado.erro, resultado.codigo);
}

/** Exclui a busca e as publicações dela (`?id=ID`). */
export async function DELETE(request: Request) {
  const auth = await autenticar(request);
  if ('resposta' in auth) return auth.resposta;
  const { userId } = auth;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID da busca obrigatório.' }, { status: 400 });

  const resultado = await excluirBuscaDiario(userId, id);
  return resultado.sucesso ? NextResponse.json({ sucesso: true }) : respostaErro(resultado.erro, resultado.codigo);
}

