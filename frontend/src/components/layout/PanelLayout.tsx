import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  ClockIcon,
  LogOutIcon,
  MenuIcon,
  ScissorsIcon,
  SettingsIcon,
  UsersIcon,
  CalendarOffIcon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, Outlet, useMatch, useResolvedPath } from 'react-router'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar'

import { Brand } from './Brand'
import { SkipLink } from './SkipLink'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /** Shown only to the Owner (D74). */
  ownerOnly?: boolean
}

/** Who is in the panel, from `GET /auth/me`; `null` while it loads. */
export interface PanelAccount {
  userName: string
  businessName: string
  roleLabel: string
  isOwner: boolean
}

interface PanelLayoutProps {
  account: PanelAccount | null
  onLogout: () => void
  loggingOut?: boolean
}

const AGENDA: NavItem[] = [{ to: '/painel', label: 'Agenda', icon: CalendarDaysIcon, end: true }]

const SETTINGS: NavItem[] = [
  { to: '/painel/servicos', label: 'Serviços', icon: ScissorsIcon, ownerOnly: true },
  { to: '/painel/equipe', label: 'Equipe', icon: UsersIcon, ownerOnly: true },
  { to: '/painel/expediente', label: 'Expediente', icon: ClockIcon },
  { to: '/painel/bloqueios', label: 'Bloqueios', icon: CalendarOffIcon },
  { to: '/painel/negocio', label: 'Negócio', icon: SettingsIcon, ownerOnly: true },
]

function PanelNavItem({ item }: { item: NavItem }) {
  const { setOpenMobile } = useSidebar()
  const path = useResolvedPath(item.to)
  const active = useMatch({ path: path.pathname, end: item.end ?? false }) !== null
  const Icon = item.icon

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} className="h-11 md:h-8">
        <Link
          to={item.to}
          aria-current={active ? 'page' : undefined}
          onClick={() => setOpenMobile(false)}
        >
          <Icon aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * Opens the drawer below 768 px: 44 px, with a visible label (D55).
 *
 * The drawer is the Sheet of the shadcn sidebar. Radix only gives the focus
 * back to a `SheetTrigger`, and the sidebar opens it with a plain button, so
 * on close (Esc, tap outside or a menu item) the focus would fall on `<body>`.
 * The button takes it back when `openMobile` goes from open to closed, as
 * soon as Radix removes the `aria-hidden` it puts on the rest of the page
 * while the drawer leaves; focusing inside it earlier would be blocked.
 */
function MobileMenuButton() {
  const { openMobile, toggleSidebar } = useSidebar()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(openMobile)

  useEffect(() => {
    const closed = wasOpen.current && !openMobile
    wasOpen.current = openMobile
    if (!closed) return

    let frame = 0
    const deadline = performance.now() + 2000
    const giveFocusBack = () => {
      const button = buttonRef.current
      if (button === null) return
      if (button.closest('[aria-hidden="true"]') !== null && performance.now() < deadline) {
        frame = requestAnimationFrame(giveFocusBack)
        return
      }
      button.focus()
    }
    frame = requestAnimationFrame(giveFocusBack)
    return () => cancelAnimationFrame(frame)
  }, [openMobile])

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      className="-ml-2 h-11 gap-2 px-3 text-[0.9375rem]"
      aria-expanded={openMobile}
      onClick={toggleSidebar}
    >
      <MenuIcon aria-hidden="true" className="size-5" />
      Menu
    </Button>
  )
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <PanelNavItem key={item.to} item={item} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** Name, business and role, with the logout: at the foot of the menu and of the drawer. */
function AccountFooter({ account, onLogout, loggingOut }: PanelLayoutProps) {
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      {account === null ? (
        <div aria-hidden="true" className="flex flex-col gap-1.5 px-2 py-1">
          <span className="h-4 w-32 rounded bg-sidebar-accent" />
          <span className="h-3.5 w-24 rounded bg-sidebar-accent" />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col px-2">
          <span className="truncate font-medium">{account.userName}</span>
          <span className="truncate text-sm text-muted-foreground">
            {account.roleLabel} · {account.businessName}
          </span>
        </div>
      )}
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            type="button"
            className="h-11 md:h-8"
            disabled={loggingOut}
            onClick={onLogout}
          >
            {loggingOut ? <Spinner aria-hidden="true" /> : <LogOutIcon aria-hidden="true" />}
            <span>{loggingOut ? 'Saindo…' : 'Sair'}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="h-11 md:h-8">
            <Link to="/">
              <ArrowLeftIcon aria-hidden="true" />
              <span>Voltar ao site</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  )
}

/**
 * Panel of the team (D55): a side menu from 768 px and a drawer below it. The
 * pages of the Owner leave the menu of a Professional (D74); hiding them is
 * comfort, and the API is what refuses access.
 */
export function PanelLayout({ account, onLogout, loggingOut = false }: PanelLayoutProps) {
  const settings = SETTINGS.filter((item) => item.ownerOnly !== true || account?.isOwner === true)

  return (
    <SidebarProvider>
      <SkipLink />
      <Sidebar aria-label="Menu do painel">
        <SidebarHeader className="px-4 py-3">
          <Brand />
        </SidebarHeader>
        <SidebarContent>
          <NavGroup label="Atendimento" items={AGENDA} />
          <NavGroup label="Configuração" items={settings} />
        </SidebarContent>
        <SidebarFooter>
          <AccountFooter account={account} onLogout={onLogout} loggingOut={loggingOut} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset id="conteudo">
        <header className="flex h-14 items-center justify-between gap-3 border-b px-4 md:hidden">
          <MobileMenuButton />
          <span className="truncate font-heading font-semibold tracking-tight">
            {account?.businessName ?? 'Painel'}
          </span>
        </header>
        <div className="flex flex-1 flex-col">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
