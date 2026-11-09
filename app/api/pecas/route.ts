import { NextResponse } from 'next/server';
import { citacoesPara } from '@/lib/jurisprudencia';
import { autorizarPecas, excedeuLimiteGeracao } from '@/lib/pecas/acesso';
import { carregarContextoProcesso } from '@/lib/pecas/contexto';
import { ErroGeracao, gerarPeca } from '@/lib/pecas/geracao';
import { obterModelo, tipoPecaValido } from '@/lib/pecas/modelos';
import { listarPecas, MSG_HISTORICO_INDISPONIVEL, salvarPeca } from '@/lib/pecas/repositorio';
import type { EntradaPeca, RespostaGeracao } from '@/lib/pecas/tipos';

// A geração com gpt-4o de uma peça longa pode passar de um minuto.
export const maxDuration = 120;

const LIMITE_CAMPO = 6000;
const LIMITE_TOTAL = 24000;
const LIMITE_RAJADA = 6; // gerações por 10 minutos
const LIMITE_DIA = 40;

/** GET /api/pecas: histórico de peças geradas pelo usuário. */
export async function GET(request: Request) {
  const acesso = await autorizarPecas(request);
  if (acesso instanceof NextResponse) return acesso;

  const r = await listarPecas(acesso.userId);
  if (!r.ok) {
    if (r.indisponivel) return NextResponse.json({ pecas: [], historicoIndisponivel: true, avisoHistorico: r.erro });
    return NextResponse.json({ error: r.erro }, { status: 500 });
  }
  return NextResponse.json({ pecas: r.dados, historicoIndisponivel: false });
}

/**
 * POST /api/pecas: gera uma minuta.
 * Corpo: { tipo, campos: Record<string,string>, processoNumero?, usarJurisprudencia?, temaJurisprudencia? }
 */
export async function POST(request: Request) {
  const acesso = await autorizarPecas(request);
  if (acesso instanceof NextResponse) return acesso;
  const { userId } = acesso;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !tipoPecaValido(body.tipo)) {
    return NextResponse.json({ error: 'Escolha um tipo de peça válido.' }, { status: 400 });
  }
  const modelo = obterModelo(body.tipo)!;

  // Campos: só os do catálogo, apenas texto, com limite de tamanho.
  const brutos = (body.campos && typeof body.campos === 'object' ? body.campos : {}) as Record<string, unknown>;
  const campos: Record<string, string> = {};
  let total = 0;
  for (const c of modelo.campos) {
    const v = typeof brutos[c.id] === 'string' ? (brutos[c.id] as string).trim() : '';
    if (v.length > LIMITE_CAMPO) {
      return NextResponse.json({ error: `O campo "${c.rotulo}" passou do limite de ${LIMITE_CAMPO} caracteres.` }, { status: 400 });
    }
    if (c.tipo === 'selecao' && v && !c.opcoes?.some(o => o.value === v)) {
      return NextResponse.json({ error: `Opção inválida em "${c.rotulo}".` }, { status: 400 });
    }
    total += v.length;
    campos[c.id] = v;
  }
  if (total > LIMITE_TOTAL) return NextResponse.json({ error: 'O texto informado é longo demais. Resuma os campos e tente de novo.' }, { status: 400 });
  const faltando = modelo.campos.filter(c => c.obrigatorio && !campos[c.id]).map(c => c.rotulo);
  if (faltando.length) {
    return NextResponse.json({ error: `Preencha: ${faltando.join(', ')}.` }, { status: 400 });
  }

  if (
    (await excedeuLimiteGeracao(userId, 'rajada', LIMITE_RAJADA, 600)) ||
    (await excedeuLimiteGeracao(userId, 'dia', LIMITE_DIA, 86_400))
  ) {
    return NextResponse.json(
      { error: 'Você gerou muitas minutas em pouco tempo. Aguarde alguns minutos e tente de novo.', codigo: 'limite' },
      { status: 429, headers: { 'Retry-After': '600' } }
    );
  }

  // Processo da conta (opcional): o servidor busca o contexto; o cliente só informa o número.
  let contextoProcesso: string | undefined;
  let processoNumero: string | null = null;
  const numeroInformado = typeof body.processoNumero === 'string' ? body.processoNumero.trim() : '';
  if (numeroInformado && modelo.processual) {
    const ctx = await carregarContextoProcesso(userId, numeroInformado);
    if (!ctx) return NextResponse.json({ error: 'Esse processo não está entre os seus processos salvos ou pesquisados.' }, { status: 404 });
    contextoProcesso = ctx.texto;
    processoNumero = ctx.numero;
  }

  // Jurisprudência (opcional): SÓ julgados reais da base; o modelo nunca cita de memória.
  const usarJurisprudencia = body.usarJurisprudencia === true && modelo.usaJurisprudencia;
  const tema = typeof body.temaJurisprudencia === 'string' ? body.temaJurisprudencia.trim().slice(0, 300) : '';
  const consulta = tema || (campos.razoes || campos.teses || campos.pontosImpugnar || campos.trechoVicio || campos.fatos || '').slice(0, 300);
  const citacoes = usarJurisprudencia ? await citacoesPara(consulta, 3) : [];

  let resultado;
  try {
    resultado = await gerarPeca({
      tipo: modelo.id,
      campos,
      processoNumero,
      contextoProcesso,
      jurisprudenciaSolicitada: usarJurisprudencia,
      citacoes,
      userId,
      rastrear: true
    });
  } catch (e) {
    if (e instanceof ErroGeracao) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error('[api/pecas] erro ao gerar:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível gerar a minuta agora.' }, { status: 500 });
  }

  const entrada: EntradaPeca = {
    campos,
    processoNumero,
    usarJurisprudencia,
    temaJurisprudencia: usarJurisprudencia ? consulta : undefined,
    julgadosUsados: citacoes.map(c => ({ referencia: c.referencia, fonteUrl: c.fonteUrl }))
  };

  const salvo = await salvarPeca(userId, {
    tipo: resultado.tipo,
    titulo: resultado.titulo,
    processoNumero,
    entrada,
    conteudo: resultado.conteudo,
    modelo: resultado.modelo,
    tokensEntrada: resultado.tokensEntrada,
    tokensSaida: resultado.tokensSaida
  });

  const resposta: RespostaGeracao = {
    peca: salvo.ok ? salvo.dados : null,
    titulo: resultado.titulo,
    conteudo: resultado.conteudo,
    tipo: resultado.tipo,
    modelo: resultado.modelo,
    tokensEntrada: resultado.tokensEntrada,
    tokensSaida: resultado.tokensSaida,
    intervencoes: resultado.intervencoes,
    entrada,
    salvo: salvo.ok,
    avisoHistorico: salvo.ok ? undefined : salvo.indisponivel ? MSG_HISTORICO_INDISPONIVEL : salvo.erro,
    semJulgados: usarJurisprudencia && citacoes.length === 0
  };
  return NextResponse.json(resposta, { status: 201 });
}
