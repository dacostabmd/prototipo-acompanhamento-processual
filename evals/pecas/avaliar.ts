/**
 * Avaliação automática dos modelos de peças (lib/pecas/geracao.ts).
 *
 * Gera cada caso de casos.ts com o modelo real (mesmo prompt, modelo e pós-processamento da produção) usando dados
 * de entrada FIXOS e uma lista fixa de julgados de teste (não toca no banco) e aplica checagens DETERMINÍSTICAS
 * (checagens.ts): aviso, [PREENCHER] quando faltam dados, julgado fora da lista, dado/nome inventado, seções
 * obrigatórias, tamanho, formato e pós-condição de segurança.
 *
 * Além de aprovado/reprovado, mede quanto o modelo precisou ser corrigido pelo código ("limpo" = nada a corrigir),
 * que é o que diz se o prompt está funcionando por si só.
 *
 * Uso:  npm run eval:pecas                         (todos os casos)
 *       npm run eval:pecas -- --so apelacao        (filtra por tipo ou trecho do id)
 *       npm run eval:pecas -- --rodada v2          (nome do arquivo de resultados)
 *       npm run eval:pecas -- --amostra            (imprime a minuta de cada caso)
 *
 * Saída: evals/pecas/resultados/<rodada>.json e .md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gerarPeca, corpusDeEntrada } from '@/lib/pecas/geracao';
import { obterModelo } from '@/lib/pecas/modelos';
import { CASOS, JULGADOS_TESTE, type Caso } from './casos';
import { rodarAutotestes } from './autoteste';
import { checar, type Falha } from './checagens';

const DIR = join(process.cwd(), 'evals', 'pecas');
const CONCORRENCIA = 3;

interface Resultado {
  id: string;
  tipo: string;
  descricao: string;
  aprovado: boolean;
  limpo: boolean;
  falhas: Falha[];
  intervencoes: { tipo: string; trecho: string }[];
  brutoViolacoes: Record<string, number>;
  tokensEntrada: number;
  tokensSaida: number;
  latenciaMs: number;
  modelo: string;
  chars: number;
  conteudo: string;
  erro?: string;
}

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function rodarCaso(caso: Caso): Promise<Resultado> {
  const modelo = obterModelo(caso.tipo)!;
  const citacoes = (caso.julgados ?? []).map(k => JULGADOS_TESTE[k]);
  const base: Resultado = {
    id: caso.id,
    tipo: caso.tipo,
    descricao: caso.descricao,
    aprovado: false,
    limpo: false,
    falhas: [],
    intervencoes: [],
    brutoViolacoes: {},
    tokensEntrada: 0,
    tokensSaida: 0,
    latenciaMs: 0,
    modelo: '',
    chars: 0,
    conteudo: ''
  };
  try {
    const params = {
      tipo: caso.tipo,
      campos: caso.campos,
      contextoProcesso: caso.contexto,
      processoNumero: caso.contexto ? /Número: (\S+)/.exec(caso.contexto)?.[1] ?? null : null,
      jurisprudenciaSolicitada: caso.jurisprudencia ?? false,
      citacoes,
      rastrear: false
    };
    const r = await gerarPeca(params);
    const c = checar({
      modelo,
      bruto: r.bruto,
      final: r.conteudo,
      corpus: corpusDeEntrada({ ...params, citacoes: caso.jurisprudencia ? citacoes : [] }),
      citacoes: caso.jurisprudencia ? citacoes : [],
      esperaCitar: caso.esperaCitar,
      esperaPreencherCom: caso.esperaPreencherCom,
      proibidoNoTexto: caso.proibidoNoTexto,
      marcadoParaConferir: caso.marcadoParaConferir
    });
    return {
      ...base,
      aprovado: c.falhas.length === 0,
      limpo: r.intervencoes.length === 0,
      falhas: c.falhas,
      intervencoes: r.intervencoes.map(i => ({ tipo: i.tipo, trecho: i.trecho })),
      brutoViolacoes: c.brutoViolacoes,
      tokensEntrada: r.tokensEntrada,
      tokensSaida: r.tokensSaida,
      latenciaMs: r.latenciaMs,
      modelo: r.modelo,
      chars: r.conteudo.length,
      conteudo: r.conteudo
    };
  } catch (e) {
    return { ...base, erro: e instanceof Error ? e.message : String(e), falhas: [{ checagem: 'execucao', detalhe: e instanceof Error ? e.message : String(e) }] };
  }
}

async function main() {
  // Fase 1 (offline, sem IA): regras de segurança do código contra saídas sintéticas com violações plantadas.
  const auto = rodarAutotestes();
  console.log(`Autotestes do pós-processamento: ${auto.total - auto.falhas.length}/${auto.total}`);
  for (const f of auto.falhas) console.log(`  FALHA ${f}`);
  if (process.argv.includes('--so-autoteste')) {
    process.exitCode = auto.falhas.length ? 1 : 0;
    return;
  }
  console.log('');

  const filtro = argumento('so');
  const rodada = argumento('rodada') ?? `rodada-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`;
  const casos = CASOS.filter(c => !filtro || c.tipo === filtro || c.id.includes(filtro));
  if (casos.length === 0) {
    console.error(`Nenhum caso para o filtro "${filtro}".`);
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.error('Defina OPENAI_API_KEY (ou ANTHROPIC_API_KEY) no ambiente (.env.local).');
    process.exit(1);
  }

  console.log(`Avaliando ${casos.length} caso(s)...\n`);
  const resultados: Resultado[] = new Array(casos.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCORRENCIA, casos.length) }, async () => {
      while (proximo < casos.length) {
        const i = proximo++;
        const r = await rodarCaso(casos[i]);
        resultados[i] = r;
        const marca = r.aprovado ? 'OK   ' : 'FALHA';
        console.log(`${marca} ${r.id.padEnd(40)} ${String(r.chars).padStart(6)} car  ${String(r.tokensSaida).padStart(5)} tok  ${(r.latenciaMs / 1000).toFixed(1)}s  correções: ${r.intervencoes.length}`);
        for (const f of r.falhas) console.log(`        - [${f.checagem}] ${f.detalhe}`);
        if (process.argv.includes('--amostra')) console.log(`\n${r.conteudo}\n`);
      }
    })
  );

  const aprovados = resultados.filter(r => r.aprovado).length;
  const limpos = resultados.filter(r => r.limpo && !r.erro).length;
  const soma = (f: (r: Resultado) => number) => resultados.reduce((s, r) => s + f(r), 0);
  const bruto = (k: string) => soma(r => r.brutoViolacoes[k] ?? 0);
  const casosBruto = (k: string) => resultados.filter(r => (r.brutoViolacoes[k] ?? 0) > 0).length;
  const porChecagem = new Map<string, string[]>();
  for (const r of resultados) for (const f of r.falhas) porChecagem.set(f.checagem, [...(porChecagem.get(f.checagem) ?? []), r.id]);

  console.log('\n=== RESUMO ===');
  console.log(`Aprovados: ${aprovados}/${resultados.length} (${Math.round((aprovados / resultados.length) * 100)}%)`);
  console.log(`Sem nenhuma correção do código ("limpos"): ${limpos}/${resultados.length}`);
  console.log(
    `Texto bruto do modelo (antes do pós-processamento): julgado fora da lista em ${casosBruto('julgadosForaDaLista')} caso(s), dado fora da entrada em ${casosBruto('dadosForaDaEntrada')}, ` +
      `seção faltando em ${casosBruto('secoesFaltando')}, nome suspeito em ${casosBruto('nomesSuspeitos')}`
  );
  console.log(`Tokens: ${soma(r => r.tokensEntrada)} entrada, ${soma(r => r.tokensSaida)} saída`);
  if (porChecagem.size) {
    console.log('Falhas por checagem:');
    for (const [k, ids] of porChecagem) console.log(`  ${k}: ${ids.length} (${ids.join(', ')})`);
  }

  mkdirSync(join(DIR, 'resultados'), { recursive: true });
  writeFileSync(join(DIR, 'resultados', `${rodada}.json`), JSON.stringify({ rodada, aprovados, total: resultados.length, limpos, resultados }, null, 2));
  const md = [
    `# Avaliação de peças - ${rodada}`,
    '',
    `Aprovados: **${aprovados}/${resultados.length}**. Limpos (sem correção do código): ${limpos}/${resultados.length}.`,
    '',
    '| Caso | Tipo | Resultado | Correções | Falhas |',
    '|---|---|---|---|---|',
    ...resultados.map(r => `| ${r.id} | ${r.tipo} | ${r.aprovado ? 'OK' : 'FALHA'} | ${r.intervencoes.length} | ${r.falhas.map(f => `${f.checagem}: ${f.detalhe}`).join('; ').replace(/\|/g, '/') || '-'} |`)
  ].join('\n');
  writeFileSync(join(DIR, 'resultados', `${rodada}.md`), md);
  console.log(`\nResultados em evals/pecas/resultados/${rodada}.json e .md`);
  process.exitCode = aprovados === resultados.length && auto.falhas.length === 0 ? 0 : 1;
}

void main();
