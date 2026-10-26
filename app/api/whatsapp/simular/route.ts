import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { responderDuvidaWhatsAppComAgente } from '@/lib/agent/andamentoAgent';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { getLangfuseCallbackHandler, flushLangfuse } from '@/lib/langfuse';
import { indexarDocumentoProcessual } from '@/lib/ragDocumentos';

/**
 * Endpoint de Simulação do Agente WhatsApp e Leitura Multimodal de Intimações.
 * Permite que desenvolvedores e administradores testem o fluxo conversacional completo,
 * o RAG com pgvector e a observabilidade no Langfuse sem depender de um número Meta ativo.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) {
    return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const tipo = body?.tipo || 'texto'; // 'texto' | 'midia'
  const mensagem = typeof body?.mensagem === 'string' ? body.mensagem.trim() : '';

  // 1. Carrega dados do perfil e processos monitorados do usuário para contexto real
  const [perfilRes, monitoradosRes] = await Promise.all([
    db.from('ap_perfis').select('nome, role, telefone, plano').eq('id', userId).maybeSingle(),
    db
      .from('ap_processos_monitorados')
      .select('processo_id, ap_processos(numero_cnj, tribunal, classe_processual)')
      .eq('user_id', userId)
      .limit(10)
  ]);

  const perfil = perfilRes.data;
  const nomeUsuario = perfil?.nome || 'Usuário Teste';
  const telefone = perfil?.telefone || '5511999999999';
  const role = (perfil?.role === 'advogado' ? 'advogado' : 'cliente') as 'cliente' | 'advogado';

  const processosDoUsuario = (monitoradosRes.data || [])
    .filter(m => m.ap_processos)
    .map(m => {
      const proc = m.ap_processos as unknown as { numero_cnj: string; tribunal: string | null; classe_processual: string | null };
      return {
        numeroCnj: proc.numero_cnj,
        tribunal: proc.tribunal,
        classe: proc.classe_processual
      };
    });

  // 2. Fluxo de Simulação de Texto (Dúvida Conversacional com Agente ReAct + Langfuse)
  if (tipo === 'texto') {
    if (!mensagem) {
      return NextResponse.json({ error: 'Informe o texto da mensagem a ser simulada.' }, { status: 400 });
    }

    try {
      const respostaAgente = await responderDuvidaWhatsAppComAgente({
        pergunta: mensagem,
        telefone,
        nomeUsuario,
        perfilUsuario: role,
        processosDoUsuario,
        userId
      });

      return NextResponse.json({
        sucesso: true,
        tipo: 'texto',
        mensagemEnviada: mensagem,
        respostaWhatsApp: respostaAgente,
        contexto: {
          nomeUsuario,
          perfil: role,
          totalProcessosContextualizados: processosDoUsuario.length
        }
      });
    } catch (err: unknown) {
      console.error('[whatsapp/simular] Erro ao executar agente:', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Falha na execução do agente.' },
        { status: 500 }
      );
    }
  }

  // 3. Fluxo de Simulação de Mídia / Imagem (Vision OCR + RAG com pgvector)
  if (tipo === 'midia') {
    const imagemBase64 = typeof body?.imagemBase64 === 'string' ? body.imagemBase64 : null;
    const mimeType = body?.mimeType || 'image/jpeg';
    const caption = typeof body?.caption === 'string' ? body.caption : 'Foto de intimação recebida';

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY não configurada.' }, { status: 500 });
    }

    try {
      const langfuseHandler = getLangfuseCallbackHandler({
        userId,
        sessionId: `simulacao_midia_${userId}`,
        tags: ['simulacao-whatsapp', 'visao-ocr'],
        metadata: { mimeType, caption }
      });

      const visionLlm = new ChatOpenAI({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        apiKey
      });

      const promptInstrucao =
        `Você é o Copiloto Jurídico do JusConsulta analisando um documento judicial ou foto de intimação/mandado enviado por um cliente.\n\n` +
        `INSTRUÇÕES:\n` +
        `1. Transcreva e analise o documento.\n` +
        `2. Identifique o número CNJ do processo (formato NNNNNNN-DD.AAAA.J.TR.OOOO), se visível.\n` +
        `3. Identifique o tipo de ato (despacho, citação, intimação de penhora, sentença).\n` +
        `4. Identifique o prazo concedido pelo juiz (ex: "15 dias úteis para contestar", "5 dias para pagar").\n` +
        `5. Formate uma resposta didática e acolhedora para envio pelo WhatsApp, com tom humano e objetivo.\n\n` +
        `Responda em formato JSON com as seguintes chaves:\n` +
        `{\n` +
        `  "tipoDocumento": "string",\n` +
        `  "numeroCnj": "string ou null",\n` +
        `  "prazo": "string ou null",\n` +
        `  "urgencia": "baixa" | "media" | "alta",\n` +
        `  "explicacaoDidatica": "string (texto pronto para WhatsApp)"\n` +
        `}`;

      // Conteúdo para o modelo multimodal
      const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: promptInstrucao }
      ];

      if (imagemBase64) {
        const urlFormatada = imagemBase64.startsWith('data:')
          ? imagemBase64
          : `data:${mimeType};base64,${imagemBase64}`;
        contentParts.push({
          type: 'image_url',
          image_url: { url: urlFormatada }
        });
      } else {
        // Fallback de texto caso a imagem não venha codificada
        contentParts.push({
          type: 'text',
          text: `[Documento anexado sem binário: "${caption}". Simule a análise de uma intimação com prazo de 15 dias para manifestação sobre laudo pericial.]`
        });
      }

      const response = await visionLlm.invoke([new HumanMessage({ content: contentParts as any })], {
        callbacks: langfuseHandler ? [langfuseHandler] : []
      });

      await flushLangfuse();

      let parsed: {
        tipoDocumento?: string;
        numeroCnj?: string | null;
        prazo?: string | null;
        urgencia?: 'baixa' | 'media' | 'alta';
        explicacaoDidatica?: string;
      } = {};

      try {
        const cleaned = (response.content as string).replace(/```json\n?|\n?```/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = {
          tipoDocumento: 'Intimação Judicial',
          numeroCnj: null,
          prazo: 'Consulte seu advogado',
          urgencia: 'media',
          explicacaoDidatica: response.content as string
        };
      }

      // Se um CNJ foi identificado e há texto relevante, indexa no RAG vetorial
      let indexadoVetorial = false;
      if (parsed.numeroCnj) {
        const procSalvo = await db
          .from('ap_processos')
          .select('id')
          .eq('numero_cnj', parsed.numeroCnj)
          .maybeSingle();

        if (procSalvo.data?.id) {
          const indexRes = await indexarDocumentoProcessual({
            processoId: procSalvo.data.id,
            numeroCnj: parsed.numeroCnj,
            tipoDocumento: 'intimacao',
            titulo: parsed.tipoDocumento || 'Intimação recebida via WhatsApp',
            textoCompleto: parsed.explicacaoDidatica || ''
          });
          indexadoVetorial = indexRes.chunksIndexados > 0;
        }
      }

      return NextResponse.json({
        sucesso: true,
        tipo: 'midia',
        resultadoOcr: parsed,
        indexadoNoRAG: indexadoVetorial,
        mensagemFormatadaWhatsApp:
          parsed.explicacaoDidatica ||
          `📄 *Documento Analisado*: ${parsed.tipoDocumento}\n⏳ *Prazo*: ${parsed.prazo || 'Não especificado'}\n\nNossa equipe jurídica está à disposição.`
      });
    } catch (err: unknown) {
      console.error('[whatsapp/simular] Erro ao processar visão computacional:', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Falha na análise da imagem.' },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: 'Tipo de simulação não suportado. Use "texto" ou "midia".' }, { status: 400 });
}
