import { Fragment } from 'react';

/** Cada caractere vira sua versão sem acento (1 para 1), para que os índices coincidam com o texto original. */
function semAcentoMesmoTamanho(texto: string): string {
  let saida = '';
  for (const c of texto) {
    const base = c.normalize('NFD').charAt(0).toLowerCase();
    saida += base.length === c.length ? base : c.toLowerCase();
  }
  return saida;
}

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Texto com os termos da busca destacados (ignora acento e maiúsculas; destaca a palavra inteira). */
export function Destaque({ texto, termos }: { texto: string; termos: string[] }) {
  if (termos.length === 0 || !texto) return <>{texto}</>;
  const norm = semAcentoMesmoTamanho(texto);
  const re = new RegExp(`(?<![a-z0-9])(?:${termos.map(escapar).join('|')})[a-z0-9]*`, 'g');

  const partes: Array<{ t: string; marcado: boolean }> = [];
  let ultimo = 0;
  for (const m of norm.matchAll(re)) {
    const ini = m.index ?? 0;
    if (ini > ultimo) partes.push({ t: texto.slice(ultimo, ini), marcado: false });
    partes.push({ t: texto.slice(ini, ini + m[0].length), marcado: true });
    ultimo = ini + m[0].length;
  }
  if (ultimo < texto.length) partes.push({ t: texto.slice(ultimo), marcado: false });

  return (
    <>
      {partes.map((p, i) =>
        p.marcado ? (
          <mark key={i} className="rounded bg-[#1E7CF2]/20 px-0.5 text-inherit">
            {p.t}
          </mark>
        ) : (
          <Fragment key={i}>{p.t}</Fragment>
        )
      )}
    </>
  );
}
