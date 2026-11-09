/**
 * Tipos compartilhados (cliente e servidor) dos modelos de peças jurídicas com IA. Sem dependências de servidor.
 */

export type TipoPecaId =
  | 'contestacao'
  | 'replica'
  | 'apelacao'
  | 'agravo_instrumento'
  | 'embargos_declaracao'
  | 'manifestacao_intimacao'
  | 'notificacao_extrajudicial'
  | 'peticao_simples';

export interface OpcaoCampo {
  value: string;
  label: string;
}

export interface CampoEntrada {
  id: string;
  rotulo: string;
  ajuda?: string;
  placeholder?: string;
  tipo: 'texto' | 'area' | 'selecao';
  opcoes?: OpcaoCampo[];
  obrigatorio?: boolean;
}

export interface ModeloPeca {
  id: TipoPecaId;
  nome: string;
  descricao: string;
  /** Nome do ícone lucide-react (resolvido na interface). */
  icone: string;
  /** Cabeçalhos da peça, na ordem. O modelo é obrigado a usá-los e o código confere. */
  secoes: string[];
  campos: CampoEntrada[];
  /** Instruções específicas do tipo, enviadas ao modelo. */
  orientacoes: string[];
  /** Limite de tokens de saída para este tipo. */
  maxTokens: number;
  /** O tipo aceita a opção "Fundamentar com jurisprudência". */
  usaJurisprudencia: boolean;
  /** Peça que corre num processo: oferece escolher um processo da conta. */
  processual: boolean;
  /** Faixa esperada de tamanho (em caracteres) da minuta pronta; usada na avaliação automática. */
  tamanho: { minimo: number; maximo: number };
}

/** Intervenção feita pelo código sobre o texto do modelo (regras de segurança do conteúdo). */
export interface Intervencao {
  tipo:
    | 'julgado_removido'
    | 'julgado_corrigido'
    | 'dado_inventado'
    | 'lei_conferir'
    | 'artigo_conferir'
    | 'sumula_conferir'
    | 'nome_conferir'
    | 'secao_ausente';
  /** Trecho original afetado (curto). */
  trecho: string;
  /** O que o código fez. */
  acao: string;
}

export interface PecaResumo {
  id: string;
  tipo: TipoPecaId | string;
  titulo: string;
  processoNumero: string | null;
  modelo: string | null;
  tokensEntrada: number;
  tokensSaida: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface PecaCompleta extends PecaResumo {
  entrada: EntradaPeca;
  conteudo: string;
}

/** O que o usuário informou ao gerar a peça (guardado no histórico para duplicar/reabrir). */
export interface EntradaPeca {
  campos: Record<string, string>;
  processoNumero?: string | null;
  usarJurisprudencia?: boolean;
  /** Tema usado na busca de jurisprudência, quando ligada. */
  temaJurisprudencia?: string;
  /** Julgados que o sistema encontrou na base e entregou ao modelo (os únicos que podem aparecer na peça). */
  julgadosUsados?: { referencia: string; fonteUrl: string | null }[];
}

export interface RespostaGeracao {
  peca: PecaCompleta | null;
  /** Texto gerado (com o aviso), mesmo que o histórico não tenha podido salvar. */
  titulo: string;
  conteudo: string;
  tipo: TipoPecaId;
  modelo: string;
  tokensEntrada: number;
  tokensSaida: number;
  intervencoes: Intervencao[];
  entrada: EntradaPeca;
  salvo: boolean;
  /** Mensagem quando o histórico não pôde ser gravado (ex.: migration ainda não aplicada). */
  avisoHistorico?: string;
  /** Pediu jurisprudência mas a base não devolveu julgados relevantes. */
  semJulgados?: boolean;
}
