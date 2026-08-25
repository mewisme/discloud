"use client"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@discloud/ui/components/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar } from "@discloud/ui/components/sidebar"
import { ChevronRightIcon, LibraryIcon, LineChartIcon } from "lucide-react"
import { type ComponentType, type ReactElement, type ReactNode, useEffect, useState } from "react"
import { type AppNavItem, isAppNavItemActive } from "../core/navigation"

export type AppLinkRenderer = (props: { href: string; children: ReactNode; onNavigate?: () => void }) => ReactElement
export type AppNavGroup = { title: string; icon: ComponentType<{ className?: string }>; items: AppNavItem[] }

export function AppSidebarView({
  side = "left",
  variant = "sidebar",
  collapsible = "icon",
  pathname,
  primaryItems,
  libraryItems,
  insightItems,
  utilityItems,
  workspaceGroups = [],
  administrationItems = [],
  header,
  footer,
  renderLink,
}: {
  side?: "left" | "right"
  variant?: "sidebar" | "floating"
  collapsible?: "offcanvas" | "icon" | "none"
  pathname: string
  primaryItems: AppNavItem[]
  libraryItems: AppNavItem[]
  insightItems: AppNavItem[]
  utilityItems: AppNavItem[]
  workspaceGroups?: AppNavGroup[]
  administrationItems?: AppNavItem[]
  header?: ReactNode
  footer?: ReactNode
  renderLink: AppLinkRenderer
}) {
  const submenuSide = side === "left" ? "right" : "left"

  return (
    <Sidebar side={side} variant={variant} collapsible={collapsible}>
      {header ? <SidebarHeader>{header}</SidebarHeader> : null}

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <AppNavItems pathname={pathname} items={primaryItems} renderLink={renderLink} />
              {workspaceGroups.map((group) => <GroupedNavItem key={group.title} title={group.title} icon={group.icon} items={group.items} pathname={pathname} dropdownSide={submenuSide} renderLink={renderLink} />)}
              <GroupedNavItem title="Library" icon={LibraryIcon} items={libraryItems} pathname={pathname} dropdownSide={submenuSide} renderLink={renderLink} />
              <GroupedNavItem title="Insights" icon={LineChartIcon} items={insightItems} pathname={pathname} dropdownSide={submenuSide} renderLink={renderLink} />
              <AppNavItems pathname={pathname} items={utilityItems} renderLink={renderLink} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {administrationItems.length > 0 ? <NavSection title="Administration" items={administrationItems} pathname={pathname} renderLink={renderLink} /> : null}
      </SidebarContent>

      {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
      <SidebarRail />
    </Sidebar>
  )
}

function NavSection({ title, items, pathname, renderLink }: { title: string; items: AppNavItem[]; pathname: string; renderLink: AppLinkRenderer }) {
  if (items.length === 0) return null
  return <SidebarGroup><SidebarGroupLabel>{title}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu><AppNavItems pathname={pathname} items={items} renderLink={renderLink} /></SidebarMenu></SidebarGroupContent></SidebarGroup>
}

function AppNavItems({ pathname, items, renderLink }: { pathname: string; items: AppNavItem[]; renderLink: AppLinkRenderer }) {
  const { setOpenMobile } = useSidebar()

  return items.map((item) => (
    <SidebarMenuItem key={item.href}>
      <SidebarMenuButton asChild isActive={isAppNavItemActive(pathname, item)} tooltip={item.title}>
        {renderLink({
          href: item.href,
          onNavigate: () => setOpenMobile(false),
          children: (
            <>
              <item.icon />
              <span>{item.title}</span>
            </>
          ),
        })}
      </SidebarMenuButton>
    </SidebarMenuItem>
  ))
}

function GroupedNavItem({ title, icon: Icon, items, pathname, dropdownSide, renderLink }: { title: string; icon: ComponentType<{ className?: string }>; items: AppNavItem[]; pathname: string; dropdownSide: "left" | "right"; renderLink: AppLinkRenderer }) {
  const { state, isMobile, setOpenMobile } = useSidebar()
  const active = items.some((item) => isAppNavItemActive(pathname, item))
  const [open, setOpen] = useState(active)

  useEffect(() => { if (active) setOpen(true) }, [active])

  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><SidebarMenuButton isActive={active} tooltip={title}><Icon /><span>{title}</span></SidebarMenuButton></DropdownMenuTrigger>
          <DropdownMenuContent side={dropdownSide} align="start" sideOffset={8} className="w-48">
            {items.map((item) => <DropdownMenuItem key={item.href} asChild>{renderLink({ href: item.href, onNavigate: () => setOpenMobile(false), children: <><item.icon />{item.title}</> })}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild><SidebarMenuButton isActive={active} tooltip={title}><Icon /><span>{title}</span><ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" /></SidebarMenuButton></CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-4 border-l pl-2">
            <SidebarMenu>
              <AppNavItems pathname={pathname} items={items} renderLink={renderLink} />
            </SidebarMenu>
          </div>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}
