export interface Note {
  id: string
  spaceId: string
  title: string
  body: string
  materialRefs?: string[]
  createdAt: number
  updatedAt: number
  revision: number
}

export type PageKind = 'note' | 'material' | 'space_reference'

export interface BrainPage {
  refId: string
  kind: PageKind
  collectedAt: number
}

export interface BrainLink {
  from: string
  to: string
}

export interface Theme {
  id: string
  name: string
  color: string
  origin: 'agent' | 'user'
}

export interface Assignment {
  refId: string
  themeId: string
  by: 'agent' | 'user'
  locked: boolean
}
