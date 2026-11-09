import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getAdminClient } from '@/lib/track';
import { obterStatusPlanoUsuario, type PlanoTipo } from '@/lib/planos';
import { classifyTag } from '@/lib/classify';
import { formatProcessNumber } from '@/lib/cnj';
import { enviarAlertaWhatsApp, enviarTextoWhatsApp, normalizarTelefoneBr } from '@/lib/whatsapp';
import {
  DjenIndisponivelError,
  buscarPublicacoesPorNomeDjen,
  buscarPublicacoesPorOabDjen,
  buscarPublicacoesPorTermoDjen,
  dataBrasil,
  djenEmPausa,
  validarBuscaDiario,
  type PublicacaoDjen,
  type TipoBuscaDiario
} from '@/lib/djen';

/**
 * Monitoramento do Diário (DJEN) por OAB, nome ou termo. Tabelas: ap_monitoramento_diario (as buscas) e
 * ap_publicacoes_diario (o feed). Regras de produto:
 * - OAB traz os DOIS polos (o advogado atua pelos dois lados); nome só traz processos em que o pesquisado é
 *   autor (nome exato normalizado); termo é busca de texto no corpo da publicação;
 * - 1ª varredura importa só os últimos 7 dias e NÃO alerta; depois, alerta só publicação nova (dedupe pelo
 *   comunicacao_id do DJEN), uma mensagem por busca por execução;
 * - o limite de buscas ATIVAS vem do plano (limiteBuscasMonitoradas); owner/admin não têm limite.
 */

export type { TipoBuscaDiario };
export type TagPublicacao = 'urgente' | 'positivo' | 'andamento' | 'informativo';

export interface BuscaDiario {
  id: string;
  tipo: TipoBuscaDiario;
  valor: string;
  ufOab: string;
  rotulo: string;
  ativo: boolean;
  notificarWhatsapp: boolean;
  notificarEmail: boolean;
  ultimaVarreduraEm: string | null;
  proximaVarreduraEm: string | null;
  ultimoErro: string | null;
  createdAt: string;
  naoLidas: number;
  /** Busca de um colega do escritório: só leitura. */
  somenteLeitura?: boolean;
  compartilhadoPor?: string;
}

export interface PublicacaoDiario {
  id: string;
  buscaId: string;
  buscaRotulo: string;
  buscaTipo: TipoBuscaDiario;
  comunicacaoId: number;
  numeroCnj: string | null;
  tribunal: string | null;
  orgao: string | null;
  classe: string | null;
  tipoComunicacao: string | null;
  dataDisponibilizacao: string | null;
  texto: string | null;
  tag: TagPublicacao;
  lida: boolean;
  createdAt: string;
}

export interface UsoLimiteDiario {
  plano: PlanoTipo;
  /** Buscas ativas hoje. */
  ativas: number;
  /** null = sem limite (owner/admin). */
  limite: number | null;
  ilimitado: boolean;
}

export type CodigoErroDiario = 'limite_plano' | 'invalido' | 'duplicado' | 'indisponivel' | 'nao_encontrado' | 'erro';

export interface ResultadoOperacao<T = object> {
  sucesso: boolean;
  erro?: string;
  codigo?: CodigoErroDiario;
  dados?: T;
}

const SEIS_HORAS_MS = 6 * 3600_000;
const TRINTA_MIN_MS = 30 * 60_000;
const UMA_HORA_MS = 3600_000;
const PRIMEIRA_VARREDURA_DIAS = 7;
const MAX_DIAS_RETROATIVOS = 30;
const MAX_TEXTO_PUBLICACAO = 4000;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

const MSG_LIMITE = (limite: number) =>
  `Você chegou ao limite de ${limite} ${limite === 1 ? 'busca monitorada ativa' : 'buscas monitoradas ativas'} do seu plano. Pause ou exclua uma busca, ou assine o Plano Pro para monitorar até 10 buscas no Diário.`;

// ---------------------------------------------------------------------------------------------------------------
// Plano e limite
// ---------------------------------------------------------------------------------------------------------------

