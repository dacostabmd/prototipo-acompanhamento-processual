/**
 * Busca rápida de processos trabalhistas por CNPJ ou nome de empresa, sem custo por consulta.
 *
 * Por que assim: as CEATs da Infosimples (TRT1, por exemplo) só emitem a certidão e não listam processos, e o DataJud
 * não busca por parte. A saída gratuita é converter o CNPJ em razão social (BrasilAPI, dados públicos da Receita) e
 * buscar essa razão social no DJEN (Comunica PJe, CNJ), que publica as intimações dos TRTs.
 *
 * Limites (devem aparecer na tela):
 * - só aparece processo que teve publicação no DJEN dentro do período pesquisado (não é a lista completa);
 * - a busca é por nome, não por CNPJ: homônimos e variações de grafia ("S/A" x "S.A.") podem escapar ou sobrar;
 * - o DJEN limita a ~20 requisições por janela por IP, então a leitura é de poucas páginas por busca.
 */

import { buscarPublicacoesPorParteDjen, dataBrasil, normalizarNome, type PublicacaoDjen } from '@/lib/djen';

const URL_BRASILAPI_CNPJ = 'https://brasilapi.com.br/api/cnpj/v1';
const TIMEOUT_BRASILAPI_MS = 10_000;
const MAX_TEXTO_RESUMO = 280;

export class CnpjNaoEncontradoError extends Error {}
export class BrasilApiIndisponivelError extends Error {}

export interface EmpresaCnpj {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  municipio: string;
  uf: string;
  situacao: string;
}

