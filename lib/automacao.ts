import type { Movement } from './mockProcesses';

export type AutomacaoEsfera = 'estadual' | 'federal' | 'municipal';
export type AutomacaoDealStatus = 'pendente' | 'processando' | 'enriquecido' | 'sem_processo' | 'erro';

export interface AutomacaoRegra {
  id: string;
  userId: string;
  nome: string;
  categoriaId: number;
  categoriaNome: string | null;
  stageId: string;
  stageNome: string | null;
  campoProcesso: string;
  tamanhoLote: number;
  filtroEsfera: AutomacaoEsfera | null;
  filtroValorMin: number | null;
  filtroValorMax: number | null;
  campoValor: string;
  campoEsfera: string | null;
  ordem: number;
  ativo: boolean;
}

export interface AutomacaoDealEnriquecido {
  movimentos?: Movement[];
  classe?: string;
  assuntos?: string[];
  orgaoJulgador?: string;
  grau?: string;
  dataAjuizamento?: string;
  valorCausa?: string;
  parteContraria?: string;
  fonte?: 'datajud' | null;
}

export interface AutomacaoDeal {
  id: string;
  regraId: string;
  dealId: number;
  dealTitulo: string | null;
  numeroCnj: string | null;
  numeroCnjFormatado: string | null;
  tribunalLabel: string | null;
  esfera: AutomacaoEsfera | null;
  valorDeal: number | null;
  status: AutomacaoDealStatus;
  erroMensagem: string | null;
  dadosEnriquecidos: AutomacaoDealEnriquecido;
  processadoEm: string | null;
  createdAt: string;
}

export const ESFERA_LABEL: Record<AutomacaoEsfera, string> = {
  estadual: 'Estadual',
  federal: 'Federal',
  municipal: 'Municipal'
};

export const STATUS_LABEL: Record<AutomacaoDealStatus, string> = {
  pendente: 'Pendente',
  processando: 'Processando',
  enriquecido: 'Enriquecido',
  sem_processo: 'Sem processo',
  erro: 'Erro'
};
