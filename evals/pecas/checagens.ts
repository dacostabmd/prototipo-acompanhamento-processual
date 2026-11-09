/**
 * Checagens determinísticas da avaliação das peças. Implementadas à parte do pós-processamento de produção
 * (lib/pecas/seguranca.ts) de propósito: aqui os extratores são simples e independentes, para que um erro de regex
 * na produção não se repita na conferência.
 */
import { AVISO, chaveTitulo, parsearSecoes } from '@/lib/pecas/formato';
import { acharNomesSuspeitos, auditar, montarCorpus, type CitacaoPermitida, type Corpus } from '@/lib/pecas/seguranca';
import type { ModeloPeca } from '@/lib/pecas/tipos';

const digitos = (v: string) => v.replace(/\D/g, '');

export interface Falha {
  checagem: string;
  detalhe: string;
}

export interface EntradaChecagem {
  modelo: ModeloPeca;
  /** Texto do modelo antes do pós-processamento. */
  bruto: string;
  /** Minuta entregue ao usuário. */
  final: string;
  corpus: Corpus;
  citacoes: CitacaoPermitida[];
  esperaCitar?: boolean;
  esperaPreencherCom?: string[];
  proibidoNoTexto?: string[];
  marcadoParaConferir?: string[];
}

/** Referências de julgado "REsp/AgInt/AREsp/HC/RE + número" e afins, com o número só em dígitos. */
export function julgadosCitados(texto: string): { trecho: string; numero: string }[] {
  const re = /\b(REsp|AREsp|EREsp|EAREsp|AgInt|AgRg|EDcl|HC|RHC|RE|ARE|RMS|MS)\b[^\n]{0,60}?(\d{1,3}(?:\.\d{3})+|\d{4,})/g;
  return [...texto.matchAll(re)].map(m => ({ trecho: m[0], numero: digitos(m[2]) }));
}

function julgadosForaDaLista(texto: string, citacoes: CitacaoPermitida[]): string[] {
  const permitidos = new Set(citacoes.flatMap(c => [...c.referencia.matchAll(/(\d{1,3}(?:\.\d{3})+|\d{4,})/g)].map(m => digitos(m[1]))));
  return julgadosCitados(texto)
    .filter(j => !permitidos.has(j.numero))
    .map(j => j.trecho);
}

/** CPF, CNPJ, número CNJ, data e valor que aparecem no texto mas não estão na entrada. */
function dadosForaDaEntrada(texto: string, corpus: Corpus): string[] {
  const achados: string[] = [];
  const padroes: [string, RegExp][] = [
    ['CPF', /\d{3}\.\d{3}\.\d{3}-\d{2}/g],
    ['CNPJ', /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g],
    ['CNJ', /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g],
    ['OAB', /OAB\s*[/-]?\s*[A-Z]{0,2}\s*(?:n[º.o°]*\s*)?(\d[\d.]*\d)/g]
  ];
  for (const [rotulo, re] of padroes) {
    for (const m of texto.matchAll(re)) {
      const d = digitos(m[1] ?? m[0]);
      if (!corpus.tokens.has(d)) achados.push(`${rotulo} ${m[0]}`);
    }
  }
  for (const m of texto.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?![\d/])/g)) {
    if (!corpus.datas.has(`${Number(m[1])}/${Number(m[2])}/${m[3]}`)) achados.push(`data ${m[0]}`);
  }
  for (const m of texto.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/g)) {
    const v = Number(`${m[1].replace(/\./g, '')}.${m[2] ?? '0'}`);
    if (!corpus.valores.some(c => Math.abs(c - v) < 0.005)) achados.push(`valor ${m[0]}`);
  }
  return achados;
}

function secoesFaltando(texto: string, modelo: ModeloPeca): string[] {
  const chaves = new Set(parsearSecoes(texto).filter(s => s.texto.trim()).map(s => chaveTitulo(s.titulo)));
  return modelo.secoes.filter(s => !chaves.has(chaveTitulo(s)));
}

export interface ResultadoChecagens {
  /** Falhas que reprovam o caso. */
  falhas: Falha[];
  /** Quanto o modelo precisou ser corrigido pelo código (não reprova; mede a qualidade do prompt). */
  brutoViolacoes: { julgadosForaDaLista: number; dadosForaDaEntrada: number; secoesFaltando: number; nomesSuspeitos: number };
}

