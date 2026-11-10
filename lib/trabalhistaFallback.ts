/**
 * Busca trabalhista em cascata: a fonte gratuita primeiro e as demais só se ela não achar nada (ou falhar).
 *
 *   1. DJEN pela razão social (grátis);
 *   2. DJEN pelo nome fantasia, se for diferente (grátis);
 *   3. Certidão de ações trabalhistas (CEAT) da Infosimples para o CNPJ, no TRT escolhido (pago, ~R$ 0,20 cada).
 *
 * Detalhe importante da CEAT: nem todo TRT lista os processos. O TRT1 só informa se foi possível emitir a certidão
 * negativa (`conseguiu_emitir_certidao_negativa`); `false` indica que há ação contra o CNPJ, mas sem os números.
 * Por isso a resposta traz `certidoes`, separada da lista de processos.
 */

import { consultarInfosimples } from '@/lib/infosimplesClient';
import { FONTE_INFOSIMPLES_POR_ID } from '@/lib/fontesInfosimples';
import { precoDaRespostaInfosimples } from '@/lib/historicoConsultas';
import { desfechoInfosimples } from '@/lib/infosimplesResposta';
import { candidatosInfosimples, numeroDoRegistro } from '@/lib/motorConsulta';
import { formatProcessNumber, parseCnj } from '@/lib/cnj';
import { ufsDoAlias } from '@/lib/regioes';
import { DjenIndisponivelError, dataBrasil, normalizarNome } from '@/lib/djen';
import {
  buscarProcessosTrabalhistas,
  type EmpresaCnpj,
  type OpcoesTrabalhista,
  type ProcessoTrabalhista,
  type ResultadoTrabalhista
} from '@/lib/trabalhista';

const MAX_SERVICOS_PAGOS = 4;
const TIMEOUT_CEAT_SEGUNDOS = 90;

export interface EtapaBusca {
  fonte: string;
  resultado: string;
  /** Custo (R$) cobrado nesta etapa; 0 nas gratuitas. */
  custo: number;
  falhou?: boolean;
}

export interface CertidaoTrabalhista {
  tribunal: string;
  /** negativa = nada consta; positiva = há ação contra o CNPJ; indefinida = a resposta não permitiu concluir. */
  situacao: 'negativa' | 'positiva' | 'indefinida';
  numeroCertidao?: string;
  /** A certidão trouxe os números dos processos (TRT2, TRT3...) ou só o veredito (TRT1). */
  listaDisponivel: boolean;
  processos: number;
}

/** Por que a etapa paga não rodou (ou 'executada'). */
export type EstadoFallbackPago = 'executada' | 'nao_necessaria' | 'desligada' | 'sem_acesso' | 'sem_cnpj' | 'sem_token';

export interface OpcoesFallback extends OpcoesTrabalhista {
  termo: string;
  empresa: EmpresaCnpj | null;
  /** O que a conta pode fazer com a etapa paga; 'ligada' só quando permitida E pedida pelo usuário. */
  pago: 'ligada' | 'desligada' | 'sem_acesso';
  tokenInfosimples?: string;
}

export interface ResultadoTrabalhistaCompleto extends ResultadoTrabalhista {
  etapas: EtapaBusca[];
  certidoes: CertidaoTrabalhista[];
  fallbackPago: EstadoFallbackPago;
  custoCobrado: number;
  /** Fontes pagas efetivamente consultadas (para o histórico de custo). */
  tribunaisPagos: string[];
}

const textoVazio = (n: number, unidade: string) => `${n} ${unidade}${n === 1 ? '' : 's'}`;

/** TRTs (números) que atendem a UF da empresa, para o modo "todos os TRTs". */
function trtsDaUf(uf: string): number[] {
  return Array.from({ length: 24 }, (_, i) => i + 1).filter(n => ufsDoAlias(`trt${n}`).includes(uf.toUpperCase()));
}

function resultadoVazio(termo: string, opcoes: OpcoesTrabalhista): ResultadoTrabalhista {
  return { termo, processos: [], totalPublicacoes: 0, truncado: false, periodo: { inicio: dataBrasil(-opcoes.dias), fim: dataBrasil() }, trt: opcoes.trt };
}

