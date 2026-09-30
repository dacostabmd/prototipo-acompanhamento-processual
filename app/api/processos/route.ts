import { createHash } from 'crypto';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { NextResponse } from 'next/server';
import type { LegalProcess, Movement } from '@/lib/mockProcesses';
import { extractDdd, prioritizeByDdd } from '@/lib/ddd';
import { invalidateProcessosCache } from '@/lib/redis';
import { consultarDataJud } from '@/lib/datajud';
import { classifyTag } from '@/lib/classify';
import { custoTotal } from '@/lib/infosimplesPricing';

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

/** Salva as preferências do stepper (Onde procurar / Avisos). Nunca lança erro. */
async function salvarPreferencias(
  userId: string,
  tribunaisSelecionados: string[] | null | undefined,
  avisos: { avisarMovimentacao?: boolean; canalAviso?: string; resumoLinguagemSimples?: boolean } | undefined
) {
  if (!avisos && tribunaisSelecionados === undefined) return;
  try {
    const db = getAdminClient();
    if (!db) return;

    const r = await db.from('ap_preferencias_consulta').upsert(
      {
        user_id: userId,
        tribunais_selecionados: Array.isArray(tribunaisSelecionados) && tribunaisSelecionados.length > 0 ? tribunaisSelecionados : null,
        avisar_movimentacao: avisos?.avisarMovimentacao ?? false,
        canal_aviso: avisos?.canalAviso ?? 'nenhum',
        resumo_linguagem_simples: avisos?.resumoLinguagemSimples ?? false,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    );
    if (r.error) console.error('[api/processos] preferencias:', r.error.message);
  } catch (e) {
    console.error('[api/processos] falha ao salvar preferências', e);
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
      else await invalidateProcessosCache(userId);
    }
  } catch (e) {
    console.error('[api/processos] falha ao salvar processos', e);
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  try {
    const {
      cpf,
      fullName,
      phone,
      state,
      processNumber,
      tribunaisSelecionados,
      avisarMovimentacao,
      canalAviso,
      resumoLinguagemSimples
    } = await request.json();
    const cleanCpf = (cpf || '').replace(/\D/g, '');
    const cleanProcessNumber = (processNumber || '').replace(/\D/g, '');

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
    const ddd = extractDdd(cleanPhone);
    const selectedState = (state || '').toUpperCase();

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

    // Prioriza o tribunal do estado do DDD informado (ex.: DDD 11 -> TJSP primeiro), mas consulta
    // todos os tribunais disponíveis do mesmo jeito — é só a ordem/animação de progresso que muda.
    const orderedTargets = prioritizeByDdd(ALL_TARGETS, ddd);

    // Passo "Onde procurar": se o usuário restringiu a busca a tribunais específicos, filtra a varredura.
    // null/vazio (ou ausência do campo) mantém o comportamento padrão de consultar todos os tribunais.
    const hasTribunalFilter = Array.isArray(tribunaisSelecionados) && tribunaisSelecionados.length > 0;
    const targets = hasTribunalFilter
      ? orderedTargets.filter(t => tribunaisSelecionados.includes(t.label))
      : orderedTargets;

    // Preço base (faixa de menor volume, 1–500 consultas/mês) + adicional fixo por serviço,
    // conforme tabela pública da Infosimples (ver lib/infosimplesPricing.ts) — mais fiel que
    // um valor único cravado para todos os tribunais.
    const custoEstimado = custoTotal(targets.map(t => t.service));

    console.log(
      `[api/processos] Consulta multi-tribunal para ${fullName || 'Cliente'} (CPF: ${cleanCpf}, Estado: ${state || 'Auto'}, DDD: ${ddd || 'N/I'}) nos tribunais:`,
      targets.map(t => t.label).join(', ')
    );

    // Streaming NDJSON: cada linha é emitida assim que o respectivo tribunal responde,
    // em vez de esperar Promise.allSettled terminar todas as 14 chamadas (o mais lento
    // das 14 determinava o tempo total de espera sem nenhum feedback incremental).
    const encoder = new TextEncoder();
    const allProcesses: LegalProcess[] = [];
    const seenProcessos = new Set<string>();
    const tribunaisConsultados: string[] = [];

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

        const perTribunalPromises = targets.map(async target => {
          tribunaisConsultados.push(target.label);
          const result = await fetchInfosimples(target.service, token, cleanCpf);

          let foundInThisTribunal = false;
          if (result) {
            console.log(`[api/processos] ${target.label}: code ${result.code} - "${result.code_message}" (data_count: ${result.data_count})`);
          }

          if (result && result.code === 200 && result.data?.[0]) {
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
              foundInThisTribunal = true;

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
          }

          // Emite o progresso deste tribunal específico assim que ele termina, independente dos outros 13.
          emit({ type: 'progress', label: target.label, found: foundInThisTribunal });
        });

        await Promise.allSettled(perTribunalPromises);

        // Passo "Como buscar" no modo Nº do processo: filtra o resultado da varredura por CPF para
        // manter só o(s) processo(s) cujo número bate com o informado. Infosimples não tem endpoint de
        // busca por número, então a varredura completa por CPF continua ocorrendo normalmente.
        const filteredProcesses = cleanProcessNumber
          ? allProcesses.filter(p => p.numero.replace(/\D/g, '').includes(cleanProcessNumber))
          : allProcesses;

        // Enriquecimento via DataJud (CNJ): por processo já encontrado pela Infosimples (não por
        // tribunal da varredura), busca movimentações adicionais pelo número CNJ. DataJud não tem
        // busca por CPF/CNPJ, só por número de processo — por isso entra aqui, depois da Infosimples
        // já ter localizado os processos. No-op silencioso sem DATAJUD_API_KEY configurada.
        await Promise.allSettled(
          filteredProcesses.map(async p => {
            const tribunalLabel = p.tribunal.split(' · ')[0];
            const numeroDigits = p.numero.replace(/\D/g, '');
            const enriquecido = await consultarDataJud(tribunalLabel, numeroDigits);
            if (!enriquecido) return;

            const descricoesExistentes = new Set(p.movimentos.map(m => m.descricao));
            const movimentosNovos = enriquecido.movimentos.filter(m => !descricoesExistentes.has(m.descricao));
            if (movimentosNovos.length > 0) {
              p.movimentos = [...movimentosNovos, ...p.movimentos].sort((a, b) => (a.data < b.data ? 1 : -1));
              p.enriquecidoDataJud = true;
            }
          })
        );

        const userId = await getUserId(request);
        await trackEvento(request, userId, {
          tipo: 'consulta',
          assunto: filteredProcesses[0]?.tipo,
          classe: filteredProcesses[0]?.tipo,
          tribunal: tribunaisConsultados.join(', '),
          dados: {
            totalProcessos: filteredProcesses.length,
            estado: selectedState || null,
            processos: filteredProcesses.slice(0, 20).map(p => ({ numero: p.numero, tipo: p.tipo, tribunal: p.tribunal }))
          }
        });

        if (userId) {
          await salvarProcessos(userId, cleanCpf, phone, fullName, filteredProcesses);
          await salvarPreferencias(userId, tribunaisSelecionados, {
            avisarMovimentacao,
            canalAviso,
            resumoLinguagemSimples
          });
        }

        if (filteredProcesses.length === 0) {
          console.log(`[api/processos] Nenhum processo localizado nos tribunais consultados (${tribunaisConsultados.join(', ')}) para o CPF ${cleanCpf}.`);
          emit({ type: 'done', notFound: true, totalProcessos: 0, processes: [], tribunaisConsultados, custoEstimado });
        } else {
          console.log(`[api/processos] Sucesso: ${filteredProcesses.length} processo(s) consolidado(s) de ${tribunaisConsultados.join(', ')}. Custo estimado: R$ ${custoEstimado.toFixed(2)}`);
          emit({
            type: 'done',
            notFound: false,
            totalProcessos: filteredProcesses.length,
            processes: filteredProcesses,
            tribunaisConsultados,
            custoEstimado
          });
        }

        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
      }
    });
  } catch (error) {
    console.error('[api/processos] Exceção:', error);
    return NextResponse.json({ error: 'Falha ao processar consulta de processos.' }, { status: 500 });
  }
}
