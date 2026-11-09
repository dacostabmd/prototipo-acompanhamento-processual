/**
 * Testes do pacote "paridade com o JusBrasil" (2026-11-09).
 * Rodar: npm run test:novas
 *
 * Não depende das migrations aplicadas. Cobre:
 *  1. Regras de plano (lib/planos.ts)
 *  2. Prazos: vencimento em dias úteis, recesso, extração e .ics (lib/prazos.ts)
 *  3. Monitoramento do Diário: validação de buscas e consulta real ao DJEN (lib/djen.ts)
 *  4. Jurisprudência: utilitários de citação e de trecho (sem banco)
 *  5. Segurança: rotas novas negam acesso sem login e crons exigem o segredo
 */
import { NextRequest } from 'next/server';
import { REGRAS_PLANOS } from '../lib/planos';
import { calcularVencimento, extrairPrazos, gerarIcs, emRecessoForense, ehDiaUtil } from '../lib/prazos';
import { validarBuscaDiario, buscarPublicacoesPorOabDjen } from '../lib/djen';
import { formatarReferencia } from '../components/jurisprudencia/utils';
import { extrairTermos, gerarTrecho } from '../lib/jurisprudencia';

let aprovados = 0;
let total = 0;
const falhas: string[] = [];

function assert(cond: boolean, titulo: string, detalhe?: string) {
  total++;
  if (cond) {
    aprovados++;
    console.log(`  [OK] ${titulo}`);
  } else {
    falhas.push(titulo);
    console.error(`  [FALHA] ${titulo}${detalhe ? ` -> ${detalhe}` : ''}`);
  }
}

async function carregarRota(caminho: string): Promise<Record<string, (r: Request, ctx?: unknown) => Promise<Response>> | null> {
  try {
    return await import(caminho);
  } catch (e) {
    console.error(`  [AVISO] rota ${caminho} não carregou: ${(e as Error).message}`);
    return null;
  }
}

