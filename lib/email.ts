import { Resend } from 'resend';
import type { LegalProcess, Movement } from '@/lib/mockProcesses';

let client: Resend | null | undefined;

/** Cliente Resend. Sem RESEND_API_KEY, retorna null — quem chama vira no-op silencioso (mesmo padrão de lib/redis.ts). */
function getResend(): Resend | null {
  if (client !== undefined) return client;
  const key = process.env.RESEND_API_KEY;
  client = key ? new Resend(key) : null;
  return client;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Envia o e-mail de "seu processo andou" para o dono de um processo monitorado. Sem
 * RESEND_API_KEY/RESEND_FROM_EMAIL configuradas no ambiente, é no-op (apenas loga) — não lança erro,
 * nunca quebra o batch do cron de reconsulta por causa de e-mail.
 */
export async function enviarAlertaMovimentacao(
  destinatarioEmail: string,
  processo: { numeroCnj: string; tribunal?: string | null },
  movimentosNovos: Pick<Movement, 'data' | 'titulo' | 'descricao'>[]
): Promise<{ enviado: boolean; erro?: string }> {
  const resend = getResend();
  const from = process.env.RESEND_FROM_EMAIL;

  if (!resend || !from) {
    console.log('[email] RESEND_API_KEY/RESEND_FROM_EMAIL não configuradas — no-op (alerta não enviado):', processo.numeroCnj);
    return { enviado: false, erro: 'Resend não configurado' };
  }

  if (!destinatarioEmail) {
    console.error('[email] destinatário vazio, alerta não enviado:', processo.numeroCnj);
    return { enviado: false, erro: 'Destinatário sem e-mail' };
  }

  const itensHtml = movimentosNovos
    .slice(0, 10)
    .map(
      m =>
        `<li style="margin-bottom:10px"><strong>${escapeHtml(m.data)}</strong> — ${escapeHtml(m.titulo)}<br/><span style="color:#555">${escapeHtml(m.descricao)}</span></li>`
    )
    .join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a1a1a">Seu processo ${escapeHtml(processo.numeroCnj)} teve uma movimentação</h2>
      ${processo.tribunal ? `<p style="color:#555">Tribunal: ${escapeHtml(processo.tribunal)}</p>` : ''}
      <ul style="padding-left:18px">${itensHtml}</ul>
      <p style="color:#888;font-size:12px;margin-top:24px">Este é um alerta automático do monitoramento ativo do seu processo. Para alterar suas preferências de aviso, acesse sua conta.</p>
    </div>
  `.trim();

  try {
    const { error } = await resend.emails.send({
      from,
      to: destinatarioEmail,
      subject: `Seu processo ${processo.numeroCnj} teve uma movimentação`,
      html
    });
    if (error) {
      console.error('[email] falha ao enviar alerta de movimentação:', error.message);
      return { enviado: false, erro: error.message };
    }
    return { enviado: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido';
    console.error('[email] exceção ao enviar alerta de movimentação:', msg);
    return { enviado: false, erro: msg };
  }
}
