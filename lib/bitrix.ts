/**
 * Client REST genérico para o Bitrix24, via webhook incoming (mesma BITRIX_WEBHOOK_URL
 * já usada em app/api/bitrix/lead/route.ts, que hoje só chama crm.lead.add). Generaliza a
 * normalização de URL para qualquer método REST (crm.dealcategory.list, crm.status.list,
 * crm.deal.list, ...), mantendo o mesmo padrão de modo simulado quando a env var não estiver
 * configurada (nunca lança erro por falta de credenciais, só sinaliza simulated: true).
 */

export interface BitrixCallResult<T> {
  result: T;
  next?: number;
  total?: number;
  simulated: boolean;
}

function buildEndpoint(method: string): string | null {
  const webhookUrl = process.env.BITRIX_WEBHOOK_URL;
  if (!webhookUrl) return null;
  const cleanUrl = webhookUrl.replace(/\/+$/, '');
  const base = cleanUrl.endsWith('.json') ? cleanUrl.replace(/\/[a-zA-Z0-9_.]+\.json$/, '') : cleanUrl;
  return `${base}/${method}.json`;
}

/** Chamada genérica à REST do Bitrix. Sem BITRIX_WEBHOOK_URL, retorna o mock informado (modo simulado). */
async function callBitrix<T>(method: string, params: Record<string, unknown>, mock: T): Promise<BitrixCallResult<T>> {
  const endpoint = buildEndpoint(method);
  if (!endpoint) return { result: mock, simulated: true };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  if (!res.ok) throw new Error(`Bitrix ${method} falhou: HTTP ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(`Bitrix ${method} erro: ${data.error_description || data.error}`);
  return { result: data.result as T, next: data.next, total: data.total, simulated: false };
}

export interface BitrixPipeline {
  ID: number;
  NAME: string;
  SORT: number;
}

export interface BitrixStage {
  STATUS_ID: string;
  NAME: string;
  SORT: number;
}

export interface BitrixDeal {
  ID: string;
  TITLE: string;
  CATEGORY_ID: string;
  STAGE_ID: string;
  OPPORTUNITY: string | null;
  [customField: string]: unknown;
}

interface BitrixDealField {
  type: string;
  isRequired?: boolean;
}

/**
 * Checa se um campo customizado (ex.: UF_CRM_1740590606) existe como campo de DEAL no Bitrix.
 * crm.deal.fields é global (não por categoria) — campos customizados do Bitrix valem para todos
 * os funis de Deal, então essa checagem é "o campo existe na conta", não "está preenchido neste
 * funil específico" (o preenchimento real por deal só se sabe ao listar os deals).
 */
async function campoDeDealExiste(campo: string): Promise<{ existe: boolean; simulated: boolean }> {
  const mock: Record<string, BitrixDealField> = { [campo]: { type: 'string' } };
  const r = await callBitrix<Record<string, BitrixDealField>>('crm.deal.fields', {}, mock);
  return { existe: Boolean(r.result?.[campo]), simulated: r.simulated };
}

/**
 * Lista os funis (pipelines) de negociação cujo nome começa com "IA" (prefixo usado para marcar
 * funis de automação de enriquecimento) e que têm o campo customizado do número de processo
 * configurado na conta Bitrix.
 */
export async function listarFunisIA(campoProcesso: string): Promise<{ pipelines: BitrixPipeline[]; simulated: boolean }> {
  const mock: BitrixPipeline[] = [{ ID: 0, NAME: 'IA - [Simulado] Funil padrão', SORT: 10 }];
  const [r, campo] = await Promise.all([
    callBitrix<BitrixPipeline[]>('crm.dealcategory.list', {}, mock),
    campoDeDealExiste(campoProcesso)
  ]);

  const simulated = r.simulated || campo.simulated;
  if (!campo.existe) return { pipelines: [], simulated };

  const pipelinesIA = r.result.filter(p => p.NAME?.trim().toUpperCase().startsWith('IA'));
  return { pipelines: pipelinesIA, simulated };
}

/** Lista as etapas de um funil. ENTITY_ID segue o padrão "DEAL_STAGE_<categoryId>" (0 = "DEAL_STAGE"). */
export async function listarEtapas(categoryId: number): Promise<{ stages: BitrixStage[]; simulated: boolean }> {
  const entityId = categoryId === 0 ? 'DEAL_STAGE' : `DEAL_STAGE_${categoryId}`;
  const mock: BitrixStage[] = [{ STATUS_ID: 'NEW', NAME: '[Simulado] Nova', SORT: 10 }];
  const r = await callBitrix<BitrixStage[]>('crm.status.list', { filter: { ENTITY_ID: entityId } }, mock);
  return { stages: r.result, simulated: r.simulated };
}

/**
 * Lista deals de um funil (opcionalmente filtrando por etapa), com paginação nativa do Bitrix
 * (start/next, páginas de 50). `select` sempre inclui ID, TITLE, CATEGORY_ID, STAGE_ID,
 * OPPORTUNITY e o campo de processo. Sem `stageId`, varre todas as etapas do funil — cada funil
 * "IA <Estado>" tem várias etapas, cada uma com deals que têm o número de processo preenchido.
 */
export async function listarDeals(params: {
  categoryId: number;
  stageId?: string;
  campoProcesso: string;
  start?: number;
}): Promise<{ deals: BitrixDeal[]; next?: number; simulated: boolean }> {
  const mock: BitrixDeal[] = [];
  const filter: Record<string, unknown> = { CATEGORY_ID: params.categoryId };
  if (params.stageId) filter.STAGE_ID = params.stageId;

  const r = await callBitrix<BitrixDeal[]>(
    'crm.deal.list',
    {
      filter,
      select: ['ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'OPPORTUNITY', params.campoProcesso],
      start: params.start ?? 0,
      order: { ID: 'ASC' }
    },
    mock
  );
  return { deals: r.result, next: r.next, simulated: r.simulated };
}

/**
 * Busca um deal específico pelo ID (crm.deal.get sempre retorna todos os campos, sem `select`).
 * Usado pelo webhook de evento do Bitrix (ONCRMDEALADD/UPDATE), que só informa o ID.
 */
export async function buscarDealPorId(dealId: number): Promise<{ deal: BitrixDeal | null; simulated: boolean }> {
  const mock: BitrixDeal | null = null;
  const r = await callBitrix<BitrixDeal | null>('crm.deal.get', { id: dealId }, mock);
  if (!r.result) return { deal: null, simulated: r.simulated };
  return { deal: r.result, simulated: r.simulated };
}

/**
 * Busca um deal específico dentro de um funil pelo valor exato do campo customizado do número
 * de processo. Usado pela busca pontual (campo de busca na UI, em vez do lote de N).
 */
export async function buscarDealPorNumeroProcesso(params: {
  categoryId: number;
  campoProcesso: string;
  numeroProcesso: string;
}): Promise<{ deal: BitrixDeal | null; simulated: boolean }> {
  const mock: BitrixDeal[] = [];
  const r = await callBitrix<BitrixDeal[]>(
    'crm.deal.list',
    {
      filter: { CATEGORY_ID: params.categoryId, [params.campoProcesso]: params.numeroProcesso },
      select: ['ID', 'TITLE', 'CATEGORY_ID', 'STAGE_ID', 'OPPORTUNITY', params.campoProcesso],
      start: 0
    },
    mock
  );
  return { deal: r.result[0] ?? null, simulated: r.simulated };
}
