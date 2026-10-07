// Tipos e constantes do CRM jurídico — espelham o seed fixo de
// supabase/migrations/20261007110000_ap_crm_juridico_schema.sql (pipelines/etapas/departamentos
// não são editáveis pelo usuário final na v1; só os itens dentro deles são CRUD).

export type DepartamentoId = 'juridico' | 'financeiro' | 'comercial' | 'negociacao' | 'atendimento';

export type PipelineId =
  | 'andamento_processual'
  | 'trabalhista'
  | 'tributario'
  | 'vara_familiar'
  | 'criminal'
  | 'previdenciario'
  | 'processo_estrategico'
  | 'cobranca_financeiro'
  | 'relacionamento_cliente';

export interface CrmDepartamento {
  id: DepartamentoId;
  nome: string;
  ordem: number;
}

export interface CrmPipeline {
  id: PipelineId;
  nome: string;
  departamentoId: DepartamentoId;
  ordem: number;
  ativo: boolean;
}

export interface CrmEtapa {
  id: string;
  pipelineId: PipelineId;
  nome: string;
  ordem: number;
  cor: string | null;
  ehFinal: boolean;
}

export type SituacaoFinanceira = 'adimplente' | 'inadimplente';

export interface CrmItem {
  id: string;
  pipelineId: PipelineId;
  etapaId: string;
  processoId: string | null;
  titulo: string;
  clienteNome: string | null;
  clienteDocumento: string | null;
  advogadoResponsavelId: string | null;
  advogadoResponsavelNome?: string | null;
  uf: string | null;
  valorCausa: number | null;
  situacaoFinanceira: SituacaoFinanceira | null;
  camposExtra: Record<string, unknown>;
  criadoPor: string | null;
  createdAt: string;
  updatedAt: string;
  // Enriquecimento opcional quando processoId aponta para ap_processos (join feito pela API).
  diasSemMovimentacao?: number | null;
  ultimaMovimentacaoEm?: string | null;
}

export interface CrmItemHistoricoEntrada {
  id: string;
  itemId: string;
  etapaAnteriorId: string | null;
  etapaNovaId: string;
  movidoPor: string | null;
  movidoEm: string;
}

export const LABEL_SITUACAO_FINANCEIRA: Record<SituacaoFinanceira, string> = {
  adimplente: 'Adimplente',
  inadimplente: 'Inadimplente'
};

/** Limiar (em dias sem movimentação) a partir do qual um card é destacado como "atenção" no Kanban. */
export const LIMIAR_DIAS_ATENCAO = 31;

export function calcularDiasSemMovimentacao(ultimaMovimentacaoEm: string | null | undefined): number | null {
  if (!ultimaMovimentacaoEm) return null;
  const ultima = new Date(ultimaMovimentacaoEm).getTime();
  if (Number.isNaN(ultima)) return null;
  const diffMs = Date.now() - ultima;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}
