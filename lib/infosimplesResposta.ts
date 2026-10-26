/**
 * Interpretação do envelope de resposta da Infosimples ({ code, code_message, errors, data }).
 * Só o código 200 é sucesso; qualquer outro código é "sem resultado" (a fonte respondeu que não há
 * processo) ou erro de verdade (parâmetro recusado, saldo, captcha, fonte fora do ar...). A tela
 * precisa distinguir os dois: tratar erro como "sem processos" esconde por que o processo não aparece.
 *
 * Em caso de erro há duas mensagens: `erro`, em linguagem simples para qualquer usuário (o que houve e
 * o que fazer, sem códigos), e `erroTecnico`, que diz ONDE falhou (JusConsulta, rede, Infosimples ou site do
 * tribunal) com o detalhe original (mensagem, código, tempo gasto e nº de tentativas) para logs e suporte.
 */
export type OrigemFalha = 'jusconsulta' | 'rede' | 'infosimples' | 'tribunal';

export interface DesfechoInfosimples {
  /** Preenchido só quando a fonte FALHOU (não quando apenas não achou processo). Texto para leigos. */
  erro?: string;
  /** Mesma falha com causa técnica, mensagem original, código, tempo e tentativas (logs e tooltip). */
  erroTecnico?: string;
  codigo?: number;
  origem?: OrigemFalha;
  /** Rótulo curto da causa (ex.: "Site do tribunal fora do ar"). */
  categoria?: string;
}

const MENSAGEM_SEM_RESULTADO =
  /n[aã]o (foi|foram)? ?(encontrad|localizad)|nenhum|sem resultado|inexistente|n[aã]o existem informa[cç][oõ]es dispon[ií]veis|n[aã]o retornou dados/i;

interface Causa {
  origem: OrigemFalha;
  categoria: string;
  explicacao: string;
  /** O que aconteceu e o que fazer, sem termos técnicos (é o que aparece na tela). */
  leigo: string;
}

/** Falhas geradas pelo próprio JusConsulta (lib/infosimplesClient.ts marca com `_motivo`). */
const CAUSAS_LOCAIS: Record<string, Causa> = {
  circuito_aberto: {
    origem: 'jusconsulta',
    categoria: 'Fonte pausada pelo JusConsulta',
    explicacao: 'a fonte falhou várias vezes seguidas e foi pausada por alguns minutos para não gastar tempo nem dinheiro à toa',
    leigo: 'Este tribunal falhou várias vezes seguidas, então pausamos a busca nele por alguns minutos. Tente de novo em alguns minutos.'
  },
  timeout_local: {
    origem: 'jusconsulta',
    categoria: 'Tempo limite do JusConsulta',
    explicacao: 'a Infosimples não respondeu dentro do prazo e o JusConsulta desistiu da chamada',
    leigo: 'O tribunal demorou demais para responder e paramos de esperar. Tente de novo mais tarde.'
  },
  rede: {
    origem: 'rede',
    categoria: 'Falha de rede',
    explicacao: 'o servidor do JusConsulta não conseguiu se conectar à Infosimples (DNS, internet ou conexão recusada)',
    leigo: 'Não conseguimos nos conectar ao serviço de consulta agora. Tente de novo em alguns minutos.'
  },
  resposta_invalida: {
    origem: 'infosimples',
    categoria: 'Resposta inválida da Infosimples',
    explicacao: 'a API respondeu em um formato inesperado',
    leigo: 'Recebemos uma resposta do tribunal que não conseguimos ler. Tente de novo em alguns minutos.'
  },
  cancelado: {
    origem: 'jusconsulta',
    categoria: 'Cancelada',
    explicacao: 'a consulta foi cancelada pelo usuário',
    leigo: 'Você cancelou a busca neste tribunal.'
  }
};

