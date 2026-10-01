import { createHash, randomUUID } from 'crypto';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { NextResponse } from 'next/server';
import type { LegalProcess, Movement } from '@/lib/mockProcesses';
import { extractDdd, prioritizeByDdd } from '@/lib/ddd';
import { invalidateProcessosCache } from '@/lib/redis';
import { consultarDataJud, buscarProcessoDiretoDataJud } from '@/lib/datajud';
import { parseCnj } from '@/lib/cnj';
import { classifyTag } from '@/lib/classify';
import { custoTotal } from '@/lib/infosimplesPricing';
import { criarRegistroConsulta, limparRegistroConsulta } from '@/lib/consultaAbort';

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

async function fetchInfosimples(service: string, token: string, cleanCpf: string, signal: AbortSignal) {
  try {
    const form = new URLSearchParams();
    form.append('token', token);
    form.append('cpf', cleanCpf);

    const res = await fetch(`https://api.infosimples.com/api/v2/consultas/${service}`, {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal
    });

    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (err) {
    if ((err as { name?: string })?.name !== 'AbortError') {
      console.error(`[api/processos] Erro ao consultar ${service}:`, err);
    }
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

    const perfil: Record<string, string> = {};
    if (cpf) perfil.cpf = cpf;
    const tel = (phone || '').replace(/\D/g, '');
    if (tel) perfil.telefone = tel;
    if (fullName?.trim()) perfil.nome = fullName.trim();
    if (Object.keys(perfil).length > 0) {
      const up = await db.from('ap_perfis').update(perfil).eq('id', userId);
      if (up.error) console.error('[api/processos] perfil:', up.error.message);
    }

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

    const isBuscaPorNumero = cleanProcessNumber.length === 20;

    if (!isBuscaPorNumero && cleanCpf.length !== 11) {
      return NextResponse.json(
        { error: 'Informe um CPF válido (11 dígitos) ou um número de processo CNJ válido (20 dígitos).' },
        { status: 400 }
      );
    }

    // ── FLUXO A: BUSCA DIRETA POR NÚMERO DE PROCESSO (CNJ) ──
    if (isBuscaPorNumero) {
      const cnjInfo = parseCnj(cleanProcessNumber);
      const targetLabel = cnjInfo?.tribunalLabel || 'Tribunal';
      const consultaId = randomUUID();
      const encoder = new TextEncoder();

      console.log(
        `[api/processos] Consulta direta por Número CNJ: ${cleanProcessNumber} (Tribunal: ${targetLabel} - ${cnjInfo?.tribunalNome || 'Detectado'})`
      );

      const stream = new ReadableStream({
        async start(controller) {
          const emit = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          emit({ type: 'started', consultaId });

          // Busca direto na API pública do DataJud (CNJ) pelo número de processo
          const processoDataJud = await buscarProcessoDiretoDataJud(cleanProcessNumber);
          const allProcesses: LegalProcess[] = [];

          if (processoDataJud) {
            allProcesses.push(processoDataJud);
            emit({ type: 'progress', label: targetLabel, found: true });
          } else {
            console.log(`[api/processos] Processo ${cleanProcessNumber} não localizado no DataJud para ${targetLabel}.`);
            emit({ type: 'progress', label: targetLabel, found: false });
          }

          const userId = await getUserId(request);
          await trackEvento(request, userId, {
            tipo: 'consulta',
            assunto: allProcesses[0]?.tipo,
            classe: allProcesses[0]?.tipo,
            tribunal: targetLabel,
            dados: {
              totalProcessos: allProcesses.length,
              modo: 'numero',
              numeroProcesso: cleanProcessNumber,
              processos: allProcesses.map(p => ({ numero: p.numero, tipo: p.tipo, tribunal: p.tribunal }))
            }
          });

          if (userId && allProcesses.length > 0) {
            await salvarProcessos(userId, cleanCpf, phone, fullName, allProcesses);
            await salvarPreferencias(userId, [targetLabel], {
              avisarMovimentacao,
              canalAviso,
              resumoLinguagemSimples
            });
          }

          if (allProcesses.length === 0) {
            emit({
              type: 'done',
              notFound: true,
              totalProcessos: 0,
              processes: [],
              tribunaisConsultados: [targetLabel],
              custoEstimado: 0
            });
          } else {
            emit({
              type: 'done',
              notFound: false,
              totalProcessos: allProcesses.length,
              processes: allProcesses,
              tribunaisConsultados: [targetLabel],
              custoEstimado: 0
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
    }

    // ── FLUXO B: VARREDURA MULTI-TRIBUNAL POR CPF (INFOSIMPLES) ──
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

    const orderedTargets = prioritizeByDdd(ALL_TARGETS, ddd);

    const hasTribunalFilter = Array.isArray(tribunaisSelecionados) && tribunaisSelecionados.length > 0;
    const targets = hasTribunalFilter
      ? orderedTargets.filter(t => tribunaisSelecionados.includes(t.label))
      : orderedTargets;

    const custoEstimado = custoTotal(targets.map(t => t.service));

    console.log(
      `[api/processos] Consulta multi-tribunal para ${fullName || 'Cliente'} (CPF: ${cleanCpf}, Estado: ${state || 'Auto'}, DDD: ${ddd || 'N/I'}) nos tribunais:`,
      targets.map(t => t.label).join(', ')
    );

    const encoder = new TextEncoder();
    const allProcesses: LegalProcess[] = [];
    const seenProcessos = new Set<string>();
    const tribunaisConsultados: string[] = [];

    const consultaId = randomUUID();
    const abortControllers = criarRegistroConsulta(consultaId);

    const stream = new ReadableStream({
      async start(controller) {
        const emit = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        emit({ type: 'started', consultaId });

        const perTribunalPromises = targets.map(async target => {
          tribunaisConsultados.push(target.label);
          const abortController = new AbortController();
          abortControllers.set(target.label, abortController);
          const result = await fetchInfosimples(target.service, token, cleanCpf, abortController.signal);
          const cancelado = abortController.signal.aborted;
          abortControllers.delete(target.label);

          if (cancelado) {
            emit({ type: 'progress', label: target.label, found: false, cancelado: true });
            return;
          }

          let foundInThisTribunal = false;
          if (result) {
            console.log(`[api/processos] ${target.label}: code ${result.code} - "${result.code_message}" (data_count: ${result.data_count})`);
          }

          if (result && result.code === 200 && result.data?.[0]) {
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
                  const responsavel = m.responsavel || m.magistrado || m.orgao_julgador || m.orgao;
                  const complemento = m.complemento || m.observacao || m.detalhe;
                  const extras = [
                    responsavel && `Responsável: ${responsavel}`,
                    complemento && complemento !== fullText && complemento
                  ].filter(Boolean);
                  const descricaoCompleta = extras.length > 0 ? `${fullText} — ${extras.join(' · ')}` : fullText;
                  movs.push({
                    data: convertBrDateToIso(m.data || m.data_evento || m.data_hora_movimentacao),
                    titulo: titulo || 'Movimentação processual',
                    descricao: descricaoCompleta || 'Sem descrição detalhada.',
                    tag: classifyTag(fullText)
                  });
                });
              }

              if (movs.length === 0) {
                const classeInfo = p.classe || p.classe_acao || p.assunto;
                const varaInfo = p.vara || p.foro || p.orgao_julgador;
                const valorInfo = p.valor_acao || p.valor_causa;
                const partesInfo = [p.reqte || p.autor, p.reqdo || p.reu || p.exectdo].filter(Boolean).join(' x ');
                const situacaoInfo = p.situacao || p.status || p.fase;
                const detalhes = [
                  classeInfo && `Classe: ${classeInfo}`,
                  varaInfo && `Órgão: ${varaInfo}`,
                  valorInfo && `Valor da causa: ${valorInfo}`,
                  partesInfo && `Partes: ${partesInfo}`,
                  situacaoInfo && `Situação: ${situacaoInfo}`
                ].filter(Boolean);

                movs.push({
                  data: convertBrDateToIso(p.distribuicao || p.data_autuacao),
                  titulo: p.ultimo_evento ? (p.ultimo_evento.slice(0, 70) + '...') : 'Processo distribuído',
                  descricao:
                    p.ultimo_evento && detalhes.length > 0
                      ? `${p.ultimo_evento} — ${detalhes.join(' · ')}.`
                      : p.ultimo_evento ||
                        (detalhes.length > 0
                          ? `Processo autuado em ${p.distribuicao || p.data_autuacao || 'data não informada'}. ${detalhes.join(' · ')}.`
                          : `Processo autuado no tribunal: ${p.distribuicao || p.data_autuacao || 'Data não informada'}. O tribunal ainda não disponibilizou o histórico de movimentações para este processo.`),
                  tag: 'informativo'
                });
              }

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

          emit({ type: 'progress', label: target.label, found: foundInThisTribunal });
        });

        await Promise.allSettled(perTribunalPromises);

        const filteredProcesses = cleanProcessNumber
          ? allProcesses.filter(p => p.numero.replace(/\D/g, '').includes(cleanProcessNumber))
          : allProcesses;

        // Enriquecimento via DataJud (CNJ)
        await Promise.allSettled(
          filteredProcesses.map(async p => {
            const tribunalLabel = p.tribunal.split(' · ')[0];
            const numeroDigits = p.numero.replace(/\D/g, '');
            const enriquecido = await consultarDataJud(tribunalLabel, numeroDigits);
            if (!enriquecido) return;

            let mudou = false;

            const descricoesExistentes = new Set(p.movimentos.map(m => m.descricao));
            const movimentosNovos = enriquecido.movimentos.filter(m => !descricoesExistentes.has(m.descricao));
            if (movimentosNovos.length > 0) {
              p.movimentos = [...movimentosNovos, ...p.movimentos].sort((a, b) => (a.data < b.data ? 1 : -1));
              mudou = true;
            }

            if (enriquecido.assuntos.length > 0) {
              p.assuntosDataJud = enriquecido.assuntos;
              mudou = true;
            }
            if (enriquecido.orgaoJulgador) {
              p.orgaoJulgadorDataJud = enriquecido.orgaoJulgador;
              mudou = true;
            }
            if (enriquecido.grau) {
              p.grauDataJud = enriquecido.grau;
              mudou = true;
            }
            if ((!p.distribuicao || p.distribuicao === 'Não informada') && enriquecido.dataAjuizamento) {
              p.distribuicao = enriquecido.dataAjuizamento;
              mudou = true;
            }

            if (mudou) p.enriquecidoDataJud = true;
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

        limparRegistroConsulta(consultaId);
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
