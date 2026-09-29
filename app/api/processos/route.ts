import { createHash } from 'crypto';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { NextResponse } from 'next/server';
import type { LegalProcess, Movement, MovementTag } from '@/lib/mockProcesses';

function convertBrDateToIso(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const clean = dateStr.trim().split(' ')[0];
  const parts = clean.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y.padStart(4, '20')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return dateStr;
}

function classifyTag(text: string): MovementTag {
  const t = text.toLowerCase();
  if (/penhora|bloqueio|sisbajud|pris[aã]o|busca e apreens[aã]o|leil[aã]o|arresto|execu[cç][aã]o|bacenjud/i.test(t)) {
    return 'urgente';
  }
  if (/deferid|procedente|acolhid|extin|baix|cancelad|acordo|favor[aá]vel/i.test(t)) {
    return 'positivo';
  }
  if (/andamento|peti[cç][aã]o|audi[eê]ncia|per[ií]cia|cita[cç][aã]o|despacho|conclus|juntad|intima[cç][aã]o/i.test(t)) {
    return 'andamento';
  }
  return 'informativo';
}

async function fetchInfosimples(service: string, token: string, cleanCpf: string) {
  try {
    const form = new URLSearchParams();
    form.append('token', token);
    form.append('cpf', cleanCpf);

    const res = await fetch(`https://api.infosimples.com/api/v2/consultas/${service}`, {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (err) {
    console.error(`[api/processos] Erro ao consultar ${service}:`, err);
    return null;
  }
}

/** Salva os processos pesquisados (com hash) e completa o perfil. Nunca lança erro. */
async function salvarProcessos(userId: string, cpf: string, phone: string | undefined, fullName: string | undefined, list: LegalProcess[]) {
  try {
    const db = getAdminClient();
    if (!db) return;

    const perfil: Record<string, string> = { cpf };
    const tel = (phone || '').replace(/\D/g, '');
    if (tel) perfil.telefone = tel;
    if (fullName?.trim()) perfil.nome = fullName.trim();
    const up = await db.from('ap_perfis').update(perfil).eq('id', userId);
    if (up.error) console.error('[api/processos] perfil:', up.error.message);

    const rows = list
      .map(p => {
        const [tribunal, vara] = p.tribunal.split(' · ');
        return {
          user_id: userId,
          numero_cnj: p.numero,
          hash: createHash('sha256').update(`${userId}:${p.numero}`).digest('hex'),
          tribunal,
          classe: p.tipo,
          assunto: vara ?? null,
          parte_passiva: p.parteContraria,
          ultima_movimentacao_em: p.movimentos[0]?.data ?? null,
          dados_brutos: { valorCausa: p.valorCausa, distribuicao: p.distribuicao, movimentos: p.movimentos.slice(0, 20) }
        };
      });
    if (rows.length) {
      const r = await db.from('ap_processos_pesquisados').upsert(rows, { onConflict: 'user_id,numero_cnj' });
      if (r.error) console.error('[api/processos] salvar:', r.error.message);
    }
  } catch (e) {
    console.error('[api/processos] falha ao salvar processos', e);
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  try {
    const { cpf, fullName, phone, state, processNumber } = await request.json();
    const cleanCpf = (cpf || '').replace(/\D/g, '');

    if (cleanCpf.length !== 11) {
      return NextResponse.json({ error: 'CPF deve conter 11 dígitos numéricos.' }, { status: 400 });
    }

    const token = process.env.INFOSIMPLES_API_TOKEN || process.env.INFOSIMPLES_TOKEN;

    if (!token) {
      return NextResponse.json(
        { error: 'Token da Infosimples não configurado no servidor (INFOSIMPLES_API_TOKEN).' },
        { status: 500 }
      );
    }

    const cleanPhone = (phone || '').replace(/\D/g, '');
    const ddd = cleanPhone.length >= 10 ? parseInt(cleanPhone.slice(0, 2), 10) : 0;
    const selectedState = (state || '').toUpperCase();
    const isRj = selectedState.includes('RJ') || selectedState.includes('RIO') || ddd === 21 || ddd === 22 || ddd === 24;

    // Multi-tribunal: consulta todos os tribunais com API de busca por CPF (lista de processos) na Infosimples.
    // TJBA/TJRS/TJSC/TRF6 têm formato de resposta não confirmado na documentação pública — o parser abaixo
    // tenta múltiplos nomes de campo, mas pode falhar silenciosamente em encontrar processos nesses tribunais
    // até serem validados com uma chamada real.
    const ALL_TARGETS: { service: string; label: string }[] = [
      { service: 'tribunal/tjsp/primeiro-grau', label: 'TJSP' },
      { service: 'tribunal/tjsp/eproc-lista', label: 'TJSP (eproc)' },
      { service: 'tribunal/tjrj/processo-eproc', label: 'TJRJ' },
      { service: 'tribunal/tjmg/processo', label: 'TJMG' },
      { service: 'tribunal/tjpr/processo', label: 'TJPR' },
      { service: 'tribunal/tjba/primeiro-grau', label: 'TJBA' },
      { service: 'tribunal/tjrs/primeiro-grau', label: 'TJRS' },
      { service: 'tribunal/tjsc/processo', label: 'TJSC' },
      { service: 'tribunal/trf1/processo', label: 'TRF1' },
      { service: 'tribunal/trf2/processo', label: 'TRF2' },
      { service: 'tribunal/trf2/processo-eproc', label: 'TRF2 (eproc)' },
      { service: 'tribunal/trf3/consulta-publica', label: 'TRF3' },
      { service: 'tribunal/trf5/processo', label: 'TRF5' },
      { service: 'tribunal/trf6/processo', label: 'TRF6' }
    ];

    // Prioriza SP/RJ primeiro para a animação de progresso, mas consulta todos os tribunais disponíveis
    const targets = isRj
      ? [...ALL_TARGETS].sort((a, b) => (a.label === 'TJRJ' ? -1 : b.label === 'TJRJ' ? 1 : 0))
      : ALL_TARGETS;

    const CUSTO_POR_CONSULTA = 0.2; // R$ por chamada à Infosimples (valor estimado, confirmar no painel da conta)
    const custoEstimado = Number((targets.length * CUSTO_POR_CONSULTA).toFixed(2));

    console.log(
      `[api/processos] Consulta multi-tribunal para ${fullName || 'Cliente'} (CPF: ${cleanCpf}, Estado: ${state || 'Auto'}, DDD: ${ddd || 'N/I'}) nos tribunais:`,
      targets.map(t => t.label).join(', ')
    );

    const queries = await Promise.allSettled(
      targets.map(t => fetchInfosimples(t.service, token, cleanCpf))
    );

    const allProcesses: LegalProcess[] = [];
    const seenProcessos = new Set<string>();
    const tribunaisConsultados: string[] = [];

    targets.forEach((target, idx) => {
      tribunaisConsultados.push(target.label);
      const outcome = queries[idx];
      if (outcome.status !== 'fulfilled' || !outcome.value) return;

      const result = outcome.value;
      console.log(`[api/processos] ${target.label}: code ${result.code} - "${result.code_message}" (data_count: ${result.data_count})`);

      if (result.code !== 200 || !result.data?.[0]) return;

      // Cada tribunal usa um nome de campo diferente para a lista de processos
      const rawList: any[] =
        result.data[0].processos ||
        result.data[0].lista_processos ||
        result.data[0].processos_lista ||
        result.data[0].lista_processos_encontrados ||
        [];

      rawList.forEach((p: any) => {
        const num = (p.processo || p.numero || p.numero_processo || p.numero_cnj || '').trim();
        if (!num || seenProcessos.has(num)) return;
        seenProcessos.add(num);

        const movs: Movement[] = [];

        // Cada tribunal usa um nome de campo diferente para as movimentações
        const rawMovs =
          p.ultimas_movimentacoes ||
          p.eventos ||
          p.movimento_processo ||
          p.movimentacoes_processo ||
          p.movimentacao ||
          [];
        if (Array.isArray(rawMovs) && rawMovs.length > 0) {
          rawMovs.forEach((m: any) => {
            const fullText = (m.movimento || m.descricao || m.evento || m.movimentacao || '').trim();
            const dashIdx = fullText.indexOf(' - ');
            let titulo = dashIdx > 0 && dashIdx < 60 ? fullText.slice(0, dashIdx) : fullText.slice(0, 70);
            if (titulo.length < fullText.length && !titulo.endsWith('...')) {
              titulo += '...';
            }
            movs.push({
              data: convertBrDateToIso(m.data || m.data_evento || m.data_hora_movimentacao),
              titulo: titulo || 'Movimentação processual',
              descricao: fullText || 'Sem descrição detalhada.',
              tag: classifyTag(fullText)
            });
          });
        }

        if (movs.length === 0) {
          movs.push({
            data: convertBrDateToIso(p.distribuicao || p.data_autuacao),
            titulo: p.ultimo_evento ? (p.ultimo_evento.slice(0, 70) + '...') : 'Processo distribuído',
            descricao: p.ultimo_evento || `Processo autuado no tribunal: ${p.distribuicao || p.data_autuacao || 'Data não informada'}.`,
            tag: 'informativo'
          });
        }

        // Identifica parte contrária
        let parteContraria = 'Não informada';
        const normUser = (fullName || '').toLowerCase().trim();
        const autor = p.reqte || p.autor || '';
        const reu = p.reqdo || p.reu || p.exectdo || '';

        if (autor && reu) {
          if (normUser && autor.toLowerCase().includes(normUser)) {
            parteContraria = reu;
          } else if (normUser && reu.toLowerCase().includes(normUser)) {
            parteContraria = autor;
          } else {
            parteContraria = reu;
          }
        } else {
          parteContraria = reu || autor || 'Não informada';
        }

        let valorCausa = p.valor_acao || p.valor_causa;
        if (!valorCausa && p.normalizado_valor_acao) {
          valorCausa = `R$ ${Number(p.normalizado_valor_acao).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
        }

        allProcesses.push({
          numero: num,
          tribunal: `${target.label} · ${p.vara || p.foro || p.orgao_julgador || '1º Grau'}`,
          tipo: p.classe || p.classe_acao || p.assunto || 'Ação Judicial',
          parteContraria,
          valorCausa: valorCausa || 'Não informado',
          distribuicao: p.distribuicao || p.data_autuacao || 'Não informada',
          movimentos: movs
        });
      });
    });

    const userId = await getUserId(request);
    await trackEvento(request, userId, {
      tipo: 'consulta',
      assunto: allProcesses[0]?.tipo,
      classe: allProcesses[0]?.tipo,
      tribunal: tribunaisConsultados.join(', '),
      dados: {
        totalProcessos: allProcesses.length,
        estado: selectedState || null,
        processos: allProcesses.slice(0, 20).map(p => ({ numero: p.numero, tipo: p.tipo, tribunal: p.tribunal }))
      }
    });

    if (userId) await salvarProcessos(userId, cleanCpf, phone, fullName, allProcesses);

    if (allProcesses.length === 0) {
      console.log(`[api/processos] Nenhum processo localizado nos tribunais consultados (${tribunaisConsultados.join(', ')}) para o CPF ${cleanCpf}.`);
      return NextResponse.json({
        notFound: true,
        totalProcessos: 0,
        processes: [],
        tribunaisConsultados,
        custoEstimado
      });
    }

    console.log(`[api/processos] Sucesso: ${allProcesses.length} processo(s) consolidado(s) de ${tribunaisConsultados.join(', ')}. Custo estimado: R$ ${custoEstimado.toFixed(2)}`);

    return NextResponse.json({
      notFound: false,
      totalProcessos: allProcesses.length,
      processes: allProcesses,
      tribunaisConsultados,
      custoEstimado
    });
  } catch (error) {
    console.error('[api/processos] Exceção:', error);
    return NextResponse.json({ error: 'Falha ao processar consulta de processos.' }, { status: 500 });
  }
}
