/**
 * Tipos e helpers de data da agenda para o navegador. Não importa lib/prazos.ts de propósito: ele usa `crypto`
 * do Node (hash dos prazos automáticos) e não deve entrar no bundle do cliente.
 */

export type TipoPrazo = 'prazo' | 'tarefa' | 'audiencia';

export interface PrazoAgenda {
  id: string;
  processoId: string | null;
  numeroCnj: string | null;
  titulo: string;
  descricao: string | null;
  tipo: TipoPrazo;
  /** YYYY-MM-DD */
  dataVencimento: string;
  concluido: boolean;
  concluidoEm: string | null;
  origem: 'manual' | 'auto_movimentacao' | 'auto_diario';
  criadoEm: string;
}

export interface SugestaoPrazo {
  titulo: string;
  descricao: string;
  dataVencimento: string;
  dataBase: string;
  quantidade: number;
  unidade: 'dias_uteis' | 'dias_corridos' | 'horas';
  trecho: string;
  sobPena: boolean;
  origemHash: string;
  processoId: string;
  numeroCnj: string;
}

export const ROTULO_TIPO: Record<TipoPrazo, string> = { prazo: 'Prazo', tarefa: 'Tarefa', audiencia: 'Audiência' };

const MS_DIA = 86_400_000;

function utc(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

/** Dias de `de` até `ate` (positivo quando `ate` é depois). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((utc(ate) - utc(de)) / MS_DIA);
}

export function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function diaDaSemanaTexto(iso: string): string {
  return DIAS_SEMANA[new Date(utc(iso)).getUTCDay()];
}

export type NivelUrgencia = 'atrasado' | 'hoje' | 'critico' | 'atencao' | 'folga' | 'concluido';

export interface InfoUrgencia {
  nivel: NivelUrgencia;
  /** "atrasado há 2 dias", "vence hoje", "vence amanhã", "em 5 dias" */
  rotulo: string;
  /** classes Tailwind (tokens que se adaptam ao modo claro/escuro do card) */
  texto: string;
  borda: string;
  fundo: string;
  ponto: string;
}

const ESTILOS: Record<NivelUrgencia, Pick<InfoUrgencia, 'texto' | 'borda' | 'fundo' | 'ponto'>> = {
  atrasado: { texto: 'text-red-300', borda: 'border-red-400/40', fundo: 'bg-red-400/10', ponto: 'bg-red-400' },
  hoje: { texto: 'text-amber-300', borda: 'border-amber-300/50', fundo: 'bg-amber-300/10', ponto: 'bg-amber-300' },
  critico: { texto: 'text-amber-300', borda: 'border-amber-300/30', fundo: 'bg-amber-300/[0.06]', ponto: 'bg-amber-300' },
  atencao: { texto: 'text-blue-300', borda: 'border-blue-300/30', fundo: 'bg-blue-300/[0.06]', ponto: 'bg-blue-300' },
  folga: { texto: 'text-white/60', borda: 'border-white/10', fundo: 'bg-white/[0.03]', ponto: 'bg-emerald-400' },
  concluido: { texto: 'text-white/40', borda: 'border-white/10', fundo: 'bg-white/[0.02]', ponto: 'bg-white/30' }
};

/** Urgência por proximidade do vencimento. `hoje` é a data de Brasília devolvida pela API. */
export function urgenciaDe(prazo: Pick<PrazoAgenda, 'dataVencimento' | 'concluido'>, hoje: string): InfoUrgencia {
  if (prazo.concluido) return { nivel: 'concluido', rotulo: 'concluído', ...ESTILOS.concluido };

  const dias = diasEntre(hoje, prazo.dataVencimento);
  if (dias < 0) return { nivel: 'atrasado', rotulo: `atrasado há ${-dias} dia${dias === -1 ? '' : 's'}`, ...ESTILOS.atrasado };
  if (dias === 0) return { nivel: 'hoje', rotulo: 'vence hoje', ...ESTILOS.hoje };
  if (dias === 1) return { nivel: 'critico', rotulo: 'vence amanhã', ...ESTILOS.critico };
  if (dias <= 3) return { nivel: 'critico', rotulo: `vence em ${dias} dias`, ...ESTILOS.critico };
  if (dias <= 7) return { nivel: 'atencao', rotulo: `vence em ${dias} dias`, ...ESTILOS.atencao };
  return { nivel: 'folga', rotulo: `em ${dias} dias`, ...ESTILOS.folga };
}

export function digitosCnj(numero: string): string {
  return numero.replace(/\D/g, '');
}
