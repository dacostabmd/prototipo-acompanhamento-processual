import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import {
  consultarDataJudTool,
  analisarRiscoPenhoraTool,
  explicarTermoJuridicoTool,
  calcularPrazoProcessualTool,
  buscarTrechosDocumentosProcessoTool
} from './tools';
import { getLangfuseCallbackHandler, flushLangfuse } from '@/lib/langfuse';
import { classifyTag } from '@/lib/classify';
import type { UrgenciaAndamento } from '@/lib/resumoAndamento';
import type { Movement } from '@/lib/mockProcesses';

export interface ProcessoAlertaInput {
  numeroCnj: string;
  tribunal?: string | null;
  classe?: string | null;
  assunto?: string | null;
  parteContraria?: string | null;
  polo?: string | null;
}

export interface InterpretarAndamentoOptions {
  processo: ProcessoAlertaInput;
  movimentosNovos: Pick<Movement, 'data' | 'titulo' | 'descricao'>[];
  historico?: Pick<Movement, 'data' | 'titulo' | 'descricao'>[];
  perfilUsuario?: 'cliente' | 'advogado';
  nomeUsuario?: string;
  userId?: string;
}

export interface ResultadoAndamentoAgent {
  resumo: string;
  significado: string;
  proximoPasso: string;
  urgencia: UrgenciaAndamento;
  textoFormatadoWhatsApp: string;
  botoesSugeridos: string[];
  traceId?: string;
}

/**
 * Agente LangChain especializado em interpretar andamentos judiciais e
 * formatar a notificação para WhatsApp superando o formato estéril do JusBrasil.
 * Monitorado integralmente pelo Langfuse.
 */
