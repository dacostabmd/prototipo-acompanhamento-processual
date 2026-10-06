import { createHash, randomUUID } from 'crypto';
import { getAdminClient, getUserId, trackEvento } from '@/lib/track';
import { requireUser } from '@/lib/requireUser';
import { NextResponse } from 'next/server';
import type { LegalProcess, Movement } from '@/lib/mockProcesses';
import { extractDdd, prioritizeByDdd } from '@/lib/ddd';
import { invalidateProcessosCache } from '@/lib/redis';
import { consultarDataJud, buscarProcessoDiretoDataJud } from '@/lib/datajud';
import { aliasesDatajudPermitidos } from '@/lib/fontesDatajud';
import {
  FONTES_INFOSIMPLES,
  IDS_PRINCIPAIS_INFOSIMPLES,
  fontesInfosimplesPara,
  type FonteInfosimples,
  type TipoBusca
} from '@/lib/fontesInfosimples';
import { parseCnj } from '@/lib/cnj';
import { desfechoInfosimples } from '@/lib/infosimplesResposta';
import { isValidCnpj, isValidCpf } from '@/lib/format';
import { classifyTag } from '@/lib/classify';
import { custoTotal, custoServico } from '@/lib/infosimplesPricing';
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

async function fetchInfosimples(
  service: string,
  token: string,
  params: Record<string, string | undefined>,
  signal: AbortSignal
) {
  try {
    const form = new URLSearchParams();
    form.append('token', token);
    for (const [key, value] of Object.entries(params)) {
      if (value) form.append(key, value);
    }

    const res = await fetch(`https://api.infosimples.com/api/v2/consultas/${service}`, {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal
    });

    // A Infosimples descreve a falha no próprio envelope ({ code, code_message }), às vezes com HTTP de
    // erro: devolve o corpo sempre que ele vier, para a tela mostrar o motivo em vez de "sem processos".
    const body = await res.json().catch(() => null);
    if (body && typeof body.code === 'number') return body;
    return res.ok ? body : { code: res.status, code_message: `HTTP ${res.status}` };
  } catch (err) {
    if ((err as { name?: string })?.name !== 'AbortError') {
      console.error(`[api/processos] Erro ao consultar ${service}:`, err);
    }
    return null;
  }
}

