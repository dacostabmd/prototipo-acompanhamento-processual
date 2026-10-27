'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Loader2, Lock, Search } from 'lucide-react';
import styles from './BuscaPublica.module.css';
import type { ProcessoDjenPublico } from '@/lib/djen';

interface Props {
  /** Partes, órgão e datas só aparecem com login: leva ao cartão de login com o processo em contexto. */
  onEntrar: (processo: ProcessoDjenPublico) => void;
  /** Busca por CPF/CNPJ é paga (Infosimples): só com conta. */
  onCriarConta: () => void;
}

/**
 * Busca pública do login no modelo Jusbrasil: prévia grátis por nome ou CNJ (DJEN) com número, tribunal e classe;
 * partes e andamento ficam desfocados até o login (a API pública nem envia esses campos).
 */
export default function BuscaPublica({ onEntrar, onCriarConta }: Props) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<{ codigo: string; mensagem: string } | null>(null);
  const [processos, setProcessos] = useState<ProcessoDjenPublico[] | null>(null);
  const [total, setTotal] = useState(0);

  const buscar = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim() || loading) return;
    setLoading(true);
    setErro(null);
    setProcessos(null);
    try {
      const res = await fetch(`/api/publico/busca?q=${encodeURIComponent(q.trim())}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro({ codigo: json.erro || 'erro', mensagem: json.mensagem || 'Não foi possível buscar agora.' });
        return;
      }
      setProcessos(json.processos ?? []);
      setTotal(json.total ?? 0);
    } catch {
      setErro({ codigo: 'rede', mensagem: 'Falha de conexão. Tente novamente.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <form onSubmit={buscar} className={styles.form} role="search">
        <Search size={18} className={styles.iconeBusca} aria-hidden />
        <input
          className={styles.input}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Nome completo ou número do processo"
          aria-label="Buscar processos por nome ou número CNJ"
          maxLength={120}
        />
        <button type="submit" className={`${styles.botao} bf-btn-ouro`} disabled={loading || !q.trim()}>
          {/* texto sempre dentro de <span>: trocar nó de texto solto por <svg> quebra o React ("removeChild ... null")
              quando o tradutor do navegador ou uma extensão já envolveu esse texto em outra tag */}
          {loading ? <Loader2 size={16} className={styles.girando} /> : <span>Buscar</span>}
        </button>
      </form>
      <p className={styles.dica}>Consulta grátis nos diários oficiais. Sem cadastro.</p>

      {erro && (
        <div className={styles.aviso} role="alert">
          <AlertCircle size={16} />
          <span>{erro.mensagem}</span>
          {(erro.codigo === 'cpf_requer_conta' || erro.codigo === 'limite') && (
            <button type="button" className={styles.link} onClick={onCriarConta}>
              Criar conta grátis
            </button>
          )}
        </div>
      )}

      {processos && processos.length === 0 && (
        <div className={styles.aviso}>
          <AlertCircle size={16} />
          <span>
            Nenhuma publicação recente como autor. A varredura completa nos tribunais, por CPF, fica disponível com uma conta.
          </span>
          <button type="button" className={styles.link} onClick={onCriarConta}>
            Criar conta grátis
          </button>
        </div>
      )}

      {processos && processos.length > 0 && (
        <>
          <p className={styles.resumo}>
            <span>
              {`${total} ${total === 1 ? 'processo encontrado' : 'processos encontrados'}${
                total > processos.length ? ` (mostrando ${processos.length})` : ''
              }`}
            </span>
          </p>
          <ul className={styles.lista}>
            {processos.map(p => (
              <li key={p.numeroCnj} className={styles.item}>
                <div className={styles.itemTopo}>
                  <span className={styles.cnj}>{p.numeroFormatado}</span>
                  <span className={styles.tribunal}>{p.tribunal}</span>
                </div>
                <p className={styles.classe}>{p.classe || 'Processo judicial'}</p>
                <button
                  type="button"
                  className={styles.bloqueado}
                  onClick={() => onEntrar(p)}
                  aria-label="Entre para ver as partes, o órgão julgador e a última publicação"
                >
                  {/* texto fictício: só dá forma ao desfoque, os dados reais não vêm na resposta pública */}
                  <span className={styles.borrado} aria-hidden>
                    <span>FULANO DE TAL DA SILVA, SOCIEDADE DE ADVOGADOS EXEMPLO</span>
                    <span>Foro Central - Vara Exemplo - Última publicação em 00/00/0000</span>
                  </span>
                  <span className={styles.cadeado}>
                    <Lock size={14} /> Entre para ver partes e andamentos
                  </span>
                </button>
                <div className={styles.acoes}>
                  <Link href={`/processo/${p.numeroCnj}`} className={`${styles.acaoSecundaria} bf-btn-sec`}>
                    Ver andamento <ArrowRight size={14} />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
