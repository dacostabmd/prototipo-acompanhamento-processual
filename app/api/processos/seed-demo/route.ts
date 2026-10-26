import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireUser } from '@/lib/requireUser';
import { getAdminClient, getUserId } from '@/lib/track';

/**
 * Endpoint para popular processos de demonstração com acompanhamento WhatsApp ativo.
 * Permite que usuários e avaliadores testem imediatamente o Copiloto e os alertas.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) {
    return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
  }

  // 1. Garante que o telefone do perfil esteja preenchido
  const { data: perfil } = await db.from('ap_perfis').select('telefone').eq('id', userId).maybeSingle();
  if (!perfil?.telefone) {
    await db.from('ap_perfis').update({ telefone: '11999999999' }).eq('id', userId);
  }

  // 2. Processos de demonstração
  const demoProcs = [
    {
      numero_cnj: '1001234-56.2024.8.26.0100',
      titulo: '1001234-56.2024.8.26.0100',
      tribunal: 'TJSP',
      classe_processual: 'Procedimento Comum Cível',
      assunto_principal: 'Indenização por Dano Material e Moral',
      status: 'ativo',
      valor_causa: 45000,
      metadados: {
        parteAtiva: 'Carlos Eduardo Mendes',
        partePassiva: 'Banco Financiador S/A',
        varaForo: '24ª Vara Cível Central da Comarca da Capital'
      },
      ultima_movimentacao_em: new Date(Date.now() - 86400000 * 2).toISOString(),
      proxima_consulta_em: new Date(Date.now() + 86400000).toISOString(),
      ultima_consulta_em: new Date().toISOString(),
      monitorar: true
    },
    {
      numero_cnj: '5004321-12.2023.4.03.6100',
      titulo: '5004321-12.2023.4.03.6100',
      tribunal: 'TRF-3',
      classe_processual: 'Cumprimento de Sentença contra a Fazenda Pública',
      assunto_principal: 'Precatório / Requisição de Pequeno Valor - RPV',
      status: 'ativo',
      valor_causa: 89500,
      metadados: {
        parteAtiva: 'Marina Silveira Duarte',
        partePassiva: 'Instituto Nacional do Seguro Social - INSS',
        varaForo: '6ª Vara Previdenciária Federal de São Paulo'
      },
      ultima_movimentacao_em: new Date(Date.now() - 86400000 * 1).toISOString(),
      proxima_consulta_em: new Date(Date.now() + 86400000).toISOString(),
      ultima_consulta_em: new Date().toISOString(),
      monitorar: true
    }
  ];

  for (const p of demoProcs) {
    let procId: string;
    const { data: existente } = await db
      .from('ap_processos')
      .select('id')
      .eq('numero_cnj', p.numero_cnj)
      .maybeSingle();

    if (existente) {
      procId = existente.id;
      await db.from('ap_processos').update(p).eq('id', procId);
    } else {
      const { data: novo, error: errIns } = await db
        .from('ap_processos')
        .insert(p)
        .select('id')
        .single();
      if (errIns || !novo) continue;
      procId = novo.id;
    }

    // Resumo IA
    if (p.numero_cnj.includes('1001234')) {
      await db.from('ap_resumos_ia').delete().eq('processo_id', procId);
      await db.from('ap_resumos_ia').insert({
        processo_id: procId,
        resumo_simplificado: 'O juiz abriu prazo legal de 15 dias para réplica após a manifestação do Banco.',
        status_atual_explicado: 'Fase de contestação concluída. Momento processual para apontar divergências na resposta do réu.',
        proximos_passos: 'Protocolar réplica no tribunal antes de 15/11/2026.',
        pontos_atencao: 'Pode exigir ação rápida: fale com o advogado responsável.',
        urgencia: 'alta',
        modelo_ia: 'gpt-4o-mini',
        ultima_movimentacao_coberta: p.ultima_movimentacao_em
      });
    } else {
      await db.from('ap_resumos_ia').delete().eq('processo_id', procId);
      await db.from('ap_resumos_ia').insert({
        processo_id: procId,
        resumo_simplificado: 'A Requisição de Pequeno Valor (RPV) foi expedida e encaminhada para o TRF-3.',
        status_atual_explicado: 'Os cálculos foram homologados e a ordem de pagamento foi formalizada pelo juízo.',
        proximos_passos: 'Acompanhar a liberação do lote de pagamento na conta vinculada do banco pagador.',
        pontos_atencao: null,
        urgencia: 'media',
        modelo_ia: 'gpt-4o-mini',
        ultima_movimentacao_coberta: p.ultima_movimentacao_em
      });
    }

    // Monitoramento com WhatsApp ATIVO
    const { data: monitorado } = await db
      .from('ap_processos_monitorados')
      .select('id')
      .eq('user_id', userId)
      .eq('processo_id', procId)
      .maybeSingle();

    if (monitorado) {
      await db
        .from('ap_processos_monitorados')
        .update({
          notificar_email: true,
          notificar_whatsapp: true,
          tags: ['sensibilidade:smart_digest']
        })
        .eq('id', monitorado.id);
    } else {
      await db
        .from('ap_processos_monitorados')
        .insert({
          user_id: userId,
          processo_id: procId,
          pasta: 'Principal',
          tags: ['sensibilidade:smart_digest'],
          notificar_email: true,
          notificar_whatsapp: true
        });
    }

    // Pesquisados
    const hash = crypto.createHash('sha256').update(p.numero_cnj).digest('hex');
    await db.from('ap_processos_pesquisados').upsert(
      {
        user_id: userId,
        hash,
        numero_cnj: p.numero_cnj,
        tribunal: p.tribunal,
        classe: p.classe_processual,
        parte_passiva: p.metadados.partePassiva,
        ultima_movimentacao_em: p.ultima_movimentacao_em,
        dados_brutos: {
          movimentos: [
            {
              data: p.ultima_movimentacao_em,
              titulo: p.numero_cnj.includes('1001234') ? 'Despacho Proferido - Intimação para Réplica' : 'Expedição de Ofício Requisitório (RPV)',
              descricao: p.numero_cnj.includes('1001234') ? 'Vistos. Manifeste-se o autor em réplica à contestação.' : 'Expedido ofício requisitório de pequeno valor enviado ao TRF-3.'
            }
          ],
          valorCausa: p.valor_causa
        }
      },
      { onConflict: 'user_id,hash' }
    );
  }

  // Notificação no feed
  await db.from('ap_notificacoes').insert({
    user_id: userId,
    titulo: 'Processos de Demonstração Carregados',
    mensagem: 'Dois processos de demonstração com acompanhamento diário e WhatsApp ativo foram vinculados à sua conta.',
    lida: false
  });

  return NextResponse.json({ ok: true, message: 'Processos de demonstração carregados com sucesso.' });
}
