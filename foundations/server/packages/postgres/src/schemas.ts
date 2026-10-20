import { DOMAIN_COLLABORATOR, DOMAIN_MODEL_TX, DOMAIN_RELATION, DOMAIN_SPACE, DOMAIN_TX } from '@hcengineering/core'

export type DataType = 'bigint' | 'bool' | 'text' | 'text[]'

export function getIndex (field: FieldSchema): string {
  if (field.indexType === undefined || field.indexType === 'btree') {
    return ''
  }
  return ` USING ${field.indexType}`
}

export interface FieldSchema {
  type: DataType
  notNull: boolean
  index: boolean
  indexType?: 'btree' | 'gin' | 'gist' | 'brin' | 'hash'
}

export type Schema = Record<string, FieldSchema>

const baseSchema: Schema = {
  _id: {
    type: 'text',
    notNull: true,
    index: false
  },
  _class: {
    type: 'text',
    notNull: true,
    index: true
  },
  space: {
    type: 'text',
    notNull: true,
    index: true
  },
  modifiedBy: {
    type: 'text',
    notNull: true,
    index: false
  },
  createdBy: {
    type: 'text',
    notNull: false,
    index: false
  },
  modifiedOn: {
    type: 'bigint',
    notNull: true,
    index: false
  },
  createdOn: {
    type: 'bigint',
    notNull: false,
    index: false
  },
  '%hash%': {
    type: 'text',
    notNull: false,
    index: false
  }
}

const defaultSchema: Schema = {
  ...baseSchema,
  attachedTo: {
    type: 'text',
    notNull: false,
    index: true
  }
}

const collaboratorSchema: Schema = {
  ...baseSchema,
  attachedTo: {
    type: 'text',
    notNull: true,
    index: true
  },
  attachedToClass: {
    type: 'text',
    notNull: true,
    index: true
  },
  collaborator: {
    type: 'text',
    notNull: true,
    index: true
  }
}

const spaceSchema: Schema = {
  ...baseSchema,
  private: {
    type: 'bool',
    notNull: true,
    index: true
  },
  members: {
    type: 'text[]',
    notNull: true,
    index: true,
    indexType: 'gin'
  },
  archived: {
    type: 'bool',
    notNull: true,
    index: true
  }
}

const relationSchema: Schema = {
  ...baseSchema,
  docA: {
    type: 'text',
    notNull: true,
    index: true
  },
  docB: {
    type: 'text',
    notNull: true,
    index: true
  },
  association: {
    type: 'text',
    notNull: true,
    index: true
  }
}

const txSchema: Schema = {
  ...defaultSchema,
  objectSpace: {
    type: 'text',
    notNull: true,
    index: true
  },
  objectId: {
    type: 'text',
    notNull: false,
    index: false
  }
}

const notificationSchema: Schema = {
  ...baseSchema,
  isViewed: {
    type: 'bool',
    notNull: true,
    index: true
  },
  archived: {
    type: 'bool',
    notNull: true,
    index: true
  },
  user: {
    type: 'text',
    notNull: true,
    index: true
  }
}

const dncSchema: Schema = {
  ...baseSchema,
  objectId: {
    type: 'text',
    notNull: true,
    index: true
  },
  objectClass: {
    type: 'text',
    notNull: true,
    index: false
  },
  user: {
    type: 'text',
    notNull: true,
    index: true
  }
}

const userNotificationSchema: Schema = {
  ...baseSchema,
  user: {
    type: 'text',
    notNull: true,
    index: true
  }
}

const timeSchema: Schema = {
  ...baseSchema,
  workslots: {
    type: 'bigint',
    notNull: false,
    index: true
  },
  doneOn: {
    type: 'bigint',
    notNull: false,
    index: true
  },
  user: {
    type: 'text',
    notNull: true,
    index: true
  },
  rank: {
    type: 'text',
    notNull: true,
    index: false
  }
}

const calendarSchema: Schema = {
  ...baseSchema,
  hidden: {
    type: 'bool',
    notNull: true,
    index: true
  }
}

const eventSchema: Schema = {
  ...defaultSchema,
  calendar: {
    type: 'text',
    notNull: true,
    index: true
  },
  date: {
    type: 'bigint',
    notNull: true,
    index: true
  },
  dueDate: {
    type: 'bigint',
    notNull: true,
    index: true
  },
  participants: {
    type: 'text[]',
    notNull: true,
    index: true
  }
}

const docSyncInfo: Schema = {
  ...baseSchema,
  needSync: {
    type: 'text',
    notNull: false,
    index: false
  },
  externalVersion: {
    type: 'text',
    notNull: false,
    index: false
  },
  repository: {
    type: 'text',
    notNull: false,
    index: false
  },
  url: {
    type: 'text',
    notNull: false,
    index: false
  },
  parent: {
    type: 'text',
    notNull: false,
    index: false
  },
  objectClass: {
    type: 'text',
    notNull: false,
    index: false
  },
  deleted: {
    type: 'bool',
    notNull: false,
    index: false
  }
}

