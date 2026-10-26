import { NextResponse } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { obterStatusPlanoUsuario } from '@/lib/planos';
import {
  cadastrarDocumentoMonitoramento,
  listarDocumentosMonitorados,
  type DocumentoMonitorado
} from '@/lib/monitoramentoCpf';

/**
 * Lista todos os CPFs e CNPJs cadastrados para varredura contínua de novos processos.
 */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
  }

  const [statusPlano, documentos] = await Promise.all([
    obterStatusPlanoUsuario(userId),
    listarDocumentosMonitorados(userId)
  ]);

  return NextResponse.json({
    documentos,
    plano: statusPlano.plano,
    permitidoPeloPlano: statusPlano.regras.monitoramentoCpf
  });
}

/**
 * Cadastra um novo CPF ou CNPJ para monitoramento contínuo de novas distribuições judiciais.
 */
export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });
  }

  const statusPlano = await obterStatusPlanoUsuario(userId);
  if (!statusPlano.regras.monitoramentoCpf) {
    return NextResponse.json(
      {
        error: 'O monitoramento contínuo de novos processos por CPF/CNPJ é exclusivo do Plano Pro.',
        codigo: 'recurso_pro'
      },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const documento = typeof body?.documento === 'string' ? body.documento.trim() : '';
  const nomeTitular = typeof body?.nomeTitular === 'string' ? body.nomeTitular.trim() : undefined;
  const notificarWhatsapp = body?.notificarWhatsapp ?? true;
  const notificarEmail = body?.notificarEmail ?? true;

  if (!documento) {
    return NextResponse.json({ error: 'Informe o número do CPF ou CNPJ.' }, { status: 400 });
  }

  const resultado = await cadastrarDocumentoMonitoramento({
    userId,
    documentoRaw: documento,
    nomeTitular,
    notificarWhatsapp,
    notificarEmail
  });

  if (!resultado.sucesso) {
    return NextResponse.json({ error: resultado.erro || 'Falha ao cadastrar documento.' }, { status: 400 });
  }

  return NextResponse.json({ sucesso: true, id: resultado.id }, { status: 201 });
}

/**
 * Atualiza preferências de notificação ou ativação de um CPF/CNPJ monitorado.
 */
export async function PATCH(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) {
    return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: 'ID do documento não informado.' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.ativo === 'boolean') updates.ativo = body.ativo;
  if (typeof body.notificarWhatsapp === 'boolean') updates.notificar_whatsapp = body.notificarWhatsapp;
  if (typeof body.notificarEmail === 'boolean') updates.notificar_email = body.notificarEmail;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo para atualizar.' }, { status: 400 });
  }

  const { error } = await db
    .from('ap_monitoramento_documentos')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.error('[api/monitoramento-documentos] erro no PATCH:', error.message);
    return NextResponse.json({ error: 'Não foi possível atualizar o documento.' }, { status: 500 });
  }

  return NextResponse.json({ sucesso: true });
}

/**
 * Remove um CPF/CNPJ da rotina de varredura contínua.
 */
export async function DELETE(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  const db = getAdminClient();
  if (!userId || !db) {
    return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID do documento obrigatório.' }, { status: 400 });
  }

  const { error } = await db
    .from('ap_monitoramento_documentos')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.error('[api/monitoramento-documentos] erro no DELETE:', error.message);
    return NextResponse.json({ error: 'Falha ao remover documento monitorado.' }, { status: 500 });
  }

  return NextResponse.json({ sucesso: true });
}
