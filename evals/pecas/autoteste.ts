/**
 * Autotestes OFFLINE do pós-processamento de segurança (lib/pecas/seguranca.ts), sem chamar modelo nenhum.
 *
 * O modelo real quase sempre obedece ao prompt, então a avaliação com IA raramente exercita as regras de código.
 * Aqui a "saída do modelo" é sintética e plantada com cada violação, para provar que o código pega o que o prompt
 * deixar passar.
 */
import { AVISO } from '@/lib/pecas/formato';
import { montarCorpus, processar, type CitacaoPermitida } from '@/lib/pecas/seguranca';
import { JULGADOS_TESTE } from './casos';

const SECOES = ['Endereçamento', 'Mérito', 'Pedidos', 'Fecho'];
const CITACOES: CitacaoPermitida[] = [JULGADOS_TESTE.negativacao];
const ENTRADA =
  'Representado: Banco Alfa S.A., CNPJ 12.345.678/0001-90. Parte contrária: Maria Aparecida Souza, CPF 111.444.777-35. ' +
  'Processo 0001234-56.2025.8.26.0100, distribuído em 10/03/2025, valor da causa R$ 15.000,00. Advogado: Dr. Paulo Lima, OAB/SP 123.456. ' +
  `${CITACOES[0].referencia} ${CITACOES[0].ementa}`;
const CORPUS = montarCorpus([ENTRADA]);

const corpo = (mérito: string) => `## Endereçamento\nExcelentíssimo Senhor Doutor Juiz de Direito.\n\n## Mérito\n${mérito}\n\n## Pedidos\nImprocedência.\n\n## Fecho\n[PREENCHER: local e data]\n`;

interface Teste {
  nome: string;
  bruto: string;
  confere: (final: string, tipos: string[]) => boolean;
}

const roda = (bruto: string) => processar(bruto, { corpus: CORPUS, citacoes: CITACOES, secoes: SECOES });

