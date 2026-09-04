import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { fullName, cpf, state, phone, processNumber, processesCount, processesSummary, tribunal } =
      await request.json();

    const webhookUrl = process.env.BITRIX_WEBHOOK_URL;

    console.log(
      `[api/bitrix/lead] Novo lead recebido do Stepper: ${fullName} (CPF: ${cpf}, Tel: ${phone}, Estado: ${state || 'N/I'}, Processos: ${processesCount || 0})`
    );

    if (webhookUrl) {
      // Normaliza a URL do webhook do Bitrix
      const cleanUrl = webhookUrl.replace(/\/+$/, '');
      const endpoint = cleanUrl.endsWith('.json') ? cleanUrl : `${cleanUrl}/crm.lead.add.json`;

      const leadPayload = {
        fields: {
          TITLE: `Consulta Processual - ${fullName || 'Cliente'}`,
          NAME: fullName || 'Cliente',
          PHONE: phone ? [{ VALUE: phone, VALUE_TYPE: 'WORK' }] : [],
          COMMENTS:
            `=== CONSULTA PROCESSUAL BLINDAGEM FINANCEIRA ===\n` +
            `Cliente: ${fullName}\n` +
            `CPF: ${cpf}\n` +
            `Telefone (WhatsApp): ${phone}\n` +
            `Estado/Tribunal selecionado: ${state || 'Não informado'}\n` +
            `Número de Processo informado: ${processNumber || 'Nenhum'}\n` +
            `Total de Processos localizados: ${processesCount || 0}\n` +
            `Tribunais consultados: ${tribunal || 'Automático'}\n\n` +
            `=== RESUMO EXECUTIVO ===\n` +
            `${processesSummary || 'Consulta realizada via formulário interativo.'}`,
          SOURCE_ID: 'WEB',
          OPENED: 'Y'
        }
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[api/bitrix/lead] Erro ao enviar para o Bitrix:', response.status, errorText);
        return NextResponse.json(
          { success: false, error: 'Falha ao sincronizar com Bitrix24.' },
          { status: 502 }
        );
      }

      const result = await response.json().catch(() => ({}));
      console.log('[api/bitrix/lead] Lead criado com sucesso no Bitrix24! ID:', result?.result);
      return NextResponse.json({ success: true, leadId: result?.result || null, simulated: false });
    }

    // Se a variável BITRIX_WEBHOOK_URL ainda não estiver preenchida no .env.local
    console.log(
      '[api/bitrix/lead] BITRIX_WEBHOOK_URL não configurada no servidor. Card registrado em modo de homologação (simulado).'
    );

    return NextResponse.json({
      success: true,
      simulated: true,
      message: 'Card registrado localmente. Para envio direto ao CRM, adicione BITRIX_WEBHOOK_URL no .env.local.'
    });
  } catch (error) {
    console.error('[api/bitrix/lead] Exceção:', error);
    return NextResponse.json({ error: 'Erro interno ao processar criação de lead.' }, { status: 500 });
  }
}
