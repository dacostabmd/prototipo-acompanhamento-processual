import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyTag } from './classify';

/**
 * Prazos processuais: extração do prazo a partir do texto de intimação/despacho, contagem do vencimento
 * em dias úteis (CPC), geração de arquivo .ics e criação de prazos automáticos a partir das
 * movimentações. Tudo que não toca o banco é função pura (testada em scratch/teste_prazos.ts).
 *
 * REGRAS JURÍDICAS ASSUMIDAS (documentadas aqui para revisão por advogado):
 *  - CPC art. 219: os prazos em dias são contados só em dias ÚTEIS. Vale para os prazos processuais
 *    fixados em lei ou pelo juiz. Prazos de natureza penal/CPP (dias corridos) e de outras leis só entram
 *    como "dias corridos" quando o texto disser isso expressamente.
 *  - CPC art. 224, caput: exclui-se o dia do começo e inclui-se o do vencimento.
 *  - CPC art. 224, § 1º: o vencimento que cair em dia sem expediente é prorrogado para o 1º dia útil seguinte.
 *  - CPC art. 224, §§ 2º e 3º (intimação pelo DJe/DJEN): a "publicação" é o 1º dia útil seguinte ao da
 *    disponibilização, e a contagem começa no 1º dia útil seguinte à publicação. Por isso a função aceita
 *    `baseTipo: 'disponibilizacao'`. Para as movimentações automáticas assumimos `publicacao` (a data da
 *    movimentação já é a da publicação): é a hipótese mais cedo, portanto a mais segura para quem controla prazo.
 *  - CPC art. 220: suspensão do curso dos prazos de 20/12 a 20/01 (inclusive). Dias suspensos não contam,
 *    nem para dias úteis nem para dias corridos nem para horas.
 *  - Prazo em HORAS: convertido em ceil(horas / 24) dias corridos a partir da data-base (aproximação: o prazo
 *    por hora corre minuto a minuto), com prorrogação do art. 224, § 1º.
 *  - NÃO tratado: prazo em dobro/quádruplo (arts. 180, 183, 186 do CPC: Fazenda, MP, Defensoria), prazos de
 *    Juizados com contagem própria, expediente suspenso por ato do tribunal (greve, instabilidade do sistema)
 *    e feriados estaduais/municipais. O usuário pode editar a data na agenda.
 *
 * FERIADOS USADOS (editáveis nas constantes abaixo):
 *  - Nacionais fixos por lei: 1/1, 21/4, 1/5, 7/9, 12/10, 2/11, 15/11, 20/11 (Lei 14.759/2023, nacional desde
 *    2024) e 25/12.
 *  - Sexta-Feira Santa (móvel): incluída por padrão (Lei 9.093/1995, art. 2º, II: dias da Semana Santa, incluindo
 *    a Sexta-Feira da Paixão; na prática todos os tribunais não têm expediente). Pode ser desligada.
 *  - Carnaval (segunda e terça) e Corpus Christi: NÃO são feriados nacionais por lei; dependem de ato de cada
 *    tribunal. Desligados por padrão (ligar por opção ou em FERIADOS_EXTRAS_PADRAO).
 *  - 1/11 (Todos os Santos), 11/8 e 8/12: feriados forenses só da Justiça Federal (Lei 5.010/1966, art. 62).
 *    Ficam fora por padrão; adicione em FERIADOS_EXTRAS_PADRAO se o seu foco for a Justiça Federal.
 */

// ── Datas (sempre string ISO "YYYY-MM-DD", calculadas em UTC para não depender do fuso do servidor) ──

const MS_DIA = 86_400_000;

