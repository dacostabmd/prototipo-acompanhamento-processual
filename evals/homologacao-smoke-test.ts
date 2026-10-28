/**
 * Suíte de Testes de Fumaça e Homologação E2E (JusConsulta)
 * Valida os pilares do funil de conversão e da infraestrutura de ponta a ponta:
 * 1. Busca Pública CNJ & Fallback DataJud (/api/publico/busca)
 * 2. Classificador de Intimações e Prazos CPC (lib/classify.ts)
 * 3. Webhook de Pagamento Multi-Gateway (/api/pagamentos/webhook)
 * 4. Handshake do Webhook da Meta (/api/whatsapp/webhook)
 * 5. Agente Conversacional WhatsApp com Ferramentas ReAct
 * 6. Cache do DataJud e Diagnóstico de Penhora de Salário (art. 833 CPC)
 */
import { classifyTag } from '../lib/classify';
import { GET as webhookGet, POST as webhookPost } from '../app/api/whatsapp/webhook/route';
import { POST as pagamentoPost } from '../app/api/pagamentos/webhook/route';
import { GET as buscaPublicaGet } from '../app/api/publico/busca/route';
import { NextRequest } from 'next/server';
import { executarAgenteWhatsApp } from '../lib/agent/andamentoAgent';
import { formatProcessNumber } from '../lib/cnj';
import { cleanDigits } from '../lib/format';

let aprovados = 0;
let total = 0;

function assert(cond: boolean, titulo: string, detalhe?: string) {
  total++;
  if (cond) {
    aprovados++;
    console.log(`  [OK] ${titulo}`);
  } else {
    console.error(`  [FALHA] ${titulo}${detalhe ? ` -> ${detalhe}` : ''}`);
  }
}

