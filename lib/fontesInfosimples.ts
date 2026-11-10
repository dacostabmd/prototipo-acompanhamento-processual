import type { GrupoFonte } from './fontesDatajud';

/**
 * Catálogo dos serviços de CONSULTA PROCESSUAL da Infosimples (API paga, raspagem dos portais dos
 * tribunais). Fonte única usada pelo servidor (app/api/processos/route.ts) e pelo Passo 2 do stepper.
 *
 * Levantado em 2026-10-06 nas páginas públicas infosimples.com/consultas e /consultas/precos
 * (atualizada em 02/10/2026): das 104 páginas de tribunal, só estas são consulta processual de fato.
 * As demais são certidões (ex.: tjba/primeiro-grau e tjrs/primeiro-grau, usados antes por engano) e
 * não entram aqui. Não há serviço processual da Infosimples para os TJs dos demais estados, STF, STJ,
 * TRF4 e TRT23 (que só tem a certidão CEAT, usada na busca por CPF/CNPJ).
 *
 * `params` guarda o NOME EXATO do parâmetro da API para cada tipo de busca aceito — não é uniforme
 * entre serviços (ex.: o número do processo é "processo" em uns e "numero_processo" em outros; o nome
 * da parte é "parte", "nome_parte", "nome" ou "parte_advogado"). A ausência de um tipo significa que o
 * serviço não aceita aquela busca e ele não é consultado nela. As páginas públicas não dizem quais
 * parâmetros são obrigatórios, nem os valores aceitos de "grau" (TRTs).
 */
export type TipoBusca = 'cpf' | 'cnpj' | 'numero' | 'nome';

export interface FonteInfosimples {
  /** Identificador curto e único (também é o label do progresso e da seleção). */
  id: string;
  service: string;
  nome: string;
  grupo: GrupoFonte;
  params: Partial<Record<TipoBusca, string>>;
  /** Parâmetros fixos exigidos pelo serviço em certos tipos de busca (ex.: `origem` no portal do TJRJ). */
  fixos?: Partial<Record<TipoBusca, Record<string, string>>>;
  /** Adicional fixo (R$) cobrado por consulta neste serviço, somado ao preço base. */
  adicional: number;
  /** Habilitada por padrão no Passo 2 (as fontes principais). */
  principal: boolean;
  /** Alias do endpoint do DataJud do mesmo tribunal, quando existe um só. */
  datajud?: string;
  /**
   * Preenchido quando o serviço NÃO está contratado no token da conta (a Infosimples responde 603
   * "Consulta não habilitada"). Ele sai do catálogo ativo — não aparece no Passo 2 nem é consultado —
   * até a habilitação; depois disso, basta apagar este campo.
   */
  naoHabilitada?: string;
}

type Params = FonteInfosimples['params'];

/** Serviço que aceita CPF, CNPJ, número e nome — a combinação mais comum. */
const completo = (numero: string, nome: string): Params => ({ cpf: 'cpf', cnpj: 'cnpj', numero, nome });

/** TRTs com serviço de consulta processual (`tribunal/trtN/processo`, só por número). O TRT23 não tem. */
const TRT_REGIOES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24];

/**
 * TRTs com Certidão Eletrônica de Ações Trabalhistas (CEAT): a única forma de buscar a Justiça do Trabalho por
 * CPF/CNPJ (a consulta processual dos TRTs só aceita número). Levantado em 2026-11-10 nas páginas de
 * infosimples.com/consultas e no catálogo de serviços. `service` foge do padrão `trtN/ceat` no TRT6
 * (`trt6/certidao`). Sem CEAT: TRT22. Fora do catálogo de propósito:
 * - TRT18 (`trt18/ceat`): exige também `nome_requerente` e `cpf_requerente` (dados de quem pede a certidão).
 * O parâmetro `nome` (quando existe) não é enviado: a busca por documento é exata e o nome só traria homônimos.
 */
const TRT_CEAT: { n: number; service?: string }[] = [
  { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6, service: 'tribunal/trt6/certidao' }, { n: 7 }, { n: 8 },
  { n: 9 }, { n: 10 }, { n: 11 }, { n: 12 }, { n: 13 }, { n: 14 }, { n: 15 }, { n: 16 }, { n: 17 }, { n: 19 },
  { n: 20 }, { n: 21 }, { n: 23 }, { n: 24 }
];

