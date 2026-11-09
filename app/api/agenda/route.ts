import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { autorizarAgenda, COLUNAS_PRAZO, paraDto, type LinhaPrazo } from '@/lib/agendaApi';
import { hojeSaoPaulo, normalizarDataISO, somarDias } from '@/lib/prazos';
import { parseCnj } from '@/lib/cnj';

const TIPOS = ['prazo', 'tarefa', 'audiencia'] as const;
type Tipo = (typeof TIPOS)[number];

const FILTROS = ['pendentes', 'atrasados', 'hoje', 'proximos', 'semana', 'concluidos', 'todos'] as const;

interface CamposPrazo {
  titulo?: string;
  descricao?: string | null;
  tipo?: Tipo;
  data_vencimento?: string;
  numero_cnj?: string | null;
}

/** Valida e normaliza os campos editáveis. `completo` exige titulo e data (criação). */
function lerCampos(body: Record<string, unknown>, completo: boolean): { campos: CamposPrazo } | { erro: string } {
  const campos: CamposPrazo = {};

  if (body.titulo !== undefined || completo) {
    const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
    if (!titulo) return { erro: 'Informe o título.' };
    if (titulo.length > 300) return { erro: 'O título pode ter no máximo 300 caracteres.' };
    campos.titulo = titulo;
  }

  if (body.descricao !== undefined) {
    if (body.descricao !== null && typeof body.descricao !== 'string') return { erro: 'Descrição inválida.' };
    const descricao = typeof body.descricao === 'string' ? body.descricao.trim() : '';
    if (descricao.length > 4000) return { erro: 'A descrição pode ter no máximo 4000 caracteres.' };
    campos.descricao = descricao || null;
  }

  if (body.tipo !== undefined || completo) {
    const tipo = body.tipo ?? 'prazo';
    if (!TIPOS.includes(tipo as Tipo)) return { erro: 'Tipo inválido (use prazo, tarefa ou audiencia).' };
    campos.tipo = tipo as Tipo;
  }

  if (body.dataVencimento !== undefined || completo) {
    const data = normalizarDataISO(typeof body.dataVencimento === 'string' ? body.dataVencimento : null);
    if (!data) return { erro: 'Informe uma data de vencimento válida.' };
    campos.data_vencimento = data;
  }

  if (body.numeroCnj !== undefined) {
    if (body.numeroCnj === null || body.numeroCnj === '') {
      campos.numero_cnj = null;
    } else {
      const info = typeof body.numeroCnj === 'string' ? parseCnj(body.numeroCnj) : null;
      if (!info) return { erro: 'Número de processo inválido (informe os 20 dígitos do CNJ).' };
      campos.numero_cnj = info.numeroFormatado;
    }
  }

  return { campos };
}

