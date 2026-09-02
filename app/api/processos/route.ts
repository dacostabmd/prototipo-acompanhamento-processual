import { NextResponse } from 'next/server';
import type { LegalProcess, Movement, MovementTag } from '@/lib/mockProcesses';

function convertBrDateToIso(dateStr?: string): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const clean = dateStr.trim().split(' ')[0]; // Remove possíveis horários como "10/10/2025 às 10:35"
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

export async function POST(request: Request) {
  try {
    const { cpf, fullName } = await request.json();
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

    const form = new URLSearchParams();
    form.append('token', token);
    form.append('cpf', cleanCpf);

    console.log(`[api/processos] Iniciando consulta para: ${fullName} (CPF: ${cleanCpf})`);

    const response = await fetch('https://api.infosimples.com/api/v2/consultas/tribunal/tjsp/primeiro-grau', {
      method: 'POST',
      body: form,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[api/processos] Erro HTTP da Infosimples:', response.status, errorText);
      return NextResponse.json(
        { error: 'Não foi possível consultar os processos no tribunal no momento.' },
        { status: 502 }
      );
    }

    const result = await response.json();
    console.log(`[api/processos] Resposta Infosimples TJSP: code ${result.code} - "${result.code_message}" (data_count: ${result.data_count})`);

    // Código 608 ou 612: nenhum resultado encontrado na Infosimples
    if (result.code === 608 || result.code === 612 || result.data_count === 0 || !result.data?.[0]?.processos) {
      console.log(`[api/processos] Nenhum processo localizado no tribunal para o CPF ${cleanCpf}.`);
      return NextResponse.json({ notFound: true, totalProcessos: 0, processes: [] });
    }

    const rawList: any[] = result.data[0].processos;

    if (rawList.length === 0) {
      return NextResponse.json({ notFound: true, totalProcessos: 0, processes: [] });
    }

    const processes: LegalProcess[] = rawList.map((p: any) => {
      const movs: Movement[] = [];

      if (Array.isArray(p.ultimas_movimentacoes) && p.ultimas_movimentacoes.length > 0) {
        p.ultimas_movimentacoes.forEach((m: any) => {
          const fullText = (m.movimento || '').trim();
          const dashIdx = fullText.indexOf(' - ');
          let titulo = dashIdx > 0 && dashIdx < 60 ? fullText.slice(0, dashIdx) : fullText.slice(0, 70);
          if (titulo.length < fullText.length && !titulo.endsWith('...')) {
            titulo += '...';
          }
          movs.push({
            data: convertBrDateToIso(m.data),
            titulo: titulo || 'Movimentação processual',
            descricao: fullText || 'Sem descrição detalhada.',
            tag: classifyTag(fullText)
          });
        });
      }

      if (movs.length === 0) {
        movs.push({
          data: convertBrDateToIso(p.distribuicao),
          titulo: 'Processo distribuído',
          descricao: `Processo distribuído no tribunal: ${p.distribuicao || 'Data não informada'}.`,
          tag: 'informativo'
        });
      }

      // Identificação da parte contrária
      let parteContraria = 'Não informada';
      const normUser = (fullName || '').toLowerCase().trim();
      const reqte = p.reqte || p.autor || '';
      const reqdo = p.reqdo || p.reu || p.exectdo || '';

      if (reqte && reqdo) {
        if (normUser && reqte.toLowerCase().includes(normUser)) {
          parteContraria = reqdo;
        } else if (normUser && reqdo.toLowerCase().includes(normUser)) {
          parteContraria = reqte;
        } else {
          parteContraria = reqdo;
        }
      } else {
        parteContraria = reqdo || reqte || 'Não informada';
      }

      let valorCausa = p.valor_acao;
      if (!valorCausa && p.normalizado_valor_acao) {
        valorCausa = `R$ ${Number(p.normalizado_valor_acao).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      }

      return {
        numero: p.processo || p.numero || 'Não informado',
        tribunal: `TJSP · ${p.vara || p.foro || '1º Grau'}`,
        tipo: p.classe || p.assunto || 'Ação Judicial',
        parteContraria,
        valorCausa: valorCausa || 'Não informado',
        distribuicao: p.distribuicao || 'Não informada',
        movimentos: movs
      };
    });

    return NextResponse.json({
      notFound: false,
      totalProcessos: processes.length,
      processes
    });
  } catch (error) {
    console.error('[api/processos] Exceção:', error);
    return NextResponse.json({ error: 'Falha ao processar consulta de processos.' }, { status: 500 });
  }
}
