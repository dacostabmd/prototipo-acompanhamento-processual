import { createHash } from 'crypto';
import { NextResponse, after } from 'next/server';
import { getAdminClient, getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { excedeuLimiteUsuario } from '@/lib/jurisprudencia';
import { verificarRecursoPlano } from '@/lib/planos';
import { cleanDigits, isValidCnpj } from '@/lib/format';
import { DjenIndisponivelError, normalizarNome } from '@/lib/djen';
import { registrarHistoricoConsulta } from '@/lib/historicoConsultas';
import { BrasilApiIndisponivelError, CnpjNaoEncontradoError, consultarCnpjBrasilApi, type EmpresaCnpj } from '@/lib/trabalhista';
import { buscarTrabalhistaComFallback } from '@/lib/trabalhistaFallback';

// Roda em São Paulo: o DJEN (CNJ) respondeu do Brasil e falhou a partir da Vercel (região padrão nos EUA) em 2026-11-10.
export const preferredRegion = 'gru1';

const LIMITE_BUSCAS = 12; // por janela: cada busca lê várias páginas do DJEN (limite de ~20 req por IP do servidor)
const JANELA_SEGUNDOS = 60;
const PERIODOS_DIAS = [30, 90, 180, 365];

/**
 * Quem pode disparar as fontes pagas (certidão da Infosimples): mesma regra da busca por documento — Pro, advogado,
 * owner ou admin. Sem Supabase (modo demonstração/dev) não há conta para checar e a etapa fica liberada.
 */
async function podeUsarFontesPagas(userId: string | null): Promise<boolean> {
  const db = getAdminClient();
  if (!db || !userId) return true;
  const acesso = await verificarRecursoPlano(userId, 'monitoramentoCpf');
  if (acesso.permitido) return true;
  const { data } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  return (data as { role?: string } | null)?.role === 'advogado';
}

/** Identificador para o limite de uso: o usuário, ou o IP (hash) quando não há conta (modo demonstração). */
function chaveDoLimite(request: Request, userId: string | null): string {
  if (userId) return userId;
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  return `anon:${createHash('sha256').update(ip).digest('hex').slice(0, 24)}`;
}

/**
 * GET /api/trabalhista?q=<CNPJ ou nome>&trt=1|2|...|24|todos&dias=30|90|180|365&somenteAutor=1&nome=<termo alternativo>&pago=0
 *
 * Busca rápida de processos trabalhistas: CNPJ -> razão social (BrasilAPI) -> publicações do DJEN nos TRTs (grátis).
 * Se o diário não achar nada (ou falhar), cai nas outras fontes: nome fantasia no DJEN e, só para CNPJ, a certidão de
 * ações trabalhistas da Infosimples (paga; `pago=0` desliga). Qualquer polo por padrão (empresa costuma ser reclamada);
 * `somenteAutor=1` mantém só quem aparece como autora. `nome` troca o termo pesquisado (ex.: nome fantasia).
 */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  // requireUser já barrou quem não tem sessão quando o Supabase está configurado; aqui o userId só serve para o
  // limite de uso, o plano e o histórico. Sem ele (modo demonstração) a busca segue, limitada por IP.
  const userId = await getUserId(request);

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim().slice(0, 200);
  const nomeAlternativo = (params.get('nome') || '').trim().slice(0, 200);
  const digitos = cleanDigits(q);

  // Um texto só com dígitos é documento; com letras, nome da empresa.
  const ehDocumento = digitos.length > 0 && /^[\d.\-/\s]+$/.test(q);
  if (ehDocumento && digitos.length === 11) {
    return NextResponse.json(
      { error: 'Esta busca é para empresas. O diário nacional não busca por CPF; digite o CNPJ ou o nome da empresa.' },
      { status: 400 }
    );
  }
  if (ehDocumento && (digitos.length !== 14 || !isValidCnpj(digitos))) {
    return NextResponse.json({ error: 'CNPJ inválido. Confira os 14 dígitos.' }, { status: 400 });
  }
  if (!ehDocumento && normalizarNome(q).length < 5) {
    return NextResponse.json({ error: 'Digite um CNPJ ou o nome da empresa (ao menos 5 letras).' }, { status: 400 });
  }

  const trtParam = (params.get('trt') || '1').trim().toLowerCase();
  const trtNumero = Number.parseInt(trtParam, 10);
  const trt: number | 'todos' = trtParam === 'todos' ? 'todos' : Number.isInteger(trtNumero) && trtNumero >= 1 && trtNumero <= 24 ? trtNumero : 1;

  const diasBruto = Number.parseInt(params.get('dias') || '', 10);
  const dias = PERIODOS_DIAS.includes(diasBruto) ? diasBruto : 180;
  const somenteAutor = params.get('somenteAutor') === '1';
  const quererPago = params.get('pago') !== '0';

  if (await excedeuLimiteUsuario(chaveDoLimite(request, userId), 'trabalhista', LIMITE_BUSCAS, JANELA_SEGUNDOS)) {
    return NextResponse.json(
      { error: 'Muitas buscas em pouco tempo. Aguarde um minuto e tente de novo.', codigo: 'limite' },
      { status: 429, headers: { 'Retry-After': String(JANELA_SEGUNDOS) } }
    );
  }

  try {
    const empresa: EmpresaCnpj | null = ehDocumento ? await consultarCnpjBrasilApi(digitos) : null;
    const termo = nomeAlternativo.length >= 5 ? nomeAlternativo : empresa ? empresa.razaoSocial : q;
    const acessoPago = quererPago ? ((await podeUsarFontesPagas(userId)) ? 'ligada' : 'sem_acesso') : 'desligada';

    const resultado = await buscarTrabalhistaComFallback({
      termo,
      empresa,
      trt,
      dias,
      somenteAutor,
      pago: acessoPago,
      tokenInfosimples: process.env.INFOSIMPLES_API_TOKEN || process.env.INFOSIMPLES_TOKEN
    });

    // O que a Infosimples cobrou entra no histórico (e, por ele, na franquia mensal do plano).
    if (resultado.tribunaisPagos.length > 0 && empresa) {
      after(() =>
        registrarHistoricoConsulta(userId, {
          tipoBusca: 'cnpj',
          termo: empresa.cnpj,
          nomeParte: empresa.razaoSocial,
          tribunais: resultado.tribunaisPagos,
          totalProcessos: resultado.processos.length,
          custoEstimado: resultado.custoCobrado,
          custoCobrado: resultado.custoCobrado
        })
      );
    }

    return NextResponse.json({ empresa, ...resultado });
  } catch (e) {
    if (e instanceof CnpjNaoEncontradoError) {
      return NextResponse.json({ error: 'CNPJ não encontrado na Receita Federal. Confira os dígitos.' }, { status: 404 });
    }
    if (e instanceof BrasilApiIndisponivelError) {
      console.error('[api/trabalhista] BrasilAPI:', e.message);
      return NextResponse.json(
        { error: 'Não foi possível consultar o CNPJ agora. Tente de novo ou digite o nome da empresa.', codigo: 'brasilapi' },
        { status: 503 }
      );
    }
    if (e instanceof DjenIndisponivelError) {
      console.error('[api/trabalhista] DJEN:', e.message);
      return NextResponse.json(
        { error: 'O diário nacional (DJEN) está indisponível ou limitou as consultas. Tente de novo em alguns instantes.', codigo: 'djen' },
        { status: 503 }
      );
    }
    console.error('[api/trabalhista] erro inesperado:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível pesquisar agora. Tente novamente em instantes.' }, { status: 500 });
  }
}
