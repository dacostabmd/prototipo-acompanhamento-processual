import type { Metadata } from 'next';
import ResetPasswordForm from '@/components/ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Redefinir senha',
  robots: { index: false, follow: false }
};

export default function RedefinirSenhaPage() {
  return <ResetPasswordForm />;
}