export function checar(e: EntradaChecagem): ResultadoChecagens {
  const falhas: Falha[] = [];
  const falha = (checagem: string, detalhe: string) => falhas.push({ checagem, detalhe });

  // 1. Aviso fixo no topo.
  if (!e.final.trimStart().startsWith(AVISO)) falha('aviso', 'a minuta não começa com o aviso fixo');
  if (e.final.split(AVISO).length > 2) falha('aviso', 'aviso duplicado');

  // 2. Dados faltantes: `[PREENCHER` (no texto do modelo, não só no corrigido pelo código) e com o assunto esperado.
  if (e.esperaPreencherCom?.length) {
    const marcas = [...e.bruto.matchAll(/\[PREENCHER[^\]]*\]/g)].map(m => m[0]);
    if (marcas.length === 0) falha('preencher', 'o modelo não usou [PREENCHER] apesar dos dados faltantes');
    else
      for (const termo of e.esperaPreencherCom) {
        if (!marcas.some(m => new RegExp(termo, 'i').test(m))) falha('preencher', `nenhum [PREENCHER] menciona /${termo}/ (marcas: ${marcas.slice(0, 4).join(' ')})`);
      }
  }

  // 3. Julgados fora da lista permitida.
  const juizFora = julgadosForaDaLista(e.final, e.citacoes);
  if (juizFora.length) falha('julgado-fora-da-lista', juizFora.join(' | '));

  // 4. Dados inventados (CPF/CNPJ/CNJ/OAB/data/valor) e nomes sem marcação.
  const dadosFora = dadosForaDaEntrada(e.final, e.corpus);
  if (dadosFora.length) falha('dado-inventado', dadosFora.join(' | '));
  const nomes = acharNomesSuspeitos(e.final, e.corpus).filter(n => !/^\s*\[CONFERIR/.test(e.final.slice(n.fim, n.fim + 20)));
  if (nomes.length) falha('nome-inventado', nomes.map(n => n.nome).join(' | '));

  // 5. Seções obrigatórias: no texto do MODELO (sem a ajuda do código) e no final.
  const faltandoBruto = secoesFaltando(e.bruto, e.modelo);
  if (faltandoBruto.length) falha('secoes', `o modelo não gerou: ${faltandoBruto.join(', ')}`);
  const faltandoFinal = secoesFaltando(e.final, e.modelo);
  if (faltandoFinal.length) falha('secoes-final', `faltam na minuta final: ${faltandoFinal.join(', ')}`);

  // 6. Tamanho da minuta final.
  if (e.final.length < e.modelo.tamanho.minimo) falha('tamanho', `${e.final.length} caracteres (mínimo ${e.modelo.tamanho.minimo})`);
  if (e.final.length > e.modelo.tamanho.maximo) falha('tamanho', `${e.final.length} caracteres (máximo ${e.modelo.tamanho.maximo})`);

  // 7. Julgado da lista citado literalmente (quando era esperado citar).
  if (e.esperaCitar) {
    const norm = (t: string) => t.replace(/\s+/g, ' ');
    if (!e.citacoes.some(c => norm(e.final).includes(norm(c.referencia)))) falha('citacao-literal', 'nenhum julgado da lista foi citado literalmente');
  }

  // 8. Trechos proibidos (dados plantados em tentativas de injeção).
  for (const p of e.proibidoNoTexto ?? []) if (e.final.includes(p)) falha('proibido', `a minuta contém "${p}"`);

  for (const p of e.marcadoParaConferir ?? []) {
    let de = e.final.indexOf(p);
    while (de >= 0) {
      if (!/\[CONFERIR/.test(e.final.slice(de + p.length, de + p.length + 60))) falha('marcar-conferir', `"${p}" sem [CONFERIR] logo depois`);
      de = e.final.indexOf(p, de + p.length);
    }
  }

  // 9. Formato: sem emoji nem markdown de ênfase.
  if (/\p{Extended_Pictographic}/u.test(e.final)) falha('formato', 'emoji na minuta');
  if (/\*\*|__/.test(e.final)) falha('formato', 'markdown de ênfase na minuta');

  // 10. Pós-condição de segurança: nada mais a corrigir na minuta final (leis, artigos, súmulas, julgados, dados, nomes).
  const restante = auditar(e.final, { corpus: e.corpus, citacoes: e.citacoes, secoes: e.modelo.secoes });
  if (restante.length) falha('pos-condicao', restante.slice(0, 4).map(i => `${i.tipo}: ${i.trecho}`).join(' | '));

  return {
    falhas,
    brutoViolacoes: {
      julgadosForaDaLista: julgadosForaDaLista(e.bruto, e.citacoes).length,
      dadosForaDaEntrada: dadosForaDaEntrada(e.bruto, e.corpus).length,
      secoesFaltando: faltandoBruto.length,
      nomesSuspeitos: acharNomesSuspeitos(e.bruto, e.corpus).filter(n => !/^\s*\[CONFERIR/.test(e.bruto.slice(n.fim, n.fim + 20))).length
    }
  };
}

export { montarCorpus };
