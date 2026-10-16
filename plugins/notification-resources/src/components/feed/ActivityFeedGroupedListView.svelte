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
  import { Doc, Ref } from '@hcengineering/core'
  import { ListView } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import ActivityFeedCard from './ActivityFeedCard.svelte'
  import { type FeedGroup } from './feed-query'

  export let data: FeedGroup[]
  export let selectedDocId: Ref<Doc> | undefined = undefined

  const dispatch = createEventDispatcher()

  let list: ListView
  let listSelection = 0
  let element: HTMLDivElement | undefined

  $: if (element != null) {
    element.focus()
  }

  function getGroupKey (index: number): string {
    return data[index]?.docId ?? index.toString()
  }

  function selectIndex (index: number): void {
    if (data.length === 0) return

    list.select(Math.max(0, Math.min(index, data.length - 1)))
  }

  function onKeydown (key: KeyboardEvent): void {
    if (key.code === 'ArrowUp') {
      key.stopPropagation()
      key.preventDefault()
      selectIndex(listSelection - 1)
    }
    if (key.code === 'ArrowDown') {
      key.stopPropagation()
      key.preventDefault()
      selectIndex(listSelection + 1)
    }
    if (key.code === 'Home') {
      key.stopPropagation()
      key.preventDefault()
      selectIndex(0)
    }
    if (key.code === 'End') {
      key.stopPropagation()
      key.preventDefault()
      selectIndex(data.length - 1)
    }
    if (key.code === 'Enter') {
      key.preventDefault()
      key.stopPropagation()
      const group = data[listSelection]
      if (group !== undefined) {
        dispatch('click', { group })
      }
    }
  }
</script>

<div
  class="root"
  bind:this={element}
  tabindex="0"
  role="listbox"
  aria-label="Activity feed"
  on:keydown={onKeydown}
>
  <ListView
    bind:this={list}
    bind:selection={listSelection}
    count={data.length}
    items={data}
    highlightIndex={data.findIndex((group) => group.docId === selectedDocId)}
    noScroll
    minHeight="5.625rem"
    kind="full-size"
    colorsSchema="lumia"
    lazy={true}
    getKey={getGroupKey}
  >
    <svelte:fragment slot="item" let:item={itemIndex}>
      {@const group = data[itemIndex]}
      <ActivityFeedCard
        value={group}
        on:click={(event) => {
          dispatch('click', event.detail)
          listSelection = itemIndex
        }}
      />
    </svelte:fragment>
  </ListView>
</div>

<style lang="scss">
  .root {
    &:focus {
      outline: 0;
    }
    :global(.list-item) {
      border-radius: 0;
    }
  }
</style>
