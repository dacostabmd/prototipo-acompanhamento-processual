export type UrgenciaResumo = 'baixa' | 'media' | 'alta';
export type ModoSensibilidade = 'smart_digest' | 'todas' | 'urgentes_apenas';

export interface PoloProcesso {
  nomes: string[];
  advogados: string[];
}

export interface MovimentacaoResumida {
  id: string;
  data: string;
  /** Texto do tribunal encurtado (fallback do card enquanto não há tradução). */
  titulo: string;
  /** Texto técnico completo, como veio do tribunal (para advogados). */
  textoOriginal: string;
  /** Tradução em linguagem simples gerada por IA (null enquanto não traduzida). */
  traducao: string | null;
  /** urgente | positivo | informativo (classificação gravada na sincronização). */
  tipo: string | null;
}

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
  /** Processo de um colega do escritório: só leitura (nome de quem acompanha em `compartilhadoPor`). */
  somenteLeitura?: boolean;
  compartilhadoPor?: string;
  sensibilidade: ModoSensibilidade;
  assunto: string | null;
  valorCausa: number | null;
  /** Data de distribuição (ISO ou dd/mm/aaaa, como veio da fonte). */
  distribuidoEm: string | null;
  vara: string | null;
  poloAtivo: PoloProcesso;
  poloPassivo: PoloProcesso;
  /** Últimas movimentações, da mais nova para a mais antiga (no máximo 10; o card mostra 3). */
  movimentacoes: MovimentacaoResumida[];
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
