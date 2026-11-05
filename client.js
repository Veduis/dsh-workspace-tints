/**
 * Workspace tints — a quiet gradient colour code for Workspaces, plus a green
 * "finished, unread" row.
 *
 * Every Workspace owns one tone from a single warm-to-cool ramp of tinted
 * whites. The tone paints the Workspace's own header row (a soft horizontal
 * wash plus a 2px rail) and a 2px rail on each of its Session rows, so a long
 * sidebar separates itself without adding saturated accents. The ramp skips
 * green, which is reserved for a Session that finished and has not been read:
 * that row's whole background carries the same green as its status dot.
 *
 * Tones are derived once per Workspace folder and remembered, so renaming a
 * Workspace keeps its colour and adding a Workspace never recolours the
 * existing ones.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-tints',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useMemo, useSyncExternalStore } = React

    const NS = 'workspace-tints'
    const STORAGE_KEY = 'dsh.workspace-tints.v1'
    const STYLE_KEY = 'dsh-workspace-tints/tones.css'

    /**
     * The ramp: twelve hues at one lightness and one low chroma, so every tone
     * reads as tinted white rather than as a colour. The green band is left out
     * on purpose: a green row means "finished, unread" (see DONE_SELECTOR), and
     * a Workspace tint must never be mistaken for that signal.
     */
    const HUES = [8, 24, 40, 56, 210, 228, 246, 264, 282, 300, 318, 336]
    /** The first ramp, kept only to carry stored assignments onto the green-free one. */
    const LEGACY_HUES = [30, 57, 84, 111, 138, 165, 192, 219, 246, 273, 300, 327]
    const SCHEMA = 2
    const TONE_L = 0.62
    const TONE_C = 0.052

    /** The finished-and-unread wash reuses the colour of the row's own status dot. */
    const SUCCESS = 'var(--dsw-alias-state-success-primary)'

    /** Intensity presets; the numbers are color-mix percentages against the sidebar fill. */
    const LEVELS = [
      { id: 'off', strong: 0, mid: 0, rail: 0 },
      { id: 'whisper', strong: 10, mid: 4, rail: 30 },
      { id: 'soft', strong: 17, mid: 7, rail: 48 },
    ]
    const DEFAULT_LEVEL = 'soft'

    const FILL = 'var(--dsw-specific-sidebar-fill, Canvas)'
    const TONE_VAR = '--dsh-workspace-tint'

    const EN = {
      title: 'Workspace tints',
      description:
        'Each Workspace keeps one tone from a single warm-to-cool gradient of tinted whites. The tone washes its header and draws a thin rail beside its Sessions, so neighbouring Workspaces separate without adding loud colour. The ramp skips green, which is reserved for finished chats.',
      intensity: 'Intensity',
      off: 'Off',
      whisper: 'Whisper',
      soft: 'Soft',
      legend: 'Current tones',
      legendHint:
        'A tone is remembered per folder. A new Workspace takes the tone farthest from the ones in use, so the Workspaces you already know keep their colour.',
      empty: 'No Workspaces yet.',
      ungrouped: 'Sessions outside every Workspace stay neutral.',
      hierarchyNote:
        'Workspace names are set as section headings, and their Sessions indent beneath them.',
      doneNote:
        'A Session that finished and is still unread tints its whole row green — the same green as its status dot.',
    }

    const ZH = {
      title: '工作区色阶',
      description:
        '每个工作区都从同一条由暖到冷的“白瓷”渐变中取一个色调：色调轻染其标题行，并在其会话旁画一条细轨，让相邻工作区自然分开，而不引入刺眼的颜色。色阶避开绿色，绿色只留给已完成的会话。',
      intensity: '强度',
      off: '关闭',
      whisper: '微光',
      soft: '柔和',
      legend: '当前色调',
      legendHint:
        '色调按文件夹记录。新增工作区会取与已用色调相距最远的色调，已有工作区不会因此换色。',
      empty: '还没有工作区。',
      ungrouped: '不属于任何工作区的会话保持中性。',
      hierarchyNote: '工作区名称作为分组标题，其会话缩进在其下方。',
      doneNote: '已完成但尚未阅读的会话，整行会染上与其状态圆点相同的绿色。',
    }

    // ---------------------------------------------------------------- palette

    function toneOf(slot) {
      const index = ((slot % HUES.length) + HUES.length) % HUES.length
      return 'oklch(' + TONE_L + ' ' + TONE_C + ' ' + HUES[index] + ')'
    }

    function hashPath(path) {
      let hash = 2166136261
      for (let index = 0; index < path.length; index += 1) {
        hash ^= path.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
      }
      return hash >>> 0
    }

    function hueDistance(left, right) {
      const raw = Math.abs(left - right) % 360
      return raw > 180 ? 360 - raw : raw
    }

    function nearestSlotForHue(hue) {
      let best = 0
      let bestDistance = 361
      for (let slot = 0; slot < HUES.length; slot += 1) {
        const distance = hueDistance(HUES[slot], hue)
        if (distance < bestDistance) {
          bestDistance = distance
          best = slot
        }
      }
      return best
    }

    /**
     * Pick the ramp slot farthest from every slot already in use, scanning
     * from the Workspace's own hash offset so ties stay deterministic. Two
     * Workspaces therefore never land on neighbouring tones until the ramp is
     * nearly exhausted.
     */
    function pickSlot(used, start) {
      const seed = ((start % HUES.length) + HUES.length) % HUES.length
      if (used.size === 0) return seed

      let best = seed
      let bestDistance = -1

      for (let step = 0; step < HUES.length; step += 1) {
        const slot = (seed + step) % HUES.length
        if (used.has(slot)) continue

        let nearest = 360
        for (const taken of used) {
          const distance = hueDistance(HUES[slot], HUES[taken])
          if (distance < nearest) nearest = distance
        }

        if (nearest > bestDistance) {
          bestDistance = nearest
          best = slot
        }
      }

      return best
    }

    // ---------------------------------------------------------------- storage

    function freshState() {
      return { schema: SCHEMA, level: DEFAULT_LEVEL, slots: {} }
    }

    /**
     * Carry an older assignment set onto the current ramp. Version 1 stored raw
     * indices against the first ramp, so each one is re-anchored to the nearest
     * tone of the green-free ramp; a clash is settled later by the ordinary
     * farthest-tone pass.
     */
    function migrate(parsed) {
      const slots = {}
      if (parsed.slots !== null && typeof parsed.slots === 'object') {
        for (const path of Object.keys(parsed.slots)) {
          const index = Number(parsed.slots[path])
          if (!Number.isInteger(index)) continue
          if (index >= 0 && index < LEGACY_HUES.length) {
            slots[path] = nearestSlotForHue(LEGACY_HUES[index])
          } else if (index >= 0 && index < HUES.length) {
            slots[path] = index
          }
        }
      }
      return {
        schema: SCHEMA,
        level: LEVELS.some((item) => item.id === parsed.level)
          ? parsed.level
          : DEFAULT_LEVEL,
        slots,
      }
    }

    function readState() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return freshState()
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return freshState()
        if (parsed.schema !== SCHEMA) {
          const migrated = migrate(parsed)
          writeState(migrated)
          return migrated
        }
        return {
          schema: SCHEMA,
          level: LEVELS.some((item) => item.id === parsed.level)
            ? parsed.level
            : DEFAULT_LEVEL,
          slots:
            parsed.slots !== null && typeof parsed.slots === 'object' ? parsed.slots : {},
        }
      } catch {
        return freshState()
      }
    }

    function writeState(state) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        /* A blocked storage only costs stability across reloads, never rendering. */
      }
    }

    function createStore() {
      let state = readState()
      const listeners = new Set()
      return {
        getLevel: () => state.level,
        /** Read-only view used while resolving assignments. */
        peekSlots: () => state.slots,
        setLevel(level) {
          if (state.level === level) return
          state = { ...state, level }
          writeState(state)
          listeners.forEach((listener) => listener())
        },
        /**
         * Remember one assignment. Silent on purpose: the stylesheet owner
         * rebuilds from the same Workspace snapshot that produced the write,
         * so notifying here would only force a render of the Settings legend.
         */
        setSlot(path, slot) {
          if (state.slots[path] === slot) return
          state = { ...state, slots: { ...state.slots, [path]: slot } }
          writeState(state)
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      }
    }

    // ------------------------------------------------------------- assignment

    /**
     * Resolve every Workspace to a ramp slot.
     *
     * Stored slots win. Remaining Workspaces are visited oldest first and take
     * the free slot farthest from the tones already in use, which keeps the
     * result deterministic while guaranteeing that a small set of Workspaces
     * never shares a tone and never sits on neighbouring tones.
     */
    function resolveSlots(items, store) {
      const stored = store.peekSlots()
      const ordered = items.slice().sort((left, right) => {
        const leftCreated = Date.parse(left.createdAt) || 0
        const rightCreated = Date.parse(right.createdAt) || 0
        if (leftCreated !== rightCreated) return leftCreated - rightCreated
        return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
      })

      const used = new Set()
      const resolved = new Map()

      for (const workspace of ordered) {
        const slot = stored[workspace.path]
        const valid =
          Number.isInteger(slot) && slot >= 0 && slot < HUES.length && !used.has(slot)
        if (valid) {
          used.add(slot)
          resolved.set(workspace.workspaceId, slot)
        }
      }

      for (const workspace of ordered) {
        if (resolved.has(workspace.workspaceId)) continue
        const slot = pickSlot(used, hashPath(workspace.path))
        used.add(slot)
        resolved.set(workspace.workspaceId, slot)
        store.setSlot(workspace.path, slot)
      }

      return resolved
    }

    // -------------------------------------------------------------- stylesheet

    function escapeAttr(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    }

    /**
     * Both row families the sidebar stamps with `data-row-key`. `:where()`
     * keeps the header selector at one-class specificity, so the shipped
     * hover/selected fills still win the cascade on every row.
     */
    const HEADER_SELECTOR =
      '[data-row-key^="workspace:"]:where(:not([data-row-key="workspace:"]))'
    const SESSION_SELECTOR = '[data-row-key^="session:"]'
    /** Every group heading, including the ungrouped bucket (which takes no tint). */
    const GROUP_SELECTOR = '[data-row-key^="workspace:"]'

    /**
     * A Session whose status dot reports "done" is finished and unread. The dot
     * carries `data-state="done"` (the shipped dot styles itself from it), so the
     * row can answer in CSS without reading any plugin's runtime state.
     */
    const DONE_SELECTOR = SESSION_SELECTOR + ':has([data-state="done"])'

    /** The finished-and-unread wash: the dot's green, fading left to right. */
    function doneRule() {
      const band = (percent, stop) =>
        'color-mix(in oklab,' + SUCCESS + ' ' + percent + '%,transparent) ' + stop
      return (
        DONE_SELECTOR +
        '{background-image:linear-gradient(90deg,' +
        band(30, '0%') +
        ',' +
        band(18, '55%') +
        ',' +
        band(8, '100%') +
        ')}'
      )
    }

    /**
     * The hierarchy is structural rather than decorative: a Workspace reads as a
     * section heading and its Sessions sit indented beneath it. It therefore
     * stays on at every intensity, "Off" included.
     *
     * The title is matched by the semantic half of its module class
     * (`..._title`), which survives a rebuild's hash prefix, and the doubled
     * attribute on the indent keeps that rule above the shipped one-class
     * `padding-inline-start`.
     */
    const INDENT_SELECTOR = SESSION_SELECTOR + '[data-row-key]'

    function hierarchyRules() {
      return [
        // Air above each section heading, never above the rows inside one.
        GROUP_SELECTOR + '{margin-top:6px}',
        GROUP_SELECTOR + ' [class*="title"]{font-size:15px;font-weight:600;letter-spacing:-0.01em}',
        // The group's own rail stays at the row edge; only the contents nest.
        INDENT_SELECTOR + '{padding-inline-start:calc(20px + var(--dsh-workspace-indent,0px))}',
        SESSION_SELECTOR + ' [class*="title"]{font-size:13px}',
        // The inline rename field is the only input a row ever holds; keep it in step.
        GROUP_SELECTOR + ' input{font-size:15px;font-weight:600}',
        SESSION_SELECTOR + ' input{font-size:13px}',
      ]
    }

    function buildCss(items, slots, level) {
      const preset = LEVELS.find((item) => item.id === level)

      // The finished-session wash is a state signal, not a Workspace tint, so it
      // survives "Off" — turning the tints off must not hide that a chat is done.
      const rules = [doneRule()]

      rules.push(...hierarchyRules())

      if (preset === undefined || preset.id === 'off') return rules.join('\n')

      // The neutral default: an untinted row mixes the surface with itself.
      rules.push(':root{' + TONE_VAR + ':' + FILL + '}')

      // The constant: a 2px rail that survives the shipped hover/selected fills.
      rules.push(
        HEADER_SELECTOR +
          ',' +
          SESSION_SELECTOR +
          '{box-shadow:inset 2px 0 0 color-mix(in oklab,var(' +
          TONE_VAR +
          ') ' +
          preset.rail +
          '%,' +
          FILL +
          ')}',
      )

      // The gradient: strongest at the header's leading edge, dissolving rightwards.
      rules.push(
        HEADER_SELECTOR +
          '{background-image:linear-gradient(90deg,' +
          'color-mix(in oklab,var(' +
          TONE_VAR +
          ') ' +
          preset.strong +
          '%,' +
          FILL +
          ') 0%,' +
          'color-mix(in oklab,var(' +
          TONE_VAR +
          ') ' +
          preset.mid +
          '%,' +
          FILL +
          ') 52%,' +
          'transparent 100%)}',
      )

      for (const workspace of items) {
        const slot = slots.get(workspace.workspaceId)
        if (slot === undefined) continue
        const selectors = [
          '[data-row-key="workspace:' + escapeAttr(workspace.workspaceId) + '"]',
        ]
        for (const sessionId of workspace.sessionIds) {
          selectors.push('[data-row-key="session:' + escapeAttr(sessionId) + '"]')
        }
        rules.push(selectors.join(',') + '{' + TONE_VAR + ':' + toneOf(slot) + '}')
      }

      return rules.join('\n')
    }

    // ---------------------------------------------------------------- section

    function createSection(deps) {
      return function WorkspaceTintsSection(props) {
        const t = typeof props.t === 'function' ? props.t : (key) => EN[key] ?? key
        const source = deps.source
        const store = deps.store

        const snapshot = useSyncExternalStore(
          (listener) => source.subscribe(listener),
          () => source.getSnapshot(),
        )
        const level = useSyncExternalStore(
          (listener) => store.subscribe(listener),
          () => store.getLevel(),
        )

        const items = snapshot.items
        const slots = useMemo(() => resolveSlots(items, store), [items])

        const heading = {
          margin: 0,
          fontSize: 14,
          lineHeight: '20px',
          fontWeight: 600,
          color: 'var(--dsw-alias-label-primary)',
        }
        const body = {
          margin: 0,
          fontSize: 13,
          lineHeight: '20px',
          color: 'var(--dsw-alias-label-secondary)',
        }
        const caption = {
          margin: 0,
          fontSize: 12,
          lineHeight: '18px',
          color: 'var(--dsw-alias-label-tertiary)',
        }

        const buttons = LEVELS.map((entry) => {
          const selected = entry.id === level
          return h(
            'button',
            {
              key: entry.id,
              type: 'button',
              'aria-pressed': selected,
              onClick: () => store.setLevel(entry.id),
              style: {
                height: 28,
                padding: '0 12px',
                font: 'inherit',
                fontSize: 12,
                lineHeight: '28px',
                borderRadius: 'var(--dsw-radius-sm, 6px)',
                border: '0.5px solid var(--dsw-alias-border-l1)',
                background: selected
                  ? 'var(--dsw-alias-interactive-bg-hover)'
                  : 'transparent',
                color: selected
                  ? 'var(--dsw-alias-label-primary)'
                  : 'var(--dsw-alias-label-secondary)',
                cursor: 'pointer',
              },
            },
            t(entry.id),
          )
        })

        const legend = items.map((workspace) => {
          const slot = slots.get(workspace.workspaceId)
          const tone = toneOf(slot === undefined ? 0 : slot)
          return h(
            'li',
            {
              key: workspace.workspaceId,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 0',
                borderTop: '0.5px solid var(--dsw-alias-border-l1)',
                minWidth: 0,
              },
            },
            h('span', {
              'aria-hidden': true,
              style: {
                flex: 'none',
                width: 36,
                height: 12,
                borderRadius: 999,
                background:
                  'linear-gradient(90deg,color-mix(in oklab,' +
                  tone +
                  ' 70%,transparent),color-mix(in oklab,' +
                  tone +
                  ' 16%,transparent))',
              },
            }),
            h(
              'span',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  flex: 1,
                },
              },
              h(
                'span',
                {
                  style: {
                    fontSize: 13,
                    lineHeight: '20px',
                    color: 'var(--dsw-alias-label-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                workspace.title,
              ),
              h(
                'span',
                {
                  style: {
                    ...caption,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                workspace.path,
              ),
            ),
          )
        })

        return h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
              maxWidth: 560,
              padding: '4px 0 16px',
            },
          },
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('h2', { style: heading }, t('title')),
            h('p', { style: body }, t('description')),
          ),
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              },
            },
            h('span', { style: { ...body, color: 'var(--dsw-alias-label-primary)' } }, t('intensity')),
            h('div', { style: { display: 'flex', gap: 6 } }, buttons),
          ),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('span', { style: { ...body, color: 'var(--dsw-alias-label-primary)' } }, t('legend')),
            items.length === 0
              ? h('p', { style: caption }, t('empty'))
              : h('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } }, legend),
            h('p', { style: caption }, t('legendHint')),
            h(
              'p',
              {
                style: {
                  ...caption,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                },
              },
              h('span', {
                'aria-hidden': true,
                style: {
                  flex: 'none',
                  width: 36,
                  height: 12,
                  borderRadius: 999,
                  background:
                    'linear-gradient(90deg,color-mix(in oklab,' +
                    SUCCESS +
                    ' 30%,transparent),color-mix(in oklab,' +
                    SUCCESS +
                    ' 8%,transparent))',
                },
              }),
              t('doneNote'),
            ),
            h('p', { style: caption }, t('ungrouped')),
            h('p', { style: caption }, t('hierarchyNote')),
          ),
        )
      }
    }

    // ----------------------------------------------------------------- plugin

    const inject = ['slots', 'locale', 'workspaces']

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { en: EN, zh: ZH }),
        'workspace-tints: dictionaries',
      )

      const store = createStore()
      const source = ctx.workspaces.list
      const Section = createSection({ source, store })

      // A small read-only face, for other Client plugins and for inspection:
      // the tone a Workspace currently owns, and the intensity in force.
      ctx.provide('workspaceTints', {
        getLevel: () => store.getLevel(),
        setLevel(level) {
          if (!LEVELS.some((entry) => entry.id === level)) return
          store.setLevel(level)
        },
        toneFor(workspaceId) {
          const items = source.getSnapshot().items
          const slot = resolveSlots(items, store).get(workspaceId)
          return slot === undefined ? null : toneOf(slot)
        },
      })

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-workspace-tints'
        tag.dataset.pluginCss = STYLE_KEY
        document.head.appendChild(tag)

        const rebuild = () => {
          const items = source.getSnapshot().items
          tag.textContent = buildCss(items, resolveSlots(items, store), store.getLevel())
        }

        rebuild()
        const offWorkspaces = source.subscribe(rebuild)
        const offSettings = store.subscribe(rebuild)

        return () => {
          offWorkspaces()
          offSettings()
          tag.remove()
        }
      }, 'workspace-tints: stylesheet')

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'workspace-tints',
            order: 5,
            label: () => ctx.locale.bind(NS)('title'),
            locale: NS,
          },
          Section,
        ),
      )
    }

    return { inject, apply }
  },
})
