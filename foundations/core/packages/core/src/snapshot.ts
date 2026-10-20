//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { type Class, type Doc, type Ref, type Space, type Timestamp } from './classes'
import { type DocumentQuery } from './storage'

/**
 * A snapshot read is a bounded, resumable live read of several queries at once.
 * One request returns one page of every section, so a client that used to
 * page several classes separately pays one round trip per page.
 *
 * @public
 */
export interface SnapshotSection {
  // Stable name. Results and continuation tokens are keyed by it.
  key: string
  // Class to read.
  _class: Ref<Class<Doc>>
  // Query inside the section. A section whose class has a space attribute is
  // always constrained to the request space by the server.
  query: DocumentQuery<Doc>
  // Rows this section may return in one page. The server bounds it.
  limit?: number
  // Read only on the first page. Useful for small reference data.
  firstPageOnly?: boolean
  // Defaults to true. A scoped section is always constrained to the request
  // space, so a caller cannot read another project through the snapshot call.
  scoped?: boolean
}

/**
 * @public
 */
export interface SnapshotRequest {
  // The space the read is scoped to.
  space: Ref<Space>
  sections: SnapshotSection[]
  // Opaque token from the previous page of the same read.
  cursor?: string
  // Ask the last page for change hints since the read began. Required for
  // reconciling rows that move behind the cursor. Check partial before use.
  includeChanges?: boolean
}

/**
 * @public
 */
export interface SnapshotSectionPage {
  key: string
  docs: Doc[]
  // Count at the time the section first runs, when supplied by storage.
  // Present on the first page only and subject to concurrent writes.
  total?: number
  // True when the section still has rows after this page.
  more: boolean
}

/**
 * @public
 */
export interface SnapshotChange {
  // Section whose query the row belongs to.
  key: string
  id: Ref<Doc>
  // The row still matches the section query at the end of the read.
  matches: boolean
  // The row was removed after the pinned version.
  removed: boolean
}

/**
 * @public
 */
export interface SnapshotFailure {
  key: string
  message: string
}

/**
 * @public
 */
export interface SnapshotPage {
  // Server time the read began. Every page carries this value, but rows are
  // read live. This is not a database snapshot or a commit-order watermark.
  version: Timestamp
  space: Ref<Space>
  sections: SnapshotSectionPage[]
  // Change hints observed since version, on the last page only. A partial
  // response means the set may be incomplete. Rows can change again afterward.
  changes?: SnapshotChange[]
  // Continuation token. Absent on the last page.
  next?: string
  // Sections that failed on this page. Their rows are incomplete.
  failures: SnapshotFailure[]
  // True when a section failed or its bounded result may be incomplete.
  partial: boolean
}
