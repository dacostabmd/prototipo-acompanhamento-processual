import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { diferencaDias, formatarDataBr, hojeSaoPaulo, somarDias } from '@/lib/prazos';
import { enviarTextoWhatsApp, normalizarTelefoneBr, type ResultadoEnvioWhatsApp } from '@/lib/whatsapp';
import { verificarRecursoPlano } from '@/lib/planos';

/**
 * Lembretes da agenda de prazos (cron /api/cron/lembretes-prazos, ~11h UTC = 8h em Brasília).
 *
 * Marcos: 'd-3' (vence em 2 ou 3 dias; o 2 só ocorre se o cron falhou um dia ou o prazo foi criado em cima da
 * hora), 'd-1' (amanhã), 'd0' (hoje) e 'atrasado' (venceu e ainda está pendente; avisa uma vez, com até 7 dias de
 * tolerância a falha do cron). Cada marco sai uma única vez por prazo: fica em `lembretes_enviados`.
 *
 * CANAIS, como no resto do sistema (lib/filaAlertas.ts):
 *  - E-mail: Resend (RESEND_API_KEY/RESEND_FROM_EMAIL); sem configuração é no-op e o marco NÃO é registrado.
 *  - WhatsApp: mensagem iniciada pela empresa fora da janela de 24h só pode ser TEMPLATE aprovado. Usa
 *    WHATSAPP_TEMPLATE_PRAZO (categoria Utilidade, pt_BR, 4 variáveis):
 *
 *      Lembrete de {{1}}: {{2}} {{3}}. {{4}}
 *      Para alterar seus avisos, acesse sua conta na TechTie.
 *
 *    {{1}} tipo (prazo/tarefa/audiência), {{2}} título (com o processo), {{3}} situação ("vence amanhã
 *    (12/11/2026)"), {{4}} complemento ("Mais 2 compromissos na sua agenda."). Sem o template configurado, tenta
 *    texto livre, que a Meta só entrega dentro da janela de 24h (fora dela rejeita, e o e-mail segue valendo).
 *  - Opt-out: não existe flag de perfil; o "SAIR" do WhatsApp e o descadastro por e-mail desligam
 *    notificar_whatsapp/notificar_email em ap_processos_monitorados. Replicamos: se o usuário tem processos
 *    acompanhados e NENHUM tem o canal ligado, o canal não recebe lembretes. Usuário sem processos acompanhados
 *    recebe nos dois canais (não há onde registrar o opt-out).
 *  - Só usuários com o recurso agendaPrazos (Pro, owner e admin).
 */

export type MarcoLembrete = 'd-3' | 'd-1' | 'd0' | 'atrasado';

const TOLERANCIA_ATRASO_DIAS = 7;
const CONCORRENCIA = 5;
const LIMITE_PRAZOS = 2000;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://jusconsulta.com.br';

/** Marco que se aplica a um prazo pendente hoje, ou null quando ainda é cedo (> 3 dias) ou já passou da tolerância. */
export function marcoDoLembrete(vencimento: string, hoje: string): MarcoLembrete | null {
  const diff = diferencaDias(hoje, vencimento);
  if (diff < 0) return diff >= -TOLERANCIA_ATRASO_DIAS ? 'atrasado' : null;
  if (diff === 0) return 'd0';
  if (diff === 1) return 'd-1';
  if (diff <= 3) return 'd-3';
  return null;
}

interface PrazoPendente {
  id: string;
  user_id: string;
  titulo: string;
  tipo: 'prazo' | 'tarefa' | 'audiencia';
  data_vencimento: string;
  numero_cnj: string | null;
  lembretes_enviados: { marco?: string }[] | null;
}

interface ItemLembrete {
  id: string;
  titulo: string;
  tipo: PrazoPendente['tipo'];
  vencimento: string;
  numeroCnj: string | null;
  marco: MarcoLembrete;
  lembretes: { marco?: string }[];
}

const ORDEM_MARCO: Record<MarcoLembrete, number> = { atrasado: 0, d0: 1, 'd-1': 2, 'd-3': 3 };
const ROTULO_TIPO: Record<PrazoPendente['tipo'], string> = { prazo: 'prazo', tarefa: 'tarefa', audiencia: 'audiência' };

