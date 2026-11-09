/**
 * Ingestão de jurisprudência (Frente E) a partir dos Dados Abertos do STJ ("espelhos de acórdãos", licença CC-BY).
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/ingestao-jurisprudencia.ts --limite=2000 --desde=2025-11-01
 *
 * Opções:
 *   --limite=N         máximo de acórdãos a gravar nesta execução (padrão: sem limite)
 *   --desde=YYYY-MM-DD só acórdãos julgados a partir desta data (padrão: 12 meses atrás)
 *   --orgaos=a,b       slugs de órgãos (ex.: terceira-turma,quarta-turma). Padrão: todos
 *   --lote=N           tamanho do lote de embeddings/upsert (padrão: 50)
 *   --dry-run          baixa e normaliza, imprime 3 registros e a estimativa de custo; NÃO acessa banco nem OpenAI
 *   --estimar          só consulta os metadados do portal (sem baixar os JSONs) e estima volume e custo
 *
 * Retomável: o upsert é idempotente (fonte + id_externo) e registros que já têm embedding são pulados
 * sem novo custo. Os JSONs baixados ficam em cache no diretório temporário do sistema.
 * Fonte pública: https://dadosabertos.web.stj.jus.br (CKAN). Os arquivos mensais trazem só as atualizações
 * posteriores ao arquivo anterior; o mesmo acórdão pode aparecer em dois arquivos (deduplicado por id).
 * Os ZIPs de histórico (até 2022-05) não são tratados aqui.
 */
import { createClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nomePropio } from '../components/jurisprudencia/utils';

const CKAN = 'https://dadosabertos.web.stj.jus.br/api/3/action/package_show?id=';
const ORGAOS = [
  'corte-especial',
  'primeira-secao',
  'segunda-secao',
  'terceira-secao',
  'primeira-turma',
  'segunda-turma',
  'terceira-turma',
  'quarta-turma',
  'quinta-turma',
  'sexta-turma'
];
const PAUSA_DOWNLOAD_MS = 2000;
const PAUSA_LOTE_MS = 300;
const PRECO_EMBEDDING_POR_MILHAO_USD = 0.02; // text-embedding-3-small
const CHARS_POR_TOKEN = 3.6; // estimativa para português
const LIMITE_TEXTO_EMBEDDING = 6000;
const LIMITE_TEXTO_COMPLEMENTAR = 3000;
/** Média observada nos JSONs do STJ (Terceira Turma, set/2026): ~3,0 KB por acórdão. */
const BYTES_POR_ACORDAO = 3000;
/** Estimativa por linha no banco: vetor 1536 x float4 (~6 KB) + ementa/texto/tsv (~4 KB) + índices HNSW/GIN (~7 KB). */
const BYTES_POR_LINHA_BANCO = 17_000;

// ---------------------------------------------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------------------------------------------

function arg(nome: string): string | undefined {
  const pref = `--${nome}=`;
  return process.argv.find(a => a.startsWith(pref))?.slice(pref.length);
}
const flag = (nome: string) => process.argv.includes(`--${nome}`);

const limite = arg('limite') ? Number.parseInt(arg('limite')!, 10) : Number.POSITIVE_INFINITY;
const lote = Math.min(Math.max(Number.parseInt(arg('lote') || '50', 10) || 50, 1), 200);
const dryRun = flag('dry-run');
const estimar = flag('estimar');
const orgaos = (arg('orgaos') || ORGAOS.join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const desde = arg('desde') || (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
})();
if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) throw new Error('--desde deve estar no formato YYYY-MM-DD');
const desdeCompacto = desde.replace(/-/g, '');

// ---------------------------------------------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------------------------------------------

interface RegistroStj {
  id: string;
  numeroProcesso?: string | null;
  numeroRegistro?: string | null;
  siglaClasse?: string | null;
  descricaoClasse?: string | null;
  nomeOrgaoJulgador?: string | null;
  ministroRelator?: string | null;
  dataPublicacao?: string | null;
  ementa?: string | null;
  tipoDeDecisao?: string | null;
  dataDecisao?: string | null;
  decisao?: string | null;
  informacoesComplementares?: string | null;
  teseJuridica?: string | null;
  tema?: string | number | null;
  referenciasLegislativas?: unknown;
  notas?: string | null;
  termosAuxiliares?: string | null;
}

