"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { User } from "@/lib/api/models"

const CurrentUserContext = createContext<User | null>(null)

export function CurrentUserProvider({ user, children }: { user: User; children: ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser() {
  const user = useContext(CurrentUserContext)
  if (!user) throw new Error("CurrentUserProvider is missing")
  return user
}