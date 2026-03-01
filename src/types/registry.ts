/**
 * Server-side entity registry contract.
 * This is the subset of EntityRegistryEntry that the server needs.
 * Apps register their registry via registerConfig() at startup.
 */
export interface EntityRegistryEntry {
  name: string
  namePlural: string
  icon: string
  route: string
  idField: string
  idFormat: 'simple' | 'mongodb'
  jsonFile: string
  searchFields: string[]
  enabled: boolean
  description?: string
  order?: number
  invalidatesOnWrite?: string[]
}
