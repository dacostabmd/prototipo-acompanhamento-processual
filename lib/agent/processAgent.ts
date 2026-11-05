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

export interface MovimentoContext {
  data: string;
  titulo: string;
  descricao?: string;
}

export interface ProcessContext {
  numero: string;
  tribunal: string;
  tipo: string;
  valorCausa: string;
  parteContraria: string;
  assunto?: string;
  varaForo?: string;
  autor?: string;
  reu?: string;
  distribuicao?: string;
  /** Situação calculada na tela: Em andamento, Pausado ou Encerrado. */
  situacao?: string;
  /** Fase calculada na tela (Pedido feito, Análise do juiz, Decisão, Pagamento, Encerrado). */
  fase?: string;
  movimentos?: MovimentoContext[];
}

export interface CaseContext {
  fullName?: string;
  cpf?: string;
  totalProcessos?: number;
  /** Número do processo aberto na tela quando a pergunta foi feita. */
  processoEmFoco?: string;
  processes?: ProcessContext[];
}

export interface AttachmentInfo {
  name: string;
  size: number;
  type: string;
}

export interface AgentChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const MODOS_RESPOSTA = ['Direta', 'Detalhista', 'Resumido', 'Instrutivo'] as const;
export type ModoResposta = (typeof MODOS_RESPOSTA)[number];

export interface ExecuteAgentOptions {
  messages: AgentChatMessage[];
  tone?: 'Formal' | 'Acolhedor' | string;
  modo?: ModoResposta | string;
  caseContext?: CaseContext | null;
  /** Perfil e processos da conta, montados no servidor (lib/agent/contextoConta.ts). */
  contextoConta?: string;
  attachments?: AttachmentInfo[];
  modelName?: string;
  userId?: string | null;
}

const INSTRUCAO_MODO: Record<ModoResposta, string> = {
  Direta:
    'MODO DIRETA: responda exatamente o que foi perguntado em 2 a 4 frases, começando pela resposta (sim/não, data, valor, situação). ' +
    'Sem introdução nem rodeios. Termine com uma única linha "Próximo passo:" quando houver algo a fazer.',
  Detalhista:
    'MODO DETALHISTA: faça a análise completa. Estruture em seções: "§ Situação atual", "§ Linha do tempo" (todas as movimentações relevantes, com data e o que cada uma significa), ' +
    '"§ Riscos e oportunidades", "§ Cenários prováveis" e "§ Próximos passos". Cite base legal (artigos do CPC/CF/CC) quando ajudar e explique o porquê de cada conclusão.',
  Resumido:
    'MODO RESUMIDO: no máximo 3 tópicos curtos (até ~70 palavras no total), só o essencial. Nada de seções nem explicações longas.',
  Instrutivo:
    'MODO INSTRUTIVO: ensine como um professor paciente para alguém leigo. Estruture em "§ O que aconteceu", "§ O que isso significa" (traduza cada termo técnico com uma analogia do dia a dia), ' +
    '"§ Por que importa para você" e "§ O que fazer agora" (passo a passo numerado). Feche com uma dica prática ou um erro comum a evitar.'
};

const modoValido = (m?: string): ModoResposta => (MODOS_RESPOSTA as readonly string[]).includes(m ?? '') ? (m as ModoResposta) : 'Direta';
const corta = (t: string | undefined, n: number) => (!t ? '' : t.length > n ? `${t.slice(0, n)}...` : t);

