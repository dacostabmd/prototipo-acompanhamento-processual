import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/track';
import { normalizarTelefoneBr, enviarTextoWhatsApp, enviarInterativoWhatsApp } from '@/lib/whatsapp';
import { responderDuvidaWhatsAppComAgente } from '@/lib/agent/andamentoAgent';
import { analisarDocumentoOuImagemIntimacao } from '@/lib/whatsappMedia';
import { indexarDocumentoProcessual } from '@/lib/ragDocumentos';

/**
 * Webhook oficial da Meta (WhatsApp Cloud API) para atendimento e acompanhamento bidirecional.
 *
 * GET: Verificação inicial da Meta (hub.challenge / verify_token)
 * POST: Recebimento de mensagens enviadas pelo usuário (texto livre, botões interativos
 *       ou fotos/documentos de intimações), acionando o Agente LangChain com OCR e
 *       observabilidade Langfuse em tempo real.
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken =
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'prosec_whatsapp_secret';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[whatsapp-webhook] Verificação da Meta bem-sucedida.');
    return new Response(challenge || '', { status: 200 });
  }

  return new Response('Token de verificação inválido', { status: 403 });
}

interface WhatsAppWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  image?: {
    id: string;
    mime_type?: string;
    sha256?: string;
    caption?: string;
  };
  document?: {
    id: string;
    filename?: string;
    mime_type?: string;
    sha256?: string;
    caption?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages: WhatsAppWebhookMessage[] = value.messages || [];

        for (const msg of messages) {
          const telefoneRaw = msg.from;
          const telefoneNormalizado = normalizarTelefoneBr(telefoneRaw);
          if (!telefoneNormalizado) continue;

          // Localiza o usuário no banco e seus processos monitorados
          const { usuario, processos } = await buscarContextoUsuarioPorTelefone(telefoneNormalizado);
          const nomeUsuario = usuario?.nome || 'Cliente';
          const perfilUsuario = usuario?.role === 'advogado' ? 'advogado' : 'cliente';
          const userId = usuario?.id;

          // 1. Trata recebimento de Mídia (Foto de intimação ou documento PDF)
          const ehMidia = msg.type === 'image' || msg.type === 'document';
          const mediaId = msg.image?.id || msg.document?.id;

          if (ehMidia && mediaId) {
            console.log(`[whatsapp-webhook] Anexo ${msg.type} recebido de ${telefoneNormalizado} (mediaId: ${mediaId})`);

            // Notifica o usuário de que a leitura começou
            await enviarTextoWhatsApp(
              telefoneNormalizado,
              `Recebi seu anexo! Estou examinando a intimação com nossa inteligência jurídica, só um instante...`
            );

            const resultadoMidia = await analisarDocumentoOuImagemIntimacao({
              mediaId,
              mimeTypeOriginal: msg.image?.mime_type || msg.document?.mime_type,
              caption: msg.image?.caption || msg.document?.caption,
              telefone: telefoneNormalizado,
              nomeUsuario,
              perfilUsuario,
              userId,
              processosDoUsuario: processos
            });

            // Se identificou o CNJ no documento, indexa para RAG futuro
            if (resultadoMidia.numeroCnjIdentificado) {
              const procRelacionado = processos.find(p => p.numeroCnj === resultadoMidia.numeroCnjIdentificado);
              indexarDocumentoProcessual({
                processoId: procRelacionado ? undefined : undefined,
                numeroCnj: resultadoMidia.numeroCnjIdentificado,
                tipoDocumento: 'intimacao',
                titulo: `Intimação enviada via WhatsApp em ${new Date().toLocaleDateString('pt-BR')}`,
                textoCompleto: resultadoMidia.mensagemFormatadaWhatsApp
              }).catch(err => console.error('[whatsapp-webhook] Falha ao indexar documento:', err));
            }

            await enviarInterativoWhatsApp(telefoneNormalizado, resultadoMidia.mensagemFormatadaWhatsApp, [
              { id: 'btn_detalhes', title: 'Mais detalhes' },
              { id: 'btn_ajuda', title: 'Falar com suporte' }
            ]);
            continue;
          }

          // 2. Extrai o conteúdo da mensagem (texto livre ou clique em botão de resposta rápida)
          const textoMensagem =
            msg.text?.body?.trim() ||
            msg.interactive?.button_reply?.title ||
            msg.interactive?.list_reply?.title ||
            '';

          if (!textoMensagem) continue;

          console.log(`[whatsapp-webhook] Mensagem recebida de ${telefoneNormalizado}: "${textoMensagem}"`);

          // 3. Trata comando de opt-out (LGPD): SAIR, PARAR, CANCELAR
          if (/^(sair|parar|cancelar|descadastrar|stop)$/i.test(textoMensagem)) {
            await processarOptOutWhatsApp(telefoneNormalizado);
            await enviarTextoWhatsApp(
              telefoneNormalizado,
              'Seus avisos de processo pelo WhatsApp foram desativados com sucesso conforme a LGPD.\n\nSe desejar reativar no futuro, basta acessar sua conta na TechTie e ligar a opção novamente.'
            );
            continue;
          }

          // 4. Executa o Agente LangChain com observabilidade Langfuse
          const respostaAgente = await responderDuvidaWhatsAppComAgente({
            pergunta: textoMensagem,
            telefone: telefoneNormalizado,
            nomeUsuario,
            perfilUsuario,
            processosDoUsuario: processos,
            userId
          });

          // 5. Envia a resposta de volta ao usuário no WhatsApp
          if (processos.length > 0) {
            await enviarInterativoWhatsApp(telefoneNormalizado, respostaAgente, [
              { id: 'btn_detalhes', title: 'Mais detalhes' },
              { id: 'btn_ajuda', title: 'Falar com suporte' }
            ]);
          } else {
            await enviarTextoWhatsApp(telefoneNormalizado, respostaAgente);
          }
        }
      }
    }

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('[whatsapp-webhook] Erro ao processar webhook:', error);
    return NextResponse.json({ status: 'error', message: (error as Error).message }, { status: 200 });
  }
}

/**
 * Desliga o WhatsApp de todos os processos monitorados pelo telefone indicado.
 */
