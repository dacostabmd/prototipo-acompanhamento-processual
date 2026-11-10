import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { excedeuLimiteUsuario } from '@/lib/jurisprudencia';
import { cleanDigits, isValidCnpj } from '@/lib/format';
import { DjenIndisponivelError, normalizarNome } from '@/lib/djen';
import {
  BrasilApiIndisponivelError,
  CnpjNaoEncontradoError,
  buscarProcessosTrabalhistas,
  consultarCnpjBrasilApi,
  type EmpresaCnpj
} from '@/lib/trabalhista';

const LIMITE_BUSCAS = 12; // por janela: cada busca lê várias páginas do DJEN (limite de ~20 req por IP do servidor)
const JANELA_SEGUNDOS = 60;
const PERIODOS_DIAS = [30, 90, 180, 365];

/**
 * GET /api/trabalhista?q=<CNPJ ou nome>&trt=1|2|...|24|todos&dias=30|90|180|365&somenteAutor=1&nome=<termo alternativo>
 *
 * Busca rápida de processos trabalhistas sem custo: CNPJ -> razão social (BrasilAPI) -> publicações do DJEN nos TRTs.
 * Qualquer polo por padrão (empresa costuma ser reclamada); `somenteAutor=1` mantém só quem aparece como autora.
 * `nome` troca o termo pesquisado no DJEN (ex.: nome fantasia) mantendo os dados do CNPJ de `q`.
 */
export async function GET(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: 'Usuário não autenticado.' }, { status: 401 });

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

  if (await excedeuLimiteUsuario(userId, 'trabalhista', LIMITE_BUSCAS, JANELA_SEGUNDOS)) {
    return NextResponse.json(
      { error: 'Muitas buscas em pouco tempo. Aguarde um minuto e tente de novo.', codigo: 'limite' },
      { status: 429, headers: { 'Retry-After': String(JANELA_SEGUNDOS) } }
    );
  }

  try {
    let empresa: EmpresaCnpj | null = null;
    if (ehDocumento) {
      empresa = await consultarCnpjBrasilApi(digitos);
    }
    const termo = nomeAlternativo.length >= 5 ? nomeAlternativo : empresa ? empresa.razaoSocial : q;

    const resultado = await buscarProcessosTrabalhistas(termo, { trt, dias, somenteAutor });
    return NextResponse.json({ empresa, ...resultado, fonte: 'DJEN (CNJ)' });
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