function paraUtc(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

function deUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Aceita "YYYY-MM-DD" (com ou sem horário) e "DD/MM/YYYY". Retorna null se não for uma data real. */
export function normalizarDataISO(entrada: string | null | undefined): string | null {
  if (!entrada) return null;
  const texto = String(entrada).trim();
  let a: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(texto);
  if (r) {
    a = Number(r[1]);
    m = Number(r[2]);
    d = Number(r[3]);
  } else if ((r = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto))) {
    d = Number(r[1]);
    m = Number(r[2]);
    a = Number(r[3]);
  } else {
    return null;
  }
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function somarDias(iso: string, n: number): string {
  return deUtc(paraUtc(iso) + n * MS_DIA);
}

/** Dias de `a` até `b` (positivo quando b é depois de a). */
export function diferencaDias(a: string, b: string): number {
  return Math.round((paraUtc(b) - paraUtc(a)) / MS_DIA);
}

/** 0 = domingo ... 6 = sábado */
export function diaDaSemana(iso: string): number {
  return new Date(paraUtc(iso)).getUTCDay();
}

/** Hoje no fuso de Brasília, "YYYY-MM-DD". */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function formatarDataBr(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

// ── Feriados e recesso ───────────────────────────────────────────────────────

/** Feriados nacionais fixos ("MM-DD" -> nome). Edite esta lista para ajustar a contagem. */
export const FERIADOS_NACIONAIS_FIXOS: Record<string, string> = {
  '01-01': 'Confraternização Universal',
  '04-21': 'Tiradentes',
  '05-01': 'Dia do Trabalho',
  '09-07': 'Independência do Brasil',
  '10-12': 'Nossa Senhora Aparecida',
  '11-02': 'Finados',
  '11-15': 'Proclamação da República',
  '11-20': 'Dia da Consciência Negra',
  '12-25': 'Natal'
};

/**
 * Dias extras sem expediente aplicados SEMPRE (ex.: feriado forense do seu tribunal). Aceita "MM-DD" (todo ano)
 * ou "YYYY-MM-DD" (só aquele dia). Exemplos para a Justiça Federal: '11-01', '08-11', '12-08'.
 */
export const FERIADOS_EXTRAS_PADRAO: string[] = [];

export interface OpcoesContagem {
  /** Sexta-Feira Santa (Lei 9.093/95). Padrão: true. */
  incluirSextaSanta?: boolean;
  /** Segunda e terça de Carnaval (não é feriado nacional por lei). Padrão: false. */
  incluirCarnaval?: boolean;
  /** Corpus Christi (não é feriado nacional por lei). Padrão: false. */
  incluirCorpusChristi?: boolean;
  /** Suspensão de 20/12 a 20/01 (CPC art. 220). Padrão: true. */
  aplicarRecessoForense?: boolean;
  /** Dias extras sem expediente: "MM-DD" ou "YYYY-MM-DD". Somam-se a FERIADOS_EXTRAS_PADRAO. */
  feriadosExtras?: string[];
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), "YYYY-MM-DD". */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return deUtc(Date.UTC(ano, mes - 1, dia));
}

const cacheFeriados = new Map<string, Map<string, string>>();

/** Mapa "YYYY-MM-DD" -> nome dos dias sem expediente (feriados) do ano, conforme as opções. Não inclui o recesso. */
export function feriadosDoAno(ano: number, opcoes: OpcoesContagem = {}): Map<string, string> {
  const incluirSextaSanta = opcoes.incluirSextaSanta ?? true;
  const chave = `${ano}|${incluirSextaSanta}|${opcoes.incluirCarnaval ?? false}|${opcoes.incluirCorpusChristi ?? false}|${(opcoes.feriadosExtras ?? []).join(',')}|${FERIADOS_EXTRAS_PADRAO.join(',')}`;
  const emCache = cacheFeriados.get(chave);
  if (emCache) return emCache;

  const mapa = new Map<string, string>();
  for (const [md, nome] of Object.entries(FERIADOS_NACIONAIS_FIXOS)) mapa.set(`${ano}-${md}`, nome);

  const pas = pascoa(ano);
  if (incluirSextaSanta) mapa.set(somarDias(pas, -2), 'Sexta-Feira Santa');
  if (opcoes.incluirCarnaval) {
    mapa.set(somarDias(pas, -48), 'Carnaval (segunda-feira)');
    mapa.set(somarDias(pas, -47), 'Carnaval (terça-feira)');
  }
  if (opcoes.incluirCorpusChristi) mapa.set(somarDias(pas, 60), 'Corpus Christi');

  for (const extra of [...FERIADOS_EXTRAS_PADRAO, ...(opcoes.feriadosExtras ?? [])]) {
    if (/^\d{2}-\d{2}$/.test(extra)) mapa.set(`${ano}-${extra}`, 'Dia sem expediente (configurado)');
    else if (/^\d{4}-\d{2}-\d{2}$/.test(extra) && extra.startsWith(`${ano}-`)) mapa.set(extra, 'Dia sem expediente (configurado)');
  }

  cacheFeriados.set(chave, mapa);
  return mapa;
}

/** CPC art. 220: de 20/12 a 20/01, inclusive. */
export function emRecessoForense(iso: string): boolean {
  const md = iso.slice(5);
  return md >= '12-20' || md <= '01-20';
}

export function ehFeriado(iso: string, opcoes: OpcoesContagem = {}): boolean {
  return feriadosDoAno(Number(iso.slice(0, 4)), opcoes).has(iso);
}

/** Dia útil forense: não é sábado/domingo, feriado, nem está no recesso (quando aplicado). */
export function ehDiaUtil(iso: string, opcoes: OpcoesContagem = {}): boolean {
  const dow = diaDaSemana(iso);
  if (dow === 0 || dow === 6) return false;
  if (ehFeriado(iso, opcoes)) return false;
  if ((opcoes.aplicarRecessoForense ?? true) && emRecessoForense(iso)) return false;
  return true;
}

/** Primeiro dia útil ESTRITAMENTE depois de `iso`. */
export function proximoDiaUtil(iso: string, opcoes: OpcoesContagem = {}): string {
  let d = somarDias(iso, 1);
  while (!ehDiaUtil(d, opcoes)) d = somarDias(d, 1);
  return d;
}

/** `iso` se for dia útil; senão, o próximo dia útil (prorrogação do art. 224, § 1º). */
export function primeiroDiaUtilAPartir(iso: string, opcoes: OpcoesContagem = {}): string {
  return ehDiaUtil(iso, opcoes) ? iso : proximoDiaUtil(iso, opcoes);
}

/** Soma `n` dias úteis a `base`, excluindo o dia do começo e incluindo o do vencimento. */
export function somarDiasUteis(base: string, n: number, opcoes: OpcoesContagem = {}): string {
  if (n <= 0) return primeiroDiaUtilAPartir(base, opcoes);
  let d = base;
  for (let i = 0; i < n; i++) d = proximoDiaUtil(d, opcoes);
  return d;
}

/** Soma `n` dias corridos (pulando só os dias do recesso) e prorroga o resultado para dia útil. */
function somarDiasCorridos(base: string, n: number, opcoes: OpcoesContagem): string {
  const recesso = opcoes.aplicarRecessoForense ?? true;
  let d = base;
  let contados = 0;
  while (contados < n) {
    d = somarDias(d, 1);
    if (recesso && emRecessoForense(d)) continue;
    contados++;
  }
  return primeiroDiaUtilAPartir(d, opcoes);
}

export type UnidadePrazo = 'dias_uteis' | 'dias_corridos' | 'horas';

export interface EntradaVencimento {
  /** Data da publicação/intimação (ou da disponibilização, com `baseTipo`). "YYYY-MM-DD" ou "DD/MM/YYYY". */
  dataBase: string;
  quantidade: number;
  unidade: UnidadePrazo;
  /** 'publicacao' (padrão): conta a partir da data informada. 'disponibilizacao': publicação = 1º dia útil seguinte (art. 224, § 2º). */
  baseTipo?: 'publicacao' | 'disponibilizacao';
}

/** Data de vencimento "YYYY-MM-DD", ou null se a data-base ou a quantidade forem inválidas. */
export function calcularVencimento(entrada: EntradaVencimento, opcoes: OpcoesContagem = {}): string | null {
  const base = normalizarDataISO(entrada.dataBase);
  if (!base || !Number.isFinite(entrada.quantidade) || entrada.quantidade < 0) return null;

  const inicio = entrada.baseTipo === 'disponibilizacao' ? proximoDiaUtil(base, opcoes) : base;
  switch (entrada.unidade) {
    case 'dias_uteis':
      return somarDiasUteis(inicio, entrada.quantidade, opcoes);
    case 'dias_corridos':
      return somarDiasCorridos(inicio, entrada.quantidade, opcoes);
    case 'horas':
      return somarDiasCorridos(inicio, Math.max(1, Math.ceil(entrada.quantidade / 24)), opcoes);
    default:
      return null;
  }
}

// ── Extração do prazo a partir do texto ──────────────────────────────────────

export interface PrazoExtraido {
  quantidade: number;
  unidade: UnidadePrazo;
  /** Trecho do texto original em que o prazo foi encontrado. */
  trecho: string;
  /** O texto disse "úteis"/"corridos" (ou é em horas), em vez de a unidade ser presumida. */
  unidadeExplicita: boolean;
  /** O texto contém "sob pena de" (consequência processual: o prazo é peremptório na prática). */
  sobPena: boolean;
}

const NUMEROS_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300
};

