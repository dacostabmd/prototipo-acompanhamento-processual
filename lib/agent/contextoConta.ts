import { getAdminClient } from '@/lib/track';

/**
 * Contexto da conta para o chat de IA: perfil do usuário e os processos ligados a ele (salvos em Meus processos
 * e pesquisados), com os últimos andamentos e o último resumo de IA. Montado no servidor a cada pergunta, para a
 * IA responder sobre qualquer processo do usuário sem depender do que a tela enviou.
 */

const LIMITE_PROCESSOS = 30;
const MOVS_POR_PROCESSO = 10;
const digitos = (v: string) => String(v ?? '').replace(/\D/g, '');
const corta = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}...` : t);

interface Mov {
  data: string;
  titulo: string;
  descricao: string;
}

function movimentosDe(lista: any[] | undefined): Mov[] {
  return (lista ?? [])
    .filter(m => m && (m.titulo || m.descricao || m.conteudo))
    .map(m => ({
      data: String(m.data ?? m.data_movimentacao ?? '').slice(0, 10),
      titulo: String(m.titulo ?? ''),
      descricao: String(m.descricao ?? m.conteudo ?? '')
    }))
    .sort((a, b) => (a.data < b.data ? 1 : -1))
    .slice(0, MOVS_POR_PROCESSO);
}

export async function carregarContextoConta(userId: string | null): Promise<string> {
  const db = getAdminClient();
  if (!userId || !db) return '';

  try {
    const [perfil, pesq, mon] = await Promise.all([
      db.from('ap_perfis').select('*').eq('id', userId).maybeSingle(),
      db
        .from('ap_processos_pesquisados')
        .select('numero_cnj, tribunal, classe, parte_passiva, ultima_movimentacao_em, created_at, dados_brutos')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(LIMITE_PROCESSOS),
      db
        .from('ap_processos_monitorados')
        .select('processo_id, created_at, ap_processos!inner(numero_cnj, tribunal, classe_processual, valor_causa, ultima_movimentacao_em, metadados)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(LIMITE_PROCESSOS)
    ]);

    const monitorados = (mon.data ?? []) as any[];
    const processoIds = monitorados.map(m => m.processo_id as string);
    const [resumos, movs] = await Promise.all([
      processoIds.length
        ? db
            .from('ap_resumos_ia')
            .select('processo_id, resumo_simplificado, status_atual_explicado, proximos_passos, urgencia, created_at')
            .in('processo_id', processoIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
      processoIds.length
        ? db
            .from('ap_movimentacoes')
            .select('processo_id, data_movimentacao, titulo, conteudo')
            .in('processo_id', processoIds)
            .order('data_movimentacao', { ascending: false })
            .limit(processoIds.length * MOVS_POR_PROCESSO)
        : Promise.resolve({ data: [] as any[] })
    ]);

    const resumoPor = new Map<string, any>();
    for (const r of (resumos.data ?? []) as any[]) if (!resumoPor.has(r.processo_id)) resumoPor.set(r.processo_id, r);
    const movsPor = new Map<string, any[]>();
    for (const m of (movs.data ?? []) as any[]) movsPor.set(m.processo_id, [...(movsPor.get(m.processo_id) ?? []), m]);

    // Une salvos e pesquisados pelo número (só dígitos): o salvo prevalece, o pesquisado completa os andamentos.
    const porNumero = new Map<string, { numero: string; linhas: string[]; movimentos: Mov[]; salvo: boolean; resumo: any }>();
    for (const m of monitorados) {
      const p = m.ap_processos;
      porNumero.set(digitos(p.numero_cnj), {
        numero: p.numero_cnj,
        salvo: true,
        resumo: resumoPor.get(m.processo_id) ?? null,
        movimentos: movimentosDe(movsPor.get(m.processo_id)),
        linhas: [
          `Tribunal: ${p.tribunal || 'não informado'}`,
          `Classe: ${p.classe_processual || 'não informada'}`,
          `Parte contrária: ${p.metadados?.partePassiva || 'não informada'}`,
          `Valor da causa: ${p.valor_causa != null ? Number(p.valor_causa).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'não informado'}`,
          `Última movimentação: ${p.ultima_movimentacao_em ? String(p.ultima_movimentacao_em).slice(0, 10) : 'não informada'}`
        ]
      });
    }
    for (const p of (pesq.data ?? []) as any[]) {
      const chave = digitos(p.numero_cnj);
      const movimentos = movimentosDe(p.dados_brutos?.processo?.movimentos ?? p.dados_brutos?.movimentos);
      const existente = porNumero.get(chave);
      if (existente) {
        if (existente.movimentos.length === 0) existente.movimentos = movimentos;
        continue;
      }
      porNumero.set(chave, {
        numero: p.numero_cnj,
        salvo: false,
        resumo: null,
        movimentos,
        linhas: [
          `Tribunal: ${p.tribunal || 'não informado'}`,
          `Classe: ${p.classe || 'não informada'}`,
          `Parte contrária: ${p.parte_passiva || 'não informada'}`,
          `Valor da causa: ${p.dados_brutos?.valorCausa || 'não informado'}`,
          `Pesquisado em: ${String(p.created_at).slice(0, 10)}`
        ]
      });
    }

    const pf = (perfil.data ?? {}) as Record<string, any>;
    const perfilTxt = [
      pf.nome && `Nome: ${pf.nome}`,
      pf.email && `E-mail: ${pf.email}`,
      pf.documento && `CPF/CNPJ: ${pf.documento}`,
      pf.oab && `OAB: ${pf.oab}`,
      pf.role && `Tipo de acesso: ${pf.role}`,
      pf.plano && `Plano: ${pf.plano}`
    ]
      .filter(Boolean)
      .join('\n');

    const processosTxt = Array.from(porNumero.values())
      .map((p, i) => {
        const movsTxt = p.movimentos.length
          ? p.movimentos.map(m => `     - [${m.data || 's/ data'}] ${corta(m.titulo, 160)}${m.descricao && m.descricao !== m.titulo ? `: ${corta(m.descricao, 220)}` : ''}`).join('\n')
          : '     - (sem andamentos registrados)';
        const resumoTxt = p.resumo
          ? `\n   Último resumo de IA (${String(p.resumo.created_at).slice(0, 10)}): ${corta(p.resumo.resumo_simplificado ?? '', 400)}` +
            (p.resumo.proximos_passos ? `\n   Próximos passos apontados: ${corta(p.resumo.proximos_passos, 300)}` : '') +
            (p.resumo.urgencia ? `\n   Urgência: ${p.resumo.urgencia}` : '')
          : '';
        return `${i + 1}. ${p.numero} (${p.salvo ? 'salvo em Meus processos' : 'só pesquisado'})\n   ${p.linhas.join('\n   ')}${resumoTxt}\n   Últimos andamentos (mais recente primeiro):\n${movsTxt}`;
      })
      .join('\n\n');

    return (
      `=== CONTA DO USUÁRIO (dados do sistema) ===\n${perfilTxt || 'Perfil sem dados cadastrais.'}\n\n` +
      `=== PROCESSOS DA CONTA (${porNumero.size}) ===\n${processosTxt || 'Nenhum processo salvo ou pesquisado na conta.'}`
    );
  } catch (err) {
    console.error('[contextoConta] Falha ao montar contexto da conta:', err);
    return '';
  }
}
