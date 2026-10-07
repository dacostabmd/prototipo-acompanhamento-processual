import { buscarProcessoDiretoDataJud } from '@/lib/datajud';
import { FONTES_INFOSIMPLES } from '@/lib/fontesInfosimples';
import { aliasesDatajudPermitidos } from '@/lib/fontesDatajud';
import { parseCnj } from '@/lib/cnj';
import { desfechoInfosimples } from '@/lib/infosimplesResposta';
import { classifyTag } from '@/lib/classify';
import { custoServico } from '@/lib/infosimplesPricing';
import { precoDaRespostaInfosimples } from '@/lib/historicoConsultas';
import type { LegalProcess, Movement } from '@/lib/mockProcesses';

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
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 20000);
  const onSignalAbort = () => timeoutController.abort();
  signal.addEventListener('abort', onSignalAbort);

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
      signal: timeoutController.signal
    });

    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onSignalAbort);

    // A Infosimples descreve a falha no próprio envelope ({ code, code_message }), às vezes com HTTP de
    // erro: devolve o corpo sempre que ele vier, para a tela mostrar o motivo em vez de "sem processos".
    const body = await res.json().catch(() => null);
    if (body && typeof body.code === 'number') return body;
    return res.ok ? body : { code: res.status, code_message: `HTTP ${res.status}` };
  } catch (err) {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', onSignalAbort);
    if ((err as { name?: string })?.name !== 'AbortError') {
      console.error(`[motorConsulta] Erro ao consultar ${service}:`, err);
    }
    return { code: 504, code_message: 'Tempo limite esgotado para esta fonte' };
  }
}

/** Campo que alguns serviços devolvem como texto e outros como objeto ({ nome, ... }) — ex.: orgao_julgador do TJRJ eproc. */
function textoDoCampo(v: any): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object' && typeof v.nome === 'string') return v.nome.trim();
  return '';
}

