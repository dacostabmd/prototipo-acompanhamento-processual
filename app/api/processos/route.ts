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
    return await res.json();
  } catch (err) {
    console.error(`[api/processos] Erro ao consultar ${service}:`, err);
    return null;
  }
}

export async function POST(request: Request) {
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

    // Multi-tribunal inteligente: define os tribunais a consultar baseado no Estado selecionado, DDD e CPF
    const targets: { service: string; label: string }[] = [];

    if (isRj) {
      targets.push({ service: 'tribunal/tjrj/processo-eproc', label: 'TJRJ' });
      targets.push({ service: 'tribunal/tjsp/primeiro-grau', label: 'TJSP' });
    } else {
      targets.push({ service: 'tribunal/tjsp/primeiro-grau', label: 'TJSP' });
      targets.push({ service: 'tribunal/tjrj/processo-eproc', label: 'TJRJ' });
    }

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

      // Trata retorno do TJSP (processos) ou TJRJ (processos / lista_processos)
      const rawList: any[] =
        result.data[0].processos ||
        result.data[0].lista_processos ||
        [];

      rawList.forEach((p: any) => {
        const num = (p.processo || p.numero || p.numero_processo || '').trim();
        if (!num || seenProcessos.has(num)) return;
        seenProcessos.add(num);

        const movs: Movement[] = [];

        // Trata movimentações (ultimas_movimentacoes ou eventos)
        const rawMovs = p.ultimas_movimentacoes || p.eventos || [];
        if (Array.isArray(rawMovs) && rawMovs.length > 0) {
          rawMovs.forEach((m: any) => {
            const fullText = (m.movimento || m.descricao || m.evento || '').trim();
            const dashIdx = fullText.indexOf(' - ');
            let titulo = dashIdx > 0 && dashIdx < 60 ? fullText.slice(0, dashIdx) : fullText.slice(0, 70);
            if (titulo.length < fullText.length && !titulo.endsWith('...')) {
              titulo += '...';
            }
            movs.push({
              data: convertBrDateToIso(m.data || m.data_evento),
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

    if (allProcesses.length === 0) {
      console.log(`[api/processos] Nenhum processo localizado nos tribunais consultados (${tribunaisConsultados.join(', ')}) para o CPF ${cleanCpf}.`);
      return NextResponse.json({
        notFound: true,
        totalProcessos: 0,
        processes: [],
        tribunaisConsultados
      });
    }

    console.log(`[api/processos] Sucesso: ${allProcesses.length} processo(s) consolidado(s) de ${tribunaisConsultados.join(', ')}.`);

    return NextResponse.json({
      notFound: false,
      totalProcessos: allProcesses.length,
      processes: allProcesses,
      tribunaisConsultados
    });
  } catch (error) {
    console.error('[api/processos] Exceção:', error);
    return NextResponse.json({ error: 'Falha ao processar consulta de processos.' }, { status: 500 });
  }
}