/** ap_processos.id do número CNJ, quando o processo já existe na base (vínculo opcional). */
async function buscarProcessoId(db: SupabaseClient, numeroCnj: string | null | undefined): Promise<string | null> {
  if (!numeroCnj) return null;
  const { data } = await db.from('ap_processos').select('id').eq('numero_cnj', numeroCnj).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Lista os prazos do usuário. `?filtro=` pendentes (padrão) | atrasados | hoje | proximos (depois de hoje) |
 * semana (hoje a +7 dias) | concluidos | todos (pendentes + concluídos recentes).
 */
export async function GET(request: Request) {
  const auth = await autorizarAgenda(request);
  if (auth instanceof NextResponse) return auth;
  const { userId, db } = auth;

  const filtroBruto = new URL(request.url).searchParams.get('filtro') ?? 'pendentes';
  const filtro = (FILTROS as readonly string[]).includes(filtroBruto) ? filtroBruto : 'pendentes';
  const hoje = hojeSaoPaulo();

  const consulta = (concluido: boolean) =>
    db.from('ap_prazos').select(COLUNAS_PRAZO).eq('user_id', userId).eq('concluido', concluido);

  let linhas: LinhaPrazo[] = [];
  let erro: string | null = null;

  if (filtro === 'todos') {
    const [pend, conc] = await Promise.all([
      consulta(false).order('data_vencimento', { ascending: true }).limit(500),
      consulta(true).order('concluido_em', { ascending: false, nullsFirst: false }).limit(100)
    ]);
    erro = pend.error?.message ?? conc.error?.message ?? null;
    linhas = [...((pend.data as LinhaPrazo[] | null) ?? []), ...((conc.data as LinhaPrazo[] | null) ?? [])];
  } else if (filtro === 'concluidos') {
    const r = await consulta(true).order('concluido_em', { ascending: false, nullsFirst: false }).limit(200);
    erro = r.error?.message ?? null;
    linhas = (r.data as LinhaPrazo[] | null) ?? [];
  } else {
    let q = consulta(false).order('data_vencimento', { ascending: true }).limit(500);
    if (filtro === 'atrasados') q = q.lt('data_vencimento', hoje);
    else if (filtro === 'hoje') q = q.eq('data_vencimento', hoje);
    else if (filtro === 'proximos') q = q.gt('data_vencimento', hoje);
    else if (filtro === 'semana') q = q.gte('data_vencimento', hoje).lte('data_vencimento', somarDias(hoje, 7));
    const r = await q;
    erro = r.error?.message ?? null;
    linhas = (r.data as LinhaPrazo[] | null) ?? [];
  }

  if (erro) {
    console.error('[api/agenda] erro no GET:', erro);
    return NextResponse.json({ error: 'Não foi possível carregar a agenda.' }, { status: 500 });
  }
  return NextResponse.json({ hoje, filtro, prazos: linhas.map(paraDto) });
}

/**
 * Cria um prazo/tarefa/audiência. Corpo: { titulo, dataVencimento, tipo?, descricao?, numeroCnj? } ou, para
 * importar as sugestões da varredura de movimentações, { itens: [{ ...campos, origem: 'auto_movimentacao',
 * origemHash }] } (dedupe por origemHash: o que já existe é ignorado).
 */
export async function POST(request: Request) {
  const auth = await autorizarAgenda(request);
  if (auth instanceof NextResponse) return auth;
  const { userId, db } = auth;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });

  // Importação em lote das sugestões automáticas
  if (Array.isArray(body.itens)) {
    if (body.itens.length === 0 || body.itens.length > 100) {
      return NextResponse.json({ error: 'Envie de 1 a 100 itens.' }, { status: 400 });
    }
    const linhas: Record<string, unknown>[] = [];
    for (const item of body.itens as Record<string, unknown>[]) {
      const lido = lerCampos(item ?? {}, true);
      if ('erro' in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
      const origemHash = typeof item.origemHash === 'string' && /^[a-f0-9]{16,64}$/.test(item.origemHash) ? item.origemHash : null;
      if (!origemHash) return NextResponse.json({ error: 'Item sem identificador de origem válido.' }, { status: 400 });
      linhas.push({
        user_id: userId,
        ...lido.campos,
        processo_id: await buscarProcessoId(db, lido.campos.numero_cnj),
        origem: 'auto_movimentacao',
        origem_hash: origemHash
      });
    }
    const { data, error } = await db.from('ap_prazos').upsert(linhas, { onConflict: 'user_id,origem_hash', ignoreDuplicates: true }).select('id');
    if (error) {
      console.error('[api/agenda] erro ao importar sugestões:', error.message);
      return NextResponse.json({ error: 'Não foi possível criar os prazos.' }, { status: 500 });
    }
    return NextResponse.json({ sucesso: true, criados: data?.length ?? 0, ignorados: linhas.length - (data?.length ?? 0) }, { status: 201 });
  }

  const lido = lerCampos(body, true);
  if ('erro' in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });

  const { data, error } = await db
    .from('ap_prazos')
    .insert({
      user_id: userId,
      ...lido.campos,
      processo_id: await buscarProcessoId(db, lido.campos.numero_cnj),
      origem: 'manual'
    })
    .select(COLUNAS_PRAZO)
    .single();

  if (error || !data) {
    console.error('[api/agenda] erro no POST:', error?.message);
    return NextResponse.json({ error: 'Não foi possível criar o prazo.' }, { status: 500 });
  }
  return NextResponse.json({ sucesso: true, prazo: paraDto(data as LinhaPrazo) }, { status: 201 });
}

/**
 * Atualiza um prazo. Corpo: { id, concluido? } para concluir/reabrir, e/ou { titulo?, descricao?, tipo?,
 * dataVencimento?, numeroCnj? } para editar. Mudar a data zera os lembretes já enviados (valem para a data nova).
 */
export async function PATCH(request: Request) {
  const auth = await autorizarAgenda(request);
  if (auth instanceof NextResponse) return auth;
  const { userId, db } = auth;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === 'string' ? body.id : null;
  if (!body || !id) return NextResponse.json({ error: 'ID do prazo não informado.' }, { status: 400 });

  const lido = lerCampos(body, false);
  if ('erro' in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });

  const atualizacoes: Record<string, unknown> = { ...lido.campos };
  if (lido.campos.numero_cnj !== undefined) atualizacoes.processo_id = await buscarProcessoId(db, lido.campos.numero_cnj);
  if (lido.campos.data_vencimento) atualizacoes.lembretes_enviados = [];
  if (typeof body.concluido === 'boolean') {
    atualizacoes.concluido = body.concluido;
    atualizacoes.concluido_em = body.concluido ? new Date().toISOString() : null;
  }
  if (Object.keys(atualizacoes).length === 0) return NextResponse.json({ error: 'Nenhum campo para atualizar.' }, { status: 400 });

  const { data, error } = await db
    .from('ap_prazos')
    .update(atualizacoes)
    .eq('id', id)
    .eq('user_id', userId)
    .select(COLUNAS_PRAZO)
    .maybeSingle();

  if (error) {
    console.error('[api/agenda] erro no PATCH:', error.message);
    return NextResponse.json({ error: 'Não foi possível atualizar o prazo.' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Prazo não encontrado.' }, { status: 404 });
  return NextResponse.json({ sucesso: true, prazo: paraDto(data as LinhaPrazo) });
}

/** Remove um prazo: DELETE /api/agenda?id=... */
export async function DELETE(request: Request) {
  const auth = await autorizarAgenda(request);
  if (auth instanceof NextResponse) return auth;
  const { userId, db } = auth;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID do prazo obrigatório.' }, { status: 400 });

  const { error } = await db.from('ap_prazos').delete().eq('id', id).eq('user_id', userId);
  if (error) {
    console.error('[api/agenda] erro no DELETE:', error.message);
    return NextResponse.json({ error: 'Não foi possível remover o prazo.' }, { status: 500 });
  }
  return NextResponse.json({ sucesso: true });
}
