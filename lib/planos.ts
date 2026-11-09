import { getAdminClient } from '@/lib/track';

export type PlanoTipo = 'free' | 'pro';

export interface RegrasPlano {
  nome: string;
  valorMensalReais: number;
  limiteProcessosMonitorados: number;
  whatsappConversacional: boolean;
  smartDigestSemanal: boolean;
  leituraDocumentosOcr: boolean;
  monitoramentoCpf: boolean;
  suportePrioritario: boolean;
  /** Quantas buscas monitoradas no Diário (OAB, nome ou termo) a conta pode manter ativas. */
  limiteBuscasMonitoradas: number;
  /** Agenda de prazos e tarefas com lembretes. */
  agendaPrazos: boolean;
  /** Modelos de peças geradas por IA. */
  pecasIa: boolean;
  /** Busca de jurisprudência. */
  jurisprudencia: boolean;
  /** Escritório com vários usuários; 1 = só o dono. */
  limiteMembrosEquipe: number;
  /** Franquia mensal (R$) de consultas pagas em APIs de terceiros (Infosimples/Lemit). Renova todo mês. */
  franquiaMensalReais: number;
}

export interface ConsumoCiclo {
  franquiaReais: number;
  usadoReais: number;
  restanteReais: number;
  percentualUsado: number;
  inicioCiclo: string;
  renovaEm: string;
}

const numeroEnv = (valor: string | undefined, padrao: number) => {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
};

export const REGRAS_PLANOS: Record<PlanoTipo, RegrasPlano> = {
  free: {
    nome: 'Gratuito',
    valorMensalReais: 0,
    franquiaMensalReais: numeroEnv(process.env.FRANQUIA_MENSAL_FREE_REAIS, 5),
    limiteProcessosMonitorados: 2,
    whatsappConversacional: false,
    smartDigestSemanal: false,
    leituraDocumentosOcr: false,
    monitoramentoCpf: false,
    suportePrioritario: false,
    limiteBuscasMonitoradas: 1,
    agendaPrazos: false,
    pecasIa: false,
    jurisprudencia: false,
    limiteMembrosEquipe: 1
  },
  pro: {
    nome: 'Pro',
    valorMensalReais: 79.9,
    franquiaMensalReais: numeroEnv(process.env.FRANQUIA_MENSAL_PRO_REAIS, 40),
    limiteProcessosMonitorados: 50,
    whatsappConversacional: true,
    smartDigestSemanal: true,
    leituraDocumentosOcr: true,
    monitoramentoCpf: true,
    suportePrioritario: true,
    limiteBuscasMonitoradas: 10,
    agendaPrazos: true,
    pecasIa: true,
    jurisprudencia: true,
    limiteMembrosEquipe: 3
  }
};

export type RecursoPlano = 'agendaPrazos' | 'pecasIa' | 'jurisprudencia' | 'monitoramentoCpf' | 'whatsappConversacional';

/**
 * Checagem única de acesso a um recurso por plano. owner/admin sempre passam (mesma regra do limite de processos).
 * Rotas de recurso Pro devem responder 403 com `codigo: 'recurso_pro'` quando `permitido` for false.
 */
export async function verificarRecursoPlano(
  userId: string,
  recurso: RecursoPlano
): Promise<{ permitido: boolean; plano: PlanoTipo; privilegiado: boolean }> {
  const db = getAdminClient();
  const [status, perfil] = await Promise.all([
    obterStatusPlanoUsuario(userId),
    db ? db.from('ap_perfis').select('role').eq('id', userId).maybeSingle() : Promise.resolve({ data: null })
  ]);
  const role = (perfil.data as { role?: string } | null)?.role;
  const privilegiado = role === 'owner' || role === 'admin';
  return { permitido: privilegiado || Boolean(status.regras[recurso]), plano: status.plano, privilegiado };
}

/**
 * Consulta o plano e os limites de consumo atuais do usuário.
 */
export async function obterStatusPlanoUsuario(userId: string): Promise<{
  plano: PlanoTipo;
  regras: RegrasPlano;
  totalProcessosMonitorados: number;
  podeAdicionarProcesso: boolean;
  podeUsarWhatsapp: boolean;
}> {
  const db = getAdminClient();
  if (!db) {
    return {
      plano: 'free',
      regras: REGRAS_PLANOS.free,
      totalProcessosMonitorados: 0,
      podeAdicionarProcesso: true,
      podeUsarWhatsapp: false
    };
  }

  const [perfil, contagem] = await Promise.all([
    db.from('ap_perfis').select('plano').eq('id', userId).maybeSingle(),
    db.from('ap_processos_monitorados').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  ]);

  const plano: PlanoTipo = perfil.data?.plano === 'pro' ? 'pro' : 'free';
  const regras = REGRAS_PLANOS[plano];
  const totalProcessos = contagem.count ?? 0;

  return {
    plano,
    regras,
    totalProcessosMonitorados: totalProcessos,
    podeAdicionarProcesso: totalProcessos < regras.limiteProcessosMonitorados,
    podeUsarWhatsapp: regras.whatsappConversacional
  };
}

/**
 * Consumo da franquia no ciclo atual (mês-calendário, horário de Brasília): soma do que as consultas
 * pagas do usuário custaram (ap_historico_consultas.custo_cobrado). Renova no dia 1º do mês seguinte.
 */
export async function obterConsumoCiclo(userId: string, plano: PlanoTipo): Promise<ConsumoCiclo> {
  const franquia = REGRAS_PLANOS[plano].franquiaMensalReais;
  const agoraBr = new Date(Date.now() - 3 * 3600_000);
  const ano = agoraBr.getUTCFullYear();
  const mes = agoraBr.getUTCMonth();
  const inicio = new Date(Date.UTC(ano, mes, 1, 3, 0, 0));
  const renova = new Date(Date.UTC(ano, mes + 1, 1, 3, 0, 0));

  let usado = 0;
  const db = getAdminClient();
  if (db) {
    const { data, error } = await db
      .from('ap_historico_consultas')
      .select('custo_cobrado')
      .eq('user_id', userId)
      .gte('created_at', inicio.toISOString());
    if (error) console.error('[planos] Falha ao somar consumo do ciclo:', error.message);
    usado = (data ?? []).reduce((soma, linha) => soma + Number(linha.custo_cobrado ?? 0), 0);
  }

  usado = Number(usado.toFixed(2));
  const restante = Number(Math.max(0, franquia - usado).toFixed(2));
  const percentual = franquia > 0 ? Math.min(100, Math.round((usado / franquia) * 100)) : usado > 0 ? 100 : 0;

  return {
    franquiaReais: franquia,
    usadoReais: usado,
    restanteReais: restante,
    percentualUsado: percentual,
    inicioCiclo: inicio.toISOString(),
    renovaEm: renova.toISOString()
  };
}

/**
 * Atualiza o plano de um usuário para 'pro' ou 'free' (uso exclusivo de rotas de assinatura/admin).
 */
export async function atualizarPlanoUsuario(userId: string, novoPlano: PlanoTipo): Promise<boolean> {
  const db = getAdminClient();
  if (!db) return false;

  const { error } = await db
    .from('ap_perfis')
    .update({ plano: novoPlano, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) {
    console.error('[planos] Falha ao atualizar plano:', error.message);
    return false;
  }

  return true;
}
