import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminClient, trackEvento } from '@/lib/track';
import { CAMPOS_VARREDURA_DIARIO, varrerMonitoramentosDiario, type ItemVarreduraDiario } from '@/lib/monitoramentoDiario';

export const maxDuration = 300;

// Cada busca faz de 1 a 5 requisições ao DJEN espaçadas em 1,2 s; 15 buscas cabem folgadas nos 300 s.
const MAX_BUSCAS_POR_EXECUCAO = 15;

function validarSegredo(request: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return true; // desenvolvimento local

  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token.length !== segredo.length) return false;

  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(segredo));
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!validarSegredo(request)) {
    return NextResponse.json({ error: 'Acesso não autorizado ao cron de varredura do Diário.' }, { status: 401 });
  }

  const db = getAdminClient();
  if (!db) {
    return NextResponse.json({ error: 'Banco de dados indisponível.' }, { status: 503 });
  }

  const agoraIso = new Date().toISOString();

  const { data, error } = await db
    .from('ap_monitoramento_diario')
    .select(CAMPOS_VARREDURA_DIARIO)
    .eq('ativo', true)
    .or(`proxima_varredura_em.is.null,proxima_varredura_em.lte.${agoraIso}`)
    .order('ultima_varredura_em', { ascending: true, nullsFirst: true })
    .limit(MAX_BUSCAS_POR_EXECUCAO);

  if (error) {
    console.error('[cron/varredura-diario] Erro ao carregar buscas:', error.message);
    return NextResponse.json({ error: 'Falha ao selecionar buscas para varredura.' }, { status: 500 });
  }

  const buscas = (data ?? []) as unknown as ItemVarreduraDiario[];
  const resumo = await varrerMonitoramentosDiario(db, buscas);

  await trackEvento(request, null, {
    tipo: 'reconsulta_noturna',
    dados: {
      subtipo: 'varredura_diario_djen',
      buscasSelecionadas: buscas.length,
      buscasProcessadas: resumo.processadas,
      novasPublicacoes: resumo.novasPublicacoes,
      alertasEnviados: resumo.alertasEnviados,
      erros: resumo.comErro,
      adiadas: resumo.adiadas
    }
  });

  return NextResponse.json({
    selecionadas: buscas.length,
    processadas: resumo.processadas,
    novasPublicacoes: resumo.novasPublicacoes,
    alertasEnviados: resumo.alertasEnviados,
    erros: resumo.comErro,
    adiadas: resumo.adiadas,
    itens: resumo.itens,
    status: 'concluido'
  });
}
