import { randomBytes } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getAdminClient } from '@/lib/track';
import { obterStatusPlanoUsuario, REGRAS_PLANOS } from '@/lib/planos';

/**
 * Escritório com vários usuários (MVP). Tabelas: ap_organizacoes, ap_organizacao_membros, ap_organizacao_convites
 * (migration 20261109130000). Tudo aqui roda no servidor com o cliente admin; a RLS protege o acesso direto.
 *
 * Compartilhamento: as rotas de leitura (monitoramento, monitoramento-diario) usam `colegasDoEscritorio` /
 * `idsDoEscritorio` para ampliar o filtro por user_id. Só leitura; as mutações continuam do dono do registro.
 */

export const DIAS_VALIDADE_CONVITE = 7;
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://jusconsulta.com.br';

export type PapelEquipe = 'dono' | 'membro';

export type CodigoErroEquipe =
  | 'recurso_pro'
  | 'limite_membros'
  | 'invalido'
  | 'nao_encontrado'
  | 'ja_em_escritorio'
  | 'sem_escritorio'
  | 'duplicado'
  | 'nao_autorizado'
  | 'convite_invalido'
  | 'convite_expirado'
  | 'convite_usado'
  | 'email_diferente'
  | 'email_nao_confirmado'
  | 'indisponivel'
  | 'erro';

export const STATUS_POR_CODIGO_EQUIPE: Record<CodigoErroEquipe, number> = {
  recurso_pro: 403,
  limite_membros: 403,
  invalido: 400,
  nao_encontrado: 404,
  ja_em_escritorio: 409,
  sem_escritorio: 404,
  duplicado: 409,
  nao_autorizado: 403,
  convite_invalido: 404,
  convite_expirado: 410,
  convite_usado: 410,
  email_diferente: 403,
  email_nao_confirmado: 403,
  indisponivel: 503,
  erro: 500
};

export interface ResultadoEquipe<T = undefined> {
  sucesso: boolean;
  erro?: string;
  codigo?: CodigoErroEquipe;
  dados?: T;
}

export interface MembroEquipe {
  userId: string;
  nome: string;
  email: string | null;
  papel: PapelEquipe;
  desde: string;
}

export interface ConviteEquipe {
  id: string;
  email: string;
  expiraEm: string;
  criadoEm: string;
  expirado: boolean;
  /** Link completo para copiar (só o dono vê os convites). */
  link: string;
}

export interface Escritorio {
  id: string;
  nome: string;
  donoId: string;
  meuPapel: PapelEquipe;
  criadoEm: string;
  membros: MembroEquipe[];
  /** Convites pendentes (só para o dono). */
  convites: ConviteEquipe[];
  /** Vagas do plano DO DONO. */
  limiteMembros: number;
  planoDono: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Regras puras (testadas em scratch/teste_equipe.ts, sem banco)
// ---------------------------------------------------------------------------------------------------------------

export const normalizarEmail = (valor: unknown): string => (typeof valor === 'string' ? valor.trim().toLowerCase() : '');

export function emailValido(valor: unknown): boolean {
  const email = normalizarEmail(valor);
  return email.length <= 254 && /^[^\s@]+@[^\s@.][^\s@]*\.[^\s@.]{2,}$/.test(email);
}

export function normalizarNomeEscritorio(valor: unknown): string {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim() : '';
}

export const nomeEscritorioValido = (nome: string) => nome.length >= 2 && nome.length <= 80;

export const calcularExpiracaoConvite = (agora: Date = new Date()) =>
  new Date(agora.getTime() + DIAS_VALIDADE_CONVITE * 86_400_000);

export const conviteExpirado = (expiraEm: string | Date, agora: Date = new Date()) =>
  new Date(expiraEm).getTime() <= agora.getTime();

/** Token opaco de 256 bits (43 caracteres base64url). */
export const gerarTokenConvite = () => randomBytes(32).toString('base64url');

export const tokenConviteComFormatoValido = (token: unknown): token is string =>
  typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token);

/** Vagas ocupadas = membros + convites pendentes ainda válidos. Retorna se cabe mais uma. */
export const cabeMaisUm = (ocupadas: number, limite: number) => ocupadas < limite;

