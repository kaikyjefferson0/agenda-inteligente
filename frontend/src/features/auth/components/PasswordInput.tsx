import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useState, type ComponentProps } from 'react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { cn } from '@/lib/utils'

/**
 * Password with a button to show it while typing. Paste and the password
 * managers keep working (WCAG 2.2, accessible authentication). The button has
 * a visible label and is as tall as the field (44 px, D61).
 */
export function PasswordInput({ className, ...props }: ComponentProps<'input'>) {
  const [visible, setVisible] = useState(false)
  const Icon = visible ? EyeOffIcon : EyeIcon

  return (
    <InputGroup className="h-11">
      <InputGroupInput
        {...props}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn('h-full', className)}
      />
      <InputGroupAddon align="inline-end" className="py-0 pr-0 has-[>button]:mr-0">
        <InputGroupButton
          size="sm"
          aria-controls={props.id}
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          onClick={() => setVisible((value) => !value)}
          // 42 px inside the 1 px borders; the ::after covers them, so the touch area is 44 px.
          className="relative h-[2.625rem] rounded-l-none after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] rounded-r-[calc(var(--radius)-1px)] px-3 text-[0.9375rem] font-medium text-muted-foreground hover:text-foreground"
        >
          <Icon aria-hidden="true" />
          <span aria-hidden="true">{visible ? 'Ocultar' : 'Mostrar'}</span>
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
