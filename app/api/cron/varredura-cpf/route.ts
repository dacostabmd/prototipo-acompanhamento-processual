import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminClient, trackEvento } from '@/lib/track';
import { varrerNovosProcessosPorDocumento } from '@/lib/monitoramentoCpf';

export const maxDuration = 300;

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
    return NextResponse.json({ error: 'Acesso não autorizado ao cron de varredura de documentos.' }, { status: 401 });
  }

  const db = getAdminClient();
  if (!db) {
    return NextResponse.json({ error: 'Banco de dados indisponível.' }, { status: 503 });
  }

  const agoraIso = new Date().toISOString();

  // 1. Busca documentos ativos agendados para varredura
  const { data: documentosElegiveis, error: errSelect } = await db
    .from('ap_monitoramento_documentos')
    .select('id, user_id, documento, tipo, nome_titular, processos_conhecidos_cnjs, notificar_whatsapp')
    .eq('ativo', true)
    .or(`proxima_varredura_em.is.null,proxima_varredura_em.lte.${agoraIso}`)
    .order('ultima_varredura_em', { ascending: true, nullsFirst: true })
    .limit(20);

  if (errSelect) {
    console.error('[cron/varredura-cpf] Erro ao carregar documentos:', errSelect.message);
    return NextResponse.json({ error: 'Falha ao selecionar documentos para varredura.' }, { status: 500 });
  }

  const documentos = documentosElegiveis || [];
  let processados = 0;
  let novosProcessos = 0;
  let erros = 0;

  for (const doc of documentos) {
    try {
      const res = await varrerNovosProcessosPorDocumento(db, doc);
      processados++;
      novosProcessos += res.novosProcessosEncontrados;
    } catch (err) {
      console.error('[cron/varredura-cpf] Erro ao varrer documento:', doc.documento, err);
      erros++;
    }
  }

  await trackEvento(request, null, {
    tipo: 'reconsulta_noturna',
    dados: {
      subtipo: 'varredura_cpf_novos_processos',
      documentosProcessados: processados,
      novosProcessosIdentificados: novosProcessos,
      erros
    }
  });

  return NextResponse.json({
    processados,
    novosProcessosIdentificados: novosProcessos,
    erros,
    status: 'concluido'
  });
}