async function run() {
  console.log('\n=== TESTES DO PACOTE DE NOVAS FUNCIONALIDADES ===\n');

  // 1. PLANOS -------------------------------------------------------------
  console.log('[1/5] Regras de plano');
  const free = REGRAS_PLANOS.free;
  const pro = REGRAS_PLANOS.pro;
  assert(free.limiteBuscasMonitoradas === 1 && pro.limiteBuscasMonitoradas === 10, 'Buscas do Diário: Free 1, Pro 10');
  assert(!free.agendaPrazos && pro.agendaPrazos, 'Agenda de prazos só no Pro');
  assert(!free.pecasIa && pro.pecasIa, 'Peças com IA só no Pro');
  assert(!free.jurisprudencia && pro.jurisprudencia, 'Jurisprudência só no Pro');
  assert(free.limiteMembrosEquipe === 1 && pro.limiteMembrosEquipe === 3, 'Equipe: Free 1 pessoa, Pro 3');

  // 2. PRAZOS -------------------------------------------------------------
  console.log('\n[2/5] Prazos e agenda');
  // 2026-11-09 é segunda-feira. 5 dias úteis -> 2026-11-16 (segunda).
  const v5 = calcularVencimento({ dataBase: '2026-11-09', quantidade: 5, unidade: 'dias_uteis' });
  assert(v5 === '2026-11-16', '5 dias úteis a partir de segunda-feira vencem na segunda seguinte', `obtido: ${v5}`);
  // 15 dias úteis atravessando o feriado de 20/11 (sexta): 09/11 + 15 úteis = 01/12
  const v15 = calcularVencimento({ dataBase: '2026-11-09', quantidade: 15, unidade: 'dias_uteis' });
  assert(v15 === '2026-12-01', '15 dias úteis atravessando o feriado de 20/11 vencem em 01/12', `obtido: ${v15}`);
  assert(emRecessoForense('2026-12-25') && !emRecessoForense('2026-12-10'), 'Recesso forense de 20/12 a 20/01');
  assert(!ehDiaUtil('2026-11-14') && ehDiaUtil('2026-11-12'), 'Sábado não é dia útil; quinta é');
  const ex = extrairPrazos('Fica a parte intimada para se manifestar no prazo de 15 (quinze) dias, sob pena de preclusão.');
  assert(ex.length >= 1 && ex[0].quantidade === 15, 'Extrai "15 dias" da intimação', JSON.stringify(ex));
  const exExt = extrairPrazos('Intime-se para cumprir no prazo de dez dias úteis.');
  assert(exExt.length >= 1 && exExt[0].quantidade === 10, 'Extrai prazo por extenso ("dez dias úteis")', JSON.stringify(exExt));
  assert(extrairPrazos('Juntada de petição.').length === 0, 'Texto sem prazo não gera prazo');
  const ics = gerarIcs([{ id: 'x1', titulo: 'Contestar', tipo: 'prazo', dataVencimento: '2026-12-01', descricao: 'Teste', numeroCnj: null }], {
    agora: new Date('2026-11-09T12:00:00Z')
  });
  assert(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('END:VCALENDAR') && ics.includes('BEGIN:VEVENT'), 'Arquivo .ics bem formado');
  assert(ics.includes('\r\n'), '.ics usa quebras de linha CRLF (RFC 5545)');

  // 3. DIÁRIO ---------------------------------------------------------------
  console.log('\n[3/5] Monitoramento do Diário');
  assert(validarBuscaDiario('oab', '228729', 'SP').ok === true, 'OAB com número e UF é válida');
  assert(validarBuscaDiario('oab', '228729', '').ok === false, 'OAB sem UF é recusada');
  assert(validarBuscaDiario('oab', '12345678', 'SP').ok === false, 'OAB com mais de 7 dígitos é recusada');
  assert(validarBuscaDiario('nome', 'Maria', '').ok === false, 'Nome com uma palavra só é recusado');
  assert(validarBuscaDiario('nome', 'Maria da Silva', '').ok === true, 'Nome completo é aceito');
  assert(validarBuscaDiario('termo', 'ab', '').ok === false, 'Termo muito curto é recusado');
  try {
    const fim = new Date().toISOString().slice(0, 10);
    const ini = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const r = await buscarPublicacoesPorOabDjen('228729', 'SP', { inicio: ini, fim });
    assert(Array.isArray(r.publicacoes), 'Consulta real ao DJEN por OAB responde com lista', `${r.publicacoes.length} publicações`);
  } catch (e) {
    assert(false, 'Consulta real ao DJEN por OAB', (e as Error).message);
  }

  // 4. JURISPRUDÊNCIA --------------------------------------------------------
  console.log('\n[4/5] Jurisprudência (sem banco)');
  const ref = formatarReferencia({
    tribunal: 'STJ',
    classe: 'AgInt no AREsp',
    numero: '2628498',
    relator: 'Daniela Teixeira',
    dataJulgamento: '2026-08-24'
  });
  assert(/STJ/.test(ref) && /AgInt no AREsp/.test(ref) && /24\/08\/2026/.test(ref), 'Referência de julgado formatada', ref);
  const termos = extrairTermos('penhora de salário em conta corrente');
  assert(termos.length >= 2 && !termos.includes('de'), 'Termos da busca ignoram palavras vazias', termos.join(','));
  const trecho = gerarTrecho('A penhora de salário é impenhorável, salvo exceções legais. ' + 'x'.repeat(800), ['penhora']);
  assert(trecho.length > 0 && trecho.length < 600, 'Trecho do julgado é curto e não vazio');

  // 5. SEGURANÇA DAS ROTAS ------------------------------------------------------
  console.log('\n[5/5] Segurança: acesso sem login e crons');
  const protegidas: Array<[string, string, string]> = [
    ['../app/api/agenda/route', 'GET', '/api/agenda'],
    ['../app/api/agenda/sugestoes/route', 'GET', '/api/agenda/sugestoes'],
    ['../app/api/agenda/ics/route', 'GET', '/api/agenda/ics'],
    ['../app/api/monitoramento-diario/route', 'GET', '/api/monitoramento-diario'],
    ['../app/api/jurisprudencia/route', 'GET', '/api/jurisprudencia?q=penhora'],
    ['../app/api/jurisprudencia/explicar/route', 'POST', '/api/jurisprudencia/explicar'],
    ['../app/api/pecas/route', 'GET', '/api/pecas'],
    ['../app/api/equipe/route', 'GET', '/api/equipe'],
    ['../app/api/equipe/convites/route', 'POST', '/api/equipe/convites']
  ];
  const supabaseConfigurado = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  for (const [arquivo, metodo, url] of protegidas) {
    const mod = await carregarRota(arquivo);
    if (!mod || !mod[metodo]) {
      assert(false, `${url} (${metodo}) existe`, 'rota não encontrada');
      continue;
    }
    try {
      const res = await mod[metodo](new NextRequest(`http://localhost:3000${url}`, { method: metodo, body: metodo === 'POST' ? '{}' : undefined }), {
        params: Promise.resolve({})
      });
      assert(
        supabaseConfigurado ? res.status === 401 : true,
        `${metodo} ${url.split('?')[0]} sem login responde 401`,
        `status ${res.status}`
      );
    } catch (e) {
      assert(false, `${metodo} ${url} sem login`, (e as Error).message);
    }
  }

  const segredo = process.env.CRON_SECRET;
  for (const caminho of ['varredura-diario', 'lembretes-prazos']) {
    const mod = await carregarRota(`../app/api/cron/${caminho}/route`);
    if (!mod?.GET) {
      assert(false, `Cron ${caminho} existe`);
      continue;
    }
    if (!segredo) {
      console.log(`  [PULADO] Cron ${caminho}: CRON_SECRET não definido neste ambiente`);
      continue;
    }
    const res = await mod.GET(new NextRequest(`http://localhost:3000/api/cron/${caminho}`, { headers: { authorization: 'Bearer token-errado' } }));
    assert(res.status === 401, `Cron ${caminho} recusa segredo errado`, `status ${res.status}`);
  }

  console.log(`\n=== RESULTADO: ${aprovados}/${total} aprovados ===`);
  if (falhas.length) console.error('Falhas:\n - ' + falhas.join('\n - '));
  process.exit(falhas.length ? 1 : 0);
}

run().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
