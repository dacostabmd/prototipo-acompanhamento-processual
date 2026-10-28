import type { Metadata } from 'next';
import Link from 'next/link';
import { BellRing, CreditCard, Info, Search, ShieldCheck, type LucideIcon } from 'lucide-react';
import NavbarPublica from '@/components/NavbarPublica';
import FaqItem from './FaqItem';
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
          'Uma plataforma da TechTie que reúne seus processos dos tribunais, explica cada movimentação em linguagem simples e avisa pelo WhatsApp quando algo importante acontece.'
      },
      {
        pergunta: 'O JusConsulta substitui um advogado?',
        resposta: 'Não. Ele explica o andamento, mas não dá parecer jurídico. Decisões sobre o caso devem ser tomadas com um advogado.'
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
          'Sim, pelo nome ou pelo número do processo. Você vê número, tribunal e classe; partes e andamentos aparecem após o login.'
      },
      {
        pergunta: 'Por que a busca por nome não mostra todos os meus processos?',
        resposta:
          'Sem conta, a busca usa o Diário de Justiça Eletrônico e mostra só processos publicados nele em que você é o autor. Para uma varredura completa, use a busca por CPF ou CNPJ com a sua conta.'
      },
      {
        pergunta: 'Quais tribunais são consultados?',
        resposta:
          'Tribunais estaduais, federais, do trabalho e superiores, via base do CNJ (DataJud), Diário de Justiça Eletrônico e portais dos tribunais.'
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
          'Todos os dias. Intimações chegam no dia seguinte à publicação; outras movimentações dependem do CNJ e podem levar alguns dias.'
      },
      {
        pergunta: 'Como recebo os avisos?',
        resposta:
          'Por WhatsApp e e-mail. Urgências, como decisões e prazos, chegam na hora; atos de rotina vão num resumo semanal às sextas (Smart Digest).'
      },
      {
        pergunta: 'Posso conversar com o assistente pelo WhatsApp?',
        resposta:
          'Sim, no Plano Pro. Responda com sua dúvida ou envie foto/PDF de uma intimação, e o assistente explica prazos e pontos de atenção.'
      },
      {
        pergunta: 'Como paro de receber avisos?',
        resposta: 'No WhatsApp, responda SAIR. No e-mail, use o link de descadastro ou desligue o aviso no card do processo.'
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
        resposta: 'O plano gratuito acompanha até 2 processos. O Plano Pro custa R$ 79,90 por mês e acompanha até 50.'
      },
      {
        pergunta: 'O que o Plano Pro inclui?',
        resposta:
          'Assistente no WhatsApp, Smart Digest, leitura de documentos, monitoramento de CPF (avisa quando surge um processo novo) e suporte prioritário.'
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
        resposta: 'De fontes públicas oficiais: CNJ, Diário de Justiça e tribunais. Processos em segredo de justiça não aparecem.'
      },
      {
        pergunta: 'Por que as partes ficam ocultas antes do login?',
        resposta: 'Para proteger dados pessoais. Sem conta, aparecem só os dados do processo.'
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
                <FaqItem key={pergunta} pergunta={pergunta} resposta={resposta} />
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
