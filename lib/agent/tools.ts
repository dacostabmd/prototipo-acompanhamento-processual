import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { cleanDigits } from '@/lib/format';
import { parseCnj, formatProcessNumber } from '@/lib/cnj';
import { consultarDataJud, type DataJudResultado } from '@/lib/datajud';
import { buscarTrechosProcessuais } from '@/lib/ragDocumentos';
import { getRedis } from '@/lib/redis';

/**
 * 1. Ferramenta para buscar e enriquecer dados de processo judicial no DataJud (CNJ).
 */
export const consultarDataJudTool = tool(
  async ({ numeroProcesso }) => {
    try {
      const digits = cleanDigits(numeroProcesso);
      if (digits.length !== 20) {
        return `O número fornecido (${numeroProcesso}) não possui os 20 dígitos padrão do CNJ. Formato esperado: NNNNNNN-DD.AAAA.J.TR.OOOO.`;
      }

      const cnjInfo = parseCnj(digits);
      if (!cnjInfo) {
        return `Não foi possível identificar o tribunal a partir do número CNJ informado.`;
      }

      const tribunalLabel = cnjInfo.tribunalLabel || cnjInfo.tribunalNome;

      // 1. Tenta recuperar do cache Redis (TTL 6 horas) para evitar a latência da API pública do CNJ
      const redis = getRedis();
      const chaveCache = `ap:datajud:proc:${digits}`;
      let res: DataJudResultado | null = null;

      if (redis) {
        try {
          res = await redis.get<DataJudResultado>(chaveCache);
        } catch (e) {
          console.error('[agent-tools] Falha ao ler cache DataJud:', e);
        }
      }

      // 2. Se não estiver no cache, consulta a API pública oficial com timeout de 20s
      // (no WhatsApp é melhor responder rápido do que deixar o usuário esperando)
      const limite = AbortSignal.timeout(20_000);
      if (!res) {
        res = await consultarDataJud(tribunalLabel, digits, null, limite);
        if (res && redis) {
          try {
            await redis.set(chaveCache, res, { ex: 6 * 3600 });
          } catch (e) {
            console.error('[agent-tools] Falha ao gravar cache DataJud:', e);
          }
        }
      }

      // consultarDataJud devolve null tanto para "não existe" quanto para timeout: sem esta distinção o agente dizia
      // ao usuário que um processo real não foi encontrado
      if (!res && limite.aborted) {
        return (
          `A consulta do processo ${formatProcessNumber(digits)} ao DataJud demorou demais e foi interrompida (a API do CNJ está lenta).\n` +
          `Isso NÃO significa que o processo não existe: diga ao usuário que não foi possível consultar agora e que ele pode tentar de novo em alguns minutos.`
        );
      }
      if (!res) {
        return (
          `Processo ${formatProcessNumber(digits)} (tribunal ${tribunalLabel}) NÃO foi encontrado na base pública do DataJud.\n` +
          `Causas prováveis: número digitado errado, processo em segredo de justiça, ainda não enviado ao DataJud ou instabilidade da API do CNJ.\n` +
          `Não há andamentos para informar: peça ao usuário para conferir o número e não invente dados.`
        );
      }

      // o DataJud devolve do mais antigo para o mais novo: ordena antes de cortar, senão os "últimos" seriam os primeiros
      const movimentosResumo = [...res.movimentos]
        .sort((a, b) => b.data.localeCompare(a.data))
        .slice(0, 8)
        .map(m => `- [${m.data}] ${m.titulo}: ${m.descricao}`)
        .join('\n');

      return (
        `Dados obtidos do DataJud para o processo ${formatProcessNumber(digits)}:\n` +
        `- Tribunal: ${tribunalLabel} (${res.orgaoJulgador || 'Órgão não especificado'})\n` +
        `- Classe Processual: ${res.classe || 'Não informada'}\n` +
        `- Assuntos: ${res.assuntos.length > 0 ? res.assuntos.join(', ') : 'Não informados'}\n` +
        `- Grau: ${res.grau || '1º Grau'}\n` +
        `- Data de Ajuizamento: ${res.dataAjuizamento || 'Não informada'}\n\n` +
        `Últimos andamentos, do MAIS RECENTE para o mais antigo (datas AAAA-MM-DD; repita-as exatamente, sem deduzir datas que não estão aqui):\n${movimentosResumo || 'Nenhuma movimentação detalhada encontrada.'}`
      );
    } catch (error) {
      return `Erro ao consultar o DataJud: ${(error as Error).message}`;
    }
  },
  {
    name: 'consultar_processo_datajud',
    description:
      'Consulta a API pública oficial do DataJud (CNJ) por número de processo com 20 dígitos para obter classe, órgão julgador, assuntos e andamentos judiciais recentes.',
    schema: z.object({
      numeroProcesso: z.string().describe('Número do processo CNJ com ou sem pontuação (ex: 1000123-45.2023.8.26.0100)')
    })
  }
);

