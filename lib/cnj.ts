import { cleanDigits } from './format';

export interface CnjInfo {
  numeroLimpo: string;
  numeroFormatado: string;
  sequencial: string;
  digitoVerificador: string;
  ano: string;
  ramoJustica: string;
  ramoDescricao: string;
  tribunalCodigo: string;
  tribunalLabel: string;
  tribunalNome: string;
  datajudAlias: string;
  orgaoOrigem: string;
  valido: boolean;
}

/**
 * Máscara padrão CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos).
 */
export function formatProcessNumber(value: string): string {
  const d = cleanDigits(value).slice(0, 20);
  if (d.length > 16) {
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
  }
  if (d.length > 14) {
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}`;
  }
  if (d.length > 13) {
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}`;
  }
  if (d.length > 9) {
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}`;
  }
  if (d.length > 7) {
    return `${d.slice(0, 7)}-${d.slice(7, 9)}`;
  }
  return d;
}

// Mapeamento dos Tribunais de Justiça Estaduais (J = 8). O código TR de 2 dígitos é o mesmo usado
// pelos TREs (J = 6) e pela Justiça Militar estadual (J = 9).
export const TRIBUNAIS_ESTADUAIS: Record<string, { label: string; nome: string; alias: string }> = {
  '01': { label: 'TJAC', nome: 'Tribunal de Justiça do Acre', alias: 'tjac' },
  '02': { label: 'TJAL', nome: 'Tribunal de Justiça de Alagoas', alias: 'tjal' },
  '03': { label: 'TJAP', nome: 'Tribunal de Justiça do Amapá', alias: 'tjap' },
  '04': { label: 'TJAM', nome: 'Tribunal de Justiça do Amazonas', alias: 'tjam' },
  '05': { label: 'TJBA', nome: 'Tribunal de Justiça da Bahia', alias: 'tjba' },
  '06': { label: 'TJCE', nome: 'Tribunal de Justiça do Ceará', alias: 'tjce' },
  '07': { label: 'TJDFT', nome: 'Tribunal de Justiça do DF e Territórios', alias: 'tjdft' },
  '08': { label: 'TJES', nome: 'Tribunal de Justiça do Espírito Santo', alias: 'tjes' },
  '09': { label: 'TJGO', nome: 'Tribunal de Justiça de Goiás', alias: 'tjgo' },
  '10': { label: 'TJMA', nome: 'Tribunal de Justiça do Maranhão', alias: 'tjma' },
  '11': { label: 'TJMT', nome: 'Tribunal de Justiça de Mato Grosso', alias: 'tjmt' },
  '12': { label: 'TJMS', nome: 'Tribunal de Justiça de Mato Grosso do Sul', alias: 'tjms' },
  '13': { label: 'TJMG', nome: 'Tribunal de Justiça de Minas Gerais', alias: 'tjmg' },
  '14': { label: 'TJPA', nome: 'Tribunal de Justiça do Pará', alias: 'tjpa' },
  '15': { label: 'TJPB', nome: 'Tribunal de Justiça da Paraíba', alias: 'tjpb' },
  '16': { label: 'TJPR', nome: 'Tribunal de Justiça do Paraná', alias: 'tjpr' },
  '17': { label: 'TJPE', nome: 'Tribunal de Justiça de Pernambuco', alias: 'tjpe' },
  '18': { label: 'TJPI', nome: 'Tribunal de Justiça do Piauí', alias: 'tjpi' },
  '19': { label: 'TJRJ', nome: 'Tribunal de Justiça do Rio de Janeiro', alias: 'tjrj' },
  '20': { label: 'TJRN', nome: 'Tribunal de Justiça do Rio Grande do Norte', alias: 'tjrn' },
  '21': { label: 'TJRS', nome: 'Tribunal de Justiça do Rio Grande do Sul', alias: 'tjrs' },
  '22': { label: 'TJRO', nome: 'Tribunal de Justiça de Rondônia', alias: 'tjro' },
  '23': { label: 'TJRR', nome: 'Tribunal de Justiça de Roraima', alias: 'tjrr' },
  '24': { label: 'TJSC', nome: 'Tribunal de Justiça de Santa Catarina', alias: 'tjsc' },
  '25': { label: 'TJSE', nome: 'Tribunal de Justiça de Sergipe', alias: 'tjse' },
  '26': { label: 'TJSP', nome: 'Tribunal de Justiça de São Paulo', alias: 'tjsp' },
  '27': { label: 'TJTO', nome: 'Tribunal de Justiça do Tocantins', alias: 'tjto' }
};

// Justiça Militar estadual (J = 9): só 3 estados têm tribunal próprio (aliases confirmados na lista
// oficial de endpoints do DataJud: tjmmg, tjmrs, tjmsp).
export const TRIBUNAIS_MILITARES_ESTADUAIS: Record<string, { label: string; nome: string; alias: string }> = {
  '13': { label: 'TJMMG', nome: 'Tribunal de Justiça Militar de Minas Gerais', alias: 'tjmmg' },
  '21': { label: 'TJMRS', nome: 'Tribunal de Justiça Militar do Rio Grande do Sul', alias: 'tjmrs' },
  '26': { label: 'TJMSP', nome: 'Tribunal de Justiça Militar de São Paulo', alias: 'tjmsp' }
};

/** Sufixo de UF de um alias de TJ (tjsp -> sp, tjdft -> dft), usado no alias dos TREs (tre-sp, tre-dft). */
export const ufDoAliasTj = (alias: string): string => alias.slice(2);

// Mapeamento dos Tribunais Regionais Federais (J = 4)
export const TRIBUNAIS_FEDERAIS: Record<string, { label: string; nome: string; alias: string }> = {
  '01': { label: 'TRF1', nome: 'Tribunal Regional Federal da 1ª Região', alias: 'trf1' },
  '02': { label: 'TRF2', nome: 'Tribunal Regional Federal da 2ª Região', alias: 'trf2' },
  '03': { label: 'TRF3', nome: 'Tribunal Regional Federal da 3ª Região', alias: 'trf3' },
  '04': { label: 'TRF4', nome: 'Tribunal Regional Federal da 4ª Região', alias: 'trf4' },
  '05': { label: 'TRF5', nome: 'Tribunal Regional Federal da 5ª Região', alias: 'trf5' },
  '06': { label: 'TRF6', nome: 'Tribunal Regional Federal da 6ª Região', alias: 'trf6' }
};

/**
 * Faz o parsing estruturado de um número CNJ (20 dígitos).
 * Identifica automaticamente o ramo da justiça, o tribunal de origem e o alias correspondente para o DataJud.
 */
export function parseCnj(cnjOrDigits: string): CnjInfo | null {
  const d = cleanDigits(cnjOrDigits);
  if (d.length !== 20) return null;

  const sequencial = d.slice(0, 7);
  const digitoVerificador = d.slice(7, 9);
  const ano = d.slice(9, 13);
  const ramoJustica = d.slice(13, 14);
  const tribunalCodigo = d.slice(14, 16);
  const orgaoOrigem = d.slice(16, 20);

  let ramoDescricao = 'Justiça Desconhecida';
  let tribunalLabel = 'Tribunal';
  let tribunalNome = 'Tribunal não identificado';
  let datajudAlias = '';
  let valido = false;

  switch (ramoJustica) {
    case '8': {
      ramoDescricao = 'Justiça Estadual';
      const tj = TRIBUNAIS_ESTADUAIS[tribunalCodigo];
      if (tj) {
        tribunalLabel = tj.label;
        tribunalNome = tj.nome;
        datajudAlias = tj.alias;
        valido = true;
      }
      break;
    }
    case '4': {
      ramoDescricao = 'Justiça Federal';
      const trf = TRIBUNAIS_FEDERAIS[tribunalCodigo];
      if (trf) {
        tribunalLabel = trf.label;
        tribunalNome = trf.nome;
        datajudAlias = trf.alias;
        valido = true;
      }
      break;
    }
    case '5': {
      ramoDescricao = 'Justiça do Trabalho';
      if (tribunalCodigo === '00') {
        tribunalLabel = 'TST';
        tribunalNome = 'Tribunal Superior do Trabalho';
        datajudAlias = 'tst';
        valido = true;
      } else {
        const numTrt = parseInt(tribunalCodigo, 10);
        if (numTrt >= 1 && numTrt <= 24) {
          tribunalLabel = `TRT${numTrt}`;
          tribunalNome = `Tribunal Regional do Trabalho da ${numTrt}ª Região`;
          datajudAlias = `trt${numTrt}`;
          valido = true;
        }
      }
      break;
    }
    // STF e CNJ são ramos válidos do número CNJ, mas não têm endpoint na API pública do DataJud
    // (lista oficial): o alias fica vazio e a busca por número os trata como "sem fonte".
    case '1': {
      ramoDescricao = 'Supremo Tribunal Federal';
      tribunalLabel = 'STF';
      tribunalNome = 'Supremo Tribunal Federal';
      valido = true;
      break;
    }
    case '2': {
      ramoDescricao = 'Conselho Nacional de Justiça';
      tribunalLabel = 'CNJ';
      tribunalNome = 'Conselho Nacional de Justiça';
      valido = true;
      break;
    }
    case '3': {
      ramoDescricao = 'Superior Tribunal de Justiça';
      tribunalLabel = 'STJ';
      tribunalNome = 'Superior Tribunal de Justiça';
      datajudAlias = 'stj';
      valido = true;
      break;
    }
    case '6': {
      ramoDescricao = 'Justiça Eleitoral';
      if (tribunalCodigo === '00') {
        tribunalLabel = 'TSE';
        tribunalNome = 'Tribunal Superior Eleitoral';
        datajudAlias = 'tse';
        valido = true;
      } else {
        // O alias do TRE usa a UF (tre-sp), não o código numérico do número CNJ.
        const tj = TRIBUNAIS_ESTADUAIS[tribunalCodigo];
        if (tj) {
          const uf = ufDoAliasTj(tj.alias);
          tribunalLabel = `TRE-${uf.toUpperCase()}`;
          tribunalNome = `Tribunal Regional Eleitoral (${uf.toUpperCase()})`;
          datajudAlias = `tre-${uf}`;
          valido = true;
        }
      }
      break;
    }
    case '7': {
      ramoDescricao = 'Justiça Militar da União';
      tribunalLabel = 'STM';
      tribunalNome = 'Superior Tribunal Militar';
      datajudAlias = 'stm';
      valido = true;
      break;
    }
    case '9': {
      ramoDescricao = 'Justiça Militar Estadual';
      const tjm = TRIBUNAIS_MILITARES_ESTADUAIS[tribunalCodigo];
      if (tjm) {
        tribunalLabel = tjm.label;
        tribunalNome = tjm.nome;
        datajudAlias = tjm.alias;
        valido = true;
      }
      break;
    }
    default:
      valido = false;
  }

  return {
    numeroLimpo: d,
    numeroFormatado: formatProcessNumber(d),
    sequencial,
    digitoVerificador,
    ano,
    ramoJustica,
    ramoDescricao,
    tribunalCodigo,
    tribunalLabel,
    tribunalNome,
    datajudAlias,
    orgaoOrigem,
    valido
  };
}
