import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { normalizarTelefoneBr } from '@/lib/whatsapp';
import type { ModoSensibilidade, ProcessoAcompanhado, RespostaMonitoramento, UrgenciaResumo } from '@/lib/types/monitoramento';

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

/**
 * Adiciona um processo ao acompanhamento do usuário diretamente da tela de resultados da busca.
 * Salva em ap_processos e vincula em ap_processos_monitorados com alertas via WhatsApp e/ou E-mail.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const numeroCnj = typeof body?.numeroCnj === 'string' ? body.numeroCnj.trim() : '';
  if (!numeroCnj) {
    return NextResponse.json({ error: 'Número CNJ não informado.' }, { status: 400 });
  }

  const {
    tribunal,
    classe,
    assunto,
    parteAutora,
    parteRe,
    valorCausa,
    notificarWhatsapp = true,
    notificarEmail = true,
    sensibilidade = 'smart_digest',
    telefone,
    movimentos,
    resumoIa
  } = body || {};

  // Se o usuário passou telefone novo, salva no perfil
  if (typeof telefone === 'string' && telefone.trim()) {
    const limpo = telefone.replace(/\D/g, '');
    if (limpo.length >= 10) {
      await db.from('ap_perfis').update({ telefone: limpo }).eq('id', userId);
    }
  }

  // Se pediu notificação por WhatsApp, verifica telefone cadastrado
  if (notificarWhatsapp) {
    const { data: perfil } = await db.from('ap_perfis').select('telefone').eq('id', userId).maybeSingle();
    const tel = normalizarTelefoneBr(perfil?.telefone as string | null);
    if (!tel) {
      return NextResponse.json(
        {
          error: 'Para ativar alertas por WhatsApp, cadastre seu celular com DDD no perfil.',
          codigo: 'sem_telefone'
        },
        { status: 400 }
      );
    }
  }

  // 1. Upsert em ap_processos
  const valorNumerico =
    typeof valorCausa === 'number'
      ? valorCausa
      : typeof valorCausa === 'string'
      ? parseFloat(valorCausa.replace(/[^\d,]/g, '').replace(',', '.')) || null
      : null;

  const ultimaMovimentacao =
    Array.isArray(movimentos) && movimentos.length > 0 ? movimentos[0].data : null;

  const { data: proc, error: procErr } = await db
    .from('ap_processos')
    .upsert(
      {
        numero_cnj: numeroCnj,
        titulo: numeroCnj,
        tribunal: tribunal || null,
        classe_processual: classe || null,
        assunto_principal: assunto || null,
        valor_causa: valorNumerico,
        status: 'ativo',
        monitorar: true,
        ultima_movimentacao_em: ultimaMovimentacao || new Date().toISOString(),
        metadados: {
          parteAtiva: parteAutora || null,
          partePassiva: parteRe || null
        }
      },
      { onConflict: 'numero_cnj' }
    )
    .select('id')
    .single();

  if (procErr || !proc) {
    console.error('[api/monitoramento] erro ao upsert processo:', procErr);
    return NextResponse.json({ error: 'Erro ao registrar processo.' }, { status: 500 });
  }

  // 2. Upsert em ap_processos_monitorados
  const tagSensibilidade = `sensibilidade:${sensibilidade || 'smart_digest'}`;
  const { error: monErr } = await db.from('ap_processos_monitorados').upsert(
    {
      user_id: userId,
      processo_id: proc.id,
      pasta: 'Principal',
      notificar_email: notificarEmail,
      notificar_whatsapp: notificarWhatsapp,
      tags: [tagSensibilidade]
    },
    { onConflict: 'user_id,processo_id' }
  );

  if (monErr) {
    console.error('[api/monitoramento] erro ao vincular monitoramento:', monErr);
    return NextResponse.json({ error: 'Erro ao ativar acompanhamento.' }, { status: 500 });
  }

  // 3. Salvar resumo de IA se fornecido
  if (resumoIa && typeof resumoIa === 'object') {
    const { data: resumoExistente } = await db
      .from('ap_resumos_ia')
      .select('id')
      .eq('processo_id', proc.id)
      .limit(1)
      .maybeSingle();

    if (!resumoExistente) {
      await db.from('ap_resumos_ia').insert({
        processo_id: proc.id,
        resumo_simplificado: resumoIa.resumo || 'Processo acompanhado ativamente.',
        status_atual_explicado:
          resumoIa.significado || 'Monitoramento contínuo com inteligência artificial ativado.',
        proximos_passos: resumoIa.proximoPasso || null,
        urgencia: resumoIa.urgencia || 'baixa',
        modelo_ia: 'gpt-4o-mini',
        ultima_movimentacao_coberta: ultimaMovimentacao
      });
    }
  }

  // 4. Salvar em ap_processos_pesquisados
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha256').update(numeroCnj).digest('hex');
  await db.from('ap_processos_pesquisados').upsert(
    {
      user_id: userId,
      hash,
      numero_cnj: numeroCnj,
      tribunal: tribunal || null,
      classe: classe || null,
      parte_passiva: parteRe || null,
      ultima_movimentacao_em: ultimaMovimentacao
    },
    { onConflict: 'user_id,hash' }
  );

  return NextResponse.json({
    sucesso: true,
    processoId: proc.id,
    numeroCnj,
    notificarWhatsapp,
    notificarEmail,
    mensagem: 'Processo adicionado ao acompanhamento com sucesso!'
  });
}

/**
 * Remove um processo do acompanhamento do usuário.
 */
export async function DELETE(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const processoId = typeof body?.processoId === 'string' ? body.processoId : '';
  const numeroCnj = typeof body?.numeroCnj === 'string' ? body.numeroCnj : '';

  let idParaRemover = processoId;
  if (!idParaRemover && numeroCnj) {
    const { data: proc } = await db.from('ap_processos').select('id').eq('numero_cnj', numeroCnj).maybeSingle();
    if (proc?.id) idParaRemover = proc.id;
  }

  if (!idParaRemover) {
    return NextResponse.json({ error: 'Informe o ID ou número do processo para remover.' }, { status: 400 });
  }

  const { error } = await db
    .from('ap_processos_monitorados')
    .delete()
    .eq('user_id', userId)
    .eq('processo_id', idParaRemover);

  if (error) {
    console.error('[api/monitoramento] erro ao remover:', error.message);
    return NextResponse.json({ error: 'Erro ao remover acompanhamento.' }, { status: 500 });
  }

  return NextResponse.json({ sucesso: true, removido: true });
}