/**
 * 2. Ferramenta para analisar riscos patrimoniais, penhoras, Sisbajud e constrições.
 */
export const analisarRiscoPenhoraTool = tool(
  async ({ textoOuAndamentos }) => {
    const texto = textoOuAndamentos.toLowerCase();
    const riscosDetectados: string[] = [];
    const recomendacoes: string[] = [];

    // Detecção de termos críticos
    if (/sisbajud|bacenjud|bloqueio de ativos|bloqueio de conta|indisponibilidade financeira/.test(texto)) {
      riscosDetectados.push('BLOQUEIO FINANCEIRO / SISBAJUD: Ordem judicial para penhora de saldo em contas bancárias ou aplicações financeiras.');
      recomendacoes.push('Verificar se houve retenção de valores de natureza alimentar (salários, aposentadoria ou reserva de até 40 salários mínimos), o que viabiliza pedido imediato de liberação por impenhorabilidade (art. 833, IV e X, do CPC).');
    }

    if (/renajud|ve[ií]culo|bloqueio de circula[cç][aã]o|penhora de autom[oó]vel/.test(texto)) {
      riscosDetectados.push('CONSTRIÇÃO DE VEÍCULO / RENAJUD: Inclusão de restrição de transferência ou circulação de veículos registrados no CPF.');
      recomendacoes.push('Avaliar se o veículo é essencial para a atividade profissional ou subsistência da família para requerer substituição de penhora.');
    }

    if (/mandado de penhora e avalia[cç][aã]o|auto de penhora|oficial de justi[cç]a/.test(texto)) {
      riscosDetectados.push('DILIGÊNCIA DE PENHORA PRESENCIAL: Oficial de justiça encarregado de penhorar bens materiais e imóveis.');
      recomendacoes.push('Conferir bens da residência que se enquadram na proteção do Bem de Família (Lei 8.009/90) e impugnar eventual excesso.');
    }

    if (/leil[aã]o|pra[cç]a|arremata[cç][aã]o|avalia[cç][aã]o de bem/.test(texto)) {
      riscosDetectados.push('FASE DE EXPROPRIAÇÃO / LEILÃO: O bem penhorado está próximo de ser levado a praça ou leilão público.');
      recomendacoes.push('Intervir com urgência para impugnar o laudo de avaliação, alegar preço vil ou nulidade de intimação para suspender o leilão.');
    }

    if (/art\.?\s*523|cumprimento de senten[cç]a|intima[cç][aã]o para pagamento|multa de 10%/.test(texto)) {
      riscosDetectados.push('CUMPRIMENTO DE SENTENÇA INICIADO: Prazo para pagamento voluntário ou incidência de multa de 10% e honorários de 10%.');
      recomendacoes.push('Apresentar Impugnação ao Cumprimento de Sentença (art. 525 CPC) alegando excesso de execução, erro de cálculo ou prescrição intercorrente.');
    }

    if (/desconsidera[cç][aã]o da personalidade jur[ií]dica|idpj/.test(texto)) {
      riscosDetectados.push('DESCONSIDERAÇÃO DA PERSONALIDADE JURÍDICA: Dívidas da empresa estão sendo direcionadas ao patrimônio pessoal dos sócios.');
      recomendacoes.push('Contestar a desconsideração comprovando a ausência de fraude, desvio de finalidade ou confusão patrimonial (art. 50 do Código Civil).');
    }

    if (/sal[aá]rio|remunera[cç][aã]o|proventos|aposentadoria|poupan[cç]a/.test(texto)) {
      riscosDetectados.push('PENHORA DE SALÁRIO OU PROVENTOS: Análise de impenhorabilidade de verbas alimentares.');
      recomendacoes.push('Em regra geral, salário, proventos de aposentadoria e quantias até 40 salários mínimos em poupança são impenhoráveis (art. 833, IV e X, do CPC). Exceções legais: dívida de pensão alimentícia ou valores que excedam 50 salários mínimos mensais (o STJ também admite mitigação excepcional caso seja preservada a subsistência digna do devedor e sua família).');
    }

    const nivelRisco = riscosDetectados.length >= 2 ? 'CRÍTICO / URGENTE' : riscosDetectados.length === 1 ? 'ALTO / ATENÇÃO' : 'MODERADO / INFORMATIVO';

    return (
      `=== DIAGNÓSTICO DE RISCO PATRIMONIAL E PENHORAS ===\n` +
      `Grau de Severidade: ${nivelRisco}\n\n` +
      `Alertas Detectados:\n` +
      (riscosDetectados.length > 0
        ? riscosDetectados.map((r, i) => `${i + 1}. ${r}`).join('\n')
        : 'Nenhuma ordem de bloqueio ou penhora agressiva identificada explicitamente nos andamentos analisados.') +
      `\n\nEstratégias de Blindagem e Defesa Recomendadas:\n` +
      (recomendacoes.length > 0
        ? recomendacoes.map((rec, i) => `${i + 1}. ${rec}`).join('\n')
        : 'Manter monitoramento contínuo dos andamentos para antecipar qualquer despacho que determine intimação para pagamento ou penhora.')
    );
  },
  {
    name: 'analisar_risco_penhora_e_bloqueio',
    description:
      'Analisa ordens de penhora, bloqueio financeiro no Sisbajud, restrição veicular (Renajud), leilão OU dúvidas sobre penhorabilidade de salário, aposentadoria e contas bancárias, gerando diagnóstico de risco patrimonial, fundamentação legal (art. 833 CPC) e defesas.',
    schema: z.object({
      textoOuAndamentos: z.string().describe('Texto do andamento OU pergunta/dúvida do usuário sobre penhora, bloqueio de bens, salário ou Sisbajud.')
    })
  }
);

