import type { Metadata } from 'next';
import Link from 'next/link';
import { BellRing, ChevronDown, CreditCard, Info, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import NavbarPublica from '@/components/NavbarPublica';
import styles from './faq.module.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://jusconsulta.com.br';

export const metadata: Metadata = {
  title: 'Perguntas frequentes',
  description:
    'Como funciona a consulta de processos, o acompanhamento pelo WhatsApp, os planos e a privacidade dos dados no JusConsulta.',
  alternates: { canonical: `${SITE_URL}/faq` }
};

interface Pergunta {
  pergunta: string;
  resposta: string;
}

interface Categoria {
  id: string;
  titulo: string;
  icon: LucideIcon;
  perguntas: Pergunta[];
}

// Respostas fiéis ao que o sistema faz hoje (fontes: lib/djen.ts, lib/datajud.ts, lib/planos.ts, lib/smartDigest.ts,
// webhook do WhatsApp). Ao mudar uma regra do produto, revisar aqui.
const CATEGORIAS: Categoria[] = [
  {
    id: 'sobre',
    titulo: 'Sobre o JusConsulta',
    icon: Info,
    perguntas: [
      {
        pergunta: 'O que é o JusConsulta?',
        resposta:
          'É uma plataforma de acompanhamento processual. Ela reúne em um só lugar os processos espalhados pelos tribunais, explica cada movimentação em linguagem simples e avisa você pelo WhatsApp quando algo importante acontece.'
      },
      {
        pergunta: 'O JusConsulta substitui um advogado?',
        resposta:
          'Não. O sistema traduz o andamento e indica o que ele significa, mas não dá parecer jurídico. Decisões sobre o seu caso devem ser tomadas com um advogado inscrito na OAB.'
      },
      {
        pergunta: 'Quem desenvolve o JusConsulta?',
        resposta: 'O JusConsulta é uma solução TechTie.'
      }
    ]
  },
  {
    id: 'consulta',
    titulo: 'Consulta de processos',
    icon: Search,
    perguntas: [
      {
        pergunta: 'Posso consultar sem criar conta?',
        resposta:
          'Sim. Na página inicial você busca por nome completo ou pelo número do processo (CNJ) e vê de graça o número, o tribunal e a classe de cada processo encontrado. As partes, o órgão julgador e os andamentos aparecem depois do login.'
      },
      {
        pergunta: 'Por que a busca por nome não mostra todos os meus processos?',
        resposta:
          'A busca sem cadastro usa o Diário de Justiça Eletrônico Nacional e mostra apenas processos que tiveram publicação nele e em que a pessoa pesquisada é a parte autora. Para uma varredura completa nos tribunais, use a busca por CPF ou CNPJ com a sua conta.'
      },
      {
        pergunta: 'Como funciona a busca por CPF ou CNPJ?',
        resposta:
          'Com a conta, o sistema consulta várias bases de tribunais ao mesmo tempo, começando pelas mais prováveis para a sua região, e mostra os resultados à medida que chegam. Essa busca é feita em fontes pagas, por isso não está disponível sem cadastro.'
      },
      {
        pergunta: 'Quais tribunais são consultados?',
        resposta:
          'Tribunais de Justiça estaduais, Tribunais Regionais Federais, Tribunais Regionais do Trabalho e tribunais superiores, por meio da base pública do CNJ (DataJud), do Diário de Justiça Eletrônico Nacional e dos portais dos próprios tribunais. O nível de detalhe varia conforme o que cada tribunal disponibiliza.'
      },
      {
        pergunta: 'Encontrei um processo de outra pessoa com o mesmo nome. O que faço?',
        resposta:
          'Homônimos acontecem na busca por nome. Confira o número do processo, o tribunal e a classe. Para ter certeza, faça a busca pelo número do processo ou, com a conta, pelo CPF.'
      }
    ]
  },
  {
    id: 'acompanhamento',
    titulo: 'Acompanhamento e WhatsApp',
    icon: BellRing,
    perguntas: [
      {
        pergunta: 'Com que frequência os processos são atualizados?',
        resposta:
          'Os processos acompanhados são verificados todos os dias. Intimações publicadas no Diário de Justiça Eletrônico Nacional chegam no dia seguinte à publicação; outras movimentações dependem da base do CNJ, que pode levar alguns dias para ser atualizada pelos tribunais.'
      },
      {
        pergunta: 'Como recebo os avisos?',
        resposta:
          'Por WhatsApp e por e-mail, conforme você escolher em cada processo. A mensagem explica o que aconteceu, o que isso significa e qual costuma ser o próximo passo.'
      },
      {
        pergunta: 'O que é o Smart Digest?',
        resposta:
          'É o filtro que separa o urgente da rotina. Movimentações relevantes, como decisões, penhoras ou prazos, são avisadas na hora. Atos burocráticos, como juntadas e remessas, são reunidos em um único resumo semanal, enviado às sextas-feiras. Você pode trocar para receber tudo ou apenas urgências.'
      },
      {
        pergunta: 'Posso tirar dúvidas respondendo a mensagem no WhatsApp?',
        resposta:
          'Sim, no Plano Pro. Basta responder a mensagem com a sua dúvida que o assistente explica com base nos dados do processo.'
      },
      {
        pergunta: 'Posso enviar a foto de uma intimação?',
        resposta:
          'Sim, no Plano Pro. Envie a foto ou o PDF pelo WhatsApp: o documento é lido automaticamente e o assistente aponta o número do processo, prazos e pontos de atenção.'
      },
      {
        pergunta: 'Como paro de receber mensagens no WhatsApp?',
        resposta: 'Responda SAIR, PARAR ou CANCELAR a qualquer mensagem. O envio é desligado na hora.'
      }
    ]
  },
  {
    id: 'planos',
    titulo: 'Planos',
    icon: CreditCard,
    perguntas: [
      {
        pergunta: 'O JusConsulta é gratuito?',
        resposta:
          'Existe um plano gratuito, com acompanhamento de até 2 processos. O Plano Pro custa R$ 79,90 por mês e acompanha até 50 processos.'
      },
      {
        pergunta: 'O que o Plano Pro inclui?',
        resposta:
          'Conversa com o assistente pelo WhatsApp, resumo semanal (Smart Digest), leitura de fotos e documentos, monitoramento de CPF e suporte prioritário.'
      },
      {
        pergunta: 'O que é o monitoramento de CPF?',
        resposta:
          'Em vez de acompanhar um processo já conhecido, o sistema verifica periodicamente o CPF ou CNPJ cadastrado e avisa quando surge um processo novo.'
      }
    ]
  },
  {
    id: 'privacidade',
    titulo: 'Privacidade e dados',
    icon: ShieldCheck,
    perguntas: [
      {
        pergunta: 'De onde vêm os dados dos processos?',
        resposta:
          'De fontes públicas oficiais: a base do Conselho Nacional de Justiça (DataJud), o Diário de Justiça Eletrônico Nacional e os portais dos tribunais. Processos em segredo de justiça não aparecem.'
      },
      {
        pergunta: 'Por que as partes ficam ocultas antes do login?',
        resposta:
          'Para reduzir a exposição de dados pessoais. Sem conta, a busca mostra só os dados do processo; nomes das partes e andamentos ficam para usuários identificados.'
      },
      {
        pergunta: 'Como deixo de receber avisos por e-mail?',
        resposta: 'Use o link de descadastro que vem em cada e-mail ou desligue o aviso no card do processo, dentro da sua conta.'
      }
    ]
  }
];

// Dados estruturados FAQPage: o Google pode exibir as perguntas direto no resultado da busca.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: CATEGORIAS.flatMap(c =>
    c.perguntas.map(p => ({ '@type': 'Question', name: p.pergunta, acceptedAnswer: { '@type': 'Answer', text: p.resposta } }))
  )
};

