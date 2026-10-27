import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Gavel,
  Sparkles,
  Clock,
  ShieldAlert,
  MessageCircle,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  FileText,
  HelpCircle,
  Lock
} from 'lucide-react';
import { cleanDigits } from '@/lib/format';
import { parseCnj, formatProcessNumber } from '@/lib/cnj';
import { getAdminClient } from '@/lib/track';
import { consultarDataJud } from '@/lib/datajud';

interface PageProps {
  params: Promise<{ cnj: string }>;
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://jusconsulta.com.br';

function fmtData(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function fmtDia(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { cnj } = await params;
  const digits = cleanDigits(cnj);
  if (digits.length !== 20) {
    return {
      title: 'Processo não encontrado | JusConsulta',
      description: 'Consulta pública de andamentos processuais com tradução por IA e acompanhamento via WhatsApp.'
    };
  }

  const cnjFormatado = formatProcessNumber(digits);
  const cnjInfo = parseCnj(digits);
  const tribunal = cnjInfo?.tribunalLabel || cnjInfo?.tribunalNome || 'Tribunal de Justiça';

  const title = `Processo ${cnjFormatado} · ${tribunal} · Andamento e Resumo IA | JusConsulta`;
  const description = `Consulte o andamento processual atualizado do processo nº ${cnjFormatado} do ${tribunal}. Entenda os despachos em linguagem simples com Inteligência Artificial e ative alertas pelo WhatsApp.`;

  return {
    title,
    description,
    alternates: {
      canonical: `${SITE_URL}/processo/${digits}`
    },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/processo/${digits}`,
      siteName: 'JusConsulta — Acompanhamento Processual Inteligente',
      locale: 'pt_BR',
      type: 'article'
    },
    twitter: {
      card: 'summary',
      title,
      description
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1
      }
    }
  };
}

export default async function ProcessoPublicoPage({ params }: PageProps) {
  const { cnj } = await params;
  const digits = cleanDigits(cnj);
  if (digits.length !== 20) {
    notFound();
  }

  const cnjFormatado = formatProcessNumber(digits);
  const cnjInfo = parseCnj(digits);
  const tribunalFallback = cnjInfo?.tribunalLabel || cnjInfo?.tribunalNome || 'Tribunal';

  const db = getAdminClient();

  // 1. Tenta carregar do banco local
  let processoDb: {
    id: string;
    tribunal: string | null;
    classe: string | null;
    assunto: string | null;
    grau: string | null;
    orgaoJulgador: string | null;
    ultimaMovimentacaoEm: string | null;
  } | null = null;

  let movimentos: { data: string; titulo: string; descricao: string; tag?: string }[] = [];
  let resumoIa: { resumo: string; significado: string; proximoPasso: string | null; urgencia: string | null; criadoEm: string } | null = null;

  if (db) {
    const { data: proc } = await db
      .from('ap_processos')
      .select('id, tribunal, classe_processual, assunto_principal, grau, orgao_julgador, ultima_movimentacao_em')
      .eq('numero_cnj', digits)
      .maybeSingle();

    if (proc) {
      processoDb = {
        id: proc.id,
        tribunal: proc.tribunal,
        classe: proc.classe_processual,
        assunto: proc.assunto_principal,
        grau: proc.grau,
        orgaoJulgador: proc.orgao_julgador,
        ultimaMovimentacaoEm: proc.ultima_movimentacao_em
      };

      const [resMovs, resIa] = await Promise.all([
        db
          .from('ap_movimentacoes')
          .select('data_movimentacao, titulo, conteudo, tipo')
          .eq('processo_id', proc.id)
          .order('data_movimentacao', { ascending: false })
          .limit(20),
        db
          .from('ap_resumos_ia')
          .select('resumo_simplificado, status_atual_explicado, proximos_passos, urgencia, created_at')
          .eq('processo_id', proc.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ]);

      if (resMovs.data && resMovs.data.length > 0) {
        movimentos = resMovs.data.map(m => ({
          data: m.data_movimentacao,
          titulo: m.titulo,
          descricao: m.conteudo || m.titulo,
          tag: m.tipo || undefined
        }));
      }

      if (resIa.data) {
        resumoIa = {
          resumo: resIa.data.resumo_simplificado,
          significado: resIa.data.status_atual_explicado,
          proximoPasso: resIa.data.proximos_passos,
          urgencia: resIa.data.urgencia,
          criadoEm: resIa.data.created_at
        };
      }
    }
  }

  // 2. Se não estiver no banco, consulta diretamente a API oficial do DataJud
  if (!processoDb && cnjInfo) {
    try {
      const datajud = await consultarDataJud(tribunalFallback, digits);
      if (datajud) {
        processoDb = {
          id: digits,
          tribunal: tribunalFallback,
          classe: datajud.classe || null,
          assunto: datajud.assuntos.length > 0 ? datajud.assuntos.join(' · ') : null,
          grau: datajud.grau || '1º Grau',
          orgaoJulgador: datajud.orgaoJulgador || null,
          ultimaMovimentacaoEm: datajud.movimentos[0]?.data || null
        };
        movimentos = datajud.movimentos;
      }
    } catch (err) {
      console.error('[processo-seo] Erro ao consultar DataJud:', err);
    }
  }

  const tribunalExibicao = processoDb?.tribunal || tribunalFallback;
  const classeExibicao = processoDb?.classe || 'Classe não informada';
  const orgaoExibicao = processoDb?.orgaoJulgador || 'Órgão julgador não informado';
  const assuntoExibicao = processoDb?.assunto || 'Assunto principal sob consulta';

  // JSON-LD para mecanismos de busca (Google Rich Results)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/processo/${digits}`
    },
    headline: `Andamento do Processo ${cnjFormatado} - ${tribunalExibicao}`,
    description: `Acompanhe as movimentações e o resumo em linguagem simples com IA do processo nº ${cnjFormatado}.`,
    dateModified: processoDb?.ultimaMovimentacaoEm || new Date().toISOString(),
    author: {
      '@type': 'Organization',
      name: 'JusConsulta',
      url: SITE_URL
    },
    publisher: {
      '@type': 'Organization',
      name: 'JusConsulta — Acompanhamento Processual Inteligente',
      url: SITE_URL
    }
  };

  return (
    <div className="min-h-screen bg-[color:var(--tt-ink)] text-white">
      {/* Script JSON-LD */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Header Público */}
      <header className="border-b border-white/10 bg-[color:var(--tt-ink)]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-2 font-bold text-white tracking-tight">
            <img src="/jusconsulta-mark.svg" alt="JusConsulta" width={28} height={31} />
            <span className="text-lg">JusConsulta</span>
            <span className="rounded-full border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--tt-text-2)]">
              Consulta Pública
            </span>
          </Link>

          <Link
            href={`/consulta?busca=${digits}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#1E7CF2]/40 bg-[#1E7CF2]/15 px-3.5 py-1.5 text-xs font-medium text-[color:var(--tt-text-2)] transition-colors hover:bg-[#1E7CF2]/25"
          >
            <span>Monitorar no WhatsApp</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Breadcrumb simples */}
        <nav aria-label="Navegação" className="mb-4 flex items-center gap-2 text-xs text-white/50">
          <Link href="/" className="hover:text-white transition-colors">
            Início
          </Link>
          <span>/</span>
          <span className="text-white/80">{tribunalExibicao}</span>
          <span>/</span>
          <span className="text-[#1E7CF2] font-mono">{cnjFormatado}</span>
        </nav>

        {/* Título e Header do Processo */}
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-xl backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1E7CF2]">
                <Gavel size={14} />
                Processo Judicial
              </span>
              <h1 className="mt-1 font-mono text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {cnjFormatado}
              </h1>
              <p className="mt-1 text-sm text-white/60">
                {[tribunalExibicao, orgaoExibicao, classeExibicao].filter(Boolean).join(' · ')}
              </p>
            </div>

            <div className="flex flex-col items-end gap-1">
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
                Ativo para consulta pública
              </span>
              <span className="text-[11px] text-white/40">
                Última conferência: {fmtData(processoDb?.ultimaMovimentacaoEm || null)}
              </span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 sm:grid-cols-4">
            <div>
              <p className="text-[11px] text-white/40">Tribunal</p>
              <p className="text-sm font-medium text-white/90">{tribunalExibicao}</p>
            </div>
            <div>
              <p className="text-[11px] text-white/40">Órgão Julgador</p>
              <p className="text-sm font-medium text-white/90 truncate" title={orgaoExibicao}>
                {orgaoExibicao}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-white/40">Classe Processual</p>
              <p className="text-sm font-medium text-white/90 truncate" title={classeExibicao}>
                {classeExibicao}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-white/40">Assunto</p>
              <p className="text-sm font-medium text-white/90 truncate" title={assuntoExibicao}>
                {assuntoExibicao}
              </p>
            </div>
          </div>
        </section>

        {/* Banner CTA WhatsApp Conversacional */}
        <section className="mt-6 overflow-hidden rounded-3xl border border-[#1E7CF2]/30 bg-gradient-to-br from-[#1E7CF2]/15 via-[color:var(--tt-ink)] to-[color:var(--tt-ink)] p-6 shadow-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1E7CF2]/30 bg-[#1E7CF2]/10 px-2.5 py-0.5 text-xs font-semibold text-[color:var(--tt-text-2)]">
                <MessageCircle size={13} />
                Acompanhamento WhatsApp 24h
              </span>
              <h2 className="mt-2 text-xl font-bold text-white">
                Não fique no escuro: receba atualizações e tire dúvidas com nosso Agente Jurídico
              </h2>
              <p className="mt-1 text-sm text-white/70 leading-relaxed">
                Quando o processo andar, nosso Agente Inteligente explica o que aconteceu em linguagem humana e te avisa pelo WhatsApp. Sem termos difíceis e sem spam.
              </p>
            </div>

            <div className="shrink-0">
              <Link
                href={`/consulta?busca=${digits}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1E7CF2] px-6 py-3.5 text-sm font-bold text-[#FFFFFF] shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] sm:w-auto"
              >
                <MessageCircle size={17} />
                <span>Ativar no WhatsApp</span>
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </section>

        {/* Resumo com IA (O Grande Diferencial frente ao JusBrasil) */}
        {resumoIa ? (
          <section className="mt-6 rounded-3xl border border-[#1E7CF2]/30 bg-[#1E7CF2]/[0.04] p-6 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <h2 className="inline-flex items-center gap-2 text-base font-semibold text-white">
                <Sparkles size={17} className="text-[#1E7CF2]" />
                O que está acontecendo neste processo? (Resumo com IA)
              </h2>
              <span className="text-[11px] text-white/40">Gerado em {fmtData(resumoIa.criadoEm)}</span>
            </div>

            <div className="mt-3 space-y-3 text-sm leading-relaxed text-white/80">
              <p>{resumoIa.resumo}</p>
              {resumoIa.significado && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-white/70">
                  <span className="font-semibold text-white/90">Significado prático: </span>
                  {resumoIa.significado}
                </div>
              )}
              {resumoIa.proximoPasso && (
                <p className="text-white/70">
                  <span className="font-semibold text-[#1E7CF2]">Próximo passo esperado: </span>
                  {resumoIa.proximoPasso}
                </p>
              )}
            </div>
          </section>
        ) : (
          <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-[#1E7CF2]">
                <Sparkles size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Resumo explicativo por Inteligência Artificial</h3>
                <p className="text-xs text-white/50">
                  Conecte seu processo à TechTie para gerar a síntese didática e saber exatamente o que os despachos significam.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Histórico das Movimentações */}
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-white">
              <Clock size={18} strokeWidth={1.8} className="text-[#1E7CF2]" />
              Movimentações do Processo
            </h2>
            <span className="text-xs text-white/40">{movimentos.length} andamento(s) disponível(is)</span>
          </div>

          {movimentos.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/50">
              Nenhuma movimentação detalhada disponibilizada pelo tribunal até o momento.
            </div>
          ) : (
            <ul className="mt-4 list-none space-y-2.5 pl-0">
              {movimentos.map((m, idx) => (
                <li
                  key={`${m.data}-${idx}`}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-[#1E7CF2]">{fmtDia(m.data)}</span>
                    {m.tag === 'urgente' && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-red-400/40 bg-red-400/10 px-2 py-0.5 text-[10px] font-medium text-red-200">
                        <ShieldAlert size={11} />
                        Ato Urgente
                      </span>
                    )}
                    {m.tag === 'positivo' && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                        <CheckCircle2 size={11} />
                        Favorável
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-sm font-medium text-white">{m.titulo}</h3>
                  {m.descricao && m.descricao !== m.titulo && (
                    <p className="mt-1 text-xs leading-relaxed text-white/60">{m.descricao}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Rodapé de Conformidade LGPD & Transparência */}
        <section className="mt-12 rounded-3xl border border-white/5 bg-white/[0.015] p-5 text-xs text-white/40">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-white/50" />
            <div className="space-y-1">
              <p className="font-medium text-white/70">Conformidade com a LGPD e Lei de Acesso à Informação</p>
              <p className="leading-relaxed">
                As informações deste processo são públicas conforme o art. 5º, inciso LX da Constituição Federal e a Lei nº 12.527/2011.
                O JusConsulta não exibe dados de processos sob segredo de justiça, nem divulga telefones, e-mails ou dados bancários de partes.
                Se você é titular dos dados e deseja solicitar a ocultação do seu nome das buscas públicas,{' '}
                <Link href="/descadastro" className="text-[#1E7CF2] underline underline-offset-2 hover:text-white">
                  clique aqui para solicitar o bloqueio
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
