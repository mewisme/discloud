"use client"

import { handleClientNavigation } from "@discloud/shared/dom"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@discloud/ui/components/breadcrumb"

export function SettingsBreadcrumb({ title, settingsHref, onNavigate }: { title: string; settingsHref: string; onNavigate?: (href: string) => void }) {
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbLink asChild>
            <a href={settingsHref} className="max-w-24 truncate sm:max-w-40" onClick={(event) => onNavigate && handleClientNavigation(event, () => onNavigate(settingsHref))}>Settings</a>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator>/</BreadcrumbSeparator>
        <BreadcrumbItem className="min-w-0">
          <BreadcrumbPage className="max-w-40 truncate sm:max-w-64" title={title}>{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
