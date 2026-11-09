import {
  CalendarDaysIcon,
  ClockIcon,
  ExternalLinkIcon,
  ScissorsIcon,
  SettingsIcon,
  UsersIcon,
  CalendarOffIcon,
  type LucideIcon,
} from 'lucide-react'
import { Link, Outlet, useMatch, useResolvedPath } from 'react-router'

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
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'

import { Brand } from './Brand'
import { SkipLink } from './SkipLink'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

const AGENDA: NavItem[] = [{ to: '/painel', label: 'Agenda', icon: CalendarDaysIcon, end: true }]

const SETTINGS: NavItem[] = [
  { to: '/painel/servicos', label: 'Serviços', icon: ScissorsIcon },
  { to: '/painel/equipe', label: 'Equipe', icon: UsersIcon },
  { to: '/painel/expediente', label: 'Expediente', icon: ClockIcon },
  { to: '/painel/bloqueios', label: 'Bloqueios', icon: CalendarOffIcon },
  { to: '/painel/negocio', label: 'Negócio', icon: SettingsIcon },
]

function PanelNavItem({ item }: { item: NavItem }) {
  const { setOpenMobile } = useSidebar()
  const path = useResolvedPath(item.to)
  const active = useMatch({ path: path.pathname, end: item.end ?? false }) !== null
  const Icon = item.icon

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active}>
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

/**
 * Panel of the team (D55): a side menu from 768 px and a drawer below it.
 * The menu shows every page for now; the login step filters it by role.
 */
export function PanelLayout() {
  return (
    <SidebarProvider>
      <SkipLink />
      <Sidebar aria-label="Menu do painel">
        <SidebarHeader className="px-4 py-3">
          <Brand />
        </SidebarHeader>
        <SidebarContent>
          <NavGroup label="Atendimento" items={AGENDA} />
          <NavGroup label="Configuração" items={SETTINGS} />
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link to="/">
                  <ExternalLinkIcon aria-hidden="true" />
                  <span>Voltar ao site</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset id="conteudo">
        <header className="flex h-14 items-center gap-2 border-b px-4 md:hidden">
          <SidebarTrigger className="-ml-1 size-9" />
          <span className="font-semibold tracking-tight">Painel</span>
        </header>
        <div className="flex flex-1 flex-col">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
