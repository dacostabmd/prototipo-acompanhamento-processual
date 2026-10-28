'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './faq.module.css';

// Acordeão animado: <details> não anima a altura de forma confiável entre navegadores,
// então o corpo usa a transição de grid-template-rows (0fr -> 1fr). A resposta fica no DOM para o SEO.
export default function FaqItem({ pergunta, resposta }: { pergunta: string; resposta: string }) {
  const [aberto, setAberto] = useState(false);
  const id = useId();

  return (
    <div className={`${styles.item} ${aberto ? styles.itemAberto : ''}`}>
      <button
        type="button"
        className={styles.pergunta}
        aria-expanded={aberto}
        aria-controls={id}
        onClick={() => setAberto(a => !a)}
      >
        <span>{pergunta}</span>
        <ChevronDown size={18} className={styles.seta} aria-hidden />
      </button>
      <div id={id} className={styles.corpo} role="region" aria-hidden={!aberto}>
        <div className={styles.corpoInterno}>
          <p className={styles.resposta}>{resposta}</p>
        </div>
      </div>
    </div>
  );
}
