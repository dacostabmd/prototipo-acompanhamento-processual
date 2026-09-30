/**
 * Registro em memória dos AbortControllers de cada tribunal de uma consulta multi-tribunal em
 * andamento (app/api/processos/route.ts), para permitir cancelar uma chamada específica sem afetar
 * as demais (app/api/processos/cancelar/route.ts). Funciona por ser o mesmo processo Node que serve
 * o streaming da consulta; não sobrevive a cold start/instância diferente, mas isso é aceitável pois
 * o ciclo de vida de uma consulta dura poucos segundos, dentro da mesma invocação da function.
 */
const registro = new Map<string, Map<string, AbortController>>();

/** Cria (ou reaproveita) o registro de controllers de uma consulta, indexado por label de tribunal. */
export function criarRegistroConsulta(consultaId: string): Map<string, AbortController> {
  const controllers = new Map<string, AbortController>();
  registro.set(consultaId, controllers);
  return controllers;
}

/** Remove o registro ao final da consulta (sucesso, erro ou todos os tribunais cancelados). */
export function limparRegistroConsulta(consultaId: string): void {
  registro.delete(consultaId);
}

/**
 * Aborta a chamada de um tribunal específico dentro de uma consulta em andamento.
 * Retorna false se a consulta ou o tribunal não forem encontrados (já concluído, id inválido, etc).
 */
export function cancelarTribunal(consultaId: string, label: string): boolean {
  const controller = registro.get(consultaId)?.get(label);
  if (!controller) return false;
  controller.abort();
  return true;
}
