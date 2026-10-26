import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { normalizarTelefoneBr } from '@/lib/whatsapp';
import type { ModoSensibilidade, ProcessoAcompanhado, RespostaMonitoramento, UrgenciaResumo } from '@/lib/types/monitoramento';

export type { ModoSensibilidade, ProcessoAcompanhado, RespostaMonitoramento, UrgenciaResumo };

interface LinhaMonitoramento {
  processo_id: string;
  notificar_email: boolean | null;
  notificar_whatsapp: boolean | null;
  tags?: string[] | null;
  ap_processos: {
    numero_cnj: string;
    tribunal: string | null;
    classe_processual: string | null;
    ultima_movimentacao_em: string | null;
    ultima_consulta_em: string | null;
    proxima_consulta_em: string | null;
  } | null;
}

/** Processos que o usuário acompanha, com canais de aviso e o último resumo IA de cada um. */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ processos: [], telefoneValido: false } satisfies RespostaMonitoramento);

  const [monitoramentos, perfil] = await Promise.all([
    db
      .from('ap_processos_monitorados')
      .select(
        'processo_id, notificar_email, notificar_whatsapp, tags, ap_processos(numero_cnj, tribunal, classe_processual, ultima_movimentacao_em, ultima_consulta_em, proxima_consulta_em)'
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    db.from('ap_perfis').select('telefone').eq('id', userId).maybeSingle()
  ]);

  if (monitoramentos.error) {
    console.error('[api/monitoramento] erro ao listar:', monitoramentos.error.message);
    return NextResponse.json({ error: 'Falha ao carregar o acompanhamento.' }, { status: 500 });
  }

  const linhas = ((monitoramentos.data ?? []) as unknown as LinhaMonitoramento[]).filter(l => l.ap_processos);
  const ids = linhas.map(l => l.processo_id);

  // Último resumo por processo: os resumos vêm do mais novo para o mais antigo, fica o primeiro de cada.
  const ultimoResumo = new Map<string, ProcessoAcompanhado['resumo']>();
  if (ids.length > 0) {
    const { data: resumos, error } = await db
      .from('ap_resumos_ia')
      .select('processo_id, resumo_simplificado, status_atual_explicado, proximos_passos, urgencia, created_at')
      .in('processo_id', ids)
      .order('created_at', { ascending: false })
      .limit(ids.length * 3);
    if (error) console.error('[api/monitoramento] erro ao ler resumos:', error.message);
    for (const r of resumos ?? []) {
      if (ultimoResumo.has(r.processo_id as string)) continue;
      ultimoResumo.set(r.processo_id as string, {
        resumo: r.resumo_simplificado as string,
        significado: r.status_atual_explicado as string,
        proximoPasso: (r.proximos_passos as string | null) ?? null,
        urgencia: (r.urgencia as UrgenciaResumo | null) ?? null,
        criadoEm: r.created_at as string
      });
    }
  }

  const processos: ProcessoAcompanhado[] = linhas.map(l => {
    const p = l.ap_processos!;
    const tagSensibilidade = (l.tags ?? []).find(t => t.startsWith('sensibilidade:'))?.replace('sensibilidade:', '');
    const sensibilidade: ModoSensibilidade =
      tagSensibilidade === 'todas' || tagSensibilidade === 'urgentes_apenas' ? tagSensibilidade : 'smart_digest';

    return {
      processoId: l.processo_id,
      numeroCnj: p.numero_cnj,
      tribunal: p.tribunal,
      classe: p.classe_processual,
      ultimaMovimentacaoEm: p.ultima_movimentacao_em,
      ultimaConsultaEm: p.ultima_consulta_em,
      proximaConsultaEm: p.proxima_consulta_em,
      notificarEmail: l.notificar_email ?? true,
      notificarWhatsapp: l.notificar_whatsapp ?? false,
      sensibilidade,
      resumo: ultimoResumo.get(l.processo_id) ?? null
    };
  });

  return NextResponse.json({
    processos,
    telefoneValido: !!normalizarTelefoneBr(perfil.data?.telefone as string | null)
  } satisfies RespostaMonitoramento);
}

/**
 * Liga/desliga canais e define sensibilidade: { processoId, notificarEmail?, notificarWhatsapp?, sensibilidade? }.
 * WhatsApp exige telefone válido no perfil (o worker de alertas não teria para onde enviar).
 */
export async function PATCH(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });

  const body = (await request.json().catch(() => null)) as
    | { processoId?: unknown; notificarEmail?: unknown; notificarWhatsapp?: unknown; sensibilidade?: unknown }
    | null;
  const processoId = typeof body?.processoId === 'string' ? body.processoId : '';
  const campos: Record<string, unknown> = {};

  if (typeof body?.notificarEmail === 'boolean') campos.notificar_email = body.notificarEmail;
  if (typeof body?.notificarWhatsapp === 'boolean') campos.notificar_whatsapp = body.notificarWhatsapp;

  let novaSensibilidade: ModoSensibilidade | null = null;
  if (
    body?.sensibilidade === 'smart_digest' ||
    body?.sensibilidade === 'todas' ||
    body?.sensibilidade === 'urgentes_apenas'
  ) {
    novaSensibilidade = body.sensibilidade;
  }

  if (!processoId || (Object.keys(campos).length === 0 && !novaSensibilidade)) {
    return NextResponse.json({ error: 'Informe o processo e o canal ou sensibilidade a alterar.' }, { status: 400 });
  }

  if (campos.notificar_whatsapp) {
    const { data: perfil } = await db.from('ap_perfis').select('telefone').eq('id', userId).maybeSingle();
    if (!normalizarTelefoneBr(perfil?.telefone as string | null)) {
      return NextResponse.json(
        { error: 'Cadastre um celular com DDD no seu perfil para receber avisos por WhatsApp.', codigo: 'sem_telefone' },
        { status: 400 }
      );
    }
  }

  // Se alterou a sensibilidade, atualiza na coluna tags (garante compatibilidade imediata com qualquer DB)
  if (novaSensibilidade) {
    const { data: registroAtual } = await db
      .from('ap_processos_monitorados')
      .select('tags')
      .eq('user_id', userId)
      .eq('processo_id', processoId)
      .maybeSingle();

    const tagsAtuais: string[] = Array.isArray(registroAtual?.tags) ? registroAtual.tags : [];
    const tagsLimpos = tagsAtuais.filter((t: string) => !t.startsWith('sensibilidade:'));
    tagsLimpos.push(`sensibilidade:${novaSensibilidade}`);
    campos.tags = tagsLimpos;
  }

  const { data, error } = await db
    .from('ap_processos_monitorados')
    .update(campos)
    .eq('user_id', userId)
    .eq('processo_id', processoId)
    .select('notificar_email, notificar_whatsapp, tags')
    .maybeSingle();

  if (error) {
    console.error('[api/monitoramento] erro ao atualizar monitoramento:', error.message);
    return NextResponse.json({ error: 'Não foi possível salvar a preferência.' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Processo não encontrado no seu acompanhamento.' }, { status: 404 });

  const tagSensibilidade = (data.tags ?? []).find((t: string) => t.startsWith('sensibilidade:'))?.replace('sensibilidade:', '');
  const sensibilidadeEfetiva: ModoSensibilidade =
    tagSensibilidade === 'todas' || tagSensibilidade === 'urgentes_apenas' ? tagSensibilidade : 'smart_digest';

  return NextResponse.json({
    notificarEmail: data.notificar_email ?? true,
    notificarWhatsapp: data.notificar_whatsapp ?? false,
    sensibilidade: sensibilidadeEfetiva
  });
}