async function eOwnerOuAdmin(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await db.from('ap_perfis').select('role').eq('id', userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === 'owner' || role === 'admin';
}

async function contarAtivas(db: SupabaseClient, userId: string): Promise<number> {
  const { count } = await db
    .from('ap_monitoramento_diario')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('ativo', true);
  return count ?? 0;
}

/** Uso do limite de buscas ativas do usuário (ex.: 3 de 10). */
export async function obterUsoLimiteDiario(userId: string): Promise<UsoLimiteDiario> {
  const db = getAdminClient();
  const status = await obterStatusPlanoUsuario(userId);
  if (!db) return { plano: status.plano, ativas: 0, limite: status.regras.limiteBuscasMonitoradas, ilimitado: false };
  const [ativas, privilegiado] = await Promise.all([contarAtivas(db, userId), eOwnerOuAdmin(db, userId)]);
  return {
    plano: status.plano,
    ativas,
    limite: privilegiado ? null : status.regras.limiteBuscasMonitoradas,
    ilimitado: privilegiado
  };
}

// ---------------------------------------------------------------------------------------------------------------
// CRUD das buscas
// ---------------------------------------------------------------------------------------------------------------

interface LinhaBusca {
  id: string;
  user_id: string;
  tipo: TipoBuscaDiario;
  valor: string;
  uf_oab: string;
  rotulo: string;
  ativo: boolean;
  notificar_whatsapp: boolean;
  notificar_email: boolean;
  ultima_varredura_em: string | null;
  proxima_varredura_em: string | null;
  ultimo_erro: string | null;
  created_at: string;
}

const mapearBusca = (l: LinhaBusca, naoLidas = 0): BuscaDiario => ({
  id: l.id,
  tipo: l.tipo,
  valor: l.valor,
  ufOab: l.uf_oab || '',
  rotulo: l.rotulo,
  ativo: l.ativo,
  notificarWhatsapp: l.notificar_whatsapp,
  notificarEmail: l.notificar_email,
  ultimaVarreduraEm: l.ultima_varredura_em,
  proximaVarreduraEm: l.proxima_varredura_em,
  ultimoErro: l.ultimo_erro,
  createdAt: l.created_at,
  naoLidas
});

/** Cadastra uma busca (ou reativa uma pausada igual). Valida o formato e aplica o limite do plano. */
export async function cadastrarBuscaDiario(params: {
  userId: string;
  tipo: string;
  valor: string;
  ufOab?: string | null;
  notificarWhatsapp?: boolean;
  notificarEmail?: boolean;
}): Promise<ResultadoOperacao<{ busca: LinhaBusca }>> {
  const db = getAdminClient();
  if (!db) return { sucesso: false, codigo: 'indisponivel', erro: 'Banco indisponível.' };

  const v = validarBuscaDiario(params.tipo, params.valor, params.ufOab);
  if (!v.ok) return { sucesso: false, codigo: 'invalido', erro: v.erro };

  const { data: existente } = await db
    .from('ap_monitoramento_diario')
    .select('*')
    .eq('user_id', params.userId)
    .eq('tipo', params.tipo)
    .eq('valor', v.valor)
    .eq('uf_oab', v.ufOab)
    .maybeSingle();

  if (existente?.ativo) return { sucesso: false, codigo: 'duplicado', erro: 'Você já monitora esta busca.' };

  const uso = await obterUsoLimiteDiario(params.userId);
  if (uso.limite !== null && uso.ativas >= uso.limite) {
    return { sucesso: false, codigo: 'limite_plano', erro: MSG_LIMITE(uso.limite) };
  }

  const campos = {
    ativo: true,
    notificar_whatsapp: params.notificarWhatsapp ?? true,
    notificar_email: params.notificarEmail ?? true,
    proxima_varredura_em: new Date().toISOString()
  };

  const consulta = existente
    ? db.from('ap_monitoramento_diario').update(campos).eq('id', existente.id).select('*').single()
    : db
        .from('ap_monitoramento_diario')
        .insert({ user_id: params.userId, tipo: params.tipo, valor: v.valor, uf_oab: v.ufOab, rotulo: v.rotulo, ...campos })
        .select('*')
        .single();
  const { data, error } = await consulta;

  if (error || !data) {
    console.error('[monitoramentoDiario] erro ao cadastrar busca:', error?.message);
    return { sucesso: false, codigo: 'erro', erro: 'Falha ao salvar a busca monitorada.' };
  }
  return { sucesso: true, dados: { busca: data as LinhaBusca } };
}

/** Buscas do usuário, com a contagem de publicações não lidas de cada uma. */
export async function listarBuscasDiario(userId: string): Promise<BuscaDiario[]> {
  const db = getAdminClient();
  if (!db) return [];
  const { data, error } = await db
    .from('ap_monitoramento_diario')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  const linhas = data as LinhaBusca[];
  const contagens = await Promise.all(
    linhas.map(l =>
      db
        .from('ap_publicacoes_diario')
        .select('id', { count: 'exact', head: true })
        .eq('monitoramento_id', l.id)
        .eq('lida', false)
        .then(r => r.count ?? 0)
    )
  );
  return linhas.map((l, i) => mapearBusca(l, contagens[i]));
}

/** Pausa/retoma e liga/desliga canais. Retomar confere o limite do plano. */
export async function atualizarBuscaDiario(
  userId: string,
  id: string,
  campos: { ativo?: boolean; notificarWhatsapp?: boolean; notificarEmail?: boolean }
): Promise<ResultadoOperacao> {
  const db = getAdminClient();
  if (!db) return { sucesso: false, codigo: 'indisponivel', erro: 'Banco indisponível.' };

  const { data: atual } = await db.from('ap_monitoramento_diario').select('id, ativo').eq('id', id).eq('user_id', userId).maybeSingle();
  if (!atual) return { sucesso: false, codigo: 'nao_encontrado', erro: 'Busca não encontrada.' };

  const updates: Record<string, unknown> = {};
  if (typeof campos.notificarWhatsapp === 'boolean') updates.notificar_whatsapp = campos.notificarWhatsapp;
  if (typeof campos.notificarEmail === 'boolean') updates.notificar_email = campos.notificarEmail;
  if (typeof campos.ativo === 'boolean') {
    if (campos.ativo && !atual.ativo) {
      const uso = await obterUsoLimiteDiario(userId);
      if (uso.limite !== null && uso.ativas >= uso.limite) {
        return { sucesso: false, codigo: 'limite_plano', erro: MSG_LIMITE(uso.limite) };
      }
      updates.proxima_varredura_em = new Date().toISOString();
    }
    updates.ativo = campos.ativo;
  }
  if (Object.keys(updates).length === 0) return { sucesso: false, codigo: 'invalido', erro: 'Nenhum campo para atualizar.' };

  const { error } = await db.from('ap_monitoramento_diario').update(updates).eq('id', id).eq('user_id', userId);
  if (error) {
    console.error('[monitoramentoDiario] erro ao atualizar busca:', error.message);
    return { sucesso: false, codigo: 'erro', erro: 'Não foi possível atualizar a busca.' };
  }
  return { sucesso: true };
}

/** Exclui a busca e, em cascata, as publicações dela. */
export async function excluirBuscaDiario(userId: string, id: string): Promise<ResultadoOperacao> {
  const db = getAdminClient();
  if (!db) return { sucesso: false, codigo: 'indisponivel', erro: 'Banco indisponível.' };
  const { error } = await db.from('ap_monitoramento_diario').delete().eq('id', id).eq('user_id', userId);
  if (error) {
    console.error('[monitoramentoDiario] erro ao excluir busca:', error.message);
    return { sucesso: false, codigo: 'erro', erro: 'Falha ao excluir a busca.' };
  }
  return { sucesso: true };
}

/**
 * Chamado pelo opt-out do WhatsApp (SAIR/PARAR): desliga o canal em todas as buscas do Diário dos usuários.
 * O webhook (app/api/whatsapp/webhook) deve chamar isto junto com o update de ap_processos_monitorados.
 */
export async function desativarWhatsappDiario(db: SupabaseClient, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const { error } = await db.from('ap_monitoramento_diario').update({ notificar_whatsapp: false }).in('user_id', userIds);
  if (error) console.error('[monitoramentoDiario] erro no opt-out do WhatsApp:', error.message);
}

// ---------------------------------------------------------------------------------------------------------------
// Feed de publicações
// ---------------------------------------------------------------------------------------------------------------

interface LinhaPublicacao {
  id: string;
  monitoramento_id: string;
  comunicacao_id: number;
  numero_cnj: string | null;
  tribunal: string | null;
  orgao: string | null;
  classe: string | null;
  tipo_comunicacao: string | null;
  data_disponibilizacao: string | null;
  texto: string | null;
  tag: TagPublicacao;
  lida: boolean;
  created_at: string;
  ap_monitoramento_diario: { rotulo: string; tipo: TipoBuscaDiario } | { rotulo: string; tipo: TipoBuscaDiario }[] | null;
}

/** Publicações do usuário (de uma busca ou de todas), da mais nova para a mais antiga, paginadas. */
export async function listarPublicacoesDiario(
  userId: string,
  opcoes: { buscaId?: string | null; apenasNaoLidas?: boolean; pagina?: number; porPagina?: number } = {}
): Promise<{ publicacoes: PublicacaoDiario[]; total: number; pagina: number; porPagina: number }> {
  const pagina = Math.max(1, Math.floor(opcoes.pagina ?? 1));
  const porPagina = Math.min(50, Math.max(1, Math.floor(opcoes.porPagina ?? 20)));
  const vazio = { publicacoes: [], total: 0, pagina, porPagina };
  const db = getAdminClient();
  if (!db) return vazio;

  let consulta = db
    .from('ap_publicacoes_diario')
    .select('*, ap_monitoramento_diario(rotulo, tipo)', { count: 'exact' })
    .eq('user_id', userId)
    .order('data_disponibilizacao', { ascending: false })
    .order('created_at', { ascending: false })
    .range((pagina - 1) * porPagina, pagina * porPagina - 1);
  if (opcoes.buscaId) consulta = consulta.eq('monitoramento_id', opcoes.buscaId);
  if (opcoes.apenasNaoLidas) consulta = consulta.eq('lida', false);

  const { data, count, error } = await consulta;
  if (error || !data) {
    if (error) console.error('[monitoramentoDiario] erro ao listar publicações:', error.message);
    return vazio;
  }

  const publicacoes = (data as unknown as LinhaPublicacao[]).map(l => {
    const busca = Array.isArray(l.ap_monitoramento_diario) ? l.ap_monitoramento_diario[0] : l.ap_monitoramento_diario;
    return {
      id: l.id,
      buscaId: l.monitoramento_id,
      buscaRotulo: busca?.rotulo ?? '',
      buscaTipo: busca?.tipo ?? 'termo',
      comunicacaoId: Number(l.comunicacao_id),
      numeroCnj: l.numero_cnj,
      tribunal: l.tribunal,
      orgao: l.orgao,
      classe: l.classe,
      tipoComunicacao: l.tipo_comunicacao,
      dataDisponibilizacao: l.data_disponibilizacao,
      texto: l.texto,
      tag: l.tag,
      lida: l.lida,
      createdAt: l.created_at
    } satisfies PublicacaoDiario;
  });
  return { publicacoes, total: count ?? publicacoes.length, pagina, porPagina };
}

/** Marca como lidas as publicações indicadas (`ids`), as de uma busca (`buscaId`) ou todas. */
export async function marcarPublicacoesLidas(userId: string, alvo: { ids?: string[]; buscaId?: string | null }): Promise<ResultadoOperacao> {
  const db = getAdminClient();
  if (!db) return { sucesso: false, codigo: 'indisponivel', erro: 'Banco indisponível.' };
  let consulta = db.from('ap_publicacoes_diario').update({ lida: true }).eq('user_id', userId).eq('lida', false);
  if (alvo.ids?.length) consulta = consulta.in('id', alvo.ids.slice(0, 200));
  else if (alvo.buscaId) consulta = consulta.eq('monitoramento_id', alvo.buscaId);
  const { error } = await consulta;
  if (error) {
    console.error('[monitoramentoDiario] erro ao marcar lidas:', error.message);
    return { sucesso: false, codigo: 'erro', erro: 'Não foi possível marcar como lidas.' };
  }
  return { sucesso: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Varredura (cron)
// ---------------------------------------------------------------------------------------------------------------

/** Campos de ap_monitoramento_diario que a varredura precisa (o cron seleciona exatamente estes). */
export const CAMPOS_VARREDURA_DIARIO =
  'id, user_id, tipo, valor, uf_oab, rotulo, notificar_whatsapp, notificar_email, ultima_varredura_em';

export type ItemVarreduraDiario = Pick<
  LinhaBusca,
  'id' | 'user_id' | 'tipo' | 'valor' | 'uf_oab' | 'rotulo' | 'notificar_whatsapp' | 'notificar_email' | 'ultima_varredura_em'
>;

type Desfecho = 'enviado' | 'falhou' | 'sem_contato' | 'nao_configurado' | 'desligado';

export interface ResultadoVarreduraItem {
  id: string;
  rotulo: string;
  primeiraVarredura: boolean;
  encontradas: number;
  novas: number;
  truncado: boolean;
  whatsapp: Desfecho;
  email: Desfecho;
  erro?: string;
}

export interface ResumoVarreduraDiario {
  processadas: number;
  comErro: number;
  adiadas: number;
  novasPublicacoes: number;
  alertasEnviados: number;
  itens: ResultadoVarreduraItem[];
}

const compactar = (t: string) => t.replace(/\s+/g, ' ').trim();
const truncar = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const fmtDataBr = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '');
const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface PublicacaoNova {
  numero_cnj: string | null;
  tribunal: string | null;
  tipo_comunicacao: string | null;
  data_disponibilizacao: string | null;
  texto: string | null;
  tag: TagPublicacao;
}

function cabecalhoAlerta(rotulo: string, novas: PublicacaoNova[]) {
  const urgentes = novas.filter(n => n.tag === 'urgente').length;
  return {
    urgentes,
    resumo: `${plural(novas.length, 'nova publicação', 'novas publicações')}${urgentes ? `, ${plural(urgentes, 'urgente', 'urgentes')}` : ''}`,
    titulo: `Diário: ${rotulo}`
  };
}

function linhaPublicacao(n: PublicacaoNova, comTrecho: boolean): string {
  const proc = n.numero_cnj ? formatProcessNumber(n.numero_cnj) : 'sem nº de processo';
  const base = `• ${[n.tribunal, proc].filter(Boolean).join(' ')} — ${n.tipo_comunicacao ?? 'Comunicação'} (${fmtDataBr(n.data_disponibilizacao)})`;
  return comTrecho && n.texto ? `${base}\n  ${truncar(compactar(n.texto), 140)}` : base;
}

/** Uma mensagem por busca por execução: urgentes em destaque, no máximo 6 itens, o resto vira "+ N". */
export function montarMensagemWhatsApp(rotulo: string, novas: PublicacaoNova[]): string {
  const { urgentes, resumo } = cabecalhoAlerta(rotulo, novas);
  const ordenadas = [...novas].sort((a, b) => Number(b.tag === 'urgente') - Number(a.tag === 'urgente'));
  const mostradas = ordenadas.slice(0, 6);
  const linhas = mostradas.map(n => linhaPublicacao(n, n.tag === 'urgente'));
  const resto = ordenadas.length - mostradas.length;
  return [
    `*Diário de Justiça — ${rotulo}*`,
    `${resumo}.${urgentes ? ' Atenção: pode haver prazo correndo.' : ''}`,
    '',
    ...linhas,
    ...(resto > 0 ? [`+ ${plural(resto, 'outra publicação', 'outras publicações')}`] : []),
    '',
    `Veja tudo em ${SITE_URL}/processos`
  ].join('\n');
}

async function enviarWhatsAppDiario(telefone: string, rotulo: string, novas: PublicacaoNova[]): Promise<Desfecho> {
  // Texto livre só vale dentro da janela de 24h de conversa; fora dela a Meta recusa e caímos no template.
  const texto = await enviarTextoWhatsApp(telefone, montarMensagemWhatsApp(rotulo, novas));
  if (texto.enviado) return 'enviado';
  if (texto.naoConfigurado) return 'nao_configurado';
  if (texto.definitivo) return 'falhou';

  const { resumo } = cabecalhoAlerta(rotulo, novas);
  const template = await enviarAlertaWhatsApp(
    telefone,
    { numeroCnj: rotulo, tribunal: 'Diário de Justiça' },
    { resumo, proximoPasso: 'Abra "Meus processos" na sua conta TechTie para ver as publicações.' },
    novas.map(n => ({ titulo: `${n.tipo_comunicacao ?? 'Comunicação'} ${n.numero_cnj ?? ''}`.trim() }))
  );
  if (template.enviado) return 'enviado';
  return template.naoConfigurado ? 'nao_configurado' : 'falhou';
}

async function enviarEmailDiario(destino: string, rotulo: string, novas: PublicacaoNova[]): Promise<Desfecho> {
  const chave = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!chave || !from) return 'nao_configurado';

  const { urgentes, resumo } = cabecalhoAlerta(rotulo, novas);
  const ordenadas = [...novas].sort((a, b) => Number(b.tag === 'urgente') - Number(a.tag === 'urgente')).slice(0, 15);
  const itens = ordenadas
    .map(n => {
      const proc = n.numero_cnj ? formatProcessNumber(n.numero_cnj) : 'sem nº de processo';
      const cor = n.tag === 'urgente' ? '#b42318' : '#060F28';
      return `<li style="margin-bottom:10px"><strong style="color:${cor}">${n.tag === 'urgente' ? 'URGENTE — ' : ''}${escapeHtml([n.tribunal, proc].filter(Boolean).join(' '))}</strong> — ${escapeHtml(n.tipo_comunicacao ?? 'Comunicação')} (${fmtDataBr(n.data_disponibilizacao)})<br/><span style="color:#555">${escapeHtml(truncar(compactar(n.texto ?? ''), 280))}</span></li>`;
    })
    .join('');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#060F28">Diário de Justiça: ${escapeHtml(rotulo)}</h2>
      <p style="color:#555">${escapeHtml(resumo)}.${urgentes ? ' Atenção: pode haver prazo correndo.' : ''}</p>
      <ul style="padding-left:18px">${itens}</ul>
      ${novas.length > ordenadas.length ? `<p style="color:#555">+ ${novas.length - ordenadas.length} outras publicações no app.</p>` : ''}
      <p><a href="${escapeHtml(SITE_URL)}/processos" style="color:#1B3FA8">Ver todas as publicações</a></p>
      <p style="color:#888;font-size:12px;margin-top:24px">Alerta automático do monitoramento do Diário de Justiça Eletrônico Nacional. Para pausar ou excluir esta busca, acesse Meus processos na sua conta.</p>
    </div>
  `.trim();

  try {
    const { error } = await new Resend(chave).emails.send({ from, to: destino, subject: `Diário: ${resumo} — ${rotulo}`, html });
    if (error) {
      console.error('[monitoramentoDiario] falha ao enviar e-mail:', error.message);
      return 'falhou';
    }
    return 'enviado';
  } catch (e) {
    console.error('[monitoramentoDiario] exceção ao enviar e-mail:', e instanceof Error ? e.message : e);
    return 'falhou';
  }
}

async function carregarContato(db: SupabaseClient, userId: string): Promise<{ email: string | null; telefone: string | null }> {
  const { data: perfil } = await db.from('ap_perfis').select('email, telefone').eq('id', userId).maybeSingle();
  let email: string | null = (perfil?.email as string | null) ?? null;
  if (!email) {
    const { data } = await db.auth.admin.getUserById(userId);
    email = data?.user?.email ?? null;
  }
  return { email, telefone: (perfil?.telefone as string | null) ?? null };
}

function janelaDaBusca(item: ItemVarreduraDiario): { inicio: string; fim: string; primeira: boolean } {
  const hoje = dataBrasil(0);
  if (!item.ultima_varredura_em) return { inicio: dataBrasil(-PRIMEIRA_VARREDURA_DIAS), fim: hoje, primeira: true };
  // 1 dia de sobreposição: o DJEN pode publicar com atraso; o dedupe por comunicacao_id descarta o que já temos.
  const diasAtras = Math.ceil((Date.now() - new Date(item.ultima_varredura_em).getTime()) / 86_400_000) + 1;
  return { inicio: dataBrasil(-Math.min(Math.max(diasAtras, 2), MAX_DIAS_RETROATIVOS)), fim: hoje, primeira: false };
}

async function buscarNoDjen(item: ItemVarreduraDiario, inicio: string, fim: string) {
  if (item.tipo === 'oab') return buscarPublicacoesPorOabDjen(item.valor, item.uf_oab, { inicio, fim });
  if (item.tipo === 'nome') return buscarPublicacoesPorNomeDjen(item.valor, { inicio, fim });
  return buscarPublicacoesPorTermoDjen(item.valor, { inicio, fim });
}

function paraLinha(item: ItemVarreduraDiario, p: PublicacaoDjen) {
  return {
    monitoramento_id: item.id,
    user_id: item.user_id,
    comunicacao_id: p.comunicacaoId,
    numero_cnj: p.numeroCnj || null,
    tribunal: p.tribunal || null,
    orgao: p.orgao || null,
    classe: p.classe || null,
    tipo_comunicacao: p.tipoComunicacao,
    data_disponibilizacao: p.dataDisponibilizacao || null,
    texto: truncar(compactar(p.texto), MAX_TEXTO_PUBLICACAO) || null,
    tag: classifyTag(`${p.tipoComunicacao} ${p.texto}`) as TagPublicacao
  };
}

async function varrerUm(db: SupabaseClient, item: ItemVarreduraDiario): Promise<ResultadoVarreduraItem> {
  const { inicio, fim, primeira } = janelaDaBusca(item);
  const resultado: ResultadoVarreduraItem = {
    id: item.id,
    rotulo: item.rotulo,
    primeiraVarredura: primeira,
    encontradas: 0,
    novas: 0,
    truncado: false,
    whatsapp: 'desligado',
    email: 'desligado'
  };

  const { publicacoes, truncado } = await buscarNoDjen(item, inicio, fim);
  resultado.encontradas = publicacoes.length;
  resultado.truncado = truncado;

  // Grava só o que ainda não existe (ignoreDuplicates devolve apenas as linhas inseridas = as novas).
  const novas: PublicacaoNova[] = [];
  const linhas = publicacoes.map(p => paraLinha(item, p));
  for (let i = 0; i < linhas.length; i += 200) {
    const { data, error } = await db
      .from('ap_publicacoes_diario')
      .upsert(linhas.slice(i, i + 200), { onConflict: 'monitoramento_id,comunicacao_id', ignoreDuplicates: true })
      .select('numero_cnj, tribunal, tipo_comunicacao, data_disponibilizacao, texto, tag');
    if (error) throw new Error(`Falha ao gravar publicações: ${error.message}`);
    novas.push(...((data as PublicacaoNova[] | null) ?? []));
  }
  resultado.novas = novas.length;

  // 1ª varredura importa o histórico recente sem avisar (evita um disparo em massa ao cadastrar a busca).
  if (!primeira && novas.length > 0 && (item.notificar_whatsapp || item.notificar_email)) {
    const contato = await carregarContato(db, item.user_id);
    if (item.notificar_whatsapp) {
      const telefone = normalizarTelefoneBr(contato.telefone);
      resultado.whatsapp = telefone ? await enviarWhatsAppDiario(telefone, item.rotulo, novas) : 'sem_contato';
    }
    if (item.notificar_email) {
      resultado.email = contato.email ? await enviarEmailDiario(contato.email, item.rotulo, novas) : 'sem_contato';
    }
  }

  const agora = Date.now();
  await db
    .from('ap_monitoramento_diario')
    .update({
      ultima_varredura_em: new Date(agora).toISOString(),
      proxima_varredura_em: new Date(agora + SEIS_HORAS_MS).toISOString(),
      ultimo_erro: null
    })
    .eq('id', item.id);

  return resultado;
}

/**
 * Varre as buscas informadas (o cron manda as elegíveis). Tolerante a falha por item: erro numa busca grava
 * `ultimo_erro`, reagenda para daqui a 1h e segue. Se o DJEN entrar em pausa (429), as buscas restantes ficam
 * para a próxima execução. Nunca lança erro.
 */
export async function varrerMonitoramentosDiario(db: SupabaseClient, itens: ItemVarreduraDiario[]): Promise<ResumoVarreduraDiario> {
  const resumo: ResumoVarreduraDiario = { processadas: 0, comErro: 0, adiadas: 0, novasPublicacoes: 0, alertasEnviados: 0, itens: [] };

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    if (djenEmPausa()) {
      resumo.adiadas += itens.length - i;
      break;
    }
    try {
      const r = await varrerUm(db, item);
      resumo.processadas++;
      resumo.novasPublicacoes += r.novas;
      resumo.alertasEnviados += Number(r.whatsapp === 'enviado') + Number(r.email === 'enviado');
      resumo.itens.push(r);
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : String(e);
      console.error('[monitoramentoDiario] erro ao varrer busca:', item.rotulo, mensagem);
      resumo.comErro++;
      resumo.itens.push({
        id: item.id,
        rotulo: item.rotulo,
        primeiraVarredura: !item.ultima_varredura_em,
        encontradas: 0,
        novas: 0,
        truncado: false,
        whatsapp: 'desligado',
        email: 'desligado',
        erro: mensagem
      });
      const tentarEm = e instanceof DjenIndisponivelError ? TRINTA_MIN_MS : UMA_HORA_MS;
      await db
        .from('ap_monitoramento_diario')
        .update({ ultimo_erro: truncar(mensagem, 300), proxima_varredura_em: new Date(Date.now() + tentarEm).toISOString() })
        .eq('id', item.id);
    }
  }
  return resumo;
}
