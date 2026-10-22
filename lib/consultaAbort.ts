/**
 * Registro em memória dos AbortControllers de cada tribunal de uma consulta multi-tribunal em
 * andamento (app/api/processos/route.ts), para permitir cancelar uma chamada específica sem afetar
 * as demais (app/api/processos/cancelar/route.ts). Funciona por ser o mesmo processo Node que serve
 * o streaming da consulta; não sobrevive a cold start/instância diferente, mas isso é aceitável pois
 * o ciclo de vida de uma consulta dura poucos segundos, dentro da mesma invocação da function.
 *
 * O Map fica em globalThis porque as duas rotas importam este módulo separadamente: no `next dev` o
 * cache de módulos é recriado a cada recompilação, então cada rota podia ficar com a SUA cópia do
 * Map — a rota de cancelar não achava a consulta (devolvia cancelado:false) e o botão não fazia nada.
 */
const globalComRegistro = globalThis as typeof globalThis & {
  __prosecRegistroConsultas?: Map<string, Map<string, AbortController>>;
};
const registro = (globalComRegistro.__prosecRegistroConsultas ??= new Map<string, Map<string, AbortController>>());

/** Cria (ou reaproveita) o registro de controllers de uma consulta, indexado por label de tribunal. */
export function criarRegistroConsulta(consultaId: string): Map<string, AbortController> {
  const controllers = new Map<string, AbortController>();
  registro.set(consultaId, controllers);
  return controllers;
}

/** Remove o registro ao final da consulta (sucesso, erro ou todos os tribunais cancelados). */
export function limparRegistroConsulta(consultaId: string): void {
  registro.delete(consultaId);
  encerradas.delete(consultaId);
}

// Consultas que o usuário mandou encerrar ("encerrar e ver resultados"): as fontes em andamento são
// abortadas e nenhuma fonte nova começa (nem a 2ª onda), mas o stream termina normalmente com o que já achou.
const globalComEncerradas = globalThis as typeof globalThis & { __prosecConsultasEncerradas?: Set<string> };
const encerradas = (globalComEncerradas.__prosecConsultasEncerradas ??= new Set<string>());

/** Encerra a consulta: aborta todas as fontes em andamento e impede que outras comecem. */
export function encerrarConsulta(consultaId: string): boolean {
  const controllers = registro.get(consultaId);
  if (!controllers) return false;
  encerradas.add(consultaId);
  controllers.forEach(c => c.abort());
  return true;
}

export function consultaEncerrada(consultaId: string): boolean {
  return encerradas.has(consultaId);
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
