import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import {
  consultarDataJudTool,
  analisarRiscoPenhoraTool,
  explicarTermoJuridicoTool,
  calcularPrazoProcessualTool
} from './tools';

export interface ProcessContext {
  numero: string;
  tribunal: string;
  tipo: string;
  valorCausa: string;
  parteContraria: string;
}

export interface CaseContext {
  fullName?: string;
  cpf?: string;
  totalProcessos?: number;
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

export interface ExecuteAgentOptions {
  messages: AgentChatMessage[];
  tone?: 'Formal' | 'Acolhedor' | string;
  caseContext?: CaseContext | null;
  attachments?: AttachmentInfo[];
  modelName?: string;
}

/**
 * Cria e executa o Agente ReAct LangChain especializado no acompanhamento processual
 * e na defesa patrimonial jurídica da TechTie.
 */
export async function executeProcessAgent({
  messages,
  tone = 'Acolhedor',
  caseContext,
  attachments = [],
  modelName = 'gpt-4o-mini'
}: ExecuteAgentOptions): Promise<{ text: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada no ambiente.');
  }

  const toneInstruction =
    tone === 'Formal'
      ? 'Mantenha tom estritamente formal, técnico e objetivo como um especialista sênior em direito empresarial e bancário.'
      : 'Mantenha tom acolhedor, empático e humano, transmitindo segurança e autoridade jurídica.';

  // Contexto dos processos do cliente
  const clientName = caseContext?.fullName || 'Cliente';
  const clientCpf = caseContext?.cpf || 'Não informado';
  const totalFound = caseContext?.totalProcessos || (caseContext?.processes ? caseContext.processes.length : 0);

  let processesContextText = '';
  if (caseContext?.processes && caseContext.processes.length > 0) {
    processesContextText =
      `\n\n=== PROCESSOS E EXECUÇÕES DO CLIENTE (${totalFound} AÇÕES) ===\n` +
      caseContext.processes
        .map(
          (p, idx) =>
            `${idx + 1}. PROCESSO: ${p.numero}\n` +
            `   - Tribunal / Vara: ${p.tribunal}\n` +
            `   - Tipo / Classe: ${p.tipo}\n` +
            `   - Parte Contrária (Credor / Autor): ${p.parteContraria}\n` +
            `   - Valor da Causa: ${p.valorCausa}`
        )
        .join('\n\n');
  } else {
    processesContextText = `\n\nNenhum processo foi localizado na busca aberta para o CPF/CNPJ ${clientCpf}.`;
  }

  let attachmentsText = '';
  if (attachments && attachments.length > 0) {
    attachmentsText =
      `\n\n=== DOCUMENTOS ENVIADOS PELO CLIENTE (VERIFICADOS CONTRA MALWARE) ===\n` +
      attachments
        .map((att, idx) => `${idx + 1}. Arquivo: "${att.name}" (${(att.size / 1024).toFixed(1)} KB, Tipo: ${att.type})`)
        .join('\n');
  }

  const systemPrompt =
    `Você é o Agente Jurídico Estratégico com Inteligência Artificial da TechTie, desenvolvido com LangChain e ferramentas especializadas em andamento processual, defesas em execuções de dívidas e proteção contra penhoras/bloqueios judiciais.\n\n` +
    `DIRETRIZES DE ATENDIMENTO E FORMATAÇÃO (OBRIGATÓRIO):\n` +
    `- ${toneInstruction}\n` +
    `- FORMATAÇÃO VISUAL IMPECÁVEL: NUNCA gere um bloco único de texto denso. Separe SEMPRE suas explicações em parágrafos curtos com quebras de linha duplas entre eles.\n` +
    `- Ao listar itens, processos ou linhas de defesa, utilize títulos de seção com o símbolo de parágrafo "§" (ex: "§ 1. Processo: ...", "§ Riscos Imediatos", "§ Próximos Passos") e marcadores de lista com quebra de linha por item (ex:\n- **Item 1**: Explicação\n- **Item 2**: Explicação). NUNCA use marcadores "###".\n` +
    `- Destaque com negrito (**texto**) os números de processos, valores, credores e conceitos-chave.\n` +
    `- Quando necessário consultar detalhes de um processo do CNJ, analisar termos de risco iminente (Sisbajud, Renajud, mandado de penhora), explicar termos técnicos ou calcular prazos do CPC, UTILIZE SUAS FERRAMENTAS DISPONÍVEIS.\n` +
    `- Ao responder dúvidas, cite os números dos processos reais, valores envolvidos, credores e explique com clareza os riscos imediatos e as linhas de defesa possíveis (impugnação, excesso de execução, prescrição, nulidade de citação, acordo com deságio).\n` +
    `- Nunca prometa resultados infalíveis, pois decisões judiciais dependem de juízes e recursos, mas oriente os melhores caminhos estratégicos.\n` +
    `- Responda sempre em português claro, elegante e humanizado.\n\n` +
    `=== DADOS CADASTRAIS DO CLIENTE ===\n` +
    `Nome: ${clientName}\n` +
    `CPF/CNPJ: ${clientCpf}\n` +
    `Total de Processos Rastreados: ${totalFound}` +
    processesContextText +
    attachmentsText;

  // Inicializa o LLM via LangChain OpenAI
  const llm = new ChatOpenAI({
    model: modelName,
    temperature: 0.5,
    apiKey
  });

  // Ferramentas disponíveis para o agente ReAct
  const tools = [
    consultarDataJudTool,
    analisarRiscoPenhoraTool,
    explicarTermoJuridicoTool,
    calcularPrazoProcessualTool
  ];

  // Cria o Agente ReAct LangGraph
  const agent = createReactAgent({
    llm,
    tools,
    messageModifier: systemPrompt
  });

  // Converte as mensagens do histórico para instâncias de BaseMessage do LangChain
  const langchainMessages: BaseMessage[] = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      if (m.role === 'user') {
        return new HumanMessage(m.content);
      }
      return new AIMessage(m.content);
    });

  // Invoca o agente
  const result = await agent.invoke({
    messages: langchainMessages
  });

  // Extrai a resposta final do agente
  const outputMessages = result.messages as BaseMessage[];
  const lastMessage = outputMessages[outputMessages.length - 1];

  let text = '';
  if (typeof lastMessage?.content === 'string') {
    text = lastMessage.content;
  } else if (Array.isArray(lastMessage?.content)) {
    text = lastMessage.content
      .map(part => (typeof part === 'string' ? part : (part as { text?: string }).text || ''))
      .join('\n');
  }

  return { text: text || 'Não foi possível gerar a resposta no momento.' };
}