/** Bloco com os processos do resultado na tela: o processo em foco vai com todas as movimentações. */
function blocoResultado(ctx: CaseContext | null | undefined): string {
  const processos = ctx?.processes ?? [];
  if (processos.length === 0) return `\n\nNenhum processo foi localizado nesta busca para ${ctx?.cpf || 'o termo pesquisado'}.`;
  const foco = (ctx?.processoEmFoco ?? '').replace(/\D/g, '');
  const ordenados = [...processos].sort((a, b) => Number(b.numero.replace(/\D/g, '') === foco) - Number(a.numero.replace(/\D/g, '') === foco));

  return (
    `\n\n=== RESULTADO DA BUSCA NA TELA (${ctx?.totalProcessos || processos.length} processo(s)) ===\n` +
    ordenados
      .map((p, idx) => {
        const emFoco = p.numero.replace(/\D/g, '') === foco;
        const limite = emFoco ? 80 : 15;
        const movs = (p.movimentos ?? []).slice(0, limite);
        const movsTxt = movs.length
          ? movs
              .map(m => `     - [${m.data || 's/ data'}] ${corta(m.titulo, 200)}${m.descricao && m.descricao !== m.titulo ? `: ${corta(m.descricao, emFoco ? 600 : 200)}` : ''}`)
              .join('\n')
          : '     - (sem movimentações)';
        return (
          `${idx + 1}. PROCESSO ${p.numero}${emFoco ? '  <<< PROCESSO ABERTO NA TELA (assuma que a pergunta é sobre ele, salvo menção a outro)' : ''}\n` +
          [
            `Tribunal: ${p.tribunal || '—'}`,
            p.varaForo && `Vara/foro: ${p.varaForo}`,
            `Classe: ${p.tipo || '—'}`,
            p.assunto && `Assunto: ${p.assunto}`,
            p.autor && `Autor/exequente: ${p.autor}`,
            (p.reu || p.parteContraria) && `Réu/executado: ${p.reu || p.parteContraria}`,
            `Valor da causa: ${p.valorCausa || '—'}`,
            p.distribuicao && `Distribuído em: ${p.distribuicao}`,
            p.situacao && `Situação: ${p.situacao}`,
            p.fase && `Fase: ${p.fase}`
          ]
            .filter(Boolean)
            .map(l => `   ${l}`)
            .join('\n') +
          `\n   Movimentações (mais recente primeiro${movs.length < (p.movimentos?.length ?? 0) ? `, ${movs.length} de ${p.movimentos?.length}` : ''}):\n${movsTxt}`
        );
      })
      .join('\n\n')
  );
}

/** Prompt de sistema do assistente jurídico, compartilhado pelo agente LangChain e pelo fallback Anthropic. */
export function montarPromptSistema({
  tone = 'Acolhedor',
  modo,
  caseContext,
  contextoConta,
  attachments = []
}: Pick<ExecuteAgentOptions, 'tone' | 'modo' | 'caseContext' | 'contextoConta' | 'attachments'>): string {
  const toneInstruction =
    tone === 'Formal'
      ? 'Tom formal, técnico e objetivo, como um especialista sênior.'
      : 'Tom acolhedor, empático e humano, transmitindo segurança e autoridade jurídica.';

  const anexos = attachments.length
    ? `\n\n=== DOCUMENTOS ENVIADOS PELO USUÁRIO ===\n` +
      attachments.map((a, i) => `${i + 1}. "${a.name}" (${(a.size / 1024).toFixed(1)} KB, ${a.type})`).join('\n')
    : '';

  return (
    `Você é o Assistente Jurídico de IA do JusConsulta (TechTie): especialista em andamento processual brasileiro (CPC/2015, ` +
    `execuções, cumprimento de sentença, Fazenda Pública, precatórios/RPV, penhoras e prazos). Seu trabalho é AVALIAR o andamento ` +
    `dos processos do usuário a partir das movimentações reais e explicar de forma didática e instrutiva.\n\n` +
    `COMO ANALISAR (siga sempre, mesmo que não escreva cada etapa):\n` +
    `1. Identifique de qual processo a pergunta trata (o processo aberto na tela, salvo menção a outro número ou parte).\n` +
    `2. Leia as movimentações em ordem cronológica e reconstrua a história: o que foi pedido, o que o juiz decidiu, o que está pendente.\n` +
    `3. Determine a fase real (conhecimento, sentença, recurso, cumprimento/execução, pagamento, arquivamento) e se está parado, andando ou encerrado.\n` +
    `4. Aponte riscos (penhora, bloqueio, prazos correndo, extinção) e oportunidades (pagamento próximo, decisão favorável, acordo).\n` +
    `5. Diga o que tende a acontecer em seguida e o que o usuário pode fazer.\n\n` +
    `REGRAS:\n` +
    `- Use SOMENTE os dados abaixo e o retorno das ferramentas. Nunca invente datas, valores, decisões ou partes. Se faltar dado, diga o que falta e como obter.\n` +
    `- Cite datas no formato DD/MM/AAAA e os números de processo exatamente como estão.\n` +
    `- Traduza todo termo técnico na primeira vez que aparecer. Use as ferramentas para explicar termos, calcular prazos, avaliar risco de penhora, buscar trechos dos autos ou consultar o DataJud quando os dados da tela não bastarem.\n` +
    `- Responda sobre qualquer processo da conta do usuário, não só o da tela, e compare processos quando perguntado.\n` +
    `- Não prometa resultado; quando houver prazo ou risco patrimonial, recomende falar com o advogado.\n` +
    `- ${toneInstruction}\n` +
    `- ${INSTRUCAO_MODO[modoValido(modo)]}\n\n` +
    `FORMATAÇÃO: parágrafos curtos separados por linha em branco; títulos de seção com "§" (nunca "###"); listas com "- " um item por linha; ` +
    `**negrito** em números de processo, valores, datas e conceitos-chave. Português do Brasil claro e elegante.\n\n` +
    `=== PESSOA PESQUISADA NA TELA ===\nNome: ${caseContext?.fullName || 'não informado'}\nCPF/CNPJ: ${caseContext?.cpf || 'não informado'}` +
    blocoResultado(caseContext) +
    (contextoConta ? `\n\n${contextoConta}` : '') +
    anexos
  );
}