export default function FaqPage() {
  return (
    <>
      <NavbarPublica />
      <main className={styles.pagina}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

        <header className={styles.cabecalho}>
          <p className={styles.eyebrow}>Central de ajuda</p>
          <h1 className={styles.titulo}>Perguntas frequentes</h1>
          <p className={styles.lead}>Como a consulta, o acompanhamento pelo WhatsApp e os planos funcionam na prática.</p>
        </header>

        <nav className={styles.categorias} aria-label="Categorias">
          {CATEGORIAS.map(({ id, titulo, icon: Icon }) => (
            <a key={id} href={`#${id}`} className={styles.chip}>
              <Icon size={15} strokeWidth={1.8} />
              {titulo}
            </a>
          ))}
        </nav>

        {CATEGORIAS.map(({ id, titulo, icon: Icon, perguntas }) => (
          <section key={id} id={id} className={styles.secao} aria-labelledby={`${id}-titulo`}>
            <h2 id={`${id}-titulo`} className={styles.secaoTitulo}>
              <span className={styles.secaoIcone}>
                <Icon size={18} strokeWidth={1.8} />
              </span>
              {titulo}
            </h2>
            <div className={styles.lista}>
              {perguntas.map(({ pergunta, resposta }) => (
                <details key={pergunta} className={styles.item}>
                  <summary className={styles.pergunta}>
                    <span>{pergunta}</span>
                    <ChevronDown size={18} className={styles.seta} aria-hidden />
                  </summary>
                  <p className={styles.resposta}>{resposta}</p>
                </details>
              ))}
            </div>
          </section>
        ))}

        <aside className={styles.cta}>
          <div>
            <h2 className={styles.ctaTitulo}>Não encontrou sua resposta?</h2>
            <p className={styles.ctaTexto}>Faça uma consulta grátis pelo nome ou número do processo, ou crie sua conta.</p>
          </div>
          <Link href="/" className={`${styles.ctaBotao} bf-btn-ouro`}>
            <Search size={16} />
            Consultar agora
          </Link>
        </aside>
      </main>
    </>
  );
}
