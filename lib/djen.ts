/**
 * DJEN — Diário de Justiça Eletrônico Nacional (Comunica PJe, comunicaapi.pje.jus.br). API pública do CNJ, sem chave
 * e sem custo, com as intimações/editais publicados pelos tribunais que aderiram ao diário nacional.
 *
 * Usada na busca pública da tela de login (prévia grátis por nome ou CNJ, no estilo Jusbrasil). Limites conhecidos:
 * - não busca por CPF/CNPJ, só por nome da parte, OAB ou número do processo;
 * - só aparece processo que teve publicação no DJEN (não é a lista completa, por isso é "prévia");
 * - `nomeParte` é busca aproximada ("JOSE DA SILVA SANTOS" traz "MARIA JOSE DA SILVA SANTOS"), então o filtro por nome
 *   exato é nosso;
 * - 100 itens por página e cerca de 20 requisições por janela (cabeçalho X-RateLimit-Limit) por IP do servidor.
 */

import { classifyTag } from '@/lib/classify';
import type { Movement } from '@/lib/mockProcesses';

const URL_BASE = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const TIMEOUT_MS = 12000;
const ITENS_POR_PAGINA = 100;
const PAUSA_APOS_429_MS = 60_000;
const MAX_TEXTO_MOVIMENTO = 1500;

// Ao tomar 429, para de chamar o DJEN nesta instância por um tempo: no cron, os processos seguintes ficam só com o
// DataJud em vez de enfileirar dezenas de 429 seguidos.
let pausadoAte = 0;

interface DestinatarioDjen {
  nome?: string;
  /** 'A' = polo ativo (autor/requerente), 'P' = polo passivo. */
  polo?: string;
}

interface ComunicacaoDjen {
  id?: number;
  data_disponibilizacao?: string;
  siglaTribunal?: string;
  texto?: string;
  tipoComunicacao?: string;
  nomeOrgao?: string;
  numero_processo?: string;
  numeroprocessocommascara?: string;
  nomeClasse?: string;
  link?: string;
  destinatarios?: DestinatarioDjen[];
}

interface RespostaDjen {
  status?: string;
  count?: number;
  items?: ComunicacaoDjen[];
}

/** Um processo da prévia, agregando as comunicações do DJEN que citam a parte. */
export interface ProcessoDjen {
  numeroCnj: string;
  numeroFormatado: string;
  tribunal: string;
  classe: string;
  orgao: string;
  ultimaPublicacao: string;
  tipoUltimaPublicacao: string;
  totalPublicacoes: number;
  /** Partes do polo ativo citadas nas publicações (para o usuário reconhecer o processo). */
  autores: string[];
  reus: string[];
}

/** O que a busca pública (sem login) mostra: partes, órgão e datas ficam para depois do login. */
export type ProcessoDjenPublico = Pick<ProcessoDjen, 'numeroCnj' | 'numeroFormatado' | 'tribunal' | 'classe' | 'totalPublicacoes'>;

export const paraPublico = ({ numeroCnj, numeroFormatado, tribunal, classe, totalPublicacoes }: ProcessoDjen): ProcessoDjenPublico => ({
  numeroCnj,
  numeroFormatado,
  tribunal,
  classe,
  totalPublicacoes
});

/**
 * Primeiro número CNJ dentro de um texto livre. Cobre o que chega dos formulários/CRM: "0401718-13,1997,8,26,0053",
 * " 0032517-31.2002.8.26.0053/30" (sufixo de incidente), dois números no mesmo campo.
 */
export function extrairNumeroCnj(texto: string): string | null {
  const comMascara = texto.match(/\d{7}\D?\d{2}\D?\d{4}\D?\d\D?\d{2}\D?\d{4}/);
  if (comMascara) return comMascara[0].replace(/\D/g, '');
  const digitos = texto.replace(/\D/g, '');
  return digitos.length === 20 ? digitos : null;
}

export class DjenIndisponivelError extends Error {}

