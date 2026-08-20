"use client"

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react"
import type { User } from "@/lib/api/models"

type CurrentUserContextValue = {
  user: User
  setUser: Dispatch<SetStateAction<User>>
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null)

export function CurrentUserProvider({ user, children }: { user: User; children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState(user)

  useEffect(() => {
    setCurrentUser(user)
  }, [user])

  return (
    <CurrentUserContext.Provider value={{ user: currentUser, setUser: setCurrentUser }}>
      {children}
    </CurrentUserContext.Provider>
  )
}

export function useCurrentUser() {
  const context = useContext(CurrentUserContext)
  if (!context) throw new Error("CurrentUserProvider is missing")
  return context.user
}

export function useSetCurrentUser() {
  const context = useContext(CurrentUserContext)
  if (!context) throw new Error("CurrentUserProvider is missing")
  return context.setUser
}