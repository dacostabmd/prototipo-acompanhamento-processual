import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { getLangfuseCallbackHandler, flushLangfuse } from '@/lib/langfuse';
import { cleanDigits } from '@/lib/format';
import type { ProcessoAlertaInput } from '@/lib/agent/andamentoAgent';

export interface AnaliseMidiaResultado {
  sucesso: boolean;
  tipoDocumentoIdentificado: string;
  numeroCnjIdentificado: string | null;
  prazoIdentificado: string | null;
  urgencia: 'baixa' | 'media' | 'alta';
  mensagemFormatadaWhatsApp: string;
}

/**
 * Consulta a Meta Graph API para obter a URL temporária de download da mídia enviada pelo WhatsApp.
 */
export async function obterUrlDownloadMidiaMeta(mediaId: string): Promise<{ url: string; mimeType: string } | null> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const version = process.env.WHATSAPP_GRAPH_VERSION || 'v23.0';
  if (!token) {
    console.error('[whatsappMedia] WHATSAPP_CLOUD_TOKEN não configurado.');
    return null;
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      console.error('[whatsappMedia] Erro ao obter URL de mídia da Meta:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    return {
      url: data.url,
      mimeType: data.mime_type || 'image/jpeg'
    };
  } catch (err) {
    console.error('[whatsappMedia] Falha de rede ao consultar mídia Meta:', err);
    return null;
  }
}

/**
 * Baixa o buffer binário do arquivo a partir da URL fornecida pela Meta (requer Authorization Bearer).
 */
export async function baixarBufferMidiaMeta(downloadUrl: string): Promise<Buffer | null> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  if (!token) return null;

  try {
    const res = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      console.error('[whatsappMedia] Erro ao baixar buffer de mídia:', res.status);
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (err) {
    console.error('[whatsappMedia] Falha ao fazer download do buffer da Meta:', err);
    return null;
  }
}

export interface AnalisarDocumentoOuImagemOptions {
  mediaId: string;
  mimeTypeOriginal?: string;
  caption?: string;
  telefone: string;
  nomeUsuario: string;
  perfilUsuario?: 'cliente' | 'advogado';
  userId?: string;
  processosDoUsuario?: ProcessoAlertaInput[];
}

/**
 * Recebe uma foto de intimação ou documento PDF enviado pelo cliente no WhatsApp,
 * realiza OCR / Visão Computacional com IA multimodal (GPT-4o-mini), extrai prazos,
 * números de CNJ e explica em linguagem leiga e acolhedora com observabilidade Langfuse.
 */
