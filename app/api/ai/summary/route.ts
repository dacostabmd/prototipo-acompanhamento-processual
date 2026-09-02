import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const SYSTEM_PROMPT =
  'Você é um assistente jurídico sênior da Blindagem Financeira, especializado em defesa patrimonial, ' +
  'negociação de dívidas e defesas em execuções judiciais. Seu objetivo é redigir um resumo executivo ' +
  'do andamento processual do cliente de forma acolhedora, objetiva, humana e com excelente escaneabilidade visual.\n\n' +
  'DIRETRIZES DE FORMATAÇÃO E CORES (OBRIGATÓRIO):\n' +
  '1. Use <span style="color: #8a2b2b; font-weight: 700;">texto</span> (VERMELHO ESCURO) para ressaltar dados e alertas de risco:\n' +
  '   - Execuções ativas, execuções fiscais e cobranças judiciais.\n' +
  '   - Penhoras, bloqueios de contas (Sisbajud), leilões, penhora de bens ou riscos iminentes.\n' +
  '   - Valores em cobrança ou débitos pendentes.\n' +
  '2. Use <span style="color: #1b6b3e; font-weight: 700;">texto</span> (VERDE ESCURO) para ressaltar dados e informações favoráveis:\n' +
  '   - Processos arquivados provisoriamente ou definitivamente.\n' +
  '   - Débitos cancelados, ações extintas ou baixadas.\n' +
  '   - Decisões positivas, liminares favoráveis ou ausência de restrições ativas.\n' +
  '3. Use <strong>texto</strong> (NEGRITO) para ressaltar dados essenciais de identificação:\n' +
  '   - Números dos processos judiciais.\n' +
  '   - Nomes das partes contrárias, credores e instituições (ex: Banco do Brasil, Fazenda Pública).\n' +
  '   - Valores de causa e datas dos andamentos mais recentes.\n' +
  '4. Estruture a resposta em 2 a 3 parágrafos fluidos, com quebras de linha entre eles.\n' +
  '5. Mantenha um tom profissional e tranquilizador, sem juridiquês complexo sem explicação.\n' +
  '6. Baseie-se estritamente nos dados fornecidos na lista de processos.';

export async function POST(request: Request) {
  try {
    const { fullName, processes, model } = await request.json();

    const procText = (processes ?? [])
      .map(
        (p: any) =>
          `- ${p.tipo} (${p.numero}), tribunal: ${p.tribunal}, parte contrária: ${p.parteContraria}, ` +
          `valor da causa: ${p.valorCausa}, últimos andamentos: ${(p.movimentos ?? [])
            .map((m: any) => `${m.data}: ${m.titulo}`)
            .join('; ')}`
      )
      .join('\n');

    const promptUser =
      `Nome do cliente: ${fullName}\nProcessos encontrados:\n${procText}\n\n` +
      'Escreva um resumo executivo claro, aplicando rigorosamente as cores vermelho escuro (#8a2b2b), verde escuro (#1b6b3e) e negrito (<strong>) para ressaltar as informações importantes.';

    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: promptUser }
        ],
        max_tokens: 800,
        temperature: 0.6
      });

      const text = completion.choices[0]?.message?.content ?? '';
      return NextResponse.json({ text });
    }

    if (process.env.ANTHROPIC_API_KEY) {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: model || 'claude-haiku-4-5',
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: promptUser
          }
        ]
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
    console.error('[api/ai/summary]', error);
    return NextResponse.json({ error: 'Não foi possível gerar o resumo agora.' }, { status: 500 });
  }
}