/** Causas reconhecidas pelo texto da mensagem da Infosimples (a ordem importa: a primeira que casar vence). */
const CAUSAS_POR_MENSAGEM: [RegExp, Causa][] = [
  [
    /token|autentica|n[aã]o autorizad|permiss/i,
    {
      origem: 'infosimples',
      categoria: 'Token sem acesso',
      explicacao: 'token da Infosimples inválido ou sem permissão para este serviço; confira o token e os serviços contratados',
      leigo: 'Tivemos um problema no nosso acesso a este tribunal. Não tem relação com os dados que você informou. Tente de novo mais tarde.'
    }
  ],
  [
    /saldo|cr[eé]dito|limite de consumo|pagamento|fatura|plano/i,
    {
      origem: 'infosimples',
      categoria: 'Sem saldo na Infosimples',
      explicacao: 'a conta está sem saldo ou atingiu o limite de consumo',
      leigo: 'Nosso serviço de consulta está temporariamente indisponível para este tribunal. Tente de novo mais tarde.'
    }
  ],
  [
    /muitas requisi|limite de requisi|too many|rate limit|simult[aâ]ne/i,
    {
      origem: 'infosimples',
      categoria: 'Limite de requisições',
      explicacao: 'a Infosimples recusou por excesso de consultas simultâneas',
      leigo: 'Muitas buscas ao mesmo tempo. Tente de novo em alguns minutos.'
    }
  ],
  [
    /captcha/i,
    {
      origem: 'tribunal',
      categoria: 'Captcha do tribunal',
      explicacao: 'o site do tribunal exigiu captcha e o robô não conseguiu resolver; costuma passar ao tentar de novo',
      leigo: 'O site do tribunal pediu uma verificação de segurança ("não sou um robô") que não conseguimos passar. Costuma funcionar ao tentar de novo.'
    }
  ],
  [
    /bloque|acesso negado|forbidden|\b403\b/i,
    {
      origem: 'tribunal',
      categoria: 'Acesso bloqueado',
      explicacao: 'o site do tribunal bloqueou o acesso do robô da Infosimples',
      leigo: 'O site do tribunal bloqueou a nossa consulta desta vez. Tente de novo mais tarde.'
    }
  ],
  [
    /tempo limite|timeout|demor|excede.{0,10}tempo/i,
    {
      origem: 'tribunal',
      categoria: 'Tribunal lento',
      explicacao: 'o site do tribunal demorou mais que o limite e o robô da Infosimples desistiu',
      leigo: 'O site do tribunal demorou demais para responder. Tente de novo mais tarde.'
    }
  ],
  [
    /tentativas.{0,40}excedid|site ou aplicativo de origem/i,
    {
      origem: 'tribunal',
      categoria: 'Site do tribunal não respondeu',
      explicacao: 'o robô tentou acessar o site do tribunal algumas vezes e não teve resposta',
      leigo: 'Tentamos acessar o site do tribunal algumas vezes, mas ele não respondeu. Ele pode estar fora do ar ou lento. Tente de novo mais tarde.'
    }
  ],
  [
    /indispon|fora do ar|instabilidade|inst[aá]vel|manuten|n[aã]o respond|parece estar/i,
    {
      origem: 'tribunal',
      categoria: 'Site do tribunal fora do ar',
      explicacao: 'o site de origem do tribunal está indisponível ou instável',
      leigo: 'O site do tribunal está fora do ar ou instável agora. Tente de novo mais tarde.'
    }
  ],
  [
    /par[aâ]metro|inv[aá]lid|obrigat[oó]ri|formato/i,
    {
      origem: 'infosimples',
      categoria: 'Parâmetro recusado',
      explicacao: 'o serviço não aceitou o CPF/CNPJ/nome no formato enviado',
      leigo: 'O tribunal não aceitou os dados da busca. Confira o CPF, CNPJ ou nome informado.'
    }
  ]
];

function causaPorCodigo(codigo: number | undefined): Causa {
  if (codigo && codigo >= 600) {
    return {
      origem: 'infosimples',
      categoria: 'Erro no robô da Infosimples',
      explicacao: 'o robô falhou ao consultar o site do tribunal',
      leigo: 'Não conseguimos consultar o site do tribunal desta vez. Tente de novo em alguns minutos.'
    };
  }
  if (codigo && codigo >= 500) {
    return {
      origem: 'infosimples',
      categoria: 'Instabilidade na Infosimples',
      explicacao: 'a API da Infosimples respondeu com erro interno',
      leigo: 'Nosso serviço de consulta teve uma instabilidade. Tente de novo em alguns minutos.'
    };
  }
  return {
    origem: 'infosimples',
    categoria: 'Erro não classificado',
    explicacao: 'a Infosimples devolveu um erro sem causa reconhecida',
    leigo: 'Não foi possível consultar este tribunal agora. Tente de novo em alguns minutos.'
  };
}

function segundos(ms: unknown): string | null {
  return typeof ms === 'number' && ms > 0 ? `${(ms / 1000).toFixed(1).replace('.', ',')}s` : null;
}

export function desfechoInfosimples(result: any): DesfechoInfosimples {
  if (!result) {
    return {
      erro: CAUSAS_LOCAIS.rede.leigo,
      erroTecnico: 'Falha de rede: o JusConsulta não recebeu resposta nenhuma da Infosimples.',
      origem: 'rede',
      categoria: 'Falha de rede'
    };
  }
  if (result.code === 200) return {};

  const mensagem = [result.code_message, ...(Array.isArray(result.errors) ? result.errors : [])]
    .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    .join(' — ');
  // Falha local (circuito, timeout, rede...) é sempre erro, mesmo que o texto lembre "não encontrado".
  const falhaLocal = result._motivo && result._motivo !== 'cache_negativo';
  if (!falhaLocal && MENSAGEM_SEM_RESULTADO.test(mensagem)) return {};

  const codigo = typeof result.code === 'number' ? result.code : undefined;
  const causa =
    (result._motivo && CAUSAS_LOCAIS[result._motivo]) ||
    CAUSAS_POR_MENSAGEM.find(([re]) => re.test(mensagem))?.[1] ||
    causaPorCodigo(codigo);

  const detalhe = [
    codigo !== undefined ? `código ${codigo}` : null,
    segundos(result._duracaoMs) ? `após ${segundos(result._duracaoMs)}` : null,
    typeof result._tentativas === 'number' && result._tentativas > 1 ? `${result._tentativas} tentativas` : null
  ]
    .filter(Boolean)
    .join(' · ');

  const erroTecnico = `${causa.categoria}: ${causa.explicacao}.${mensagem ? ` Mensagem: "${mensagem}"` : ''}${detalhe ? ` (${detalhe})` : ''}`;
  return { erro: causa.leigo, erroTecnico, codigo, origem: causa.origem, categoria: causa.categoria };
}
