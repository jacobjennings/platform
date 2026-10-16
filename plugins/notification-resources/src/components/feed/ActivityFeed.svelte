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
  import activity, { ActivityMessage } from '@hcengineering/activity'
  import { Class, Doc, getCurrentAccount, Ref, SortingOrder, Space } from '@hcengineering/core'
  import { ActionContext, createQuery, getClient } from '@hcengineering/presentation'
  import task, { type Project } from '@hcengineering/task'
  import ui, {
    AnyComponent,
    Button,
    ButtonIcon,
    closePanel,
    Component,
    defineSeparators,
    deviceOptionsStore as deviceInfo,
    DropdownLabelsIntl,
    IconCheck,
    Label,
    Scroller,
    Separator
  } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { onDestroy } from 'svelte'

  import notification from '../../plugin'
  import SettingsButton from '../inbox/SettingsButton.svelte'
  import ActivityFeedGroupedListView from './ActivityFeedGroupedListView.svelte'
  import {
    FEED_PAGE_SIZE,
    type FeedGroup,
    type FeedReadState,
    feedMessagesQuery,
    groupFeedMessages,
    hasMoreFeedMessages,
    loadFeedProject,
    loadFeedReadState,
    markAllFeedRead,
    markFeedDocRead,
    messageTime,
    nextFeedLimit,
    saveFeedProject,
    saveFeedReadState
  } from './feed-query'

  interface FeedSelection {
    _id: Ref<Doc>
    _class: Ref<Class<Doc>>
    space: Ref<Space>
  }

  const ALL_PROJECTS = 'all'

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const acc = getCurrentAccount()
  const storage = localStorage

  let replacedPanel: HTMLElement

  let projects: Project[] = []
  let projectChoice: string = loadFeedProject(storage, acc.uuid) ?? ALL_PROJECTS
  let selectedProject: Ref<Space> | undefined = undefined

  let limit = FEED_PAGE_SIZE
  let messages: ActivityMessage[] = []

  let readState: FeedReadState = loadFeedReadState(storage, acc.uuid)
  let unreadOnly = false

  let selected: FeedSelection | undefined = undefined
  let selectedComponent: AnyComponent | undefined = undefined

  const projectsQuery = createQuery()
  const messagesQuery = createQuery()

  projectsQuery.query(
    task.class.Project,
    { archived: false },
    (res) => {
      projects = res
    },
    { sort: { name: SortingOrder.Ascending } }
  )

  $: selectedProject = projectChoice === ALL_PROJECTS ? undefined : (projectChoice as Ref<Space>)

  // A remembered project that is archived or not visible any more falls back to all projects.
  $: if (projects.length > 0 && projectChoice !== ALL_PROJECTS && !projects.some(({ _id }) => _id === projectChoice)) {
    projectChoice = ALL_PROJECTS
  }

  $: messagesQuery.query(
    activity.class.ActivityMessage,
    feedMessagesQuery(selectedProject),
    (res) => {
      messages = res
    },
    {
      sort: { createdOn: SortingOrder.Descending },
      limit
    }
  )

  $: groups = groupFeedMessages(messages, readState)
  $: visibleGroups = unreadOnly ? groups.filter(({ unreadCount }) => unreadCount > 0) : groups
  $: hasMore = hasMoreFeedMessages(messages.length, limit)

  $: projectItems = [
    { id: ALL_PROJECTS, label: notification.string.All },
    ...projects.map((project) => ({ id: project._id, label: getEmbeddedLabel(project.name) }))
  ]

  $: selectedComponent =
    selected !== undefined
      ? (hierarchy.classHierarchyMixin(selected._class, view.mixin.ObjectPanel)?.component ?? view.component.EditDoc)
      : undefined

  $: items = [
    {
      id: 'unread',
      on: unreadOnly,
      label: notification.string.Unreads,
      onToggle: () => {
        unreadOnly = !unreadOnly
      }
    }
  ]

  $: $deviceInfo.replacedPanel = replacedPanel

  function onProjectSelected (event: CustomEvent<string | undefined>): void {
    if (event.detail === undefined) return

    projectChoice = event.detail
    limit = FEED_PAGE_SIZE
    saveFeedProject(storage, acc.uuid, projectChoice === ALL_PROJECTS ? undefined : (projectChoice as Ref<Space>))
  }

  function loadMore (): void {
    limit = nextFeedLimit(limit)
  }

  function markAllRead (): void {
    const newest = messages.reduce((time, message) => Math.max(time, messageTime(message)), 0)
    readState = markAllFeedRead(readState, newest)
    saveFeedReadState(storage, acc.uuid, readState)
  }

  function selectGroup (event: CustomEvent<{ group: FeedGroup }>): void {
    const { group } = event.detail
    closePanel()

    selected = { _id: group.docId, _class: group.docClass, space: group.space }
    readState = markFeedDocRead(readState, group.docId, group.lastTime)
    saveFeedReadState(storage, acc.uuid, readState)
  }

  defineSeparators('activity-feed', [
    { minSize: 20, maxSize: 50, size: 40, float: 'navigator' },
    { size: 'auto', minSize: 20, maxSize: 'auto' },
    { size: 20, minSize: 20, maxSize: 50, float: 'aside' }
  ])

  onDestroy(() => {
    $deviceInfo.replacedPanel = undefined
  })
