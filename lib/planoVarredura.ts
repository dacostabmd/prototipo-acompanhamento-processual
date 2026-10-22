import { ESTADOS_BRASIL, tribunalByUf } from '@/lib/ddd';

/**
 * Regras fixas para decidir por qual tribunal estadual a varredura por CPF/CNPJ/nome começa (1ª onda), na
 * ordem de confiança do sinal: estado escolhido à mão > endereço na Lemit > DDD do telefone > região fiscal
 * do CPF. O primeiro sinal cujo tribunal está entre as fontes selecionadas vence; os demais ficam só no
 * registro (ap_consulta_fontes) para medir, mais tarde, quanto cada sinal acerta de fato.
 */

/** 9º dígito do CPF -> UFs da região fiscal onde ele foi emitido (costuma ser onde a pessoa nasceu). */
export const UFS_POR_REGIAO_FISCAL: Record<string, string[]> = {
  '0': ['RS'],
  '1': ['DF', 'GO', 'MS', 'MT', 'TO'],
  '2': ['AC', 'AM', 'AP', 'PA', 'RO', 'RR'],
  '3': ['CE', 'MA', 'PI'],
  '4': ['AL', 'PB', 'PE', 'RN'],
  '5': ['BA', 'SE'],
  '6': ['MG'],
  '7': ['ES', 'RJ'],
  '8': ['SP'],
  '9': ['PR', 'SC']
};

const UFS_VALIDAS = new Set(ESTADOS_BRASIL.map(e => e.uf));

export function ufsDaRegiaoFiscal(cpf: string): string[] {
  const digitos = cpf.replace(/\D/g, '');
  return digitos.length === 11 ? UFS_POR_REGIAO_FISCAL[digitos[8]] ?? [] : [];
}

/** UF de um endereço da Lemit: campo uf/estado quando é objeto, ou a última sigla de UF no texto. */
function ufDoEndereco(endereco: unknown): string | null {
  if (typeof endereco === 'string') {
    const siglas = endereco.toUpperCase().match(/\b[A-Z]{2}\b/g)?.filter(s => UFS_VALIDAS.has(s)) ?? [];
    return siglas.at(-1) ?? null;
  }
  if (endereco && typeof endereco === 'object') {
    const obj = endereco as Record<string, unknown>;
    for (const chave of ['uf', 'estado', 'sigla_uf', 'sg_uf', 'UF']) {
      const v = typeof obj[chave] === 'string' ? (obj[chave] as string).trim().toUpperCase() : '';
      if (UFS_VALIDAS.has(v)) return v;
    }
    for (const v of Object.values(obj)) {
      const uf = typeof v === 'string' ? ufDoEndereco(v) : null;
      if (uf) return uf;
    }
  }
  return null;
}

/** UF do endereço mais recente devolvido pela Lemit (1º item de `enderecos`, ou `endereco`). */
export function ufDoEnderecoLemit(dados: unknown): string | null {
  const d = dados as { enderecos?: unknown; endereco?: unknown } | null | undefined;
  const lista = Array.isArray(d?.enderecos) ? d.enderecos : d?.endereco ? [d.endereco] : [];
  for (const e of lista) {
    const uf = ufDoEndereco(e);
    if (uf) return uf;
  }
  return null;
}

export interface SinaisUf {
  /** UF escolhida manualmente no Passo 4. */
  manualUf: string | null;
  lemitUf: string | null;
  dddTj: string | null;
  regiaoFiscalUfs: string[];
}

export type OrigemPrioridade = 'manual' | 'lemit' | 'ddd' | 'cpf';

export interface PrioridadeVarredura {
  /** Tribunais estaduais da 1ª onda (ex.: ['TJSP']); vazio = sem sinal útil, todos em paralelo. */
  tribunais: string[];
  origem: OrigemPrioridade | null;
  motivo: string;
}

/** Aplica as regras na ordem e devolve o primeiro sinal que aponta para um tribunal disponível. */
export function decidirPrioridade(sinais: SinaisUf, disponivel: (tj: string) => boolean): PrioridadeVarredura {
  const candidatos: { origem: OrigemPrioridade; tribunais: string[]; motivo: string }[] = [];
  if (sinais.manualUf) {
    candidatos.push({ origem: 'manual', tribunais: [tribunalByUf(sinais.manualUf)].filter(Boolean) as string[], motivo: `estado escolhido manualmente (${sinais.manualUf})` });
  }
  if (sinais.lemitUf) {
    candidatos.push({ origem: 'lemit', tribunais: [tribunalByUf(sinais.lemitUf)].filter(Boolean) as string[], motivo: `endereço mais recente na Lemit é em ${sinais.lemitUf}` });
  }
  if (sinais.dddTj) {
    candidatos.push({ origem: 'ddd', tribunais: [sinais.dddTj], motivo: `DDD do telefone informado é de ${sinais.dddTj.replace(/^TJ/, '')}` });
  }
  if (sinais.regiaoFiscalUfs.length > 0) {
    candidatos.push({
      origem: 'cpf',
      tribunais: sinais.regiaoFiscalUfs.map(tribunalByUf).filter(Boolean) as string[],
      motivo: `CPF emitido na região fiscal de ${sinais.regiaoFiscalUfs.join('/')}`
    });
  }

  const descartados: string[] = [];
  for (const c of candidatos) {
    const tribunais = c.tribunais.filter(disponivel);
    if (tribunais.length > 0) {
      const ressalva = descartados.length > 0 ? ` (${descartados.join('; ')}, sem busca por documento disponível)` : '';
      return { tribunais, origem: c.origem, motivo: `Começando por ${tribunais.join(', ')}: ${c.motivo}${ressalva}.` };
    }
    descartados.push(c.motivo);
  }
  return {
    tribunais: [],
    origem: null,
    motivo:
      descartados.length > 0
        ? `Nenhum sinal aponta para um tribunal selecionado (${descartados.join('; ')}): todos consultados em paralelo.`
        : 'Sem sinal de estado (Lemit, DDD ou região do CPF): todos os tribunais consultados em paralelo.'
  };
}
