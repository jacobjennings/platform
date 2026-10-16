<!--
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
-->
<script lang="ts">
  import { ActivityMessage, DisplayActivityMessage } from '@hcengineering/activity'
  import { Doc } from '@hcengineering/core'
  import { ActivityMessagePreview, combineActivityMessages, sortActivityMessages } from '@hcengineering/activity-resources'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label, Loading } from '@hcengineering/ui'
  import { getDocIdentifier, getDocTitle } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import NotifyMarker from '../NotifyMarker.svelte'
  import { type FeedGroup, newestFeedMessage } from './feed-query'

  export let value: FeedGroup

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const dispatch = createEventDispatcher()
  const query = createQuery()

  let object: Doc | undefined = undefined
  let isLoading = true

  let idTitle: string | undefined
  let title: string | undefined
  let displayMessage: DisplayActivityMessage | undefined

  $: query.query(
    value.docClass,
    { _id: value.docId },
    (res) => {
      object = res[0]
      isLoading = false
    },
    { limit: 1 }
  )

  $: if (object !== undefined && object?._id !== value.docId) {
    object = undefined
    isLoading = true
  }

  $: object &&
    getDocIdentifier(client, object._id, object._class, object).then((res) => {
      idTitle = res
    })

  $: object &&
    getDocTitle(client, object._id, object._class, object).then((res) => {
      title = res
    })

  $: void updateDisplayMessage(value.messages)

  async function updateDisplayMessage (messages: ActivityMessage[]): Promise<void> {
    const combinedMessages = combineActivityMessages(sortActivityMessages(messages))
    displayMessage = newestFeedMessage(combinedMessages)
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="card"
  on:click={() => {
    dispatch('click', { group: value, object })
  }}
>
  {#if isLoading}
    <div class="loading">
      <Loading />
    </div>
  {:else}
    <div class="header">
      <div class="labels">
        {#if idTitle}
          {idTitle}
        {:else}
          <Label label={hierarchy.getClass(value.docClass).label} />
        {/if}
        <span class="title overflow-label clear-mins" {title}>
          {#if title}
            {title}
          {:else}
            <Label label={hierarchy.getClass(value.docClass).label} />
          {/if}
        </span>
      </div>

      <div class="actions clear-mins">
        {#if value.unreadCount > 0}
          <NotifyMarker count={value.unreadCount} />
        {/if}
      </div>
    </div>
    <div class="content">
      <div class="notifications">
        {#if displayMessage !== undefined}
          <div class="notification">
            <div class="embeddedMarker" />
            <ActivityMessagePreview value={displayMessage} doc={object} space={value.space} on:click />
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .card {
    display: flex;
    position: relative;
    flex-direction: column;
    cursor: pointer;
    padding: var(--spacing-1_5) var(--spacing-1);
    border-bottom: 1px solid var(--global-ui-BorderColor);
    min-height: 5.625rem;
    .header {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-left: var(--spacing-0_5);
      .actions {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        top: -0.5rem;
        right: 0.25rem;
        gap: 0.25rem;
        color: var(--global-secondary-TextColor);
      }
    }
    .title {
      font-weight: 400;
      color: var(--global-primary-TextColor);
      min-width: 0;
      margin-right: 1rem;
    }
  }
  .notifications {
    display: flex;
    width: 100%;
    min-width: 0;
    flex-direction: column;
    margin-top: var(--spacing-1);
    margin-left: var(--spacing-2_5);
  }
  .notification {
    position: relative;
    cursor: pointer;
    user-select: none;
    .embeddedMarker {
      position: absolute;
      min-width: 0.25rem;
      border-radius: 0;
      height: 100%;
      background: var(--global-ui-highlight-BackgroundColor);
    }
    &:hover {
      .embeddedMarker {
        border-radius: 0.5rem;
        background: var(--global-primary-LinkColor);
      }
    }
  }
  .labels {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    color: var(--global-primary-TextColor);
    font-weight: 600;
    font-size: 0.875rem;
    gap: 0.25rem;
    min-width: 0;
    overflow: hidden;
    margin-right: 4rem;
  }
  .content {
    display: flex;
    width: 100%;
  }
  .loading {
    display: flex;
    align-items: center;
    flex: 1;
  }
</style>
