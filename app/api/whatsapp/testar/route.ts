import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/requireUser';
import { getAdminClient, getUserId } from '@/lib/track';
import { normalizarTelefoneBr, enviarTextoWhatsApp, enviarInterativoWhatsApp } from '@/lib/whatsapp';
import { interpretarAndamentoComAgente } from '@/lib/agent/andamentoAgent';

/**
 * Dispara um envio de teste no WhatsApp para o processo selecionado.
 * Permite ao usuário validar imediatamente a integração, a tradução do agente LangChain
 * e o trace no Langfuse.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) {
    return NextResponse.json({ error: 'Indisponível no modo demonstração.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { processoId?: string } | null;
  const processoId = body?.processoId;
  if (!processoId) {
    return NextResponse.json({ error: 'ID do processo não informado.' }, { status: 400 });
  }

  // 1. Busca perfil do usuário
  const { data: perfil } = await db.from('ap_perfis').select('id, nome, telefone, role').eq('id', userId).maybeSingle();
  if (!perfil?.telefone) {
    return NextResponse.json(
      { error: 'Cadastre seu celular com DDD no perfil para poder enviar mensagens de teste.' },
      { status: 400 }
    );
  }

  const telefoneNormalizado = normalizarTelefoneBr(perfil.telefone);
  if (!telefoneNormalizado) {
    return NextResponse.json(
      { error: 'O número de celular cadastrado é inválido para o WhatsApp.' },
      { status: 400 }
    );
  }

  // 2. Busca dados do processo e movimentações
  const { data: processo } = await db
    .from('ap_processos')
    .select('id, numero_cnj, tribunal, classe_processual, assunto_principal, parte_autora, parte_re')
    .eq('id', processoId)
    .maybeSingle();

  if (!processo) {
    return NextResponse.json({ error: 'Processo não encontrado.' }, { status: 404 });
  }

  const { data: movimentacoes } = await db
    .from('ap_movimentacoes')
    .select('data_movimentacao, titulo, conteudo')
    .eq('processo_id', processoId)
    .order('data_movimentacao', { ascending: false })
    .limit(5);

  const movsParaAgente = (movimentacoes || []).map(m => ({
    data: m.data_movimentacao,
    titulo: m.titulo,
    descricao: m.conteudo
  }));

  // Se não houver movimentações gravadas, usa movimentação sintética de demonstração
  if (movsParaAgente.length === 0) {
    movsParaAgente.push({
      data: new Date().toISOString().slice(0, 10),
      titulo: 'Conclusos para despacho de expediente',
      descricao: 'Autos remetidos conclusos para análise do juízo competente.'
    });
  }

  try {
    // 3. Executa o Agente LangChain com observabilidade Langfuse
    const resultadoAgente = await interpretarAndamentoComAgente({
      processo: {
        numeroCnj: processo.numero_cnj,
        tribunal: processo.tribunal,
        classe: processo.classe_processual,
        assunto: processo.assunto_principal,
        parteContraria: processo.parte_re || processo.parte_autora
      },
      movimentosNovos: movsParaAgente,
      perfilUsuario: perfil.role === 'advogado' ? 'advogado' : 'cliente',
      nomeUsuario: perfil.nome || 'Cliente',
      userId: perfil.id
    });

    // 4. Envia para o WhatsApp do usuário
    let envio;
    if (process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      envio = await enviarInterativoWhatsApp(
        telefoneNormalizado,
        `[TESTE PROSEC IA]\n\n${resultadoAgente.textoFormatadoWhatsApp}`,
        resultadoAgente.botoesSugeridos.map((b, idx) => ({ id: `btn_test_${idx}`, title: b }))
      );
      if (!envio.enviado && envio.erro) {
        // Fallback para texto livre
        envio = await enviarTextoWhatsApp(
          telefoneNormalizado,
          `[TESTE PROSEC IA]\n\n${resultadoAgente.textoFormatadoWhatsApp}`
        );
      }
    } else {
      // Simulação quando a Meta Cloud API ainda não tem credenciais inseridas na Vercel/Local
      envio = {
        enviado: true,
        mensagemId: `sim_${Date.now()}`,
        simulado: true
      };
    }

    return NextResponse.json({
      sucesso: true,
      envio,
      resumo: resultadoAgente.resumo,
      urgencia: resultadoAgente.urgencia,
      traceId: resultadoAgente.traceId
    });
  } catch (err) {
    console.error('[whatsapp/testar] erro ao gerar/enviar teste:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