/** Maiúsculas, sem acento e com espaços simples — o DJEN mistura "JOSÉ" e "JOSE" no mesmo nome. */
export function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function buscarPagina(params: Record<string, string>, pagina: number): Promise<RespostaDjen> {
  if (Date.now() < pausadoAte) throw new DjenIndisponivelError('DJEN em pausa após limite de requisições (429)');
  const qs = new URLSearchParams({ ...params, itensPorPagina: String(ITENS_POR_PAGINA), pagina: String(pagina) });
  let res: Response;
  try {
    res = await fetch(`${URL_BASE}?${qs}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store'
    });
  } catch (e) {
    throw new DjenIndisponivelError(`DJEN sem resposta: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 429) pausadoAte = Date.now() + PAUSA_APOS_429_MS;
  if (!res.ok) throw new DjenIndisponivelError(`DJEN respondeu HTTP ${res.status}`);
  const json = (await res.json().catch(() => null)) as RespostaDjen | null;
  if (!json || !Array.isArray(json.items)) {
    throw new DjenIndisponivelError(`DJEN com formato inesperado (chaves: ${json ? Object.keys(json).join(', ') : 'nenhuma'})`);
  }
  return json;
}

function agrupar(itens: ComunicacaoDjen[], filtro: (c: ComunicacaoDjen) => boolean): ProcessoDjen[] {
  const porProcesso = new Map<string, ProcessoDjen>();

  for (const c of itens) {
    const digitos = (c.numero_processo || c.numeroprocessocommascara || '').replace(/\D/g, '');
    if (digitos.length !== 20 || !filtro(c)) continue;

    const data = c.data_disponibilizacao || '';
    const atual = porProcesso.get(digitos);
    const destinatarios = c.destinatarios ?? [];
    const autores = destinatarios.filter(d => d.polo === 'A' && d.nome).map(d => d.nome!.trim());
    const reus = destinatarios.filter(d => d.polo === 'P' && d.nome).map(d => d.nome!.trim());

    if (!atual) {
      porProcesso.set(digitos, {
        numeroCnj: digitos,
        numeroFormatado: c.numeroprocessocommascara || digitos,
        tribunal: c.siglaTribunal || '',
        classe: (c.nomeClasse || '').toLocaleUpperCase('pt-BR'), // o DJEN manda "HOMOLOGAçãO"
        orgao: c.nomeOrgao || '',
        ultimaPublicacao: data,
        tipoUltimaPublicacao: c.tipoComunicacao || '',
        totalPublicacoes: 1,
        autores: [...new Set(autores)],
        reus: [...new Set(reus)]
      });
      continue;
    }

    atual.totalPublicacoes += 1;
    atual.autores = [...new Set([...atual.autores, ...autores])];
    atual.reus = [...new Set([...atual.reus, ...reus])];
    if (data > atual.ultimaPublicacao) {
      atual.ultimaPublicacao = data;
      atual.tipoUltimaPublicacao = c.tipoComunicacao || atual.tipoUltimaPublicacao;
      atual.orgao = c.nomeOrgao || atual.orgao;
    }
  }

  return [...porProcesso.values()].sort((a, b) => b.ultimaPublicacao.localeCompare(a.ultimaPublicacao));
}

/**
 * Processos em que `nome` aparece EXATAMENTE como parte do polo ativo (regra do produto: só processos em que o
 * pesquisado é autor). Lê até `maxPaginas` páginas: nomes comuns trazem milhares de comunicações aproximadas.
 */
export async function buscarProcessosPorNomeDjen(nome: string, maxPaginas = 3): Promise<ProcessoDjen[]> {
  const alvo = normalizarNome(nome);
  const itens: ComunicacaoDjen[] = [];

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const resp = await buscarPagina({ nomeParte: nome.trim() }, pagina);
    itens.push(...(resp.items ?? []));
    if ((resp.items?.length ?? 0) < ITENS_POR_PAGINA) break;
  }

  const processos = agrupar(itens, c =>
    (c.destinatarios ?? []).some(d => d.polo === 'A' && d.nome && normalizarNome(d.nome) === alvo)
  );

  if (itens.length > 0 && processos.length === 0) {
    console.warn(`[djen] ${itens.length} comunicações para "${alvo}", nenhuma com o nome exato no polo ativo`);
  }
  return processos;
}

async function comunicacoesDoProcesso(numeroCnj: string): Promise<ComunicacaoDjen[]> {
  const digitos = numeroCnj.replace(/\D/g, '');
  const resp = await buscarPagina({ numeroProcesso: digitos }, 1);
  return (resp.items ?? []).filter(c => (c.numero_processo || '').replace(/\D/g, '') === digitos);
}

/** Prévia de um processo pelo número CNJ (20 dígitos), para a busca pública. */
export async function buscarProcessoPorNumeroDjen(numeroCnj: string): Promise<ProcessoDjen | null> {
  return agrupar(await comunicacoesDoProcesso(numeroCnj), () => true)[0] ?? null;
}

/**
 * Intimações/editais do processo no formato de movimentação, para o cron de reconsulta. O DJEN publica no dia
 * (o DataJud atrasa dias ou semanas), então é o que dispara o alerta de prazo a tempo. Texto e data são estáveis
 * entre execuções, o que mantém o dedupe por hash do cron.
 */
export async function listarMovimentosDjen(numeroCnj: string): Promise<Movement[]> {
  return (await comunicacoesDoProcesso(numeroCnj))
    .filter(c => c.data_disponibilizacao)
    .map(c => {
      const texto = (c.texto || '').replace(/\s+/g, ' ').trim();
      const tipo = c.tipoComunicacao || 'Comunicação';
      return {
        data: c.data_disponibilizacao!,
        titulo: `${tipo} publicada no Diário de Justiça Nacional${c.nomeOrgao ? ` (${c.nomeOrgao})` : ''}`,
        descricao: texto.length > MAX_TEXTO_MOVIMENTO ? `${texto.slice(0, MAX_TEXTO_MOVIMENTO)}…` : texto || tipo,
        tag: classifyTag(`${tipo} ${texto}`)
      };
    });
}
