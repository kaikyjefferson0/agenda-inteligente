// Account group (D54): loaded on demand as one chunk.
import { useParams } from 'react-router'

import { ForgotPasswordScreen, LoginScreen, NewPasswordScreen } from '@/features/auth'

/** `/entrar` (UC02). */
export function LoginPage() {
  return <LoginScreen />
}

/** `/esqueci-senha` (UC03). */
export function ForgotPasswordPage() {
  return <ForgotPasswordScreen />
}

/** Path of the e-mail sent by `app/services/invitations.py`: `/convite/<token>` (UC04). */
export function InvitationPage() {
  const { token = '' } = useParams()
  return <NewPasswordScreen mode="invitation" token={token} />
}

/** Path of the e-mail sent by `app/services/passwords.py`: `/recuperar-senha/<token>` (UC03). */
export function ResetPasswordPage() {
  const { token = '' } = useParams()
  return <NewPasswordScreen mode="reset" token={token} />
}
