/**
 * Regras de segurança do conteúdo da minuta, aplicadas por CÓDIGO depois da geração (o prompt de sistema diz o
 * mesmo, mas não se confia só nele):
 *
 *  a) nenhum nome, número de processo, data, valor, CPF/CNPJ, OAB ou CEP que não conste nos dados informados:
 *     dado numérico fora da entrada vira `[PREENCHER: ...]`; nome desconhecido recebe `[CONFERIR: ...]`;
 *  b) jurisprudência só da lista entregue ao modelo: o que não está na lista é removido (vira `[PREENCHER: ...]`)
 *     e o que está é reescrito com a referência exata da lista;
 *  c) leis desconhecidas, artigos inexistentes, súmulas e temas recebem `[CONFERIR: ...]`;
 *  d) o aviso fixo é inserido pelo código (ver formato.ts);
 *  e) estrutura: seções obrigatórias do tipo, na ordem; seção que o modelo pulou vira `[PREENCHER: ...]`.
 *
 * `processar` é pura e idempotente: aplicada a um texto já tratado não muda nada. `auditar` usa isso como pós-condição
 * (devolve o que ainda precisaria de intervenção) e é o que a avaliação automática confere.
 */
import { AVISO, chaveTitulo, montarConteudo, parsearSecoes, semAcento, type SecaoPeca } from './formato';
import type { Intervencao } from './tipos';

export interface CitacaoPermitida {
  referencia: string;
  ementa?: string;
  fonteUrl?: string | null;
  id?: string;
}

export interface Corpus {
  texto: string;
  /** Sequências numéricas (só dígitos) presentes nos dados informados. */
  tokens: Set<string>;
  valores: number[];
  /** Datas no formato canônico d/m/aaaa. */
  datas: Set<string>;
  /** Palavras (sem acento, minúsculas) dos dados informados. */
  palavras: Set<string>;
}

const digitos = (v: string) => v.replace(/\D/g, '');

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function dataCanonica(d: string, m: string, a: string): string {
  const ano = a.length === 2 ? 2000 + Number(a) : Number(a);
  return `${Number(d)}/${Number(m)}/${ano}`;
}

function paraNumeroBR(t: string): number | null {
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^\d+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return null;
}

/** Tudo o que o advogado informou (campos, contexto do processo, julgados da lista): a única fonte de dados da minuta. */
export function montarCorpus(partes: (string | null | undefined)[]): Corpus {
  const texto = partes.filter(Boolean).join('\n');
  const tokens = new Set<string>();
  const valores: number[] = [];
  for (const m of texto.matchAll(/\d[\d.,\-/]*\d|\d/g)) {
    tokens.add(digitos(m[0]));
    for (const parte of m[0].split(',')) tokens.add(digitos(parte));
    const v = paraNumeroBR(m[0]);
    if (v !== null) valores.push(v);
  }
  for (const m of texto.matchAll(/(\d+(?:,\d+)?)\s*(mil|milh[ãõ]es|milh[ãa]o)\b/gi)) {
    const base = Number(m[1].replace(',', '.'));
    valores.push(/^mil$/i.test(m[2]) ? base * 1000 : base * 1_000_000);
  }
  const datas = new Set<string>();
  for (const m of texto.matchAll(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)/g)) datas.add(dataCanonica(m[1], m[2], m[3]));
  for (const m of texto.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) datas.add(dataCanonica(m[3], m[2], m[1]));
  for (const m of texto.matchAll(/(\d{1,2})[º°]?\s+de\s+(\p{L}+)\s+de\s+(\d{4})/giu)) {
    const mes = MESES.indexOf(semAcento(m[2]));
    if (mes >= 0) datas.add(dataCanonica(m[1], String(mes + 1), m[3]));
  }
  const palavras = new Set<string>();
  for (const m of texto.matchAll(/\p{L}{2,}/gu)) palavras.add(semAcento(m[0]));
  return { texto, tokens, valores, datas, palavras };
}

// ---------------------------------------------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------------------------------------------

