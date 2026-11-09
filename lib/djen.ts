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

/** Advogado citado na comunicação (campo `destinatarioadvogados[].advogado`). */
interface AdvogadoDjen {
  advogado?: { nome?: string; numero_oab?: string; uf_oab?: string };
}

export interface ComunicacaoDjen {
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
  destinatarioadvogados?: AdvogadoDjen[];
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

/* -------------------------------------------------------------------------------------------------------------
 * Monitoramento do Diário (OAB, nome ou termo). Verificado na API real em 2026-11-09 (sem chave):
 *
 * - `numeroOab` + `ufOab`: busca exata por advogado (ex.: numeroOab=228729&ufOab=SP). Sem `ufOab`, o número casa
 *   com qualquer UF (228729/MG e 228729/SP juntos), por isso a UF é obrigatória no nosso cadastro e ainda
 *   conferimos localmente. Traz os DOIS polos (o advogado aparece em `destinatarioadvogados`).
 * - Advogados vêm em `destinatarioadvogados[].advogado = { nome, numero_oab, uf_oab }` (campo separado de
 *   `destinatarios`, que só lista as partes com `polo` A/P). O texto também traz "ADV: NOME (OAB 123/SP)".
 * - `nomeAdvogado`: busca aproximada por palavras ("Carlos Pereira Barbosa" casa com "Luis Carlos Pereira Barbosa
 *   Junior"); não é usado no produto (nome vira nomeParte) mas existe.
 * - `nomeParte`: busca aproximada pelo nome da parte; o filtro de nome exato + polo ativo é local.
 * - `texto`: busca no corpo da publicação (a frase inteira casa; "penhora" devolveu 100% com a palavra). O
 *   `count` fica travado em 10000 em termos comuns, então SEMPRE usar com período curto.
 * - `dataDisponibilizacaoInicio` / `dataDisponibilizacaoFim` (YYYY-MM-DD): funcionam com todos os filtros acima.
 *   Só com Início, vai até hoje. Resposta ordenada da mais nova para a mais antiga.
 * - `itensPorPagina` aceita de 5 a 100 (valores menores que 5 viram 5). `count` é o total geral, `items` a página.
 * - OAB/UF sem resultado ou com número inválido responde 200 com `count: 0` (não há erro de validação).
 * - Limite de 20 requisições por janela por IP (cabeçalhos X-RateLimit-Limit/Remaining; recupera em segundos).
 *   As buscas do Diário passam por `buscarPaginaEspacada` (1,2 s entre chamadas) e respeitam a pausa de 429.
 * ----------------------------------------------------------------------------------------------------------- */

export const UFS_OAB = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ',
  'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
] as const;

export type TipoBuscaDiario = 'oab' | 'nome' | 'termo';

export type BuscaDiarioValidada =
  | { ok: true; valor: string; ufOab: string; rotulo: string }
  | { ok: false; erro: string };

/**
 * Valida e normaliza uma busca do Diário. OAB: 1 a 7 dígitos + UF (valor = só dígitos, sem zeros à esquerda).
 * Nome: no mínimo 2 palavras (valor normalizado: maiúsculas, sem acento). Termo: no mínimo 3 caracteres.
 */
export function validarBuscaDiario(tipo: string, valorBruto: string, ufBruta?: string | null): BuscaDiarioValidada {
  const texto = (valorBruto ?? '').trim();
  if (tipo === 'oab') {
    const numero = texto.replace(/\D/g, '').replace(/^0+/, '');
    const uf = (ufBruta ?? '').trim().toUpperCase();
    if (numero.length < 1 || numero.length > 7) return { ok: false, erro: 'Informe o número da OAB (apenas dígitos, até 7).' };
    if (!(UFS_OAB as readonly string[]).includes(uf)) return { ok: false, erro: 'Escolha a UF da OAB.' };
    return { ok: true, valor: numero, ufOab: uf, rotulo: `OAB ${numero}/${uf}` };
  }
  if (tipo === 'nome') {
    const nome = normalizarNome(texto);
    if (nome.split(' ').filter(Boolean).length < 2) return { ok: false, erro: 'Informe o nome completo (pelo menos duas palavras).' };
    return { ok: true, valor: nome, ufOab: '', rotulo: nome };
  }
  if (tipo === 'termo') {
    const termo = texto.replace(/\s+/g, ' ');
    if (termo.length < 3) return { ok: false, erro: 'O termo precisa ter pelo menos 3 caracteres.' };
    if (termo.length > 120) return { ok: false, erro: 'O termo pode ter no máximo 120 caracteres.' };
    return { ok: true, valor: termo, ufOab: '', rotulo: termo };
  }
  return { ok: false, erro: 'Tipo de busca inválido. Use OAB, nome ou termo.' };
}

/** Uma publicação do Diário já normalizada para gravar/exibir (uma comunicação do DJEN). */
export interface PublicacaoDjen {
  comunicacaoId: number;
  numeroCnj: string;
  numeroFormatado: string;
  tribunal: string;
  orgao: string;
  classe: string;
  tipoComunicacao: string;
  /** YYYY-MM-DD */
  dataDisponibilizacao: string;
  texto: string;
  autores: string[];
  reus: string[];
  advogados: { nome: string; oab: string; uf: string }[];
}

export interface ResultadoBuscaDiario {
  publicacoes: PublicacaoDjen[];
  /** Tem mais páginas além do limite lido: as publicações mais antigas do período ficaram de fora. */
  truncado: boolean;
}

export interface OpcoesBuscaDiario {
  /** YYYY-MM-DD, inclusive. */
  inicio: string;
  /** YYYY-MM-DD, inclusive. */
  fim: string;
  maxPaginas?: number;
}

