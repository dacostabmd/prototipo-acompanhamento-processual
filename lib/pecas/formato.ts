/**
 * Formato de armazenamento da minuta (texto puro) e helpers de seções. Cliente e servidor.
 *
 * A minuta é guardada como texto: o aviso fixo na primeira linha e, depois, cada seção com um cabeçalho
 * "## Nome da seção". O aviso é inserido pelo código (nunca pelo modelo) e a interface não o deixa editável.
 */

export const AVISO = 'Minuta gerada por IA. Revise integralmente antes de protocolar; a responsabilidade técnica é do advogado.';

export interface SecaoPeca {
  titulo: string;
  texto: string;
}

export const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Chave de comparação de títulos de seção: sem acento, sem numeração, sem pontuação. */
export function chaveTitulo(t: string): string {
  return semAcento(t)
    .replace(/^\s*(?:\d+|[ivx]+)\s*[.)\-]\s*/i, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Separa o texto da minuta em seções (ignora o aviso e qualquer texto antes do primeiro cabeçalho). */
export function parsearSecoes(conteudo: string): SecaoPeca[] {
  const linhas = conteudo.replace(/\r/g, '').split('\n');
  const secoes: SecaoPeca[] = [];
  let atual: SecaoPeca | null = null;
  for (const linha of linhas) {
    const m = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(linha);
    if (m) {
      atual = { titulo: m[1].replace(/^\d+[.)]\s*/, '').trim(), texto: '' };
      secoes.push(atual);
    } else if (atual) {
      atual.texto += (atual.texto ? '\n' : '') + linha;
    }
  }
  return secoes.map(s => ({ titulo: s.titulo, texto: s.texto.replace(/^\n+|\s+$/g, '') }));
}

/** Monta o texto final: aviso fixo + seções. O aviso sempre volta, mesmo que o texto editado o tenha perdido. */
export function montarConteudo(secoes: SecaoPeca[]): string {
  const corpo = secoes
    .filter(s => s.titulo.trim())
    .map(s => `## ${s.titulo.trim()}\n${s.texto.replace(/\s+$/g, '')}`)
    .join('\n\n');
  return `${AVISO}\n\n${corpo}`.trimEnd() + '\n';
}

/** Texto corrido para copiar, baixar ou imprimir: aviso, depois título e texto de cada seção. */
export function conteudoParaTexto(conteudo: string): string {
  const secoes = parsearSecoes(conteudo);
  if (secoes.length === 0) return conteudo.includes(AVISO) ? conteudo : `${AVISO}\n\n${conteudo}`;
  return (
    `${AVISO}\n\n` +
    secoes
      .map(s => `${s.titulo.toUpperCase()}\n\n${s.texto}`)
      .join('\n\n')
      .trimEnd() +
    '\n'
  );
}

/** Trechos `[PREENCHER: ...]` e `[CONFERIR: ...]` que ainda precisam de atenção do advogado. */
export function listarPendencias(texto: string): { preencher: number; conferir: number } {
  return {
    preencher: (texto.match(/\[PREENCHER[^\]]*\]/g) ?? []).length,
    conferir: (texto.match(/\[CONFERIR[^\]]*\]/g) ?? []).length
  };
}

export function nomeArquivo(titulo: string): string {
  const base = semAcento(titulo)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'minuta'}.txt`;
}