export async function analisarDocumentoOuImagemIntimacao({
  mediaId,
  mimeTypeOriginal,
  caption,
  telefone,
  nomeUsuario,
  perfilUsuario = 'cliente',
  userId,
  processosDoUsuario = []
}: AnalisarDocumentoOuImagemOptions): Promise<AnaliseMidiaResultado> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      sucesso: false,
      tipoDocumentoIdentificado: 'desconhecido',
      numeroCnjIdentificado: null,
      prazoIdentificado: null,
      urgencia: 'media',
      mensagemFormatadaWhatsApp: 'Recebi seu anexo! No momento nosso motor de leitura inteligente está passando por manutenção. Por favor, envie o número do processo em texto para consultarmos.'
    };
  }

  // 1. Obtém a URL e baixa a mídia da Meta
  const info = await obterUrlDownloadMidiaMeta(mediaId);
  const downloadUrl = info?.url;
  const mimeType = info?.mimeType || mimeTypeOriginal || 'image/jpeg';

  if (!downloadUrl) {
    return {
      sucesso: false,
      tipoDocumentoIdentificado: 'erro_download',
      numeroCnjIdentificado: null,
      prazoIdentificado: null,
      urgencia: 'baixa',
      mensagemFormatadaWhatsApp: 'Não foi possível carregar a imagem ou documento enviado. Por favor, envie uma nova foto mais nítida ou digite o número do processo.'
    };
  }

  const buffer = await baixarBufferMidiaMeta(downloadUrl);
  if (!buffer) {
    return {
      sucesso: false,
      tipoDocumentoIdentificado: 'erro_buffer',
      numeroCnjIdentificado: null,
      prazoIdentificado: null,
      urgencia: 'baixa',
      mensagemFormatadaWhatsApp: 'Houve uma instabilidade ao baixar o anexo. Envie novamente por gentileza.'
    };
  }

  // 2. Prepara rastreabilidade no Langfuse
  const langfuseHandler = getLangfuseCallbackHandler({
    userId,
    sessionId: `whatsapp_doc_${telefone}`,
    tags: ['whatsapp-ocr-intimacao', perfilUsuario, mimeType.split('/')[0]],
    metadata: {
      telefone,
      mediaId,
      mimeType,
      tamanhoBytes: buffer.length
    }
  });

  const base64Data = buffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${base64Data}`;

  const listaProcessosConhecidos = processosDoUsuario
    .map(p => `- Processo ${p.numeroCnj} (${p.tribunal || 'Tribunal'})`)
    .join('\n');

  const promptInstrucao =
    `Você é o Perito em Leitura de Intimações e Documentos Judiciais da TechTie via WhatsApp.\n` +
    `O usuário enviou uma foto ou documento judicial recebido.\n\n` +
    `SUA MISSÃO:\n` +
    `1. Ler cuidadosamente o documento na imagem.\n` +
    `2. Identificar se é uma Intimação, Citação, Mandado de Penhora, Notificação de Audiência, Despacho ou Sentença.\n` +
    `3. Localizar o número do processo (CNJ com 20 dígitos).\n` +
    `4. Identificar com clareza se há PRAZO para resposta ou cumprimento (ex: 5 dias, 15 dias úteis, comparecimento em data específica).\n` +
    `5. Escrever uma resposta para WhatsApp em até 3 parágrafos curtos, explicando:\n` +
    `   - Do que se trata o documento em linguagem simples e acolhedora.\n` +
    `   - Se há risco financeiro/bloqueio iminente ou se é um ato de rotina.\n` +
    `   - Qual o próximo passo recomendado para o cliente.\n\n` +
    `Formatação WhatsApp: *negrito* nos pontos críticos, tópicos com hífen (-), sem títulos markdown (sem ###).\n` +
    (caption ? `Legenda enviada pelo usuário: "${caption}"\n` : '') +
    (listaProcessosConhecidos ? `Processos já associados a esta conta:\n${listaProcessosConhecidos}\n` : '');

  try {
    const llm = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      apiKey
    });

    const response = await llm.invoke(
      [
        new HumanMessage({
          content: [
            { type: 'text', text: promptInstrucao },
            {
              type: 'image_url',
              image_url: { url: dataUri, detail: 'high' }
            }
          ]
        })
      ],
      { callbacks: langfuseHandler ? [langfuseHandler] : [] }
    );

    await flushLangfuse();

    const textoResposta = typeof response.content === 'string' ? response.content : 'Documento analisado com sucesso.';

    // Extrai CNJ e urgência por heurística
    const cnjMatch = textoResposta.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/) || textoResposta.match(/\d{20}/);
    const numeroCnj = cnjMatch ? cleanDigits(cnjMatch[0]) : null;

    let urgencia: 'baixa' | 'media' | 'alta' = 'baixa';
    if (/penhora|bloqueio|sisbajud|imediato|multa|pris[aã]o/i.test(textoResposta)) {
      urgencia = 'alta';
    } else if (/prazo|intima[cç][aã]o|cita[cç][aã]o|audi[eê]ncia/i.test(textoResposta)) {
      urgencia = 'media';
    }

    return {
      sucesso: true,
      tipoDocumentoIdentificado: 'intimacao_judicial',
      numeroCnjIdentificado: numeroCnj,
      prazoIdentificado: textoResposta.includes('dias') ? 'Prazo identificado no texto' : null,
      urgencia,
      mensagemFormatadaWhatsApp: textoResposta
    };
  } catch (err) {
    console.error('[whatsappMedia] Erro na análise visual com GPT-4o-mini:', err);
    return {
      sucesso: false,
      tipoDocumentoIdentificado: 'erro_visao',
      numeroCnjIdentificado: null,
      prazoIdentificado: null,
      urgencia: 'baixa',
      mensagemFormatadaWhatsApp: 'Recebi seu documento, mas não consegui ler todos os detalhes com nitidez. Por favor, envie uma foto mais aproximada ou o número do processo.'
    };
  }
}