/** "vinte e quatro" -> 24 (texto já sem acento e em minúsculas). null se não for número por extenso. */
function numeroPorExtenso(texto: string): number | null {
  let total = 0;
  for (const parte of texto.trim().split(/\s+e\s+/)) {
    const valor = NUMEROS_EXTENSO[parte.trim()];
    if (valor === undefined) return null;
    total += valor;
  }
  return total > 0 ? total : null;
}

/** Minúsculas e sem acento, mantendo o MESMO comprimento do texto original (para recortar o trecho). */
function semAcento(texto: string): string {
  return Array.from(texto.normalize('NFC'))
    .map(c => c.normalize('NFD')[0].toLowerCase())
    .join('');
}

const NUM = String.raw`(\d{1,3}|[a-z]+(?:\s+e\s+[a-z]+){0,2})`;
const REGEX_PRAZO = new RegExp(
  String.raw`(?:\bprazo(?:\s+(?:legal|comum|sucessivo|improrrogavel|peremptorio|unico))?\s*(?:de|:)\s*|\bem\s+|\bdentro\s+d[eo]\s+(?:prazo\s+de\s+)?|\bno\s+maximo\s+(?:em|de)\s+)` +
    NUM +
    String.raw`\s*(?:\(([^)]{1,60})\)\s*)?(dias?|horas?)(?:\s+(uteis|corridos))?`,
  'g'
);

