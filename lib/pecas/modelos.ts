import type { CampoEntrada, ModeloPeca, TipoPecaId } from './tipos';

/**
 * Catálogo editável dos modelos de peça (máximo de 8). Para ajustar um tipo, mude aqui: estrutura de seções,
 * campos guiados, orientações enviadas ao modelo, limite de tokens e faixa de tamanho usada na avaliação.
 *
 * Regra: os campos descrevem DADOS que o advogado informa. O modelo nunca completa o que faltar; escreve
 * `[PREENCHER: ...]` (ver lib/pecas/geracao.ts).
 */

const dadosAdvogado: CampoEntrada = {
  id: 'advogado',
  rotulo: 'Advogado(a) que assina',
  ajuda: 'Nome e OAB para o fecho. Se ficar em branco, a minuta traz um campo a preencher.',
  placeholder: 'Nome completo, OAB/UF e número',
  tipo: 'texto'
};

const partes: CampoEntrada = {
  id: 'partes',
  rotulo: 'Partes e qualificação',
  ajuda: 'Quem você representa e a parte contrária, com os dados que quiser que apareçam (nome, CPF/CNPJ, endereço).',
  placeholder: 'Ex.: Representado: Maria Souza, brasileira... / Parte contrária: Empresa X Ltda.',
  tipo: 'area',
  obrigatorio: true
};

const pedidos = (ajuda: string): CampoEntrada => ({
  id: 'pedidos',
  rotulo: 'Pedidos',
  ajuda,
  tipo: 'area'
});