/** Converte um registro bruto de processo retornado pela Infosimples para o formato LegalProcess. */
function montarLegalProcessDaInfosimples(p: any, tribunalLabel: string, fullName?: string): LegalProcess {
  const num = (p.processo || p.numero || p.numero_processo || p.numero_cnj || '').trim();
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

  return {
    numero: num,
    tribunal: `${tribunalLabel} · ${p.vara || p.foro || p.orgao_julgador || '1º Grau'}`,
    tipo: p.classe || p.classe_acao || p.assunto || 'Ação Judicial',
    parteContraria,
    valorCausa: valorCausa || 'Não informado',
    distribuicao: p.distribuicao || p.data_autuacao || 'Não informada',
    movimentos: movs
  };
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
async function salvarProcessos(userId: string, cpf: string, fullName: string | undefined, list: LegalProcess[]) {
  try {
    const db = getAdminClient();
    if (!db) return;

    // O celular do stepper é da parte pesquisada (opcional), não do usuário logado: não vai para o perfil.
    const perfil: Record<string, string> = {};
    if (cpf) perfil.cpf = cpf;
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

/**
 * Alvo de uma consulta: uma fonte do catálogo (lib/fontesInfosimples.ts) já com o parâmetro e o valor
 * que serão enviados à Infosimples. `label` é o id da fonte (usado nos eventos de progresso e no DDD).
 */
interface Alvo {
  service: string;
  label: string;
  campo: string;
  valor: string;
}

/**
 * Fontes Infosimples a consultar para um tipo de busca. `selecionadas` vem do Passo 2 do stepper
 * (ids do catálogo); ausente (null) = as fontes principais. Só entram serviços que aceitam o tipo
 * de busca — o nome do parâmetro varia por serviço e vem do catálogo.
 */
function resolverAlvos(tipo: TipoBusca, valor: string, selecionadas: unknown): Alvo[] {
  const ids = Array.isArray(selecionadas)
    ? new Set(selecionadas.filter((s): s is string => typeof s === 'string'))
    : new Set(IDS_PRINCIPAIS_INFOSIMPLES);
  return fontesInfosimplesPara(tipo)
    .filter((f: FonteInfosimples) => ids.has(f.id))
    .map(f => ({ service: f.service, label: f.id, campo: f.params[tipo]!, valor }));
}

export async function POST(request: Request) {
  const unauthorized = await requireUser(request);
  if (unauthorized) return unauthorized;

  try {
    const {
      cpf,
      documento,
      nomeParte,
      fullName,
      phone,
      state,
      processNumber,
      tribunaisSelecionados,
      datajudSelecionados,
      avisarMovimentacao,
      canalAviso,
      resumoLinguagemSimples
    } = await request.json();
    // "documento" aceita CPF (11 dígitos) ou CNPJ (14); "cpf" é o nome legado do mesmo campo.
    const cleanDocumento = ((documento ?? cpf) || '').replace(/\D/g, '');
    const cleanProcessNumber = (processNumber || '').replace(/\D/g, '');
    const cleanNomeParte = typeof nomeParte === 'string' ? nomeParte.trim().replace(/\s+/g, ' ') : '';
    // DataJud: ausente = todos os endpoints; lista (inclusive vazia) = só os marcados no Passo 2.
    const datajudPermitidos = aliasesDatajudPermitidos(datajudSelecionados);

    const isBuscaPorNumero = cleanProcessNumber.length === 20;
    const isBuscaPorNome = !isBuscaPorNumero && cleanNomeParte.length > 0;
    const documentoValido =
      (cleanDocumento.length === 11 && isValidCpf(cleanDocumento)) ||
      (cleanDocumento.length === 14 && isValidCnpj(cleanDocumento));
    const tipoDocumento: 'cpf' | 'cnpj' | null =
      cleanDocumento.length === 11 ? 'cpf' : cleanDocumento.length === 14 ? 'cnpj' : null;
    // Só o CPF é gravado no perfil do usuário (a coluna cpf de ap_perfis).
    const cpfParaPerfil = tipoDocumento === 'cpf' && documentoValido ? cleanDocumento : '';

    if (isBuscaPorNome) {
      if (cleanNomeParte.length < 3) {
        return NextResponse.json({ error: 'Informe o nome da parte com ao menos 3 caracteres.' }, { status: 400 });
      }
      if (cleanDocumento && !documentoValido) {
        return NextResponse.json({ error: 'O CPF/CNPJ informado é inválido.' }, { status: 400 });
      }
    } else if (!isBuscaPorNumero && !documentoValido) {
      return NextResponse.json(
        {
          error:
            'Informe um CPF ou CNPJ válido, o nome da parte ou um número de processo CNJ válido (20 dígitos).'
        },
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

      // Fontes do Passo 2: serviços Infosimples do tribunal do CNJ que buscam por número (ausente =
      // todos) e o endpoint DataJud desse tribunal (ausente = habilitado). O DataJud é gratuito.
      const aliasDoCnj = cnjInfo?.datajudAlias ?? '';
      const idsSelecionados = Array.isArray(tribunaisSelecionados)
        ? new Set(tribunaisSelecionados.filter((s: unknown): s is string => typeof s === 'string'))
        : null;
      const tribunaisDoCnj = FONTES_INFOSIMPLES.filter(
        f => f.params.numero && aliasDoCnj && f.datajud === aliasDoCnj && (!idsSelecionados || idsSelecionados.has(f.id))
      ).map(f => ({ service: f.service, label: f.id, campoNumero: f.params.numero as string }));
      const usarDataJud = !!aliasDoCnj && (!datajudPermitidos || datajudPermitidos.has(aliasDoCnj));

      if (!usarDataJud && tribunaisDoCnj.length === 0) {
        return NextResponse.json(
          { error: `Nenhuma fonte habilitada para ${targetLabel}. Marque o DataJud ou a Infosimples no Passo 2.` },
          { status: 400 }
        );
      }

      const stream = new ReadableStream({
        async start(controller) {
          const emit = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          emit({ type: 'started', consultaId });

          // Cruza as duas fontes em paralelo: DataJud (API pública gratuita do CNJ) e Infosimples
          // (raspagem direta do portal do tribunal) — nunca uma como fallback da outra, pois cada
          // uma pode ter dado que a outra não tem (cobertura, atraso de indexação, campos extras).
          let custoEstimado = 0;
          const token = process.env.INFOSIMPLES_API_TOKEN || process.env.INFOSIMPLES_TOKEN;
          const formattedNumber = cnjInfo?.numeroFormatado || cleanProcessNumber;

          const dataJudPromise: Promise<LegalProcess | null> = usarDataJud
            ? buscarProcessoDiretoDataJud(cleanProcessNumber).then(processo => {
                emit({ type: 'progress', label: 'DataJud (CNJ)', found: !!processo });
                return processo;
              })
            : Promise.resolve(null);

          const infosimplesPromise = (async () => {
            if (tribunaisDoCnj.length === 0) return null;
            if (!token) {
              emit({ type: 'progress', label: targetLabel, found: false, erro: 'Token da Infosimples não configurado no servidor.' });
              return null;
            }

            // Serviços que FALHARAM (≠ responderam "nada encontrado"): se todos falharem, a tela mostra o erro.
            const errosDosServicos: string[] = [];

            for (const target of tribunaisDoCnj) {
              const controller = new AbortController();
              const result = await fetchInfosimples(
                target.service,
                token,
                { [target.campoNumero]: formattedNumber },
                controller.signal
              );
              custoEstimado += custoServico(target.service);
              const desfecho = desfechoInfosimples(result);
              if (desfecho.erro) errosDosServicos.push(`${target.label}: ${desfecho.erro}`);

              if (result) {
                console.log(
                  `[api/processos] (busca por número) ${target.service}: code ${result.code} - "${result.code_message}" (data_count: ${result.data_count})`
                );
              } else {
                console.log(`[api/processos] (busca por número) ${target.service}: sem resposta da Infosimples.`);
              }

              // Resposta de busca por número pode vir como objeto de detalhe único (campo "processo",
              // singular, ou o próprio result.data[0] já sem wrapper) ou como lista (mesmo formato do
              // fluxo por CPF), dependendo do serviço — tenta todos os formatos observados.
              const rawList: any[] =
                result?.code === 200 && result.data?.[0]
                  ? result.data[0].processos ||
                    result.data[0].lista_processos ||
                    result.data[0].processos_lista ||
                    result.data[0].lista_processos_encontrados ||
                    (result.data[0].processo ? [result.data[0].processo] : null) ||
                    (result.data[0].numero || result.data[0].numero_processo || result.data[0].classe_acao
                      ? [result.data[0]]
                      : [])
                  : [];

              const achou = rawList.find((p: any) => {
                const num = (p.processo || p.numero || p.numero_processo || p.numero_cnj || '').replace(/\D/g, '');
                return num === cleanProcessNumber;
              });

              if (achou) {
                const processo = montarLegalProcessDaInfosimples(achou, target.label, fullName);
                emit({ type: 'progress', label: targetLabel, found: true });
                return processo;
              }
            }

            emit({
              type: 'progress',
              label: targetLabel,
              found: false,
              ...(errosDosServicos.length === tribunaisDoCnj.length ? { erro: errosDosServicos.join(' | ') } : {})
            });
            return null;
          })();

          const [processoDataJud, processoInfosimples] = await Promise.all([dataJudPromise, infosimplesPromise]);

          // Mescla: parte da base mais completa disponível e complementa com os campos/movimentações
          // que só a outra fonte trouxe (nunca sobrescreve dado já preenchido).
          const allProcesses: LegalProcess[] = [];
          let processoFinal: LegalProcess | null = null;

          if (processoInfosimples && processoDataJud) {
            processoFinal = processoInfosimples;
            const descricoesExistentes = new Set(processoFinal.movimentos.map(m => m.descricao));
            const movimentosNovos = processoDataJud.movimentos.filter(m => !descricoesExistentes.has(m.descricao));
            if (movimentosNovos.length > 0) {
              processoFinal.movimentos = [...movimentosNovos, ...processoFinal.movimentos].sort((a, b) => (a.data < b.data ? 1 : -1));
            }
            if (processoDataJud.assuntosDataJud?.length) processoFinal.assuntosDataJud = processoDataJud.assuntosDataJud;
            if (processoDataJud.orgaoJulgadorDataJud) processoFinal.orgaoJulgadorDataJud = processoDataJud.orgaoJulgadorDataJud;
            if (processoDataJud.grauDataJud) processoFinal.grauDataJud = processoDataJud.grauDataJud;
            if ((!processoFinal.distribuicao || processoFinal.distribuicao === 'Não informada') && processoDataJud.distribuicao !== 'Não informada') {
              processoFinal.distribuicao = processoDataJud.distribuicao;
            }
            if ((!processoFinal.valorCausa || processoFinal.valorCausa === 'Não informado') && processoDataJud.valorCausa !== 'Não informado') {
              processoFinal.valorCausa = processoDataJud.valorCausa;
            }
            processoFinal.enriquecidoDataJud = true;
          } else {
            processoFinal = processoInfosimples || processoDataJud;
          }

          if (processoFinal) allProcesses.push(processoFinal);

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
              fontes: { dataJud: !!processoDataJud, infosimples: !!processoInfosimples },
              processos: allProcesses.map(p => ({ numero: p.numero, tipo: p.tipo, tribunal: p.tribunal }))
            }
          });

          if (userId && allProcesses.length > 0) {
            await salvarProcessos(userId, cpfParaPerfil, fullName, allProcesses);
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
              custoEstimado
            });
          } else {
            emit({
              type: 'done',
              notFound: false,
              totalProcessos: allProcesses.length,
              processes: allProcesses,
              tribunaisConsultados: [targetLabel],
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
    }

    // ── FLUXO B: VARREDURA MULTI-TRIBUNAL POR CPF, CNPJ OU NOME DA PARTE (INFOSIMPLES) ──
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

    // Tipo de busca -> valor enviado à Infosimples. Na busca por nome só o nome vai ao serviço (o
    // CPF/CNPJ, se informado, identifica o titular no perfil e no resumo, não filtra homônimos).
    const tipoBusca: TipoBusca = isBuscaPorNome ? 'nome' : (tipoDocumento as 'cpf' | 'cnpj');
    const valorBusca = isBuscaPorNome ? cleanNomeParte : cleanDocumento;

    const targets = prioritizeByDdd(resolverAlvos(tipoBusca, valorBusca, tribunaisSelecionados), ddd);

    if (targets.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma fonte habilitada aceita este tipo de busca. Revise as fontes no Passo 2.' },
        { status: 400 }
      );
    }

    const custoEstimado = custoTotal(targets.map(t => t.service));

    console.log(
      `[api/processos] Consulta multi-tribunal para ${fullName || 'Cliente'} (${tipoBusca.toUpperCase()}: ${isBuscaPorNome ? cleanNomeParte : cleanDocumento}, Estado: ${state || 'Auto'}, DDD: ${ddd || 'N/I'}) nos tribunais:`,
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
          const result = await fetchInfosimples(target.service, token, { [target.campo]: target.valor }, abortController.signal);
          const cancelado = abortController.signal.aborted;
          abortControllers.delete(target.label);

          if (cancelado) {
            emit({ type: 'progress', label: target.label, found: false, cancelado: true });
            return;
          }

          let foundInThisTribunal = false;
          const desfecho = desfechoInfosimples(result);
          console.log(
            result
              ? `[api/processos] ${target.label} (${target.campo}): code ${result.code} - "${result.code_message}" (data_count: ${result.data_count})${desfecho.erro ? ' [ERRO]' : ''}`
              : `[api/processos] ${target.label} (${target.campo}): sem resposta da Infosimples [ERRO]`
          );

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

              allProcesses.push(montarLegalProcessDaInfosimples(p, target.label, fullName));
            });
          }

          // "erro" só quando a fonte falhou; fonte que respondeu "nada encontrado" segue como found:false.
          emit({
            type: 'progress',
            label: target.label,
            found: foundInThisTribunal,
            ...(desfecho.erro && !foundInThisTribunal ? { erro: desfecho.erro, codigo: desfecho.codigo } : {})
          });
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
            const enriquecido = await consultarDataJud(tribunalLabel, numeroDigits, datajudPermitidos);
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
            modo: tipoBusca,
            estado: selectedState || null,
            processos: filteredProcesses.slice(0, 20).map(p => ({ numero: p.numero, tipo: p.tipo, tribunal: p.tribunal }))
          }
        });

        if (userId) {
          await salvarProcessos(userId, cpfParaPerfil, fullName, filteredProcesses);
          await salvarPreferencias(userId, tribunaisSelecionados, {
            avisarMovimentacao,
            canalAviso,
            resumoLinguagemSimples
          });
        }

        if (filteredProcesses.length === 0) {
          console.log(`[api/processos] Nenhum processo localizado nos tribunais consultados (${tribunaisConsultados.join(', ')}) para a busca por ${tipoBusca}.`);
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