async function processarOptOutWhatsApp(telefoneNormalizado: string) {
  const db = getAdminClient();
  if (!db) return;

  try {
    // Busca os perfis que coincidem com os últimos 8-9 dígitos do telefone
    const ultimosDigitos = telefoneNormalizado.slice(-8);
    const { data: perfis } = await db
      .from('ap_perfis')
      .select('id, telefone')
      .ilike('telefone', `%${ultimosDigitos}%`);

    if (perfis && perfis.length > 0) {
      const userIds = perfis.map(p => p.id);
      await db
        .from('ap_processos_monitorados')
        .update({ notificar_whatsapp: false })
        .in('user_id', userIds);

      console.log(`[whatsapp-webhook] Opt-out realizado para ${userIds.length} usuários.`);
    }
  } catch (err) {
    console.error('[whatsapp-webhook] Erro no opt-out:', err);
  }
}

/**
 * Busca dados do usuário e seus processos monitorados a partir do telefone.
 */
async function buscarContextoUsuarioPorTelefone(telefoneNormalizado: string) {
  const db = getAdminClient();
  if (!db) return { usuario: null, processos: [] };

  try {
    const ultimosDigitos = telefoneNormalizado.slice(-8);
    const { data: perfil } = await db
      .from('ap_perfis')
      .select('id, nome, role, telefone')
      .ilike('telefone', `%${ultimosDigitos}%`)
      .limit(1)
      .maybeSingle();

    if (!perfil) return { usuario: null, processos: [] };

    // Busca os processos monitorados desse usuário
    const { data: monitorados } = await db
      .from('ap_processos_monitorados')
      .select(`
        processo_id,
        ap_processos (
          numero_cnj,
          tribunal,
          classe,
          assunto_principal,
          parte_autora,
          parte_re
        )
      `)
      .eq('user_id', perfil.id)
      .limit(10);

    const processosFormatados = (monitorados || []).map(m => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (m.ap_processos as any) || {};
      return {
        numeroCnj: p.numero_cnj || '',
        tribunal: p.tribunal || null,
        classe: p.classe || null,
        assunto: p.assunto_principal || null,
        parteContraria: p.parte_re || p.parte_autora || null
      };
    });

    return { usuario: perfil, processos: processosFormatados };
  } catch (err) {
    console.warn('[whatsapp-webhook] Falha ao recuperar contexto do usuário:', err);
    return { usuario: null, processos: [] };
  }
}
