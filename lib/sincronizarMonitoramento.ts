import { createHash } from 'crypto';
import { getAdminClient } from '@/lib/track';
import { parseCnj } from '@/lib/cnj';
import type { LegalProcess } from '@/lib/mockProcesses';

/**
 * Upsert em ap_processos + ap_movimentacoes a partir dos processos já encontrados numa busca síncrona
 * do usuário final, chamado quando ele confirma "Salvar em Meus processos" (app/api/processos/salvar). Complementa salvarProcessos (que grava em
 * ap_processos_pesquisados, tabela legada sem conceito de monitoramento) — nenhuma das duas
 * substitui a outra. É o que dá ao cron noturno (app/api/cron/reconsulta) "o que reconsultar" desde
 * a primeira busca síncrona: todo processo com número CNJ válido entra aqui com monitorar=true
 * (default da coluna), e já nasce com ultima_movimentacao_em preenchida para o backoff do cron ter
 * uma base correta. Nunca lança erro.
 */
/**
 * Schema REAL de ap_processos/ap_movimentacoes no Supabase remoto (confirmado em 2026-10-07):
 * numero_cnj é ÚNICO GLOBALMENTE (um processo é uma entidade compartilhada entre usuários, não uma
 * cópia por usuário) e não tem user_id — quem monitora cada processo vive em ap_processos_monitorados
 * (user_id+processo_id+notificar_email/notificar_whatsapp). ap_movimentacoes usa data_movimentacao/
 * titulo/conteudo, não data/descricao. Isso diverge do arquivo local
 * supabase/migrations/20260929120000_ap_schema_inicial.sql, que nunca foi aplicado ao banco remoto —
 * o schema abaixo segue o banco real, não esse arquivo.
 */
export async function sincronizarMonitoramento(userId: string, list: LegalProcess[]): Promise<Map<string, string>> {
  /** numero do processo (como veio da busca) -> ap_processos.id dos que foram vinculados ao usuário */
  const vinculados = new Map<string, string>();
  try {
    const db = getAdminClient();
    if (!db) return vinculados;

    for (const p of list) {
      const cnjInfo = parseCnj(p.numero);
      const numeroCnjFormatado = cnjInfo?.numeroFormatado;
      // ap_processos.numero_cnj exige o formato NNNNNNN-DD.AAAA.J.TR.OOOO (check constraint) —
      // processos sem CNJ parseável (não deveria ocorrer no Fluxo A/B, mas por segurança) são ignorados.
      if (!numeroCnjFormatado) continue;

      const movimentoMaisRecente = p.movimentos.reduce<string | null>((max, m) => (!max || m.data > max ? m.data : max), null);
      const [tribunal] = p.tribunal.split(' · ');

      const upsertProcesso = await db
        .from('ap_processos')
        .upsert(
          {
            numero_cnj: numeroCnjFormatado,
            titulo: p.numero,
            tribunal: tribunal || 'Não informado',
            classe_processual: p.tipo || null,
            assunto_principal: p.assunto || null,
            valor_causa: parseValorCausa(p.valorCausa),
            status: 'ativo',
            ...(movimentoMaisRecente ? { ultima_movimentacao_em: movimentoMaisRecente } : {}),
            metadados: { distribuicao: p.distribuicao, varaForo: p.varaForo, origem: p.origem, parteAtiva: p.autor, partePassiva: p.reu || p.parteContraria }
          },
          { onConflict: 'numero_cnj' }
        )
        .select('id')
        .single();

      if (upsertProcesso.error || !upsertProcesso.data) {
        console.error('[api/processos] sincronizarMonitoramento (ap_processos):', upsertProcesso.error?.message);
        continue;
      }

      const processoId = upsertProcesso.data.id as string;

      // Vincula este usuário ao processo (ap_processos_monitorados já guarda a preferência de canal
      // por usuário+processo — notificar_email/notificar_whatsapp — consumida pelo cron de reconsulta).
      const upsertMonitoramento = await db
        .from('ap_processos_monitorados')
        .upsert({ user_id: userId, processo_id: processoId }, { onConflict: 'user_id,processo_id', ignoreDuplicates: true });
      if (upsertMonitoramento.error) {
        console.error('[api/processos] sincronizarMonitoramento (ap_processos_monitorados):', upsertMonitoramento.error.message);
        continue;
      }
      vinculados.set(p.numero, processoId);

      if (p.movimentos.length === 0) continue;

      const movRows = p.movimentos.map(m => ({
        processo_id: processoId,
        data_movimentacao: m.data,
        tipo: m.tag || null,
        titulo: m.titulo,
        conteudo: m.descricao || m.titulo,
        hash: createHash('sha256').update(`${processoId}:${m.data}:${m.descricao || m.titulo}`).digest('hex')
      }));

      const upsertMovs = await db.from('ap_movimentacoes').upsert(movRows, { onConflict: 'processo_id,hash', ignoreDuplicates: true });
      if (upsertMovs.error) console.error('[api/processos] sincronizarMonitoramento (ap_movimentacoes):', upsertMovs.error.message);
    }
  } catch (e) {
    console.error('[api/processos] falha ao sincronizar monitoramento', e);
  }
  return vinculados;
}

/** "R$ 12.345,67" / "12345.67" → 12345.67. Sem valor numérico reconhecível, retorna null (coluna aceita null). */
function parseValorCausa(v: string | undefined): number | null {
  if (!v) return null;
  const limpo = v.replace(/[^\d,.-]/g, '');
  if (!limpo) return null;
  // Formato BR ("12.345,67"): remove separador de milhar (.) e troca a vírgula decimal por ponto.
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