/** CEAT de processos digitais, serviço à parte nos TRTs 2, 7 e 10 (o `ceat` simples cobre os processos físicos). */
const TRT_CEAT_DIGITAL: { n: number; params: Params }[] = [
  // No TRT2 digital o CNPJ vai só pela raiz (8 primeiros dígitos): `resolverAlvos` faz o corte.
  { n: 2, params: { cpf: 'cpf', cnpj: 'cnpj_raiz' } },
  { n: 7, params: { cpf: 'cpf', cnpj: 'cnpj' } },
  { n: 10, params: { cpf: 'cpf', cnpj: 'cnpj' } }
];

const CATALOGO_INFOSIMPLES: FonteInfosimples[] = [
  // ── Justiça Estadual ──
  { id: 'TJSP', service: 'tribunal/tjsp/primeiro-grau', nome: 'TJSP — 1º grau (e-SAJ)', grupo: 'Justiça Estadual', params: completo('processo', 'parte'), adicional: 0, principal: true, datajud: 'tjsp' },
  { id: 'TJSP (2º grau)', service: 'tribunal/tjsp/segundo-grau', nome: 'TJSP — 2º grau (e-SAJ)', grupo: 'Justiça Estadual', params: completo('numero_processo', 'nome_parte'), adicional: 0, principal: true, datajud: 'tjsp' },
  { id: 'TJSP (Colégio Recursal)', service: 'tribunal/tjsp/colegio-recursal', nome: 'TJSP — Colégio Recursal (juizados)', grupo: 'Justiça Estadual', params: { cpf: 'cpf', numero: 'numero_processo', nome: 'nome_parte' }, adicional: 0, principal: false, datajud: 'tjsp' },
  { id: 'TJSP (eproc)', service: 'tribunal/tjsp/eproc-lista', nome: 'TJSP — eproc (lista)', grupo: 'Justiça Estadual', params: { cpf: 'cpf', cnpj: 'cnpj', nome: 'nome_parte' }, adicional: 0.04, principal: true, datajud: 'tjsp' },
  { id: 'TJSP (eproc unificada)', service: 'tribunal/tjsp/eproc-unificada', nome: 'TJSP — eproc, consulta unificada por número', grupo: 'Justiça Estadual', params: { numero: 'numero_processo' }, adicional: 0.04, principal: false, datajud: 'tjsp' },
  { id: 'TJRJ', service: 'tribunal/tjrj/processo-eproc', nome: 'TJRJ — eproc', grupo: 'Justiça Estadual', params: completo('numero_processo', 'nome'), adicional: 0.04, principal: true, datajud: 'tjrj' },
  { id: 'TJRJ (portal)', service: 'tribunal/tjrj/processo', nome: 'TJRJ — portal de consulta processual', grupo: 'Justiça Estadual', params: { cpf: 'cpf', cnpj: 'cnpj', numero: 'numero_processo' }, fixos: { cpf: { origem: '2' }, cnpj: { origem: '2' } }, adicional: 0.04, principal: true, datajud: 'tjrj' },
  { id: 'TJMG', service: 'tribunal/tjmg/processo', nome: 'TJMG — PJe', grupo: 'Justiça Estadual', params: completo('numero_processo', 'nome_parte'), adicional: 0, principal: true, datajud: 'tjmg' },
  { id: 'TJPR', service: 'tribunal/tjpr/processo', nome: 'TJPR — Projudi', grupo: 'Justiça Estadual', params: completo('numero_processo', 'nome_parte'), adicional: 0.04, principal: true, datajud: 'tjpr' },
  { id: 'TJSC', service: 'tribunal/tjsc/processo', nome: 'TJSC — eproc', grupo: 'Justiça Estadual', params: completo('numero_processo', 'nome'), adicional: 0.04, principal: true, datajud: 'tjsc' },

  // ── Justiça Federal ──
  { id: 'TRF1', service: 'tribunal/trf1/processo', nome: 'TRF1', grupo: 'Justiça Federal', params: completo('processo', 'parte'), adicional: 0.04, principal: true, datajud: 'trf1' },
  { id: 'TRF2', service: 'tribunal/trf2/processo', nome: 'TRF2 — Balcão Virtual', grupo: 'Justiça Federal', params: completo('numero_processo', 'nome_parte'), adicional: 0.04, principal: true, datajud: 'trf2' },
  { id: 'TRF2 (eproc)', service: 'tribunal/trf2/processo-eproc', nome: 'TRF2 — eproc', grupo: 'Justiça Federal', params: completo('numero_processo', 'nome_parte'), adicional: 0.04, principal: true, datajud: 'trf2' },
  { id: 'TRF3', service: 'tribunal/trf3/consulta-publica', nome: 'TRF3 — PJe, consulta pública', grupo: 'Justiça Federal', params: completo('numero_processo', 'nome_parte'), adicional: 0, principal: true, datajud: 'trf3' },
  { id: 'TRF3 (web)', service: 'tribunal/trf3/processo', nome: 'TRF3 — consulta processual web', grupo: 'Justiça Federal', params: completo('numero_processo', 'nome_parte'), adicional: 0.04, principal: false, datajud: 'trf3' },
  // No TRF5 o parâmetro de nome busca a pessoa como parte OU como advogado.
  { id: 'TRF5', service: 'tribunal/trf5/processo', nome: 'TRF5', grupo: 'Justiça Federal', params: completo('processo', 'parte_advogado'), adicional: 0, principal: true, datajud: 'trf5' },
  { id: 'TRF6', service: 'tribunal/trf6/processo', nome: 'TRF6 — PJe', grupo: 'Justiça Federal', params: completo('numero_processo', 'nome_parte'), adicional: 0, principal: true, datajud: 'trf6' },

  // ── Justiça do Trabalho: consulta processual só por número (o parâmetro opcional "grau" não é enviado) ──
  ...TRT_REGIOES.map<FonteInfosimples>(n => ({
    id: `TRT${n}`,
    service: `tribunal/trt${n}/processo`,
    nome: `TRT${n} — PJe consulta processual`,
    grupo: 'Justiça do Trabalho',
    params: { numero: 'numero_processo' },
    adicional: 0,
    principal: false,
    datajud: `trt${n}`
  })),

  // ── Justiça do Trabalho por CPF/CNPJ: certidão de ações trabalhistas (lista os números dos processos) ──
  ...TRT_CEAT.map<FonteInfosimples>(({ n, service }) => ({
    id: `TRT${n} (CEAT)`,
    service: service ?? `tribunal/trt${n}/ceat`,
    nome: `TRT${n} — certidão de ações trabalhistas${n === 2 ? ' (processos físicos)' : ''}`,
    grupo: 'Justiça do Trabalho',
    params: { cpf: 'cpf', cnpj: 'cnpj' },
    adicional: 0,
    principal: true,
    datajud: `trt${n}`
  })),
  ...TRT_CEAT_DIGITAL.map<FonteInfosimples>(({ n, params }) => ({
    id: `TRT${n} (CEAT digital)`,
    service: `tribunal/trt${n}/ceat-digital`,
    nome: `TRT${n} — certidão de ações trabalhistas (processos digitais)`,
    grupo: 'Justiça do Trabalho',
    params,
    adicional: 0,
    principal: true,
    datajud: `trt${n}`
  })),

  // ── Justiça Eleitoral: um serviço unificado cobre o TSE, os TREs e os cartórios eleitorais ──
  { id: 'TSE/TREs (PJe)', service: 'tribunal/tse/pje', nome: 'TSE, TREs e cartórios eleitorais — PJe unificado', grupo: 'Justiça Eleitoral', params: completo('numero_processo', 'nome_parte'), adicional: 0.06, principal: false, naoHabilitada: 'Não contratado no token da conta (código 603, verificado em 06/10/2026).' }
];

/** Catálogo ativo: só os serviços que o token da conta consegue consultar. */
export const FONTES_INFOSIMPLES: FonteInfosimples[] = CATALOGO_INFOSIMPLES.filter(f => !f.naoHabilitada);

export const FONTE_INFOSIMPLES_POR_ID = new Map(FONTES_INFOSIMPLES.map(f => [f.id, f]));

/** Fontes que aceitam o tipo de busca informado. */
export function fontesInfosimplesPara(tipo: TipoBusca): FonteInfosimples[] {
  return FONTES_INFOSIMPLES.filter(f => f.params[tipo]);
}

/** Ids das fontes habilitadas por padrão (as principais). */
export const IDS_PRINCIPAIS_INFOSIMPLES: string[] = FONTES_INFOSIMPLES.filter(f => f.principal).map(f => f.id);
