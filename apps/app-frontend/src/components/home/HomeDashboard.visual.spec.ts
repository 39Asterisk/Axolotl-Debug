import { I18N_INJECTION_KEY } from '@modrinth/ui'
import { afterEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { ref } from 'vue'

import { mountThemed, waitFor } from '@/test/visual-harness'

import type { HomeDashboardConfig, HomeWidgetLayout } from './home-dashboard'
import HomeDashboard from './HomeDashboard.vue'

vi.mock('@/components/home/home-dashboard-runtime', () => ({
    provideHomeDashboardRuntime: vi.fn(),
}))
vi.mock('@/components/home/HomeCalendar.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/home/HomeGreeting.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/home/HomeGreetingSettingsModal.vue', () => ({
    default: { render: () => null },
}))
vi.mock('@/components/home/HomePinnedInstances.vue', () => ({
    default: { render: () => null },
}))
vi.mock('@/components/home/HomePinnedServers.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/home/HomePinnedWorlds.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/home/HomeRecentWorlds.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/home/HomeShortcutWidget.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/home/HomeWidgetPickerModal.vue', () => ({
    default: { render: () => null },
}))

const cleanup: (() => void)[] = []
afterEach(() =>
    cleanup
        .splice(0)
        .reverse()
        .forEach((stop) => stop()),
)

const menu = () => document.querySelector<HTMLElement>('[role="menu"]')

async function dashboard(layout: HomeWidgetLayout) {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;top:32px;left:24px;width:min(800px,calc(100vw - 48px))'
    const teleports = document.createElement('div')
    teleports.id = 'teleports'
    const outside = document.createElement('button')
    outside.textContent = 'Outside dashboard'
    outside.style.cssText = 'position:fixed;bottom:8px;left:8px'
    document.body.append(host, teleports, outside)
    cleanup.push(() => {
        host.remove()
        teleports.remove()
        outside.remove()
    })
    const config: HomeDashboardConfig = {
        version: 1,
        layout,
        widgets: [
            {
                id: 'pinned-instances',
                kind: 'pinned-instances',
                size: '1x1',
                ...(layout === 'free' ? { position: { column: 0, row: 0 } } : {}),
            },
        ],
    }
    const wrapper = await mountThemed(
        HomeDashboard,
        { config, instances: [], playerName: null, editing: true },
        'dark',
        {
            attachTo: host,
            global: {
                directives: { tooltip: {} },
                provide: {
                    [I18N_INJECTION_KEY as symbol]: {
                        locale: ref('en-US'),
                        t: (key: string) => key,
                        setLocale: () => undefined,
                    },
                    [Symbol.for('modrinth:notificationManager')]: { handleError: vi.fn() },
                },
            },
        },
    )
    cleanup.push(() => wrapper.unmount())
    const widget = wrapper.get('.home-widget').element as HTMLElement
    const options = wrapper.get('.home-widget-options').element as HTMLElement
    const label = wrapper.get('.home-widget-size-label').element as HTMLElement
    const trigger = widget.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
    await waitFor(() => widget.getBoundingClientRect().width > 200)
    await userEvent.hover(outside)
    return { wrapper, widget, options, label, trigger, teleports, outside }
}

function expectSamePosition(element: HTMLElement, reference: DOMRect) {
    const actual = element.getBoundingClientRect()
    expect(Math.abs(actual.left - reference.left)).toBeLessThan(1)
    expect(Math.abs(actual.top - reference.top)).toBeLessThan(1)
    expect(Math.abs(actual.width - reference.width)).toBeLessThan(1)
    expect(Math.abs(actual.height - reference.height)).toBeLessThan(1)
}

function toolbarExpanded(options: HTMLElement, label: HTMLElement) {
    return (
        options.getBoundingClientRect().width > 31 &&
        label.getBoundingClientRect().width > 35 &&
        getComputedStyle(options).opacity === '1' &&
        getComputedStyle(label).opacity === '1'
    )
}

async function duringToolbarTransition(assertion: () => void) {
    const until = performance.now() + 180
    do {
        assertion()
        await new Promise((resolve) => requestAnimationFrame(resolve))
    } while (performance.now() < until)
}

for (const layout of ['grid', 'free'] as const) {
    it(`keeps the ${layout} widget toolbar expanded and menu fixed until selection finishes`, async () => {
        const { wrapper, widget, options, label, trigger, teleports, outside } =
            await dashboard(layout)
        await userEvent.hover(widget)
        await waitFor(() => toolbarExpanded(options, label))
        await userEvent.click(trigger)
        await waitFor(
            () =>
                !!menu() &&
                menu()!.getBoundingClientRect().width > 0 &&
                menu()!.getBoundingClientRect().top >= 0,
        )
        expect(teleports.contains(menu())).toBe(true)
        const triggerRect = trigger.getBoundingClientRect()
        const menuRect = menu()!.getBoundingClientRect()
        const resize = [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
            (item) => item.textContent?.trim() === 'Size 2x1',
        )!
        expect(resize).toBeDefined()
        await userEvent.hover(resize)
        await waitFor(() => document.activeElement === resize)
        expect(widget.matches(':hover')).toBe(false)

        // Moving into the portal must not start the toolbar's 120 ms collapse.
        await duringToolbarTransition(() => {
            expect(toolbarExpanded(options, label)).toBe(true)
            expectSamePosition(trigger, triggerRect)
            expectSamePosition(menu()!, menuRect)
        })
        expect(menu()).not.toBeNull()

        await userEvent.click(resize)
        await waitFor(() => !menu())
        await userEvent.hover(outside)
        await waitFor(() => document.activeElement === trigger)
        await waitFor(
            () =>
                options.getBoundingClientRect().width < 1 &&
                label.getBoundingClientRect().width < 1,
        )
        const changes = wrapper.emitted('change')!
        expect(changes).toHaveLength(1)
        expect((changes[0][0] as HomeDashboardConfig).widgets[0].size).toBe('2x1')
    })
}

it('closes and retracts the toolbar when clicking outside the widget operation', async () => {
    const { wrapper, widget, options, label, trigger, outside } = await dashboard('grid')
    await userEvent.hover(widget)
    await waitFor(() => toolbarExpanded(options, label))
    await userEvent.click(trigger)
    await waitFor(() => !!menu())
    await userEvent.hover(outside)
    expect(widget.matches(':hover')).toBe(false)
    await duringToolbarTransition(() => {
        expect(menu()).not.toBeNull()
        expect(toolbarExpanded(options, label)).toBe(true)
    })
    await userEvent.click(outside)
    await waitFor(() => !menu())
    expect(document.activeElement).toBe(outside)
    await waitFor(
        () => options.getBoundingClientRect().width < 1 && label.getBoundingClientRect().width < 1,
    )
    expect(wrapper.emitted('change')).toBeUndefined()
})

it('keeps the toolbar expanded after closing the menu until the pointer leaves the widget', async () => {
    const { widget, options, label, trigger, outside } = await dashboard('grid')
    await userEvent.hover(widget)
    await waitFor(() => toolbarExpanded(options, label))
    await userEvent.click(trigger)
    await waitFor(() => !!menu())
    await userEvent.click(trigger)
    await waitFor(() => !menu())
    expect(widget.matches(':hover')).toBe(true)
    await duringToolbarTransition(() => expect(toolbarExpanded(options, label)).toBe(true))
    await userEvent.hover(outside)
    await waitFor(
        () => options.getBoundingClientRect().width < 1 && label.getBoundingClientRect().width < 1,
    )
})

it('restores keyboard focus on Escape and retracts after tabbing out of the widget', async () => {
    const { widget, options, label, trigger, outside } = await dashboard('grid')
    widget.querySelector<HTMLButtonElement>('.home-widget-drag-handle')!.focus()
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(trigger)
    expect(trigger.matches(':focus-visible')).toBe(true)
    await waitFor(() => toolbarExpanded(options, label))
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => document.activeElement?.getAttribute('role') === 'menuitem')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => !menu() && document.activeElement === trigger)
    await waitFor(() => toolbarExpanded(options, label))
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(outside)
    await waitFor(
        () => options.getBoundingClientRect().width < 1 && label.getBoundingClientRect().width < 1,
    )
})