function reescrever(texto: string, re: RegExp, fn: (m: RegExpMatchArray, indice: number) => string | null): string {
  let saida = '';
  let ultimo = 0;
  for (const m of texto.matchAll(re)) {
    const i = m.index ?? 0;
    const novo = fn(m, i);
    if (novo === null || novo === m[0]) continue;
    saida += texto.slice(ultimo, i) + novo;
    ultimo = i + m[0].length;
  }
  return saida + texto.slice(ultimo);
}

const curto = (t: string) => (t.length > 90 ? `${t.slice(0, 89)}…` : t);
const jaMarcado = (texto: string, fim: number) => /^\s*\[(?:CONFERIR|PREENCHER)/.test(texto.slice(fim, fim + 24));

// ---------------------------------------------------------------------------------------------------------------
// (b) Jurisprudência
// ---------------------------------------------------------------------------------------------------------------

const CLASSES = ['EAREsp', 'AREsp', 'EREsp', 'REsp', 'AgInt', 'AgRg', 'EDcl', 'RHC', 'HC', 'ARE', 'RE', 'RMS', 'Rcl', 'RCL', 'CC', 'ADPF', 'ADI', 'ADC', 'Pet', 'MS', 'AIRR', 'AI', 'Ag', 'RR'].join('|');

/** Referência de julgado do STJ/STF/TST (classe + número, com os complementos usuais: UF, relator, turma, data). */
function regexJulgado(): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\d])(?:(STJ|STF|TST)\\s*,?\\s*)?((?:(?:${CLASSES})\\s+(?:no|na|nos|nas|em)\\s+)*)(${CLASSES})\\s+(?:n(?:[.º°]|o)?\\.?\\s*)?` +
      `(\\d{1,3}(?:\\.\\d{3})+|\\d{3,})(?:\\s*[/-]\\s*[A-Z]{2}(?![A-Za-z]))?` +
      `(?:\\s*,\\s*Rel(?:ator|atora|\\.)?\\s*[.,]?\\s*(?:Min(?:istr[oa])?|Des(?:embargador[a]?)?)\\.?\\s+[^,;()\\n]{3,60})?` +
      `(?:\\s*,\\s*[^,;()\\n]{3,30}?(?:Turma|Seção|Corte Especial)(?![A-Za-z]))?` +
      `(?:\\s*,\\s*(?:j(?:ulgado)?\\.?|DJe?)\\s*(?:em|de|:)?\\s*\\d{2}/\\d{2}/\\d{4})?`,
    'gu'
  );
}

const chaveJulgado = (classe: string, numero: string) => `${classe.toLowerCase()}:${digitos(numero)}`;

function mapaCitacoes(citacoes: CitacaoPermitida[]): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const c of citacoes) {
    for (const m of c.referencia.matchAll(regexJulgado())) mapa.set(chaveJulgado(m[3], m[4]), c.referencia.trim());
  }
  return mapa;
}

const REGEX_JULGADO_ESTADUAL =
  /(?<![\p{L}\d])(TJ[A-Z]{2}|TRF-?\d|TRT-?\d+)\s*,?\s*(?:Apelação(?: Cível)?|Agravo de Instrumento|Recurso Inominado|AC|Ap\.?|AI|RI)\s*(?:n(?:[.º°]|o)?\.?\s*)?(\d[\d.\-/]{5,}\d)/gu;

function regraJulgados(texto: string, citacoes: CitacaoPermitida[], corpus: Corpus, saida: Intervencao[]): string {
  const permitidos = mapaCitacoes(citacoes);
  let t = reescrever(texto, regexJulgado(), m => {
    const chave = chaveJulgado(m[3], m[4]);
    const literal = permitidos.get(chave);
    const original = m[0].trim();
    if (literal) {
      if (original.replace(/\s+/g, ' ') === literal.replace(/\s+/g, ' ')) return null;
      saida.push({ tipo: 'julgado_corrigido', trecho: curto(original), acao: 'referência reescrita exatamente como consta na base' });
      return literal;
    }
    saida.push({ tipo: 'julgado_removido', trecho: curto(original), acao: 'julgado fora da lista de jurisprudência da base: removido' });
    return '[PREENCHER: julgado verificado (referência removida por não constar na base)]';
  });
  t = reescrever(t, REGEX_JULGADO_ESTADUAL, m => {
    if (corpus.tokens.has(digitos(m[2]))) return null;
    saida.push({ tipo: 'julgado_removido', trecho: curto(m[0]), acao: 'julgado de tribunal fora da lista da base: removido' });
    return '[PREENCHER: julgado verificado (referência removida por não constar na base)]';
  });
  // Menção genérica a "o julgado autorizado/fornecido" (vazamento do prompt, sem referência nenhuma).
  t = reescrever(t, /\b(?:o|os|do|dos|ao|no|pelo|esse|este)\s+julgados?\s+(?:autorizad[oa]s?|fornecid[oa]s?|disponibilizad[oa]s?|da lista)\b/gi, m => {
    saida.push({ tipo: 'julgado_removido', trecho: m[0], acao: 'menção a julgado sem referência: trocada por campo a preencher' });
    return '[PREENCHER: referência do julgado da base]';
  });
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// (a) Dados que não podem ser inventados
// ---------------------------------------------------------------------------------------------------------------

function regraDados(texto: string, corpus: Corpus, saida: Intervencao[]): string {
  const trocar = (re: RegExp, extrair: (m: RegExpMatchArray) => string, rotulo: string, substituto: (m: RegExpMatchArray) => string, t: string) =>
    reescrever(t, re, m => {
      if (corpus.tokens.has(extrair(m))) return null;
      saida.push({ tipo: 'dado_inventado', trecho: curto(m[0]), acao: `${rotulo} fora dos dados informados: trocado por campo a preencher` });
      return substituto(m);
    });

  let t = texto;
  t = trocar(/(?<![\d.\-/])\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}(?!\d)/g, m => digitos(m[0]), 'número de processo', () => '[PREENCHER: número do processo]', t);
  t = trocar(/(?<![\d.\-/])\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}(?!\d)/g, m => digitos(m[0]), 'CNPJ', () => '[PREENCHER: CNPJ]', t);
  t = trocar(/(?<![\d.\-/])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, m => digitos(m[0]), 'CPF', () => '[PREENCHER: CPF]', t);
  t = trocar(/(?<![\d.\-])\d{5}-\d{3}(?!\d)/g, m => digitos(m[0]), 'CEP', () => '[PREENCHER: CEP]', t);
  t = trocar(
    /\bOAB(?:\s*[/-]\s*|\s+)?(?:[A-Z]{2}\b\s*)?(?:n(?:[.º°]|o)?\.?\s*)?(\d[\d.]*\d|\d)(?:\s*\/\s*[A-Z]{2}\b)?/g,
    m => digitos(m[1]),
    'número de OAB',
    () => 'OAB [PREENCHER: nº e UF da OAB]',
    t
  );

  // Datas numéricas e por extenso (as de leis ficam de fora: "Lei nº 13.105, de 16 de março de 2015").
  t = reescrever(t, /(?<![\d/.\-])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d/])/g, m => {
    if (corpus.datas.has(dataCanonica(m[1], m[2], m[3]))) return null;
    saida.push({ tipo: 'dado_inventado', trecho: m[0], acao: 'data fora dos dados informados: trocada por campo a preencher' });
    return '[PREENCHER: data]';
  });
  t = reescrever(t, /(?<![\d])(\d{1,2})[º°]?\s+de\s+(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/giu, (m, i) => {
    const mes = MESES.indexOf(semAcento(m[2]));
    if (corpus.datas.has(dataCanonica(m[1], String(mes + 1), m[3]))) return null;
    const antes = t.slice(Math.max(0, i - 70), i);
    const citLei = /\b(?:Lei|Decreto|Emenda|Medida Provisória|Constituição|Código|Complementar)\b[^;\n]{0,50}$/i.exec(antes);
    if (citLei && !/\.\s+\p{Lu}/u.test(citLei[0])) return null;
    saida.push({ tipo: 'dado_inventado', trecho: m[0], acao: 'data fora dos dados informados: trocada por campo a preencher' });
    return '[PREENCHER: data]';
  });

  // Valores em reais (com o extenso entre parênteses, quando houver).
  t = reescrever(
    t,
    /R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(?:\s*(mil|milhões|milhão)\b)?(?:\s*\((?:[^)]{3,140}reais?[^)]{0,40})\))?/gi,
    m => {
      let v = Number(`${m[1].replace(/\./g, '')}.${m[2] ?? '0'}`);
      if (m[3]) v *= /^mil$/i.test(m[3]) ? 1000 : 1_000_000;
      if (corpus.valores.some(c => Math.abs(c - v) < 0.005)) return null;
      saida.push({ tipo: 'dado_inventado', trecho: curto(m[0]), acao: 'valor fora dos dados informados: trocado por campo a preencher' });
      return '[PREENCHER: valor]';
    }
  );
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// (c) Leis, artigos, súmulas
// ---------------------------------------------------------------------------------------------------------------

const LEIS_CONHECIDAS = new Set([
  // Leis ordinárias
  'lei:13105', 'lei:10406', 'lei:8078', 'lei:8906', 'lei:9099', 'lei:8245', 'lei:10741', 'lei:6830', 'lei:14133', 'lei:13709',
  'lei:12965', 'lei:11101', 'lei:12016', 'lei:7347', 'lei:9307', 'lei:9610', 'lei:9279', 'lei:8112', 'lei:8213', 'lei:8036',
  'lei:8069', 'lei:11340', 'lei:6015', 'lei:9494', 'lei:12153', 'lei:10259', 'lei:5478', 'lei:6515', 'lei:8560', 'lei:13146',
  'lei:13467', 'lei:14230', 'lei:8429', 'lei:9784', 'lei:4717', 'lei:11441', 'lei:12318', 'lei:13140', 'lei:12514',
  // Leis complementares
  'lc:101', 'lc:118', 'lc:123', 'lc:95',
  // Decretos-leis e decretos
  'dl:5452', 'dl:4657', 'dl:3689', 'dl:2848', 'dl:3365', 'dl:25', 'decreto:20910'
]);

const MAX_ARTIGO: { re: RegExp; nome: string; max: number }[] = [
  { re: /^(?:cpc|codigo de processo civil)$/, nome: 'CPC', max: 1072 },
  { re: /^(?:cc|codigo civil)$/, nome: 'Código Civil', max: 2046 },
  { re: /^(?:cdc|codigo de defesa do consumidor)$/, nome: 'CDC', max: 119 },
  { re: /^clt$/, nome: 'CLT', max: 922 },
  { re: /^ctn$/, nome: 'CTN', max: 218 },
  { re: /^(?:cf|constituicao federal)$/, nome: 'CF', max: 250 }
];

function regraLegislacao(texto: string, corpus: Corpus, saida: Intervencao[]): string {
  const normCorpus = semAcento(corpus.texto);

  let t = reescrever(
    texto,
    /\b(Lei Complementar|Lei Ordinária|Lei|Decreto-Lei|Decreto|Medida Provisória|LC|MP)\s*(?:n(?:[.º°]|o)?\.?\s*)?(\d{1,3}(?:\.\d{3})?|\d{1,4})(?:\s*\/\s*(\d{2,4}))?/g,
    (m, i) => {
      const tipoLei = /complementar|^LC$/i.test(m[1]) ? 'lc' : /decreto-lei/i.test(m[1]) ? 'dl' : /^decreto$/i.test(m[1]) ? 'decreto' : /^m/i.test(m[1]) ? 'mp' : 'lei';
      const num = digitos(m[2]);
      if (LEIS_CONHECIDAS.has(`${tipoLei}:${num}`)) return null;
      if (normCorpus.includes(semAcento(m[0]).replace(/\s+/g, ' ')) || corpus.tokens.has(num)) return null;
      if (jaMarcado(texto, i + m[0].length)) return null;
      saida.push({ tipo: 'lei_conferir', trecho: m[0], acao: 'lei fora do conjunto de dispositivos conhecidos: marcada para conferência' });
      return `${m[0]} [CONFERIR: lei]`;
    }
  );

  t = reescrever(
    t,
    /\bart(?:igos?|s)?\.?\s*(\d{1,2}(?:\.\d{3})|\d{1,4})[º°]?[^.;\n]{0,45}?\s(?:do|da|no|na)\s+(?:novo\s+)?(CPC|Código de Processo Civil|Código Civil|CC|Código de Defesa do Consumidor|CDC|CLT|CTN|CF|Constituição Federal)(?![A-Za-z])/gi,
    (m, i) => {
      const n = Number(m[1].replace(/\./g, ''));
      const regra = MAX_ARTIGO.find(r => r.re.test(semAcento(m[2])));
      if (!regra || n <= regra.max) return null;
      if (jaMarcado(t, i + m[0].length)) return null;
      saida.push({ tipo: 'artigo_conferir', trecho: curto(m[0]), acao: `artigo acima do último do ${regra.nome}: marcado para conferência` });
      return `${m[0]} [CONFERIR: artigo inexistente no ${regra.nome}]`;
    }
  );

  // Súmulas e temas repetitivos: sempre para conferência (número e conteúdo são facilmente trocados por IA).
  t = reescrever(
    t,
    /\b(?:Súmulas?(?: Vinculante)?|Temas?(?: Repetitivo)?)\s*(?:n(?:[.º°]|o)?\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:\s*(?:do|da)\s*(?:STJ|STF|TST|TRF\d?|TJ[A-Z]{2}))?/g,
    (m, i) => {
      // Sempre marca, mesmo que o número tenha vindo do próprio advogado: o conteúdo atribuído à súmula não é verificado.
      if (jaMarcado(t, i + m[0].length)) return null;
      saida.push({ tipo: 'sumula_conferir', trecho: m[0], acao: 'súmula/tema marcado para conferência' });
      return `${m[0]} [CONFERIR: súmula ou tema]`;
    }
  );
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// (a) Nomes
// ---------------------------------------------------------------------------------------------------------------

/** Palavras capitalizadas que são vocabulário jurídico, siglas ou lugares, e não nomes de pessoas ou empresas. */
const NAO_NOME = new Set(
  (
    'tribunal justica juizo juiz juiza vara civel civil federal estadual superior codigo constituicao lei artigo estado republica federativa brasil ' +
    'direito processo processual excelentissimo excelentissima senhor senhora doutor doutora dr dra meritissimo requerente requerido requerida ' +
    'autor autora reu re exequente executado executada agravante agravado agravada apelante apelado apelada embargante embargado embargada ' +
    'notificante notificado notificada ministerio publico defensoria fazenda nacional municipal distrito comarca foro central regional trabalho ' +
    'turma camara secao relator relatora ministro ministra desembargador desembargadora recurso especial extraordinario apelacao agravo ' +
    'instrumento embargos declaracao contestacao replica peticao inicial pedidos pedido merito preliminares preliminar provas fecho termos ' +
    'nestes pede deferimento local data advogado advogada oab sumula tema supremo egregio colendo ilustre nobre emerito brasileira brasileiro ' +
    'casado casada solteiro solteira divorciado divorciada portador portadora inscrito inscrita residente domiciliado domiciliada endereco ' +
    'senhoria excelencia vossa vosso fato fatos razoes reforma sentenca decisao despacho intimacao manifestacao requerimentos requerimento ' +
    'qualificacao introducao sintese cabimento tempestividade preparo documentos obrigatorios efeito suspensivo tutela recursal ' +
    'identificacao partes obrigacao fundamento prazo cumprimento consequencias descumprimento exposicao ' +
    'sao santa santo rio grande norte sul janeiro janeiro paulo minas gerais bahia parana pernambuco ceara goias para amazonas ' +
    'acre alagoas amapa espirito maranhao mato grosso paraiba piaui rondonia roraima sergipe tocantins catarina distrito ' +
    'segunda terceira quarta quinta primeira quarto turmas ' +
    'janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro ' +
    'cpc cc cdc clt ctn cf cpf cnpj stj stf tst tj trf trt ltda sa me epp eireli ' +
    'ac al am ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to ' +
    'procuradoria geral defesa consumidor procon receita secretaria prefeitura municipio conselho agencia previdencia social inss caixa economica ' +
    'dos das nos nas aos ao pelo pela pelos pelas neste nesta esta este isso diante conforme segundo assim ademais portanto ' +
    'contudo todavia entretanto outrossim pois logo ocorre houve nao sim caso quando onde como porque'
  ).split(/\s+/)
);

function mascarar(texto: string): string {
  // Cabeçalhos de seção e trechos entre colchetes não entram na busca de nomes (mesmo comprimento, para manter os índices).
  return texto
    .replace(/^#{1,3}[^\n]*$/gm, l => ' '.repeat(l.length))
    // Subtítulos numerados em Title Case ("III - Da Redução do Valor"): não são nomes.
    .replace(/^[ \t]*(?:[IVXL]+|\d+)[ \t]*[-–.)][ \t]+[^\n]{0,110}$/gm, l => (/[.!?;:]$/.test(l.trim()) ? l : ' '.repeat(l.length)))
    // Subtítulo dobrado pelo código ("Título:" sozinho na linha).
    .replace(/^[^\n]{1,100}:[ \t]*$/gm, l => ' '.repeat(l.length))
    .replace(/\[[^\]]*\]/g, l => ' '.repeat(l.length));
}

export interface NomeSuspeito {
  nome: string;
  /** Posição logo depois da última palavra da sequência no texto original. */
  fim: number;
}

/** Sequências de palavras capitalizadas (ou em caixa alta) que lembram nome de pessoa/empresa e não constam nos dados. */
export function acharNomesSuspeitos(texto: string, corpus: Corpus): NomeSuspeito[] {
  const m = mascarar(texto);
  const palavras: { texto: string; ini: number; fim: number }[] = [];
  for (const x of m.matchAll(/\p{Lu}[\p{L}'’]+/gu)) palavras.push({ texto: x[0], ini: x.index ?? 0, fim: (x.index ?? 0) + x[0].length });

  const achados: NomeSuspeito[] = [];
  let i = 0;
  while (i < palavras.length) {
    let j = i;
    while (
      j + 1 < palavras.length &&
      /^[ \t]+(?:(?:de|da|do|das|dos|e)[ \t]+)?$/.test(m.slice(palavras[j].fim, palavras[j + 1].ini))
    )
      j++;
    const run = palavras.slice(i, j + 1);
    i = j + 1;

    const antes = m.slice(0, run[0].ini);
    const inicioDeFrase =
      (/(?:^|[.!?:;]\s+|\n\s*)$/.test(antes) && !/\b(?:Dr|Dra|Sr|Sra|Min|Des|Exmo|Exma|Ilmo|Ilma|Rel|Prof|Eng|Adv)\.\s+$/i.test(antes)) || antes.trim() === '';
    let candidatas = run.filter(p => !NAO_NOME.has(semAcento(p.texto)));
    if (candidatas.length === 0) continue;
    if (inicioDeFrase && candidatas[0] === run[0] && !corpus.palavras.has(semAcento(run[0].texto))) candidatas = candidatas.slice(1);
    if (candidatas.length < 2) continue;
    if (candidatas.every(p => corpus.palavras.has(semAcento(p.texto)))) continue;
    achados.push({ nome: candidatas.map(p => p.texto).join(' '), fim: run[run.length - 1].fim });
  }
  return achados;
}

function regraNomes(texto: string, corpus: Corpus, saida: Intervencao[]): string {
  const achados = acharNomesSuspeitos(texto, corpus).filter(a => !jaMarcado(texto, a.fim));
  let t = texto;
  for (const a of [...achados].sort((x, y) => y.fim - x.fim)) {
    saida.push({ tipo: 'nome_conferir', trecho: a.nome, acao: 'nome que não consta nos dados informados: marcado para conferência' });
    t = `${t.slice(0, a.fim)} [CONFERIR: nome não consta nos dados informados]${t.slice(a.fim)}`;
  }
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// Estrutura e processamento
// ---------------------------------------------------------------------------------------------------------------

function limparFormatacao(texto: string): string {
  return texto
    .replace(/\r/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`\n]+)`/g, (_m, c: string) => c)
    .split('\n')
    .filter(l => !/minuta gerada por ia/i.test(l))
    .join('\n');
}

/** Ordena as seções do modelo conforme as obrigatórias do tipo; as que faltam viram campo a preencher. */
export function organizarSecoes(texto: string, obrigatorias: string[], saida: Intervencao[]): SecaoPeca[] {
  let secoes = parsearSecoes(texto);
  if (secoes.length === 0 && texto.trim()) secoes = [{ titulo: obrigatorias[0], texto: texto.trim() }];

  const chaves = obrigatorias.map(chaveTitulo);
  const final: SecaoPeca[] = obrigatorias.map(titulo => ({ titulo, texto: '' }));
  const preenchida = obrigatorias.map(() => false);
  let ultima = -1;
  const soltas: string[] = [];

  // Cabeçalhos extras (subtítulos que o modelo escreveu com "## ") são dobrados dentro da seção anterior,
  // para a estrutura ficar sempre igual à do catálogo.
  for (const s of secoes) {
    const n = chaves.indexOf(chaveTitulo(s.titulo));
    if (n >= 0 && !preenchida[n]) {
      final[n].texto = s.texto;
      preenchida[n] = true;
      ultima = n;
    } else if (s.texto.trim()) {
      const bloco = `${s.titulo.replace(/[\s:]+$/, '')}:\n${s.texto}`;
      if (ultima >= 0) final[ultima].texto += `${final[ultima].texto ? '\n\n' : ''}${bloco}`;
      else soltas.push(bloco);
    }
  }
  if (soltas.length) final[0].texto = `${soltas.join('\n\n')}${final[0].texto ? '\n\n' : ''}${final[0].texto}`;

  return final.map((s, n) => {
    if (s.texto.trim()) return s;
    saida.push({ tipo: 'secao_ausente', trecho: obrigatorias[n], acao: 'seção obrigatória não gerada: incluída como campo a preencher' });
    return { titulo: s.titulo, texto: `[PREENCHER: seção "${s.titulo}" não gerada pela IA; redigir]` };
  });
}

export interface ContextoSeguranca {
  corpus: Corpus;
  citacoes: CitacaoPermitida[];
  /** Cabeçalhos obrigatórios do tipo de peça; sem isso a estrutura não é conferida. */
  secoes?: string[];
}

/** Aplica as regras de segurança ao texto bruto do modelo e devolve a minuta final (com o aviso) e o que foi mudado. */
export function processar(textoBruto: string, ctx: ContextoSeguranca): { conteudo: string; intervencoes: Intervencao[]; secoesAusentes: string[] } {
  const intervencoes: Intervencao[] = [];
  let t = limparFormatacao(textoBruto);
  t = regraJulgados(t, ctx.citacoes, ctx.corpus, intervencoes);
  t = regraDados(t, ctx.corpus, intervencoes);
  t = regraLegislacao(t, ctx.corpus, intervencoes);
  t = regraNomes(t, ctx.corpus, intervencoes);

  const antes = intervencoes.length;
  const secoes = ctx.secoes ? organizarSecoes(t, ctx.secoes, intervencoes) : parsearSecoes(t);
  const secoesAusentes = intervencoes.slice(antes).filter(i => i.tipo === 'secao_ausente').map(i => i.trecho);
  const conteudo = secoes.length ? montarConteudo(secoes) : `${AVISO}\n\n${t.trim()}\n`;
  return { conteudo, intervencoes, secoesAusentes };
}

/** Pós-condição: o que ainda precisaria de intervenção num texto já tratado. Vazio = texto em conformidade. */
export function auditar(conteudo: string, ctx: ContextoSeguranca): Intervencao[] {
  const { intervencoes } = processar(conteudo, ctx);
  return intervencoes;
}