/** "- BANCO VOTORANTIM S A   (59.5****)" (ou [parte, advogado...]) → "BANCO VOTORANTIM S A". */
function nomeDaParte(entrada: any): string {
  const bruto = Array.isArray(entrada) ? entrada[0] : entrada;
  if (typeof bruto !== 'string') return '';
  return bruto.replace(/^[\s-]+/, '').replace(/\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

/** Minúsculas, sem acentos e com espaços colapsados — para comparar nomes vindos de fontes diferentes. */
function normalizarNome(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * true quando o nome pesquisado (fullName) aparece contido no nome do polo ativo (autor) do processo
 * — critério do checkbox "somente autor" do Passo 1. Sem autor informado pela fonte, não há como
 * confirmar o polo: retorna true (processo permanece visível, nunca é descartado por falta de dado).
 */
function pesquisadoEhAutor(fullName: string | undefined, autor: string | undefined): boolean {
  const nomePesquisado = normalizarNome(fullName || '');
  if (!nomePesquisado || !autor) return true;
  return normalizarNome(autor).includes(nomePesquisado);
}

/**
 * Registros de processo dentro de data[0] da Infosimples. Os serviços variam: lista (processos,
 * lista_processos...), detalhe único em "processo" (objeto) ou o próprio data[0] já como detalhe. Atenção:
 * alguns serviços (ex.: TJRJ eproc) mandam a lista VAZIA junto com o detalhe preenchido, então a lista só
 * vale se tiver itens — com `||` o array vazio (truthy) escondia o processo encontrado.
 */
function extrairProcessosInfosimples(dado: any): any[] {
  if (!dado) return [];
  const lista = [dado.processos, dado.lista_processos, dado.processos_lista, dado.lista_processos_encontrados].find(
    l => Array.isArray(l) && l.length > 0
  );
  if (lista) return lista;
  if (dado.processo && typeof dado.processo === 'object') return [dado.processo];
  if (dado.processo || dado.numero || dado.numero_processo || dado.classe_acao) return [dado];
  return [];
}

/** Converte um registro bruto de processo retornado pela Infosimples para o formato LegalProcess. */
function montarLegalProcessDaInfosimples(p: any, tribunalLabel: string, fullName?: string): LegalProcess {
  const num = (p.processo || p.numero || p.numero_processo || p.numero_cnj || '').trim();
  const movs: Movement[] = [];
  const orgao = textoDoCampo(p.vara) || textoDoCampo(p.foro) || textoDoCampo(p.orgao_julgador);
  // Partes: reqte/reqdo/autor/reu (lista) ou partes_representantes.{exequente|autor...}/{executado|reu...} (eproc).
  const partesRep = p.partes_representantes && typeof p.partes_representantes === 'object' ? p.partes_representantes : {};
  const autor: string =
    textoDoCampo(p.reqte) || textoDoCampo(p.autor) || nomeDaParte(partesRep.exequente?.[0] ?? partesRep.autor?.[0] ?? partesRep.requerente?.[0]);
  const reu: string =
    textoDoCampo(p.reqdo) || textoDoCampo(p.reu) || textoDoCampo(p.exectdo) || nomeDaParte(partesRep.executado?.[0] ?? partesRep.reu?.[0] ?? partesRep.requerido?.[0]);

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
      const responsavel = m.responsavel || m.magistrado || textoDoCampo(m.orgao_julgador) || m.orgao;
      const complemento = m.complemento || m.observacao || m.detalhe;
      const extras = [
        responsavel && `Responsável: ${responsavel}`,
        complemento && complemento !== fullText && complemento
      ].filter(Boolean);
      const descricaoCompleta = extras.length > 0 ? `${fullText} — ${extras.join(' · ')}` : fullText;
      movs.push({
        data: convertBrDateToIso(m.data || m.data_evento || m.data_hora || m.data_hora_movimentacao),
        titulo: titulo || 'Movimentação processual',
        descricao: descricaoCompleta || 'Sem descrição detalhada.',
        tag: classifyTag(fullText)
      });
    });
  }

  // "julgamentos" (só no TJSP 2º grau): lista de strings "DD/MM/AAAA <texto do julgamento>", não
  // objetos como os demais formatos — único campo com conteúdo quando o grau não tem movimentações.
  if (movs.length === 0 && Array.isArray(p.julgamentos) && p.julgamentos.length > 0) {
    p.julgamentos.forEach((texto: unknown) => {
      if (typeof texto !== 'string' || !texto.trim()) return;
      const match = /^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/.exec(texto.trim());
      const dataBr = match?.[1];
      const corpo = match?.[2] ?? texto.trim();
      movs.push({
        data: convertBrDateToIso(dataBr),
        titulo: corpo.length > 70 ? `${corpo.slice(0, 70)}...` : corpo,
        descricao: corpo,
        tag: classifyTag(corpo)
      });
    });
  }

  if (movs.length === 0) {
    const classeInfo = p.classe || p.classe_acao || p.assunto;
    const varaInfo = orgao;
    const valorInfo = p.valor_acao || p.valor_causa;
    const partesInfo = [autor, reu].filter(Boolean).join(' x ');
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
    tribunal: `${tribunalLabel} · ${orgao || '1º Grau'}`,
    tipo: p.classe || p.classe_acao || p.assunto || 'Ação Judicial',
    parteContraria,
    valorCausa: valorCausa || 'Não informado',
    distribuicao: p.distribuicao || p.data_autuacao || 'Não informada',
    movimentos: movs,
    assunto: textoDoCampo(p.assunto) || (Array.isArray(p.assuntos) ? p.assuntos.filter((a: unknown) => typeof a === 'string').join(', ') : '') || undefined,
    varaForo: [textoDoCampo(p.vara) || textoDoCampo(p.orgao_julgador), textoDoCampo(p.foro)].filter(Boolean).join(' - ') || undefined,
    autor: autor || undefined,
    reu: reu || undefined
  };
}

/** Evento de progresso de uma sub-fonte (DataJud ou Infosimples) durante a busca por número. */
export interface ProgressoConsultaPorNumero {
  label: string;
  fonte: 'datajud' | 'infosimples';
  status?: 'loading';
  found?: boolean;
  cancelado?: boolean;
  erro?: string;
}

export interface ResultadoConsultaPorNumero {
  processo: LegalProcess | null;
  custoEstimado: number;
  custoCobrado: number;
  targetLabel: string;
  /** Quais fontes retornaram o processo, apurado antes do filtro "somente autor" (para fins de tracking). */
  fontes: { dataJud: boolean; infosimples: boolean };
  /** Preenchido quando o checkbox "somente autor" descartou o processo encontrado (polo não bate). */
  descartadoPorPolo?: { numero: string; tribunal: string; autor?: string };
  erro?: string;
}

/**
 * Busca um único processo pelo número CNJ: descobre o tribunal, dispara em paralelo os serviços
 * Infosimples candidatos daquele tribunal e o DataJud, e mescla os dois resultados (Infosimples como
 * base, DataJud só complementa campos ausentes — nunca sobrescreve). Lógica extraída de
 * app/api/processos/route.ts (Fluxo A) para poder ser reusada fora do contexto HTTP/streaming
 * (ex.: cron de reconsulta noturna).
 */
