import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Coins, CreditCard, FolderHeart, Search, UserCog, Workflow } from 'lucide-react';
import styles from './TourGuiado.module.css';

export interface PassoTour {
  /** Rota onde o passo acontece. O tour navega até ela antes de procurar o alvo. */
  rota?: string;
  /** Valor do atributo data-tour do elemento destacado. Sem alvo (ou alvo não visível), o cartão aparece centralizado. */
  alvo?: string;
  titulo: string;
  conteudo: ReactNode;
}

export interface Tour {
  id: TourId;
  titulo: string;
  resumo: string;
  icone: LucideIcon;
  passos: PassoTour[];
}

export type TourId = 'visao-geral' | 'pesquisa' | 'salvamento' | 'tokenizacao' | 'pagamento' | 'perfil';

/** Fluxo em linha usado nos passos explicativos (sem alvo na tela). */
function Fluxo({ etapas }: { etapas: string[] }) {
  return (
    <div className={styles.fluxo} aria-label={`Fluxo: ${etapas.join(', ')}`}>
      {etapas.map((etapa, i) => (
        <span key={etapa} className={styles.fluxoItem}>
          <span className={styles.fluxoEtapa}>{etapa}</span>
          {i < etapas.length - 1 && <ArrowRight size={13} aria-hidden="true" className={styles.fluxoSeta} />}
        </span>
      ))}
    </div>
  );
}