const TESTES: Teste[] = [
  {
    nome: 'julgado fora da lista é removido (com relator e data)',
    bruto: corpo('Conforme o REsp 1.234.567/SP, Rel. Min. Carlos Menezes, Terceira Turma, j. 01/02/2020, o dano é presumido.'),
    confere: (f, t) => !f.includes('1.234.567') && !f.includes('Carlos Menezes') && t.includes('julgado_removido')
  },
  {
    nome: 'AgInt/AREsp/HC/RE inventados são removidos',
    bruto: corpo('Veja AgInt no AREsp 9.999.999, HC 123456 e RE 654.321 e AgRg no REsp 7.777.777.'),
    confere: f => !/9\.999\.999|123456|654\.321|7\.777\.777/.test(f)
  },
  {
    nome: 'julgado da lista citado de forma incompleta é reescrito literalmente',
    bruto: corpo('Segundo o AREsp 2.628.498, o dano é presumido.'),
    confere: f => f.includes(CITACOES[0].referencia) && !f.includes('AREsp 2.628.498,  ')
  },
  {
    nome: 'julgado da lista citado literalmente fica intacto',
    bruto: corpo(`Veja ${CITACOES[0].referencia}.`),
    confere: (f, t) => f.includes(CITACOES[0].referencia) && !t.includes('julgado_corrigido') && !t.includes('julgado_removido')
  },
  {
    nome: 'julgado de tribunal estadual fora da base é removido',
    bruto: corpo('Nesse sentido, TJSP, Apelação Cível nº 1098765-43.2021.8.26.0100 e TJMG Apelação 5555555.'),
    confere: f => !f.includes('1098765') && !f.includes('5555555')
  },
  {
    nome: 'menção genérica a "o julgado autorizado" é trocada',
    bruto: corpo('Conforme o julgado autorizado, o dano é presumido.'),
    confere: f => !/julgado autorizado/i.test(f)
  },
  {
    nome: 'CPF, CNPJ, CNJ, OAB e CEP inventados viram [PREENCHER]',
    bruto: corpo('CPF 999.888.777-66, CNPJ 11.222.333/0001-44, processo 0000000-00.2000.1.00.0000, OAB/RJ 555.555, CEP 01310-100.'),
    confere: f => !/999\.888\.777|11\.222\.333|0000000-00|555\.555|01310/.test(f) && (f.match(/\[PREENCHER/g) ?? []).length >= 6
  },
  {
    nome: 'CPF, CNPJ, CNJ e OAB que vieram na entrada são preservados',
    bruto: corpo('CPF 111.444.777-35, CNPJ 12.345.678/0001-90, processo 0001234-56.2025.8.26.0100, OAB/SP 123.456.'),
    confere: (f, t) => ['111.444.777-35', '12.345.678/0001-90', '0001234-56.2025.8.26.0100', 'OAB/SP 123.456'].every(x => f.includes(x)) && !t.includes('dado_inventado')
  },
  {
    nome: 'data e valor inventados viram [PREENCHER]; os da entrada ficam',
    bruto: corpo('Em 15/07/2024 e em 3 de agosto de 2023 o autor pediu R$ 80.000,00 (oitenta mil reais), mas a causa vale R$ 15.000,00, distribuída em 10/03/2025.'),
    confere: f => !/15\/07\/2024|agosto de 2023|80\.000/.test(f) && f.includes('R$ 15.000,00') && f.includes('10/03/2025')
  },
  {
    nome: 'data de lei (Lei nº 13.105, de 16 de março de 2015) não é tratada como dado inventado',
    bruto: corpo('Nos termos da Lei nº 13.105, de 16 de março de 2015, o Código de Processo Civil prevê o ônus da impugnação.'),
    confere: (f, t) => f.includes('16 de março de 2015') && !t.includes('dado_inventado')
  },
  {
    nome: 'lei desconhecida é marcada; leis conhecidas não',
    bruto: corpo('A Lei 99.999/2020 e a Lei nº 8.078/1990 (CDC) e a Lei 13.105/2015.'),
    confere: f => /Lei 99\.999\/2020 \[CONFERIR/.test(f) && !/8\.078\/1990 \[CONFERIR/.test(f) && !/13\.105\/2015 \[CONFERIR/.test(f)
  },
  {
    nome: 'artigo acima do último do CPC é marcado; artigo existente não',
    bruto: corpo('Art. 2000 do CPC e art. 335 do CPC e artigo 5º da CF e art. 3000 do Código Civil.'),
    confere: f => /Art\. 2000 do CPC \[CONFERIR/.test(f) && !/335 do CPC \[CONFERIR/.test(f) && !/5º da CF \[CONFERIR/.test(f) && /3000 do Código Civil \[CONFERIR/.test(f)
  },
  {
    nome: 'súmula e tema repetitivo são sempre marcados',
    bruto: corpo('Aplica-se a Súmula 385 do STJ e o Tema 1.000 do STJ.'),
    confere: f => /385 do STJ \[CONFERIR/.test(f) && /Tema 1\.000 do STJ \[CONFERIR/.test(f)
  },
  {
    nome: 'nome inventado é marcado; nome da entrada não',
    bruto: corpo('A autora Maria Aparecida Souza foi atendida pelo gerente Roberto Carlos Menezes, que assinou o contrato.'),
    confere: f => /Roberto Carlos Menezes \[CONFERIR/.test(f) && !/Maria Aparecida Souza \[CONFERIR/.test(f)
  },
  {
    nome: 'vocabulário jurídico, subtítulos e abreviações não geram falso nome',
    bruto: corpo('Tribunal de Justiça do Estado de São Paulo. Superior Tribunal de Justiça. Código de Defesa do Consumidor.\n\nI - Da Redução do Valor da Indenização\nPelo exposto, o Ministério Público não se opõe. Dr. Paulo Lima assina.'),
    confere: (f, t) => !t.includes('nome_conferir')
  },
  {
    nome: 'seção ausente vira [PREENCHER] e a ordem do catálogo é mantida',
    bruto: '## Endereçamento\nAo juízo.\n\n## Fecho\n[PREENCHER: local e data]\n',
    confere: (f, t) => t.filter(x => x === 'secao_ausente').length === 2 && f.indexOf('## Mérito') > f.indexOf('## Endereçamento') && f.indexOf('## Pedidos') < f.indexOf('## Fecho')
  },
  {
    nome: 'subtítulos escritos com "##" dentro do mérito são dobrados na seção anterior',
    bruto: '## Endereçamento\nAo juízo.\n\n## Mérito\nIntrodução.\n\n## Exercício regular de direito\nTexto A.\n\n## Pedidos\nImprocedência.\n\n## Fecho\n[PREENCHER: local e data]',
    confere: f => !/## Exercício/.test(f) && /Exercício regular de direito:\nTexto A\./.test(f) && f.split('\n## ').length === 5
  },
  {
    nome: 'aviso do modelo é descartado e o fixo é inserido uma única vez; markdown de ênfase some',
    bruto: `Minuta gerada por IA. Revise.\n${corpo('Texto com **ênfase** e __outra__.')}`,
    confere: f => f.startsWith(AVISO) && f.split(AVISO).length === 2 && !/\*\*|__/.test(f)
  },
  {
    nome: 'resposta sem nenhum cabeçalho vira a primeira seção e as demais ficam [PREENCHER]',
    bruto: 'Texto corrido sem cabeçalhos nenhuns.',
    confere: (f, t) => f.includes('Texto corrido sem cabeçalhos') && t.filter(x => x === 'secao_ausente').length === 3
  }
];

/** Idempotência: reprocessar uma minuta já tratada não pode mudar nada. */
function idempotente(bruto: string): boolean {
  const a = roda(bruto);
  const b = roda(a.conteudo);
  return b.intervencoes.length === 0 && b.conteudo === a.conteudo;
}

export function rodarAutotestes(): { total: number; falhas: string[] } {
  const falhas: string[] = [];
  for (const t of TESTES) {
    const r = roda(t.bruto);
    let ok = false;
    try {
      ok = t.confere(r.conteudo, r.intervencoes.map(i => i.tipo));
    } catch {
      ok = false;
    }
    if (!ok) falhas.push(`${t.nome}\n      saída: ${r.conteudo.replace(/\n+/g, ' / ').slice(0, 300)}`);
    if (!idempotente(t.bruto)) falhas.push(`${t.nome} (idempotência)`);
  }
  return { total: TESTES.length * 2, falhas };
}
