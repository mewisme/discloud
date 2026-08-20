"use client"

import { createContext, type ReactNode, useContext } from "react"

export type Workspace = {
  id: string
  username: string
}

const WorkspaceContext = createContext<Workspace | null>(null)

export function WorkspaceProvider({ workspace, children }: { workspace: Workspace; children: ReactNode }) {
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const workspace = useContext(WorkspaceContext)
  if (!workspace) throw new Error("WorkspaceProvider is missing")
  return workspace
}