/**
 * 3. Ferramenta para explicar termos jurídicos processuais em linguagem humana e clara.
 */
export const explicarTermoJuridicoTool = tool(
  async ({ termo }) => {
    // sem acento: "trânsito em julgado" precisa casar com a chave 'transito em julgado'
    const termoLower = termo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

    const glossario: Record<string, { explicacao: string; impacto: string }> = {
      'concluso para despacho': {
        explicacao: 'O processo foi enviado para a mesa do juiz para que ele tome uma decisão ou dê uma ordem sobre o andamento.',
        impacto: 'Geralmente não significa que você perdeu nada. É apenas o momento em que o juiz vai ler a petição mais recente e decidir o próximo passo.'
      },
      'concluso para julgamento': {
        explicacao: 'O processo está pronto para a decisão final (sentença) do juiz.',
        impacto: 'Momento decisivo da primeira instância. Após a sentença, abre-se prazo para recurso.'
      },
      'expedido mandado de penhora e avaliacao': {
        explicacao: 'O juiz determinou que um oficial de justiça vá avaliar e penhorar bens para garantir a dívida cobrada.',
        impacto: 'Exige atuação jurídica rápida para resguardar bens impenhoráveis (como bem de família e itens de subsistência).'
      },
      'transito em julgado': {
        explicacao: 'A decisão se tornou definitiva e não cabe mais nenhum recurso comum.',
        impacto: 'O que foi decidido pelo tribunal se torna imutável e a fase de cobrança/execução se inicia de forma definitiva.'
      },
      'excecao de pre-executividade': {
        explicacao: 'É uma defesa rápida na execução onde se alega matéria de ordem pública (como prescrição da dívida ou falta de citação válida) sem precisar garantir o juízo com dinheiro.',
        impacto: 'Excelente instrumento de blindagem processual pois não exige garantia de penhora prévia.'
      },
      'embargos a execucao': {
        explicacao: 'Ação autônoma do devedor para se defender de uma execução de título extrajudicial (como contratos de empréstimo ou cheques).',
        impacto: 'Permite discutir juros abusivos, excesso de execução e nulidades contratuais.'
      },
      'impugnacao ao cumprimento de sentenca': {
        explicacao: 'Defesa apresentada após ser condenado num processo de conhecimento, contestando cálculos, nulidade ou ilegitimidade.',
        impacto: 'Impede cobranças indevidas de valores superiores ao que a sentença determinou.'
      },
      'sisbajud': {
        explicacao: 'Sistema eletrônico que interliga a Justiça ao Banco Central para rastreamento e bloqueio automatizado de dinheiro em contas correntes e investimentos.',
        impacto: 'Caso atinja valores impenhoráveis (salários, proventos, quantia até 40 salários mínimos em caderneta de poupança), cabe pedido de desbloqueio urgente.'
      },
      'hasta publica': {
        explicacao: 'É o leilão judicial: o bem penhorado (imóvel, veículo etc.) é oferecido publicamente para pagar a dívida do processo.',
        impacto: 'Situação URGENTE, mas não definitiva: ainda é possível pagar ou parcelar a dívida, alegar bem de família (Lei 8.009/90) ou nulidades antes da arrematação. Procure o advogado imediatamente.'
      },
      'leilao': {
        explicacao: 'Venda pública de um bem penhorado, determinada pelo juiz, para pagar a dívida cobrada no processo (arts. 879 a 903 do CPC).',
        impacto: 'Situação URGENTE, mas ainda reversível até a arrematação: pagamento, acordo, bem de família e nulidades podem suspender o leilão. Procure o advogado imediatamente.'
      },
      'renajud': {
        explicacao: 'Sistema que liga a Justiça ao Detran para registrar restrição sobre veículos do devedor (impedir venda, licenciamento ou circulação).',
        impacto: 'O veículo pode ser depois penhorado. Cabe defesa se for instrumento de trabalho (art. 833, V do CPC) ou se houver excesso de penhora.'
      },
      'penhora': {
        explicacao: 'Ato do juiz que separa bens ou valores do devedor para garantir o pagamento da dívida.',
        impacto: 'Salário, aposentadoria e poupança até 40 salários mínimos são, em regra, impenhoráveis (art. 833 do CPC), salvo dívida de pensão alimentícia ou ganhos acima de 50 salários mínimos.'
      },
      'liminar': {
        explicacao: 'Decisão rápida e provisória do juiz, dada antes do fim do processo, para evitar um prejuízo urgente (tutela de urgência, art. 300 do CPC).',
        impacto: 'Vale de imediato, mas pode ser revista depois. Contra ela cabe agravo de instrumento.'
      },
      'citacao': {
        explicacao: 'É o aviso oficial de que existe um processo contra a pessoa, chamando-a para se defender.',
        impacto: 'A partir dela começam a correr prazos importantes (como o de contestação). Não ignore: procure um advogado.'
      },
      'intimacao': {
        explicacao: 'Comunicação oficial da Justiça sobre um ato do processo (decisão, audiência, prazo para fazer algo).',
        impacto: 'Em processo cível, intimação não é ordem de prisão (a única prisão civil possível é por dívida de pensão alimentícia). Pode abrir prazo, então mostre ao advogado.'
      },
      'precatorio': {
        explicacao: 'Ordem de pagamento de dívida do governo (União, Estado ou Município) reconhecida pela Justiça.',
        impacto: 'O pagamento segue uma fila anual definida pela Constituição (art. 100) e pode levar anos; idosos e doentes graves têm prioridade.'
      },
      'gratuidade da justica': {
        explicacao: 'O juiz isentou a parte de pagar custas e despesas do processo por não ter condições financeiras (art. 98 do CPC).',
        impacto: 'É uma decisão positiva: o processo segue sem custos para quem recebeu o benefício.'
      }
    };

    // Busca exata ou por palavra-chave
    for (const [key, val] of Object.entries(glossario)) {
      if (termoLower.includes(key) || (termoLower.length >= 4 && key.includes(termoLower))) {
        return (
          `Termo Jurídico: "${termo}"\n` +
          `- Significado Prático: ${val.explicacao}\n` +
          `- Impacto para o Cliente: ${val.impacto}`
        );
      }
    }

    return (
      `Termo Jurídico: "${termo}"\n` +
      `Termo fora do glossário interno. Explique com base no seu conhecimento do CPC, em linguagem simples, sem presumir que seja um ato de rotina; se puder gerar prazo ou risco ao patrimônio, recomende falar com o advogado.`
    );
  },
  {
    name: 'explicar_termo_juridico',
    description:
      'Explica termos do direito processual (ex: concluso para despacho, trânsito em julgado, mandado de penhora, exceção de pré-executividade, Sisbajud) em linguagem simples e orientada ao cliente.',
    schema: z.object({
      termo: z.string().describe('O termo ou expressão jurídica cujo significado se deseja decodificar.')
    })
  }
);

