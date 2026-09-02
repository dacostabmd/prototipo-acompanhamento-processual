import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { messages, tone, totalProcessos, model } = await request.json();

    const toneInstruction =
      tone === 'Formal'
        ? 'Mantenha tom formal e objetivo.'
        : 'Mantenha tom acolhedor, empático e humano, sem perder profissionalismo.';

    const contextNote =
      typeof totalProcessos === 'number' && totalProcessos > 0
        ? `O cliente já consultou o CPF no sistema e foram localizados ${totalProcessos} processo(s) vinculados a ele via base Infosimples.`
        : 'O cliente ainda não localizou processos vinculados ao seu CPF na consulta automática, ou ainda não realizou a consulta.';

    const systemPrompt =
      'Você é um assistente jurídico de triagem da Blindagem Financeira, escritório especializado em ' +
      `blindagem patrimonial, negociação de dívidas e defesa em execuções. ${toneInstruction} ` +
      'Converse em português. Faça poucas perguntas por vez para coletar: (1) uma breve descrição do ' +
      'problema, (2) número do processo, se souber, (3) quais documentos a pessoa tem disponíveis. ' +
      `${contextNote} Quando já tiver o essencial, avise que vai montar um dossiê para um advogado ` +
      'responsável entrar em contato, sem prometer prazos. Responda em texto corrido, sem markdown.';

    const formattedMessages = (messages ?? []).map((m: { role: string; content: string }) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content
    }));

    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...formattedMessages
        ],
        max_tokens: 500,
        temperature: 0.7
      });

      const text = completion.choices[0]?.message?.content ?? '';
      return NextResponse.json({ text });
    }

    if (process.env.ANTHROPIC_API_KEY) {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: model || 'claude-haiku-4-5',
        max_tokens: 500,
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