/** Limite efetivo de membros: owner/admin podem usar o limite do Pro mesmo numa conta Free. */
export function limiteEfetivoMembros(limitePlano: number, privilegiado: boolean): number {
  return privilegiado ? Math.max(limitePlano, REGRAS_PLANOS.pro.limiteMembrosEquipe) : limitePlano;
}

export function mascararEmail(email: string): string {
  const [local, dominio] = email.split('@');
  if (!dominio) return '***';
  return `${local.slice(0, 1)}***@${dominio}`;
}

export const linkConvite = (token: string) => `${SITE_URL.replace(/\/$/, '')}/equipe/convite/${token}`;

const falha = (codigo: CodigoErroEquipe, erro: string): ResultadoEquipe<never> => ({ sucesso: false, codigo, erro });

const MSG_RECURSO_PRO =
  'O escritório com vários usuários é um recurso do Plano Pro. Assine o Pro para convidar colegas e compartilhar o acompanhamento.';
const MSG_LIMITE = (limite: number) =>
  `O escritório chegou ao limite de ${limite} ${limite === 1 ? 'usuário' : 'usuários'} do plano do dono (convites pendentes contam como vaga). Remova alguém ou revogue um convite.`;

// ---------------------------------------------------------------------------------------------------------------
// Plano e usuário
// ---------------------------------------------------------------------------------------------------------------

async function infoPlano(db: SupabaseClient, userId: string): Promise<{ limite: number; plano: string; privilegiado: boolean }> {
  const [status, perfil] = await Promise.all([
    obterStatusPlanoUsuario(userId),
    db.from('ap_perfis').select('role').eq('id', userId).maybeSingle()
  ]);
  const role = (perfil.data as { role?: string } | null)?.role;
  const privilegiado = role === 'owner' || role === 'admin';
  return {
    limite: limiteEfetivoMembros(status.regras.limiteMembrosEquipe, privilegiado),
    plano: status.regras.nome,
    privilegiado
  };
}

export interface UsuarioAutenticado {
  id: string;
  email: string;
  emailConfirmado: boolean;
}

/** Usuário do Bearer token com e-mail e se ele foi confirmado (o aceite exige e-mail confirmado). */
export async function obterUsuarioAutenticado(request: Request): Promise<UsuarioAutenticado | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!url || !anon || !token) return null;
  const { data, error } = await createClient(url, anon).auth.getUser(token);
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    email: normalizarEmail(data.user.email),
    emailConfirmado: Boolean(data.user.email_confirmed_at)
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------------------------------------------

interface LinhaOrganizacao {
  id: string;
  nome: string;
  dono_id: string;
  created_at: string;
}