async function run() {
  console.log('\n============================================================');
  console.log('   INICIANDO BATERIA DE TESTES DE HOMOLOGAÇÃO E2E (SMOKE TEST)');
  console.log('============================================================\n');

  // ------------------------------------------------------------
  // 1. CLASSIFICADOR DE URGÊNCIA E PRAZOS DO CPC
  // ------------------------------------------------------------
  console.log('[1/5] Testando Classificador de Urgência e Prazos CPC...');
  const tagPrazo = classifyTag('Intimação para manifestação no prazo de 15 dias úteis');
  assert(tagPrazo === 'urgente', 'Intimação com prazo de 15 dias deve ser "urgente"', `recebeu: ${tagPrazo}`);

  const tagSobPena = classifyTag('Intimação para pagamento voluntário sob pena de penhora e multa');
  assert(tagSobPena === 'urgente', 'Intimação "sob pena de penhora" deve ser "urgente"', `recebeu: ${tagSobPena}`);

  const tagRotina = classifyTag('Juntada de petição de manifestação da parte autora');
  assert(tagRotina === 'andamento' || tagRotina === 'informativo', 'Juntada simples deve ser andamento/rotina', `recebeu: ${tagRotina}`);

  // ------------------------------------------------------------
  // 2. BUSCA PÚBLICA (API PÚBLICA DE PROCESSO)
  // ------------------------------------------------------------
  console.log('\n[2/5] Testando Rota de Busca Pública (/api/publico/busca)...');
  try {
    const cnjTeste = '5005714-32.2025.8.13.0456';
    const reqBusca = new NextRequest(`http://localhost:3000/api/publico/busca?q=${cnjTeste}`, {
      headers: { 'x-forwarded-for': '127.0.0.1' }
    });
    const resBusca = await buscaPublicaGet(reqBusca);
    assert(resBusca.status === 200, 'Busca pública deve responder 200 OK');
    const jsonBusca = await resBusca.json();
    assert(Array.isArray(jsonBusca.processos), 'Retorno deve conter lista de processos');
    const proc = jsonBusca.processos[0];
    assert(proc !== undefined, 'Deve retornar ao menos 1 processo');
    assert(cleanDigits(proc.numeroCnj || '') === cleanDigits(cnjTeste), 'Número CNJ retornado deve bater com a busca');
    assert(proc.numeroFormatado !== undefined, 'Processo deve conter numeroFormatado');
    assert(proc.autores === undefined, 'Autores devem ser omitidos na prévia pública para segurança e conversão');
  } catch (err) {
    assert(false, 'Erro ao executar busca pública', (err as Error).message);
  }

  // ------------------------------------------------------------
  // 3. WEBHOOK META WHATSAPP (HANDSHAKE GET & RECUSA DE TOKEN INVÁLIDO)
  // ------------------------------------------------------------
  console.log('\n[3/5] Testando Webhook WhatsApp Meta Handshake (/api/whatsapp/webhook)...');
  const tokenValido = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'jusconsulta_whatsapp_secret';
  
  // Handshake válido
  const reqMetaValida = new NextRequest(`http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${tokenValido}&hub.challenge=desafio_12345`);
  const resMetaValida = await webhookGet(reqMetaValida);
  const textoDesafio = await resMetaValida.text();
  assert(resMetaValida.status === 200 && textoDesafio === 'desafio_12345', 'Handshake com verify_token válido deve retornar challenge e status 200');

  // Handshake inválido
  const reqMetaInvalida = new NextRequest(`http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token_errado&hub.challenge=desafio_12345`);
  const resMetaInvalida = await webhookGet(reqMetaInvalida);
  assert(resMetaInvalida.status === 403, 'Handshake com token inválido deve ser recusado com status 403');

  // Opt-out LGPD via POST simulado
  const reqOptOut = new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            messages: [{
              from: '5511999998888',
              id: 'wamid_teste_optout',
              timestamp: `${Date.now()}`,
              type: 'text',
              text: { body: 'SAIR' }
            }]
          }
        }]
      }]
    })
  });
  const resOptOut = await webhookPost(reqOptOut);
  assert(resOptOut.status === 200, 'Webhook POST com comando de opt-out LGPD ("SAIR") deve ser processado com 200 OK');

  // ------------------------------------------------------------
  // 4. WEBHOOK DE PAGAMENTOS MULTI-GATEWAY (/api/pagamentos/webhook)
  // ------------------------------------------------------------
  console.log('\n[4/5] Testando Webhook de Pagamento do Plano PRO (/api/pagamentos/webhook)...');
  
  // Teste payload inválido
  const reqPgInvalido = new NextRequest('http://localhost:3000/api/pagamentos/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'payload-invalido'
  });
  const resPgInvalido = await pagamentoPost(reqPgInvalido);
  assert(resPgInvalido.status === 400, 'Webhook de pagamento com JSON inválido deve retornar status 400');

  // Teste payload Asaas simulado
  const reqPgAsaas = new NextRequest('http://localhost:3000/api/pagamentos/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'PAYMENT_CONFIRMED',
      payment: {
        id: 'pay_teste_123',
        customerEmail: 'cliente.teste.naoexiste@exemplo.com.br',
        value: 79.9
      }
    })
  });
  const resPgAsaas = await pagamentoPost(reqPgAsaas);
  const jsonPgAsaas = await resPgAsaas.json();
  assert(
    resPgAsaas.status === 200 && jsonPgAsaas.motivo === 'usuario_nao_localizado',
    'Webhook do Asaas deve ser aceito e tratar graciosamente usuário desconhecido'
  );

  // ------------------------------------------------------------
  // 5. AGENTE DE IA DO WHATSAPP (CALIBRAGEM DE PRAZOS & PENHORA)
  // ------------------------------------------------------------
  console.log('\n[5/5] Testando Agente de IA Conversacional no WhatsApp...');
  try {
    const agenteRes = await executarAgenteWhatsApp({
      pergunta: 'Podem penhorar meu salário? Estou com receio de perder todo o dinheiro da conta.',
      telefone: '5511999999999',
      nomeUsuario: 'Maria',
      perfilUsuario: 'cliente',
      processosDoUsuario: []
    });

    const resposta = agenteRes.resposta;
    console.log(`  > Resposta do Agente gerada no teste:\n    "${resposta.replace(/\n/g, ' ')}"\n`);
    const temArtigo = /833/i.test(resposta);
    const temImpenhoravel = /impenhor[aá]ve/i.test(resposta);
    const temAdvogado = /advogad|jur[ií]dic|assessoria|defensoria/i.test(resposta);

    assert(temImpenhoravel, 'Agente deve esclarecer que salário é impenhorável como regra geral');
    assert(temArtigo, 'Agente deve fundamentar com o Art. 833 do CPC');
    assert(temAdvogado, 'Agente deve orientar alinhamento com advogado ou assessoria jurídica');
  } catch (err) {
    assert(false, 'Execução do agente de IA no WhatsApp falhou', (err as Error).message);
  }

  // ------------------------------------------------------------
  // RELATÓRIO FINAL
  // ------------------------------------------------------------
  console.log('\n============================================================');
  console.log(`   RESULTADO FINAL: ${aprovados}/${total} TESTES APROVADOS (${Math.round((aprovados / total) * 100)}%)`);
  console.log('============================================================\n');

  if (aprovados === total) {
    console.log('SISTEMA 100% HOMOLOGADO E PRONTO PARA OPERAÇÃO EM PRODUÇÃO!\n');
    process.exit(0);
  } else {
    console.error('ALERTA: Um ou mais testes falharam na homologação.\n');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Erro fatal durante a suíte de homologação:', err);
  process.exit(1);
});