export async function interpretarAndamentoComAgente({
  processo,
  movimentosNovos,
  historico = [],
  perfilUsuario = 'cliente',
  nomeUsuario = 'Cliente',
  userId
}: InterpretarAndamentoOptions): Promise<ResultadoAndamentoAgent> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada no ambiente.');
  }

  // 1. Pré-classificação determinística com o classificador de risco do JusConsulta
  const tagsDetectadas = movimentosNovos.map(m => classifyTag(`${m.titulo} ${m.descricao || ''}`));
  const temUrgente = tagsDetectadas.includes('urgente');
  const temPositivo = tagsDetectadas.includes('positivo');

  // 2. Prepara o Langfuse CallbackHandler para rastreabilidade
  const langfuseHandler = getLangfuseCallbackHandler({
    userId,
    sessionId: `andamento_${processo.numeroCnj}`,
    tags: ['whatsapp-andamento', perfilUsuario, processo.tribunal || 'tribunal-geral'],
    metadata: {
      numeroCnj: processo.numeroCnj,
      tribunal: processo.tribunal,
      temUrgente,
      temPositivo,
      quantidadeMovimentosNovos: movimentosNovos.length
    }
  });

  const instrucaoPerfil =
    perfilUsuario === 'advogado'
      ? 'O destinatário é um ADVOGADO. Use tom técnico, direto, destaque prazos processuais (dias úteis), artigos pertinentes do CPC e impactos financeiros/táticos.'
      : 'O destinatário é um CLIENTE LEIGO. NUNCA utilize juridiquês puro. Seja didático, acolhedor e transmita segurança. Se houver termo técnico, explique o que significa em linguagem comum e informe claramente se o cliente precisa se preocupar ou não.';

  const systemPrompt =
    `Você é o Agente Especialista em Acompanhamento Processual da TechTie via WhatsApp.\n` +
    `Sua missão é ler as novas movimentações judiciais e gerar uma mensagem humana, compreensível e útil, superando qualquer notificação genérica de tribunais ou do JusBrasil.\n\n` +
    `DIRETRIZES FUNDAMENTAIS:\n` +
    `- ${instrucaoPerfil}\n` +
    `- Formatação para WhatsApp: Utilize asteriscos para negrito (*termo*), traços para tópicos (- item), sem cabeçalhos markdown (sem ###).\n` +
    `- Não invente informações: ater-se rigorosamente aos fatos das movimentações.\n` +
    `- Conclua SEMPRE informando objetivamente o próximo passo prático.\n` +
    `- Regra da OAB: Nunca prometa garantia de causa ganha, oriente sempre em caso de dúvida a alinhamento com a assessoria jurídica.\n\n` +
    `=== PROCESSO ===\n` +
    `Número: ${processo.numeroCnj}\n` +
    `Tribunal: ${processo.tribunal || 'Não informado'}\n` +
    `Classe: ${processo.classe || 'Não informada'}\n` +
    `Parte Contrária: ${processo.parteContraria || 'Não informada'}\n\n` +
    `=== NOVAS MOVIMENTAÇÕES ===\n` +
    movimentosNovos.map(m => `- [${m.data}] ${m.titulo}: ${m.descricao || ''}`).join('\n') +
    (historico.length > 0
      ? `\n\n=== CONTEXTO ANTERIOR (ÚLTIMAS MOVIMENTAÇÕES) ===\n` +
        historico.slice(0, 4).map(m => `- [${m.data}] ${m.titulo}`).join('\n')
      : '');

  const llm = new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    apiKey
  });

  const tools = [
    consultarDataJudTool,
    analisarRiscoPenhoraTool,
    explicarTermoJuridicoTool,
    calcularPrazoProcessualTool
  ];

  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: systemPrompt
  });

  const promptUsuario =
    `Gere a mensagem de acompanhamento para ${nomeUsuario} no WhatsApp sobre essas novidades do processo.\n` +
    `Responda em formato estruturado contendo:\n` +
    `1. Saudação personalizada com o primeiro nome\n` +
    `2. *O que aconteceu* (resumo claro em 1 ou 2 frases)\n` +
    `3. *O que isso significa* (explicação do impacto real)\n` +
    `4. *O que você precisa fazer agora* (próximo passo simples e direto)\n` +
    `5. Grau de urgência avaliado: baixa, media ou alta.`;

  const callbacks = langfuseHandler ? [langfuseHandler] : [];

  const result = await agent.invoke(
    {
      messages: [new HumanMessage(promptUsuario)]
    },
    {
      callbacks
    }
  );

  await flushLangfuse();

  const outputMessages = result.messages as BaseMessage[];
  const lastMessage = outputMessages[outputMessages.length - 1];
  let textoFinal = '';
  if (typeof lastMessage?.content === 'string') {
    textoFinal = lastMessage.content;
  } else if (Array.isArray(lastMessage?.content)) {
    textoFinal = lastMessage.content
      .map(part => (typeof part === 'string' ? part : (part as { text?: string }).text || ''))
      .join('\n');
  }

  // Avaliação de urgência inferida
  let urgencia: UrgenciaAndamento = 'baixa';
  if (temUrgente || /urg[eê]ncia:\s*alta/i.test(textoFinal)) {
    urgencia = 'alta';
  } else if (/urg[eê]ncia:\s*m[eé]dia/i.test(textoFinal) || temPositivo) {
    urgencia = 'media';
  }

  const botoesSugeridos =
    urgencia === 'alta'
      ? ['Entender em detalhes', 'Falar com advogado']
      : ['Entender em detalhes', 'Ver histórico'];

  return {
    resumo: movimentosNovos.map(m => m.titulo).slice(0, 2).join('; '),
    significado: 'Movimentação analisada e contextualizada pelo Agente JusConsulta.',
    proximoPasso: 'Acompanhar atualizações ou acionar suporte jurídico.',
    urgencia,
    textoFormatadoWhatsApp: textoFinal,
    botoesSugeridos,
    traceId: langfuseHandler?.getTraceId()
  };
}

/**
 * Atendimento conversacional interativo no WhatsApp:
 * Quando o usuário responde à notificação com uma dúvida ("Vou ter que pagar?", "O que isso quer dizer?"),
 * o agente responde com base nos autos conhecidos.
 */