/**
 * 4. Ferramenta para cálculo e orientação sobre prazos processuais típicos do CPC.
 */
export const calcularPrazoProcessualTool = tool(
  async ({ tipoAto }) => {
    const ato = tipoAto.toLowerCase();

    let prazoDiasUteis = 15;
    let baseLegal = 'Art. 219 e 335 do CPC';
    let descricao = 'Prazo padrão geral para grande parte dos atos no Código de Processo Civil.';

    if (/contest|resposta do r[eé]u/.test(ato)) {
      prazoDiasUteis = 15;
      baseLegal = 'Art. 335 do CPC';
      descricao = 'Prazo para apresentação de Contestação a partir da audiência de conciliação ou juntada do mandado de citação.';
    } else if (/embargos de declara[cç][aã]o/.test(ato)) {
      prazoDiasUteis = 5;
      baseLegal = 'Art. 1.023 do CPC';
      descricao = 'Prazo para opor Embargos de Declaração contra decisão omissa, contraditória ou obscura.';
    } else if (/agravo de instrumento|apela[cç][aã]o|recurso/.test(ato)) {
      prazoDiasUteis = 15;
      baseLegal = 'Art. 1.003, § 5º do CPC';
      descricao = 'Prazo para interposição da maioria dos recursos cíveis (exceto Embargos de Declaração).';
    } else if (/pagamento volunt[aá]rio|art\.?\s*523/.test(ato)) {
      prazoDiasUteis = 15;
      baseLegal = 'Art. 523 do CPC';
      descricao = 'Prazo para pagamento voluntário da condenação sem aplicação de multa de 10% e honorários de 10%. Após os 15 dias, iniciam-se mais 15 dias para Impugnação.';
    } else if (/juiz|magistrad|despacho|excesso de prazo|demora|concluso|atraso/.test(ato)) {
      prazoDiasUteis = 5;
      baseLegal = 'Art. 226 e Art. 235 do CPC';
      descricao =
        'Prazos do juiz: 5 dias úteis para despachos, 10 dias úteis para decisões interlocutórias e 30 dias úteis para sentenças (art. 226 do CPC). ' +
        'Havendo excesso de prazo injustificado (como 90 dias concluso para despacho), a parte pode peticionar requerendo providências de impulso oficial ao juízo e, persistindo a omissão após 10 dias, representar ao corregedor do tribunal ou ao Conselho Nacional de Justiça (CNJ) por excesso de prazo, nos termos expressos do art. 235 do CPC.';
    } else if (/embargos [aà] execu[cç][aã]o/.test(ato)) {
      prazoDiasUteis = 15;
      baseLegal = 'Art. 915 do CPC';
      descricao = 'Prazo para ajuizar Embargos à Execução de Título Extrajudicial a contar da juntada do comprovante da citação.';
    }

    return (
      `=== ORIENTAÇÃO DE PRAZO PROCESSUAL (CPC/15) ===\n` +
      `- Ato: ${tipoAto}\n` +
      `- Prazo Legal: ${prazoDiasUteis} dias ÚTEIS\n` +
      `- Fundamento: ${baseLegal}\n` +
      `- Detalhes: ${descricao}\n` +
      `Importante: A contagem no processo civil brasileiro se dá exclusivamente em dias úteis (excluem-se fins de semana e feriados forenses).`
    );
  },
  {
    name: 'calcular_prazo_processual',
    description:
      'Informa prazos legais em dias úteis do CPC (contestações, recursos, embargos, art. 523) E regras de excesso de prazo do magistrado / demora processual / processo concluso há muitos dias (arts. 226 e 235 do CPC). OBRIGATÓRIA para dúvidas de prazos, atraso do processo ou concluso há dias.',
    schema: z.object({
      tipoAto: z.string().describe('O tipo de ato ou manifestação processual (ex: contestação, apelação, pagamento art. 523, excesso de prazo / conclusos para despacho)')
    })
  }
);