</script>

<ActionContext
  context={{
    mode: 'browser'
  }}
/>

<div class="hulyPanels-container">
  {#if $deviceInfo.navigator.visible}
    <div
      class="antiPanel-navigator {$deviceInfo.navigator.direction === 'horizontal'
        ? 'portrait'
        : 'landscape'} border-left"
      class:fly={$deviceInfo.navigator.float}
    >
      <div class="antiPanel-wrap__content hulyNavPanel-container">
        <div class="hulyNavPanel-header withButton small">
          <span class="overflow-label"><Label label={activity.string.Activity} /></span>
          <div class="flex-row-center flex-gap-2">
            <SettingsButton {items} />
            <ButtonIcon
              icon={IconCheck}
              kind="tertiary"
              size="small"
              tooltip={{ label: notification.string.MarkReadAll }}
              on:click={markAllRead}
            />
          </div>
        </div>

        <div class="tabs">
          <DropdownLabelsIntl items={projectItems} selected={projectChoice} on:selected={onProjectSelected} />
        </div>

        <Scroller padding="0">
          <ActivityFeedGroupedListView
            data={visibleGroups}
            selectedDocId={selected?._id}
            on:click={selectGroup}
          />
          {#if hasMore}
            <div class="show-more">
              <Button label={ui.string.ShowMore} kind="link" on:click={loadMore} />
            </div>
          {/if}
        </Scroller>
      </div>
      {#if !($deviceInfo.isMobile && $deviceInfo.isPortrait && $deviceInfo.minWidth)}
        <Separator name="activity-feed" float={$deviceInfo.navigator.float ? 'navigator' : true} index={0} />
      {/if}
    </div>
    <Separator
      name="activity-feed"
      float={$deviceInfo.navigator.float}
      index={0}
      color={'transparent'}
      separatorSize={0}
      short
    />
  {/if}
  <div bind:this={replacedPanel} class="hulyComponent">
    {#if selected && selectedComponent}
      <Component
        is={selectedComponent}
        props={{
          _id: selected._id,
          _class: selected._class,
          space: selected.space,
          autofocus: false,
          embedded: true,
          props: { autofocus: false }
        }}
        on:close={() => {
          selected = undefined
        }}
      />
    {/if}
  </div>
</div>

<style lang="scss">
  .tabs {
    display: flex;
    align-items: center;
    padding: var(--spacing-0_5) var(--spacing-1_5);
    border-bottom: 1px solid var(--theme-navpanel-border);
  }
  .show-more {
    display: flex;
    justify-content: center;
    padding: var(--spacing-1);
  }
</style>