/**
 * Agente ReAct (LangGraph) do chat de resultado: avalia o andamento com as movimentações da tela e os processos
 * da conta, usa ferramentas processuais e responde no modo escolhido (Direta, Detalhista, Resumido, Instrutivo).
 */
export async function executeProcessAgent({
  messages,
  tone = 'Acolhedor',
  modo,
  caseContext,
  contextoConta,
  attachments = [],
  modelName = 'gpt-4o-mini',
  userId
}: ExecuteAgentOptions): Promise<{ text: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada no ambiente.');

  const modoFinal = modoValido(modo);
  const systemPrompt = montarPromptSistema({ tone, modo: modoFinal, caseContext, contextoConta, attachments });

  const llm = new ChatOpenAI({
    model: modelName,
    // Baixa: o foco é fidelidade aos andamentos; o modo Instrutivo ganha um pouco mais de liberdade para analogias.
    temperature: modoFinal === 'Instrutivo' ? 0.45 : 0.2,
    maxTokens: modoFinal === 'Detalhista' || modoFinal === 'Instrutivo' ? 1800 : modoFinal === 'Resumido' ? 350 : 700,
    apiKey
  });

  const agent = createReactAgent({
    llm,
    tools: [
      consultarDataJudTool,
      analisarRiscoPenhoraTool,
      explicarTermoJuridicoTool,
      calcularPrazoProcessualTool,
      buscarTrechosDocumentosProcessoTool
    ],
    messageModifier: systemPrompt
  });

  // Histórico curto o bastante para caber com o contexto dos processos.
  const langchainMessages: BaseMessage[] = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-12)
    .map(m => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)));

  const langfuseHandler = getLangfuseCallbackHandler({
    userId: userId ?? undefined,
    tags: ['jusconsulta-v2', 'chat-resultado', `modo-${modoFinal.toLowerCase()}`],
    metadata: { modo: modoFinal, processoEmFoco: caseContext?.processoEmFoco, totalProcessos: caseContext?.processes?.length ?? 0 }
  });

  try {
    const result = await agent.invoke(
      { messages: langchainMessages },
      { callbacks: langfuseHandler ? [langfuseHandler] : [], recursionLimit: 12 }
    );

    const outputMessages = result.messages as BaseMessage[];
    const lastMessage = outputMessages[outputMessages.length - 1];
    let text = '';
    if (typeof lastMessage?.content === 'string') text = lastMessage.content;
    else if (Array.isArray(lastMessage?.content))
      text = lastMessage.content.map(part => (typeof part === 'string' ? part : (part as { text?: string }).text || '')).join('\n');

    return { text: text || 'Não foi possível gerar a resposta no momento.' };
  } finally {
    await flushLangfuse();
  }
}