export async function responderDuvidaWhatsAppComAgente({
  pergunta,
  telefone,
  nomeUsuario = 'Cliente',
  perfilUsuario = 'cliente',
  processosDoUsuario = [],
  historicoConversa = [],
  userId
}: {
  pergunta: string;
  telefone: string;
  nomeUsuario?: string;
  perfilUsuario?: 'cliente' | 'advogado';
  processosDoUsuario?: ProcessoAlertaInput[];
  historicoConversa?: { role: 'user' | 'assistant'; content: string }[];
  userId?: string;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return 'Nosso assistente está temporariamente indisponível. Por favor, tente novamente em alguns instantes.';
  }

  const langfuseHandler = getLangfuseCallbackHandler({
    userId,
    sessionId: `whatsapp_chat_${telefone}`,
    tags: ['whatsapp-conversacional', perfilUsuario],
    metadata: {
      telefone,
      pergunta,
      processosCount: processosDoUsuario.length
    }
  });

  const processosContexto =
    processosDoUsuario.length > 0
      ? processosDoUsuario
          .map(
            (p, idx) =>
              `${idx + 1}. Processo nº ${p.numeroCnj} (${p.tribunal || 'Tribunal'} - ${p.classe || 'Classe'}) | Parte contrária: ${p.parteContraria || 'N/A'}`
          )
          .join('\n')
      : 'Nenhum processo salvo explicitamente na conta.';

  const tomInstrucao =
    perfilUsuario === 'advogado'
      ? 'Você está conversando com um ADVOGADO. Seja conciso, técnico e cite regras do CPC/jurisprudência aplicáveis.'
      : 'Você está conversando com um CLIENTE LEIGO no WhatsApp. Seja extremamente claro, empático, calmo e seguro. Não use jargões difíceis.';

  const systemPrompt =
    `Você é o Copiloto Jurídico do JusConsulta atendendo o usuário diretamente no WhatsApp.\n` +
    `${tomInstrucao}\n\n` +
    `REGRAS DE CONVERSA NO WHATSAPP:\n` +
    `- Seja direto e evite textos excessivamente longos (mensagens de WhatsApp devem ter de 1 a 3 parágrafos curtos).\n` +
    `- Formatação permitida: *negrito*, listas com marcadores simples.\n` +
    `- Se o usuário perguntar se ele ganhou a causa, se vai receber dinheiro ou se terá as contas bloqueadas, consulte as ferramentas disponíveis e responda com base nos andamentos reais, sem promessas levianas.\n` +
    `- Deixe claro que seu papel é de apoio e esclarecimento tecnológico, e que a palavra final é sempre do advogado responsável pela causa.\n\n` +
    `=== DADOS DO USUÁRIO ===\n` +
    `Nome: ${nomeUsuario}\n` +
    `Telefone: ${telefone}\n\n` +
    `=== PROCESSOS ASSOCIADOS AO USUÁRIO ===\n` +
    processosContexto;

  const llm = new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.4,
    apiKey
  });

  const tools = [
    consultarDataJudTool,
    analisarRiscoPenhoraTool,
    explicarTermoJuridicoTool,
    calcularPrazoProcessualTool,
    buscarTrechosDocumentosProcessoTool
  ];

  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: systemPrompt
  });

  const messages: BaseMessage[] = [
    ...historicoConversa.map(h =>
      h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content)
    ),
    new HumanMessage(pergunta)
  ];

  const callbacks = langfuseHandler ? [langfuseHandler] : [];

  const result = await agent.invoke(
    { messages },
    { callbacks }
  );

  await flushLangfuse();

  const outputMessages = result.messages as BaseMessage[];
  const lastMessage = outputMessages[outputMessages.length - 1];

  if (typeof lastMessage?.content === 'string') {
    return lastMessage.content;
  }
  return 'Recebemos sua mensagem! Nossa equipe jurídica está acompanhando o caso.';
}
