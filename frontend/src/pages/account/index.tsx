// Account group (D54): loaded on demand as one chunk.
import { PlaceholderPage } from '@/components/layout/PlaceholderPage'

export function LoginPage() {
  return (
    <PlaceholderPage
      title="Entrar"
      description="Aqui o Dono e os profissionais vão entrar com e-mail e senha para abrir o painel."
    />
  )
}

export function ForgotPasswordPage() {
  return (
    <PlaceholderPage
      title="Esqueci minha senha"
      description="Aqui será possível pedir, pelo e-mail da conta, um link para definir uma nova senha."
    />
  )
}

export function InvitationPage() {
  return (
    <PlaceholderPage
      hasToken
      title="Aceitar convite"
      description="Aqui o profissional convidado vai definir a senha e passar a entrar no painel."
    />
  )
}

/** Path of the e-mail sent by `app/services/passwords.py`: `/recuperar-senha/<token>`. */
export function ResetPasswordPage() {
  return (
    <PlaceholderPage
      hasToken
      title="Definir nova senha"
      description="Aqui será definida a nova senha pelo link recebido por e-mail, que vale por uma hora."
    />
  )
}
