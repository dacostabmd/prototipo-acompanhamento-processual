export type UrgenciaResumo = 'baixa' | 'media' | 'alta';
export type ModoSensibilidade = 'smart_digest' | 'todas' | 'urgentes_apenas';

export interface ProcessoAcompanhado {
  processoId: string;
  numeroCnj: string;
  tribunal: string | null;
  classe: string | null;
  ultimaMovimentacaoEm: string | null;
  ultimaConsultaEm: string | null;
  proximaConsultaEm: string | null;
  notificarEmail: boolean;
  notificarWhatsapp: boolean;
  sensibilidade: ModoSensibilidade;
  resumo: {
    resumo: string;
    significado: string;
    proximoPasso: string | null;
    urgencia: UrgenciaResumo | null;
    criadoEm: string;
  } | null;
}

export interface RespostaMonitoramento {
  processos: ProcessoAcompanhado[];
  /** Telefone do perfil serve para WhatsApp (ap_perfis.telefone com DDD). */
  telefoneValido: boolean;
}

export interface Notificacao {
  id: string;
  processoId: string;
  numeroCnj: string | null;
  titulo: string;
  mensagem: string;
  lida: boolean;
  criadaEm: string;
}
