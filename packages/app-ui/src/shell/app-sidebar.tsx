"use client"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@discloud/ui/components/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@discloud/ui/components/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@discloud/ui/components/sidebar"
import { ChevronRightIcon, LibraryIcon } from "lucide-react"
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useState,
} from "react"
import {
  type AppNavItem,
  isAppNavItemActive,
} from "./navigation"

export type AppLinkRenderer = (props: {
  href: string
  children: ReactNode
  onNavigate?: () => void
}) => ReactElement

export function AppSidebarView({
  side = "left",
  variant = "inset",
  collapsible = "icon",
  pathname,
  primaryItems,
  libraryItems,
  administrationItems = [],
  header,
  footer,
  renderLink,
}: {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
  pathname: string
  primaryItems: AppNavItem[]
  libraryItems: AppNavItem[]
  administrationItems?: AppNavItem[]
  header?: ReactNode
  footer?: ReactNode
  renderLink: AppLinkRenderer
}) {
  const submenuSide = side === "left" ? "right" : "left"

  return (
    <Sidebar
      side={side}
      variant={variant}
      collapsible={collapsible}
    >
      {header ? <SidebarHeader>{header}</SidebarHeader> : null}

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <AppNavItems
                pathname={pathname}
                items={primaryItems}
                renderLink={renderLink}
              />

              <GroupedNavItem
                title="Library"
                items={libraryItems}
                pathname={pathname}
                dropdownSide={submenuSide}
                renderLink={renderLink}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {administrationItems.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <AppNavItems
                  pathname={pathname}
                  items={administrationItems}
                  renderLink={renderLink}
                />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      {footer ? <SidebarFooter>{footer}</SidebarFooter> : null}
      <SidebarRail />
    </Sidebar>
  )
}

function AppNavItems({
  pathname,
  items,
  renderLink,
}: {
  pathname: string
  items: AppNavItem[]
  renderLink: AppLinkRenderer
}) {
  const { setOpenMobile } = useSidebar()

  return items.map((item) => (
    <SidebarMenuItem key={item.href}>
      <SidebarMenuButton
        asChild
        isActive={isAppNavItemActive(pathname, item)}
        tooltip={item.title}
      >
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

function GroupedNavItem({
  title,
  items,
  pathname,
  dropdownSide,
  renderLink,
}: {
  title: string
  items: AppNavItem[]
  pathname: string
  dropdownSide: "left" | "right"
  renderLink: AppLinkRenderer
}) {
  const { state, isMobile, setOpenMobile } = useSidebar()
  const active = items.some((item) =>
    isAppNavItemActive(pathname, item),
  )
  const [open, setOpen] = useState(active)

  useEffect(() => {
    if (active) setOpen(true)
  }, [active])

  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              isActive={active}
              tooltip={title}
            >
              <LibraryIcon />
              <span>{title}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side={dropdownSide}
            align="start"
            sideOffset={8}
            className="w-48"
          >
            {items.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                {renderLink({
                  href: item.href,
                  onNavigate: () => setOpenMobile(false),
                  children: (
                    <>
                      <item.icon />
                      {item.title}
                    </>
                  ),
                })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    )
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={active}
            tooltip={title}
          >
            <LibraryIcon />
            <span>{title}</span>
            <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((item) => (
              <SidebarMenuSubItem key={item.href}>
                <SidebarMenuSubButton
                  asChild
                  isActive={isAppNavItemActive(pathname, item)}
                >
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
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}