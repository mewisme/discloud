"use client"

import { Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@discloud/ui/components/breadcrumb"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@discloud/ui/components/dropdown-menu"
import { Fragment } from "react"

import { handleClientNavigation } from "@/lib/helpers"

export type CompactBreadcrumbItem = {
  id: string
  label: string
  href?: string
}

export function CompactBreadcrumbs({ items, separator, onNavigate }: { items: readonly CompactBreadcrumbItem[]; separator?: React.ReactNode; onNavigate?: (item: CompactBreadcrumbItem) => void }) {
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
            <BreadcrumbSeparator>
              {separator}
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded-md outline-none hover:text-foreground">
                  <BreadcrumbEllipsis />
                  <span className="sr-only">Show hidden folders</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {middle.map((item) => <BreadcrumbMenuEntry key={item.id} item={item} onNavigate={onNavigate} />)}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              {separator}
            </BreadcrumbSeparator>
          </>
        )}

        {visible.map((item, index) => {
          const current = item.id === items[items.length - 1].id
          return (
            <Fragment key={item.id}>
              {index > 0 && (
                <BreadcrumbSeparator>
                  {separator}
                </BreadcrumbSeparator>
              )}
              <BreadcrumbEntry item={item} current={current} onNavigate={onNavigate} />
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

function BreadcrumbEntry({ item, current, onNavigate }: { item: CompactBreadcrumbItem; current: boolean; onNavigate?: (item: CompactBreadcrumbItem) => void }) {
  if (current || (!item.href && !onNavigate)) {
    return (
      <BreadcrumbItem className="min-w-0">
        <BreadcrumbPage className="max-w-40 truncate sm:max-w-64" title={item.label}>{item.label}</BreadcrumbPage>
      </BreadcrumbItem>
    )
  }

  if (!item.href) {
    return (
      <BreadcrumbItem className="min-w-0">
        <BreadcrumbLink asChild>
          <button type="button" className="max-w-24 truncate sm:max-w-40" title={item.label} onClick={() => onNavigate?.(item)}>{item.label}</button>
        </BreadcrumbLink>
      </BreadcrumbItem>
    )
  }

  return (
    <BreadcrumbItem className="min-w-0">
      <BreadcrumbLink asChild>
        <a href={item.href} className="max-w-24 truncate sm:max-w-40" title={item.label} onClick={(event) => onNavigate && handleClientNavigation(event, () => onNavigate(item))}>{item.label}</a>
      </BreadcrumbLink>
    </BreadcrumbItem>
  )
}

function BreadcrumbMenuEntry({ item, onNavigate }: { item: CompactBreadcrumbItem; onNavigate?: (item: CompactBreadcrumbItem) => void }) {
  if (!item.href) return <DropdownMenuItem disabled={!onNavigate} onSelect={() => onNavigate?.(item)}>{item.label}</DropdownMenuItem>

  return (
    <DropdownMenuItem asChild>
      <a href={item.href} onClick={(event) => onNavigate && handleClientNavigation(event, () => onNavigate(item))}>{item.label}</a>
    </DropdownMenuItem>
  )
}