export interface LinhaJurisprudencia {
  fonte: 'stj';
  id_externo: string;
  tribunal: 'STJ';
  tipo: string;
  classe: string | null;
  numero: string | null;
  relator: string | null;
  orgao_julgador: string | null;
  data_julgamento: string | null;
  data_publicacao: string | null;
  ementa: string;
  texto: string | null;
  fonte_url: string | null;
  metadata: Record<string, unknown>;
}

const limpar = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const nulo = (s: string): string | null => (s ? s : null);

/** '20260824' -> '2026-08-24' */
function dataCompacta(v: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec((v ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** 'DJEN       DATA:27/08/2026' -> '2026-08-27' */
function dataDePublicacao(v: string | null | undefined): string | null {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(v ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function normalizar(r: RegistroStj): LinhaJurisprudencia | null {
  const ementa = limpar(r.ementa);
  if (!r.id || ementa.length < 20) return null;

  const dataJulg = dataCompacta(r.dataDecisao);
  const dataPub = dataDePublicacao(r.dataPublicacao);
  const registro = limpar(r.numeroRegistro);

  // Link oficial do inteiro teor (mesmo padrão do site de jurisprudência do STJ).
  const fonteUrl =
    registro && dataPub
      ? `https://processo.stj.jus.br/processo/julgamento/eletronico/documento/mediado/?documento_tipo=integra&documento_sequencial=${encodeURIComponent(
          String(r.id)
        )}&registro_numero=${encodeURIComponent(registro)}&peticao_numero=&publicacao_data=${dataPub.replace(/-/g, '')}&formato=PDF`
      : registro
      ? `https://processo.stj.jus.br/SCON/pesquisar.jsp?livre=${encodeURIComponent(registro)}`
      : null;

  const tese = limpar(r.teseJuridica);
  // O STJ preenche "Aguardando análise." enquanto o espelho não recebe o tratamento documentário.
  const complementarBruto = limpar(r.informacoesComplementares);
  const complementar = /^aguardando an[aá]lise\.?$/i.test(complementarBruto) ? '' : complementarBruto;
  const resultado = limpar(r.decisao);
  const texto = [
    tese && `Tese jurídica: ${tese}`,
    complementar && `Informações complementares: ${complementar}`,
    resultado && `Resultado do julgamento: ${resultado}`
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, LIMITE_TEXTO_COMPLEMENTAR);

  const legislacao = Array.isArray(r.referenciasLegislativas)
    ? (r.referenciasLegislativas as unknown[]).map(limpar).filter(Boolean).slice(0, 30)
    : [];

  return {
    fonte: 'stj',
    id_externo: String(r.id),
    tribunal: 'STJ',
    tipo: /MONOCR/i.test(r.tipoDeDecisao ?? '') ? 'decisao_monocratica' : 'acordao',
    classe: nulo(limpar(r.siglaClasse)),
    numero: nulo(limpar(r.numeroProcesso)),
    relator: nulo(nomePropio(limpar(r.ministroRelator))),
    orgao_julgador: nulo(nomePropio(limpar(r.nomeOrgaoJulgador))),
    data_julgamento: dataJulg,
    data_publicacao: dataPub,
    ementa,
    texto: nulo(texto),
    fonte_url: fonteUrl,
    metadata: {
      numero_registro: nulo(registro),
      classe_extenso: nulo(limpar(r.descricaoClasse)),
      publicacao: nulo(limpar(r.dataPublicacao)),
      tema: r.tema ?? null,
      tese_juridica: nulo(tese),
      referencias_legislativas: legislacao,
      notas: nulo(limpar(r.notas).slice(0, 1000)),
      termos_auxiliares: nulo(limpar(r.termosAuxiliares).slice(0, 1000))
    }
  };
}

function textoParaEmbedding(l: LinhaJurisprudencia): string {
  const tese = typeof l.metadata.tese_juridica === 'string' ? ` Tese: ${l.metadata.tese_juridica}` : '';
  const inicio = [l.classe, l.orgao_julgador].filter(Boolean).join(' - ');
  return `${inicio}. ${l.ementa}${tese}`.slice(0, LIMITE_TEXTO_EMBEDDING);
}

const estimarTokens = (chars: number) => Math.ceil(chars / CHARS_POR_TOKEN);
const custoUsd = (tokens: number) => (tokens / 1_000_000) * PRECO_EMBEDDING_POR_MILHAO_USD;

// ---------------------------------------------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------------------------------------------

interface Arquivo {
  orgao: string;
  nome: string; // AAAAMMDD.json
  url: string;
  tamanho: number;
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

async function comRetentativas<T>(rotulo: string, fn: () => Promise<T>, tentativas = 4): Promise<T> {
  let ultimo: unknown;
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimo = e;
      const espera = 3000 * i;
      console.warn(`  ${rotulo} falhou (tentativa ${i}/${tentativas}): ${e instanceof Error ? e.message : e}. Aguardando ${espera / 1000}s`);
      await dormir(espera);
    }
  }
  throw ultimo;
}

async function listarArquivos(orgao: string): Promise<Arquivo[]> {
  const res = await comRetentativas(`CKAN ${orgao}`, async () => {
    const r = await fetch(`${CKAN}espelhos-de-acordaos-${orgao}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<{ result?: { resources?: Array<{ name: string; url: string; size?: number | null; format?: string }> } }>;
  });
  return (res.result?.resources ?? [])
    .filter(r => /^\d{8}\.json$/.test(r.name) && r.name.slice(0, 8) >= desdeCompacto)
    .map(r => ({ orgao, nome: r.name, url: r.url, tamanho: r.size ?? 0 }))
    .sort((a, b) => b.nome.localeCompare(a.nome)); // mais recentes primeiro
}

async function baixar(a: Arquivo): Promise<RegistroStj[]> {
  const dir = path.join(os.tmpdir(), 'jurisprudencia-stj');
  fs.mkdirSync(dir, { recursive: true });
  const cache = path.join(dir, `${a.orgao}-${a.nome}`);
  if (fs.existsSync(cache) && fs.statSync(cache).size > 0) {
    return JSON.parse(fs.readFileSync(cache, 'utf8')) as RegistroStj[];
  }
  const corpo = await comRetentativas(`download ${a.orgao}/${a.nome}`, async () => {
    const r = await fetch(a.url, { signal: AbortSignal.timeout(300_000), headers: { 'User-Agent': 'JusConsulta-ingestao/1.0 (dados abertos)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
  const dados = JSON.parse(corpo) as RegistroStj[];
  fs.writeFileSync(cache, corpo);
  await dormir(PAUSA_DOWNLOAD_MS);
  return dados;
}

// ---------------------------------------------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------------------------------------------

async function modoEstimar() {
  console.log(`Estimativa (sem baixar) — órgãos: ${orgaos.join(', ')} — desde ${desde}`);
  let bytes = 0;
  for (const o of orgaos) {
    const arqs = await listarArquivos(o);
    const b = arqs.reduce((s, a) => s + a.tamanho, 0);
    bytes += b;
    console.log(`  ${o.padEnd(16)} ${String(arqs.length).padStart(3)} arquivos  ${(b / 1e6).toFixed(1).padStart(7)} MB  ~${Math.round(b / BYTES_POR_ACORDAO).toLocaleString('pt-BR')} acórdãos`);
  }
  const registros = Math.round(bytes / BYTES_POR_ACORDAO);
  const tokens = registros * estimarTokens(1700); // ementa média ~1.570 chars + classe/órgão
  console.log(`Total: ${(bytes / 1e6).toFixed(1)} MB, ~${registros.toLocaleString('pt-BR')} acórdãos (sujeito a duplicidade entre arquivos)`);
  console.log(`Embeddings: ~${(tokens / 1e6).toFixed(1)}M tokens, ~US$ ${custoUsd(tokens).toFixed(2)}`);
  console.log(`Armazenamento aproximado no Postgres: ~${Math.round((registros * BYTES_POR_LINHA_BANCO) / 1e6)} MB (vetor + texto + índices HNSW/GIN)`);
}

async function main() {
  if (estimar) return modoEstimar();

  console.log(`Ingestão STJ — órgãos: ${orgaos.join(', ')} — desde ${desde} — limite ${Number.isFinite(limite) ? limite : 'sem limite'}${dryRun ? ' — DRY-RUN' : ''}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!dryRun && (!supabaseUrl || !supabaseKey || !openaiKey)) {
    throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY e OPENAI_API_KEY (use --env-file=.env.local).');
  }
  const db = !dryRun ? createClient(supabaseUrl!, supabaseKey!, { auth: { persistSession: false } }) : null;
  const embeddings = !dryRun ? new OpenAIEmbeddings({ model: 'text-embedding-3-small', apiKey: openaiKey!, batchSize: lote }) : null;

  const vistos = new Set<string>();
  const amostra: LinhaJurisprudencia[] = [];
  let candidatos = 0;
  let gravados = 0;
  let pulados = 0;
  let descartados = 0;
  let tokensTotais = 0;
  const inicio = Date.now();

  async function processarLote(linhas: LinhaJurisprudencia[]) {
    const textos = linhas.map(textoParaEmbedding);
    const tokens = estimarTokens(textos.reduce((s, t) => s + t.length, 0));
    tokensTotais += tokens;

    if (dryRun) {
      gravados += linhas.length;
      return;
    }

    // Retomada: o que já tem embedding no banco não é reprocessado.
    const { data: existentes, error: errEx } = await db!
      .from('ap_jurisprudencia')
      .select('id_externo')
      .eq('fonte', 'stj')
      .in('id_externo', linhas.map(l => l.id_externo))
      .not('embedding', 'is', null);
    if (errEx) throw new Error(`Falha ao consultar existentes: ${errEx.message}`);
    const jaTem = new Set((existentes ?? []).map((e: { id_externo: string }) => e.id_externo));
    const novos = linhas.filter(l => !jaTem.has(l.id_externo));
    pulados += linhas.length - novos.length;
    if (novos.length === 0) return;

    const vetores = await comRetentativas('embeddings', () => embeddings!.embedDocuments(novos.map(textoParaEmbedding)));
    const rows = novos.map((l, i) => ({ ...l, embedding: vetores[i] }));
    const { error } = await db!.from('ap_jurisprudencia').upsert(rows, { onConflict: 'fonte,id_externo' });
    if (error) throw new Error(`Falha no upsert: ${error.message}`);
    gravados += rows.length;
    await dormir(PAUSA_LOTE_MS);
  }

  outer: for (const orgao of orgaos) {
    const arquivos = await listarArquivos(orgao);
    console.log(`\n[${orgao}] ${arquivos.length} arquivo(s) a partir de ${desde}`);
    for (const arq of arquivos) {
      if (candidatos >= limite) break outer;
      process.stdout.write(`  ${arq.nome} (${(arq.tamanho / 1e6).toFixed(1)} MB)... `);
      const registros = await baixar(arq);
      const linhas: LinhaJurisprudencia[] = [];
      for (const r of registros) {
        const l = normalizar(r);
        if (!l) {
          descartados++;
          continue;
        }
        if (vistos.has(l.id_externo)) continue; // duplicidade entre arquivos
        if (l.data_julgamento && l.data_julgamento < desde) continue;
        vistos.add(l.id_externo);
        linhas.push(l);
      }
      const restante = limite - candidatos;
      const util = linhas.slice(0, Math.max(restante, 0));
      candidatos += util.length;
      console.log(`${registros.length} registros, ${util.length} válidos`);
      if (amostra.length < 3) amostra.push(...util.slice(0, 3 - amostra.length));

      for (let i = 0; i < util.length; i += lote) {
        await processarLote(util.slice(i, i + lote));
        const feito = Math.min(i + lote, util.length);
        const seg = Math.round((Date.now() - inicio) / 1000);
        process.stdout.write(`\r    ${feito}/${util.length} | total ${candidatos} | tokens ~${(tokensTotais / 1e6).toFixed(2)}M | custo ~US$ ${custoUsd(tokensTotais).toFixed(3)} | ${seg}s   `);
      }
      if (util.length) process.stdout.write('\n');
    }
  }

  console.log('\n--- Resumo ---');
  console.log(`Acórdãos válidos e únicos: ${candidatos} | descartados (sem ementa): ${descartados}`);
  if (dryRun) {
    console.log(`Dry-run: nada foi gravado. Embeddings estimados: ~${(tokensTotais / 1e6).toFixed(2)}M tokens, ~US$ ${custoUsd(tokensTotais).toFixed(3)}`);
    console.log('\n3 registros normalizados:');
    for (const a of amostra) {
      console.log(JSON.stringify({ ...a, ementa: `${a.ementa.slice(0, 280)}...`, texto: a.texto ? `${a.texto.slice(0, 200)}...` : null }, null, 2));
    }
  } else {
    console.log(`Gravados: ${gravados} | pulados (já indexados): ${pulados} | custo estimado de embeddings: ~US$ ${custoUsd(tokensTotais).toFixed(3)}`);
  }
}

main().catch(e => {
  console.error('\nFalha na ingestão:', e instanceof Error ? e.message : e);
  process.exit(1);
});
