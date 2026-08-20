"use client"

import { useEffect, useState } from "react"

import { LineNav } from "@/components/line-nav"

export type SettingsSectionNavItem = {
  id: string
  title: string
}

export function SettingsSectionNav({
  items,
  className,
}: {
  items: readonly SettingsSectionNavItem[]
  className?: string
}) {
  const firstHref = items[0] ? `#${items[0].id}` : undefined
  const [activeHref, setActiveHref] = useState(firstHref)

  useEffect(() => {
    if (!items.length) return

    const hash = window.location.hash
    if (items.some((item) => `#${item.id}` === hash)) setActiveHref(hash)

    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((section): section is HTMLElement => !!section)

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)

        const active = visible[0]
        if (active) setActiveHref(`#${active.target.id}`)
      },
      {
        rootMargin: "-15% 0px -65% 0px",
        threshold: [0, 0.25, 0.5, 1],
      },
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [items])

  return (
    <LineNav
      className={className}
      items={items.map((item) => ({
        title: item.title,
        href: `#${item.id}`,
      }))}
      activeHref={activeHref}
      scrollActiveIntoView={false}
      onItemClick={(item, event) => {
        const id = item.href.slice(1)
        const section = document.getElementById(id)
        if (!section) return

        event.preventDefault()
        setActiveHref(item.href)
        window.history.replaceState(null, "", item.href)
        section.scrollIntoView({ behavior: "smooth", block: "start" })
      }}
    />
  )
}