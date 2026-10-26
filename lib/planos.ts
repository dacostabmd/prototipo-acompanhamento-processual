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
}

export const REGRAS_PLANOS: Record<PlanoTipo, RegrasPlano> = {
  free: {
    nome: 'Gratuito',
    valorMensalReais: 0,
    limiteProcessosMonitorados: 2,
    whatsappConversacional: false,
    smartDigestSemanal: false,
    leituraDocumentosOcr: false,
    monitoramentoCpf: false,
    suportePrioritario: false
  },
  pro: {
    nome: 'Pro',
    valorMensalReais: 79.9,
    limiteProcessosMonitorados: 50,
    whatsappConversacional: true,
    smartDigestSemanal: true,
    leituraDocumentosOcr: true,
    monitoramentoCpf: true,
    suportePrioritario: true
  }
};

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
