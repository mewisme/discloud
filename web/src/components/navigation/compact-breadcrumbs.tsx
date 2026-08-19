"use client"

import type { MouseEvent } from "react"
import { Fragment } from "react"
import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export type CompactBreadcrumbItem = {
  id: string
  label: string
  href?: string
}

export function CompactBreadcrumbs({ items, onNavigate }: { items: readonly CompactBreadcrumbItem[]; onNavigate?: (item: CompactBreadcrumbItem) => void }) {
  if (items.length === 0) return null

  const collapsed = items.length > 4
  const first = items[0]
  const middle = collapsed ? items.slice(1, -2) : []
  const visible = collapsed ? items.slice(-2) : items

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {collapsed && (
          <>
            <BreadcrumbEntry item={first} current={false} onNavigate={onNavigate} />
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded-md outline-none hover:text-foreground">
                  <BreadcrumbEllipsis />
                  <span className="sr-only">Show hidden folders</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {middle.map((item) => (
                    <DropdownMenuItem key={item.id} asChild>
                      <a href={item.href} onClick={(event) => activate(event, item, onNavigate)}>{item.label}</a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}

        {visible.map((item, index) => {
          const current = item.id === items[items.length - 1].id

          return (
            <Fragment key={item.id}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbEntry item={item} current={current} onNavigate={onNavigate} />
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function BreadcrumbEntry({ item, current, onNavigate }: { item: CompactBreadcrumbItem; current: boolean; onNavigate?: (item: CompactBreadcrumbItem) => void }) {
  if (current || !item.href) {
    return (
      <BreadcrumbItem className="min-w-0">
        <BreadcrumbPage className="max-w-40 truncate sm:max-w-64" title={item.label}>{item.label}</BreadcrumbPage>
      </BreadcrumbItem>
    )
  }

  return (
    <BreadcrumbItem className="min-w-0">
      <BreadcrumbLink asChild>
        <a href={item.href} className="max-w-24 truncate sm:max-w-40" title={item.label} onClick={(event) => activate(event, item, onNavigate)}>{item.label}</a>
      </BreadcrumbLink>
    </BreadcrumbItem>
  )
}

function activate(event: MouseEvent<HTMLAnchorElement>, item: CompactBreadcrumbItem, onNavigate?: (item: CompactBreadcrumbItem) => void) {
  if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  onNavigate(item)
}