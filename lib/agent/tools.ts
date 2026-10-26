import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { cleanDigits } from '@/lib/format';
import { parseCnj, formatProcessNumber } from '@/lib/cnj';
import { consultarDataJud } from '@/lib/datajud';
import { buscarTrechosProcessuais } from '@/lib/ragDocumentos';

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
      const res = await consultarDataJud(tribunalLabel, digits);

      if (!res) {
        return (
          `Processo ${formatProcessNumber(digits)} identificado no tribunal ${tribunalLabel}.\n` +
          `No momento a consulta direta ao DataJud não retornou novos andamentos (pode estar sem chave DATAJUD_API_KEY ou tribunal indisponível na API pública CNJ).`
        );
      }

      const movimentosResumo = res.movimentos.slice(0, 5).map(m => `- [${m.data}] ${m.titulo}: ${m.descricao}`).join('\n');

      return (
        `Dados obtidos do DataJud para o processo ${formatProcessNumber(digits)}:\n` +
        `- Tribunal: ${tribunalLabel} (${res.orgaoJulgador || 'Órgão não especificado'})\n` +
        `- Classe Processual: ${res.classe || 'Não informada'}\n` +
        `- Assuntos: ${res.assuntos.length > 0 ? res.assuntos.join(', ') : 'Não informados'}\n` +
        `- Grau: ${res.grau || '1º Grau'}\n` +
        `- Data de Ajuizamento: ${res.dataAjuizamento || 'Não informada'}\n\n` +
        `Últimos andamentos judiciais registrados:\n${movimentosResumo || 'Nenhuma movimentação detalhada encontrada.'}`
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
      'Analisa movimentações judiciais em busca de ordens de penhora, bloqueio financeiro no Sisbajud, constrição de veículos (Renajud), leilão ou execução forçada, gerando diagnóstico de risco patrimonial e linhas de defesa.',
    schema: z.object({
      textoOuAndamentos: z.string().describe('Texto do andamento, despacho ou resumo dos processos para identificação de ameaças patrimoniais.')
    })
  }
);

/**
 * 3. Ferramenta para explicar termos jurídicos processuais em linguagem humana e clara.
 */
export const explicarTermoJuridicoTool = tool(
  async ({ termo }) => {
    const termoLower = termo.toLowerCase().trim();

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
      }
    };

    // Busca exata ou por palavra-chave
    for (const [key, val] of Object.entries(glossario)) {
      if (termoLower.includes(key) || key.includes(termoLower)) {
        return (
          `Termo Jurídico: "${termo}"\n` +
          `- Significado Prático: ${val.explicacao}\n` +
          `- Impacto para o Cliente: ${val.impacto}`
        );
      }
    }

    return (
      `Termo Jurídico: "${termo}"\n` +
      `Este é um ato formal do procedimento judicial. Em linhas gerais, faz parte da tramitação regular dos autos entre as partes e a secretaria da vara. Se estiver atrelado a prazo com intimação, deve ser respondido no prazo legal pelo advogado responsável.`
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
      'Informa os prazos legais em dias úteis do Código de Processo Civil (CPC) para contestações, recursos, embargos e pagamento voluntário.',
    schema: z.object({
      tipoAto: z.string().describe('O tipo de ato ou manifestação processual (ex: contestação, apelação, pagamento art. 523, embargos à execução)')
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