const githubLogin: Schema = {
  ...baseSchema,
  login: {
    type: 'text',
    notNull: true,
    index: true
  }
}

export function addSchema (domain: string, schema: Schema): void {
  domainSchemas[translateDomain(domain)] = schema
  domainSchemaFields.set(domain, createSchemaFields(schema))
}

export function translateDomain (domain: string): string {
  return domain.replaceAll('-', '_')
}

export interface DomainIndexDefinition {
  name: string
  columns: string
  /** Access method for CREATE INDEX ... USING. Btree when unset. */
  indexType?: 'btree' | 'gin' | 'gist' | 'brin' | 'hash'
}

/**
 * Indexes for query shapes that the per-field indexes from the domain schema
 * do not cover. The postgres adapter creates them with CREATE INDEX IF NOT
 * EXISTS when it attaches a workspace, so a workspace whose table already
 * exists picks them up on its next start. Every entry is selected by an
 * EXPLAIN ANALYZE plan on a captured query shape, see
 * docs/harness/reports/jh-902491-backlog-c3/report.md.
 */
export const domainIndexDefinitions: Record<string, DomainIndexDefinition[]> = {
  tags: [
    {
      name: 'tags_workspace_attachedto_id',
      columns: '"workspaceId", "attachedTo", _id'
    }
  ]
}

export const domainSchemas: Record<string, Schema> = {
  [DOMAIN_SPACE]: spaceSchema,
  [DOMAIN_TX]: txSchema,
  [DOMAIN_MODEL_TX]: txSchema,
  [translateDomain('time')]: timeSchema,
  [translateDomain('calendar')]: calendarSchema,
  [translateDomain('event')]: eventSchema,
  notification: notificationSchema,
  [translateDomain('notification-dnc')]: dncSchema,
  [translateDomain('notification-user')]: userNotificationSchema,
  [translateDomain('github_sync')]: docSyncInfo,
  [translateDomain('github_user')]: githubLogin,
  [DOMAIN_RELATION]: relationSchema,
  [DOMAIN_COLLABORATOR]: collaboratorSchema,
  kanban: defaultSchema
}

export function getSchema (domain: string): Schema {
  return domainSchemas[translateDomain(domain)] ?? defaultSchema
}

/**
 * getTableSchema replaces an entry in domainSchemas with the columns read from
 * an existing table, and those fields all carry `index: false`. Keep the
 * declared schemas in a separate map so the single-field indexes are still
 * known when the table already exists, which is the case for a restored
 * workspace.
 */
const declaredSchemas: Record<string, Schema> = { ...domainSchemas }

/**
 * Schema fields whose single-field index made a measured board read slower on
 * the restored JH snapshot, so the adapter leaves that index out. The
 * supervision read went from 56.9 s to 490.3 s at one client with the activity
 * index outside this list. See docs/reports/jh-902531-backlog-c1/report.md.
 */
export const schemaIndexExclusions: Record<string, string[]> = {
  activity: ['attachedTo'],
  task: ['space']
}

/**
 * The single-field indexes a domain schema declares with `index: true`, named
 * the way the postgres adapter has always named them: <domain>_<field>.
 */
export function getSchemaIndexDefinitions (domain: string): DomainIndexDefinition[] {
  const schema = declaredSchemas[translateDomain(domain)] ?? defaultSchema
  const excluded = new Set(schemaIndexExclusions[translateDomain(domain)] ?? [])
  const indexes: DomainIndexDefinition[] = []
  for (const key in schema) {
    const field = schema[key]
    if (field.index && !excluded.has(key)) {
      indexes.push({ name: `${domain}_${key}`, columns: `"${key}"`, indexType: field.indexType })
    }
  }
  return indexes
}

export function getDocFieldsByDomains (domain: string): string[] {
  const schema = domainSchemas[translateDomain(domain)] ?? defaultSchema
  return Object.keys(schema)
}

export interface SchemaAndFields {
  schema: Schema

  fields: string[]
  domainFields: Set<string>
}

function createSchemaFields (schema: Schema): SchemaAndFields {
  const fields = Object.keys(schema)
  const domainFields = new Set(Object.keys(schema))
  return { schema, fields, domainFields }
}

const defaultSchemaFields: SchemaAndFields = createSchemaFields(defaultSchema)

const domainSchemaFields = new Map<string, SchemaAndFields>()
for (const [domain, _schema] of Object.entries(domainSchemas)) {
  domainSchemaFields.set(domain, createSchemaFields(_schema))
}

export function getSchemaAndFields (domain: string): SchemaAndFields {
  return domainSchemaFields.get(translateDomain(domain)) ?? defaultSchemaFields
}