export async function buscarTrabalhistaComFallback(opcoes: OpcoesFallback): Promise<ResultadoTrabalhistaCompleto> {
  const { termo, empresa, pago, tokenInfosimples } = opcoes;
  const busca: OpcoesTrabalhista = { trt: opcoes.trt, dias: opcoes.dias, somenteAutor: opcoes.somenteAutor };
  const etapas: EtapaBusca[] = [];
  // Em objeto (e não em `let`) porque o closure de tentarDjen os altera e o TypeScript estreitaria um `let` para null.
  const estado: { resultado: ResultadoTrabalhista | null; erroDjen: DjenIndisponivelError | null } = { resultado: null, erroDjen: null };

  const tentarDjen = async (nome: string, rotulo: string) => {
    try {
      const r = await buscarProcessosTrabalhistas(nome, busca);
      etapas.push({ fonte: rotulo, resultado: textoVazio(r.processos.length, 'processo'), custo: 0 });
      if (!estado.resultado || r.processos.length > 0) estado.resultado = r;
      return r.processos.length;
    } catch (e) {
      if (!(e instanceof DjenIndisponivelError)) throw e;
      estado.erroDjen = e;
      etapas.push({ fonte: rotulo, resultado: 'indisponível no momento', custo: 0, falhou: true });
      return 0;
    }
  };

  // 1 e 2: diário nacional (grátis).
  let achados = await tentarDjen(termo, 'Diário nacional (DJEN)');
  const fantasia = empresa?.nomeFantasia ?? '';
  if (achados === 0 && fantasia && normalizarNome(fantasia).length >= 5 && normalizarNome(fantasia) !== normalizarNome(termo)) {
    achados = await tentarDjen(fantasia, 'Diário nacional (DJEN) pelo nome fantasia');
  }

  // 3: certidão por CNPJ (paga). Só quando o diário não achou nada.
  const processos: ProcessoTrabalhista[] = achados > 0 && estado.resultado ? [...estado.resultado.processos] : [];
  const certidoes: CertidaoTrabalhista[] = [];
  const tribunaisPagos: string[] = [];
  let custoCobrado = 0;
  let fallbackPago: EstadoFallbackPago = 'nao_necessaria';

  if (achados === 0) {
    if (!empresa) fallbackPago = 'sem_cnpj';
    else if (pago === 'sem_acesso') fallbackPago = 'sem_acesso';
    else if (pago === 'desligada') fallbackPago = 'desligada';
    else if (!tokenInfosimples) fallbackPago = 'sem_token';
    else {
      fallbackPago = 'executada';
      const numeros = opcoes.trt === 'todos' ? trtsDaUf(empresa.uf) : [opcoes.trt];
      const fontes = numeros
        .flatMap(n => [FONTE_INFOSIMPLES_POR_ID.get(`TRT${n} (CEAT)`), FONTE_INFOSIMPLES_POR_ID.get(`TRT${n} (CEAT digital)`)])
        .filter((f): f is NonNullable<typeof f> => !!f?.params.cnpj)
        .slice(0, MAX_SERVICOS_PAGOS);

      if (fontes.length === 0) {
        etapas.push({ fonte: 'Certidão trabalhista (Infosimples)', resultado: 'este TRT não tem certidão por CNPJ disponível', custo: 0 });
      }

      const vistos = new Set<string>();
      await Promise.all(
        fontes.map(async f => {
          const campo = f.params.cnpj!;
          const valor = campo === 'cnpj_raiz' ? empresa.cnpj.slice(0, 8) : empresa.cnpj;
          const resposta = await consultarInfosimples(f.service, tokenInfosimples!, { [campo]: valor }, new AbortController().signal, {
            timeoutSegundos: TIMEOUT_CEAT_SEGUNDOS
          });
          const custo = precoDaRespostaInfosimples(resposta);
          custoCobrado += custo;
          tribunaisPagos.push(f.id);
          const rotulo = `Certidão ${f.id.replace(' (CEAT)', '').replace(' (CEAT digital)', ' digital')} (Infosimples)`;

          const desfecho = desfechoInfosimples(resposta);
          const dado = resposta?.code === 200 ? resposta.data?.[0] : null;
          if (!dado) {
            // "Nada encontrado" não é falha; só erro de verdade (rede, tribunal fora do ar, circuito aberto).
            etapas.push({ fonte: rotulo, resultado: desfecho.erro ?? 'sem resposta', custo, falhou: !!desfecho.erro });
            if (desfecho.erroTecnico) console.warn(`[trabalhista] ${f.id}: ${desfecho.erroTecnico}`);
            return;
          }

          const numeros = candidatosInfosimples(dado)
            .map(numeroDoRegistro)
            .map(n => n.replace(/\D/g, ''))
            .filter(n => n.length === 20);
          const veredito = dado.conseguiu_emitir_certidao_negativa;
          const situacao: CertidaoTrabalhista['situacao'] =
            dado.nada_consta === true || veredito === true ? 'negativa' : veredito === false || numeros.length > 0 ? 'positiva' : 'indefinida';
          if (situacao === 'indefinida') {
            console.warn(`[trabalhista] ${f.service}: certidão sem veredito reconhecido. Chaves de data[0]: ${Object.keys(dado).join(', ')}`);
          }
          certidoes.push({
            tribunal: f.id.replace(/ \(CEAT.*\)$/, ''),
            situacao,
            numeroCertidao: typeof dado.numero_certidao === 'string' ? dado.numero_certidao : undefined,
            listaDisponivel: numeros.length > 0,
            processos: numeros.length
          });
          etapas.push({
            fonte: rotulo,
            resultado:
              numeros.length > 0
                ? textoVazio(numeros.length, 'processo')
                : situacao === 'positiva'
                  ? 'há ação trabalhista, mas o tribunal não divulga os números'
                  : situacao === 'negativa'
                    ? 'nada consta'
                    : 'resposta sem veredito',
            custo
          });

          for (const digitos of numeros) {
            if (vistos.has(digitos)) continue;
            vistos.add(digitos);
            processos.push({
              numeroCnj: digitos,
              numeroFormatado: formatProcessNumber(digitos),
              tribunal: parseCnj(digitos)?.tribunalLabel ?? f.id.replace(/ \(CEAT.*\)$/, ''),
              classe: '',
              orgao: '',
              polo: 'indefinido',
              correspondencia: 'documento',
              origem: 'infosimples',
              ultimaPublicacao: '',
              tipoUltimaPublicacao: '',
              resumoUltimaPublicacao: '',
              totalPublicacoes: 0,
              autores: [],
              reus: []
            });
          }
        })
      );
    }
  }

  // Tudo falhou e nenhuma fonte conseguiu responder: devolve o erro do diário para a rota explicar.
  const algumaRespondeu = etapas.some(e => !e.falhou);
  if (processos.length === 0 && estado.erroDjen && !algumaRespondeu) throw estado.erroDjen;

  const base: ResultadoTrabalhista = estado.resultado ?? resultadoVazio(termo, opcoes);
  return { ...base, processos, etapas, certidoes, fallbackPago, custoCobrado: Number(custoCobrado.toFixed(2)), tribunaisPagos };
}