/**
 * 5. Ferramenta de RAG para busca semântica em petições, sentenças, decisões e autos processuais.
 */
export const buscarTrechosDocumentosProcessoTool = tool(
  async ({ numeroProcesso, termoOuPergunta }) => {
    try {
      const digits = cleanDigits(numeroProcesso);
      const cnjFormatado = digits.length === 20 ? formatProcessNumber(digits) : numeroProcesso;
      const trechos = await buscarTrechosProcessuais({
        numeroCnj: digits.length === 20 ? digits : numeroProcesso,
        query: termoOuPergunta,
        limite: 3
      });

      if (trechos.length === 0) {
        return `Nenhum trecho de documento ou decisão encontrado especificamente para a busca "${termoOuPergunta}" no processo ${cnjFormatado}.`;
      }

      const formatados = trechos
        .map(
          (t, i) =>
            `[Trecho ${i + 1} - ${t.tipoDocumento.toUpperCase()} - ${t.titulo}]\n${t.conteudoTexto}`
        )
        .join('\n\n---\n\n');

      return `Trechos localizados nos autos do processo ${cnjFormatado} sobre "${termoOuPergunta}":\n\n${formatados}`;
    } catch (err) {
      return `Erro ao consultar documentos do processo: ${(err as Error).message}`;
    }
  },
  {
    name: 'buscar_trechos_documentos_processo',
    description:
      'Realiza busca semântica (RAG) na íntegra de petições, sentenças, decisões judiciais e intimações indexadas do processo para responder a dúvidas sobre valores, cláusulas, liminares e determinações do juiz.',
    schema: z.object({
      numeroProcesso: z.string().describe('Número CNJ do processo (com ou sem pontuação)'),
      termoOuPergunta: z.string().describe('O termo, pergunta ou assunto a ser pesquisado nos autos (ex: valor da condenação, tutela de urgência deferida, gratuidade da justiça)')
    })
  }
);