/**
 * Procura prazos em texto de intimação/despacho: "no prazo de 15 (quinze) dias", "prazo de 5 dias úteis",
 * "em 48 horas", "prazo de dez dias". Sem unidade explícita, presume dias úteis (CPC art. 219).
 * Ignora expressões sem gatilho de prazo ("há 15 dias", "15 dias atrás").
 */
export function extrairPrazos(texto: string | null | undefined): PrazoExtraido[] {
  if (!texto) return [];
  const original = texto.normalize('NFC');
  const normalizado = semAcento(original);
  const sobPena = /\bsob\s+pena\b/.test(normalizado);
  const achados: PrazoExtraido[] = [];
  const vistos = new Set<string>();

  for (const m of normalizado.matchAll(REGEX_PRAZO)) {
    const bruto = m[1];
    const quantidade = /^\d+$/.test(bruto) ? Number(bruto) : numeroPorExtenso(bruto);
    if (!quantidade) continue;

    const ehHora = m[3].startsWith('hora');
    if (quantidade < 1 || quantidade > (ehHora ? 720 : 365)) continue;

    const unidade: UnidadePrazo = ehHora ? 'horas' : m[4] === 'corridos' ? 'dias_corridos' : 'dias_uteis';
    const chave = `${quantidade}|${unidade}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    const inicio = m.index ?? 0;
    achados.push({
      quantidade,
      unidade,
      trecho: original.slice(inicio, inicio + m[0].length).replace(/\s+/g, ' ').trim(),
      unidadeExplicita: ehHora || Boolean(m[4]),
      sobPena
    });
  }
  return achados;
}

export function rotuloUnidade(unidade: UnidadePrazo, quantidade: number): string {
  if (unidade === 'horas') return quantidade === 1 ? 'hora' : 'horas';
  if (unidade === 'dias_corridos') return quantidade === 1 ? 'dia corrido' : 'dias corridos';
  return quantidade === 1 ? 'dia útil' : 'dias úteis';
}

// ── Regras de prazo por tipo de ato (reaproveitado pela ferramenta do agente) ─

export interface RegraPrazoAto {
  prazoDiasUteis: number;
  baseLegal: string;
  descricao: string;
}

/** Prazo legal típico do CPC para um tipo de ato (texto livre). Mesma tabela da ferramenta calcular_prazo_processual. */
export function regraPrazoPorTipoAto(tipoAto: string): RegraPrazoAto {
  const ato = tipoAto.toLowerCase();

  let prazoDiasUteis = 15;
  let baseLegal = 'Art. 219 e 335 do CPC';
  let descricao = 'Prazo padrão geral para grande parte dos atos no Código de Processo Civil.';

  if (/contest|resposta do r[eé]u/.test(ato)) {
    prazoDiasUteis = 15;
    baseLegal = 'Art. 335 do CPC';
    descricao = 'Prazo para apresentação de Contestação a partir da audiência de conciliação ou juntada do mandado de citação.';
  } else if (/embargos de declara[cç][aã]o/.test(ato)) {
    prazoDiasUteis = 5;
    baseLegal = 'Art. 1.023 do CPC';
    descricao = 'Prazo para opor Embargos de Declaração contra decisão omissa, contraditória ou obscura.';
  } else if (/agravo de instrumento|apela[cç][aã]o|recurso/.test(ato)) {
    prazoDiasUteis = 15;
    baseLegal = 'Art. 1.003, § 5º do CPC';
    descricao = 'Prazo para interposição da maioria dos recursos cíveis (exceto Embargos de Declaração).';
  } else if (/pagamento volunt[aá]rio|art\.?\s*523/.test(ato)) {
    prazoDiasUteis = 15;
    baseLegal = 'Art. 523 do CPC';
    descricao = 'Prazo para pagamento voluntário da condenação sem aplicação de multa de 10% e honorários de 10%. Após os 15 dias, iniciam-se mais 15 dias para Impugnação.';
  } else if (/juiz|magistrad|despacho|excesso de prazo|demora|concluso|atraso/.test(ato)) {
    prazoDiasUteis = 5;
    baseLegal = 'Art. 226 e Art. 235 do CPC';
    descricao =
      'Prazos do juiz: 5 dias úteis para despachos, 10 dias úteis para decisões interlocutórias e 30 dias úteis para sentenças (art. 226 do CPC). ' +
      'Havendo excesso de prazo injustificado (como 90 dias concluso para despacho), a parte pode peticionar requerendo providências de impulso oficial ao juízo e, persistindo a omissão após 10 dias, representar ao corregedor do tribunal ou ao Conselho Nacional de Justiça (CNJ) por excesso de prazo, nos termos expressos do art. 235 do CPC.';
  } else if (/embargos [aà] execu[cç][aã]o/.test(ato)) {
    prazoDiasUteis = 15;
    baseLegal = 'Art. 915 do CPC';
    descricao = 'Prazo para ajuizar Embargos à Execução de Título Extrajudicial a contar da juntada do comprovante da citação.';
  }

  return { prazoDiasUteis, baseLegal, descricao };
}

// ── Prazos sugeridos a partir de movimentações ───────────────────────────────

export interface MovimentoParaPrazo {
  /** Data da movimentação/publicação. */
  data: string;
  titulo: string;
  descricao?: string | null;
  /** Classificação já calculada (lib/classify). Se ausente, é recalculada pelo texto. */
  tag?: string | null;
}

export interface PrazoSugerido {
  titulo: string;
  descricao: string;
  dataVencimento: string;
  dataBase: string;
  quantidade: number;
  unidade: UnidadePrazo;
  trecho: string;
  sobPena: boolean;
  /** Hash para dedupe: o mesmo prazo do mesmo processo nunca é criado duas vezes para o usuário. */
  origemHash: string;
}

function apenasDigitos(v: string): string {
  return (v || '').replace(/\D/g, '');
}

function hashPrazo(partes: (string | number)[]): string {
  return createHash('sha256').update(partes.join('|')).digest('hex').slice(0, 32);
}

/**
 * Prazos que a movimentação sugere (um por prazo encontrado no texto). Só devolve os que ainda não venceram em
 * `hoje` — o que já passou não vira lembrete útil. `apenasUrgentes`: ignora movimentações que o classificador
 * não marca como urgentes (usado no gancho do cron; a busca manual do usuário desliga isso).
 */
export function sugerirPrazosDeMovimento(
  mov: MovimentoParaPrazo,
  numeroCnj: string,
  opcoes: { hoje?: string; apenasUrgentes?: boolean } & OpcoesContagem = {}
): PrazoSugerido[] {
  const texto = `${mov.titulo ?? ''}. ${mov.descricao ?? ''}`.trim();
  const dataBase = normalizarDataISO(mov.data);
  if (!dataBase || !texto) return [];

  if (opcoes.apenasUrgentes) {
    const tag = mov.tag ?? classifyTag(texto);
    if (tag !== 'urgente') return [];
  }

  const hoje = opcoes.hoje ?? hojeSaoPaulo();
  const sugestoes: PrazoSugerido[] = [];
  for (const prazo of extrairPrazos(texto)) {
    const vencimento = calcularVencimento({ dataBase, quantidade: prazo.quantidade, unidade: prazo.unidade }, opcoes);
    if (!vencimento || vencimento < hoje) continue;

    const resumoMov = (mov.titulo || 'Movimentação').replace(/\s+/g, ' ').trim().slice(0, 90);
    const contagem = prazo.unidade === 'horas' ? 'em horas, convertido em dias corridos' : prazo.unidade === 'dias_corridos' ? 'em dias corridos' : 'em dias úteis (CPC, art. 219)';
    sugestoes.push({
      titulo: `Prazo de ${prazo.quantidade} ${rotuloUnidade(prazo.unidade, prazo.quantidade)}: ${resumoMov}`.slice(0, 200),
      descricao:
        `Vencimento estimado a partir da movimentação de ${formatarDataBr(dataBase)} ("${prazo.trecho}"), contagem ${contagem}, ` +
        `excluído o dia do começo e sem contar fins de semana, feriados nacionais e o recesso de 20/12 a 20/01. ` +
        `${prazo.sobPena ? 'O texto prevê consequência "sob pena de". ' : ''}` +
        `Prazo em dobro, feriado local e suspensão do expediente não são considerados: confira no processo.`,
      dataVencimento: vencimento,
      dataBase,
      quantidade: prazo.quantidade,
      unidade: prazo.unidade,
      trecho: prazo.trecho,
      sobPena: prazo.sobPena,
      origemHash: hashPrazo(['mov', apenasDigitos(numeroCnj), dataBase, prazo.quantidade, prazo.unidade, semAcento(texto).replace(/\s+/g, ' ').slice(0, 400)])
    });
  }
  return sugestoes;
}

// ── Banco ────────────────────────────────────────────────────────────────────

/**
 * Cria prazos automáticos (origem 'auto_movimentacao') para todos os usuários Pro que acompanham o processo,
 * a partir de movimentações novas urgentes com prazo no texto. Dedupe por (user_id, origem_hash). Nunca lança erro.
 */
export async function criarPrazosAutomaticos(
  db: SupabaseClient,
  args: { processoId: string; numeroCnj: string; movimentos: MovimentoParaPrazo[]; hoje?: string }
): Promise<{ criados: number; usuarios: number }> {
  const resultado = { criados: 0, usuarios: 0 };
  try {
    const sugestoes = args.movimentos.flatMap(m => sugerirPrazosDeMovimento(m, args.numeroCnj, { hoje: args.hoje, apenasUrgentes: true }));
    if (sugestoes.length === 0) return resultado;

    const { data: vinculos, error } = await db.from('ap_processos_monitorados').select('user_id').eq('processo_id', args.processoId);
    if (error) {
      console.error('[prazos] falha ao ler quem acompanha o processo:', error.message);
      return resultado;
    }

    const { verificarRecursoPlano } = await import('./planos');
    for (const userId of new Set((vinculos ?? []).map(v => v.user_id as string))) {
      const acesso = await verificarRecursoPlano(userId, 'agendaPrazos');
      if (!acesso.permitido) continue;

      const linhas = sugestoes.map(s => ({
        user_id: userId,
        processo_id: args.processoId,
        numero_cnj: args.numeroCnj,
        titulo: s.titulo,
        descricao: s.descricao,
        tipo: 'prazo',
        data_vencimento: s.dataVencimento,
        origem: 'auto_movimentacao',
        origem_hash: s.origemHash
      }));
      const { data: inseridos, error: erroInsert } = await db
        .from('ap_prazos')
        .upsert(linhas, { onConflict: 'user_id,origem_hash', ignoreDuplicates: true })
        .select('id');
      if (erroInsert) {
        console.error('[prazos] falha ao criar prazos automáticos:', erroInsert.message);
        continue;
      }
      resultado.usuarios++;
      resultado.criados += inseridos?.length ?? 0;
    }
  } catch (e) {
    console.error('[prazos] exceção ao criar prazos automáticos:', e);
  }
  return resultado;
}

export interface SugestaoDoUsuario extends PrazoSugerido {
  processoId: string;
  numeroCnj: string;
}

/**
 * Varre as movimentações recentes dos processos que o usuário acompanha e propõe prazos (ainda não vencidos e
 * ainda não criados). Não grava nada.
 */
export async function buscarSugestoesDoUsuario(
  db: SupabaseClient,
  userId: string,
  opcoes: { diasParaTras?: number; hoje?: string } = {}
): Promise<SugestaoDoUsuario[]> {
  const hoje = opcoes.hoje ?? hojeSaoPaulo();
  const desde = somarDias(hoje, -(opcoes.diasParaTras ?? 60));

  const { data: vinculos } = await db.from('ap_processos_monitorados').select('processo_id, ap_processos(numero_cnj)').eq('user_id', userId);
  const processos = new Map<string, string>();
  for (const v of (vinculos ?? []) as unknown as { processo_id: string; ap_processos: { numero_cnj: string } | { numero_cnj: string }[] | null }[]) {
    const proc = Array.isArray(v.ap_processos) ? v.ap_processos[0] : v.ap_processos;
    if (proc?.numero_cnj) processos.set(v.processo_id, proc.numero_cnj);
  }
  if (processos.size === 0) return [];

  const { data: movs } = await db
    .from('ap_movimentacoes')
    .select('processo_id, data_movimentacao, titulo, conteudo, tipo')
    .in('processo_id', [...processos.keys()])
    .gte('data_movimentacao', desde)
    .order('data_movimentacao', { ascending: false })
    .limit(600);

  const sugestoes: SugestaoDoUsuario[] = [];
  for (const m of (movs ?? []) as { processo_id: string; data_movimentacao: string; titulo: string | null; conteudo: string | null; tipo: string | null }[]) {
    const numeroCnj = processos.get(m.processo_id);
    if (!numeroCnj) continue;
    for (const s of sugerirPrazosDeMovimento({ data: m.data_movimentacao, titulo: m.titulo ?? '', descricao: m.conteudo, tag: m.tipo }, numeroCnj, { hoje })) {
      sugestoes.push({ ...s, processoId: m.processo_id, numeroCnj });
    }
  }
  if (sugestoes.length === 0) return [];

  // Tira o que o usuário já tem na agenda (inclusive concluído) e o que se repete na própria varredura.
  const { data: existentes } = await db
    .from('ap_prazos')
    .select('origem_hash')
    .eq('user_id', userId)
    .in('origem_hash', sugestoes.map(s => s.origemHash));
  const jaTem = new Set((existentes ?? []).map(e => e.origem_hash as string));
  const vistos = new Set<string>();
  return sugestoes
    .filter(s => {
      if (jaTem.has(s.origemHash) || vistos.has(s.origemHash)) return false;
      vistos.add(s.origemHash);
      return true;
    })
    .sort((a, b) => (a.dataVencimento < b.dataVencimento ? -1 : a.dataVencimento > b.dataVencimento ? 1 : 0))
    .slice(0, 60);
}

// ── Calendário .ics (RFC 5545) ───────────────────────────────────────────────

export interface PrazoParaIcs {
  id: string;
  titulo: string;
  descricao?: string | null;
  tipo: string;
  dataVencimento: string;
  numeroCnj?: string | null;
}

/** Escapa texto de propriedade iCalendar: barra, ponto e vírgula, vírgula e quebras de linha. */
export function escaparTextoIcs(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Dobra a linha em 75 octetos (UTF-8), sem cortar caractere no meio; continuações começam com um espaço. */
export function dobrarLinhaIcs(linha: string): string {
  const LIMITE = 75;
  if (Buffer.byteLength(linha, 'utf8') <= LIMITE) return linha;
  const partes: string[] = [];
  let atual = '';
  let bytes = 0;
  let limite = LIMITE;
  for (const ch of Array.from(linha)) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > limite) {
      partes.push(atual);
      atual = ' ';
      bytes = 1;
      limite = LIMITE;
    }
    atual += ch;
    bytes += b;
  }
  partes.push(atual);
  return partes.join('\r\n');
}

const ROTULO_TIPO_ICS: Record<string, string> = { prazo: 'Prazo', tarefa: 'Tarefa', audiencia: 'Audiência' };

/**
 * Gera o arquivo .ics: um evento de DIA INTEIRO por prazo, com alarme de exibição "1 dia antes" (disparo às 9h
 * da véspera: TRIGGER -PT15H em relação ao início do dia do vencimento).
 */
export function gerarIcs(prazos: PrazoParaIcs[], opcoes: { agora?: Date; siteUrl?: string } = {}): string {
  const agora = opcoes.agora ?? new Date();
  const carimbo = agora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const site = (opcoes.siteUrl ?? 'https://jusconsulta.com.br').replace(/\/$/, '');

  const linhas: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JusConsulta//Agenda de Prazos//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:JusConsulta - Agenda de prazos', 'X-WR-TIMEZONE:America/Sao_Paulo'];

  for (const p of prazos) {
    const data = normalizarDataISO(p.dataVencimento);
    if (!data) continue;
    const rotulo = ROTULO_TIPO_ICS[p.tipo] ?? 'Prazo';
    const resumo = `${rotulo}: ${p.titulo}`;
    const partesDescricao = [p.descricao?.trim(), p.numeroCnj ? `Processo ${p.numeroCnj}: ${site}/processo/${apenasDigitos(p.numeroCnj)}` : '', `Agenda: ${site}/agenda`].filter(Boolean) as string[];

    linhas.push(
      'BEGIN:VEVENT',
      `UID:prazo-${p.id}@jusconsulta`,
      `DTSTAMP:${carimbo}`,
      `DTSTART;VALUE=DATE:${data.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${somarDias(data, 1).replace(/-/g, '')}`,
      `SUMMARY:${escaparTextoIcs(resumo)}`,
      `DESCRIPTION:${escaparTextoIcs(partesDescricao.join('\n'))}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escaparTextoIcs(`Vence amanhã: ${p.titulo}`)}`,
      'TRIGGER:-PT15H',
      'END:VALARM',
      'END:VEVENT'
    );
  }

  linhas.push('END:VCALENDAR');
  return linhas.map(dobrarLinhaIcs).join('\r\n') + '\r\n';
}
