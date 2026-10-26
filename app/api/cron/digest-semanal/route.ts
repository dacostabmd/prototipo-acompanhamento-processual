import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getAdminClient, trackEvento } from '@/lib/track';
import { normalizarTelefoneBr, enviarTextoWhatsApp } from '@/lib/whatsapp';
import { gerarMensagemDigestSemanal } from '@/lib/smartDigest';

export const maxDuration = 300;

function validarSegredo(request: Request): boolean {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return true; // desenvolvimento local

  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token.length !== segredo.length) return false;

  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(segredo));
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  if (!validarSegredo(request)) {
    return NextResponse.json({ error: 'Acesso não autorizado ao cron do digest.' }, { status: 401 });
  }

  const db = getAdminClient();
  if (!db) {
    return NextResponse.json({ error: 'Banco de dados indisponível.' }, { status: 503 });
  }

  // 1. Busca todos os usuários com WhatsApp ativo no monitoramento
  const { data: monitoramentos, error: errMon } = await db
    .from('ap_processos_monitorados')
    .select(`
      user_id,
      processo_id,
      notificar_whatsapp,
      ap_perfis!inner (id, nome, telefone, role),
      ap_processos!inner (id, numero_cnj, tribunal, classe_processual)
    `)
    .eq('notificar_whatsapp', true);

  if (errMon) {
    console.error('[cron/digest-semanal] erro ao consultar monitoramentos:', errMon.message);
    return NextResponse.json({ error: 'Falha ao consultar banco.' }, { status: 500 });
  }

  // Agrupa os processos por usuário
  const usuariosMap = new Map<
    string,
    {
      nome: string;
      telefone: string;
      perfilUsuario: 'cliente' | 'advogado';
      processos: { id: string; numeroCnj: string; tribunal: string | null; classe: string | null }[];
    }
  >();

  for (const m of monitoramentos ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perfil = (m as any).ap_perfis;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proc = (m as any).ap_processos;
    if (!perfil?.telefone || !proc?.numero_cnj) continue;

    const telNormalizado = normalizarTelefoneBr(perfil.telefone);
    if (!telNormalizado) continue;

    if (!usuariosMap.has(m.user_id)) {
      usuariosMap.set(m.user_id, {
        nome: perfil.nome || 'Cliente',
        telefone: telNormalizado,
        perfilUsuario: perfil.role === 'advogado' ? 'advogado' : 'cliente',
        processos: []
      });
    }

    usuariosMap.get(m.user_id)!.processos.push({
      id: proc.id,
      numeroCnj: proc.numero_cnj,
      tribunal: proc.tribunal,
      classe: proc.classe_processual
    });
  }

  let enviados = 0;
  let ignorados = 0;
  let erros = 0;

  // Sete dias atrás
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const [userId, usuario] of usuariosMap.entries()) {
    try {
      const procIds = usuario.processos.map(p => p.id);

      // Busca as movimentações ocorridas nos últimos 7 dias para esses processos
      const { data: movsRecentes } = await db
        .from('ap_movimentacoes')
        .select('processo_id, titulo, conteudo, data_movimentacao')
        .in('processo_id', procIds)
        .gte('created_at', seteDiasAtras);

      // Se nenhum processo teve novidade na semana, não enviamos spam desnecessário
      if (!movsRecentes || movsRecentes.length === 0) {
        ignorados++;
        continue;
      }

      // Prepara os itens do digest
      const itensDigest = usuario.processos
        .map(p => {
          const mDoProcesso = movsRecentes.filter(m => m.processo_id === p.id);
          if (mDoProcesso.length === 0) return null;
          return {
            numeroCnj: p.numeroCnj,
            tribunal: p.tribunal,
            classe: p.classe,
            resumo: mDoProcesso.map(m => m.titulo).slice(0, 2).join('; '),
            movimentosCount: mDoProcesso.length
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (itensDigest.length === 0) {
        ignorados++;
        continue;
      }

      // Gera a síntese inteligente do Smart Digest via Agente LangChain
      const mensagemWhatsApp = await gerarMensagemDigestSemanal({
        nomeUsuario: usuario.nome,
        perfilUsuario: usuario.perfilUsuario,
        itens: itensDigest,
        userId
      });

      const resEnvio = await enviarTextoWhatsApp(usuario.telefone, mensagemWhatsApp);
      if (resEnvio.enviado) {
        enviados++;
      } else {
        erros++;
      }
    } catch (err) {
      console.error('[cron/digest-semanal] erro ao processar digest do usuário:', userId, err);
      erros++;
    }
  }

  await trackEvento(request, null, {
    tipo: 'reconsulta_noturna',
    dados: {
      subtipo: 'smart_digest_semanal',
      usuariosTotal: usuariosMap.size,
      enviados,
      ignorados,
      erros
    }
  });

  return NextResponse.json({
    status: 'concluido',
    usuariosTotal: usuariosMap.size,
    enviados,
    ignorados,
    erros
  });
}
