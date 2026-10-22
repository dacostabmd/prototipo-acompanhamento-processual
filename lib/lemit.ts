/**
 * Lemit (api.lemit.com.br): enriquecimento cadastral por CPF/CNPJ (telefones, e-mails, endereços, situação do CPF,
 * sócios). Chamada replicada de consultar_lemit() do serviço lemit-assertiva-api (app.py), que já roda em produção.
 *
 * Disparada automaticamente por app/api/processos/route.ts para o CPF pesquisado e para CPFs novos achados nos
 * processos. A API não informa preço: o custo por consulta vem do contrato, via LEMIT_CUSTO_POR_CONSULTA (R$).
 */

const URL_BASE = 'https://api.lemit.com.br/api/v1/consulta';
const TIMEOUT_MS = 10000;
const MAX_TENTATIVAS = 2;
const CUSTO_POR_CONSULTA = Number(process.env.LEMIT_CUSTO_POR_CONSULTA) || 0;

export type StatusLemit = 'ok' | 'nao_encontrado' | 'erro' | 'nao_configurada';

/** Resumo exibido na tela (contagens e situação); os dados completos ficam em `dados`. */
export interface ResumoLemit {
  nome?: string;
  celulares: number;
  fixos: number;
  emails: number;
  enderecos: number;
  socios: number;
  /** Ex.: "REGULAR", "TITULAR FALECIDO" (só CPF). Dado pessoal sensível. */
  situacaoCpf?: string;
  falecido?: boolean;
}

export interface ResultadoLemit {
  status: StatusLemit;
  /** Valor da consulta, em R$ (do contrato; 0 quando a chamada não chegou a ser feita ou falhou). */
  custo: number;
  /** Objeto `pessoa` (CPF) ou `empresa` (CNPJ) da resposta da Lemit. */
  dados?: Record<string, unknown>;
  resumo?: ResumoLemit;
  erro?: string;
}

/** Teto de CPFs descobertos nos processos enviados à Lemit numa mesma busca (controle de custo). */
export const MAX_CPFS_LEMIT_POR_BUSCA = Number(process.env.LEMIT_MAX_CPFS_POR_BUSCA) || 5;

export function lemitConfigurada(): boolean {
  return !!process.env.LEMIT_API_TOKEN;
}

const qtd = (v: unknown) => (Array.isArray(v) ? v.length : 0);

function resumir(d: Record<string, any>): ResumoLemit {
  return {
    nome: d.nome || d.nome_fantasia || d.razao_social || undefined,
    celulares: qtd(d.celulares),
    fixos: qtd(d.fixos),
    emails: qtd(d.emails),
    enderecos: qtd(d.enderecos) || (d.endereco ? 1 : 0),
    socios: qtd(d.socios),
    situacaoCpf: typeof d.situacao_cpf === 'string' ? d.situacao_cpf : undefined,
    falecido: typeof d.falecido === 'boolean' ? d.falecido : undefined
  };
}

/** Consulta um CPF (11 dígitos) ou CNPJ (14) na Lemit. Nunca lança. */
export async function consultarLemitPorCpf(documento: string, signal?: AbortSignal): Promise<ResultadoLemit> {
  const token = process.env.LEMIT_API_TOKEN;
  if (!token) return { status: 'nao_configurada', custo: 0, erro: 'LEMIT_API_TOKEN não configurado no servidor.' };

  const digitos = documento.replace(/\D/g, '');
  const tipo = digitos.length === 14 ? 'empresa' : 'pessoa';
  let ultimoErro = 'Sem resposta da Lemit.';

  // Mesma política do lemit-assertiva-api: 2 tentativas, só repete em exceção (rede/timeout) ou HTTP 5xx.
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    if (signal?.aborted) return { status: 'erro', custo: 0, erro: 'Consulta cancelada.' };
    try {
      const res = await fetch(`${URL_BASE}/${tipo}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ documento: digitos }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS)
      });
      if (res.status >= 500) {
        ultimoErro = `HTTP ${res.status}`;
        continue;
      }
      const js: any = await res.json().catch(() => null);
      const dados = js?.[tipo];
      if (dados && typeof dados === 'object') {
        return { status: 'ok', custo: CUSTO_POR_CONSULTA, dados, resumo: resumir(dados) };
      }
      // Token inválido volta HTTP 200 com { error: "nao autorizado" }: o status HTTP sozinho não basta.
      const erro = typeof js?.error === 'string' ? js.error : !res.ok ? `HTTP ${res.status}` : 'Resposta sem dados.';
      if (/n[aã]o (encontrad|localizad)|sem resultado/i.test(erro)) return { status: 'nao_encontrado', custo: CUSTO_POR_CONSULTA };
      return { status: 'erro', custo: 0, erro: `Lemit: ${erro}` };
    } catch (e) {
      ultimoErro = (e as { name?: string })?.name === 'TimeoutError' ? 'Tempo limite esgotado (10s).' : String((e as Error)?.message ?? e);
    }
  }
  return { status: 'erro', custo: 0, erro: `Lemit: ${ultimoErro}` };
}

const RE_CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

/** CPFs completos (não mascarados) e válidos que aparecem em qualquer campo de texto de um objeto. */
export function cpfsNoObjeto(obj: unknown, validar: (cpf: string) => boolean): string[] {
  const achados = new Set<string>();
  const texto = JSON.stringify(obj ?? '');
  for (const m of texto.match(RE_CPF) ?? []) {
    const digitos = m.replace(/\D/g, '');
    if (digitos.length === 11 && validar(digitos)) achados.add(digitos);
  }
  return [...achados];
}