const INTERVALO_MIN_DIARIO_MS = 1200;
const MAX_PAGINAS_DIARIO = 5;
let ultimaChamadaDiario = 0;

const esperar = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** O DJEN está em pausa após um 429 nesta instância (quem varre em lote deve parar e tentar depois). */
export function djenEmPausa(): boolean {
  return Date.now() < pausadoAte;
}

async function buscarPaginaEspacada(params: Record<string, string>, pagina: number): Promise<RespostaDjen> {
  const espera = ultimaChamadaDiario + INTERVALO_MIN_DIARIO_MS - Date.now();
  if (espera > 0) await esperar(espera);
  ultimaChamadaDiario = Date.now();
  return buscarPagina(params, pagina);
}

/** Data de hoje em Brasília (YYYY-MM-DD), mais `dias` (pode ser negativo). */
export function dataBrasil(dias = 0): string {
  const agora = new Date(Date.now() + dias * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

const soDigitosSemZeros = (s: string | undefined) => (s || '').replace(/\D/g, '').replace(/^0+/, '');

function paraPublicacao(c: ComunicacaoDjen): PublicacaoDjen | null {
  if (typeof c.id !== 'number') return null;
  const digitos = (c.numero_processo || c.numeroprocessocommascara || '').replace(/\D/g, '');
  const destinatarios = c.destinatarios ?? [];
  return {
    comunicacaoId: c.id,
    numeroCnj: digitos.length === 20 ? digitos : '',
    numeroFormatado: c.numeroprocessocommascara || digitos,
    tribunal: c.siglaTribunal || '',
    orgao: c.nomeOrgao || '',
    classe: (c.nomeClasse || '').toLocaleUpperCase('pt-BR'),
    tipoComunicacao: c.tipoComunicacao || 'Comunicação',
    dataDisponibilizacao: c.data_disponibilizacao || '',
    texto: c.texto || '',
    autores: [...new Set(destinatarios.filter(d => d.polo === 'A' && d.nome).map(d => d.nome!.trim()))],
    reus: [...new Set(destinatarios.filter(d => d.polo === 'P' && d.nome).map(d => d.nome!.trim()))],
    advogados: (c.destinatarioadvogados ?? [])
      .map(a => a.advogado)
      .filter((a): a is NonNullable<typeof a> => Boolean(a?.nome))
      .map(a => ({ nome: a.nome!.trim(), oab: soDigitosSemZeros(a.numero_oab), uf: (a.uf_oab || '').toUpperCase() }))
  };
}

async function coletarPublicacoes(
  params: Record<string, string>,
  filtro: (c: ComunicacaoDjen) => boolean,
  opcoes: OpcoesBuscaDiario
): Promise<ResultadoBuscaDiario> {
  const maxPaginas = opcoes.maxPaginas ?? MAX_PAGINAS_DIARIO;
  const porId = new Map<number, PublicacaoDjen>();
  let truncado = false;
  let recebidas = 0;

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const resp = await buscarPaginaEspacada(
      { ...params, dataDisponibilizacaoInicio: opcoes.inicio, dataDisponibilizacaoFim: opcoes.fim },
      pagina
    );
    const itens = resp.items ?? [];
    recebidas += itens.length;
    for (const c of itens) {
      if (!filtro(c)) continue;
      const pub = paraPublicacao(c);
      if (pub && !porId.has(pub.comunicacaoId)) porId.set(pub.comunicacaoId, pub);
    }
    if (itens.length < ITENS_POR_PAGINA) break;
    if (pagina === maxPaginas) truncado = true;
  }

  if (recebidas > 0 && porId.size === 0) {
    console.warn(`[djen] ${recebidas} comunicações recebidas, nenhuma passou no filtro local (${JSON.stringify(params)})`);
  }
  const publicacoes = [...porId.values()].sort(
    (a, b) => b.dataDisponibilizacao.localeCompare(a.dataDisponibilizacao) || b.comunicacaoId - a.comunicacaoId
  );
  return { publicacoes, truncado };
}

/** Publicações em que o advogado (OAB número + UF) é citado, em qualquer polo. */
export async function buscarPublicacoesPorOabDjen(numeroOab: string, ufOab: string, opcoes: OpcoesBuscaDiario): Promise<ResultadoBuscaDiario> {
  const numero = soDigitosSemZeros(numeroOab);
  const uf = ufOab.trim().toUpperCase();
  return coletarPublicacoes(
    { numeroOab: numero, ufOab: uf },
    c => (c.destinatarioadvogados ?? []).some(a => soDigitosSemZeros(a.advogado?.numero_oab) === numero && (a.advogado?.uf_oab || '').toUpperCase() === uf),
    opcoes
  );
}

/** Publicações em que `nome` aparece EXATAMENTE (normalizado) como parte do polo ativo (só autor), como na busca pública. */
export async function buscarPublicacoesPorNomeDjen(nome: string, opcoes: OpcoesBuscaDiario): Promise<ResultadoBuscaDiario> {
  const alvo = normalizarNome(nome);
  return coletarPublicacoes(
    { nomeParte: nome.trim() },
    c => (c.destinatarios ?? []).some(d => d.polo === 'A' && d.nome && normalizarNome(d.nome) === alvo),
    opcoes
  );
}

/** Publicações cujo texto contém o termo (busca de frase do próprio DJEN; sem filtro de polo). */
export async function buscarPublicacoesPorTermoDjen(termo: string, opcoes: OpcoesBuscaDiario): Promise<ResultadoBuscaDiario> {
  return coletarPublicacoes({ texto: termo.trim() }, () => true, opcoes);
}
