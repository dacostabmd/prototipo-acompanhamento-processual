export type MovementTag = 'urgente' | 'andamento' | 'informativo' | 'positivo';

export interface Movement {
  data: string;
  titulo: string;
  descricao: string;
  tag: MovementTag;
}

export interface LegalProcess {
  numero: string;
  tribunal: string;
  tipo: string;
  parteContraria: string;
  valorCausa: string;
  distribuicao: string;
  movimentos: Movement[];
}

export interface TimelineItem {
  id: string;
  date: string;
  titulo: string;
  descricao: string;
  tag: MovementTag;
  expanded: boolean;
  processo: Omit<LegalProcess, 'movimentos'>;
}

export interface CaseData {
  processes: LegalProcess[];
  timeline: TimelineItem[];
  totalProcessos: number;
}

export const TAG_META: Record<MovementTag, { label: string; color: string }> = {
  urgente: { label: 'URGENTE', color: '#8a3a3a' },
  andamento: { label: 'EM ANDAMENTO', color: '#3a6b8a' },
  informativo: { label: 'INFORMATIVO', color: '#4a5a6a' },
  positivo: { label: 'FAVORÁVEL', color: '#4a7a5c' }
};

/**
 * Dados mockados de protótipo. Na implementação real, substituir por
 * consulta à API da Infosimples (processos por CPF/CNPJ) — ver README.
 */
export const PROCESS_TEMPLATES: LegalProcess[] = [
  {
    numero: '0812345-67.2023.8.19.0001',
    tribunal: 'TJRJ · 4ª Vara Cível de Barra da Tijuca',
    tipo: 'Execução de Título Extrajudicial',
    parteContraria: 'Banco Confiança S.A.',
    valorCausa: 'R$ 84.320,00',
    distribuicao: '14/03/2023',
    movimentos: [
      {
        data: '2026-08-22',
        titulo: 'Penhora de valores em conta corrente determinada',
        descricao:
          'O juízo determinou penhora via sistema Sisbajud sobre valores encontrados em contas do executado, no limite do débito atualizado.',
        tag: 'urgente'
      },
      {
        data: '2026-06-10',
        titulo: 'Réplica à impugnação apresentada',
        descricao:
          'A parte autora apresentou réplica refutando os argumentos de excesso de execução alegados pela defesa.',
        tag: 'andamento'
      },
      {
        data: '2025-11-02',
        titulo: 'Citação do executado realizada',
        descricao:
          'O executado foi citado por oficial de justiça para pagamento ou apresentação de bens à penhora no prazo legal.',
        tag: 'informativo'
      }
    ]
  },
  {
    numero: '0045678-90.2024.8.19.0209',
    tribunal: 'TJRJ · 2ª Vara Empresarial',
    tipo: 'Ação Revisional de Contrato Bancário',
    parteContraria: 'Financeira Horizonte Crédito Ltda.',
    valorCausa: 'R$ 132.900,00',
    distribuicao: '02/07/2024',
    movimentos: [
      {
        data: '2026-07-30',
        titulo: 'Perícia contábil deferida',
        descricao:
          'O juízo deferiu produção de prova pericial contábil para apurar eventual cobrança de juros acima da taxa média de mercado.',
        tag: 'andamento'
      },
      {
        data: '2026-02-18',
        titulo: 'Audiência de conciliação designada',
        descricao: 'Audiência marcada para tentativa de acordo antes da fase instrutória.',
        tag: 'informativo'
      }
    ]
  },
  {
    numero: '0509876-12.2025.8.19.0001',
    tribunal: 'TJRJ · Central de Execuções Fiscais',
    tipo: 'Cobrança Indevida — Reconhecimento de Inexigibilidade',
    parteContraria: 'Recupera Crédito Serviços Financeiros S.A.',
    valorCausa: 'R$ 27.450,00',
    distribuicao: '19/01/2025',
    movimentos: [
      {
        data: '2026-08-05',
        titulo: 'Sentença de improcedência da cobrança publicada',
        descricao:
          'O juízo reconheceu a inexigibilidade do débito cobrado e determinou a baixa de eventuais restrições.',
        tag: 'positivo'
      },
      {
        data: '2025-09-14',
        titulo: 'Manifestação sobre provas apresentada',
        descricao: 'A parte ré apresentou documentos comprovando a origem do débito contestado.',
        tag: 'informativo'
      }
    ]
  }
];

/** Achata os movimentos de uma lista de processos em uma timeline ordenada (mais recente primeiro). */
export const buildCaseDataFromProcesses = (processes: LegalProcess[]): CaseData => {
  const items: TimelineItem[] = [];
  processes.forEach((proc, pIdx) => {
    proc.movimentos.forEach((mov, mIdx) => {
      items.push({
        id: `${pIdx}-${mIdx}`,
        date: mov.data,
        titulo: mov.titulo,
        descricao: mov.descricao,
        tag: mov.tag,
        expanded: false,
        processo: {
          numero: proc.numero,
          tribunal: proc.tribunal,
          tipo: proc.tipo,
          parteContraria: proc.parteContraria,
          valorCausa: proc.valorCausa,
          distribuicao: proc.distribuicao
        }
      });
    });
  });
  items.sort((a, b) => b.date.localeCompare(a.date));
  return { processes, timeline: items, totalProcessos: processes.length };
};

/** Dados mockados para testes quando não houver retorno da API. */
export const buildCaseData = (): CaseData => buildCaseDataFromProcesses(PROCESS_TEMPLATES);

