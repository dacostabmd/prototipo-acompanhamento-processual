import type { Movement, MovementTag } from '@/lib/mockProcesses';
import type { ResumoAndamento, UrgenciaAndamento } from '@/lib/resumoAndamento';
import { classifyTag } from '@/lib/classify';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage } from '@langchain/core/messages';
import { getLangfuseCallbackHandler, flushLangfuse } from '@/lib/langfuse';

export type PrioridadeEnvio = 'imediata' | 'digest';

export interface AvaliacaoSmartDigest {
  prioridade: PrioridadeEnvio;
  motivo: string;
  tagsDetectadas: MovementTag[];
  urgencia: UrgenciaAndamento;
}

/**
 * Avalia se o conjunto de movimentações e o resumo de IA justificam uma notificação
 * IMEDIATA no WhatsApp (ex.: penhora, prazo, vitória) ou se devem ser retidas para o
 * SMART DIGEST semanal (atos burocráticos de rotina), superando o spam do JusBrasil.
 */
export function avaliarPrioridadeSmartDigest(
  movimentosNovos: Pick<Movement, 'titulo' | 'descricao'>[],
  resumo: Pick<ResumoAndamento, 'urgencia'> | null
): AvaliacaoSmartDigest {
  const tags = movimentosNovos.map(m => classifyTag(`${m.titulo} ${m.descricao || ''}`));
  const temUrgente = tags.includes('urgente');
  const temPositivo = tags.includes('positivo');
  const urgencia = resumo?.urgencia || (temUrgente ? 'alta' : temPositivo ? 'media' : 'baixa');

  // Urgência alta ou positiva sempre exige envio imediato
  if (urgencia === 'alta' || temUrgente) {
    return {
      prioridade: 'imediata',
      motivo: 'Movimentação com risco patrimonial ou prazo peremptório detectado.',
      tagsDetectadas: tags,
      urgencia
    };
  }

  if (urgencia === 'media' || temPositivo) {
    return {
      prioridade: 'imediata',
      motivo: 'Decisão judicial, liminar ou andamento favorável de relevância.',
      tagsDetectadas: tags,
      urgencia
    };
  }

  // Atos burocráticos de mero expediente (conclusão, remessa, juntada de AR, etc.)
  return {
    prioridade: 'digest',
    motivo: 'Ato de rotina ou mero expediente processual: elegível para Smart Digest.',
    tagsDetectadas: tags,
    urgencia: 'baixa'
  };
}

export interface ItemDigestProcesso {
  numeroCnj: string;
  tribunal?: string | null;
  classe?: string | null;
  resumo?: string | null;
  movimentosCount: number;
}

export interface GerarDigestSemanalOptions {
  nomeUsuario: string;
  perfilUsuario?: 'cliente' | 'advogado';
  itens: ItemDigestProcesso[];
  userId?: string;
}

/**
 * Gera a síntese semanal humanizada com Agente LangChain + Langfuse para envio no WhatsApp.
 */
export async function gerarMensagemDigestSemanal({
  nomeUsuario,
  perfilUsuario = 'cliente',
  itens,
  userId
}: GerarDigestSemanalOptions): Promise<string> {
  if (itens.length === 0) {
    return `Olá, ${nomeUsuario}! Nesta semana, nenhum dos seus processos monitorados teve novas movimentações. Seguimos acompanhando tudo atentamente.`;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const lista = itens.map(i => `• Processo ${i.numeroCnj}: ${i.resumo || 'Andamento de rotina registrado.'}`).join('\n');
    return `Olá, ${nomeUsuario}! Aqui está seu Resumo Semanal da TechTie:\n\n${lista}\n\nNenhuma ação urgente necessária.`;
  }

  const langfuseHandler = getLangfuseCallbackHandler({
    userId,
    sessionId: `digest_semanal_${userId || 'geral'}`,
    tags: ['smart-digest', perfilUsuario],
    metadata: {
      quantidadeProcessos: itens.length
    }
  });

  const promptSystem =
    perfilUsuario === 'advogado'
      ? `Você gera um resumo semanal executivo e conciso para um ADVOGADO via WhatsApp sobre os processos que tiveram movimentação na semana. Seja direto, liste os números e o status.`
      : `Você gera um resumo semanal acolhedor e tranquilizador para um CLIENTE LEIGO via WhatsApp da TechTie. Explique que foram andamentos normais de rotina, que nossa tecnologia continua cuidando de tudo e que não há motivo para preocupação.`;

  const dadosTexto = itens
    .map(
      (it, idx) =>
        `${idx + 1}. Processo nº ${it.numeroCnj} (${it.tribunal || 'Tribunal'} - ${it.classe || 'Classe'}): ${it.resumo || 'Atos ordinatórios de rotina.'}`
    )
    .join('\n');

  const llm = new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    apiKey
  });

  const callbacks = langfuseHandler ? [langfuseHandler] : [];

  const response = await llm.invoke(
    [
      new HumanMessage(
        `${promptSystem}\n\nDestinatário: ${nomeUsuario}\nProcessos com movimentações nesta semana:\n${dadosTexto}\n\nFormate em até 3 parágrafos curtos para WhatsApp com *negrito* nos pontos-chave.`
      )
    ],
    { callbacks }
  );

  await flushLangfuse();

  if (typeof response.content === 'string') {
    return response.content;
  }
  return `Olá, ${nomeUsuario}! Seu resumo semanal de processos foi concluído com sucesso. Todos os andamentos desta semana foram de rotina.`;
}