export const MODELOS_PECAS: ModeloPeca[] = [
  {
    id: 'contestacao',
    nome: 'Contestação',
    descricao: 'Resposta do réu à petição inicial, com preliminares, mérito, provas e pedidos.',
    icone: 'ShieldCheck',
    secoes: ['Endereçamento', 'Qualificação e introdução', 'Síntese da inicial', 'Preliminares', 'Mérito', 'Provas', 'Pedidos', 'Fecho'],
    campos: [
      partes,
      { id: 'sinteseInicial', rotulo: 'O que o autor alega na inicial', tipo: 'area', obrigatorio: true, placeholder: 'Resuma os fatos e pedidos da inicial.' },
      { id: 'fatos', rotulo: 'Fatos e versão do réu', tipo: 'area', obrigatorio: true, placeholder: 'O que de fato aconteceu, na visão de quem você representa.' },
      { id: 'preliminares', rotulo: 'Preliminares que pretende arguir', ajuda: 'Ex.: ilegitimidade, incompetência, inépcia, prescrição. Opcional.', tipo: 'area' },
      { id: 'teses', rotulo: 'Teses de mérito', ajuda: 'Os argumentos principais da defesa.', tipo: 'area' },
      { id: 'provas', rotulo: 'Provas que pretende produzir', tipo: 'area' },
      pedidos('Se ficar em branco, a minuta traz os pedidos usuais de uma contestação.'),
      dadosAdvogado
    ],
    orientacoes: [
      'Peça do RÉU. Impugne especificadamente os fatos da inicial (ônus da impugnação especificada); não use contestação por negativa geral.',
      'Preliminares só as informadas pelo advogado ou as que decorram claramente dos fatos informados; se não houver, escreva "Não há preliminares a arguir." ou `[PREENCHER: preliminares, se houver]`.',
      'O mérito segue a versão do réu informada. Não crie fatos, documentos ou testemunhas.',
      'Pedidos usuais: acolhimento das preliminares, improcedência dos pedidos, condenação do autor em custas e honorários e protesto por provas.'
    ],
    maxTokens: 3500,
    usaJurisprudencia: true,
    processual: true,
    tamanho: { minimo: 2000, maximo: 17000 }
  },
  {
    id: 'replica',
    nome: 'Réplica',
    descricao: 'Manifestação do autor sobre a contestação, impugnando preliminares, documentos e fatos novos.',
    icone: 'Reply',
    secoes: ['Endereçamento', 'Introdução', 'Impugnação à contestação', 'Preliminares da contestação', 'Mérito', 'Provas', 'Pedidos', 'Fecho'],
    campos: [
      partes,
      { id: 'resumoContestacao', rotulo: 'O que a contestação alegou', tipo: 'area', obrigatorio: true },
      { id: 'pontosImpugnar', rotulo: 'Pontos a impugnar', ajuda: 'Preliminares, documentos, fatos novos ou teses da defesa que você quer rebater.', tipo: 'area', obrigatorio: true },
      { id: 'fatos', rotulo: 'Fatos e documentos que sustentam a réplica', tipo: 'area' },
      { id: 'provas', rotulo: 'Provas que pretende produzir', tipo: 'area' },
      pedidos('Se ficar em branco, a minuta traz os pedidos usuais de uma réplica.'),
      dadosAdvogado
    ],
    orientacoes: [
      'Peça do AUTOR em resposta à contestação. Rebata ponto a ponto o que foi informado, sem inventar o que a defesa disse.',
      'Se a contestação trouxe preliminares, trate-as na seção própria; se não houver informação, escreva `[PREENCHER: preliminares da contestação]`.',
      'Reafirme os pedidos da inicial sem criar pedidos novos que o advogado não informou.'
    ],
    maxTokens: 3000,
    usaJurisprudencia: true,
    processual: true,
    tamanho: { minimo: 1400, maximo: 15000 }
  },
  {
    id: 'apelacao',
    nome: 'Apelação',
    descricao: 'Razões de reforma ou anulação da sentença, com tempestividade, preparo e pedidos ao tribunal.',
    icone: 'Scale',
    secoes: ['Endereçamento', 'Qualificação e introdução', 'Tempestividade e preparo', 'Síntese do processo e da sentença', 'Razões de reforma', 'Pedidos', 'Fecho'],
    campos: [
      partes,
      { id: 'sentenca', rotulo: 'Sentença recorrida', ajuda: 'Resumo do que foi decidido (dispositivo) e o fundamento principal.', tipo: 'area', obrigatorio: true },
      { id: 'dataIntimacao', rotulo: 'Data da intimação da sentença', ajuda: 'Usada só para a seção de tempestividade. Em branco, vira campo a preencher.', tipo: 'texto' },
      { id: 'fatos', rotulo: 'Resumo dos fatos e do processo', tipo: 'area', obrigatorio: true },
      { id: 'razoes', rotulo: 'Razões para reformar ou anular', ajuda: 'Os erros que você aponta na sentença.', tipo: 'area', obrigatorio: true },
      pedidos('Ex.: reforma total ou parcial, anulação, inversão da sucumbência. Se em branco, a minuta traz os usuais.'),
      dadosAdvogado
    ],
    orientacoes: [
      'Contenha os requisitos de uma apelação: qualificação das partes, exposição do fato e do direito, razões do pedido de reforma ou de anulação e o pedido de nova decisão.',
      'Tempestividade: use somente a data de intimação informada. Sem ela, a seção deve dizer exatamente "A tempestividade será demonstrada pela data de intimação da sentença: [PREENCHER: data da intimação da sentença]." Nunca afirme que o recurso é tempestivo sem data informada e nunca escreva frases como "a data não foi informada". Sobre o preparo, escreva `[PREENCHER: comprovante de preparo ou pedido de gratuidade]` se nada foi informado.',
      'Endereçamento: ao juízo que proferiu a sentença, com as razões dirigidas ao tribunal competente (sem inventar o nome do tribunal; use o do contexto ou `[PREENCHER: tribunal]`).',
      'Não invente trechos da sentença: referencie só o que o advogado descreveu.'
    ],
    maxTokens: 3500,
    usaJurisprudencia: true,
    processual: true,
    tamanho: { minimo: 2200, maximo: 17000 }
  },
  {
    id: 'agravo_instrumento',
    nome: 'Agravo de instrumento',
    descricao: 'Recurso contra decisão interlocutória, com cabimento, documentos obrigatórios e pedido de efeito suspensivo.',
    icone: 'ArrowUpRight',
    secoes: [
      'Endereçamento',
      'Qualificação e introdução',
      'Cabimento e tempestividade',
      'Documentos obrigatórios',
      'Síntese da decisão agravada',
      'Razões de reforma',
      'Efeito suspensivo ou tutela recursal',
      'Pedidos',
      'Fecho'
    ],
    campos: [
      partes,
      { id: 'decisao', rotulo: 'Decisão agravada', ajuda: 'O que o juiz decidiu e quando (se souber a data).', tipo: 'area', obrigatorio: true },
      { id: 'cabimento', rotulo: 'Hipótese de cabimento', ajuda: 'Em qual hipótese legal você entende cabível o agravo (ex.: tutela provisória). Opcional.', tipo: 'texto' },
      { id: 'dataIntimacao', rotulo: 'Data da intimação da decisão', tipo: 'texto' },
      { id: 'fatos', rotulo: 'Resumo dos fatos e do processo', tipo: 'area', obrigatorio: true },
      { id: 'razoes', rotulo: 'Razões para reformar a decisão', tipo: 'area', obrigatorio: true },
      {
        id: 'efeitoSuspensivo',
        rotulo: 'Pedir efeito suspensivo ou tutela recursal?',
        tipo: 'selecao',
        opcoes: [
          { value: 'nao', label: 'Não' },
          { value: 'sim', label: 'Sim' }
        ]
      },
      { id: 'riscoUrgencia', rotulo: 'Risco de dano e urgência', ajuda: 'Só se pedir efeito suspensivo: qual o perigo de esperar o julgamento.', tipo: 'area' },
      pedidos('Se ficar em branco, a minuta traz os pedidos usuais de um agravo.'),
      dadosAdvogado
    ],
    orientacoes: [
      'Contenha os requisitos de um agravo de instrumento: exposição do fato e do direito, razões do pedido de reforma, pedido, nomes e endereços dos advogados (campos a preencher se faltarem).',
      'Cabimento: justifique pela hipótese informada. Se nenhuma foi informada, escreva `[PREENCHER: hipótese de cabimento do art. do CPC aplicável]` sem inventar.',
      'Tempestividade: com data de intimação informada, use-a; sem ela, escreva `[PREENCHER: data da intimação da decisão]` e não afirme que o recurso é tempestivo.',
      'Documentos obrigatórios: liste de forma genérica (cópia da inicial, da contestação, da petição que ensejou a decisão, da decisão agravada, da certidão de intimação e procurações), e marque `[PREENCHER: confirmar juntada]`; não invente documentos.',
      'Efeito suspensivo ou tutela recursal: só desenvolva se o advogado pediu (campo "sim") e com base no risco informado; se não pediu, escreva "Não se pede efeito suspensivo neste recurso."'
    ],
    maxTokens: 3000,
    usaJurisprudencia: true,
    processual: true,
    tamanho: { minimo: 2200, maximo: 16000 }
  },
  {
    id: 'embargos_declaracao',
    nome: 'Embargos de declaração',
    descricao: 'Pedido de esclarecimento de omissão, contradição, obscuridade ou erro material em decisão.',
    icone: 'FileSearch',
    secoes: ['Endereçamento', 'Introdução e tempestividade', 'Decisão embargada', 'Vício apontado', 'Pedidos', 'Fecho'],
    campos: [
      partes,
      { id: 'decisao', rotulo: 'Decisão embargada', ajuda: 'Resuma o que foi decidido.', tipo: 'area', obrigatorio: true },
      {
        id: 'vicio',
        rotulo: 'Vício',
        tipo: 'selecao',
        obrigatorio: true,
        opcoes: [
          { value: 'omissao', label: 'Omissão' },
          { value: 'contradicao', label: 'Contradição' },
          { value: 'obscuridade', label: 'Obscuridade' },
          { value: 'erro_material', label: 'Erro material' }
        ]
      },
      { id: 'trechoVicio', rotulo: 'Onde está o vício', ajuda: 'Indique o ponto da decisão e o que deveria ter sido apreciado ou esclarecido.', tipo: 'area', obrigatorio: true },
      { id: 'dataIntimacao', rotulo: 'Data da intimação da decisão', tipo: 'texto' },
      pedidos('Se ficar em branco, a minuta pede o suprimento do vício apontado e, se cabível, efeitos infringentes.'),
      dadosAdvogado
    ],
    orientacoes: [
      'Os embargos não rediscutem o mérito: delimite o vício (omissão, contradição, obscuridade ou erro material) informado e peça o suprimento.',
      'Não invente trechos da decisão: use só o que o advogado descreveu. Se o advogado não informou, deixe `[PREENCHER: trecho da decisão]`.',
      'Peça atribuição de efeitos infringentes somente se o advogado informou ou se a correção do vício alterar o resultado na versão informada.'
    ],
    maxTokens: 2000,
    usaJurisprudencia: true,
    processual: true,
    tamanho: { minimo: 1200, maximo: 10000 }
  },
  {
    id: 'manifestacao_intimacao',
    nome: 'Manifestação sobre intimação',
    descricao: 'Resposta a despacho, intimação ou cumprimento de prazo, objetiva e dentro do que foi determinado.',
    icone: 'MessageSquareText',
    secoes: ['Endereçamento', 'Introdução', 'Manifestação', 'Requerimentos', 'Fecho'],
    campos: [
      partes,
      { id: 'intimacao', rotulo: 'O que foi determinado', ajuda: 'Conteúdo da intimação, despacho ou decisão a ser cumprida.', tipo: 'area', obrigatorio: true },
      { id: 'manifestacao', rotulo: 'O que a parte quer dizer ou informar', tipo: 'area', obrigatorio: true },
      { id: 'documentos', rotulo: 'Documentos que acompanham', tipo: 'area' },
      pedidos('Ex.: prosseguimento, expedição de ofício, prazo adicional.'),
      dadosAdvogado
    ],
    orientacoes: [
      'Peça curta e objetiva: responda exatamente ao que foi determinado, sem aproveitar para reabrir discussão não pedida.',
      'Se faltar a informação para cumprir a determinação, escreva `[PREENCHER: ...]` descrevendo o dado.',
      'Não afirme que o prazo foi cumprido ou está em curso; a verificação de prazo é do advogado.'
    ],
    maxTokens: 1500,
    usaJurisprudencia: false,
    processual: true,
    tamanho: { minimo: 700, maximo: 7000 }
  },
  {
    id: 'notificacao_extrajudicial',
    nome: 'Notificação extrajudicial',
    descricao: 'Comunicação formal a uma pessoa ou empresa para cumprir uma obrigação em prazo certo.',
    icone: 'Mail',
    secoes: ['Identificação das partes', 'Dos fatos', 'Da obrigação e do fundamento', 'Prazo para cumprimento', 'Consequências do descumprimento', 'Fecho'],
    campos: [
      { id: 'notificante', rotulo: 'Notificante', ajuda: 'Quem notifica, com qualificação.', tipo: 'area', obrigatorio: true },
      { id: 'notificado', rotulo: 'Notificado', ajuda: 'Quem recebe, com qualificação e endereço, se tiver.', tipo: 'area', obrigatorio: true },
      { id: 'fatos', rotulo: 'Fatos', tipo: 'area', obrigatorio: true },
      { id: 'obrigacao', rotulo: 'O que se exige do notificado', tipo: 'area', obrigatorio: true },
      { id: 'prazo', rotulo: 'Prazo para cumprimento', placeholder: 'Ex.: 10 dias a contar do recebimento', tipo: 'texto' },
      { id: 'consequencias', rotulo: 'Consequências do descumprimento', ajuda: 'Medidas que o notificante pretende adotar.', tipo: 'area' },
      dadosAdvogado
    ],
    orientacoes: [
      'Texto formal e firme, sem ameaças ilícitas nem linguagem ofensiva. Dirija-se diretamente ao notificado.',
      'O prazo deve ser exatamente o informado; sem prazo informado, escreva `[PREENCHER: prazo para cumprimento]`.',
      'Consequências: somente medidas lícitas informadas pelo advogado (ex.: adoção das medidas judiciais cabíveis). Não invente valores de multa, juros ou encargos.'
    ],
    maxTokens: 2000,
    usaJurisprudencia: false,
    processual: false,
    tamanho: { minimo: 1000, maximo: 10000 }
  },
  {
    id: 'peticao_simples',
    nome: 'Petição simples',
    descricao: 'Juntada de documentos, pedido de prazo ou habilitação nos autos.',
    icone: 'FilePlus',
    secoes: ['Endereçamento', 'Introdução', 'Exposição', 'Requerimentos', 'Fecho'],
    campos: [
      partes,
      {
        id: 'finalidade',
        rotulo: 'Finalidade',
        tipo: 'selecao',
        obrigatorio: true,
        opcoes: [
          { value: 'juntada', label: 'Juntada de documentos' },
          { value: 'prazo', label: 'Pedido de prazo' },
          { value: 'habilitacao', label: 'Habilitação nos autos' },
          { value: 'outra', label: 'Outra' }
        ]
      },
      { id: 'detalhes', rotulo: 'Detalhes', ajuda: 'Documentos a juntar, motivo do pedido de prazo, quem será habilitado, etc.', tipo: 'area', obrigatorio: true },
      pedidos('Se ficar em branco, a minuta pede apenas o que decorre da finalidade escolhida.'),
      dadosAdvogado
    ],
    orientacoes: [
      'Peça curta. Não invente o motivo do pedido de prazo, a lista de documentos nem os dados do habilitado: use só o informado e `[PREENCHER: ...]` para o resto.',
      'Em pedido de prazo, não crie justificativa nem prazo; use o que o advogado informou ou `[PREENCHER: prazo requerido]`.',
      'Em habilitação, o último requerimento deve ser exatamente "juntada da procuração: [PREENCHER: confirmar procuração a juntar]". Nunca diga que a procuração está anexa, assinada ou já nos autos.'
    ],
    maxTokens: 1200,
    usaJurisprudencia: false,
    processual: true,
    tamanho: { minimo: 600, maximo: 6000 }
  }
];

if (MODELOS_PECAS.length > 8) throw new Error('O catálogo de peças aceita no máximo 8 modelos.');

const POR_ID = new Map<string, ModeloPeca>(MODELOS_PECAS.map(m => [m.id, m]));

export function obterModelo(id: string | null | undefined): ModeloPeca | null {
  return (id && POR_ID.get(id)) || null;
}

export function tipoPecaValido(id: unknown): id is TipoPecaId {
  return typeof id === 'string' && POR_ID.has(id);
}