async function organizacaoDoUsuario(db: SupabaseClient, userId: string): Promise<LinhaOrganizacao | null> {
  const { data: vinculo, error } = await db
    .from('ap_organizacao_membros')
    .select('organizacao_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !vinculo) return null;
  const { data: org } = await db
    .from('ap_organizacoes')
    .select('id, nome, dono_id, created_at')
    .eq('id', vinculo.organizacao_id as string)
    .maybeSingle();
  return (org as LinhaOrganizacao | null) ?? null;
}

const nomeExibicao = (nome: string | null | undefined, email: string | null | undefined) =>
  nome?.trim() || (email ? email.split('@')[0] : '') || 'Colega';

async function perfisPorId(db: SupabaseClient, ids: string[]) {
  const mapa = new Map<string, { nome: string | null; email: string | null }>();
  if (ids.length === 0) return mapa;
  const { data } = await db.from('ap_perfis').select('id, nome, email').in('id', ids);
  for (const p of (data ?? []) as { id: string; nome: string | null; email: string | null }[]) {
    mapa.set(p.id, { nome: p.nome, email: p.email ? String(p.email).toLowerCase() : null });
  }
  return mapa;
}

/**
 * Colegas do escritório do usuário (sem ele mesmo) com o nome de exibição. Sem escritório, ou se as tabelas ainda
 * não existirem/falharem, devolve [] (as rotas de leitura seguem exatamente como antes).
 */
export async function colegasDoEscritorio(userId: string): Promise<{ id: string; nome: string }[]> {
  try {
    const db = getAdminClient();
    if (!db) return [];
    const { data: vinculo, error } = await db
      .from('ap_organizacao_membros')
      .select('organizacao_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !vinculo) return [];
    const { data: membros } = await db
      .from('ap_organizacao_membros')
      .select('user_id')
      .eq('organizacao_id', vinculo.organizacao_id as string)
      .neq('user_id', userId);
    const ids = ((membros ?? []) as { user_id: string }[]).map(m => m.user_id);
    const perfis = await perfisPorId(db, ids);
    return ids.map(id => ({ id, nome: nomeExibicao(perfis.get(id)?.nome, perfis.get(id)?.email) }));
  } catch (e) {
    console.error('[equipe] falha ao listar colegas:', e instanceof Error ? e.message : e);
    return [];
  }
}

/** Ids do escritório do usuário, incluindo o próprio (sempre pelo menos [userId]). */
export async function idsDoEscritorio(userId: string): Promise<string[]> {
  const colegas = await colegasDoEscritorio(userId);
  return [userId, ...colegas.map(c => c.id)];
}

export async function obterEscritorio(userId: string): Promise<ResultadoEquipe<{ escritorio: Escritorio | null; podeCriar: boolean; limiteDoPlano: number }>> {
  const db = getAdminClient();
  if (!db) return falha('indisponivel', 'Banco indisponível.');

  const [org, meuPlano] = await Promise.all([organizacaoDoUsuario(db, userId), infoPlano(db, userId)]);
  const podeCriar = meuPlano.limite > 1;
  if (!org) return { sucesso: true, dados: { escritorio: null, podeCriar, limiteDoPlano: meuPlano.limite } };

  const eDono = org.dono_id === userId;
  const [{ data: linhasMembros }, planoDono, { data: linhasConvites }] = await Promise.all([
    db.from('ap_organizacao_membros').select('user_id, papel, created_at').eq('organizacao_id', org.id).order('created_at', { ascending: true }),
    eDono ? Promise.resolve(meuPlano) : infoPlano(db, org.dono_id),
    eDono
      ? db
          .from('ap_organizacao_convites')
          .select('id, email, token, expira_em, created_at')
          .eq('organizacao_id', org.id)
          .is('aceito_em', null)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as unknown[] })
  ]);

  const membrosBrutos = (linhasMembros ?? []) as { user_id: string; papel: PapelEquipe; created_at: string }[];
  const perfis = await perfisPorId(db, membrosBrutos.map(m => m.user_id));
  const membros: MembroEquipe[] = membrosBrutos.map(m => ({
    userId: m.user_id,
    nome: nomeExibicao(perfis.get(m.user_id)?.nome, perfis.get(m.user_id)?.email),
    email: perfis.get(m.user_id)?.email ?? null,
    papel: m.papel,
    desde: m.created_at
  }));

  const convites: ConviteEquipe[] = ((linhasConvites ?? []) as { id: string; email: string; token: string; expira_em: string; created_at: string }[]).map(
    c => ({
      id: c.id,
      email: c.email,
      expiraEm: c.expira_em,
      criadoEm: c.created_at,
      expirado: conviteExpirado(c.expira_em),
      link: linkConvite(c.token)
    })
  );

  return {
    sucesso: true,
    dados: {
      podeCriar,
      limiteDoPlano: meuPlano.limite,
      escritorio: {
        id: org.id,
        nome: org.nome,
        donoId: org.dono_id,
        meuPapel: eDono ? 'dono' : 'membro',
        criadoEm: org.created_at,
        membros,
        convites,
        limiteMembros: planoDono.limite,
        planoDono: planoDono.plano
      }
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Criar, encerrar, sair, remover
// ---------------------------------------------------------------------------------------------------------------

export async function criarEscritorio(userId: string, nomeBruto: unknown): Promise<ResultadoEquipe<{ id: string }>> {
  const db = getAdminClient();
  if (!db) return falha('indisponivel', 'Banco indisponível.');

  const nome = normalizarNomeEscritorio(nomeBruto);
  if (!nomeEscritorioValido(nome)) return falha('invalido', 'Informe um nome para o escritório com 2 a 80 caracteres.');

  const plano = await infoPlano(db, userId);
  if (plano.limite <= 1) return falha('recurso_pro', MSG_RECURSO_PRO);

  if (await organizacaoDoUsuario(db, userId)) {
    return falha('ja_em_escritorio', 'Você já faz parte de um escritório. Saia dele antes de criar outro.');
  }

  const { data: org, error } = await db.from('ap_organizacoes').insert({ nome, dono_id: userId }).select('id').single();
  if (error || !org) {
    console.error('[equipe] erro ao criar organização:', error?.message);
    return falha('erro', 'Não foi possível criar o escritório.');
  }
  const { error: erroMembro } = await db.from('ap_organizacao_membros').insert({ organizacao_id: org.id, user_id: userId, papel: 'dono' });
  if (erroMembro) {
    console.error('[equipe] erro ao registrar o dono:', erroMembro.message);
    await db.from('ap_organizacoes').delete().eq('id', org.id);
    return falha('erro', 'Não foi possível criar o escritório.');
  }
  return { sucesso: true, dados: { id: org.id as string } };
}

/** Dono encerra o escritório (apaga membros e convites em cascata). Os dados de cada usuário não são tocados. */
export async function encerrarEscritorio(donoId: string): Promise<ResultadoEquipe> {
  const db = getAdminClient();
  if (!db) return falha('indisponivel', 'Banco indisponível.');
  const { data, error } = await db.from('ap_organizacoes').delete().eq('dono_id', donoId).select('id');
  if (error) {
    console.error('[equipe] erro ao encerrar escritório:', error.message);
    return falha('erro', 'Não foi possível encerrar o escritório.');
  }
  if (!data || data.length === 0) return falha('nao_autorizado', 'Só o dono pode encerrar o escritório.');
  return { sucesso: true };
}

/** Membro sai. O dono não sai: só pode encerrar (MVP, sem transferência). */
export async function sairDoEscritorio(userId: string): Promise<ResultadoEquipe> {
  const db = getAdminClient();
  if (!db) return falha('indisponivel', 'Banco indisponível.');
  const org = await organizacaoDoUsuario(db, userId);
  if (!org) return falha('sem_escritorio', 'Você não faz parte de nenhum escritório.');
  if (org.dono_id === userId) {
    return falha('nao_autorizado', 'O dono não pode sair do escritório. Encerre o escritório se quiser desfazê-lo.');
  }
  const { error } = await db.from('ap_organizacao_membros').delete().eq('organizacao_id', org.id).eq('user_id', userId);
  if (error) {
    console.error('[equipe] erro ao sair do escritório:', error.message);
    return falha('erro', 'Não foi possível sair do escritório.');
  }
  return { sucesso: true };
}

export async function removerMembro(donoId: string, membroId: string): Promise<ResultadoEquipe> {
  const db = getAdminClient();
  if (!db) return falha('indisponivel', 'Banco indisponível.');
  const { data: org } = await db.from('ap_organizacoes').select('id').eq('dono_id', donoId).maybeSingle();
  if (!org) return falha('nao_autorizado', 'Só o dono do escritório pode remover membros.');
  if (membroId === donoId) return falha('invalido', 'O dono não pode ser removido. Encerre o escritório se quiser desfazê-lo.');
  const { data, error } = await db
    .from('ap_organizacao_membros')
    .delete()
    .eq('organizacao_id', org.id)
    .eq('user_id', membroId)
    .select('user_id');
  if (error) {
    console.error('[equipe] erro ao remover membro:', error.message);
    return falha('erro', 'Não foi possível remover o membro.');
  }
  if (!data || data.length === 0) return falha('nao_encontrado', 'Membro não encontrado neste escritório.');
  return { sucesso: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------------------------------------------

let resend: Resend | null | undefined;
function getResend(): Resend | null {
  if (resend !== undefined) return resend;
  const key = process.env.RESEND_API_KEY;
  resend = key ? new Resend(key) : null;
  return resend;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function enviarEmailConvite(destino: string, escritorio: string, quem: string, link: string): Promise<{ enviado: boolean; erro?: string }> {
  const cliente = getResend();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!cliente || !from) {
    console.log('[equipe] RESEND_API_KEY/RESEND_FROM_EMAIL não configuradas: convite não enviado por e-mail.');
    return { enviado: false, erro: 'E-mail não configurado' };
  }
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#060F28">Você foi convidado para o escritório ${escapeHtml(escritorio)}</h2>
      <p style="color:#333">${escapeHtml(quem)} convidou você para acompanhar processos em equipe no JusConsulta. Você poderá ver os processos e as buscas do Diário dos colegas, em modo leitura.</p>
      <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1E7CF2;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Aceitar convite</a></p>
      <p style="color:#888;font-size:12px">O convite vale por ${DIAS_VALIDADE_CONVITE} dias e só funciona para este e-mail (${escapeHtml(destino)}). Se você não esperava, ignore esta mensagem.</p>
    </div>`.trim();
  try {
    const { error } = await cliente.emails.send({
      from,
      to: destino,
      subject: `Convite para o escritório ${escritorio} no JusConsulta`,
      html
    });
    if (error) {
      console.error('[equipe] falha ao enviar convite:', error.message);
      return { enviado: false, erro: error.message };
    }
    return { enviado: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido';
    console.error('[equipe] exceção ao enviar convite:', msg);
    return { enviado: false, erro: msg };
  }
}

export async function convidarMembro(
  donoId: string,
  emailBruto: unknown
): Promise<ResultadoEquipe<{ convite: ConviteEquipe; emailEnviado: boolean }>> {
  const db = getAdminClient();
  if (!db) return falha('indisponivel', 'Banco indisponível.');

  const email = normalizarEmail(emailBruto);
  if (!emailValido(email)) return falha('invalido', 'Informe um e-mail válido.');

  const { data: org } = await db.from('ap_organizacoes').select('id, nome, dono_id').eq('dono_id', donoId).maybeSingle();
  if (!org) return falha('nao_autorizado', 'Só o dono do escritório pode convidar.');

  const plano = await infoPlano(db, donoId);
  if (plano.limite <= 1) return falha('recurso_pro', MSG_RECURSO_PRO);

  const agoraIso = new Date().toISOString();
  // Convites vencidos e não aceitos saem do caminho (liberam a vaga e o e-mail).
  await db.from('ap_organizacao_convites').delete().eq('organizacao_id', org.id).is('aceito_em', null).lt('expira_em', agoraIso);

  const { data: membros } = await db.from('ap_organizacao_membros').select('user_id').eq('organizacao_id', org.id);
  const idsMembros = ((membros ?? []) as { user_id: string }[]).map(m => m.user_id);
  const perfis = await perfisPorId(db, idsMembros);
  if ([...perfis.values()].some(p => p.email === email)) return falha('duplicado', 'Esta pessoa já faz parte do escritório.');

  // Reconvidar o mesmo e-mail substitui o convite anterior (novo token e nova validade), sem gastar vaga extra.
  const { data: pendentes } = await db
    .from('ap_organizacao_convites')
    .select('id, email')
    .eq('organizacao_id', org.id)
    .is('aceito_em', null);
  const outrosPendentes = ((pendentes ?? []) as { id: string; email: string }[]).filter(c => c.email !== email);
  if (!cabeMaisUm(idsMembros.length + outrosPendentes.length, plano.limite)) return falha('limite_membros', MSG_LIMITE(plano.limite));

  await db.from('ap_organizacao_convites').delete().eq('organizacao_id', org.id).eq('email', email).is('aceito_em', null);

  const token = gerarTokenConvite();
  const { data: criado, error } = await db
    .from('ap_organizacao_convites')
    .insert({
      organizacao_id: org.id,
      email,
      token,
      papel: 'membro',
      expira_em: calcularExpiracaoConvite().toISOString(),
      criado_por: donoId
    })
    .select('id, email, expira_em, created_at')
    .single();
  if (error || !criado) {
    console.error('[equipe] erro ao criar convite:', error?.message);
    return falha('erro', 'Não foi possível criar o convite.');
  }

  const perfilDono = (await perfisPorId(db, [donoId])).get(donoId);
  const link = linkConvite(token);
  const envio = await enviarEmailConvite(email, org.nome as string, nomeExibicao(perfilDono?.nome, perfilDono?.email), link);

  return {
    sucesso: true,
    dados: {
      emailEnviado: envio.enviado,
      convite: {
        id: criado.id as string,
        email: criado.email as string,
        expiraEm: criado.expira_em as string,
        criadoEm: criado.created_at as string,
        expirado: false,
        link
      }
    }
  };
}

export async function revogarConvite(donoId: string, conviteId: string): Promise<ResultadoEquipe> {
  const db = getAdminClient();
  if (!db) return falha('indisponivel', 'Banco indisponível.');
  const { data: org } = await db.from('ap_organizacoes').select('id').eq('dono_id', donoId).maybeSingle();
  if (!org) return falha('nao_autorizado', 'Só o dono do escritório pode revogar convites.');
  const { data, error } = await db
    .from('ap_organizacao_convites')
    .delete()
    .eq('id', conviteId)
    .eq('organizacao_id', org.id)
    .is('aceito_em', null)
    .select('id');
  if (error) {
    console.error('[equipe] erro ao revogar convite:', error.message);
    return falha('erro', 'Não foi possível revogar o convite.');
  }
  if (!data || data.length === 0) return falha('nao_encontrado', 'Convite não encontrado.');
  return { sucesso: true };
}

/**
 * Aceita o convite: confere token, validade, e-mail logado == e-mail convidado (e confirmado), que o usuário não
 * esteja em outro escritório e o limite do plano do dono. O convite é "reivindicado" de forma atômica antes de
 * inserir o membro, então dois cliques ou duas abas não geram duas entradas.
 */
export async function aceitarConvite(
  usuario: UsuarioAutenticado,
  token: unknown
): Promise<ResultadoEquipe<{ escritorioId: string; escritorioNome: string }>> {
  const db = getAdminClient();
  if (!db) return falha('indisponivel', 'Banco indisponível.');
  if (!tokenConviteComFormatoValido(token)) return falha('convite_invalido', 'Convite inválido. Peça um novo link a quem convidou você.');

  const { data: convite } = await db
    .from('ap_organizacao_convites')
    .select('id, organizacao_id, email, expira_em, aceito_em')
    .eq('token', token)
    .maybeSingle();
  if (!convite) return falha('convite_invalido', 'Convite inválido ou revogado. Peça um novo link a quem convidou você.');
  if (convite.aceito_em) return falha('convite_usado', 'Este convite já foi usado.');
  if (conviteExpirado(convite.expira_em as string)) {
    return falha('convite_expirado', 'Este convite expirou. Peça um novo link a quem convidou você.');
  }

  if (!usuario.emailConfirmado) {
    return falha('email_nao_confirmado', 'Confirme o e-mail da sua conta (veja sua caixa de entrada) antes de aceitar o convite.');
  }
  if (normalizarEmail(convite.email) !== usuario.email) {
    return falha(
      'email_diferente',
      `Este convite foi enviado para ${mascararEmail(convite.email as string)}. Entre com essa conta para aceitar.`
    );
  }

  const { data: org } = await db.from('ap_organizacoes').select('id, nome, dono_id').eq('id', convite.organizacao_id as string).maybeSingle();
  if (!org) return falha('convite_invalido', 'Este escritório não existe mais.');

  if (await organizacaoDoUsuario(db, usuario.id)) {
    return falha('ja_em_escritorio', 'Você já faz parte de um escritório. Saia dele antes de aceitar outro convite.');
  }

  const plano = await infoPlano(db, org.dono_id as string);
  const { count } = await db
    .from('ap_organizacao_membros')
    .select('user_id', { count: 'exact', head: true })
    .eq('organizacao_id', org.id);
  if (!cabeMaisUm(count ?? 0, plano.limite)) return falha('limite_membros', MSG_LIMITE(plano.limite));

  const { data: reivindicado } = await db
    .from('ap_organizacao_convites')
    .update({ aceito_em: new Date().toISOString() })
    .eq('id', convite.id)
    .is('aceito_em', null)
    .select('id');
  if (!reivindicado || reivindicado.length === 0) return falha('convite_usado', 'Este convite já foi usado.');

  const { error } = await db.from('ap_organizacao_membros').insert({ organizacao_id: org.id, user_id: usuario.id, papel: 'membro' });
  if (error) {
    console.error('[equipe] erro ao registrar membro:', error.message);
    await db.from('ap_organizacao_convites').update({ aceito_em: null }).eq('id', convite.id);
    if (error.code === '23505') return falha('ja_em_escritorio', 'Você já faz parte de um escritório.');
    return falha('erro', 'Não foi possível entrar no escritório.');
  }

  return { sucesso: true, dados: { escritorioId: org.id as string, escritorioNome: org.nome as string } };
}
