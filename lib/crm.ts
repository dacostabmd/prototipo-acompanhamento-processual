import type { Movement } from './mockProcesses';

export type CrmEsfera = 'estadual' | 'federal' | 'municipal';
export type CrmStatusEnriquecimento = 'pendente' | 'processando' | 'enriquecido' | 'sem_dado' | 'erro';
export type CrmTipoCampoStorage = 'text' | 'number' | 'date' | 'boolean';

export interface CrmPipeline {
  id: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  ativo: boolean;
}

export interface CrmEtapa {
  id: string;
  pipelineId: string;
  nome: string;
  cor: string | null;
  ordem: number;
}

export interface CrmTipoCampo {
  id: string;
  slug: string;
  label: string;
  storageKind: CrmTipoCampoStorage;
  requerOpcoes: boolean;
  ativo: boolean;
  ordem: number;
}

export interface CrmCampoOpcao {
  value: string;
  label: string;
}

export interface CrmPipelineCampo {
  id: string;
  pipelineId: string;
  tipoCampoId: string;
  nome: string;
  slug: string;
  obrigatorio: boolean;
  opcoes: CrmCampoOpcao[] | null;
  ordem: number;
  ativo: boolean;
}

export interface CrmItemEnriquecimento {
  movimentos?: Movement[];
  classe?: string;
  assuntos?: string[];
  orgaoJulgador?: string;
  grau?: string;
  dataAjuizamento?: string;
  valorCausa?: string;
  parteContraria?: string;
  fonte?: 'datajud' | 'infosimples' | null;
}

export interface CrmItem {
  id: string;
  pipelineId: string;
  etapaId: string;
  titulo: string;
  numeroCnj: string | null;
  numeroCnjFormatado: string | null;
  tribunalLabel: string | null;
  esfera: CrmEsfera | null;
  camposCustomizados: Record<string, string | number | boolean | null>;
  statusEnriquecimento: CrmStatusEnriquecimento;
  erroMensagem: string | null;
  dadosEnriquecidos: CrmItemEnriquecimento;
  enriquecidoEm: string | null;
  responsavelId: string | null;
  createdAt: string;
}

export const ESFERA_LABEL: Record<CrmEsfera, string> = {
  estadual: 'Estadual',
  federal: 'Federal',
  municipal: 'Municipal'
};

export const STATUS_ENRIQUECIMENTO_LABEL: Record<CrmStatusEnriquecimento, string> = {
  pendente: 'Pendente',
  processando: 'Processando',
  enriquecido: 'Enriquecido',
  sem_dado: 'Sem dado',
  erro: 'Erro'
};
