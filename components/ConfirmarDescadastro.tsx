'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BellOff, CircleCheck, CircleAlert, LoaderCircle } from 'lucide-react';

type Estado = 'confirmar' | 'enviando' | 'concluido' | 'erro';

/**
 * Confirmação do descadastro vindo do link do e-mail. Abrir a página não muda nada (scanners de link
 * abrem tudo); só o botão desliga o aviso.
 */
export default function ConfirmarDescadastro({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado>(token ? 'confirmar' : 'erro');
  const [mensagemErro, setMensagemErro] = useState(token ? '' : 'Link de descadastro incompleto.');
  const [numeroCnj, setNumeroCnj] = useState('');

  async function confirmar() {
    setEstado('enviando');
    try {
      const res = await fetch('/api/descadastro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMensagemErro(corpo.error ?? 'Não foi possível concluir agora.');
        setEstado('erro');
        return;
      }
      setNumeroCnj(corpo.numeroCnj ?? '');
      setEstado('concluido');
    } catch {
      setMensagemErro('Sem conexão. Tente de novo.');
      setEstado('erro');
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#15161a] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 text-center shadow-sm backdrop-blur-md sm:p-8">
        {estado === 'concluido' ? (
          <>
            <CircleCheck size={40} strokeWidth={1.6} className="mx-auto text-[#e8d5b0]" />
            <h1 className="mt-4 text-xl font-semibold text-white">Pronto, avisos desligados</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Você não vai mais receber e-mails sobre {numeroCnj ? <strong className="text-white/80">{numeroCnj}</strong> : 'este processo'}. Os outros processos
              continuam como estavam, e você pode religar em Meus processos.
            </p>
          </>
        ) : estado === 'erro' ? (
          <>
            <CircleAlert size={40} strokeWidth={1.6} className="mx-auto text-red-300" />
            <h1 className="mt-4 text-xl font-semibold text-white">Não deu certo</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              {mensagemErro} Você também pode desligar os avisos em Meus processos, depois de entrar na sua conta.
            </p>
          </>
        ) : (
          <>
            <BellOff size={40} strokeWidth={1.6} className="mx-auto text-[#e8d5b0]" />
            <h1 className="mt-4 text-xl font-semibold text-white">Parar os avisos deste processo?</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Você deixa de receber e-mails quando este processo tiver movimentação. Os outros processos continuam como estão.
            </p>
            <button
              type="button"
              onClick={confirmar}
              disabled={estado === 'enviando'}
              className="bf-btn-ouro mt-6 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#e8d5b0] px-5 py-3 text-sm font-semibold text-[#15161a] disabled:cursor-wait disabled:opacity-70"
            >
              {estado === 'enviando' && <LoaderCircle size={16} className="animate-spin" />}
              Parar avisos por e-mail
            </button>
          </>
        )}
        <Link href="/" className="mt-6 inline-block cursor-pointer text-xs text-white/50 underline-offset-2 hover:text-white/80 hover:underline">
          Ir para a TechTie
        </Link>
      </div>
    </main>
  );
}
