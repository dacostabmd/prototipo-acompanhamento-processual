import type { Metadata } from 'next';
import {
  AlertTriangle,
  CheckCircle2,
  Key,
  Lock,
  Server,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react';

export const metadata: Metadata = { title: 'Autenticação — Documentações' };

interface Item {
  titulo: string;
  descricao: string;
  arquivo: string;
}

interface Secao {
  icon: LucideIcon;
  titulo: string;
  intro: string;
  itens: Item[];
}

const implementado: Secao[] = [
  {
    icon: Key,
    titulo: 'Provedor e fluxo de login',
    intro: 'Autenticação delegada ao Supabase Auth, sem gerenciamento próprio de senhas ou sessões.',
    itens: [
      {
        titulo: 'E-mail e senha + Google OAuth',
        descricao: 'Login e cadastro via signInWithPassword/signUp, e OAuth Google, ambos no mesmo formulário.',
        arquivo: 'components/AuthGateway.tsx'
      },
      {
        titulo: 'Confirmação de e-mail no cadastro',
        descricao: 'Signup envia emailRedirectTo e exibe aviso de "confirme seu e-mail" quando a sessão não retorna imediatamente.',
        arquivo: 'components/AuthGateway.tsx'
      },
      {
        titulo: 'Cliente Supabase único (singleton)',
        descricao: 'Instância única e lazy do client, evitando múltiplas conexões e centralizando a leitura das env vars.',
        arquivo: 'lib/supabase.ts'
      }
    ]
  },
  {
    icon: ShieldCheck,
    titulo: 'Proteção de rotas (cliente)',
    intro: 'Todas as páginas da área logada ficam atrás do AuthGuard, aplicado no layout do grupo autenticado.',
    itens: [
      {
        titulo: 'Verificação de sessão ao montar',
        descricao: 'getSession() é checado no carregamento; sem sessão válida, redireciona para "/" antes de renderizar o conteúdo.',
        arquivo: 'components/AuthGuard.tsx'
      },
      {
        titulo: 'Reação a mudanças de sessão em tempo real',
        descricao: 'onAuthStateChange trata SIGNED_OUT e ausência de sessão em USER_UPDATED, redirecionando imediatamente.',
        arquivo: 'components/AuthGuard.tsx'
      },
      {
        titulo: 'Aplicado a toda a área logada',
        descricao: 'O layout do grupo (app) envolve todas as páginas internas (painel, consulta, processos, perfil, histórico) com o AuthGuard.',
        arquivo: 'app/(app)/layout.tsx'
      }
    ]
  },
  {
    icon: Server,
    titulo: 'Proteção de API (servidor)',
    intro: 'Rotas de API validam o token Bearer contra o Supabase antes de processar a requisição.',
    itens: [
      {
        titulo: 'Validação de token e auditoria',
        descricao: 'requireUser() valida o Bearer token com supabase.auth.getUser(token) e audita a requisição (sucesso ou 401).',
        arquivo: 'lib/requireUser.ts'
      },
      {
        titulo: 'Envio automático do token nas chamadas',
        descricao: 'authFetch() anexa o access_token da sessão atual ao header Authorization em toda chamada às APIs internas.',
        arquivo: 'lib/authFetch.ts'
      }
    ]
  },
  {
    icon: Lock,
    titulo: 'Isolamento de dados (RLS)',
    intro: 'Row Level Security no Postgres garante que cada usuário só acesse seus próprios dados, mesmo em caso de falha na camada de aplicação.',
    itens: [
      {
        titulo: 'RLS habilitado em todas as tabelas do domínio',
        descricao: 'ap_perfis, ap_processos, ap_movimentacoes, ap_resumos_ia, ap_consultas, ap_eventos e ap_auditoria possuem policies por auth.uid().',
        arquivo: 'supabase/migrations/20260929120000_ap_schema_inicial.sql'
      },
      {
        titulo: 'Helper de administração',
        descricao: 'Função ap_is_admin() centraliza a regra de acesso privilegiado usada nas policies administrativas.',
        arquivo: 'supabase/migrations/20260929120000_ap_schema_inicial.sql'
      }
    ]
  }
];

const gaps: Item[] = [
  {
    titulo: 'Sem middleware.ts (proteção 100% client-side)',
    descricao:
      'Não há bloqueio no servidor: o layout renderiza antes da checagem de sessão, e o redirecionamento só ocorre após a hidratação no navegador. Isso permite um flash de conteúdo e não impede acesso via view-source ou chamadas diretas à API sem o token.',
    arquivo: 'app/(app)/layout.tsx'
  },
  {
    titulo: 'Bypass de autenticação sem env vars configuradas',
    descricao:
      'Tanto o AuthGateway quanto requireUser() liberam acesso em "modo demonstração" quando NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY não estão definidas. Se isso ocorrer em produção por erro de configuração, qualquer visitante autentica-se sem credenciais.',
    arquivo: 'lib/requireUser.ts e components/AuthGateway.tsx'
  },
  {
    titulo: 'Sem rate limiting em login/cadastro',
    descricao: 'Não há limitação de tentativas, deixando os endpoints de autenticação expostos a ataques de força bruta.',
    arquivo: 'components/AuthGateway.tsx'
  },
  {
    titulo: 'Sem fluxo de recuperação de senha',
    descricao: 'Não existe chamada a resetPasswordForEmail em nenhum ponto do projeto; o usuário não tem como redefinir a senha esquecida.',
    arquivo: '—'
  },
  {
    titulo: 'Sem tratamento explícito de refresh token expirado',
    descricao: 'O SDK renova sessões automaticamente em condições normais, mas não há listener dedicado para falhas de refresh (ex.: revogação, relógio do dispositivo incorreto), o que pode deixar a UI em estado inconsistente até o próximo redirecionamento.',
    arquivo: 'components/AuthGuard.tsx'
  }
];

function Card({ item }: { item: Item }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">{item.titulo}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{item.descricao}</p>
      <p className="mt-3 font-mono text-xs text-slate-400">{item.arquivo}</p>
    </div>
  );
}

export default function DocumentacaoAutenticacao() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8 sm:px-10 sm:py-12">
      <header>
        <p className="text-sm font-medium text-slate-400">Documentações</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Autenticação</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-slate-500">
          Registro das medidas de autenticação e controle de acesso implementadas no Prosec, e das lacunas conhecidas
          ainda não endereçadas.
        </p>
      </header>

      <section className="mt-10">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={20} strokeWidth={1.8} className="text-emerald-600" />
          <h2 className="text-lg font-semibold text-slate-900">Medidas implementadas</h2>
        </div>

        <div className="mt-6 space-y-8">
          {implementado.map(secao => (
            <div key={secao.titulo}>
              <div className="flex items-center gap-2 text-slate-700">
                <secao.icon size={18} strokeWidth={1.8} />
                <h3 className="font-semibold">{secao.titulo}</h3>
              </div>
              <p className="mt-1 text-sm text-slate-500">{secao.intro}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {secao.itens.map(item => (
                  <Card key={item.titulo} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <div className="flex items-center gap-2">
          <AlertTriangle size={20} strokeWidth={1.8} className="text-amber-600" />
          <h2 className="text-lg font-semibold text-slate-900">Gaps conhecidos</h2>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Pontos identificados em revisão que ainda não foram corrigidos, em ordem de risco.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {gaps.map(item => (
            <Card key={item.titulo} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}
