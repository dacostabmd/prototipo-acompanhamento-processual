import { requireUser } from '@/lib/requireUser';
import { executeProcessAgent } from '@/lib/agent/processAgent';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  try {
    const { messages, tone, caseContext, attachments, model } = await request.json();

    // 1. Agente ReAct LangChain com OpenAI e Ferramentas Processuais
    if (process.env.OPENAI_API_KEY) {
      try {
        const result = await executeProcessAgent({
          messages: messages ?? [],
          tone,
          caseContext,
          attachments,
          modelName: typeof model === 'string' && model.startsWith('gpt') ? model : 'gpt-4o-mini'
        });

        return NextResponse.json({ text: result.text });
      } catch (agentError) {
        console.error('[api/ai/chat] Falha no agente LangChain OpenAI:', agentError);
        // Se houver chave Anthropic configurada, tenta fallback
        if (!process.env.ANTHROPIC_API_KEY) {
          throw agentError;
        }
      }
    }

    // 2. Fallback de contingência para Anthropic Claude se OpenAI não estiver configurada
    if (process.env.ANTHROPIC_API_KEY) {
      const toneInstruction =
        tone === 'Formal'
          ? 'Mantenha tom estritamente formal, técnico e objetivo como um especialista sênior em direito empresarial e bancário.'
          : 'Mantenha tom acolhedor, empático e humano, transmitindo segurança e autoridade jurídica.';

      const clientName = caseContext?.fullName || 'Cliente';
      const clientCpf = caseContext?.cpf || 'Não informado';
      const totalFound = caseContext?.totalProcessos || (caseContext?.processes ? caseContext.processes.length : 0);

      let processesContextText = '';
      if (caseContext?.processes && caseContext.processes.length > 0) {
        processesContextText =
          `\n\n=== PROCESSOS E EXECUÇÕES ENCONTRADOS NO TRIBUNAL (${totalFound} AÇÕES) ===\n` +
          caseContext.processes
            .map(
              (p: any, idx: number) =>
                `${idx + 1}. PROCESSO: ${p.numero}\n` +
                `   - Tribunal / Vara: ${p.tribunal}\n` +
                `   - Tipo / Classe: ${p.tipo}\n` +
                `   - Parte Contrária (Credor / Autor): ${p.parteContraria}\n` +
                `   - Valor da Causa: ${p.valorCausa}`
            )
            .join('\n\n');
      } else {
        processesContextText = `\n\nNenhum processo foi localizado na base aberta para o CPF ${clientCpf}.`;
      }

      const systemPrompt =
        `Você é o Assistente Jurídico Estratégico com Inteligência Artificial da Blindagem Financeira, escritório de alta performance especializado em blindagem patrimonial, defesa em execuções de dívidas e proteção contra penhoras/bloqueios judiciais.\n\n` +
        `DIRETRIZES DE ATENDIMENTO E FORMATAÇÃO (OBRIGATÓRIO):\n` +
        `- ${toneInstruction}\n` +
        `- FORMATAÇÃO VISUAL IMPECÁVEL: NUNCA gere um bloco único de texto denso. Separe SEMPRE suas explicações em parágrafos curtos com quebras de linha duplas entre eles.\n` +
        `- Ao listar itens, processos ou linhas de defesa, utilize títulos de seção com o símbolo de parágrafo "§" e marcadores de lista com quebra de linha por item. NUNCA use marcadores "###".\n` +
        `- Destaque com negrito (**texto**) os números de processos, valores, credores e conceitos-chave.\n` +
        `- Ao responder dúvidas, cite os números dos processos reais, valores envolvidos, credores e explique com clareza os riscos imediatos e as linhas de defesa possíveis.\n` +
        `- Responda sempre em português claro, elegante e humanizado.\n\n` +
        `=== DADOS CADASTRAIS DO CLIENTE ===\n` +
        `Nome: ${clientName}\n` +
        `CPF: ${clientCpf}\n` +
        `Total de Processos Rastreados: ${totalFound}` +
        processesContextText;

      const formattedMessages = (messages ?? []).map((m: { role: string; content: string }) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content
      }));

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: model || 'claude-haiku-4-5',
        max_tokens: 800,
        system: systemPrompt,
        messages: formattedMessages
      });

      const text = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { text: string }).text)
        .join('\n');

      return NextResponse.json({ text });
    }

    return NextResponse.json(
      { error: 'Nenhuma chave de IA (OPENAI_API_KEY ou ANTHROPIC_API_KEY) configurada.' },
      { status: 500 }
    );
  } catch (error) {
    console.error('[api/ai/chat]', error);
    return NextResponse.json({ error: 'Não consegui responder agora.' }, { status: 500 });
  }
}
