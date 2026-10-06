import { FONTES_INFOSIMPLES } from './fontesInfosimples';

/**
 * Modelo de preços da Infosimples (https://infosimples.com/consultas/precos/), pré-pago:
 * preço final da consulta = preço base (por faixa de volume mensal da conta) + adicional fixo do serviço.
 * O adicional de cada serviço fica no catálogo (lib/fontesInfosimples.ts). O DataJud é gratuito.
 * Franquia mínima mensal de R$ 100,00 não é considerada aqui (é por conta, não por consulta).
 *
 * Não temos acesso ao volume mensal real da conta (só visível no painel Infosimples), então assumimos
 * a faixa de menor volume (1–500 consultas/mês) como estimativa conservadora — cenário mais realista
 * para este produto, de consulta pontual sob demanda.
 */
const PRECO_BASE_POR_FAIXA = 0.2; // R$, faixa 1–500 consultas/mês

const ADICIONAL_POR_SERVICO = new Map(FONTES_INFOSIMPLES.map(f => [f.service, f.adicional]));

/** Preço estimado (R$) de uma consulta a um serviço específico da Infosimples. */
export function custoServico(service: string): number {
  return PRECO_BASE_POR_FAIXA + (ADICIONAL_POR_SERVICO.get(service) ?? 0);
}

/** Soma o custo estimado de uma lista de serviços consultados. */
export function custoTotal(services: string[]): number {
  return Number(services.reduce((sum, s) => sum + custoServico(s), 0).toFixed(2));
}

/** Formata um valor em reais para exibição (ex.: 0.24 -> "R$ 0,24"). */
export function formatarReais(valor: number): string {
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}