/** "vence hoje", "vence amanhã (12/11/2026)", "vence em 3 dias (12/11/2026)", "venceu em 08/11/2026". */
export function descreverSituacao(item: Pick<ItemLembrete, 'vencimento' | 'tipo'>, hoje: string): string {
  const diff = diferencaDias(hoje, item.vencimento);
  const data = formatarDataBr(item.vencimento);
  const verbo = item.tipo === 'prazo' ? 'vence' : 'é';
  const verboPassado = item.tipo === 'prazo' ? 'venceu' : 'era';
  if (diff < 0) return `${verboPassado} em ${data}`;
  if (diff === 0) return `${verbo} hoje`;
  if (diff === 1) return `${verbo} amanhã (${data})`;
  return `${verbo} em ${diff} dias (${data})`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function tituloComProcesso(item: ItemLembrete): string {
  return item.numeroCnj ? `${item.titulo} (processo ${item.numeroCnj})` : item.titulo;
}

// ── Canais ───────────────────────────────────────────────────────────────────

let resend: Resend | null | undefined;
function getResend(): Resend | null {
  if (resend !== undefined) return resend;
  const key = process.env.RESEND_API_KEY;
  resend = key ? new Resend(key) : null;
  return resend;
}

async function enviarEmailLembrete(destinatario: string, itens: ItemLembrete[], hoje: string): Promise<{ enviado: boolean; erro?: string; naoConfigurado?: boolean }> {
  const cliente = getResend();
  const from = process.env.RESEND_FROM_EMAIL;
  if (!cliente || !from) {
    console.log('[lembretes-prazos] RESEND_API_KEY/RESEND_FROM_EMAIL não configuradas: e-mail de lembrete não enviado.');
    return { enviado: false, naoConfigurado: true, erro: 'Resend não configurado' };
  }

  const linhas = itens
    .map(i => {
      const cor = i.marco === 'atrasado' ? '#b42318' : i.marco === 'd0' ? '#b54708' : '#1B3FA8';
      return `<li style="margin-bottom:12px"><strong>${escapeHtml(ROTULO_TIPO[i.tipo].toUpperCase())}</strong>: ${escapeHtml(tituloComProcesso(i))}<br/><span style="color:${cor};font-weight:700">${escapeHtml(descreverSituacao(i, hoje))}</span></li>`;
    })
    .join('');

  const assunto =
    itens.length === 1
      ? `Lembrete: ${itens[0].titulo} ${descreverSituacao(itens[0], hoje)}`.slice(0, 200)
      : `Sua agenda: ${itens.length} compromissos precisam de atenção`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#060F28">Lembrete da sua agenda de prazos</h2>
      <ul style="padding-left:18px">${linhas}</ul>
      <p><a href="${escapeHtml(`${SITE_URL}/agenda`)}" style="color:#1B3FA8">Abrir minha agenda</a></p>
      <p style="color:#888;font-size:12px;margin-top:24px">Lembrete automático da agenda de prazos. As datas dos prazos extraídos de movimentações são estimativas: confira no processo. Para parar de receber avisos por e-mail, desligue o canal de e-mail em Meus processos.</p>
    </div>`.trim();

  try {
    const { error } = await cliente.emails.send({ from, to: destinatario, subject: assunto, html });
    if (error) {
      console.error('[lembretes-prazos] falha ao enviar e-mail:', error.message);
      return { enviado: false, erro: error.message };
    }
    return { enviado: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido';
    console.error('[lembretes-prazos] exceção ao enviar e-mail:', msg);
    return { enviado: false, erro: msg };
  }
}

function parametroTemplate(texto: string): { type: 'text'; text: string } {
  const limpo = texto.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '-';
  return { type: 'text', text: limpo.length > 300 ? `${limpo.slice(0, 299).trimEnd()}…` : limpo };
}

async function enviarWhatsAppLembrete(telefone: string, itens: ItemLembrete[], hoje: string): Promise<ResultadoEnvioWhatsApp> {
  const principal = itens[0];
  const situacao = descreverSituacao(principal, hoje);
  const complemento = itens.length > 1 ? `Mais ${itens.length - 1} compromisso${itens.length - 1 > 1 ? 's' : ''} na sua agenda.` : 'Abra sua agenda na JusConsulta.';

  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.WHATSAPP_TEMPLATE_PRAZO;

  // Sem template aprovado: texto livre, que a Meta só entrega dentro da janela de 24h.
  if (!template) {
    return enviarTextoWhatsApp(telefone, `Lembrete de ${ROTULO_TIPO[principal.tipo]}: ${tituloComProcesso(principal)} ${situacao}. ${complemento}\n${SITE_URL}/agenda`);
  }
  if (!token || !phoneNumberId) {
    return { enviado: false, naoConfigurado: true, erro: 'WhatsApp Cloud API não configurada' };
  }

  const destino = normalizarTelefoneBr(telefone);
  if (!destino) return { enviado: false, definitivo: true, erro: 'Telefone inválido para WhatsApp' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destino,
        type: 'template',
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_IDIOMA || 'pt_BR' },
          components: [
            {
              type: 'body',
              parameters: [
                parametroTemplate(ROTULO_TIPO[principal.tipo]),
                parametroTemplate(tituloComProcesso(principal)),
                parametroTemplate(situacao),
                parametroTemplate(complemento)
              ]
            }
          ]
        }
      }),
      signal: controller.signal
    });
    const corpo = (await res.json().catch(() => null)) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } } | null;
    if (res.ok && corpo?.messages?.[0]?.id) return { enviado: true, mensagemId: corpo.messages[0].id };

    const mensagem = `${corpo?.error?.message || `HTTP ${res.status}`}${corpo?.error?.code ? ` (código ${corpo.error.code})` : ''}`;
    console.error('[lembretes-prazos] falha ao enviar WhatsApp:', mensagem);
    return { enviado: false, erro: mensagem };
  } catch (e) {
    const mensagem = e instanceof Error && e.name === 'AbortError' ? 'Tempo limite esgotado' : e instanceof Error ? e.message : 'erro desconhecido';
    console.error('[lembretes-prazos] exceção ao enviar WhatsApp:', mensagem);
    return { enviado: false, erro: mensagem };
  } finally {
    clearTimeout(timer);
  }
}

// ── Orquestração ─────────────────────────────────────────────────────────────

export interface ResultadoLembretes {
  prazosPendentes: number;
  usuarios: number;
  emailsEnviados: number;
  whatsappsEnviados: number;
  falhas: number;
  semCanal: number;
  semAcessoPlano: number;
  marcosRegistrados: number;
}

async function contatoDoUsuario(db: SupabaseClient, userId: string) {
  const { data: perfil } = await db.from('ap_perfis').select('email, telefone').eq('id', userId).maybeSingle();
  let email: string | null = (perfil?.email as string | null) ?? null;
  if (!email) {
    const { data } = await db.auth.admin.getUserById(userId);
    email = data?.user?.email ?? null;
  }
  return { email, telefone: (perfil?.telefone as string | null) ?? null };
}

async function canaisLigados(db: SupabaseClient, userId: string): Promise<{ email: boolean; whatsapp: boolean }> {
  const { data } = await db.from('ap_processos_monitorados').select('notificar_email, notificar_whatsapp').eq('user_id', userId);
  if (!data || data.length === 0) return { email: true, whatsapp: true };
  return { email: data.some(r => r.notificar_email), whatsapp: data.some(r => r.notificar_whatsapp) };
}

/** Envia os lembretes do dia e registra cada marco em `lembretes_enviados`. Nunca lança erro. */
export async function enviarLembretesDePrazos(db: SupabaseClient, opcoes: { hoje?: string; ateMs: number }): Promise<ResultadoLembretes> {
  const hoje = opcoes.hoje ?? hojeSaoPaulo();
  const resultado: ResultadoLembretes = { prazosPendentes: 0, usuarios: 0, emailsEnviados: 0, whatsappsEnviados: 0, falhas: 0, semCanal: 0, semAcessoPlano: 0, marcosRegistrados: 0 };

  try {
    const { data, error } = await db
      .from('ap_prazos')
      .select('id, user_id, titulo, tipo, data_vencimento, numero_cnj, lembretes_enviados')
      .eq('concluido', false)
      .gte('data_vencimento', somarDias(hoje, -TOLERANCIA_ATRASO_DIAS))
      .lte('data_vencimento', somarDias(hoje, 3))
      .order('data_vencimento', { ascending: true })
      .limit(LIMITE_PRAZOS);
    if (error) {
      console.error('[lembretes-prazos] falha ao ler prazos:', error.message);
      return resultado;
    }

    const porUsuario = new Map<string, ItemLembrete[]>();
    for (const p of (data as PrazoPendente[] | null) ?? []) {
      resultado.prazosPendentes++;
      const marco = marcoDoLembrete(p.data_vencimento, hoje);
      const lembretes = Array.isArray(p.lembretes_enviados) ? p.lembretes_enviados : [];
      if (!marco || lembretes.some(l => l?.marco === marco)) continue;
      const lista = porUsuario.get(p.user_id) ?? [];
      lista.push({ id: p.id, titulo: p.titulo, tipo: p.tipo, vencimento: p.data_vencimento, numeroCnj: p.numero_cnj, marco, lembretes });
      porUsuario.set(p.user_id, lista);
    }

    const usuarios = [...porUsuario.entries()];
    resultado.usuarios = usuarios.length;

    const processarUsuario = async ([userId, itensBrutos]: [string, ItemLembrete[]]) => {
      const acesso = await verificarRecursoPlano(userId, 'agendaPrazos');
      if (!acesso.permitido) {
        resultado.semAcessoPlano++;
        return;
      }

      const itens = [...itensBrutos].sort((a, b) => ORDEM_MARCO[a.marco] - ORDEM_MARCO[b.marco] || (a.vencimento < b.vencimento ? -1 : 1));
      const [contato, canais] = await Promise.all([contatoDoUsuario(db, userId), canaisLigados(db, userId)]);

      const canaisEnviados: ('email' | 'whatsapp')[] = [];
      let tentou = false;

      if (canais.email && contato.email) {
        tentou = true;
        const r = await enviarEmailLembrete(contato.email, itens, hoje);
        if (r.enviado) {
          canaisEnviados.push('email');
          resultado.emailsEnviados++;
        } else if (!r.naoConfigurado) resultado.falhas++;
      }
      if (canais.whatsapp && contato.telefone) {
        tentou = true;
        const r = await enviarWhatsAppLembrete(contato.telefone, itens, hoje);
        if (r.enviado) {
          canaisEnviados.push('whatsapp');
          resultado.whatsappsEnviados++;
        } else if (!r.naoConfigurado) resultado.falhas++;
      }

      if (!tentou) {
        resultado.semCanal++;
        return;
      }
      if (canaisEnviados.length === 0) return; // nada saiu: tenta de novo na próxima execução

      const em = new Date().toISOString();
      await Promise.all(
        itens.map(async item => {
          const { error: erroUpdate } = await db
            .from('ap_prazos')
            .update({ lembretes_enviados: [...item.lembretes, { marco: item.marco, canais: canaisEnviados, em }] })
            .eq('id', item.id);
          if (erroUpdate) console.error('[lembretes-prazos] falha ao registrar lembrete enviado:', erroUpdate.message);
          else resultado.marcosRegistrados++;
        })
      );
    };

    for (let i = 0; i < usuarios.length; i += CONCORRENCIA) {
      if (Date.now() >= opcoes.ateMs) break;
      const lote = usuarios.slice(i, i + CONCORRENCIA);
      const desfechos = await Promise.allSettled(lote.map(processarUsuario));
      for (const d of desfechos) {
        if (d.status === 'rejected') {
          resultado.falhas++;
          console.error('[lembretes-prazos] exceção ao processar usuário:', d.reason);
        }
      }
    }
  } catch (e) {
    console.error('[lembretes-prazos] falha geral:', e);
  }
  return resultado;
}
