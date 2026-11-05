import { requireUser } from '@/lib/requireUser';
import { getUserId } from '@/lib/track';
import { executeProcessAgent, montarPromptSistema } from '@/lib/agent/processAgent';
import { carregarContextoConta } from '@/lib/agent/contextoConta';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export const maxDuration = 120;

/**
 * POST /api/ai/chat — chat de IA do resultado da busca.
 * Recebe o histórico, o modo de resposta (Direta, Detalhista, Resumido, Instrutivo) e os processos da tela
 * (com movimentações). O perfil e os processos da conta são carregados aqui no servidor, a cada pergunta.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  try {
    const { messages, tone, modo, caseContext, attachments, model } = await request.json();
    const userId = await getUserId(request);
    const contextoConta = await carregarContextoConta(userId);

    // 1. Agente ReAct LangChain (OpenAI) com ferramentas processuais
    if (process.env.OPENAI_API_KEY) {
      try {
        const result = await executeProcessAgent({
          messages: messages ?? [],
          tone,
          modo,
          caseContext,
          contextoConta,
          attachments,
          userId,
          modelName: typeof model === 'string' && model.startsWith('gpt') ? model : 'gpt-4o-mini'
        });
        return NextResponse.json({ text: result.text });
      } catch (agentError) {
        console.error('[api/ai/chat] Falha no agente LangChain OpenAI:', agentError);
        if (!process.env.ANTHROPIC_API_KEY) throw agentError;
      }
    }

    // 2. Contingência: Anthropic com o mesmo prompt (sem ferramentas)
    if (process.env.ANTHROPIC_API_KEY) {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: typeof model === 'string' && model.startsWith('claude') ? model : 'claude-haiku-4-5',
        max_tokens: modo === 'Detalhista' || modo === 'Instrutivo' ? 1800 : 800,
        system: montarPromptSistema({ tone, modo, caseContext, contextoConta, attachments }),
        messages: ((messages ?? []) as { role: string; content: string }[]).slice(-12).map(m => ({
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content
        }))
      });
      const text = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { text: string }).text)
        .join('\n');
      return NextResponse.json({ text });
    }

    return NextResponse.json({ error: 'Nenhuma chave de IA (OPENAI_API_KEY ou ANTHROPIC_API_KEY) configurada.' }, { status: 500 });
  } catch (error) {
    console.error('[api/ai/chat]', error);
    return NextResponse.json({ error: 'Não consegui responder agora.' }, { status: 500 });
  }
}
