/**
 * Interpretação do envelope de resposta da Infosimples ({ code, code_message, errors, data }).
 * Só o código 200 é sucesso; qualquer outro código é "sem resultado" (a fonte respondeu que não há
 * processo) ou erro de verdade (parâmetro recusado, saldo, captcha, fonte fora do ar...). A tela
 * precisa distinguir os dois: tratar erro como "sem processos" esconde por que o processo não aparece.
 */
export interface DesfechoInfosimples {
  /** Preenchido só quando a fonte FALHOU (não quando apenas não achou processo). */
  erro?: string;
  codigo?: number;
}

const MENSAGEM_SEM_RESULTADO = /n[aã]o (foi|foram)? ?(encontrad|localizad)|nenhum|sem resultado|inexistente/i;

export function desfechoInfosimples(result: any): DesfechoInfosimples {
  if (!result) {
    return { erro: 'Sem resposta da Infosimples (falha de rede ou tempo esgotado).' };
  }
  if (result.code === 200) return {};

  const mensagem = [result.code_message, ...(Array.isArray(result.errors) ? result.errors : [])]
    .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    .join(' — ');
  if (MENSAGEM_SEM_RESULTADO.test(mensagem)) return {};

  const codigo = typeof result.code === 'number' ? result.code : undefined;
  return { erro: mensagem || `Resposta inesperada da Infosimples${codigo ? ` (código ${codigo})` : ''}.`, codigo };
}