/** Dados públicos do CNPJ na BrasilAPI (gratuita, sem chave). Só o CNPJ da empresa sai do servidor, nada do usuário. */
export async function consultarCnpjBrasilApi(cnpj: string): Promise<EmpresaCnpj> {
  let res: Response;
  try {
    res = await fetch(`${URL_BRASILAPI_CNPJ}/${cnpj}`, {
      // A BrasilAPI responde 403 a requisições sem User-Agent (verificado em 2026-11-10); nome genérico, sem dados do usuário.
      headers: { Accept: 'application/json', 'User-Agent': 'consulta-processual-client/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_BRASILAPI_MS),
      cache: 'no-store'
    });
  } catch (e) {
    throw new BrasilApiIndisponivelError(`BrasilAPI sem resposta: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 404 || res.status === 400) throw new CnpjNaoEncontradoError(`CNPJ ${cnpj} não encontrado na Receita (HTTP ${res.status})`);
  if (!res.ok) throw new BrasilApiIndisponivelError(`BrasilAPI respondeu HTTP ${res.status}`);

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const razaoSocial = texto(json?.razao_social);
  if (!json || !razaoSocial) {
    throw new BrasilApiIndisponivelError(`BrasilAPI com formato inesperado (chaves: ${json ? Object.keys(json).join(', ') : 'nenhuma'})`);
  }
  return {
    cnpj,
    razaoSocial,
    nomeFantasia: texto(json.nome_fantasia),
    municipio: texto(json.municipio),
    uf: texto(json.uf),
    situacao: texto(json.descricao_situacao_cadastral)
  };
}

/** 'indefinido' = a fonte (certidão por CNPJ) só informa o número do processo, sem o polo. */
export type PoloEmpresa = 'ativo' | 'passivo' | 'ambos' | 'indefinido';

export type OrigemProcessoTrabalhista = 'djen' | 'infosimples';

export interface ProcessoTrabalhista {
  numeroCnj: string;
  numeroFormatado: string;
  tribunal: string;
  classe: string;
  orgao: string;
  /** Como a empresa aparece nas publicações: reclamante (ativo), reclamada (passivo) ou os dois. */
  polo: PoloEmpresa;
  /**
   * 'exata' quando o nome da parte é igual ao pesquisado; 'semelhante' quando só o contém (grafia diferente, filial...);
   * 'documento' quando a fonte buscou pelo próprio CNPJ (certidão), sem ambiguidade de nome.
   */
  correspondencia: 'exata' | 'semelhante' | 'documento';
  origem: OrigemProcessoTrabalhista;
  ultimaPublicacao: string;
  tipoUltimaPublicacao: string;
  resumoUltimaPublicacao: string;
  totalPublicacoes: number;
  autores: string[];
  reus: string[];
}

export interface OpcoesTrabalhista {
  /** 1 a 24 restringe ao TRT; 'todos' lê qualquer TRT. */
  trt: number | 'todos';
  /** Janela de publicações, em dias contados de hoje. */
  dias: number;
  /** Mantém só processos em que a empresa aparece como autora (polo ativo). */
  somenteAutor: boolean;
}

export interface ResultadoTrabalhista {
  termo: string;
  processos: ProcessoTrabalhista[];
  totalPublicacoes: number;
  /** Havia mais páginas além do limite lido: publicações mais antigas do período ficaram de fora. */
  truncado: boolean;
  periodo: { inicio: string; fim: string };
  trt: number | 'todos';
}

const TRT_SIGLA = /^TRT\d{1,2}$/;

const semMarcacao = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Busca no DJEN os processos dos TRTs em que a empresa (pelo nome) aparece em qualquer polo, agrupados por processo.
 */
export async function buscarProcessosTrabalhistas(nome: string, opcoes: OpcoesTrabalhista): Promise<ResultadoTrabalhista> {
  const alvo = normalizarNome(nome);
  const periodo = { inicio: dataBrasil(-opcoes.dias), fim: dataBrasil() };
  const corresponde = (n: string) => normalizarNome(n).includes(alvo);

  const { publicacoes, truncado } = await buscarPublicacoesPorParteDjen(nome, periodo, {
    siglaTribunal: opcoes.trt === 'todos' ? undefined : `TRT${opcoes.trt}`,
    aceitaNome: corresponde,
    // Sem TRT escolhido o DJEN devolve também TJs/TRFs: ficam só os tribunais do trabalho.
    aceitaTribunal: opcoes.trt === 'todos' ? sigla => TRT_SIGLA.test(sigla) : undefined
  });

  // `publicacoes` vem da mais nova para a mais antiga: a primeira de cada processo é a última publicação dele.
  const porProcesso = new Map<string, ProcessoTrabalhista>();
  const polos = new Map<string, { ativo: boolean; passivo: boolean; exata: boolean }>();

  const marcar = (pub: PublicacaoDjen) => {
    const ativo = pub.autores.filter(corresponde);
    const passivo = pub.reus.filter(corresponde);
    const atual = polos.get(pub.numeroCnj) ?? { ativo: false, passivo: false, exata: false };
    atual.ativo ||= ativo.length > 0;
    atual.passivo ||= passivo.length > 0;
    atual.exata ||= [...ativo, ...passivo].some(n => normalizarNome(n) === alvo);
    polos.set(pub.numeroCnj, atual);
  };

  for (const pub of publicacoes) {
    if (!pub.numeroCnj) continue;
    marcar(pub);
    const existente = porProcesso.get(pub.numeroCnj);
    if (existente) {
      existente.totalPublicacoes += 1;
      existente.autores = [...new Set([...existente.autores, ...pub.autores])];
      existente.reus = [...new Set([...existente.reus, ...pub.reus])];
      continue;
    }
    const resumo = semMarcacao(pub.texto);
    porProcesso.set(pub.numeroCnj, {
      numeroCnj: pub.numeroCnj,
      numeroFormatado: pub.numeroFormatado,
      tribunal: pub.tribunal,
      classe: pub.classe,
      orgao: pub.orgao,
      polo: 'passivo',
      correspondencia: 'semelhante',
      origem: 'djen',
      ultimaPublicacao: pub.dataDisponibilizacao,
      tipoUltimaPublicacao: pub.tipoComunicacao,
      resumoUltimaPublicacao: resumo.length > MAX_TEXTO_RESUMO ? `${resumo.slice(0, MAX_TEXTO_RESUMO)}…` : resumo,
      totalPublicacoes: 1,
      autores: pub.autores,
      reus: pub.reus
    });
  }

  let processos = [...porProcesso.values()].map(p => {
    const marca = polos.get(p.numeroCnj)!;
    return {
      ...p,
      polo: (marca.ativo && marca.passivo ? 'ambos' : marca.ativo ? 'ativo' : 'passivo') as PoloEmpresa,
      correspondencia: (marca.exata ? 'exata' : 'semelhante') as ProcessoTrabalhista['correspondencia']
    };
  });
  if (opcoes.somenteAutor) processos = processos.filter(p => p.polo !== 'passivo');

  // Exatos primeiro, depois pela publicação mais recente.
  processos.sort(
    (a, b) =>
      Number(b.correspondencia === 'exata') - Number(a.correspondencia === 'exata') ||
      b.ultimaPublicacao.localeCompare(a.ultimaPublicacao)
  );

  return { termo: nome.trim(), processos, totalPublicacoes: publicacoes.length, truncado, periodo, trt: opcoes.trt };
}
