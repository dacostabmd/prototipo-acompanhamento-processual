import { Resend } from 'resend';
import type { LegalProcess, Movement } from '@/lib/mockProcesses';
import type { ResumoAndamento } from '@/lib/resumoAndamento';

const ROTULO_URGENCIA: Record<ResumoAndamento['urgencia'], { texto: string; cor: string }> = {
  alta: { texto: 'Atenção: pode exigir ação rápida', cor: '#b42318' },
  media: { texto: 'Movimentação relevante', cor: '#1B3FA8' },
  baixa: { texto: 'Movimentação de rotina', cor: '#555555' }
};

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
  movimentosNovos: Pick<Movement, 'data' | 'titulo' | 'descricao'>[],
  resumo?: Pick<ResumoAndamento, 'resumo' | 'significado' | 'proximoPasso' | 'urgencia'> | null,
  /** Links de lib/descadastro.ts: página de confirmação (corpo) e endpoint de um clique (List-Unsubscribe). */
  descadastro?: { pagina: string; umClique: string } | null
): Promise<{ enviado: boolean; erro?: string; naoConfigurado?: boolean }> {
  const resend = getResend();
  const from = process.env.RESEND_FROM_EMAIL;

  if (!resend || !from) {
    console.log('[email] RESEND_API_KEY/RESEND_FROM_EMAIL não configuradas — no-op (alerta não enviado):', processo.numeroCnj);
    return { enviado: false, naoConfigurado: true, erro: 'Resend não configurado' };
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

  const urgencia = resumo ? ROTULO_URGENCIA[resumo.urgencia] : null;
  const resumoHtml =
    resumo && urgencia
      ? `
      <div style="border:1px solid #1E7CF2;border-radius:8px;padding:14px 16px;margin:16px 0;background:#fbf7ef">
        <p style="margin:0 0 8px;color:${urgencia.cor};font-weight:700;font-size:13px">${urgencia.texto}</p>
        <p style="margin:0 0 8px;color:#060F28"><strong>Em resumo:</strong> ${escapeHtml(resumo.resumo)}</p>
        <p style="margin:0 0 8px;color:#060F28"><strong>O que significa:</strong> ${escapeHtml(resumo.significado)}</p>
        <p style="margin:0;color:#060F28"><strong>Próximo passo:</strong> ${escapeHtml(resumo.proximoPasso)}</p>
      </div>
      <p style="color:#888;font-size:12px;margin:0 0 8px">Resumo gerado automaticamente por IA a partir das movimentações abaixo. Não substitui a orientação do seu advogado.</p>`
      : '';

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#060F28">Seu processo ${escapeHtml(processo.numeroCnj)} teve uma movimentação</h2>
      ${processo.tribunal ? `<p style="color:#555">Tribunal: ${escapeHtml(processo.tribunal)}</p>` : ''}
      ${resumoHtml}
      <ul style="padding-left:18px">${itensHtml}</ul>
      <p style="color:#888;font-size:12px;margin-top:24px">Este é um alerta automático do monitoramento ativo do seu processo. Para alterar suas preferências de aviso, acesse sua conta.</p>
      ${descadastro ? `<p style="color:#888;font-size:12px"><a href="${escapeHtml(descadastro.pagina)}" style="color:#1B3FA8">Não quero mais receber avisos deste processo por e-mail</a></p>` : ''}
    </div>
  `.trim();

  try {
    const { error } = await resend.emails.send({
      from,
      to: destinatarioEmail,
      subject: `Seu processo ${processo.numeroCnj} teve uma movimentação`,
      html,
      ...(descadastro
        ? { headers: { 'List-Unsubscribe': `<${descadastro.umClique}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
        : {})
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