export async function buscarProcessoPorNumero(
  numeroCnj: string,
  opcoes?: {
    fullName?: string;
    somenteAutor?: boolean;
    tribunaisSelecionados?: string[];
    datajudSelecionados?: string[];
    signal?: AbortSignal;
    onProgress?: (evento: ProgressoConsultaPorNumero) => void;
    /**
     * Expõe os AbortControllers internos de cada sub-fonte (chave "DataJud · <tribunal>" e
     * "<tribunal>" para a Infosimples) assim que são criados, para quem chamar poder registrá-los
     * num mecanismo próprio de cancelamento (ex.: o registro por consultaId de app/api/processos).
     */
    onAbortControllerCreated?: (chave: string, controller: AbortController) => void;
    /** Avisa quando a sub-fonte daquela chave terminou (sucesso ou erro), para remover do registro externo. */
    onAbortControllerSettled?: (chave: string) => void;
  }
): Promise<ResultadoConsultaPorNumero> {
  const { fullName, somenteAutor, tribunaisSelecionados, datajudSelecionados, onProgress, onAbortControllerCreated, onAbortControllerSettled } = opcoes ?? {};
  const emit = (evento: ProgressoConsultaPorNumero) => onProgress?.(evento);

  const cleanProcessNumber = (numeroCnj || '').replace(/\D/g, '');
  const cnjInfo = parseCnj(cleanProcessNumber);
  const targetLabel = cnjInfo?.tribunalLabel || 'Tribunal';
  const datajudPermitidos = aliasesDatajudPermitidos(datajudSelecionados);

  console.log(
    `[motorConsulta] Consulta direta por Número CNJ: ${cleanProcessNumber} (Tribunal: ${targetLabel} - ${cnjInfo?.tribunalNome || 'Detectado'})`
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
    return {
      processo: null,
      custoEstimado: 0,
      custoCobrado: 0,
      targetLabel,
      fontes: { dataJud: false, infosimples: false },
      erro: `Nenhuma fonte habilitada para ${targetLabel}. Marque o DataJud ou a Infosimples no Passo 2.`
    };
  }

  // Cruza as duas fontes em paralelo: DataJud (API pública gratuita do CNJ) e Infosimples
  // (raspagem direta do portal do tribunal) — nunca uma como fallback da outra, pois cada
  // uma pode ter dado que a outra não tem (cobertura, atraso de indexação, campos extras).
  let custoEstimado = 0;
  let custoCobrado = 0;
  const token = process.env.INFOSIMPLES_API_TOKEN || process.env.INFOSIMPLES_TOKEN;
  const formattedNumber = cnjInfo?.numeroFormatado || cleanProcessNumber;

  if (usarDataJud) emit({ label: 'DataJud (CNJ)', fonte: 'datajud', status: 'loading' });
  if (tribunaisDoCnj.length > 0) emit({ label: targetLabel, fonte: 'infosimples', status: 'loading' });

  const dataJudAbort = new AbortController();
  if (opcoes?.signal) opcoes.signal.addEventListener('abort', () => dataJudAbort.abort());
  if (usarDataJud) onAbortControllerCreated?.(`DataJud · ${targetLabel}`, dataJudAbort);
  const dataJudPromise: Promise<LegalProcess | null> = usarDataJud
    ? buscarProcessoDiretoDataJud(cleanProcessNumber, dataJudAbort.signal).then(processo => {
        onAbortControllerSettled?.(`DataJud · ${targetLabel}`);
        if (dataJudAbort.signal.aborted) {
          emit({ label: 'DataJud (CNJ)', fonte: 'datajud', found: false, cancelado: true });
          return null;
        }
        if (processo) processo.origem = 'datajud';
        emit({ label: 'DataJud (CNJ)', fonte: 'datajud', found: !!processo });
        return processo;
      })
    : Promise.resolve(null);

  const infosimplesPromise = (async () => {
    if (tribunaisDoCnj.length === 0) return null;
    if (!token) {
      emit({ label: targetLabel, fonte: 'infosimples', found: false, erro: 'Token da Infosimples não configurado no servidor.' });
      return null;
    }

    // Todos os serviços Infosimples candidatos ao tribunal do CNJ (ex.: TJSP tem 4 sistemas —
    // 1º grau, 2º grau, eproc, eproc unificada) disparam ao mesmo tempo, não um de cada vez:
    // o primeiro que achar o processo é o usado, os demais seguem em paralelo até resolver.
    const infosimplesAbort = new AbortController();
    if (opcoes?.signal) opcoes.signal.addEventListener('abort', () => infosimplesAbort.abort());
    onAbortControllerCreated?.(targetLabel, infosimplesAbort);
    const resultadosPorServico = await Promise.all(
      tribunaisDoCnj.map(async target => {
        const result = await fetchInfosimples(
          target.service,
          token,
          { [target.campoNumero]: formattedNumber },
          infosimplesAbort.signal
        );
        custoEstimado += custoServico(target.service);
        custoCobrado += precoDaRespostaInfosimples(result);
        const desfecho = desfechoInfosimples(result);

        if (result) {
          console.log(
            `[motorConsulta] (busca por número) ${target.service}: code ${result.code} - "${result.code_message}" (data_count: ${result.data_count})`
          );
        } else {
          console.log(`[motorConsulta] (busca por número) ${target.service}: sem resposta da Infosimples.`);
        }

        // Resposta de busca por número pode vir como objeto de detalhe único (campo "processo",
        // singular, ou o próprio result.data[0] já sem wrapper) ou como lista (mesmo formato do
        // fluxo por CPF), dependendo do serviço — tenta todos os formatos observados.
        const rawList: any[] = result?.code === 200 ? extrairProcessosInfosimples(result.data?.[0]) : [];

        const achou = rawList.find((p: any) => {
          const num = (p.processo || p.numero || p.numero_processo || p.numero_cnj || '').replace(/\D/g, '');
          return num === cleanProcessNumber;
        });

        return { target, achou, erro: desfecho.erro };
      })
    );

    onAbortControllerSettled?.(targetLabel);
    if (infosimplesAbort.signal.aborted) {
      emit({ label: targetLabel, fonte: 'infosimples', found: false, cancelado: true });
      return null;
    }

    const comAchado = resultadosPorServico.find(r => r.achou);
    if (comAchado) {
      const processo = montarLegalProcessDaInfosimples(comAchado.achou, comAchado.target.label, fullName);
      processo.origem = 'infosimples';
      emit({ label: targetLabel, fonte: 'infosimples', found: true });
      return processo;
    }

    const errosDosServicos = resultadosPorServico.filter(r => r.erro).map(r => `${r.target.label}: ${r.erro}`);
    emit({
      label: targetLabel,
      fonte: 'infosimples',
      found: false,
      ...(errosDosServicos.length === tribunaisDoCnj.length ? { erro: errosDosServicos.join(' | ') } : {})
    });
    return null;
  })();

  const [processoDataJud, processoInfosimples] = await Promise.all([dataJudPromise, infosimplesPromise]);

  // Mescla: parte da base mais completa disponível e complementa com os campos/movimentações
  // que só a outra fonte trouxe (nunca sobrescreve dado já preenchido).
  let processoFinal: LegalProcess | null = null;

  if (processoInfosimples && processoDataJud) {
    processoFinal = processoInfosimples;
    const descricoesExistentes = new Set(processoFinal.movimentos.map((m: Movement) => m.descricao));
    const movimentosNovos = processoDataJud.movimentos.filter((m: Movement) => !descricoesExistentes.has(m.descricao));
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
    processoFinal.origem = 'ambos';
  } else {
    processoFinal = processoInfosimples || processoDataJud;
  }

  // Checkbox opcional do Passo 1 ("somente autor"): se o processo encontrado tem autor
  // conhecido e ele não bate com o nome pesquisado, o resultado vira "processo não encontrado"
  // (mesmo tratamento de ausência usado no fluxo de varredura por CPF/CNPJ/nome). O descarte é
  // reportado à parte (não some em silêncio) para dar transparência ao usuário.
  let descartadoPorPolo: { numero: string; tribunal: string; autor?: string } | undefined;
  if (processoFinal && somenteAutor && !pesquisadoEhAutor(fullName, processoFinal.autor)) {
    descartadoPorPolo = { numero: processoFinal.numero, tribunal: processoFinal.tribunal, autor: processoFinal.autor };
    processoFinal = null;
  }

  return {
    processo: processoFinal,
    custoEstimado,
    custoCobrado,
    targetLabel,
    fontes: { dataJud: !!processoDataJud, infosimples: !!processoInfosimples },
    descartadoPorPolo
  };
}
