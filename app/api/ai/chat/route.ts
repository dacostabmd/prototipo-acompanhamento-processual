import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

interface ProcessContext {
  numero: string;
  tribunal: string;
  tipo: string;
  valorCausa: string;
  parteContraria: string;
}

interface CaseContext {
  fullName?: string;
  cpf?: string;
  totalProcessos?: number;
  processes?: ProcessContext[];
}

interface AttachmentInfo {
  name: string;
  size: number;
  type: string;
}

export async function POST(request: Request) {
  try {
    const { messages, tone, caseContext, attachments, model } = await request.json();

    const toneInstruction =
      tone === 'Formal'
        ? 'Mantenha tom estritamente formal, técnico e objetivo como um especialista sênior em direito empresarial e bancário.'
        : 'Mantenha tom acolhedor, empático e humano, transmitindo segurança e autoridade jurídica.';

    // Montagem do Contexto Judicial Real
    const clientName = caseContext?.fullName || 'Cliente';
    const clientCpf = caseContext?.cpf || 'Não informado';
    const totalFound = caseContext?.totalProcessos || (caseContext?.processes ? caseContext.processes.length : 0);

    let processesContextText = '';
    if (caseContext?.processes && caseContext.processes.length > 0) {
      processesContextText =
        `\n\n=== PROCESSOS E EXECUÇÕES ENCONTRADOS NO TRIBUNAL (${totalFound} AÇÕES) ===\n` +
        caseContext.processes
          .map(
            (p: ProcessContext, idx: number) =>
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

    // Documentos anexados e verificados
    let attachmentsText = '';
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      attachmentsText =
        `\n\n=== DOCUMENTOS ENVIADOS PELO CLIENTE (VERIFICADOS CONTRA MALWARE) ===\n` +
        attachments
          .map(
            (att: AttachmentInfo, idx: number) =>
              `${idx + 1}. Arquivo: "${att.name}" (${(att.size / 1024).toFixed(1)} KB, Tipo: ${att.type})`
          )
          .join('\n');
    }

    const systemPrompt =
      `Você é o Assistente Jurídico Estratégico com Inteligência Artificial da Blindagem Financeira, escritório de alta performance especializado em blindagem patrimonial, defesa em execuções de dívidas e proteção contra penhoras/bloqueios judiciais.\n\n` +
      `DIRETRIZES DE ATENDIMENTO:\n` +
      `- ${toneInstruction}\n` +
      `- Você TEM ACESSO TOTAL ao dossiê judicial do cliente informado abaixo.\n` +
      `- Ao responder dúvidas, cite os números dos processos reais, valores envolvidos, credores e explique com clareza os riscos imediatos (ex: penhora de contas Sisbajud, bloqueio de bens) e as linhas de defesa possíveis (impugnação, excesso de execução, prescrição, nulidade de citação, acordo com deságio).\n` +
      `- Se o cliente anexar documentos, confirme o recebimento e use as informações para fundamentar a orientação.\n` +
      `- Nunca prometa resultados infalíveis, pois decisões judiciais dependem de juízes e recursos, mas oriente os melhores caminhos estratégicos.\n` +
      `- Responda sempre em português claro, elegante e estruturado.\n\n` +
      `=== DADOS CADASTRAIS DO CLIENTE ===\n` +
      `Nome: ${clientName}\n` +
      `CPF: ${clientCpf}\n` +
      `Total de Processos Rastreados: ${totalFound}` +
      processesContextText +
      attachmentsText;

    const formattedMessages = (messages ?? []).map((m: { role: string; content: string }) => ({
      role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content
    }));

    // Chamada à OpenAI (GPT-4o-mini com contexto completo)
    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...formattedMessages
        ],
        max_tokens: 800,
        temperature: 0.65
      });

      const text = completion.choices[0]?.message?.content ?? '';
      return NextResponse.json({ text });
    }

    // Fallback para Anthropic Claude
    if (process.env.ANTHROPIC_API_KEY) {
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