function Lista({ itens }: { itens: ReactNode[] }) {
  return (
    <ul className={styles.lista}>
      {itens.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export const TOURS: Tour[] = [
  {
    id: 'visao-geral',
    titulo: 'Como o sistema funciona',
    resumo: 'A lógica por trás da consulta, do acompanhamento e dos alertas.',
    icone: Workflow,
    passos: [
      {
        titulo: 'Bem-vindo ao JusConsulta',
        conteudo: (
          <>
            <p>
              O JusConsulta procura seus processos nos tribunais, traduz o andamento para uma linguagem simples e avisa você
              quando algo importante acontece.
            </p>
            <Fluxo etapas={['Consulta', 'Processos salvos', 'Acompanhamento', 'Alerta traduzido']} />
          </>
        )
      },
      {
        rota: '/consulta',
        alvo: 'nav-consulta',
        titulo: '1. Tudo começa numa consulta',
        conteudo: (
          <p>
            Você busca pelo número do processo (grátis, nas bases públicas do CNJ) ou por pessoa e empresa (CPF/CNPJ), que
            varre vários tribunais ao mesmo tempo.
          </p>
        )
      },
      {
        titulo: 'De onde vêm os dados',
        conteudo: (
          <Lista
            itens={[
              <>
                <strong>DataJud (CNJ) e DJEN</strong>: bases oficiais e gratuitas. A busca por número usa essas fontes.
              </>,
              <>
                <strong>Consulta direta aos tribunais</strong>: usada na busca por CPF/CNPJ. Tem custo por tribunal, que sai da
                sua franquia de créditos.
              </>,
              <>Os resultados chegam aos poucos, tribunal por tribunal, para você não esperar a varredura inteira.</>
            ]}
          />
        )
      },
      {
        rota: '/processos',
        alvo: 'nav-processos',
        titulo: '2. Os processos ficam na sua conta',
        conteudo: (
          <p>
            Todo processo encontrado é salvo automaticamente em <strong>Meus processos</strong>, ligado à sua conta. Lá você
            liga o acompanhamento e escolhe os canais de aviso.
          </p>
        )
      },
      {
        titulo: '3. Acompanhamento e alertas',
        conteudo: (
          <>
            <p>Todas as noites o sistema reconsulta os processos acompanhados e compara com o que já foi visto.</p>
            <Lista
              itens={[
                <>
                  <strong>Urgente</strong> (penhora, bloqueio, prazo correndo): aviso na hora.
                </>,
                <>
                  <strong>Rotina</strong> (despachos burocráticos): reunida num resumo semanal às sextas.
                </>,
                <>Cada aviso vem explicado por IA: o que aconteceu, o impacto e o que fazer.</>
              ]}
            />
          </>
        )
      },
      {
        alvo: 'creditos',
        titulo: '4. Créditos de consulta',
        conteudo: (
          <p>
            Este indicador mostra quanto resta da franquia mensal para as consultas pagas. Ele renova todo dia 1º. Veja o tour
            de créditos para os detalhes.
          </p>
        )
      },
      {
        rota: '/perfil',
        alvo: 'nav-perfil',
        titulo: '5. Seu perfil',
        conteudo: <p>Em Meu perfil você mantém o WhatsApp dos alertas, vê seu tipo de acesso, o consumo do mês e a segurança da conta.</p>
      },
      {
        alvo: 'tour-controle',
        titulo: 'Volte quando quiser',
        conteudo: <p>Este controle fica sempre aqui. Escolha outro tour para ver cada funcionalidade em detalhe.</p>
      }
    ]
  },
  {
    id: 'pesquisa',
    titulo: 'Pesquisa de processos',
    resumo: 'Tipos de busca, campos, ajustes e custo estimado.',
    icone: Search,
    passos: [
      {
        rota: '/consulta',
        alvo: 'busca-cabecalho',
        titulo: 'Nova consulta',
        conteudo: <p>Esta é a tela de busca. O formulário se adapta ao seu tipo de acesso e ao modo de busca escolhido.</p>
      },
      {
        rota: '/consulta',
        alvo: 'busca-modos',
        titulo: 'Como buscar',
        conteudo: (
          <Lista
            itens={[
              <>
                <strong>Por número</strong>: grátis. O tribunal é identificado pelos 20 dígitos do número CNJ.
              </>,
              <>
                <strong>Por pessoa ou empresa</strong>: nome e CPF/CNPJ, varrendo vários tribunais.
              </>,
              <>
                <strong>Por nome da parte</strong>: sem documento, disponível para assinantes.
              </>
            ]}
          />
        )
      },
      {
        rota: '/consulta',
        alvo: 'busca-campos',
        titulo: 'Os dados da busca',
        conteudo: (
          <p>
            Os campos validam enquanto você digita: CPF e CNPJ têm o dígito conferido e o número do processo mostra quantos
            dígitos faltam. Na conta de consulta avulsa, o documento já vem fixo do seu cadastro.
          </p>
        )
      },
      {
        rota: '/consulta',
        alvo: 'busca-ajustes',
        titulo: 'Ajustes opcionais',
        conteudo: (
          <p>
            Filtre só os processos em que a pessoa é autora, informe o celular (o DDD indica por qual estado começar) e ative
            o modo Economizar, que só amplia a busca se nada for encontrado no estado mais provável.
          </p>
        )
      },
      {
        rota: '/consulta',
        alvo: 'busca-custo',
        titulo: 'Custo antes de buscar',
        conteudo: <p>Antes de confirmar, você vê quanto a consulta vai custar. Buscas nas bases públicas aparecem como gratuitas.</p>
      },
      {
        rota: '/consulta',
        alvo: 'busca-enviar',
        titulo: 'Iniciar a busca',
        conteudo: <p>O botão só libera quando os dados obrigatórios estão corretos. Passe o mouse para ver o que falta.</p>
      },
      {
        titulo: 'Durante e depois da busca',
        conteudo: (
          <Lista
            itens={[
              <>Cada tribunal aparece com seu status em tempo real. Dá para pular um tribunal lento sem cancelar o resto.</>,
              <>No resultado, cada processo traz partes, movimentações classificadas por urgência e um resumo feito por IA.</>,
              <>Um assistente responde dúvidas sobre os processos encontrados.</>
            ]}
          />
        )
      }
    ]
  },
  {
    id: 'salvamento',
    titulo: 'Processos salvos na conta',
    resumo: 'Onde os processos ficam e como ativar o acompanhamento.',
    icone: FolderHeart,
    passos: [
      {
        titulo: 'Você escolhe o que salvar',
        conteudo: (
          <>
            <p>
              Ao terminar uma busca, uma janela pergunta quais processos salvar em Meus processos, mostrando o custo da pesquisa.
              Só os salvos são conferidos todas as noites.
            </p>
            <Fluxo etapas={['Busca', 'Salvar?', 'Meus processos']} />
          </>
        )
      },
      {
        titulo: 'Acompanhar um processo',
        conteudo: (
          <p>
            No resultado da busca, o botão <strong>Acompanhar no WhatsApp</strong> coloca o processo na vigilância noturna. Se o
            seu WhatsApp ainda não estiver cadastrado, o sistema pede o número na hora.
          </p>
        )
      },
      {
        rota: '/processos',
        alvo: 'proc-acompanhados',
        titulo: 'Processos acompanhados',
        conteudo: (
          <p>
            Aqui ficam os processos vigiados. Em cada um você liga ou desliga e-mail e WhatsApp, escolhe a sensibilidade dos
            alertas e vê o histórico de avisos.
          </p>
        )
      }
    ]
  },
  {
    id: 'tokenizacao',
    titulo: 'Créditos e consumo',
    resumo: 'Como a franquia mensal é descontada e renovada.',
    icone: Coins,
    passos: [
      {
        titulo: 'O que são os créditos',
        conteudo: (
          <>
            <p>
              Cada plano tem uma franquia mensal em reais para consultas pagas. As consultas gratuitas (número do processo nas
              bases públicas) não consomem créditos.
            </p>
            <Fluxo etapas={['Franquia do mês', 'Consulta paga', 'Custo debitado', 'Renova dia 1º']} />
          </>
        )
      },
      {
        alvo: 'creditos',
        titulo: 'Saldo sempre visível',
        conteudo: (
          <p>
            O indicador mostra o saldo restante e uma barra de uso. Ela fica amarela perto de 70% e vermelha a partir de 90%.
            Passe o mouse para ver o valor usado e a data de renovação.
          </p>
        )
      },
      {
        rota: '/consulta',
        alvo: 'busca-custo',
        titulo: 'Custo antes de gastar',
        conteudo: <p>O formulário calcula o custo estimado conforme os tribunais e documentos escolhidos. Você decide antes de buscar.</p>
      },
      {
        rota: '/perfil',
        alvo: 'perfil-plano',
        titulo: 'Consumo no seu perfil',
        conteudo: <p>O perfil reúne plano, consumo do mês, processos acompanhados em relação ao limite e a data de renovação.</p>
      }
    ]
  },
  {
    id: 'pagamento',
    titulo: 'Assinatura e pagamento',
    resumo: 'Planos, Pix, cartão e ativação do Pro.',
    icone: CreditCard,
    passos: [
      {
        rota: '/planos',
        alvo: 'planos-gratuito',
        titulo: 'Plano Gratuito',
        conteudo: <p>Para conhecer a plataforma: até 2 processos acompanhados, consultas públicas e avisos por e-mail.</p>
      },
      {
        rota: '/planos',
        alvo: 'planos-pro',
        titulo: 'Plano Pro',
        conteudo: (
          <p>
            Até 50 processos acompanhados, WhatsApp com IA, resumo semanal anti-spam, leitura de intimações por foto, radar
            por CPF e uma franquia de créditos maior.
          </p>
        )
      },
      {
        rota: '/planos',
        alvo: 'planos-acao',
        titulo: 'Assinar',
        conteudo: <p>O botão abre o checkout. Você escolhe entre Pix e cartão de crédito.</p>
      },
      {
        titulo: 'Como o pagamento funciona',
        conteudo: (
          <>
            <Lista
              itens={[
                <>
                  <strong>Pix</strong>: um QR Code é gerado na hora. Pode escanear ou usar o Copia e Cola.
                </>,
                <>
                  <strong>Cartão</strong>: abre a página segura do processador de pagamento em outra aba. Os dados do cartão não
                  passam pelo JusConsulta.
                </>,
                <>A tela confere o pagamento sozinha e ativa o Pro assim que ele é confirmado.</>
              ]}
            />
            <Fluxo etapas={['Escolher Pix ou cartão', 'Pagar', 'Confirmação', 'Pro ativo']} />
          </>
        )
      },
      {
        titulo: 'Renovação e cancelamento',
        conteudo: (
          <p>
            A assinatura é mensal. Voltar para o Gratuito cancela a cobrança recorrente. Se um pagamento falhar ou for estornado,
            a conta volta ao Gratuito automaticamente.
          </p>
        )
      },
      {
        rota: '/planos',
        alvo: 'planos-comparativo',
        titulo: 'Compare antes de decidir',
        conteudo: <p>A tabela lista recurso por recurso o que cada plano inclui.</p>
      }
    ]
  },
  {
    id: 'perfil',
    titulo: 'Configuração de perfil',
    resumo: 'Dados, WhatsApp dos alertas, acesso, plano e segurança.',
    icone: UserCog,
    passos: [
      {
        rota: '/perfil',
        alvo: 'perfil-identidade',
        titulo: 'Sua conta em resumo',
        conteudo: <p>Nome, tipo de acesso, plano e forma de login. É o que define o que você pode fazer na plataforma.</p>
      },
      {
        rota: '/perfil',
        alvo: 'perfil-dados',
        titulo: 'Dados pessoais',
        conteudo: (
          <p>
            Mantenha nome e WhatsApp atualizados. O WhatsApp é o número que recebe os alertas dos processos acompanhados. Para
            advogados, a OAB aparece aqui também.
          </p>
        )
      },
      {
        rota: '/perfil',
        alvo: 'perfil-acesso',
        titulo: 'Tipo de acesso',
        conteudo: (
          <p>
            Advogado e Broker consultam qualquer pessoa ou processo. A Consulta Avulsa fica presa ao próprio CPF/CNPJ, que não
            pode ser alterado depois de salvo.
          </p>
        )
      },
      {
        rota: '/perfil',
        alvo: 'perfil-plano',
        titulo: 'Plano e consumo',
        conteudo: <p>Saldo da franquia, processos acompanhados em relação ao limite do plano e a data de renovação.</p>
      },
      {
        rota: '/perfil',
        alvo: 'perfil-notificacoes',
        titulo: 'Alertas',
        conteudo: (
          <p>
            Mostra para onde vão os avisos. Os canais de cada processo são escolhidos em Meus processos. No WhatsApp, responder
            SAIR desliga os envios.
          </p>
        )
      },
      {
        rota: '/perfil',
        alvo: 'perfil-seguranca',
        titulo: 'Segurança',
        conteudo: <p>Troque a senha e encerre a sessão em todos os aparelhos se suspeitar de acesso indevido.</p>
      }
    ]
  }
];

export const tourPorId = (id: string | null | undefined) => TOURS.find(t => t.id === id) ?? null;
